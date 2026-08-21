import { describe, it, expect } from 'vitest';
import firstTo from '../../features/mensgames/scoring/first-to.js';

function match(overrides = {}) {
  return { id: 'mt_1', aId: 'ent_a', bId: 'ent_b', entry: { a: {}, b: {} }, ...overrides };
}

const config = { target: 5 };

describe('first-to.resolve', () => {
  it('a wins on reaching the target first (higher score at rest)', () => {
    const r = firstTo.resolve(match({ entry: { a: { score: 5 }, b: { score: 3 } } }), config);
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: '5–3' });
  });

  it('0-0 is incomplete', () => {
    const r = firstTo.resolve(match({ entry: { a: { score: 0 }, b: { score: 0 } } }), config);
    expect(r.complete).toBe(false);
  });

  it('bye auto-wins for the a-side', () => {
    const r = firstTo.resolve(match({ bId: null }), config);
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: 'bye' });
  });

  it('clamps scores above target, never throws', () => {
    const r = firstTo.resolve(match({ entry: { a: { score: 999 }, b: { score: 1 } } }), config);
    expect(r.label).toBe('5–1');
  });

  it('missing entries default to 0', () => {
    const r = firstTo.resolve(match({ entry: {} }), config);
    expect(r.complete).toBe(false);
  });

  it('resolves deterministically, no draw, if both hit target (malformed data)', () => {
    const r = firstTo.resolve(match({ entry: { a: { score: 5 }, b: { score: 5 } } }), config);
    expect(r.complete).toBe(false);
    expect(r.winnerId).toBeNull();
  });
});

describe('first-to.validate', () => {
  it('rejects a score above the target', () => {
    expect(firstTo.validate({ score: 6 }, config)).toBe('Meer punten dan mogelijk');
  });
  it('rejects NaN and negative', () => {
    expect(firstTo.validate({ score: NaN }, config)).toMatch(/Ongeldige/);
    expect(firstTo.validate({ score: -3 }, config)).toMatch(/negatief/);
  });
});

describe('first-to.rank', () => {
  it('ranks by match wins', () => {
    const round = {
      entrantIds: ['ent_a', 'ent_b', 'ent_c'],
      matches: [
        match({ id: 'm1', aId: 'ent_a', bId: 'ent_b', entry: { a: { score: 5 }, b: { score: 2 } } }),
        match({ id: 'm2', aId: 'ent_a', bId: 'ent_c', entry: { a: { score: 4 }, b: { score: 5 } } }),
      ],
    };
    const ranking = firstTo.rank(round, config);
    expect(ranking.find((e) => e.entrantId === 'ent_a')).toMatchObject({ value: 1, rank: 1 });
    expect(ranking.find((e) => e.entrantId === 'ent_c')).toMatchObject({ value: 1, rank: 1 });
    expect(ranking.find((e) => e.entrantId === 'ent_b')).toMatchObject({ value: 0, rank: 3 });
  });
});
