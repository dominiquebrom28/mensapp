// src/features/quiz/model.js -- pure data model. `normalizeQuiz`,
// `blankQuestion` and the constant arrays are moved out of App.jsx
// verbatim (docs/quiz-unification-spec.md §8.1/§8.3); these assertions are
// the ones `helpers.pure.test.js` used to make by slicing/eval'ing source
// text, now made against a real import instead.
import { describe, it, expect } from 'vitest';
import {
  ALPHA,
  ROUND_ICONS,
  TEAM_AVATARS,
  TYPE_META,
  blankQuestion,
  blankQuiz,
  fmtTime,
  normalizeQuiz,
  resolveQuizWinner,
  teamStableId,
  teamsFromTeamSet,
} from '../../features/quiz/model.js';

describe('constants', () => {
  it('ALPHA has one letter per multiple-choice option slot, A-H', () => {
    expect(ALPHA).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('TEAM_AVATARS and ROUND_ICONS are non-empty emoji pools', () => {
    expect(TEAM_AVATARS.length).toBeGreaterThan(0);
    expect(ROUND_ICONS.length).toBeGreaterThan(0);
  });

  it('TYPE_META covers every question type blankQuestion can produce', () => {
    expect(Object.keys(TYPE_META).sort()).toEqual(['multiple', 'music', 'open']);
  });

  it('fmtTime pads seconds to two digits, mm:ss', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(65)).toBe('1:05');
    expect(fmtTime(600)).toBe('10:00');
  });
});

describe('blankQuestion', () => {
  it('defaults to a multiple-choice question with 4 empty options', () => {
    const q = blankQuestion();
    expect(q.type).toBe('multiple');
    expect(q.options).toEqual(['', '', '', '']);
    expect(q.answer).toEqual([0]);
    expect(q.points).toBe(10);
  });

  it('honours an explicit type', () => {
    expect(blankQuestion('open').type).toBe('open');
    expect(blankQuestion('music').songPlaySeconds).toBe(30);
  });
});

describe('blankQuiz', () => {
  it('builds a ready quiz with one round and one question, id derived from `now`', () => {
    const q = blankQuiz({ title: 'Pubquiz 12', eventId: 'evt-1', createdBy: 'Doom', now: 1000 });
    expect(q.id).toBe('qz1000');
    expect(q.title).toBe('Pubquiz 12');
    expect(q.eventId).toBe('evt-1');
    expect(q.status).toBe('ready');
    expect(q.rounds).toHaveLength(1);
    expect(q.rounds[0].questions).toHaveLength(1);
    expect(q.teams).toEqual([]);
    expect(q.participants).toEqual([]);
    expect(q.scores).toEqual({});
    expect(q.memberScores).toEqual({});
    expect(q.rev).toBe(1);
    expect(q.createdBy).toBe('Doom');
    expect(q.createdAt).toBe(new Date(1000).toISOString());
    expect(q.finishedAt).toBeNull();
  });

  it('falls back to a default title when blank/whitespace', () => {
    expect(blankQuiz({ title: '   ', now: 1 }).title).toBe('Naamloze quiz');
    expect(blankQuiz({ now: 1 }).title).toBe('Naamloze quiz');
  });

  it('is deterministic -- same `now` produces the same id', () => {
    expect(blankQuiz({ now: 42 }).id).toBe(blankQuiz({ now: 42 }).id);
  });
});

describe('normalizeQuiz', () => {
  it('round-trips a legacy flat-`questions` quiz into a single round', () => {
    const legacy = {
      id: 'qz-old',
      title: 'Old Quiz',
      questions: [{ q: 'Capital of France?', options: ['Paris', 'Lyon'], answer: 0 }],
    };
    const n = normalizeQuiz(legacy);
    expect(n.rounds).toHaveLength(1);
    expect(n.rounds[0]).toMatchObject({ id: 'r0', title: 'Round 1', icon: '🎯', secret: false });
    expect(n.rounds[0].questions).toHaveLength(1);
    // A bare `answer: 0` (not yet an array) normalises to `[0]`.
    expect(n.rounds[0].questions[0].answer).toEqual([0]);
    expect(n.defaultTime).toBe(30);
  });

  it('leaves an already-rounds quiz alone beyond filling in missing per-round defaults', () => {
    const modern = {
      id: 'qz-new',
      title: 'New Quiz',
      rounds: [{ id: 'r0', title: 'Round 1', questions: [{ q: 'Q1', type: 'open', answer: [1, 2] }] }],
    };
    const n = normalizeQuiz(modern);
    expect(n.rounds).toHaveLength(1);
    expect(n.rounds[0]).toMatchObject({ icon: '🎯', description: '', bgImage: null, secret: false });
    expect(n.rounds[0].questions[0].answer).toEqual([1, 2]);
    expect(n.rounds[0].questions[0].type).toBe('open');
  });

  it('normalises `answer: null` to `[0]` and a missing `answer` key too', () => {
    const q = { id: 'qz', rounds: [{ id: 'r0', title: 'R1', questions: [{ q: 'Q', answer: null }, { q: 'Q2' }] }] };
    const n = normalizeQuiz(q);
    expect(n.rounds[0].questions[0].answer).toEqual([0]);
    expect(n.rounds[0].questions[1].answer).toEqual([0]);
  });

  it('assigns a cycling avatar to teams that are missing one, without touching an explicit avatar', () => {
    const q = { id: 'qz', rounds: [], teams: [{ id: 't1', name: 'A' }, { id: 't2', name: 'B', avatar: '🎉' }] };
    const n = normalizeQuiz(q);
    expect(n.teams[0].avatar).toBe(TEAM_AVATARS[0]);
    expect(n.teams[1].avatar).toBe('🎉');
  });

  it('is defensive against malformed/hostile JSONB -- a non-array `rounds` question list never throws', () => {
    const hostile = { id: 'qz', rounds: [{ id: 'r0', title: 'R1', questions: null }] };
    expect(() => normalizeQuiz(hostile)).not.toThrow();
    expect(normalizeQuiz(hostile).rounds[0].questions).toEqual([]);
  });
});

