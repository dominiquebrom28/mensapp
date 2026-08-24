// src/features/mensgames/finishTournament.js -- WP-J, the tournament ->
// event/team-library write-back. `addTeamAward`/`archiveTeamSet` are mocked
// directly (not via supabase.js) since finishTournament only ever talks to
// the team library through that module -- same isolation level as
// TournamentEditor.debounce.test.jsx mocking mensgames/api.js.
//
// `supabase.js` itself IS mocked here (unlike before this fix) --
// finishTournament now re-reads the `events` row directly before writing
// (security review: a full-row upsert off the possibly-stale `event`
// object passed in could silently clobber a concurrent write to another
// field, since the global Mens-Games page has no realtime subscription on
// events). `mockTableData` is mutable per test, same pattern as
// teamlib/api.test.js / mensgames/api.test.js.
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
import { winnerRowsFromTournament, buildTeamAwards, finishTournament, publishTournamentResults } from '../../features/mensgames/finishTournament.js';

beforeEach(() => {
  addTeamAward.mockClear();
  archiveTeamSet.mockClear();
  mockTableData = {};
});

function tournament(overrides = {}) {
  return {
    id: 'trn_1',
    name: 'Mens-Games 2026',
    eventId: 'evt-2026',
    status: 'live',
    entrants: [
      { id: 'ent_1', kind: 'team', name: 'De Kraaien', avatar: '🦅', memberNames: ['Doom', 'Bram'], teamSetId: 'ts_1', sourceTeamId: 'tm_1' },
      { id: 'ent_2', kind: 'team', name: 'De Adelaars', avatar: '🦁', memberNames: ['Tim'], teamSetId: 'ts_1', sourceTeamId: 'tm_2' },
      { id: 'ent_3', kind: 'player', name: 'Solo Sam', avatar: '🙂', memberNames: [], teamSetId: null, sourceTeamId: null },
      { id: 'ent_4', kind: 'team', name: 'Vergeten Team', avatar: '🐸', memberNames: [], teamSetId: 'ts_gone', sourceTeamId: 'tm_x' },
    ],
    rounds: [],
    ...overrides,
  };
}

function standingsFor(rows) {
  return rows;
}

const TEAM_SETS = [
  { id: 'ts_1', name: 'Kroeg Teams', category: '', teams: [{ id: 'tm_1', name: 'De Kraaien' }, { id: 'tm_2', name: 'De Adelaars' }], status: 'active', awards: [] },
];

describe('winnerRowsFromTournament', () => {
  it('builds Winner[] for the top 3, in the exact events.winners shape', () => {
    const t = tournament();
    const standings = standingsFor([
      { entrantId: 'ent_1', points: 10, rank: 1 },
      { entrantId: 'ent_2', points: 6, rank: 2 },
      { entrantId: 'ent_3', points: 3, rank: 3 },
    ]);
    const rows = winnerRowsFromTournament(t, standings);
    expect(rows).toEqual([
      { id: 'mg-trn_1-ent_1', category: '🏆 Mens-Games 2026 — 1e plaats', winner: 'De Kraaien', detail: '10 punten · Doom, Bram', icon: '🥇' },
      { id: 'mg-trn_1-ent_2', category: '🏆 Mens-Games 2026 — 2e plaats', winner: 'De Adelaars', detail: '6 punten · Tim', icon: '🥈' },
      { id: 'mg-trn_1-ent_3', category: '🏆 Mens-Games 2026 — 3e plaats', winner: 'Solo Sam', detail: '3 punten', icon: '🥉' },
    ]);
    expect(Object.keys(rows[0])).toEqual(['id', 'category', 'winner', 'detail', 'icon']);
  });

  it('a tie for a rank gives every tied entrant that same medal, and does not invent a bronze that round', () => {
    const t = tournament();
    const standings = standingsFor([
      { entrantId: 'ent_1', points: 10, rank: 1 },
      { entrantId: 'ent_2', points: 6, rank: 2 },
      { entrantId: 'ent_3', points: 6, rank: 2 }, // tied for silver
      { entrantId: 'ent_4', points: 1, rank: 4 }, // no bronze this round
    ]);
    const rows = winnerRowsFromTournament(t, standings);
    expect(rows.map((r) => r.id).sort()).toEqual(['mg-trn_1-ent_1', 'mg-trn_1-ent_2', 'mg-trn_1-ent_3']);
    expect(rows.find((r) => r.id === 'mg-trn_1-ent_2').icon).toBe('🥈');
    expect(rows.find((r) => r.id === 'mg-trn_1-ent_3').icon).toBe('🥈');
  });

  it('a standalone tournament (no eventId) still produces winner rows -- the caller decides whether there is an event to write them to', () => {
    const t = tournament({ eventId: null });
    const rows = winnerRowsFromTournament(t, [{ entrantId: 'ent_1', points: 5, rank: 1 }]);
    expect(rows).toHaveLength(1);
  });

  it('is defensive against malformed standings and a malformed tournament -- never throws, returns []', () => {
    expect(winnerRowsFromTournament(null, null)).toEqual([]);
    expect(winnerRowsFromTournament(tournament(), 'garbage')).toEqual([]);
    expect(winnerRowsFromTournament(tournament(), [{ entrantId: 'nope-such-entrant', rank: 1 }])).toEqual([]);
    expect(winnerRowsFromTournament(tournament(), [{ entrantId: 'ent_1', rank: 'first' }])).toEqual([]);
  });
});

