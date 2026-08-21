import { describe, it, expect } from 'vitest';
import goalDiff from '../../features/mensgames/scoring/goal-diff.js';

function match(overrides = {}) {
  return { id: 'mt_1', aId: 'ent_a', bId: 'ent_b', entry: { a: {}, b: {} }, ...overrides };
}

describe('goal-diff.resolve', () => {
  it('0-0 is a complete draw', () => {
    const r = goalDiff.resolve(match({ entry: { a: { goals: 0 }, b: { goals: 0 } } }));
    expect(r).toEqual({ winnerId: 'draw', complete: true, label: '0–0' });
  });

  it('more goals wins', () => {
    const r = goalDiff.resolve(match({ entry: { a: { goals: 3 }, b: { goals: 1 } } }));
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: '3–1' });
  });

  it('a bye auto-wins for the a-side', () => {
    const r = goalDiff.resolve(match({ bId: null }));
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: 'bye' });
  });

  it('missing/NaN entries default to 0, never throws', () => {
    const r = goalDiff.resolve(match({ entry: { a: {}, b: { goals: 'x' } } }));
    expect(r).toEqual({ winnerId: 'draw', complete: true, label: '0–0' });
  });
});

describe('goal-diff.validate', () => {
  it('rejects negative and NaN and over-cap goals', () => {
    expect(goalDiff.validate({ goals: -1 })).toMatch(/negatief/);
    expect(goalDiff.validate({ goals: 'x' })).toMatch(/Ongeldig/);
    expect(goalDiff.validate({ goals: 10_000 })).toMatch(/Te veel/);
  });
  it('accepts 0', () => {
    expect(goalDiff.validate({ goals: 0 })).toBeNull();
  });
});

describe('goal-diff.rank', () => {
  it('ranks by league points: win=3, draw=1, loss=0', () => {
    const round = {
      entrantIds: ['a', 'b', 'c'],
      matches: [
        match({ id: 'm1', aId: 'a', bId: 'b', entry: { a: { goals: 2 }, b: { goals: 0 } } }),
        match({ id: 'm2', aId: 'a', bId: 'c', entry: { a: { goals: 1 }, b: { goals: 1 } } }),
        match({ id: 'm3', aId: 'b', bId: 'c', entry: { a: { goals: 0 }, b: { goals: 0 } } }),
      ],
    };
    const ranking = goalDiff.rank(round);
    // a: win(3) + draw(1) = 4 pts; b: loss(0) + draw(1) = 1; c: draw(1)+draw(1) = 2
    expect(ranking.find((e) => e.entrantId === 'a')).toMatchObject({ value: 4, rank: 1 });
    expect(ranking.find((e) => e.entrantId === 'c')).toMatchObject({ value: 2, rank: 2 });
    expect(ranking.find((e) => e.entrantId === 'b')).toMatchObject({ value: 1, rank: 3 });
  });

  it('breaks an equal-points tie by goal difference', () => {
    // a and b each have exactly one win (3 pts each) against c, but a's
    // margin is bigger -- a should rank above b purely on goal difference.
    const round = {
      entrantIds: ['a', 'b', 'c'],
      matches: [
        match({ id: 'm1', aId: 'a', bId: 'c', entry: { a: { goals: 5 }, b: { goals: 0 } } }),
        match({ id: 'm2', aId: 'b', bId: 'c', entry: { a: { goals: 1 }, b: { goals: 0 } } }),
      ],
    };
    const ranking = goalDiff.rank(round);
    expect(ranking.find((e) => e.entrantId === 'a')).toMatchObject({ rank: 1, value: 3 });
    expect(ranking.find((e) => e.entrantId === 'b')).toMatchObject({ rank: 2, value: 3 });
  });

  it('identical points, diff and goals-for share the same rank (joint placing)', () => {
    const round = {
      entrantIds: ['a', 'b'],
      matches: [match({ id: 'm1', aId: 'a', bId: 'b', entry: { a: { goals: 2 }, b: { goals: 2 } } })],
    };
    const ranking = goalDiff.rank(round);
    expect(ranking.every((e) => e.rank === 1)).toBe(true);
  });

  it('never throws on a malformed round', () => {
    expect(goalDiff.rank(null)).toEqual([]);
    expect(() => goalDiff.rank({ entrantIds: ['a'], matches: null })).not.toThrow();
  });
});
