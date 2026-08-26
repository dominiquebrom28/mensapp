// src/features/mensgames/tournamentResults.js -- the tournament-side mirror
// of `features/quiz/results.js` (see that file's own test,
// `src/test/quiz/results.test.js`, this file follows its pattern almost
// line for line). `fetchTournamentResults()` must project columns
// explicitly (never `select *`), must never reject, and -- the one
// invariant this whole work package exists to protect -- a secret
// tournament must never come back from it, under any input shape.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockTableData = {};
let selectCalls = [];
let mockThrow = false;
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => {
        if (mockThrow) throw new Error('hard offline fetch throw');
        const builder = makeQueryBuilder(mockTableData[table] ?? { data: [], error: null });
        const origSelect = builder.select;
        builder.select = (cols) => { selectCalls.push(cols); return origSelect(cols); };
        return builder;
      },
    },
  };
});

import {
  fetchTournamentResults,
  isMissingTableError,
  isTournamentAlreadyPublished,
  tournamentWinnerPlacement,
} from '../../features/mensgames/tournamentResults.js';

beforeEach(() => {
  mockTableData = {};
  selectCalls = [];
  mockThrow = false;
});

describe('fetchTournamentResults', () => {
  it('projects an explicit, narrow column list -- never `select *`', async () => {
    mockTableData.tournaments = { data: [], error: null };
    await fetchTournamentResults();
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]).not.toBe('*');
    expect(selectCalls[0]).toBe('id,name,event_id,status,entrants,rounds,settings');
    expect(selectCalls[0]).not.toContain('team_set_id');
    expect(selectCalls[0]).not.toContain('created_by');
  });

  it('maps a finished-tournament row to the camelCase shape', async () => {
    const row = {
      id: 'trn_1', name: 'Kroeg Cup', event_id: 'evt-1', status: 'finished',
      entrants: [{ id: 'ent_1', kind: 'player', name: 'Doom' }],
      rounds: [{ id: 'r1', status: 'done', results: { points: { ent_1: 10 } } }],
      settings: { secret: false },
    };
    mockTableData.tournaments = { data: [row], error: null };
    const res = await fetchTournamentResults();
    expect(res.ok).toBe(true);
    expect(res.tournamentResults).toEqual([{
      id: 'trn_1', name: 'Kroeg Cup', eventId: 'evt-1', status: 'finished',
      entrants: [{ id: 'ent_1', kind: 'player', name: 'Doom' }],
      rounds: [{ id: 'r1', status: 'done', results: { points: { ent_1: 10 } } }],
      settings: { secret: false },
    }]);
  });

  it('never rejects on a resolved Supabase error -- returns {ok:false,error,tournamentResults:[]}', async () => {
    mockTableData.tournaments = { data: null, error: { message: 'boom' } };
    await expect(fetchTournamentResults()).resolves.toEqual({ ok: false, error: { message: 'boom' }, tournamentResults: [] });
  });

  it('never rejects on a missing-table error either (mens-games never migrated/unlocked), classified via isMissingTableError', async () => {
    const error = { code: 'PGRST205', message: "Could not find the table 'public.tournaments'" };
    mockTableData.tournaments = { data: null, error };
    const res = await fetchTournamentResults();
    expect(res.ok).toBe(false);
    expect(res.tournamentResults).toEqual([]);
    expect(isMissingTableError(res.error)).toBe(true);
  });

  it('never rejects even on a hard synchronous throw (not a resolved {error})', async () => {
    mockThrow = true;
    await expect(fetchTournamentResults()).resolves.toEqual(
      expect.objectContaining({ ok: false, tournamentResults: [] }),
    );
  });

  it('coerces malformed JSONB fields (non-array entrants/rounds, non-object settings) to safe defaults', async () => {
    mockTableData.tournaments = { data: [{ id: 'trn_1', entrants: 'nope', rounds: null, settings: [] }], error: null };
    const res = await fetchTournamentResults();
    expect(res.tournamentResults[0]).toMatchObject({ entrants: [], rounds: [], settings: {} });
  });

  it('filters out any row missing an id rather than surfacing a broken card', async () => {
    mockTableData.tournaments = { data: [{ name: 'no id' }, { id: 'trn_1', name: 'ok' }], error: null };
    const res = await fetchTournamentResults();
    expect(res.tournamentResults).toHaveLength(1);
    expect(res.tournamentResults[0].id).toBe('trn_1');
  });

  // The one invariant this whole file exists to protect (task brief: "A
  // secret tournament must never appear... assume you will get it wrong and
  // write the test that proves you didn't"). Mirrors
  // `results.test.js`'s identical quiz test.
  it('excludes a finished tournament that is still secret, under every settings shape', async () => {
    mockTableData.tournaments = {
      data: [
        { id: 'trn-secret', status: 'finished', settings: { secret: true } },
        { id: 'trn-public', status: 'finished', settings: { secret: false } },
        { id: 'trn-no-settings', status: 'finished' },
      ],
      error: null,
    };
    const res = await fetchTournamentResults();
    expect(res.tournamentResults.map((t) => t.id)).toEqual(['trn-public', 'trn-no-settings']);
  });

});