describe('buildTeamAwards', () => {
  const standings = standingsFor([
    { entrantId: 'ent_1', points: 10, rank: 1 },
    { entrantId: 'ent_2', points: 6, rank: 2 },
    { entrantId: 'ent_3', points: 3, rank: 3 }, // player -- no team set
    { entrantId: 'ent_4', points: 1, rank: 4 }, // outside the medals anyway
  ]);

  it('builds a TeamAward per medalled team entrant, resolved to its team_sets row via teamSetId/sourceTeamId', () => {
    const out = buildTeamAwards(tournament(), standings, TEAM_SETS, { now: 5000 });
    expect(out).toHaveLength(2);
    const first = out.find((o) => o.award.teamId === 'tm_1');
    expect(first.teamSet.id).toBe('ts_1');
    expect(first.award).toEqual({
      id: 'aw_trn_1_tm_1',
      teamId: 'tm_1',
      label: '🥇 Mens-Games 2026 — 1e plaats',
      placement: 1,
      tournamentId: 'trn_1',
      eventId: 'evt-2026',
      note: '',
      awardedAt: new Date(5000).toISOString(),
    });
  });

  it('skips a player entrant -- no team set to award', () => {
    const out = buildTeamAwards(tournament(), standings, TEAM_SETS, {});
    expect(out.some((o) => o.award.teamId === undefined)).toBe(false);
  });

  it('skips a team entrant whose team set is no longer in teamSets (deleted since the tournament ran)', () => {
    const withGoneTeam = standingsFor([
      { entrantId: 'ent_1', points: 10, rank: 1 },
      { entrantId: 'ent_4', points: 6, rank: 2 }, // teamSetId: 'ts_gone'
    ]);
    const out = buildTeamAwards(tournament(), withGoneTeam, TEAM_SETS, {});
    expect(out.every((o) => o.award.teamId !== 'tm_x')).toBe(true);
  });

  it('a standalone tournament (no eventId) still builds team awards, with eventId null', () => {
    const out = buildTeamAwards(tournament({ eventId: null }), [{ entrantId: 'ent_1', points: 5, rank: 1 }], TEAM_SETS, {});
    expect(out[0].award.eventId).toBeNull();
  });

  it('never throws on malformed teamSets', () => {
    expect(() => buildTeamAwards(tournament(), standings, 'garbage', {})).not.toThrow();
    expect(buildTeamAwards(tournament(), standings, 'garbage', {})).toEqual([]);
  });
});

