// src/features/awards/publishResults.js -- WP-Q1
// (docs/quiz-unification-spec.md §7.1), the source-agnostic
// results-publishing core extracted out of mensgames/finishTournament.js.
//
// `finishTournament.test.js` already proves this module is behaviour-
// preserving for the tournament shape (it exercises the tournament adapter
// end to end and is required to pass unedited). This file's job is the
// opposite: prove the core isn't *secretly* tournament-shaped -- i.e. that
// nothing in here assumes a `tournamentId`, an `mg-` prefix, or a
// tournament-flavoured `source` -- by driving it with a synthetic
// `source: {kind:'quiz', ...}` even though `src/features/quiz/` doesn't
// exist yet. Same mocking idiom as finishTournament.test.js: `supabase.js`
// and `teamlib/api.js` are mocked directly, since this module only ever
// talks to either through those two surfaces.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockTableData = {};
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => makeQueryBuilder(mockTableData[table] ?? { data: null, error: null }),
    },
  };
});

vi.mock('../../features/teamlib/api.js', () => ({
  addTeamAward: vi.fn(async (teamSet, award) => ({ ok: true, error: null, teamSet: { ...teamSet, awards: [...(teamSet.awards || []), award] } })),
  archiveTeamSet: vi.fn(async (teamSet) => ({ ok: true, error: null, teamSet: { ...teamSet, status: 'archived', archivedAt: '2026-08-21T00:00:00Z' } })),
}));

import { addTeamAward, archiveTeamSet } from '../../features/teamlib/api.js';
import { winnerRowsFromPlacements, buildTeamAwards, publishResults } from '../../features/awards/publishResults.js';

beforeEach(() => {
  addTeamAward.mockClear();
  archiveTeamSet.mockClear();
  mockTableData = {};
});

const QUIZ_SOURCE = { kind: 'quiz', id: 'qz1724000000', name: 'Pubquiz Editie 12', eventId: 'evt-2026' };

const TEAM_SETS = [
  { id: 'ts_1', name: 'Kroeg Teams', category: '', teams: [{ id: 'tm_3', name: 'Team Gamma' }, { id: 'tm_4', name: 'Team Delta' }], status: 'active', awards: [] },
];

function teamPlacement(overrides = {}) {
  return {
    rank: 1,
    name: 'Team Gamma',
    kind: 'team',
    memberNames: ['Rik', 'Sanne'],
    teamSetId: 'ts_1',
    sourceTeamId: 'tm_3',
    detail: '42 punten · Rik, Sanne',
    ...overrides,
  };
}

function playerPlacement(overrides = {}) {
  return {
    rank: 3,
    name: 'Solo Sven',
    kind: 'player',
    memberNames: [],
    teamSetId: null,
    sourceTeamId: null,
    detail: '17 punten',
    ...overrides,
  };
}

