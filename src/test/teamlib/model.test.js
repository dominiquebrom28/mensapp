import { describe, it, expect } from 'vitest'
import {
  blankTeamSet,
  blankTeam,
  setCaptain,
  removeMember,
  teamSetSummary,
  namesFromUsers,
  mergeNames,
  generateTeams,
  resizeTeams,
  splitPreview,
} from '../../features/teamlib/model.js'

describe('blankTeamSet / blankTeam', () => {
  it('produces a fresh active set with empty collections', () => {
    const set = blankTeamSet()
    expect(set.status).toBe('active')
    expect(set.teams).toEqual([])
    expect(set.eventIds).toEqual([])
    expect(set.awards).toEqual([])
    expect(typeof set.id).toBe('string')
  })

  it('allows overrides', () => {
    const set = blankTeamSet({ name: 'Groep A' })
    expect(set.name).toBe('Groep A')
  })

  it('blankTeam gives each team a distinct id and a default name', () => {
    const t0 = blankTeam(0, '🦁')
    const t1 = blankTeam(1, '🐻')
    expect(t0.name).toBe('Team 1')
    expect(t1.name).toBe('Team 2')
    expect(t0.avatar).toBe('🦁')
    expect(t0.captain).toBeNull()
    expect(t0.members).toEqual([])
  })
})

describe('setCaptain (#8)', () => {
  it('crowns a member', () => {
    const team = { id: 'tm_1', name: 'Team 1', members: ['Doom', 'Bram'], captain: null }
    const next = setCaptain(team, 'Doom')
    expect(next.captain).toBe('Doom')
  })

  it('toggles off when the same name is set again', () => {
    const team = { id: 'tm_1', name: 'Team 1', members: ['Doom'], captain: 'Doom' }
    const next = setCaptain(team, 'Doom')
    expect(next.captain).toBeNull()
  })

  it('refuses to crown someone who is not a member (defends against stale/hand-edited data)', () => {
    const team = { id: 'tm_1', name: 'Team 1', members: ['Doom'], captain: null }
    const next = setCaptain(team, 'Ghost')
    expect(next.captain).toBeNull()
    expect(next).toBe(team) // unchanged reference -- no-op
  })
})

describe('removeMember clears captaincy (#8)', () => {
  it('removes the member from the roster', () => {
    const team = { id: 'tm_1', name: 'Team 1', members: ['Doom', 'Bram'], captain: null }
    const next = removeMember(team, 'Bram')
    expect(next.members).toEqual(['Doom'])
  })

  it('clears captaincy when the removed member was captain', () => {
    const team = { id: 'tm_1', name: 'Team 1', members: ['Doom', 'Bram'], captain: 'Doom' }
    const next = removeMember(team, 'Doom')
    expect(next.members).toEqual(['Bram'])
    expect(next.captain).toBeNull()
  })

  it('leaves captaincy alone when a non-captain member is removed', () => {
    const team = { id: 'tm_1', name: 'Team 1', members: ['Doom', 'Bram'], captain: 'Doom' }
    const next = removeMember(team, 'Bram')
    expect(next.captain).toBe('Doom')
  })
})

describe('teamSetSummary', () => {
  it('counts teams and members', () => {
    const set = { teams: [{ members: ['a', 'b'] }, { members: ['c'] }] }
    expect(teamSetSummary(set)).toEqual({ teamCount: 2, memberCount: 3 })
  })

  it('is defensive against hand-edited JSONB (teams not an array, members missing)', () => {
    expect(teamSetSummary({ teams: 'oops' })).toEqual({ teamCount: 0, memberCount: 0 })
    expect(teamSetSummary({ teams: [{ }, { members: null }] })).toEqual({ teamCount: 2, memberCount: 0 })
    expect(teamSetSummary(null)).toEqual({ teamCount: 0, memberCount: 0 })
    expect(teamSetSummary(undefined)).toEqual({ teamCount: 0, memberCount: 0 })
  })
})

describe('namesFromUsers / mergeNames (select-all, #6)', () => {
  it('prefers display_name, falls back to username', () => {
    const users = [{ username: 'doom', display_name: 'Doom' }, { username: 'bram' }]
    expect(namesFromUsers(users)).toEqual(['Doom', 'bram'])
  })

  it('is defensive against non-array input', () => {
    expect(namesFromUsers(null)).toEqual([])
    expect(namesFromUsers(undefined)).toEqual([])
  })

  it('mergeNames unions without duplicating, preserving order', () => {
    expect(mergeNames(['Doom'], ['Doom', 'Bram', 'Tim'])).toEqual(['Doom', 'Bram', 'Tim'])
  })

  it('select-all: merging every app user name into an empty roster yields all of them, once each', () => {
    const users = [{ display_name: 'Doom' }, { display_name: 'Bram' }, { username: 'tim' }]
    const all = namesFromUsers(users)
    const selected = mergeNames([], all)
    expect(selected).toEqual(['Doom', 'Bram', 'tim'])
    // Selecting all twice in a row (e.g. re-clicking) stays idempotent.
    expect(mergeNames(selected, all)).toEqual(selected)
  })
})

