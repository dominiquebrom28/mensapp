// src/features/quiz/api.js -- `quizzes` table row mapping + error handling,
// same pattern as src/test/mensgames/api.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockTableData = {};
let mockUpsertCalls = [];
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => {
        const builder = makeQueryBuilder(mockTableData[table] ?? { data: [], error: null });
        const origUpsert = builder.upsert;
        builder.upsert = (rows, opts) => { mockUpsertCalls.push({ table, rows, opts }); return origUpsert(rows, opts); };
        return builder;
      },
    },
  };
});

import { deleteQuiz, fetchLiveQuizzes, fetchQuiz, fetchQuizzes, fetchQuizzesForEvent, isMissingTableError, saveQuiz } from '../../features/quiz/api.js';

beforeEach(() => {
  mockTableData = {};
  mockUpsertCalls = [];
});

const ROW = {
  id: 'qz1',
  title: 'Pubquiz 12',
  event_id: 'evt-1',
  status: 'ready',
  rounds: [{ id: 'r0', title: 'Round 1', questions: [] }],
  default_time: 30,
  intro_text: 'Welkom',
  intro_bg: '',
  team_set_id: 'ts_1',
  teams: [{ id: 'tm_1', name: 'A' }],
  participants: ['Doom'],
  scores: { A: 10 },
  member_scores: { doom: 10 },
  settings: { secret: false },
  rev: 2,
  created_by: 'Doom',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  finished_at: null,
};

