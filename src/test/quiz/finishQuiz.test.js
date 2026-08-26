// src/features/quiz/finishQuiz.js -- WP-Q6 (docs/quiz-unification-spec.md
// §7.2). Same mocking idiom as `mensgames/finishTournament.test.js` /
// `awards/publishResults.test.js`: `supabase.js` is mocked directly (every
// table this module ultimately touches -- `quizzes`, `quiz_live`,
// `quiz_answers`, `events` -- goes through the one client), and
// `teamlib/api.js` is mocked directly since `awards/publishResults.js` only
// ever talks to the team library through that module.
//
// `calls` records every chained query-builder method invoked, tagged with
// the table it was called on -- this is what lets the "no-row" tests below
// prove *which write path* `finishQuiz` chose (a narrow `.update()` via
// `patchQuiz`, or a full `.upsert()` via `saveQuiz`) independently of
// whether that write happened to succeed against the canned mock response.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockTableData = {};
let calls = [];
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => {
        const builder = makeQueryBuilder(mockTableData[table] ?? { data: [], error: null });
        ['select', 'eq', 'limit', 'update', 'upsert', 'delete', 'single'].forEach((method) => {
          const orig = builder[method];
          builder[method] = (...args) => {
            calls.push({ table, method, args });
            return orig(...args);
          };
        });
        return builder;
      },
    },
  };
});

vi.mock('../../features/teamlib/api.js', () => ({
  addTeamAward: vi.fn(async (teamSet, award) => ({ ok: true, error: null, teamSet: { ...teamSet, awards: [...(teamSet.awards || []), award] } })),
  archiveTeamSet: vi.fn(async (teamSet) => ({ ok: true, error: null, teamSet: { ...teamSet, status: 'archived', archivedAt: '2026-08-26T00:00:00Z' } })),
}));

import { addTeamAward, archiveTeamSet } from '../../features/teamlib/api.js';
import { buildTeamAwards, computeMemberScores, finishQuiz, publishQuizResults, quizPlacements, winnerRowsFromQuiz } from '../../features/quiz/finishQuiz.js';

beforeEach(() => {
  mockTableData = {};
  calls = [];
  addTeamAward.mockClear();
  archiveTeamSet.mockClear();
});

function calledOn(table, method) {
  return calls.some((c) => c.table === table && c.method === method);
}

const TEAM_SETS = [
  { id: 'ts_1', name: 'Kroeg Teams', category: '', teams: [{ id: 'tm_3', name: 'Team Gamma' }, { id: 'tm_4', name: 'Team Delta' }], status: 'active', awards: [] },
];

function teamQuiz(overrides = {}) {
  return {
    id: 'qz1724000000',
    title: 'Pubquiz Editie 12',
    eventId: 'evt-2026',
    status: 'live',
    teams: [
      { id: 'tm_3', name: 'Team Gamma', members: ['Rik', 'Sanne'], teamSetId: 'ts_1', sourceTeamId: 'tm_3' },
      { id: 'tm_4', name: 'Team Delta', members: ['Bo'], teamSetId: 'ts_1', sourceTeamId: 'tm_4' },
      // No `teamSetId`/`sourceTeamId` -- a team built through the
      // not-yet-shipped `TeamSetPicker` (WP-Q5) never gets one today.
      { id: 'tm_5', name: 'Geen Bibliotheek', members: ['Sven'] },
    ],
    scores: { 'Team Gamma': 42, 'Team Delta': 30, 'Geen Bibliotheek': 5 },
    settings: {},
    ...overrides,
  };
}

function individualQuiz(overrides = {}) {
  return {
    id: 'qz1724000001',
    title: 'Solo Pubquiz',
    eventId: 'evt-2026',
    status: 'live',
    teams: [],
    scores: { doom: 20, bram: 15, tim: 15, sven: 5 },
    settings: {},
    ...overrides,
  };
}

describe('computeMemberScores', () => {
  it('individual quiz: memberScores is exactly scores (already username-keyed)', () => {
    const quiz = individualQuiz();
    expect(computeMemberScores(quiz, quiz.scores)).toEqual(quiz.scores);
  });

  it('team quiz: distributes each team\'s final score across its members', () => {
    const quiz = teamQuiz();
    expect(computeMemberScores(quiz, quiz.scores)).toEqual({
      Rik: 42, Sanne: 42, Bo: 30, Sven: 5,
    });
  });

  it('a member on two teams (edge case, hand-edited data) sums both teams\' points', () => {
    const quiz = teamQuiz({
      teams: [
        { name: 'Team Gamma', members: ['Rik'] },
        { name: 'Team Delta', members: ['Rik'] },
      ],
      scores: { 'Team Gamma': 10, 'Team Delta': 4 },
    });
    expect(computeMemberScores(quiz, quiz.scores)).toEqual({ Rik: 14 });
  });

  it('is defensive against malformed input -- never throws', () => {
    expect(computeMemberScores(null, null)).toEqual({});
    expect(computeMemberScores({ teams: 'garbage' }, { a: 1 })).toEqual({ a: 1 });
    expect(computeMemberScores({ teams: [{ name: 'A', members: 'nope' }] }, { A: 5 })).toEqual({});
  });
});

