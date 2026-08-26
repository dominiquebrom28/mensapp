// Pure-logic coverage for src/features/mensgames/quizPicker.js — WP-Q10,
// docs/quiz-unification-spec.md §8.4, extended by the owner's direct
// request (2026-08-26) to pick a quiz straight from the quiz feature.
// `combineFinishedQuizzes` is the merge rule that has to find all three
// real shapes of finished quiz at once: a `quizzes` table row from the
// one-time migration ("migrated"), a quiz that only ever lived in
// `evt.quizzes[]` and never got a table row ("built-since"), and one
// present in both ("new").
import { describe, it, expect } from 'vitest';
import { combineFinishedQuizzes, combineFinishedQuizzesWithHidden } from '../../features/mensgames/quizPicker.js';

describe('combineFinishedQuizzes', () => {
  it('"migrated": a quiz that only has a quizzes-table row is found', () => {
    const table = [{ id: 'qz_migrated', title: 'Migrated Quiz', eventId: null, status: 'finished', scores: { a: 1 }, settings: {} }];
    const combined = combineFinishedQuizzes([], table);
    expect(combined.map((q) => q.id)).toEqual(['qz_migrated']);
    expect(combined[0].source).toBe('table');
  });

  it('"built-since": a quiz that only lives in evt.quizzes[] (no table row at all) is found', () => {
    const events = [{ id: 'evt-1', name: 'Event', quizzes: [{ id: 'qz_legacy', title: 'Legacy Quiz', status: 'finished', scores: { a: 5 } }] }];
    const combined = combineFinishedQuizzes(events, []);
    expect(combined).toEqual([{
      id: 'qz_legacy', title: 'Legacy Quiz', eventId: 'evt-1', status: 'finished',
      teams: [], scores: { a: 5 }, memberScores: {}, settings: {}, source: 'legacy',
    }]);
  });

  it('"new": a quiz present in both the table and evt.quizzes[] is de-duped, legacy kept', () => {
    const events = [{ id: 'evt-1', quizzes: [{ id: 'qz_both', title: 'Both Places', status: 'finished', scores: { a: 1 } }] }];
    const table = [{ id: 'qz_both', title: 'Both Places (table copy)', eventId: 'evt-1', status: 'finished', scores: { a: 1 }, settings: {} }];
    const combined = combineFinishedQuizzes(events, table);
    expect(combined).toHaveLength(1);
    expect(combined[0].source).toBe('legacy');
  });

  it('finds a standalone quiz (no event at all) from the table', () => {
    const table = [{ id: 'qz_standalone', title: 'Standalone', eventId: null, status: 'finished', scores: {}, settings: {} }];
    expect(combineFinishedQuizzes([], table).map((q) => q.id)).toEqual(['qz_standalone']);
  });

  it('excludes an unfinished legacy quiz', () => {
    const events = [{ id: 'evt-1', quizzes: [{ id: 'qz_draft', status: 'ready', scores: {} }] }];
    expect(combineFinishedQuizzes(events, [])).toEqual([]);
  });

  it('excludes a secret legacy quiz, same as fetchQuizResults does for the table', () => {
    const events = [{ id: 'evt-1', quizzes: [{ id: 'qz_secret', status: 'finished', scores: { a: 1 }, settings: { secret: true } }] }];
    expect(combineFinishedQuizzes(events, [])).toEqual([]);
  });

  it('scans every event, not just the first', () => {
    const events = [
      { id: 'evt-1', quizzes: [{ id: 'qz_1', status: 'finished', scores: {} }] },
      { id: 'evt-2', quizzes: [{ id: 'qz_2', status: 'finished', scores: {} }] },
    ];
    expect(combineFinishedQuizzes(events, []).map((q) => q.id).sort()).toEqual(['qz_1', 'qz_2']);
  });

  it('never throws on malformed events/table input', () => {
    expect(combineFinishedQuizzes(null, null)).toEqual([]);
    expect(combineFinishedQuizzes('garbage', 'garbage')).toEqual([]);
    expect(combineFinishedQuizzes([null, { quizzes: 'garbage' }, { quizzes: [null, {}, { id: '' }] }], [null, {}, { id: '' }])).toEqual([]);
  });

  it('genuinely empty stays empty, distinguishable from a caller by returning []', () => {
    expect(combineFinishedQuizzes([], [])).toEqual([]);
  });
});

// A secret quiz is correctly kept out of the picker. But "withheld" and
// "doesn't exist" look identical in a dropdown, and someone who has just
// marked a quiz secret and then can't find it has no way to tell which
// they're looking at. Same shape as the silent failures that cost this
// project an evening — a query returning [] rather than throwing, an update
// matching zero rows without erroring. So the count comes back and the UI
// explains the gap.
describe('combineFinishedQuizzesWithHidden', () => {
  const evtWith = quizzes => [{ id: 'evt-1', name: 'Mensdag', quizzes }]
  const finished = (id, extra = {}) => ({ id, title: id, status: 'finished', scores: { A: 1 }, ...extra })

  it('still withholds a secret quiz from the list', () => {
    const { quizzes } = combineFinishedQuizzesWithHidden(
      evtWith([finished('qz-open'), finished('qz-secret', { settings: { secret: true } })]), [])
    expect(quizzes.map(q => q.id)).toEqual(['qz-open'])
  })

  it('reports how many it withheld, so the gap can be explained', () => {
    const { hiddenSecret } = combineFinishedQuizzesWithHidden(
      evtWith([finished('a', { settings: { secret: true } }), finished('b', { settings: { secret: true } }), finished('c')]), [])
    expect(hiddenSecret).toBe(2)
  })

  it('counts nothing when nothing is secret', () => {
    expect(combineFinishedQuizzesWithHidden(evtWith([finished('a')]), []).hiddenSecret).toBe(0)
  })

  it('does not count an unfinished secret quiz — it was never a candidate', () => {
    const { hiddenSecret } = combineFinishedQuizzesWithHidden(
      evtWith([{ id: 'x', status: 'ready', settings: { secret: true } }]), [])
    expect(hiddenSecret).toBe(0)
  })

  it('combineFinishedQuizzes still returns a bare array, unchanged for its callers', () => {
    const out = combineFinishedQuizzes(evtWith([finished('a')]), [])
    expect(Array.isArray(out)).toBe(true)
    expect(out.map(q => q.id)).toEqual(['a'])
  })
})