describe('generateTeams (2026-08-25 rebuild — brackets exist first, generate only fills empty seats)', () => {
  const noShuffle = arr => arr // deterministic: "shuffle" is the identity

  it('with no existing members, distributes everyone team-by-team up to teamSize (matches legacy chunking)', () => {
    const teams = generateTeams({
      participants: ['a', 'b', 'c', 'd', 'e'],
      teamSize: 2,
      shuffle: noShuffle,
    })
    expect(teams).toHaveLength(3)
    expect(teams[0].members).toEqual(['a', 'b'])
    expect(teams[1].members).toEqual(['c', 'd'])
    expect(teams[2].members).toEqual(['e'])
  })

  it('a manually-placed member stays on their bracket and the rest fill in around them', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null, members: ['d'] },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null, members: [] },
    ]
    const teams = generateTeams({
      participants: ['a', 'b', 'c', 'd'],
      teamSize: 2,
      existingTeams,
      shuffle: noShuffle,
    })
    const teamA = teams.find(t => t.id === 'tm_A')
    expect(teamA.members).toContain('d')
    expect(teams.flatMap(t => t.members).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('placed members stay put across a re-roll even when the shuffle order changes (no pool left to reshuffle)', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null, members: [] },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null, members: ['d'] },
    ]
    const participants = ['a', 'b', 'c', 'd']

    const roll1 = generateTeams({ participants, teamSize: 2, existingTeams, shuffle: arr => [...arr].reverse() })
    const roll2 = generateTeams({ participants, teamSize: 2, existingTeams: roll1, shuffle: arr => arr })

    expect(roll1.find(t => t.id === 'tm_B').members).toContain('d')
    // Second roll is a no-op: everyone was already seated after roll1.
    expect(roll2).toEqual(roll1)
  })

  it('re-rolling repeatedly never moves anyone already seated -- generate only ever fills empty seats', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null, members: ['a', 'b'] },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null, members: [] },
    ]
    const participants = ['a', 'b', 'c', 'd', 'e', 'f']
    for (let i = 0; i < 5; i++) {
      const teams = generateTeams({ participants, teamSize: 3, existingTeams })
      const teamA = teams.find(t => t.id === 'tm_A')
      expect(teamA.members).toEqual(expect.arrayContaining(['a', 'b']))
    }
  })

  it('a captain keeps captaincy across a re-roll since generate never moves an already-seated member', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: 'a', members: ['a'] },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null, members: [] },
    ]
    const teams = generateTeams({
      participants: ['a', 'b'],
      teamSize: 2,
      existingTeams,
      shuffle: noShuffle,
    })
    const teamA = teams.find(t => t.id === 'tm_A')
    expect(teamA.members).toContain('a')
    expect(teamA.captain).toBe('a')
  })

  it('is defensive: never throws on empty/garbage input', () => {
    expect(() => generateTeams({})).not.toThrow()
    expect(() => generateTeams({ participants: null, existingTeams: null })).not.toThrow()
    expect(generateTeams({ participants: [], teamSize: 0 })).toEqual([])
  })
})

describe('generateTeams from a team count (2026-08-24 -- "pick the amount of teams")', () => {
  const noShuffle = arr => arr

  it('builds exactly `teamCount` teams regardless of how many people that implies per team', () => {
    const teams = generateTeams({
      participants: ['a', 'b', 'c', 'd', 'e'],
      teamCount: 4,
      shuffle: noShuffle,
    })
    expect(teams).toHaveLength(4)
    expect(teams.flatMap(t => t.members).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('distributes an uneven split as evenly as possible (7 people / 3 teams -> sizes 3/2/2, nobody left out)', () => {
    const teams = generateTeams({
      participants: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      teamCount: 3,
      shuffle: noShuffle,
    })
    const sizes = teams.map(t => t.members.length).sort((x, y) => y - x)
    expect(sizes).toEqual([3, 2, 2])
    expect(teams.flatMap(t => t.members)).toHaveLength(7)
  })

  it('more teams than people leaves the extra teams empty instead of erroring', () => {
    const teams = generateTeams({
      participants: ['a', 'b'],
      teamCount: 5,
      shuffle: noShuffle,
    })
    expect(teams).toHaveLength(5)
    expect(teams.flatMap(t => t.members).sort()).toEqual(['a', 'b'])
    expect(teams.filter(t => t.members.length === 0)).toHaveLength(3)
  })

  it('a manually-placed member under a fixed team count is honoured, and re-rolling only fills the remaining pool', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null, members: [] },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null, members: [] },
      { id: 'tm_C', name: 'Team C', avatar: '🦊', captain: null, members: ['a'] },
    ]
    const participants = ['a', 'b', 'c', 'd', 'e', 'f']
    let teams = generateTeams({ participants, teamCount: 3, existingTeams })
    for (let i = 0; i < 4; i++) {
      teams = generateTeams({ participants, teamCount: 3, existingTeams: teams })
      expect(teams).toHaveLength(3)
      expect(teams.find(t => t.id === 'tm_C').members).toContain('a')
      expect(teams.flatMap(t => t.members).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    }
  })

  it('a re-roll of a count-driven set stays balanced (does not fall back to size-chunking just because existingTeams is now present)', () => {
    const first = generateTeams({ participants: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], teamCount: 3, shuffle: noShuffle })
    const reroll = generateTeams({ participants: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], teamCount: 3, existingTeams: first, shuffle: arr => [...arr].reverse() })
    const sizes = reroll.map(t => t.members.length).sort((x, y) => y - x)
    expect(sizes).toEqual([3, 2, 2])
  })

  it('teamCount takes priority over teamSize if both are somehow passed', () => {
    const teams = generateTeams({ participants: ['a', 'b', 'c', 'd'], teamCount: 4, teamSize: 2, shuffle: noShuffle })
    expect(teams).toHaveLength(4)
  })

  it('is defensive against a garbage teamCount', () => {
    expect(() => generateTeams({ participants: ['a'], teamCount: 'lots' })).not.toThrow()
    expect(generateTeams({ participants: ['a'], teamCount: 'lots' })).toHaveLength(1)
    expect(generateTeams({ participants: ['a'], teamCount: 0 })).toHaveLength(1)
  })

  it('a newly added participant fills into the emptiest bracket on the next generate, without disturbing anyone already seated', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null, members: ['a', 'b'] },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null, members: ['c'] },
    ]
    const teams = generateTeams({ participants: ['a', 'b', 'c', 'd'], teamCount: 2, existingTeams, shuffle: noShuffle })
    expect(teams.find(t => t.id === 'tm_A').members).toEqual(['a', 'b'])
    expect(teams.find(t => t.id === 'tm_B').members).toEqual(['c', 'd'])
  })
})