describe('finishTournament', () => {
  const standings = [
    { entrantId: 'ent_1', points: 10, rank: 1 },
    { entrantId: 'ent_2', points: 6, rank: 2 },
  ];

  it('sets status to finished and returns the updated tournament', async () => {
    const result = await finishTournament({ tournament: tournament(), standings, teamSets: TEAM_SETS, now: 9000 });
    expect(result.tournament.status).toBe('finished');
    expect(result.tournament.updatedAt).toBe(new Date(9000).toISOString());
    expect(result.ok).toBe(true);
  });

  it('pushes deduped winner rows onto event.winners -- replacing this tournament\'s own previous rows, keeping unrelated ones', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = {
      id: 'evt-2026',
      winners: [
        { id: 'w-manual-1', category: 'Beer pong', winner: 'Doom', detail: '', icon: '🍺' },
        { id: 'mg-trn_1-ent_9', category: 'stale from a previous finish', winner: 'Old', detail: '', icon: '🥇' },
      ],
    };
    // The fresh read (used instead of the `event` param, see below) returns
    // the same row here -- this test is about the dedup/merge logic, not
    // the freshness fix, which gets its own tests further down.
    mockTableData.events = { data: event, error: null };
    await finishTournament({ tournament: tournament(), standings, event, onUpdateEvent, teamSets: TEAM_SETS });
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    const savedEvent = onUpdateEvent.mock.calls[0][0];
    const ids = savedEvent.winners.map((w) => w.id);
    expect(ids).toContain('w-manual-1'); // untouched, not this tournament's
    expect(ids).not.toContain('mg-trn_1-ent_9'); // this tournament's stale row, replaced
    expect(ids).toContain('mg-trn_1-ent_1');
    expect(ids).toContain('mg-trn_1-ent_2');
  });

  // Regression for the security review's finding: finishing a tournament
  // off a stale local `event` object could silently roll back a concurrent
  // write to any other field. `finishTournament` must re-read the row and
  // build the write off THAT, not off the object it was called with.
  it('re-reads the event row before writing, so a concurrent write to another field (e.g. a live quiz score) survives the finish', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    // The caller's local copy of the event -- stale, still shows the quiz
    // mid-way through, and has no winners yet.
    const staleLocalEvent = { id: 'evt-2026', quizzes: [{ id: 'q1', scores: { Doom: 3 } }], winners: [] };
    // What's actually in the DB right now -- another device advanced the
    // quiz (and it has an existing winner row) since this tab last polled.
    const freshDbRow = { id: 'evt-2026', quizzes: [{ id: 'q1', scores: { Doom: 3, Bram: 5 } }], winners: [{ id: 'w-manual-1', category: 'Beer pong', winner: 'Doom', detail: '', icon: '🍺' }] };
    mockTableData.events = { data: freshDbRow, error: null };

    await finishTournament({ tournament: tournament(), standings, event: staleLocalEvent, onUpdateEvent, teamSets: TEAM_SETS });

    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    const savedEvent = onUpdateEvent.mock.calls[0][0];
    // The fresh quiz score (Bram: 5) made it through -- a naive spread of
    // the stale `event` param would have silently dropped it.
    expect(savedEvent.quizzes[0].scores).toEqual({ Doom: 3, Bram: 5 });
    // The pre-existing manual winner from the fresh row is kept, alongside
    // this tournament's new medal rows.
    const ids = savedEvent.winners.map((w) => w.id);
    expect(ids).toContain('w-manual-1');
    expect(ids).toContain('mg-trn_1-ent_1');
    expect(ids).toContain('mg-trn_1-ent_2');
  });

  it('falls back to the passed-in `event` if the fresh read comes back empty (e.g. a transient blip), rather than dropping the finish entirely', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [{ id: 'w-manual-1', category: 'Beer pong', winner: 'Doom', detail: '', icon: '🍺' }] };
    mockTableData.events = { data: null, error: { message: 'temporary blip' } };

    const result = await finishTournament({ tournament: tournament(), standings, event, onUpdateEvent, teamSets: TEAM_SETS });

    expect(result.ok).toBe(true);
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    const ids = onUpdateEvent.mock.calls[0][0].winners.map((w) => w.id);
    expect(ids).toContain('w-manual-1');
    expect(ids).toContain('mg-trn_1-ent_1');
  });

  it('a tournament with no event_id still writes team awards -- there is just nothing to decorate on the event side', async () => {
    const onUpdateEvent = vi.fn();
    const result = await finishTournament({ tournament: tournament({ eventId: null }), standings, event: null, onUpdateEvent, teamSets: TEAM_SETS });
    expect(onUpdateEvent).not.toHaveBeenCalled();
    expect(addTeamAward).toHaveBeenCalledTimes(2); // both ent_1's and ent_2's teams, both from ts_1
    expect(result.teamAwards.length).toBeGreaterThan(0);
  });

  it('two medalled teams sharing one team set both land in the final updatedTeamSets entry, not just the last write', async () => {
    const result = await finishTournament({ tournament: tournament(), standings, teamSets: TEAM_SETS });
    expect(result.updatedTeamSets).toHaveLength(1); // one team set, both teams in it
    const ids = result.updatedTeamSets[0].awards.map((a) => a.id).sort();
    expect(ids).toEqual(['aw_trn_1_tm_1', 'aw_trn_1_tm_2']);
  });

  it('adds a TeamAward to every medalled team entrant\'s originating team set', async () => {
    await finishTournament({ tournament: tournament(), standings, teamSets: TEAM_SETS });
    expect(addTeamAward).toHaveBeenCalledTimes(2);
    const teamIds = addTeamAward.mock.calls.map((c) => c[1].teamId).sort();
    expect(teamIds).toEqual(['tm_1', 'tm_2']);
  });

  it('archiving the awarded team set(s) is off by default', async () => {
    await finishTournament({ tournament: tournament(), standings, teamSets: TEAM_SETS });
    expect(archiveTeamSet).not.toHaveBeenCalled();
  });

  it('archiveWinningSets=true archives every distinct team set that received an award this run (once, even if two medals came from the same set)', async () => {
    await finishTournament({ tournament: tournament(), standings, teamSets: TEAM_SETS, archiveWinningSets: true });
    expect(archiveTeamSet).toHaveBeenCalledTimes(1);
    expect(archiveTeamSet).toHaveBeenCalledWith(expect.objectContaining({ id: 'ts_1' }));
  });

  it('re-finishing the same tournament does not add a duplicate TeamAward (idempotent on the award id)', async () => {
    const first = await finishTournament({ tournament: tournament(), standings, teamSets: TEAM_SETS });
    addTeamAward.mockClear();
    // Simulate the team set now carrying the award from the first finish.
    const teamSetsAfter = TEAM_SETS.map((ts) => (ts.id === 'ts_1' ? first.updatedTeamSets.find((u) => u.id === 'ts_1') || ts : ts));
    await finishTournament({ tournament: tournament(), standings, teamSets: teamSetsAfter });
    expect(addTeamAward).not.toHaveBeenCalled();
  });

  it('collects a failed team-award write in errors without losing the others, and ok is false', async () => {
    addTeamAward.mockImplementationOnce(async () => ({ ok: false, error: { message: 'boom' } }));
    const result = await finishTournament({ tournament: tournament(), standings, teamSets: TEAM_SETS });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.scope === 'teamAward')).toBe(true);
    expect(addTeamAward).toHaveBeenCalledTimes(2); // the second team's write still happened
  });

  it('never throws on a malformed tournament/standings/teamSets combination', async () => {
    await expect(finishTournament({ tournament: null, standings: null, teamSets: null })).resolves.toBeTruthy();
  });
});