describe('quiz/api row mapping', () => {
  it('fetchQuizzes maps snake_case rows to the camelCase Quiz shape', async () => {
    mockTableData.quizzes = { data: [ROW], error: null };
    const res = await fetchQuizzes();
    expect(res.ok).toBe(true);
    expect(res.quizzes).toEqual([{
      id: 'qz1', title: 'Pubquiz 12', eventId: 'evt-1', status: 'ready',
      rounds: ROW.rounds, defaultTime: 30, introText: 'Welkom', introBg: '',
      teamSetId: 'ts_1', teams: ROW.teams, participants: ['Doom'],
      scores: { A: 10 }, memberScores: { doom: 10 }, settings: { secret: false },
      rev: 2, createdBy: 'Doom', createdAt: ROW.created_at, updatedAt: ROW.updated_at,
      finishedAt: null,
    }]);
  });

  it('fetchQuizzes degrades to [] on a Supabase error rather than throwing', async () => {
    mockTableData.quizzes = { data: null, error: { message: 'boom' } };
    const res = await fetchQuizzes();
    expect(res.ok).toBe(false);
    expect(res.quizzes).toEqual([]);
  });

  it('fetchQuizzesForEvent scopes to event_id and maps rows', async () => {
    mockTableData.quizzes = { data: [ROW], error: null };
    const res = await fetchQuizzesForEvent('evt-1');
    expect(res.ok).toBe(true);
    expect(res.quizzes[0].eventId).toBe('evt-1');
  });

  it('fetchQuiz maps a single row', async () => {
    mockTableData.quizzes = { data: ROW, error: null };
    const res = await fetchQuiz('qz1');
    expect(res.ok).toBe(true);
    expect(res.quiz.title).toBe('Pubquiz 12');
  });

  // Discovery reads `quiz_live`, NOT `quizzes.status`. See the comment on
  // fetchLiveQuizzes: `quiz_live` has no FK to `quizzes`, so it is the only
  // source that finds a quiz which has never been written to the `quizzes`
  // table -- which is every quiz built since the one-time §10.2 migration,
  // because the builder still writes to `events.quizzes` until Q5/Q7.
  it('fetchLiveQuizzes reads quiz_live and filters malformed rows', async () => {
    mockTableData.quiz_live = { data: [{ quiz_id: 'qz1', event_id: 'evt-1' }, { quiz_id: null }], error: null };
    mockTableData.quizzes = { data: [{ id: 'qz1', title: 'Live One' }], error: null };
    const res = await fetchLiveQuizzes();
    expect(res.ok).toBe(true);
    expect(res.liveQuizzes).toEqual([{ id: 'qz1', title: 'Live One', eventId: 'evt-1' }]);
  });

  it('fetchLiveQuizzes finds an UNMIGRATED live quiz -- one with no `quizzes` row at all', async () => {
    mockTableData.quiz_live = { data: [{ quiz_id: 'qz-legacy', event_id: 'evt-1' }], error: null };
    mockTableData.quizzes = { data: [], error: null };
    const res = await fetchLiveQuizzes();
    expect(res.ok).toBe(true);
    // Found, with an empty title -- the caller resolves the real one from
    // its own copy of the definition. Querying `quizzes.status` instead
    // would have returned [] here and no participant would see the quiz.
    expect(res.liveQuizzes).toEqual([{ id: 'qz-legacy', title: '', eventId: 'evt-1' }]);
  });

  it('fetchLiveQuizzes returns [] when nothing is live, without reading quizzes at all', async () => {
    mockTableData.quiz_live = { data: [], error: null };
    const res = await fetchLiveQuizzes();
    expect(res.ok).toBe(true);
    expect(res.liveQuizzes).toEqual([]);
  });

  it('fetchLiveQuizzes degrades to [] on error', async () => {
    mockTableData.quiz_live = { data: null, error: { message: 'boom' } };
    const res = await fetchLiveQuizzes();
    expect(res.ok).toBe(false);
    expect(res.liveQuizzes).toEqual([]);
  });

  it('saveQuiz upserts a full row and reports failure on a Supabase error', async () => {
    mockTableData.quizzes = { data: null, error: { message: 'nope' } };
    const res = await saveQuiz({ id: 'qz2', title: 'Nieuw' });
    expect(res.ok).toBe(false);
  });

  it('saveQuiz round-trips a well-formed quiz object', async () => {
    mockTableData.quizzes = { data: null, error: null };
    const res = await saveQuiz({
      id: 'qz2', title: 'Nieuw', eventId: 'evt-9', status: 'ready', rounds: [],
      defaultTime: 45, introText: '', introBg: '', teamSetId: null, teams: [],
      participants: [], scores: {}, memberScores: {}, settings: {}, rev: 1,
      createdBy: 'Doom', createdAt: '2026-08-01T00:00:00Z',
    });
    expect(res.ok).toBe(true);
    expect(mockUpsertCalls[0].rows[0]).toMatchObject({ id: 'qz2', title: 'Nieuw', event_id: 'evt-9', default_time: 45 });
  });

  it('an unknown/malformed status column falls back to "ready" rather than crashing a reader', async () => {
    mockTableData.quizzes = { data: [{ ...ROW, status: 'garbage' }], error: null };
    const res = await fetchQuizzes();
    expect(res.quizzes[0].status).toBe('ready');
  });

  it('a malformed row (non-array rounds/teams, non-object scores) coerces to safe defaults, never throws', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz3', rounds: 'nope', teams: null, scores: 'nope', member_scores: [], settings: 3 }], error: null };
    const res = await fetchQuizzes();
    expect(res.quizzes[0]).toMatchObject({ rounds: [], teams: [], scores: {}, memberScores: {}, settings: {} });
  });

  it('deleteQuiz reports failure on a Supabase error', async () => {
    mockTableData.quizzes = { data: null, error: { message: 'nope' } };
    const res = await deleteQuiz('qz1');
    expect(res.ok).toBe(false);
  });

  describe('isMissingTableError', () => {
    it('is true for PGRST205 and 42P01', () => {
      expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
      expect(isMissingTableError({ code: '42P01' })).toBe(true);
    });

    it('is false for a generic error, null, or an unrelated code', () => {
      expect(isMissingTableError({ message: 'Failed to fetch' })).toBe(false);
      expect(isMissingTableError(null)).toBe(false);
      expect(isMissingTableError(undefined)).toBe(false);
      expect(isMissingTableError({ code: '23505' })).toBe(false);
    });
  });
});
