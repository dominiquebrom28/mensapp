import { describe, it, expect } from 'vitest';
import quizLinked from '../../features/mensgames/scoring/quiz-linked.js';

describe('quiz-linked.resolve', () => {
  it('never resolves a match — quiz rounds have no matches', () => {
    expect(quizLinked.resolve()).toEqual({ winnerId: null, complete: false, label: '—' });
  });
});

describe('quiz-linked.validate', () => {
  it('is always valid — there is no per-side entry to edit', () => {
    expect(quizLinked.validate({})).toBeNull();
    expect(quizLinked.validate(null)).toBeNull();
  });
});

describe('quiz-linked.rank', () => {
  it('sums mapped raw scores per entrant, higher first', () => {
    const round = {
      entrantIds: ['ent_1', 'ent_2'],
      format: 'quiz',
      source: {
        raw: { 'Team Alfa': 300, 'Team Beta': 120 },
        nameMap: { 'Team Alfa': 'ent_1', 'Team Beta': 'ent_2' },
      },
    };
    const ranking = quizLinked.rank(round);
    expect(ranking.find((e) => e.entrantId === 'ent_1')).toMatchObject({ value: 300, rank: 1 });
    expect(ranking.find((e) => e.entrantId === 'ent_2')).toMatchObject({ value: 120, rank: 2 });
  });

  it('an unmapped (unmatched) name contributes nothing — never guessed', () => {
    const round = {
      entrantIds: ['ent_1', 'ent_2'],
      source: { raw: { 'Team Alfa': 300, 'Typo Name': 999 }, nameMap: { 'Team Alfa': 'ent_1' } },
    };
    const ranking = quizLinked.rank(round);
    expect(ranking.find((e) => e.entrantId === 'ent_1').value).toBe(300);
    expect(ranking.find((e) => e.entrantId === 'ent_2').value).toBe(0);
  });

  it('never throws when source is missing entirely', () => {
    const round = { entrantIds: ['ent_1'], source: null };
    expect(() => quizLinked.rank(round)).not.toThrow();
    expect(quizLinked.rank(round)).toEqual([{ entrantId: 'ent_1', rank: 1, value: 0, label: '0 pt' }]);
  });

  it('never throws on garbage round input', () => {
    expect(quizLinked.rank(null)).toEqual([]);
    expect(quizLinked.rank(undefined)).toEqual([]);
  });
});
