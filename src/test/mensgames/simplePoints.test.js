import { describe, it, expect } from 'vitest';
import simplePoints from '../../features/mensgames/scoring/simple-points.js';

function match(overrides = {}) {
  return { id: 'mt_1', aId: 'ent_a', bId: 'ent_b', entry: { a: {}, b: {} }, ...overrides };
}

describe('simple-points.resolve', () => {
  it('a wins on higher points', () => {
    const r = simplePoints.resolve(match({ entry: { a: { points: 5 }, b: { points: 2 } } }));
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: '5–2' });
  });

  it('0-0 is a complete draw, not "incomplete"', () => {
    const r = simplePoints.resolve(match({ entry: { a: { points: 0 }, b: { points: 0 } } }));
    expect(r).toEqual({ winnerId: 'draw', complete: true, label: '0–0' });
  });

  it('equal non-zero points is also a draw', () => {
    const r = simplePoints.resolve(match({ entry: { a: { points: 3 }, b: { points: 3 } } }));
    expect(r.winnerId).toBe('draw');
  });

  it('a bye auto-wins for the a-side regardless of entry', () => {
    const r = simplePoints.resolve(match({ bId: null }));
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: 'bye' });
  });

  it('missing entry fields default to 0, never throws', () => {
    const r = simplePoints.resolve(match({ entry: {} }));
    expect(r).toEqual({ winnerId: 'draw', complete: true, label: '0–0' });
  });

  it('NaN entry values are treated as 0', () => {
    const r = simplePoints.resolve(match({ entry: { a: { points: 'not-a-number' }, b: { points: 4 } } }));
    expect(r).toEqual({ winnerId: 'ent_b', complete: true, label: '0–4' });
  });

  it('never throws on a garbage match', () => {
    expect(() => simplePoints.resolve(null)).not.toThrow();
    expect(simplePoints.resolve(null).complete).toBe(false);
  });
});

describe('simple-points.validate', () => {
  it('accepts 0 and positive finite numbers', () => {
    expect(simplePoints.validate({ points: 0 })).toBeNull();
    expect(simplePoints.validate({ points: 42 })).toBeNull();
  });

  it('rejects NaN', () => {
    expect(simplePoints.validate({ points: 'abc' })).toMatch(/Ongeldig/);
  });

  it('rejects negative values', () => {
    expect(simplePoints.validate({ points: -1 })).toMatch(/negatief/);
  });

  it('rejects values above the cap', () => {
    expect(simplePoints.validate({ points: 1_000_000 })).toMatch(/Te veel/);
  });
});

describe('simple-points.rank', () => {
  it('ranks entrants by total points summed across their matches', () => {
    const round = {
      entrantIds: ['a', 'b', 'c'],
      matches: [
        match({ aId: 'a', bId: 'b', entry: { a: { points: 5 }, b: { points: 2 } } }),
        match({ aId: 'a', bId: 'c', entry: { a: { points: 3 }, b: { points: 3 } } }),
      ],
    };
    const ranking = simplePoints.rank(round);
    expect(ranking.find((e) => e.entrantId === 'a')).toMatchObject({ value: 8, rank: 1 });
    expect(ranking.find((e) => e.entrantId === 'c')).toMatchObject({ value: 3, rank: 2 });
    expect(ranking.find((e) => e.entrantId === 'b')).toMatchObject({ value: 2, rank: 3 });
  });

  it('ties share the same rank', () => {
    const round = {
      entrantIds: ['a', 'b'],
      matches: [match({ aId: 'a', bId: 'b', entry: { a: { points: 4 }, b: { points: 4 } } })],
    };
    const ranking = simplePoints.rank(round);
    expect(ranking.every((e) => e.rank === 1)).toBe(true);
  });

  it('never throws on a malformed round', () => {
    expect(simplePoints.rank(null)).toEqual([]);
    expect(() => simplePoints.rank({ entrantIds: ['a'], matches: 'not-an-array' })).not.toThrow();
  });
});