describe('quizPlacements', () => {
  it('team quiz: top 3 teams, ranked by score, carrying library provenance where it exists', () => {
    const placements = quizPlacements(teamQuiz());
    expect(placements).toEqual([
      { rank: 1, name: 'Team Gamma', kind: 'team', memberNames: ['Rik', 'Sanne'], teamSetId: 'ts_1', sourceTeamId: 'tm_3', detail: '42 punten', slot: 'tm_3' },
      { rank: 2, name: 'Team Delta', kind: 'team', memberNames: ['Bo'], teamSetId: 'ts_1', sourceTeamId: 'tm_4', detail: '30 punten', slot: 'tm_4' },
      { rank: 3, name: 'Geen Bibliotheek', kind: 'team', memberNames: ['Sven'], teamSetId: null, sourceTeamId: null, detail: '5 punten', slot: undefined },
    ]);
  });

  it('individual quiz: kind player, no provenance, ties share a rank and the gap is not filled', () => {
    const placements = quizPlacements(individualQuiz());
    expect(placements.map((p) => [p.rank, p.name])).toEqual([
      [1, 'doom'],
      [2, 'bram'],
      [2, 'tim'],
      // sven (5 points, rank 4) is outside the medals
    ]);
    expect(placements.every((p) => p.kind === 'player' && p.teamSetId === null && p.sourceTeamId === null)).toBe(true);
  });

  it('a lone point ("1 punt") is singular, everything else is plural', () => {
    const placements = quizPlacements(individualQuiz({ scores: { doom: 1 } }));
    expect(placements[0].detail).toBe('1 punt');
  });

  it('is defensive against malformed teams/scores -- never throws, returns []', () => {
    expect(quizPlacements(null)).toEqual([]);
    expect(quizPlacements({ teams: 'garbage', scores: null })).toEqual([]);
    expect(quizPlacements({ teams: [], scores: 'garbage' })).toEqual([]);
  });

  // Winner-tab brief (2026-08-26): "so the published award matches what the
  // tab showed" -- `quizPlacements` calls the same `resolveQuizWinner`
  // (`model.js`) the tab's preview and `WinnersTab` call, and a real
  // override (`mode:'team'|'manual'`) replaces rank 1 outright.
  describe('a settings.winner override replaces rank 1', () => {
    it('mode team: the chosen team becomes rank 1 with library provenance, natural rank 1 is dropped (not double-awarded), ranks 2/3 are untouched', () => {
      const quiz = teamQuiz({ settings: { winner: { mode: 'team', teamId: 'tm_4' } } });
      const placements = quizPlacements(quiz);
      expect(placements).toEqual([
        { rank: 1, name: 'Team Delta', kind: 'team', memberNames: ['Bo'], teamSetId: 'ts_1', sourceTeamId: 'tm_4', detail: 'Bo', slot: 'tm_4' },
        { rank: 3, name: 'Geen Bibliotheek', kind: 'team', memberNames: ['Sven'], teamSetId: null, sourceTeamId: null, detail: '5 punten', slot: undefined },
      ]);
      // The natural top scorer (Team Gamma, 42 pts) is gone from the podium
      // entirely -- not left sitting at rank 1 next to the override.
      expect(placements.some((p) => p.name === 'Team Gamma')).toBe(false);
    });

    it('mode manual: a free-text winner becomes rank 1 even with real scores present, kind player, no team provenance', () => {
      const quiz = teamQuiz({ settings: { winner: { mode: 'manual', name: 'De Jury', detail: 'Publieksprijs' } } });
      const placements = quizPlacements(quiz);
      expect(placements[0]).toEqual({ rank: 1, name: 'De Jury', kind: 'player', memberNames: [], teamSetId: null, sourceTeamId: null, detail: 'Publieksprijs', slot: undefined });
      expect(placements).toHaveLength(3); // override + the two natural placements it didn't collide with
    });

    it('an override on a quiz with NO scores at all still produces exactly one placement', () => {
      const quiz = teamQuiz({ scores: {}, settings: { winner: { mode: 'manual', name: 'Sven' } } });
      expect(quizPlacements(quiz)).toEqual([
        { rank: 1, name: 'Sven', kind: 'player', memberNames: [], teamSetId: null, sourceTeamId: null, detail: '', slot: undefined },
      ]);
    });

    it('mode auto (or the key absent) is unaffected -- exact same output as no settings.winner at all', () => {
      const withAuto = quizPlacements(teamQuiz({ settings: { winner: { mode: 'auto' } } }));
      const withNone = quizPlacements(teamQuiz());
      expect(withAuto).toEqual(withNone);
    });

    it('a team override still resolves after the team is renamed since the snapshot was taken -- matched by id, not the (now stale) name', () => {
      const renamed = teamQuiz({
        teams: [
          { id: 'tm_3', name: 'Team Gamma Renamed', members: ['Rik', 'Sanne'], teamSetId: 'ts_1', sourceTeamId: 'tm_3' },
          { id: 'tm_4', name: 'Team Delta', members: ['Bo'], teamSetId: 'ts_1', sourceTeamId: 'tm_4' },
        ],
        settings: { winner: { mode: 'team', teamId: 'tm_3' } },
      });
      expect(quizPlacements(renamed)[0].name).toBe('Team Gamma Renamed');
    });
  });
});

