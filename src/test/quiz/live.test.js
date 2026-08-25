// src/features/quiz/live.js -- `quiz_live` row mapping, the
// zero-rows-isn't-an-error fetch, and the two distinct subscriptions
// (§4.2: a per-quiz UPDATE/DELETE feed for participants, an unfiltered
// INSERT/DELETE feed for App-root discovery).
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockTableData = {};
let mockChannelCalls = [];
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => makeQueryBuilder(mockTableData[table] ?? { data: [], error: null }),
      channel: (name) => {
        const handlers = [];
        const ch = {
          on: (event, filter, cb) => { handlers.push({ event, filter, cb }); return ch; },
          subscribe: () => ch,
        };
        mockChannelCalls.push({ name, handlers, ch });
        return ch;
      },
      removeChannel: vi.fn(),
    },
  };
});

import { deleteQuizLive, fetchQuizLive, subscribeLiveQuizFeed, subscribeQuizLive, upsertQuizLive } from '../../features/quiz/live.js';

beforeEach(() => {
  mockTableData = {};
  mockChannelCalls = [];
});

const ROW = {
  quiz_id: 'qz1', quiz_rev: 3, event_id: 'evt-1', phase: 'question',
  round_idx: 1, q_idx: 2, slide_phase: 'answer', scores: { A: 10 },
  summary_revealed: ['A'], pause_config: { musicUrl: '' }, timer_started_at: 1000,
  timer_limit: 30, is_team_quiz: true, presenter_id: 'sess-1', updated_at: '2026-08-25T00:00:00Z',
};

describe('quiz/live row mapping', () => {
  it('fetchQuizLive maps a row to the camelCase LiveState shape', async () => {
    mockTableData.quiz_live = { data: [ROW], error: null };
    const res = await fetchQuizLive('qz1');
    expect(res.ok).toBe(true);
    expect(res.quizLive).toEqual({
      quizId: 'qz1', quizRev: 3, eventId: 'evt-1', phase: 'question', roundIdx: 1, qIdx: 2,
      slidePhase: 'answer', scores: { A: 10 }, summaryRevealed: ['A'], pauseConfig: { musicUrl: '' },
      timerStartedAt: 1000, timerLimit: 30, isTeamQuiz: true, presenterId: 'sess-1', updatedAt: ROW.updated_at,
    });
  });

  it('fetchQuizLive returns quizLive:null (not an error) when no row exists yet -- a quiz that is not live', async () => {
    mockTableData.quiz_live = { data: [], error: null };
    const res = await fetchQuizLive('qz-not-live');
    expect(res.ok).toBe(true);
    expect(res.quizLive).toBeNull();
  });

  it('fetchQuizLive reports failure on a genuine Supabase error', async () => {
    mockTableData.quiz_live = { data: null, error: { message: 'boom' } };
    const res = await fetchQuizLive('qz1');
    expect(res.ok).toBe(false);
    expect(res.quizLive).toBeNull();
  });

  it('an unknown/malformed phase falls back to "intro" rather than crashing a reader', async () => {
    mockTableData.quiz_live = { data: [{ ...ROW, phase: 'garbage' }], error: null };
    const res = await fetchQuizLive('qz1');
    expect(res.quizLive.phase).toBe('intro');
  });

  it('coerces non-object/array JSONB fields to safe defaults', async () => {
    mockTableData.quiz_live = { data: [{ ...ROW, scores: null, summary_revealed: 'nope', pause_config: 3 }], error: null };
    const res = await fetchQuizLive('qz1');
    expect(res.quizLive).toMatchObject({ scores: {}, summaryRevealed: [], pauseConfig: {} });
  });

  it('upsertQuizLive writes a full row and reports failure on error', async () => {
    mockTableData.quiz_live = { data: null, error: { message: 'nope' } };
    const res = await upsertQuizLive({ quizId: 'qz1', phase: 'question' });
    expect(res.ok).toBe(false);
  });

  it('upsertQuizLive succeeds and returns the mapped row', async () => {
    mockTableData.quiz_live = { data: null, error: null };
    const res = await upsertQuizLive({ quizId: 'qz1', phase: 'question', roundIdx: 0, qIdx: 0 });
    expect(res.ok).toBe(true);
    expect(res.quizLive.quizId).toBe('qz1');
  });

  it('deleteQuizLive reports failure on a Supabase error', async () => {
    mockTableData.quiz_live = { data: null, error: { message: 'nope' } };
    const res = await deleteQuizLive('qz1');
    expect(res.ok).toBe(false);
  });
});

describe('subscribeQuizLive', () => {
  it('registers UPDATE and DELETE handlers scoped to the quiz id, and returns an idempotent unsubscribe', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeQuizLive('qz1', onChange);
    expect(mockChannelCalls).toHaveLength(1);
    const { handlers } = mockChannelCalls[0];
    expect(handlers.some(h => h.filter.event === 'UPDATE' && h.filter.filter === 'quiz_id=eq.qz1')).toBe(true);
    expect(handlers.some(h => h.filter.event === 'DELETE' && h.filter.filter === 'quiz_id=eq.qz1')).toBe(true);
    expect(handlers.some(h => h.filter.event === 'INSERT')).toBe(false);

    handlers.find(h => h.filter.event === 'UPDATE').cb({ new: ROW });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ quizId: 'qz1' }));

    handlers.find(h => h.filter.event === 'DELETE').cb({});
    expect(onChange).toHaveBeenCalledWith(null);

    expect(() => { unsubscribe(); unsubscribe(); }).not.toThrow();
  });
});

describe('subscribeLiveQuizFeed', () => {
  it('registers unfiltered INSERT and DELETE handlers and fires onChange with no payload', () => {
    const onChange = vi.fn();
    subscribeLiveQuizFeed(onChange);
    const { handlers } = mockChannelCalls[0];
    expect(handlers.every(h => h.filter.filter === undefined)).toBe(true);
    expect(handlers.some(h => h.filter.event === 'INSERT')).toBe(true);
    expect(handlers.some(h => h.filter.event === 'DELETE')).toBe(true);
    handlers[0].cb({});
    expect(onChange).toHaveBeenCalledWith();
  });
});
