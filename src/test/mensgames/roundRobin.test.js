import { describe, it, expect } from 'vitest';
import { generateRoundRobin, generateRandomPairs } from '../../features/mensgames/model.js';

function pairKey(m) {
  return [m.aId, m.bId].sort().join('|');
}

describe('generateRoundRobin', () => {
  it('generates C(n,2) matches for an even count, everyone plays everyone once', () => {
    const matches = generateRoundRobin(['a', 'b', 'c', 'd'], { now: 1 });
    expect(matches).toHaveLength(6);
    const keys = matches.map(pairKey);
    expect(new Set(keys).size).toBe(6); // no duplicate pairings
  });

  it('generates C(n,2) matches for an odd count too (no byes needed — full combinations)', () => {
    const matches = generateRoundRobin(['a', 'b', 'c'], { now: 1 });
    expect(matches).toHaveLength(3);
    expect(matches.every((m) => m.bId != null)).toBe(true);
  });

  it('never pairs an entrant against itself', () => {
    const matches = generateRoundRobin(['a', 'b', 'c'], { now: 1 });
    expect(matches.every((m) => m.aId !== m.bId)).toBe(true);
  });

  it('dedupes a repeated entrant id defensively', () => {
    const matches = generateRoundRobin(['a', 'a', 'b'], { now: 1 });
    expect(matches).toHaveLength(1);
  });

  it('produces unique match ids for every generated match', () => {
    const matches = generateRoundRobin(['a', 'b', 'c', 'd', 'e'], { now: 1 });
    expect(new Set(matches.map((m) => m.id)).size).toBe(matches.length);
  });

  it('0 or 1 entrants produces no matches, never throws', () => {
    expect(generateRoundRobin([])).toEqual([]);
    expect(generateRoundRobin(['solo'])).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(generateRoundRobin(null)).toEqual([]);
    expect(generateRoundRobin(['a', 42, null, 'b'], { now: 1 })).toHaveLength(1);
  });

  it('is deterministic for the same input', () => {
    const a = generateRoundRobin(['a', 'b', 'c'], { now: 7 });
    const b = generateRoundRobin(['a', 'b', 'c'], { now: 7 });
    expect(a).toEqual(b);
  });
});

describe('generateRandomPairs', () => {
  it('pairs every entrant exactly once for an even count', () => {
    const matches = generateRandomPairs(['a', 'b', 'c', 'd'], { now: 1, rng: () => 0.5 });
    expect(matches).toHaveLength(2);
    const involved = matches.flatMap((m) => [m.aId, m.bId]).sort();
    expect(involved).toEqual(['a', 'b', 'c', 'd']);
    expect(matches.every((m) => m.bId != null)).toBe(true);
  });

  it('gives exactly one entrant a bye for an odd count', () => {
    const matches = generateRandomPairs(['a', 'b', 'c'], { now: 1, rng: () => 0 });
    const byes = matches.filter((m) => m.bId == null);
    expect(byes).toHaveLength(1);
  });

  it('never pairs an entrant against itself', () => {
    const matches = generateRandomPairs(['a', 'b', 'c', 'd', 'e', 'f'], { now: 1, rng: () => 0.99 });
    expect(matches.every((m) => m.aId !== m.bId)).toBe(true);
  });

  it('never produces duplicate matches', () => {
    const matches = generateRandomPairs(['a', 'b', 'c', 'd'], { now: 1, rng: () => 0.3 });
    expect(new Set(matches.map(pairKey)).size).toBe(matches.length);
  });

  it('is deterministic given the same injected rng', () => {
    const rngValues = [0.9, 0.1, 0.5, 0.2];
    let i = 0;
    const rng = () => rngValues[i++ % rngValues.length];
    const a = generateRandomPairs(['a', 'b', 'c', 'd'], { now: 1, rng });
    i = 0;
    const b = generateRandomPairs(['a', 'b', 'c', 'd'], { now: 1, rng });
    expect(a).toEqual(b);
  });

  it('dedupes a repeated entrant id defensively', () => {
    const matches = generateRandomPairs(['a', 'a', 'b'], { now: 1, rng: () => 0 });
    const involved = matches.flatMap((m) => [m.aId, m.bId]).filter(Boolean).sort();
    expect(involved).toEqual(['a', 'b']);
  });

  it('0 or 1 entrants produces no matches, never throws', () => {
    expect(generateRandomPairs([])).toEqual([]);
    expect(generateRandomPairs(['solo'])).toHaveLength(1);
    expect(generateRandomPairs(['solo'])[0].bId).toBeNull();
  });

  it('never throws on malformed input', () => {
    expect(generateRandomPairs(null)).toEqual([]);
    expect(() => generateRandomPairs(['a', 'b'], { now: 1, rng: undefined })).not.toThrow();
  });
});