describe('winnerRowsFromQuiz / buildTeamAwards (adapters onto awards/publishResults.js)', () => {
  it('produces qz-prefixed Winner rows for the top 3', () => {
    const rows = winnerRowsFromQuiz(teamQuiz());
    expect(rows.map((r) => r.id)).toEqual([
      'qz-qz1724000000-tm_3',
      'qz-qz1724000000-tm_4',
      'qz-qz1724000000-geen-bibliotheek',
    ]);
  });

  it('builds a TeamAward only for placements with library provenance -- the un-migrated team is skipped, not crashed on', () => {
    const out = buildTeamAwards(teamQuiz(), TEAM_SETS, { now: 5000 });
    expect(out.map((o) => o.award.teamId).sort()).toEqual(['tm_3', 'tm_4']);
  });
});

describe('finishQuiz -- the quizzes-table write path', () => {
  it('when a `quizzes` row already exists, uses the narrow `patchQuiz` update -- never the full-row upsert', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    mockTableData.events = { data: { id: 'evt-2026', winners: [] }, error: null };
    await finishQuiz({ quiz: teamQuiz(), teamSets: TEAM_SETS });
    expect(calledOn('quizzes', 'update')).toBe(true);
    expect(calledOn('quizzes', 'upsert')).toBe(false);
  });

  // The no-row trap (§7.2's report): a quiz built through the not-yet-
  // rewired builder has no row in `quizzes` at all, and a narrow
  // `.update().eq('id',…)` against zero matching rows is a silent,
  // error-free no-op -- exactly the failure this work package exists to
  // close. Proven here with NO `quizzes` row in the mock.
  it('the no-row trap: with no matching `quizzes` row, falls back to a full saveQuiz upsert instead of a silent no-op', async () => {
    mockTableData.quizzes = { data: [], error: null };
    mockTableData.events = { data: { id: 'evt-2026', winners: [] }, error: null };
    const result = await finishQuiz({ quiz: teamQuiz(), teamSets: TEAM_SETS });
    expect(calledOn('quizzes', 'upsert')).toBe(true);
    expect(calledOn('quizzes', 'update')).toBe(false);
    expect(result.quiz.status).toBe('finished');
  });

  it('when the existence check itself fails (e.g. a transient blip), also falls back to the full upsert rather than risking a silent no-op', async () => {
    mockTableData.quizzes = { data: null, error: { message: 'temporary blip' } };
    const result = await finishQuiz({ quiz: teamQuiz(), teamSets: TEAM_SETS });
    expect(calledOn('quizzes', 'upsert')).toBe(true);
    expect(calledOn('quizzes', 'update')).toBe(false);
    // The write itself still fails against this canned error -- finishQuiz
    // must report that honestly, not paper over it.
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.scope === 'quiz')).toBe(true);
  });

  it('writes status/scores/memberScores/finishedAt, and never re-sends rounds through the narrow path', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    const result = await finishQuiz({ quiz: teamQuiz(), teamSets: TEAM_SETS, now: 9000 });
    const updateCall = calls.find((c) => c.table === 'quizzes' && c.method === 'update');
    expect(updateCall.args[0]).toMatchObject({
      status: 'finished',
      scores: { 'Team Gamma': 42, 'Team Delta': 30, 'Geen Bibliotheek': 5 },
      member_scores: { Rik: 42, Sanne: 42, Bo: 30, Sven: 5 },
      finished_at: new Date(9000).toISOString(),
    });
    expect(updateCall.args[0].rounds).toBeUndefined();
    expect(result.quiz.finishedAt).toBe(new Date(9000).toISOString());
  });

  it('deletes the quiz_live row and all quiz_answers rows', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    await finishQuiz({ quiz: teamQuiz(), teamSets: TEAM_SETS });
    expect(calledOn('quiz_live', 'delete')).toBe(true);
    expect(calledOn('quiz_answers', 'delete')).toBe(true);
  });

  it('never throws on a malformed quiz/event/teamSets combination', async () => {
    await expect(finishQuiz({ quiz: null, teamSets: null })).resolves.toBeTruthy();
  });
});

