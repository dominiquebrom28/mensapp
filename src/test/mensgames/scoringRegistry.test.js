import { describe, it, expect } from 'vitest';
import { SCORING_TYPES, getScoringType, listScoringTypes } from '../../features/mensgames/scoring/index.js';

const EXPECTED_IDS = ['manual', 'simple-points', 'best-of', 'first-to', 'race-time', 'goal-diff', 'quiz-linked'];

describe('scoring registry', () => {
  it('ships exactly the seven types the spec commits to', () => {
    expect(Object.keys(SCORING_TYPES).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('every plugin implements the full §4.3 interface', () => {
    listScoringTypes().forEach((type) => {
      expect(typeof type.id).toBe('string');
      expect(typeof type.label).toBe('string');
      expect(typeof type.icon).toBe('string');
      expect(Array.isArray(type.appliesTo)).toBe(true);
      expect(type.appliesTo.length).toBeGreaterThan(0);
      expect(Array.isArray(type.configFields)).toBe(true);
      expect(typeof type.blankEntry).toBe('function');
      expect(typeof type.entryFields).toBe('function');
      expect(typeof type.validate).toBe('function');
      expect(typeof type.resolve).toBe('function');
      expect(typeof type.rank).toBe('function');
    });
  });

  it('listScoringTypes returns every registered plugin', () => {
    expect(listScoringTypes().map((t) => t.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });
});

describe('getScoringType — the hard forward-compatibility requirement', () => {
  it('returns the exact plugin for a known id', () => {
    expect(getScoringType('best-of').id).toBe('best-of');
  });

  it('falls back to manual for an id from a future/unknown scoring type', () => {
    expect(getScoringType('some-future-sport-v9').id).toBe('manual');
  });

  it('falls back to manual for null, undefined, empty string, and non-string ids', () => {
    expect(getScoringType(null).id).toBe('manual');
    expect(getScoringType(undefined).id).toBe('manual');
    expect(getScoringType('').id).toBe('manual');
    expect(getScoringType(42).id).toBe('manual');
    expect(getScoringType({}).id).toBe('manual');
  });

  it('the manual fallback never throws when asked to rank/resolve an unrelated round shape', () => {
    const type = getScoringType('unknown-id');
    const round = { entrantIds: ['a', 'b'], format: 'quiz', matches: [], source: {} };
    expect(() => type.rank(round, {})).not.toThrow();
    expect(() => type.resolve({ aId: 'a', bId: 'b' }, {})).not.toThrow();
  });
});