describe('teamsFromTeamSet', () => {
  it('snapshots teams into the quiz Team shape, stamping teamSetId/sourceTeamId provenance', () => {
    const teamSet = {
      id: 'ts_1',
      teams: [
        { id: 'tm_1', name: 'De Kraaien', avatar: '🦅', members: ['Doom', 'Tim'], captain: 'Doom' },
        { id: 'tm_2', name: 'De Wolven', avatar: '🐺', members: ['Bram'] },
      ],
    };
    const teams = teamsFromTeamSet(teamSet);
    expect(teams).toEqual([
      { id: 'tm_1', name: 'De Kraaien', avatar: '🦅', members: ['Doom', 'Tim'], captain: 'Doom', teamSetId: 'ts_1', sourceTeamId: 'tm_1' },
      { id: 'tm_2', name: 'De Wolven', avatar: '🐺', members: ['Bram'], captain: null, teamSetId: 'ts_1', sourceTeamId: 'tm_2' },
    ]);
  });

  it('is deterministic and never throws on a hand-edited/hostile team_sets row', () => {
    expect(teamsFromTeamSet(null)).toEqual([]);
    expect(teamsFromTeamSet({ id: 'ts_1', teams: 'not-an-array' })).toEqual([]);
    expect(() => teamsFromTeamSet({ id: 'ts_1', teams: [{ id: 'tm_1' }, { name: 'no id' }, null, 42] })).not.toThrow();
    const teams = teamsFromTeamSet({ id: 'ts_1', teams: [{ id: 'tm_1' }, { name: 'no id' }, null, 42] });
    // Only the entry with a usable string id survives.
    expect(teams).toHaveLength(1);
    expect(teams[0].sourceTeamId).toBe('tm_1');
    expect(teams[0].name).toBe('Team 1');
    expect(teams[0].members).toEqual([]);
  });

  it('coerces a non-array `members` field rather than throwing', () => {
    const teams = teamsFromTeamSet({ id: 'ts_1', teams: [{ id: 'tm_1', name: 'A', members: 'not-an-array' }] });
    expect(teams[0].members).toEqual([]);
  });
});

// The Winner-tab brief (2026-08-26): the builder's Winner tab preview,
// `WinnersTab` (App.jsx) and `finishQuiz.js`'s placement/award path must all
// resolve to the exact same winner off the same `quiz.settings.winner`
// override -- this is the one function that decides it.
describe('teamStableId', () => {
  it('prefers `id`, then `sourceTeamId`, then falls back to `name` for a legacy team with neither', () => {
    expect(teamStableId({ id: 'tm_1', sourceTeamId: 'tm_9', name: 'A' })).toBe('tm_1');
    expect(teamStableId({ sourceTeamId: 'tm_9', name: 'A' })).toBe('tm_9');
    expect(teamStableId({ name: 'De Kraaien' })).toBe('De Kraaien');
  });

  it('is defensive -- null/hostile input never throws', () => {
    expect(teamStableId(null)).toBeNull();
    expect(teamStableId({})).toBeNull();
    expect(teamStableId({ name: '   ' })).toBeNull();
  });
});