describe('finishQuiz -- publishing awards (non-secret)', () => {
  it('pushes Winner rows onto event.winners and a TeamAward onto the library, in one finish', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };

    const result = await finishQuiz({ quiz: teamQuiz(), event, onUpdateEvent, teamSets: TEAM_SETS });

    expect(result.ok).toBe(true);
    expect(result.deferred).toBe(false);
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    const ids = onUpdateEvent.mock.calls[0][0].winners.map((w) => w.id);
    expect(ids).toContain('qz-qz1724000000-tm_3');
    expect(ids).toContain('qz-qz1724000000-tm_4');
    expect(addTeamAward).toHaveBeenCalledTimes(2);
    expect(result.updatedTeamSets).toHaveLength(1);
  });

  it('an individual quiz still publishes player Winner rows -- no team, no TeamAward, no crash', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000001' }], error: null };
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };

    const result = await finishQuiz({ quiz: individualQuiz(), event, onUpdateEvent, teamSets: TEAM_SETS });
    expect(result.ok).toBe(true);
    expect(addTeamAward).not.toHaveBeenCalled();
    const ids = onUpdateEvent.mock.calls[0][0].winners.map((w) => w.id);
    expect(ids).toContain('qz-qz1724000001-doom');
  });

  it('a standalone quiz (no event) still awards teams -- nothing to decorate on the event side', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    const onUpdateEvent = vi.fn();
    const result = await finishQuiz({ quiz: teamQuiz({ eventId: null }), event: null, onUpdateEvent, teamSets: TEAM_SETS });
    expect(onUpdateEvent).not.toHaveBeenCalled();
    expect(addTeamAward).toHaveBeenCalled();
    expect(result.teamAwards.length).toBeGreaterThan(0);
  });
});

// 2026-08-26 (WP-Q6, §7.3): "let me create a quiz but make it secret, same
// as tournaments". Finishing a secret quiz must NOT leak its result onto
// events.winners (Winners tab / Hall of Fame) OR team_sets.awards (Team
// Trophy Cabinet, also on Hall of Fame) -- the exact two leaks
// `finishTournament.js` was found to have (both member-visible, both
// rendered automatically to everyone regardless of whether the quiz row
// itself is reachable by them).
describe('finishQuiz -- secret quizzes defer publishing, through neither channel', () => {
  it('still finishes the quiz row, but does not touch events.winners', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };

    const result = await finishQuiz({ quiz: teamQuiz({ settings: { secret: true } }), event, onUpdateEvent, teamSets: TEAM_SETS });

    expect(result.quiz.status).toBe('finished');
    expect(result.deferred).toBe(true);
    expect(result.ok).toBe(true);
    expect(onUpdateEvent).not.toHaveBeenCalled();
  });

  it('does not write any TeamAward or archive anything while secret', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    const result = await finishQuiz({ quiz: teamQuiz({ settings: { secret: true } }), teamSets: TEAM_SETS, archiveWinningSets: true });
    expect(addTeamAward).not.toHaveBeenCalled();
    expect(archiveTeamSet).not.toHaveBeenCalled();
    expect(result.updatedTeamSets).toEqual([]);
  });

  it('still computes winners/teamAwards for a later reveal to use, it just does not write them anywhere', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    const result = await finishQuiz({ quiz: teamQuiz({ settings: { secret: true } }), teamSets: TEAM_SETS });
    expect(result.winners.length).toBeGreaterThan(0);
    expect(result.teamAwards.length).toBeGreaterThan(0);
  });

  it('a non-secret quiz is unaffected (deferred: false, publishes as before)', async () => {
    mockTableData.quizzes = { data: [{ id: 'qz1724000000' }], error: null };
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };
    const result = await finishQuiz({ quiz: teamQuiz(), event, onUpdateEvent, teamSets: TEAM_SETS });
    expect(result.deferred).toBe(false);
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    expect(addTeamAward).toHaveBeenCalled();
  });

  it('publishQuizResults (the reveal-time publish) publishes exactly like a non-secret finish would', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };
    const result = await publishQuizResults({ quiz: teamQuiz({ settings: { secret: false } }), event, onUpdateEvent, teamSets: TEAM_SETS });
    expect(result.ok).toBe(true);
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    expect(addTeamAward).toHaveBeenCalledTimes(2);
  });
});
