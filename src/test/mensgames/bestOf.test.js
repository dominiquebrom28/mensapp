import { describe, it, expect } from 'vitest';
import bestOf from '../../features/mensgames/scoring/best-of.js';

function match(overrides = {}) {
  return { id: 'mt_1', aId: 'ent_a', bId: 'ent_b', entry: { a: {}, b: {} }, ...overrides };
}

const config = { sets: 3 };

describe('best-of.resolve', () => {
  it('a wins 2-0', () => {
    const r = bestOf.resolve(match({ entry: { a: { sets: 2 }, b: { sets: 0 } } }), config);
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: '2–0' });
  });

  it('is incomplete before either side reaches the majority', () => {
    const r = bestOf.resolve(match({ entry: { a: { sets: 1 }, b: { sets: 1 } } }), config);
    expect(r.complete).toBe(false);
  });

  it('0-0 is incomplete (no sets played yet)', () => {
    const r = bestOf.resolve(match({ entry: { a: { sets: 0 }, b: { sets: 0 } } }), config);
    expect(r).toEqual({ winnerId: null, complete: false, label: '0–0' });
  });

  it('bye auto-wins for the a-side', () => {
    const r = bestOf.resolve(match({ bId: null }), config);
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: 'bye' });
  });

  it('clamps an out-of-range sets value instead of throwing', () => {
    const r = bestOf.resolve(match({ entry: { a: { sets: 99 }, b: { sets: 0 } } }), config);
    expect(r.winnerId).toBe('ent_a');
    expect(r.label).toBe('3–0'); // clamped to config.sets
  });

  it('NaN entry defaults to 0, never throws', () => {
    const r = bestOf.resolve(match({ entry: { a: { sets: 'nope' }, b: { sets: 2 } } }), config);
    expect(r.winnerId).toBe('ent_b');
  });

  it('resolves deterministically (no draw) when malformed data lets both sides reach the threshold', () => {
    // config.sets=4 -> threshold=3; both hitting 3 simultaneously is only
    // reachable via a hand-edited/corrupted entry, not real play.
    const r = bestOf.resolve(match({ entry: { a: { sets: 3 }, b: { sets: 3 } } }), { sets: 4 });
    expect(r.complete).toBe(false); // equal — can't award a winner, no draws allowed
    expect(r.winnerId).toBeNull();
  });

  it('unequal-but-both-past-threshold resolves to the higher score, not incomplete', () => {
    const r = bestOf.resolve(match({ entry: { a: { sets: 3 }, b: { sets: 4 } } }), { sets: 4 });
    expect(r).toEqual({ winnerId: 'ent_b', complete: true, label: '3–4' });
  });
});

describe('best-of.validate', () => {
  it('rejects more sets than the config allows (spec example)', () => {
    expect(bestOf.validate({ sets: 5 }, { sets: 3 })).toBe('Meer sets dan mogelijk');
  });

  it('accepts a value at the max', () => {
    expect(bestOf.validate({ sets: 3 }, { sets: 3 })).toBeNull();
  });

  it('rejects NaN and negative values', () => {
    expect(bestOf.validate({ sets: 'x' }, config)).toMatch(/Ongeldig/);
    expect(bestOf.validate({ sets: -1 }, config)).toMatch(/negatief/);
  });
});

describe('best-of.rank', () => {
  it('ranks by match wins across a round-robin', () => {
    const round = {
      entrantIds: ['a', 'b', 'c'],
      matches: [
        match({ id: 'm1', aId: 'a', bId: 'b', entry: { a: { sets: 2 }, b: { sets: 0 } } }),
        match({ id: 'm2', aId: 'a', bId: 'c', entry: { a: { sets: 2 }, b: { sets: 1 } } }),
        match({ id: 'm3', aId: 'b', bId: 'c', entry: { a: { sets: 1 }, b: { sets: 2 } } }),
      ],
    };
    const ranking = bestOf.rank(round, config);
    expect(ranking.find((e) => e.entrantId === 'a')).toMatchObject({ value: 2, rank: 1 });
    expect(ranking.find((e) => e.entrantId === 'c')).toMatchObject({ value: 1, rank: 2 });
    expect(ranking.find((e) => e.entrantId === 'b')).toMatchObject({ value: 0, rank: 3 });
  });

  it('an incomplete match contributes no win to either side', () => {
    const round = {
      entrantIds: ['a', 'b'],
      matches: [match({ entry: { a: { sets: 1 }, b: { sets: 1 } } })],
    };
    const ranking = bestOf.rank(round, config);
    expect(ranking.every((e) => e.value === 0)).toBe(true);
  });

  it('a bye counts neither as a win nor a loss in the round tally', () => {
    const round = { entrantIds: ['a', 'b'], matches: [match({ bId: null })] };
    const ranking = bestOf.rank(round, config);
    expect(ranking.every((e) => e.value === 0)).toBe(true);
  });
});