describe('winnerRowsFromPlacements — quiz source', () => {
  it('builds Winner[] with a qz- prefixed id and no tournament-specific fields', () => {
    const placements = [teamPlacement(), { ...teamPlacement({ rank: 2, name: 'Team Delta', sourceTeamId: 'tm_4', detail: '30 punten · Bo' }) }, playerPlacement()];
    const rows = winnerRowsFromPlacements(QUIZ_SOURCE, placements);
    expect(rows).toEqual([
      { id: 'qz-qz1724000000-tm_3', category: '🏆 Pubquiz Editie 12 — 1e plaats', winner: 'Team Gamma', detail: '42 punten · Rik, Sanne', icon: '🥇' },
      { id: 'qz-qz1724000000-tm_4', category: '🏆 Pubquiz Editie 12 — 2e plaats', winner: 'Team Delta', detail: '30 punten · Bo', icon: '🥈' },
      { id: 'qz-qz1724000000-solo-sven', category: '🏆 Pubquiz Editie 12 — 3e plaats', winner: 'Solo Sven', detail: '17 punten', icon: '🥉' },
    ]);
    expect(Object.keys(rows[0])).toEqual(['id', 'category', 'winner', 'detail', 'icon']);
  });

  it('falls back to a slugified name for a player placement with no sourceTeamId and no slot', () => {
    const rows = winnerRowsFromPlacements(QUIZ_SOURCE, [playerPlacement({ name: 'Dr. Weird Näme!!' })]);
    expect(rows[0].id).toBe('qz-qz1724000000-dr-weird-n-me');
  });

  it('an unrecognised source.kind falls back to the mg- prefix rather than throwing', () => {
    const rows = winnerRowsFromPlacements({ kind: 'something-else', id: 'src_1', name: 'Mystery' }, [teamPlacement()]);
    expect(rows[0].id).toBe('mg-src_1-tm_3');
  });

  it('is defensive against malformed placements and a malformed source -- never throws, returns []', () => {
    expect(winnerRowsFromPlacements(null, null)).toEqual([]);
    expect(winnerRowsFromPlacements(QUIZ_SOURCE, 'garbage')).toEqual([]);
    expect(winnerRowsFromPlacements(QUIZ_SOURCE, [{ rank: 'first', name: 'x' }])).toEqual([]);
    expect(winnerRowsFromPlacements(QUIZ_SOURCE, [{ rank: 1, name: '' }])).toEqual([]);
  });

  it('ties share a rank, and a missing rank in between is not invented', () => {
    const rows = winnerRowsFromPlacements(QUIZ_SOURCE, [
      teamPlacement({ rank: 1 }),
      teamPlacement({ rank: 1, name: 'Team Delta', sourceTeamId: 'tm_4' }),
      playerPlacement({ rank: 4 }), // outside the medals
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.icon === '🥇')).toBe(true);
  });
});

describe('buildTeamAwards — quiz source', () => {
  // 2026-08-26: the §3.4-extended shape (`sourceKind`/`sourceId` plus both
  // `tournamentId` and `quizId`, whichever doesn't apply is `null`) is the
  // *same* shape for every source -- see the sibling assertion just below
  // proving a tournament-shaped source gets it too, not a quiz-only extra.
  it('builds the full §3.4-extended award shape for a quiz source', () => {
    const out = buildTeamAwards(QUIZ_SOURCE, [teamPlacement()], TEAM_SETS, { now: 5000 });
    expect(out).toHaveLength(1);
    expect(out[0].teamSet.id).toBe('ts_1');
    expect(out[0].award).toEqual({
      id: 'aw_qz1724000000_tm_3',
      teamId: 'tm_3',
      label: '🥇 Pubquiz Editie 12 — 1e plaats',
      placement: 1,
      sourceKind: 'quiz',
      sourceId: 'qz1724000000',
      tournamentId: null,
      quizId: 'qz1724000000',
      eventId: 'evt-2026',
      note: '',
      awardedAt: new Date(5000).toISOString(),
    });
  });

  it('the same extended shape applies to a tournament-shaped source, not just quiz -- one shape for both, per §3.4', () => {
    const TOURNAMENT_SOURCE = { kind: 'tournament', id: 'trn_9', name: 'Mens-Games', eventId: 'evt-2026' };
    const out = buildTeamAwards(TOURNAMENT_SOURCE, [teamPlacement()], TEAM_SETS, { now: 5000 });
    expect(out[0].award).toEqual({
      id: 'aw_trn_9_tm_3',
      teamId: 'tm_3',
      label: '🥇 Mens-Games — 1e plaats',
      placement: 1,
      sourceKind: 'tournament',
      sourceId: 'trn_9',
      tournamentId: 'trn_9',
      quizId: null,
      eventId: 'evt-2026',
      note: '',
      awardedAt: new Date(5000).toISOString(),
    });
  });

  it('skips a player placement -- no team set to award', () => {
    const out = buildTeamAwards(QUIZ_SOURCE, [teamPlacement(), playerPlacement()], TEAM_SETS, {});
    expect(out).toHaveLength(1);
    expect(out[0].award.teamId).toBe('tm_3');
  });

  it('skips a team placement whose team set is no longer in teamSets', () => {
    const out = buildTeamAwards(QUIZ_SOURCE, [teamPlacement({ teamSetId: 'ts_gone', sourceTeamId: 'tm_x' })], TEAM_SETS, {});
    expect(out).toEqual([]);
  });

  it('a standalone quiz (no eventId) still builds team awards, with eventId null', () => {
    const out = buildTeamAwards({ ...QUIZ_SOURCE, eventId: null }, [teamPlacement()], TEAM_SETS, {});
    expect(out[0].award.eventId).toBeNull();
  });

  it('never throws on malformed teamSets or placements', () => {
    expect(buildTeamAwards(QUIZ_SOURCE, 'garbage', TEAM_SETS, {})).toEqual([]);
    expect(buildTeamAwards(QUIZ_SOURCE, [teamPlacement()], 'garbage', {})).toEqual([]);
    expect(buildTeamAwards(null, null, null, {})).toEqual([]);
  });
});

