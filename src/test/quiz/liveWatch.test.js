// src/features/quiz/liveWatch.js -- `useLiveQuizWatch()` (docs/
// quiz-unification-spec.md §4.5). Combines a realtime feed with a safety
// poll; driven with fake timers, flushing pending promise `.then()`s with
// `await act(async () => {})` -- same idiom `TournamentEditor.debounce.
// test.jsx` and `EventTrailer.render.test.jsx` use for fake-timers + async
// data-layer calls in this codebase (`waitFor`'s own polling doesn't mix
// reliably with fake timers here).
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

let mockTableData = {};
let mockChannelCalls = [];
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => makeQueryBuilder(mockTableData[table] ?? { data: [], error: null }),
      channel: () => {
        const handlers = [];
        const ch = {
          on: (event, filter, cb) => { handlers.push({ event, filter, cb }); return ch; },
          subscribe: () => ch,
        };
        mockChannelCalls.push({ handlers });
        return ch;
      },
      removeChannel: vi.fn(),
    },
  };
});

import { useLiveQuizWatch } from '../../features/quiz/liveWatch.js';

beforeEach(() => {
  mockTableData = {};
  mockChannelCalls = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('useLiveQuizWatch', () => {
  it('loads live quizzes on mount', async () => {
    mockTableData.quiz_live = { data: [{ quiz_id: 'qz1', event_id: 'evt-1' }], error: null };
    mockTableData.quizzes = { data: [{ id: 'qz1', title: 'Live One' }], error: null };
    const { result } = renderHook(() => useLiveQuizWatch());
    await flush();
    expect(result.current.liveQuizzes).toEqual([{ id: 'qz1', title: 'Live One', eventId: 'evt-1' }]);
    expect(result.current.error).toBeNull();
  });

  it('subscribes to the unfiltered quiz_live INSERT/DELETE feed, and a fired event re-fetches', async () => {
    mockTableData.quiz_live = { data: [], error: null };
    const { result } = renderHook(() => useLiveQuizWatch());
    await flush();
    expect(result.current.liveQuizzes).toEqual([]);
    expect(mockChannelCalls).toHaveLength(1);

    mockTableData.quiz_live = { data: [{ quiz_id: 'qz2', event_id: null }], error: null };
    mockTableData.quizzes = { data: [{ id: 'qz2', title: 'Now Live' }], error: null };
    const { handlers } = mockChannelCalls[0];
    expect(handlers.some(h => h.event === 'postgres_changes' && h.filter.event === 'INSERT' && h.filter.filter === undefined)).toBe(true);
    expect(handlers.some(h => h.event === 'postgres_changes' && h.filter.event === 'DELETE' && h.filter.filter === undefined)).toBe(true);
    await act(async () => { handlers[0].cb({}); await Promise.resolve(); });

    expect(result.current.liveQuizzes).toEqual([{ id: 'qz2', title: 'Now Live', eventId: null }]);
  });

  it('falls back to a 30s safety poll -- still finds a live quiz if realtime never fires', async () => {
    mockTableData.quiz_live = { data: [], error: null };
    const { result } = renderHook(() => useLiveQuizWatch());
    await flush();
    expect(result.current.liveQuizzes).toEqual([]);

    mockTableData.quiz_live = { data: [{ quiz_id: 'qz3', event_id: null }], error: null };
    mockTableData.quizzes = { data: [{ id: 'qz3', title: 'Polled' }], error: null };
    await act(async () => { vi.advanceTimersByTime(30000); await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.liveQuizzes).toEqual([{ id: 'qz3', title: 'Polled', eventId: null }]);
  });

  it('surfaces a read failure without clearing an already-shown banner', async () => {
    mockTableData.quiz_live = { data: [{ quiz_id: 'qz1', event_id: null }], error: null };
    mockTableData.quizzes = { data: [{ id: 'qz1', title: 'Live One' }], error: null };
    const { result } = renderHook(() => useLiveQuizWatch());
    await flush();
    expect(result.current.liveQuizzes).toHaveLength(1);

    mockTableData.quiz_live = { data: null, error: { message: 'boom' } };
    await act(async () => { vi.advanceTimersByTime(30000); await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.error).toEqual({ message: 'boom' });
    expect(result.current.liveQuizzes).toHaveLength(1);
  });

  it('unmounting clears the poll interval and unsubscribes without throwing', async () => {
    mockTableData.quiz_live = { data: [], error: null };
    const { unmount } = renderHook(() => useLiveQuizWatch());
    await flush();
    expect(mockChannelCalls).toHaveLength(1);
    expect(() => unmount()).not.toThrow();
  });
});
