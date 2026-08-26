import { describe, it, expect } from 'vitest';
import { matchQuizNames, pullQuizResults } from '../../features/mensgames/quizRound.js';

describe('matchQuizNames', () => {
  const entrants = [
    { id: 'ent_1', name: 'Team Alfa' },
    { id: 'ent_2', name: 'Team Beta' },
  ];

  it('matches case-insensitively and exactly', () => {
    const { matched, unmatched } = matchQuizNames({ 'team alfa': 300, 'TEAM BETA': 120 }, entrants);
    expect(matched).toEqual([
      { name: 'team alfa', entrantId: 'ent_1', score: 300 },
      { name: 'TEAM BETA', entrantId: 'ent_2', score: 120 },
    ]);
    expect(unmatched).toEqual([]);
  });

  it('does not fuzzy-match — nothing is guessed', () => {
    const { matched, unmatched } = matchQuizNames({ 'Team Alfaa': 50 }, entrants);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([{ name: 'Team Alfaa', score: 50 }]);
  });

  it('surfaces a genuinely unmatched name for the UI dropdown', () => {
    const { unmatched } = matchQuizNames({ 'Random Guy': 10 }, entrants);
    expect(unmatched).toEqual([{ name: 'Random Guy', score: 10 }]);
  });

  it('honours an already-resolved manual pick in nameMap without re-guessing', () => {
    const { matched, unmatched } = matchQuizNames(
      { 'Some Typo': 42 },
      entrants,
      { 'Some Typo': 'ent_2' },
    );
    expect(matched).toEqual([{ name: 'Some Typo', entrantId: 'ent_2', score: 42 }]);
    expect(unmatched).toEqual([]);
  });

  it('ignores a nameMap entry pointing at an entrant that no longer exists', () => {
    const { matched, unmatched } = matchQuizNames(
      { 'Ghost Team': 5 },
      entrants,
      { 'Ghost Team': 'ent_removed' },
    );
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([{ name: 'Ghost Team', score: 5 }]);
  });

  it('coerces a non-numeric score to 0 instead of throwing', () => {
    const { matched } = matchQuizNames({ 'Team Alfa': 'not-a-number' }, entrants);
    expect(matched).toEqual([{ name: 'Team Alfa', entrantId: 'ent_1', score: 0 }]);
  });

  it('never throws on malformed scores/entrants/nameMap', () => {
    expect(matchQuizNames(null, null, null)).toEqual({ matched: [], unmatched: [] });
    expect(matchQuizNames({ a: 1 }, 'garbage', 'garbage')).toEqual({ matched: [], unmatched: [{ name: 'a', score: 1 }] });
  });
});

describe('pullQuizResults', () => {
  // docs/quiz-unification-spec.md §8.4 / §9: WP-Q10 repoints this at a
  // directly-picked quiz object (`mensgames/quizPicker.js` resolves it),
  // not an event to search inside — these cases now pass the quiz itself.
  const round = { id: 'rnd_1', format: 'quiz', source: { type: 'quiz', eventId: 'evt-2026', quizId: 'q1', nameMap: {}, raw: {}, pulledAt: null } };

  it('freezes a snapshot of quiz.scores into source.raw/pulledAt', () => {
    const quiz = { id: 'q1', status: 'finished', scores: { 'Team Alfa': 300 } };
    const result = pullQuizResults(round, quiz, '2026-09-12T20:11:00Z');
    expect(result.source.raw).toEqual({ 'Team Alfa': 300 });
    expect(result.source.pulledAt).toBe('2026-09-12T20:11:00Z');
  });

  it('does not mutate the input round', () => {
    const quiz = { id: 'q1', status: 'finished', scores: { a: 1 } };
    const before = JSON.stringify(round);
    pullQuizResults(round, quiz, 'now');
    expect(JSON.stringify(round)).toBe(before);
  });

  it('a later edit to the live quiz cannot mutate an already-pulled snapshot', () => {
    const scores = { 'Team Alfa': 300 };
    const quiz = { id: 'q1', status: 'finished', scores };
    const pulled = pullQuizResults(round, quiz, 't1');
    scores['Team Alfa'] = 999999; // simulate a later quiz edit on the live object
    expect(pulled.source.raw['Team Alfa']).toBe(300);
  });

  it('returns the round unchanged if the quiz is not finished', () => {
    const quiz = { id: 'q1', status: 'draft', scores: { a: 1 } };
    expect(pullQuizResults(round, quiz, 'now')).toBe(round);
  });

  it('returns the round unchanged if no quiz is passed at all', () => {
    expect(pullQuizResults(round, undefined, 'now')).toBe(round);
    expect(pullQuizResults(round, null, 'now')).toBe(round);
  });

  it('never throws on a round with no source (not a quiz round)', () => {
    expect(pullQuizResults({ id: 'rnd_2' }, { id: 'q1', status: 'finished' }, 'now')).toEqual({ id: 'rnd_2' });
    expect(pullQuizResults(null, { id: 'q1', status: 'finished' }, 'now')).toBeNull();
  });

  it('defaults quiz.scores to {} when the quiz row has none', () => {
    const quiz = { id: 'q1', status: 'finished' };
    const result = pullQuizResults(round, quiz, 'now');
    expect(result.source.raw).toEqual({});
  });

  it('refuses to snapshot a quiz whose id does not match round.source.quizId', () => {
    const quiz = { id: 'some-other-quiz', status: 'finished', scores: { a: 1 } };
    expect(pullQuizResults(round, quiz, 'now')).toBe(round);
  });
});