// The tournament-side `isQuizAlreadyPublished` -- see this function's own
// comment in tournamentResults.js.
describe('isTournamentAlreadyPublished', () => {
  it('is true once a real Winner row for this tournament exists', () => {
    const winners = [{ id: 'mg-trn_1-ent_1', category: 'x', winner: 'y', detail: '', icon: '🥇' }];
    expect(isTournamentAlreadyPublished({ id: 'trn_1' }, winners)).toBe(true);
  });

  it('is false for a tournament with no matching winner row', () => {
    const winners = [{ id: 'mg-trn_other-ent_1' }];
    expect(isTournamentAlreadyPublished({ id: 'trn_1' }, winners)).toBe(false);
  });

  it('never confuses a different tournament\'s id sharing a numeric prefix', () => {
    const winners = [{ id: 'mg-trn_10-ent_1' }];
    expect(isTournamentAlreadyPublished({ id: 'trn_1' }, winners)).toBe(false);
  });

  it('is defensive against malformed input -- never throws', () => {
    expect(isTournamentAlreadyPublished(null, null)).toBe(false);
    expect(isTournamentAlreadyPublished({ id: 'trn_1' }, 'garbage')).toBe(false);
    expect(isTournamentAlreadyPublished({}, [{ id: 'mg-trn_1-x' }])).toBe(false);
  });
});

// `tournamentWinnerPlacement` -- the deliberately-not-`computeStandings`
// leader pick the AUTO card renders (see tournamentResults.js's module
// header for why it doesn't import the scoring registry).
describe('tournamentWinnerPlacement', () => {
  const ENTRANTS = [
    { id: 'ent_1', kind: 'player', name: 'Doom', avatar: '🙂', memberNames: [] },
    { id: 'ent_2', kind: 'team', name: 'De Kraaien', avatar: '🐦', memberNames: ['Doom', 'Bram'] },
  ];

  it('sums only locked (status==="done") rounds\' frozen results.points, per entrant', () => {
    const tournament = {
      entrants: ENTRANTS,
      rounds: [
        { id: 'r1', status: 'done', results: { points: { ent_1: 5, ent_2: 3 } } },
        { id: 'r2', status: 'done', results: { points: { ent_1: 2, ent_2: 20 } } },
        // Unlocked -- must not contribute, same as computeStandings without includeUnlocked.
        { id: 'r3', status: 'live', results: null },
      ],
    };
    const placement = tournamentWinnerPlacement(tournament);
    expect(placement).toEqual({ name: 'De Kraaien', detail: '23 pts · Doom, Bram', isTeam: true, avatar: '🐦' });
  });

  it('returns null when no round has been locked yet -- nothing to show', () => {
    const tournament = { entrants: ENTRANTS, rounds: [{ id: 'r1', status: 'live', results: null }] };
    expect(tournamentWinnerPlacement(tournament)).toBeNull();
  });

  it('returns null for a tournament with no rounds at all', () => {
    expect(tournamentWinnerPlacement({ entrants: ENTRANTS, rounds: [] })).toBeNull();
  });

  it('builds a plain "N pts" detail for a player entrant (no member list)', () => {
    const tournament = { entrants: ENTRANTS, rounds: [{ id: 'r1', status: 'done', results: { points: { ent_1: 9 } } }] };
    expect(tournamentWinnerPlacement(tournament)).toEqual({ name: 'Doom', detail: '9 pts', isTeam: false, avatar: '🙂' });
  });

  it('is defensive against malformed input -- never throws', () => {
    expect(tournamentWinnerPlacement(null)).toBeNull();
    expect(tournamentWinnerPlacement({})).toBeNull();
    expect(tournamentWinnerPlacement({ entrants: 'nope', rounds: 'nope' })).toBeNull();
    expect(tournamentWinnerPlacement({ entrants: ENTRANTS, rounds: [{ status: 'done', results: { points: { ghost: 5 } } }] })).toBeNull();
  });
});
