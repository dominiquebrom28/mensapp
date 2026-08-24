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

describe('generateTeams (#7 — pin + fill)', () => {
  const noShuffle = arr => arr // deterministic: "shuffle" is the identity

  it('with no pins, distributes everyone team-by-team up to teamSize (matches legacy chunking)', () => {
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

  it('pinned members are seated on their pinned team first', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null },
    ]
    const teams = generateTeams({
      participants: ['a', 'b', 'c', 'd'],
      teamSize: 2,
      existingTeams,
      pins: { d: 'tm_A' },
      shuffle: noShuffle,
    })
    const teamA = teams.find(t => t.id === 'tm_A')
    expect(teamA.members).toContain('d')
  })

  it('pinned members stay put across a re-roll even when the shuffle order changes', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null },
    ]
    const pins = { d: 'tm_B' }
    const participants = ['a', 'b', 'c', 'd']

    const roll1 = generateTeams({ participants, teamSize: 2, existingTeams, pins, shuffle: arr => [...arr].reverse() })
    const roll2 = generateTeams({ participants, teamSize: 2, existingTeams: roll1, pins, shuffle: arr => arr })

    const teamB1 = roll1.find(t => t.id === 'tm_B')
    const teamB2 = roll2.find(t => t.id === 'tm_B')
    expect(teamB1.members).toContain('d')
    expect(teamB2.members).toContain('d')
  })

  it('re-roll only reshuffles the unpinned pool -- pinned member count on their team never drops', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null },
    ]
    const pins = { a: 'tm_A', b: 'tm_A' }
    const participants = ['a', 'b', 'c', 'd', 'e', 'f']
    for (let i = 0; i < 5; i++) {
      const teams = generateTeams({ participants, teamSize: 3, existingTeams, pins })
      const teamA = teams.find(t => t.id === 'tm_A')
      expect(teamA.members).toEqual(expect.arrayContaining(['a', 'b']))
    }
  })

  it('a captain who gets reshuffled off their team loses captaincy', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: 'a' },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null },
    ]
    // Force every unpinned participant onto team B by reversing after 'a'
    // is pinned onto team B, pulling the captain slot away from team A.
    const teams = generateTeams({
      participants: ['a', 'b'],
      teamSize: 2,
      existingTeams,
      pins: { a: 'tm_B' },
      shuffle: noShuffle,
    })
    const teamA = teams.find(t => t.id === 'tm_A')
    expect(teamA.members).not.toContain('a')
    expect(teamA.captain).toBeNull()
  })

  it('is defensive: never throws on empty/garbage input', () => {
    expect(() => generateTeams({})).not.toThrow()
    expect(() => generateTeams({ participants: null, pins: null, existingTeams: null })).not.toThrow()
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

  it('pins are honoured under a fixed team count, and re-rolling only reshuffles the unpinned pool', () => {
    const existingTeams = [
      { id: 'tm_A', name: 'Team A', avatar: '🦁', captain: null },
      { id: 'tm_B', name: 'Team B', avatar: '🐻', captain: null },
      { id: 'tm_C', name: 'Team C', avatar: '🦊', captain: null },
    ]
    const pins = { a: 'tm_C' }
    const participants = ['a', 'b', 'c', 'd', 'e', 'f']
    for (let i = 0; i < 5; i++) {
      const teams = generateTeams({ participants, teamCount: 3, existingTeams, pins })
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