describe('publishResults — quiz source, end to end', () => {
  it('pushes deduped qz- winner rows onto event.winners, keeping unrelated rows and a different source\'s rows', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = {
      id: 'evt-2026',
      winners: [
        { id: 'w-manual-1', category: 'Beer pong', winner: 'Doom', detail: '', icon: '🍺' },
        { id: 'mg-trn_1-ent_9', category: 'a tournament, untouched by a quiz publish', winner: 'Old', detail: '', icon: '🥇' },
        { id: 'qz-qz1724000000-tm_9', category: 'stale from a previous finish of this same quiz', winner: 'Old Team', detail: '', icon: '🥇' },
      ],
    };
    mockTableData.events = { data: event, error: null };

    const result = await publishResults({ source: QUIZ_SOURCE, placements: [teamPlacement(), playerPlacement()], event, onUpdateEvent, teamSets: TEAM_SETS });

    expect(result.ok).toBe(true);
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    const ids = onUpdateEvent.mock.calls[0][0].winners.map((w) => w.id);
    expect(ids).toContain('w-manual-1'); // unrelated, untouched
    expect(ids).toContain('mg-trn_1-ent_9'); // a different source (a tournament) -- untouched by a quiz publish
    expect(ids).not.toContain('qz-qz1724000000-tm_9'); // this quiz's stale row, replaced
    expect(ids).toContain('qz-qz1724000000-tm_3');
    expect(ids).toContain('qz-qz1724000000-solo-sven');
  });

  it('re-reads the event row before writing, so a concurrent write to another field survives the publish', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const staleLocalEvent = { id: 'evt-2026', someOtherField: 'stale', winners: [] };
    const freshDbRow = { id: 'evt-2026', someOtherField: 'fresh-from-another-device', winners: [{ id: 'w-manual-1', category: 'Beer pong', winner: 'Doom', detail: '', icon: '🍺' }] };
    mockTableData.events = { data: freshDbRow, error: null };

    await publishResults({ source: QUIZ_SOURCE, placements: [teamPlacement()], event: staleLocalEvent, onUpdateEvent, teamSets: TEAM_SETS });

    const saved = onUpdateEvent.mock.calls[0][0];
    expect(saved.someOtherField).toBe('fresh-from-another-device');
    expect(saved.winners.map((w) => w.id)).toContain('w-manual-1');
  });

  it('a quiz with no linked event still awards teams -- there is just nothing to decorate on the event side', async () => {
    const onUpdateEvent = vi.fn();
    const result = await publishResults({ source: { ...QUIZ_SOURCE, eventId: null }, placements: [teamPlacement()], event: null, onUpdateEvent, teamSets: TEAM_SETS });
    expect(onUpdateEvent).not.toHaveBeenCalled();
    expect(addTeamAward).toHaveBeenCalledTimes(1);
    expect(result.teamAwards).toHaveLength(1);
  });

  it('two medalled teams sharing one team set both land in the final updatedTeamSets entry, not just the last write', async () => {
    const placements = [teamPlacement(), teamPlacement({ rank: 2, name: 'Team Delta', sourceTeamId: 'tm_4', detail: '30 punten' })];
    const result = await publishResults({ source: QUIZ_SOURCE, placements, teamSets: TEAM_SETS });
    expect(result.updatedTeamSets).toHaveLength(1);
    const ids = result.updatedTeamSets[0].awards.map((a) => a.id).sort();
    expect(ids).toEqual(['aw_qz1724000000_tm_3', 'aw_qz1724000000_tm_4']);
  });

  it('archiving the awarded team set(s) is off by default, and honoured when true', async () => {
    await publishResults({ source: QUIZ_SOURCE, placements: [teamPlacement()], teamSets: TEAM_SETS });
    expect(archiveTeamSet).not.toHaveBeenCalled();

    archiveTeamSet.mockClear();
    await publishResults({ source: QUIZ_SOURCE, placements: [teamPlacement()], teamSets: TEAM_SETS, archiveWinningSets: true });
    expect(archiveTeamSet).toHaveBeenCalledTimes(1);
    expect(archiveTeamSet).toHaveBeenCalledWith(expect.objectContaining({ id: 'ts_1' }));
  });

  it('re-publishing the same quiz does not add a duplicate TeamAward (idempotent on the award id)', async () => {
    const first = await publishResults({ source: QUIZ_SOURCE, placements: [teamPlacement()], teamSets: TEAM_SETS });
    addTeamAward.mockClear();
    const teamSetsAfter = TEAM_SETS.map((ts) => (ts.id === 'ts_1' ? first.updatedTeamSets.find((u) => u.id === 'ts_1') || ts : ts));
    await publishResults({ source: QUIZ_SOURCE, placements: [teamPlacement()], teamSets: teamSetsAfter });
    expect(addTeamAward).not.toHaveBeenCalled();
  });

  it('collects a failed team-award write in errors without losing the others, and ok is false', async () => {
    addTeamAward.mockImplementationOnce(async () => ({ ok: false, error: { message: 'boom' } }));
    const placements = [teamPlacement(), teamPlacement({ rank: 2, name: 'Team Delta', sourceTeamId: 'tm_4' })];
    const result = await publishResults({ source: QUIZ_SOURCE, placements, teamSets: TEAM_SETS });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.scope === 'teamAward')).toBe(true);
    expect(addTeamAward).toHaveBeenCalledTimes(2); // the second team's write still happened
  });

  it('never throws on a malformed source/placements/teamSets combination', async () => {
    await expect(publishResults({ source: null, placements: null, teamSets: null })).resolves.toBeTruthy();
  });

  it('a tournament-shaped source and a quiz-shaped source publishing in the same run write disjoint winner-row and award ids, in the one shared award shape -- one system, two sources, no accidental sharing', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };
    const TOURNAMENT_SOURCE = { kind: 'tournament', id: 'trn_9', name: 'Mens-Games', eventId: 'evt-2026' };

    const quizResult = await publishResults({ source: QUIZ_SOURCE, placements: [teamPlacement()], event, onUpdateEvent, teamSets: TEAM_SETS });
    mockTableData.events = { data: { id: 'evt-2026', winners: quizResult.winners }, error: null };
    const trnResult = await publishResults({ source: TOURNAMENT_SOURCE, placements: [teamPlacement({ sourceTeamId: 'tm_4', teamSetId: 'ts_1' })], event, onUpdateEvent, teamSets: TEAM_SETS });

    expect(quizResult.winners[0].id).toMatch(/^qz-/);
    expect(trnResult.winners[0].id).toMatch(/^mg-/);
    // Same shape, both sources -- sourceKind/sourceId/tournamentId/quizId
    // are all present on both, just pointing at the source that produced
    // them, not a quiz-only extra.
    expect(quizResult.teamAwards[0].award.sourceKind).toBe('quiz');
    expect(quizResult.teamAwards[0].award.tournamentId).toBeNull();
    expect(trnResult.teamAwards[0].award.sourceKind).toBe('tournament');
    expect(trnResult.teamAwards[0].award.tournamentId).toBe('trn_9');
    expect(trnResult.teamAwards[0].award.quizId).toBeNull();
  });
});
