// src/features/quiz/answers.js -- the fix (docs/quiz-unification-spec.md
// §2, §3.3, §15). The load-bearing assertion in this file is
// "upsertAnswer never reads before it writes" -- everything else here is
// row-mapping and the usual `{ok,error}` contract coverage.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockTableData = {};
let calls = [];
let mockChannelCalls = [];

// A hand-built spy builder (not `makeQueryBuilder`) so this test can assert
// on the *sequence* of method calls `upsertAnswer` makes -- specifically,
// that `select`/`eq` (a read) is never called before `upsert` (the write).
function makeSpyBuilder(table, result) {
  const builder = {};
  ['select', 'eq', 'insert', 'update', 'delete'].forEach(m => {
    builder[m] = (...args) => { calls.push({ table, method: m, args }); return builder; };
  });
  builder.upsert = (...args) => { calls.push({ table, method: 'upsert', args }); return builder; };
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  builder.catch = (reject) => Promise.resolve(result).catch(reject);
  return builder;
}

vi.mock('../../supabase.js', () => {
  return {
    supabase: {
      from: (table) => makeSpyBuilder(table, mockTableData[table] ?? { data: [], error: null }),
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

import { deleteAnswersForQuiz, fetchAnswersForSlide, fetchOwnAnswer, subscribeAnswers, upsertAnswer } from '../../features/quiz/answers.js';

beforeEach(() => {
  mockTableData = {};
  calls = [];
  mockChannelCalls = [];
});

describe('upsertAnswer -- the composite-PK, no-read-before-write fix', () => {
  it('issues exactly one call to `quiz_answers`, and it is `upsert` -- never a prior `select`/`eq` read', async () => {
    mockTableData.quiz_answers = { data: null, error: null };
    const res = await upsertAnswer({ quizId: 'qz1', roundIdx: 0, qIdx: 3, answerKey: 't:tm_1', value: [1, 2] });
    expect(res.ok).toBe(true);
    const answerCalls = calls.filter(c => c.table === 'quiz_answers');
    expect(answerCalls.map(c => c.method)).toEqual(['upsert']);
  });

  it('the upsert row carries the composite key columns and an explicit onConflict target', async () => {
    mockTableData.quiz_answers = { data: null, error: null };
    await upsertAnswer({ quizId: 'qz1', roundIdx: 2, qIdx: 5, answerKey: 'p:doom', value: [3] });
    const call = calls.find(c => c.table === 'quiz_answers' && c.method === 'upsert');
    const [rows, opts] = call.args;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quiz_id: 'qz1', round_idx: 2, q_idx: 5, answer_key: 'p:doom', value: [3] });
    expect(typeof rows[0].updated_at).toBe('string');
    expect(opts).toEqual({ onConflict: 'quiz_id,round_idx,q_idx,answer_key' });
  });

  it('the per-answer wire payload is small -- comfortably under the spec\'s ~0.2 kB estimate', async () => {
    mockTableData.quiz_answers = { data: null, error: null };
    await upsertAnswer({ quizId: 'qz1798323841020', roundIdx: 3, qIdx: 12, answerKey: 't:tm_1798323841020_3', value: [1, 3] });
    const call = calls.find(c => c.table === 'quiz_answers' && c.method === 'upsert');
    const bytes = new TextEncoder().encode(JSON.stringify(call.args[0])).length;
    expect(bytes).toBeLessThan(200);
  });

  it('reports failure on a Supabase error without throwing', async () => {
    mockTableData.quiz_answers = { data: null, error: { message: 'boom' } };
    const res = await upsertAnswer({ quizId: 'qz1', roundIdx: 0, qIdx: 0, answerKey: 't:tm_1', value: [0] });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('coerces a non-array `value` to [] rather than writing malformed JSONB', async () => {
    mockTableData.quiz_answers = { data: null, error: null };
    await upsertAnswer({ quizId: 'qz1', roundIdx: 0, qIdx: 0, answerKey: 't:tm_1', value: 'garbage' });
    const call = calls.find(c => c.table === 'quiz_answers' && c.method === 'upsert');
    expect(call.args[0][0].value).toEqual([]);
  });
});

describe('fetchAnswersForSlide / fetchOwnAnswer', () => {
  it('fetchAnswersForSlide maps every row for the given slide', async () => {
    mockTableData.quiz_answers = {
      data: [
        { quiz_id: 'qz1', round_idx: 0, q_idx: 0, answer_key: 't:tm_1', value: [1], updated_at: '2026-08-25T00:00:00Z' },
        { quiz_id: 'qz1', round_idx: 0, q_idx: 0, answer_key: 'p:doom', value: [2], updated_at: '2026-08-25T00:00:01Z' },
      ],
      error: null,
    };
    const res = await fetchAnswersForSlide('qz1', 0, 0);
    expect(res.ok).toBe(true);
    expect(res.answers).toHaveLength(2);
    expect(res.answers[0]).toEqual({ quizId: 'qz1', roundIdx: 0, qIdx: 0, answerKey: 't:tm_1', value: [1], updatedAt: '2026-08-25T00:00:00Z' });
  });

  it('fetchAnswersForSlide degrades to [] on error', async () => {
    mockTableData.quiz_answers = { data: null, error: { message: 'boom' } };
    const res = await fetchAnswersForSlide('qz1', 0, 0);
    expect(res.ok).toBe(false);
    expect(res.answers).toEqual([]);
  });

  it('fetchOwnAnswer returns null (not an error) when the participant has not answered yet', async () => {
    mockTableData.quiz_answers = { data: [], error: null };
    const res = await fetchOwnAnswer('qz1', 0, 0, 't:tm_1');
    expect(res.ok).toBe(true);
    expect(res.answer).toBeNull();
  });

  it('fetchOwnAnswer maps the one row for this key', async () => {
    mockTableData.quiz_answers = { data: [{ quiz_id: 'qz1', round_idx: 0, q_idx: 0, answer_key: 't:tm_1', value: [1], updated_at: 'x' }], error: null };
    const res = await fetchOwnAnswer('qz1', 0, 0, 't:tm_1');
    expect(res.answer.value).toEqual([1]);
  });

  it('a malformed `value` column (not an array) coerces to [] rather than throwing', async () => {
    mockTableData.quiz_answers = { data: [{ quiz_id: 'qz1', round_idx: 0, q_idx: 0, answer_key: 't:tm_1', value: 'garbage' }], error: null };
    const res = await fetchAnswersForSlide('qz1', 0, 0);
    expect(res.answers[0].value).toEqual([]);
  });
});

describe('deleteAnswersForQuiz', () => {
  it('reports failure on a Supabase error', async () => {
    mockTableData.quiz_answers = { data: null, error: { message: 'nope' } };
    const res = await deleteAnswersForQuiz('qz1');
    expect(res.ok).toBe(false);
  });

  it('succeeds when the delete resolves cleanly', async () => {
    mockTableData.quiz_answers = { data: null, error: null };
    const res = await deleteAnswersForQuiz('qz1');
    expect(res.ok).toBe(true);
  });
});

describe('subscribeAnswers', () => {
  it('registers INSERT and UPDATE handlers scoped to the quiz id (no DELETE, no per-slide filter)', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeAnswers('qz1', onChange);
    const { handlers } = mockChannelCalls[0];
    expect(handlers.some(h => h.filter.event === 'INSERT' && h.filter.filter === 'quiz_id=eq.qz1')).toBe(true);
    expect(handlers.some(h => h.filter.event === 'UPDATE' && h.filter.filter === 'quiz_id=eq.qz1')).toBe(true);
    expect(handlers.some(h => h.filter.event === 'DELETE')).toBe(false);

    handlers.find(h => h.filter.event === 'INSERT').cb({ new: { quiz_id: 'qz1', round_idx: 0, q_idx: 0, answer_key: 't:tm_1', value: [1] } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ answerKey: 't:tm_1' }));

    expect(() => { unsubscribe(); unsubscribe(); }).not.toThrow();
  });
});
