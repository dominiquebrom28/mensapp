import { describe, it, expect } from 'vitest';
import raceTime from '../../features/mensgames/scoring/race-time.js';

function match(overrides = {}) {
  return { id: 'mt_1', aId: 'ent_a', bId: 'ent_b', entry: { a: {}, b: {} }, ...overrides };
}

describe('race-time.resolve (lower wins)', () => {
  it('the faster (lower) time wins', () => {
    const r = raceTime.resolve(match({ entry: { a: { seconds: 30 }, b: { seconds: 45 } } }));
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: '30s–45s' });
  });

  it('a dead heat is a draw', () => {
    const r = raceTime.resolve(match({ entry: { a: { seconds: 30 }, b: { seconds: 30 } } }));
    expect(r.winnerId).toBe('draw');
    expect(r.complete).toBe(true);
  });

  it('is incomplete while a time is unset (null)', () => {
    const r = raceTime.resolve(match({ entry: { a: { seconds: null }, b: { seconds: 12 } } }));
    expect(r.complete).toBe(false);
  });

  it('missing entries (no seconds key at all) are also incomplete, not thrown', () => {
    const r = raceTime.resolve(match({ entry: {} }));
    expect(r.complete).toBe(false);
  });

  it('NaN time is treated as unset, not 0', () => {
    const r = raceTime.resolve(match({ entry: { a: { seconds: 'nope' }, b: { seconds: 12 } } }));
    expect(r.complete).toBe(false);
  });

  it('a bye auto-wins for the a-side', () => {
    const r = raceTime.resolve(match({ bId: null }));
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: 'bye' });
  });
});

describe('race-time.validate', () => {
  it('null/undefined/empty (not run yet) is valid', () => {
    expect(raceTime.validate({ seconds: null })).toBeNull();
    expect(raceTime.validate({})).toBeNull();
  });
  it('rejects negative and NaN', () => {
    expect(raceTime.validate({ seconds: -1 })).toMatch(/negatief/);
    expect(raceTime.validate({ seconds: 'x' })).toMatch(/Ongeldige/);
  });
});

describe('race-time.rank — matches format (tallies wins like best-of)', () => {
  it('ranks the faster entrant first', () => {
    const round = {
      format: 'matches',
      entrantIds: ['a', 'b'],
      matches: [match({ entry: { a: { seconds: 10 }, b: { seconds: 20 } } })],
    };
    const ranking = raceTime.rank(round);
    expect(ranking.find((e) => e.entrantId === 'a').rank).toBe(1);
  });
});

describe('race-time.rank — freeform format (individual times against the clock)', () => {
  it('ranks ascending by raw time, fastest first', () => {
    const round = {
      format: 'freeform',
      entrantIds: ['a', 'b', 'c'],
      freeform: { entries: { a: { value: 42 }, b: { value: 30 }, c: { value: 55 } } },
    };
    const ranking = raceTime.rank(round);
    expect(ranking.map((e) => e.entrantId)).toEqual(['b', 'a', 'c']);
  });

  it('an entrant with no submitted time ranks last, never throws', () => {
    const round = {
      format: 'freeform',
      entrantIds: ['a', 'b'],
      freeform: { entries: { a: { value: 10 } } },
    };
    const ranking = raceTime.rank(round);
    expect(ranking[0].entrantId).toBe('a');
    expect(ranking[1]).toMatchObject({ entrantId: 'b', label: '–' });
  });
});
