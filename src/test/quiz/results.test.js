// src/features/quiz/results.js -- `fetchQuizResults()` must project columns
// explicitly (never `select *`) and must **never reject**, mirroring
// `fetchTeamSets` in teamlib/api.js (docs/quiz-unification-spec.md §8.1,
// §9's `App.quizResultsError.test.jsx` requirement). The App boot
// `Promise.all` depends on the never-reject contract.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockTableData = {};
let selectCalls = [];
let mockThrow = false;
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => {
        if (mockThrow) throw new Error('hard offline fetch throw');
        const builder = makeQueryBuilder(mockTableData[table] ?? { data: [], error: null });
        const origSelect = builder.select;
        builder.select = (cols) => { selectCalls.push(cols); return origSelect(cols); };
        return builder;
      },
    },
  };
});

import { fetchQuizResults, isMissingTableError } from '../../features/quiz/results.js';

beforeEach(() => {
  mockTableData = {};
  selectCalls = [];
  mockThrow = false;
});

describe('fetchQuizResults', () => {
  it('projects an explicit, narrow column list -- never `select *`', async () => {
    mockTableData.quizzes = { data: [], error: null };
    await fetchQuizResults();
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]).not.toBe('*');
    expect(selectCalls[0]).toBe('id,title,event_id,status,teams,scores,member_scores,finished_at,settings');
    expect(selectCalls[0]).not.toContain('rounds');
  });

  it('maps a finished-quiz row to the camelCase QuizResult shape', async () => {
    const row = {
      id: 'qz1', title: 'Pubquiz 12', event_id: 'evt-1', status: 'finished',
      teams: [{ id: 'tm_1', name: 'A' }], scores: { A: 20 }, member_scores: { doom: 20 },
      finished_at: '2026-08-01T00:00:00Z', settings: { secret: false },
    };
    mockTableData.quizzes = { data: [row], error: null };
    const res = await fetchQuizResults();
    expect(res.ok).toBe(true);
    expect(res.quizResults).toEqual([{
      id: 'qz1', title: 'Pubquiz 12', eventId: 'evt-1', status: 'finished',
      teams: [{ id: 'tm_1', name: 'A' }], scores: { A: 20 }, memberScores: { doom: 20 },
      finishedAt: '2026-08-01T00:00:00Z', settings: { secret: false },
    }]);
  });

  it('never rejects on a resolved Supabase error -- returns {ok:false,error,quizResults:[]}', async () => {
    mockTableData.quizzes = { data: null, error: { message: 'boom' } };
    await expect(fetchQuizResults()).resolves.toEqual({ ok: false, error: { message: 'boom' }, quizResults: [] });
  });

  it('never rejects on a missing-table error either, and classifies it via isMissingTableError', async () => {
    const error = { code: 'PGRST205', message: "Could not find the table 'public.quizzes'" };
    mockTableData.quizzes = { data: null, error };
    const res = await fetchQuizResults();
    expect(res.ok).toBe(false);
    expect(res.quizResults).toEqual([]);
    expect(isMissingTableError(res.error)).toBe(true);
  });

  it('never rejects even on a hard synchronous throw (not a resolved {error})', async () => {
    mockThrow = true;
    await expect(fetchQuizResults()).resolves.toEqual(
      expect.objectContaining({ ok: false, quizResults: [] }),
    );
  });

  it('coerces malformed JSONB fields (non-array teams, non-object scores) to safe defaults', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1', teams: 'nope', scores: null, member_scores: 5, settings: [] }], error: null };
    const res = await fetchQuizResults();
    expect(res.quizResults[0]).toMatchObject({ teams: [], scores: {}, memberScores: {}, settings: {} });
  });

  it('filters out any row missing an id rather than surfacing a broken card', async () => {
    mockTableData.quizzes = { data: [{ title: 'no id' }, { id: 'qz1', title: 'ok' }], error: null };
    const res = await fetchQuizResults();
    expect(res.quizResults).toHaveLength(1);
    expect(res.quizResults[0].id).toBe('qz1');
  });
});