// 2026-08-24: "let me create a tournament but make it secret" -- finishing a
// secret tournament must NOT leak its result onto events.winners (Winners
// tab / Hall of Fame) or team_sets.awards (Team Trophy Cabinet, also on
// Hall of Fame), both of which every member can see regardless of whether
// the tournament row itself is hidden from them elsewhere.
describe('finishTournament — secret tournaments defer publishing (2026-08-24)', () => {
  const standings = [
    { entrantId: 'ent_1', points: 10, rank: 1 },
    { entrantId: 'ent_2', points: 6, rank: 2 },
  ];

  it('still flips status to finished, but does not touch events.winners', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    const result = await finishTournament({
      tournament: tournament({ settings: { secret: true } }),
      standings,
      event,
      onUpdateEvent,
      teamSets: TEAM_SETS,
    });
    expect(result.tournament.status).toBe('finished');
    expect(result.deferred).toBe(true);
    expect(result.ok).toBe(true);
    expect(onUpdateEvent).not.toHaveBeenCalled();
  });

  it('does not write any TeamAward while secret', async () => {
    const result = await finishTournament({ tournament: tournament({ settings: { secret: true } }), standings, teamSets: TEAM_SETS });
    expect(addTeamAward).not.toHaveBeenCalled();
    expect(archiveTeamSet).not.toHaveBeenCalled();
    expect(result.updatedTeamSets).toEqual([]);
  });

  it('still computes winners/teamAwards for the caller to use once revealed, it just does not write them', async () => {
    const result = await finishTournament({ tournament: tournament({ settings: { secret: true } }), standings, teamSets: TEAM_SETS });
    expect(result.winners.length).toBeGreaterThan(0);
    expect(result.teamAwards.length).toBeGreaterThan(0);
  });

  it('a non-secret tournament is unaffected (deferred: false, publishes as before)', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };
    const result = await finishTournament({ tournament: tournament(), standings, event, onUpdateEvent, teamSets: TEAM_SETS });
    expect(result.deferred).toBe(false);
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    expect(addTeamAward).toHaveBeenCalled();
  });
});

describe('publishTournamentResults — the reveal-time publish (2026-08-24)', () => {
  const standings = [
    { entrantId: 'ent_1', points: 10, rank: 1 },
    { entrantId: 'ent_2', points: 6, rank: 2 },
  ];

  it('pushes winners onto the event and awards onto the team sets, exactly like a non-secret finish would', async () => {
    const onUpdateEvent = vi.fn(async () => {});
    const event = { id: 'evt-2026', winners: [] };
    mockTableData.events = { data: event, error: null };
    const result = await publishTournamentResults({ tournament: tournament({ settings: { secret: false } }), standings, event, onUpdateEvent, teamSets: TEAM_SETS });
    expect(result.ok).toBe(true);
    expect(onUpdateEvent).toHaveBeenCalledTimes(1);
    const ids = onUpdateEvent.mock.calls[0][0].winners.map((w) => w.id);
    expect(ids).toContain('mg-trn_1-ent_1');
    expect(addTeamAward).toHaveBeenCalledTimes(2);
    expect(result.updatedTeamSets).toHaveLength(1);
  });

  it('called with no event still publishes team awards (a standalone secret tournament, revealed)', async () => {
    const result = await publishTournamentResults({ tournament: tournament({ eventId: null, settings: { secret: false } }), standings, event: null, onUpdateEvent: undefined, teamSets: TEAM_SETS });
    expect(result.ok).toBe(true);
    expect(addTeamAward).toHaveBeenCalledTimes(2);
  });
});