describe('resolveQuizWinner', () => {
  it('returns null when there is no override and no scores yet', () => {
    expect(resolveQuizWinner({ id: 'qz1', teams: [], scores: {} })).toBeNull();
    expect(resolveQuizWinner(null)).toBeNull();
  });

  it('mode absent/auto: derives the top scorer, exactly like the old inline WinnersTab card did', () => {
    const quiz = { id: 'qz1', teams: [], scores: { Doom: 20, Bram: 15 } };
    expect(resolveQuizWinner(quiz)).toMatchObject({ name: 'Doom', detail: '20 pts', avatar: '🧠', source: 'auto', kind: 'player' });
  });

  it('auto, team quiz: picks the top-scoring team and includes its members in the detail', () => {
    const quiz = {
      id: 'qz1',
      teams: [{ id: 'tm_1', name: 'De Kraaien', avatar: '🦅', members: ['Doom', 'Bram'] }],
      scores: { 'De Kraaien': 30 },
    };
    expect(resolveQuizWinner(quiz)).toMatchObject({ name: 'De Kraaien', detail: '30 pts · Doom, Bram', avatar: '🦅', source: 'auto', kind: 'team' });
  });

  it('a tie picks a stable (score-sorted) top entry, same as the old inline behaviour -- overriding is the fix for this, not this function', () => {
    const quiz = { id: 'qz1', teams: [], scores: { Bram: 10, Doom: 10 } };
    const resolved = resolveQuizWinner(quiz);
    expect(['Bram', 'Doom']).toContain(resolved.name);
    expect(resolved.detail).toBe('10 pts');
  });

  it('mode team: resolves the chosen team by stable id, not name, and defaults detail to its member list', () => {
    const quiz = {
      id: 'qz1',
      teams: [{ id: 'tm_1', name: 'De Kraaien', avatar: '🦅', members: ['Doom', 'Bram'], teamSetId: 'ts_1', sourceTeamId: 'tm_1' }],
      scores: {},
      settings: { winner: { mode: 'team', teamId: 'tm_1' } },
    };
    expect(resolveQuizWinner(quiz)).toMatchObject({
      name: 'De Kraaien', detail: 'Doom, Bram', avatar: '🦅', source: 'team', kind: 'team',
      teamSetId: 'ts_1', sourceTeamId: 'tm_1',
    });
  });

  it('mode team: an explicit detail overrides the member-list default', () => {
    const quiz = {
      id: 'qz1', teams: [{ id: 'tm_1', name: 'De Kraaien', members: ['Doom'] }], scores: {},
      settings: { winner: { mode: 'team', teamId: 'tm_1', detail: 'na een tie-break vraag' } },
    };
    expect(resolveQuizWinner(quiz).detail).toBe('na een tie-break vraag');
  });

  it('mode team: still resolves after the team is renamed -- matched by id, not by the stale name', () => {
    const quiz = {
      id: 'qz1',
      teams: [{ id: 'tm_1', name: 'De Nieuwe Naam', avatar: '🦅', members: [], teamSetId: 'ts_1', sourceTeamId: 'tm_1' }],
      scores: {},
      settings: { winner: { mode: 'team', teamId: 'tm_1' } },
    };
    expect(resolveQuizWinner(quiz).name).toBe('De Nieuwe Naam');
  });

  it('mode team: a teamId that no longer resolves (team removed) returns null, never a bogus winner', () => {
    const quiz = { id: 'qz1', teams: [{ id: 'tm_2', name: 'Other' }], scores: {}, settings: { winner: { mode: 'team', teamId: 'tm_1' } } };
    expect(resolveQuizWinner(quiz)).toBeNull();
  });

  it('mode manual: a free-text name/detail, no scores required at all', () => {
    const quiz = { id: 'qz1', teams: [], scores: {}, settings: { winner: { mode: 'manual', name: 'Sven', detail: 'Beste inzet van de avond' } } };
    expect(resolveQuizWinner(quiz)).toMatchObject({ name: 'Sven', detail: 'Beste inzet van de avond', avatar: '🏆', source: 'manual', kind: 'player' });
  });

  it('mode manual: a blank/whitespace-only name is not a real override -- returns null', () => {
    const quiz = { id: 'qz1', teams: [], scores: {}, settings: { winner: { mode: 'manual', name: '   ' } } };
    expect(resolveQuizWinner(quiz)).toBeNull();
  });

  it('an override survives a quiz with scores that would otherwise pick someone else', () => {
    const quiz = {
      id: 'qz1', teams: [], scores: { Doom: 100 },
      settings: { winner: { mode: 'manual', name: 'Bram', detail: 'Disqualified Doom for cheating' } },
    };
    expect(resolveQuizWinner(quiz).name).toBe('Bram');
  });

  it('switching back to mode auto (or the key being absent) ignores any leftover teamId/name', () => {
    const quiz = { id: 'qz1', teams: [], scores: { Doom: 5 }, settings: { winner: { mode: 'auto', teamId: 'tm_1', name: 'stale' } } };
    expect(resolveQuizWinner(quiz)).toMatchObject({ name: 'Doom', source: 'auto' });
  });
});
