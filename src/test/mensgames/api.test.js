// src/features/mensgames/api.js -- row mapping + error handling, same
// pattern as src/test/teamlib/api.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockTableData = {};
let mockChannelCalls = [];
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder } = await import('../mocks/supabaseMock.js');
  return {
    supabase: {
      from: (table) => makeQueryBuilder(mockTableData[table] ?? { data: [], error: null }),
      channel: (name) => {
        const handlers = [];
        const ch = {
          on: (event, filter, cb) => { handlers.push({ event, filter, cb }); return ch; },
          subscribe: () => ch,
        };
        mockChannelCalls.push({ name, handlers, ch });
        return ch;
      },
      removeChannel: vi.fn(),
    },
  };
});

import { deleteTournament, fetchTournament, fetchTournaments, isMissingTableError, saveTournament, subscribeTournament } from '../../features/mensgames/api.js';

beforeEach(() => {
  mockTableData = {};
  mockChannelCalls = [];
});

const ROW = {
  id: 'trn_1',
  name: 'Mens-Games 2026',
  event_id: 'evt-2026',
  status: 'live',
  entrants: [{ id: 'ent_1', kind: 'team', name: 'Team A' }],
  rounds: [],
  settings: { showLivePreview: true },
  team_set_id: 'ts_1',
  created_by: 'Doom',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
};

describe('mensgames/api row mapping', () => {
  it('fetchTournaments maps snake_case rows to the camelCase Tournament shape', async () => {
    mockTableData.tournaments = { data: [ROW], error: null };
    const res = await fetchTournaments();
    expect(res.ok).toBe(true);
    expect(res.tournaments).toEqual([{
      id: 'trn_1', name: 'Mens-Games 2026', eventId: 'evt-2026', status: 'live',
      entrants: ROW.entrants, rounds: [], settings: { showLivePreview: true },
      teamSetId: 'ts_1', createdBy: 'Doom', createdAt: ROW.created_at, updatedAt: ROW.updated_at,
    }]);
  });

  it('fetchTournaments degrades to [] on a Supabase error rather than throwing', async () => {
    mockTableData.tournaments = { data: null, error: { message: 'boom' } };
    const res = await fetchTournaments();
    expect(res.ok).toBe(false);
    expect(res.tournaments).toEqual([]);
  });

  it('fetchTournament maps a single row', async () => {
    mockTableData.tournaments = { data: ROW, error: null };
    const res = await fetchTournament('trn_1');
    expect(res.ok).toBe(true);
    expect(res.tournament.name).toBe('Mens-Games 2026');
  });

  it('saveTournament upserts a full row and reports failure on a Supabase error', async () => {
    mockTableData.tournaments = { data: null, error: { message: 'nope' } };
    const res = await saveTournament({ id: 'trn_2', name: 'Nieuw' });
    expect(res.ok).toBe(false);
  });

  it('an unknown/malformed status column falls back to "draft" rather than crashing a reader', async () => {
    mockTableData.tournaments = { data: [{ ...ROW, status: 'garbage' }], error: null };
    const res = await fetchTournaments();
    expect(res.tournaments[0].status).toBe('draft');
  });

  it('deleteTournament reports failure on a Supabase error', async () => {
    mockTableData.tournaments = { data: null, error: { message: 'nope' } };
    const res = await deleteTournament('trn_1');
    expect(res.ok).toBe(false);
  });

  // REGRESSION (owner-reported, 2026-08-21g): a missing `tournaments` table
  // (unrun migration) was surfacing as "Controleer je verbinding" -- the UI
  // had no way to distinguish it from a real network failure because
  // MensGamesShell.jsx used to discard the actual error and keep only a
  // boolean. `isMissingTableError` is that distinction, at the one place
  // that already has the real Supabase error object.
  describe('isMissingTableError', () => {
    it('is true for PostgREST’s PGRST205 ("table not in schema cache")', () => {
      expect(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.tournaments' in the schema cache" })).toBe(true);
    });

    it('is true for the underlying Postgres 42P01 (undefined_table) SQLSTATE', () => {
      expect(isMissingTableError({ code: '42P01', message: 'relation "tournaments" does not exist' })).toBe(true);
    });

    it('is false for a generic/network error', () => {
      expect(isMissingTableError({ message: 'Failed to fetch' })).toBe(false);
    });

    it('is false for null/undefined (no error at all)', () => {
      expect(isMissingTableError(null)).toBe(false);
      expect(isMissingTableError(undefined)).toBe(false);
    });

    it('is false for an unrelated Postgres error code', () => {
      expect(isMissingTableError({ code: '23505', message: 'duplicate key value' })).toBe(false);
    });
  });

  it('subscribeTournament registers UPDATE and DELETE postgres_changes handlers scoped to the tournament id, and returns an idempotent unsubscribe', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeTournament('trn_1', onChange);
    expect(mockChannelCalls).toHaveLength(1);
    const { handlers } = mockChannelCalls[0];
    expect(handlers.some((h) => h.event === 'postgres_changes' && h.filter.event === 'UPDATE' && h.filter.filter === 'id=eq.trn_1')).toBe(true);
    expect(handlers.some((h) => h.event === 'postgres_changes' && h.filter.event === 'DELETE')).toBe(true);

    const updateHandler = handlers.find((h) => h.filter.event === 'UPDATE');
    updateHandler.cb({ new: ROW });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'trn_1' }));

    const deleteHandler = handlers.find((h) => h.filter.event === 'DELETE');
    deleteHandler.cb({});
    expect(onChange).toHaveBeenCalledWith(null);

    expect(() => { unsubscribe(); unsubscribe(); }).not.toThrow();
  });
});
