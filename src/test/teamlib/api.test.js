import { describe, it, expect, vi, beforeEach } from 'vitest'

// Vitest hoists vi.mock calls above imports, and factories may only
// reference outer bindings whose name starts with "mock" (its documented
// escape hatch for this rule) -- so table responses are swapped per-test by
// reassigning `mockTableData` rather than by re-mocking the module.
let mockTableData = {}
vi.mock('../../supabase.js', async () => {
  const { makeQueryBuilder, makeChannel } = await import('../mocks/supabaseMock.js')
  return {
    supabase: {
      from: table => makeQueryBuilder(mockTableData[table] ?? { data: [], error: null }),
      channel: () => makeChannel(),
      removeChannel: () => {},
      storage: { from: () => makeQueryBuilder({ data: [], error: null }) },
    },
  }
})

import {
  fetchTeamSets,
  saveTeamSet,
  deleteTeamSet,
  archiveTeamSet,
  unarchiveTeamSet,
  linkTeamSetToEvent,
  unlinkTeamSetFromEvent,
  addTeamAward,
} from '../../features/teamlib/api.js'

beforeEach(() => {
  mockTableData = {}
})

const ROW = {
  id: 'ts_1',
  name: 'Groep A',
  category: 'Quiz ronde 1',
  teams: [{ id: 'tm_1', name: 'Team 1', avatar: '🦁', members: ['Doom'], captain: null }],
  event_ids: ['evt-2026'],
  status: 'active',
  awards: [],
  created_by: 'Doom',
  created_at: '2026-08-01T00:00:00Z',
  archived_at: null,
}

describe('teamlib/api row mapping', () => {
  it('fetchTeamSets maps snake_case rows to the camelCase TeamSet shape', async () => {
    mockTableData = { team_sets: { data: [ROW], error: null } }
    const sets = await fetchTeamSets()
    expect(sets).toEqual([
      {
        id: 'ts_1',
        name: 'Groep A',
        category: 'Quiz ronde 1',
        teams: ROW.teams,
        eventIds: ['evt-2026'],
        status: 'active',
        awards: [],
        createdBy: 'Doom',
        createdAt: '2026-08-01T00:00:00Z',
        archivedAt: null,
      },
    ])
  })

  it('fetchTeamSets is defensive against a malformed row (hand-edited JSONB)', async () => {
    mockTableData = {
      team_sets: { data: [{ id: 'ts_bad', name: null, teams: 'oops', event_ids: null, awards: undefined }], error: null },
    }
    const sets = await fetchTeamSets()
    expect(sets).toEqual([
      {
        id: 'ts_bad',
        name: '',
        category: '',
        teams: [],
        eventIds: [],
        status: 'active',
        awards: [],
        createdBy: '',
        createdAt: '',
        archivedAt: null,
      },
    ])
  })

  it('fetchTeamSets degrades to [] on a Supabase error rather than throwing', async () => {
    mockTableData = { team_sets: { data: null, error: { message: 'boom' } } }
    await expect(fetchTeamSets()).resolves.toEqual([])
  })

  it('saveTeamSet round-trips a JS-shape object back after upsert', async () => {
    const set = { id: 'ts_2', name: 'Groep B', category: '', teams: [], eventIds: ['evt-x'], status: 'active', awards: [], createdBy: '', createdAt: '2026-08-01T00:00:00Z', archivedAt: null }
    const result = await saveTeamSet(set)
    expect(result.ok).toBe(true)
    expect(result.teamSet.eventIds).toEqual(['evt-x'])
  })

  it('saveTeamSet reports failure on a Supabase error', async () => {
    mockTableData = { team_sets: { data: null, error: { message: 'nope' } } }
    const result = await saveTeamSet({ id: 'ts_3', teams: [], eventIds: [], awards: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('teamlib/api archive/restore lifecycle (#10)', () => {
  it('archiveTeamSet sets status=archived and stamps archivedAt', async () => {
    const set = { id: 'ts_1', name: 'Groep A', teams: [], eventIds: [], status: 'active', awards: [], createdBy: '', createdAt: '2026-08-01T00:00:00Z', archivedAt: null }
    const result = await archiveTeamSet(set)
    expect(result.ok).toBe(true)
    expect(result.teamSet.status).toBe('archived')
    expect(result.teamSet.archivedAt).toBeTruthy()
  })

  it('unarchiveTeamSet restores status=active and clears archivedAt', async () => {
    const set = { id: 'ts_1', name: 'Groep A', teams: [], eventIds: [], status: 'archived', awards: [], createdBy: '', createdAt: '2026-08-01T00:00:00Z', archivedAt: '2026-08-10T00:00:00Z' }
    const result = await unarchiveTeamSet(set)
    expect(result.ok).toBe(true)
    expect(result.teamSet.status).toBe('active')
    expect(result.teamSet.archivedAt).toBeNull()
  })

  it('a full archive-then-restore round trip returns the set to its original active shape (minus timestamps)', async () => {
    const original = { id: 'ts_1', name: 'Groep A', category: '', teams: [], eventIds: ['evt-1'], status: 'active', awards: [], createdBy: '', createdAt: '2026-08-01T00:00:00Z', archivedAt: null }
    const archived = (await archiveTeamSet(original)).teamSet
    expect(archived.status).toBe('archived')
    const restored = (await unarchiveTeamSet(archived)).teamSet
    expect(restored.status).toBe('active')
    expect(restored.archivedAt).toBeNull()
    expect(restored.eventIds).toEqual(['evt-1']) // untouched by the archive round trip
  })
})

describe('teamlib/api link/unlink to an event', () => {
  it('linkTeamSetToEvent adds the event id once (no duplicate on repeat link)', async () => {
    const set = { id: 'ts_1', teams: [], eventIds: ['evt-1'], awards: [] }
    const once = (await linkTeamSetToEvent(set, 'evt-2')).teamSet
    expect(once.eventIds.sort()).toEqual(['evt-1', 'evt-2'])
    const twice = (await linkTeamSetToEvent(once, 'evt-2')).teamSet
    expect(twice.eventIds.sort()).toEqual(['evt-1', 'evt-2'])
  })

  it('unlinkTeamSetFromEvent removes only the given event id', async () => {
    const set = { id: 'ts_1', teams: [], eventIds: ['evt-1', 'evt-2'], awards: [] }
    const result = await unlinkTeamSetFromEvent(set, 'evt-1')
    expect(result.teamSet.eventIds).toEqual(['evt-2'])
  })
})

describe('teamlib/api addTeamAward', () => {
  it('appends an award without disturbing existing ones', async () => {
    const set = { id: 'ts_1', teams: [], eventIds: [], awards: [{ id: 'aw_1' }] }
    const result = await addTeamAward(set, { id: 'aw_2', teamId: 'tm_1', label: '🏆 Winnaar' })
    expect(result.teamSet.awards.map(a => a.id)).toEqual(['aw_1', 'aw_2'])
  })
})

describe('teamlib/api deleteTeamSet', () => {
  it('reports success on a clean delete', async () => {
    const result = await deleteTeamSet('ts_1')
    expect(result.ok).toBe(true)
  })

  it('reports failure on a Supabase error', async () => {
    mockTableData = { team_sets: { data: null, error: { message: 'nope' } } }
    const result = await deleteTeamSet('ts_1')
    expect(result.ok).toBe(false)
  })
})
