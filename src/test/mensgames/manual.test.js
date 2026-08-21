import { describe, it, expect } from 'vitest';
import manual from '../../features/mensgames/scoring/manual.js';

function match(overrides = {}) {
  return { id: 'mt_1', aId: 'ent_a', bId: 'ent_b', entry: { a: {}, b: {} }, winnerId: null, ...overrides };
}

describe('manual.resolve', () => {
  it('auto-wins a bye for the a-side', () => {
    const r = manual.resolve(match({ bId: null }));
    expect(r).toEqual({ winnerId: 'ent_a', complete: true, label: 'bye' });
  });

  it('is incomplete until the admin sets winnerId', () => {
    const r = manual.resolve(match());
    expect(r.complete).toBe(false);
    expect(r.winnerId).toBeNull();
  });

  it('echoes an explicit winner pick', () => {
    const r = manual.resolve(match({ winnerId: 'ent_b' }));
    expect(r).toEqual({ winnerId: 'ent_b', complete: true, label: '—' });
  });

  it('accepts an explicit draw pick', () => {
    const r = manual.resolve(match({ winnerId: 'draw' }));
    expect(r.complete).toBe(true);
    expect(r.winnerId).toBe('draw');
  });

  it('ignores a winnerId that names neither side (malformed data)', () => {
    const r = manual.resolve(match({ winnerId: 'ent_z' }));
    expect(r.complete).toBe(false);
    expect(r.winnerId).toBeNull();
  });

  it('never throws on a garbage match', () => {
    expect(manual.resolve(null)).toEqual({ winnerId: null, complete: false, label: '–' });
    expect(manual.resolve(undefined)).toEqual({ winnerId: null, complete: false, label: '–' });
    // `{}` has no bId, which the bye check (`bId == null`) treats as a bye --
    // with no aId either, that bye can't be awarded to anyone, but it must
    // still not throw.
    expect(manual.resolve({})).toEqual({ winnerId: null, complete: false, label: 'bye' });
  });
});

describe('manual.validate', () => {
  it('is always valid — there is nothing to validate', () => {
    expect(manual.validate({})).toBeNull();
    expect(manual.validate(null)).toBeNull();
    expect(manual.validate(undefined)).toBeNull();
  });
});

describe('manual.rank — matches format', () => {
  it('tallies match wins, most wins first', () => {
    const round = {
      entrantIds: ['a', 'b', 'c'],
      matches: [
        match({ id: 'm1', aId: 'a', bId: 'b', winnerId: 'a' }),
        match({ id: 'm2', aId: 'a', bId: 'c', winnerId: 'a' }),
        match({ id: 'm3', aId: 'b', bId: 'c', winnerId: 'draw' }),
      ],
    };
    const ranking = manual.rank(round);
    expect(ranking.find((e) => e.entrantId === 'a')).toMatchObject({ rank: 1, value: 2 });
    expect(ranking.find((e) => e.entrantId === 'b')).toMatchObject({ rank: 2, value: 0, draws: 1 });
    expect(ranking.find((e) => e.entrantId === 'c')).toMatchObject({ rank: 2, value: 0, draws: 1 });
  });

  it('gives every entrant a row even with zero matches played (no matches, no freeform: terminal fallback)', () => {
    const round = { entrantIds: ['a', 'b'], matches: [] };
    const ranking = manual.rank(round);
    expect(ranking).toEqual([
      { entrantId: 'a', rank: 1, value: 0, label: '0' },
      { entrantId: 'b', rank: 1, value: 0, label: '0' },
    ]);
  });

  it('tallies wins/draws (with a "W"/"D" label) once at least one match exists', () => {
    const round = {
      entrantIds: ['a', 'b'],
      matches: [match({ id: 'm1', aId: 'a', bId: 'b', winnerId: 'a' })],
    };
    const ranking = manual.rank(round);
    expect(ranking.find((e) => e.entrantId === 'a')).toMatchObject({ rank: 1, value: 1, label: '1W', wins: 1, draws: 0 });
    expect(ranking.find((e) => e.entrantId === 'b')).toMatchObject({ rank: 2, value: 0, label: '0W', wins: 0, draws: 0 });
  });

  it('does not throw on a match referencing an id outside entrantIds', () => {
    const round = {
      entrantIds: ['a', 'b'],
      matches: [match({ aId: 'a', bId: 'ghost', winnerId: 'a' })],
    };
    expect(() => manual.rank(round)).not.toThrow();
  });
});

describe('manual.rank — freeform fallback (degraded future scoring type)', () => {
  it('ranks by freeform entry value when there are no matches', () => {
    const round = {
      entrantIds: ['a', 'b'],
      matches: [],
      freeform: { entries: { a: { value: 5 }, b: { value: 9 } } },
    };
    const ranking = manual.rank(round);
    expect(ranking.find((e) => e.entrantId === 'b').rank).toBe(1);
    expect(ranking.find((e) => e.entrantId === 'a').rank).toBe(2);
  });

  it('treats a missing/NaN freeform value as 0, never throws', () => {
    const round = {
      entrantIds: ['a', 'b'],
      matches: [],
      freeform: { entries: { a: { value: 'not-a-number' } } },
    };
    expect(() => manual.rank(round)).not.toThrow();
    const ranking = manual.rank(round);
    expect(ranking.find((e) => e.entrantId === 'a').value).toBe(0);
    expect(ranking.find((e) => e.entrantId === 'b').value).toBe(0);
  });
});

describe('manual.rank — quiz format (no matches, no freeform)', () => {
  it('never throws, returns every entrant tied at 0', () => {
    const round = { entrantIds: ['a', 'b'], format: 'quiz', matches: [], source: { raw: {}, nameMap: {} } };
    expect(() => manual.rank(round)).not.toThrow();
    expect(manual.rank(round).every((e) => e.value === 0 && e.rank === 1)).toBe(true);
  });
});

describe('manual.rank — malformed round input', () => {
  it('never throws on null/undefined/garbage', () => {
    expect(manual.rank(null)).toEqual([]);
    expect(manual.rank(undefined)).toEqual([]);
    expect(manual.rank('nope')).toEqual([]);
  });
});