describe('resizeTeams (2026-08-25 -- "creating the amount of selected brackets" live)', () => {
  const shells = (...members) => members.map((m, i) => ({ id: `tm_${i}`, name: `Team ${i + 1}`, avatar: '🎯', captain: null, members: m }))

  it('growing appends fresh empty brackets, keeping the existing ones untouched', () => {
    const teams = shells(['a'], [])
    const next = resizeTeams(teams, 4, ['🦁', '🐻', '🦊', '🐺'])
    expect(next).toHaveLength(4)
    expect(next[0]).toBe(teams[0])
    expect(next[1]).toBe(teams[1])
    expect(next[2].members).toEqual([])
    expect(next[3].members).toEqual([])
  })

  it('assigns growth brackets avatars not already in use', () => {
    const teams = [{ id: 'tm_0', name: 'Team 1', avatar: '🦁', captain: null, members: [] }]
    const next = resizeTeams(teams, 3, ['🦁', '🐻', '🦊'])
    expect(next.map(t => t.avatar)).toEqual(['🦁', '🐻', '🦊'])
  })

  it('shrinking drops brackets off the end without touching the survivors', () => {
    const teams = shells(['a'], ['b'], ['c'])
    const next = resizeTeams(teams, 2)
    expect(next).toEqual([teams[0], teams[1]])
  })

  it('shrinking a populated bracket does not delete its members from existence -- the caller derives "unassigned" from participants minus who\'s still seated, so they resurface in the pool', () => {
    const teams = shells(['a', 'b'], ['c'])
    const next = resizeTeams(teams, 1)
    expect(next).toHaveLength(1)
    const stillSeated = new Set(next.flatMap(t => t.members))
    const allParticipants = ['a', 'b', 'c']
    const backInPool = allParticipants.filter(p => !stillSeated.has(p))
    expect(backInPool).toEqual(['c'])
  })

  it('is a no-op (same reference) when the count already matches', () => {
    const teams = shells(['a'])
    expect(resizeTeams(teams, 1)).toBe(teams)
  })

  it('is defensive: never throws on garbage input', () => {
    expect(() => resizeTeams(null, 3)).not.toThrow()
    expect(resizeTeams(null, 2)).toHaveLength(2)
    expect(resizeTeams(undefined, 'lots')).toHaveLength(0)
    expect(resizeTeams([{ id: 'a' }], -1)).toEqual([])
  })
})

describe('splitPreview (2026-08-24 -- "say what will happen before he commits")', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(splitPreview(6, 3)).toEqual([2, 2, 2])
  })

  it('gives the remainder to the first teams, largest-first', () => {
    expect(splitPreview(7, 3)).toEqual([3, 2, 2])
    expect(splitPreview(10, 4)).toEqual([3, 3, 2, 2])
  })

  it('more teams than people -> some teams preview at 0', () => {
    expect(splitPreview(2, 5)).toEqual([1, 1, 0, 0, 0])
  })

  it('is defensive: never throws, always returns `count` entries', () => {
    expect(splitPreview(0, 3)).toEqual([0, 0, 0])
    expect(splitPreview(null, 3)).toEqual([0, 0, 0])
    expect(splitPreview(5, 0)).toHaveLength(1)
    expect(splitPreview(5, -2)).toHaveLength(1)
    expect(() => splitPreview('garbage', 'garbage')).not.toThrow()
  })
})
