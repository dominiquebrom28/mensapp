// Tests for App.jsx's un-exported pure helpers, reached via
// extractFromAppSource.js (see that file for how/why). These run against
// the real, current source text of App.jsx -- not a re-implementation.
//
// FOLLOW-UP (not done in this pass, per task scope: no edits to App.jsx):
// the cleanest fix is a one-line change per helper, e.g.
//   const getYouTubeId=url=>{...};   ->   export const getYouTubeId=url=>{...};
// which would let every test below `import` the real thing directly and
// delete extractFromAppSource.js entirely. Worth doing for:
//   getYouTubeId, getSpotifyTrackId, isSpotifyUrl, isYouTubeUrl,
//   hasAdmin, hasOrg, getUA, getDisplayName, computeMemberStats,
//   normalizeQuiz
// all ten are pure, side-effect-free, and already reachable by this
// extraction technique -- exporting them is a no-risk change (an `export`
// keyword doesn't alter behavior) that would remove the fragility called
// out in extractFromAppSource.js's docblock.
import { describe, it, expect } from 'vitest'
import { extractFromApp } from './extractFromAppSource.js'

describe('getYouTubeId', () => {
  const getYouTubeId = extractFromApp('getYouTubeId')

  it('parses a standard watch URL', () => {
    expect(getYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses a watch URL with extra query params before v=', () => {
    expect(getYouTubeId('https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })

  it('parses a youtu.be short link', () => {
    expect(getYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses an embed URL', () => {
    expect(getYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses a Shorts URL', () => {
    expect(getYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses a youtu.be link with a trailing query string', () => {
    expect(getYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for a non-YouTube URL', () => {
    expect(getYouTubeId('https://vimeo.com/12345')).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(getYouTubeId(undefined)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(getYouTubeId('')).toBeNull()
  })

  it('returns null for a video id shorter than 11 characters', () => {
    expect(getYouTubeId('https://youtu.be/short')).toBeNull()
  })
})

describe('getSpotifyTrackId', () => {
  const getSpotifyTrackId = extractFromApp('getSpotifyTrackId')

  it('parses a standard track URL', () => {
    expect(getSpotifyTrackId('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe(
      '4uLU6hMCjMI75M1A2tKUQC',
    )
  })

  it('parses an intl-prefixed track URL', () => {
    expect(
      getSpotifyTrackId('https://open.spotify.com/intl-nl/track/4uLU6hMCjMI75M1A2tKUQC'),
    ).toBe('4uLU6hMCjMI75M1A2tKUQC')
  })

  it('parses a track URL with a query string', () => {
    expect(
      getSpotifyTrackId('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123'),
    ).toBe('4uLU6hMCjMI75M1A2tKUQC')
  })

  it('returns null for a Spotify album/playlist URL (no /track/)', () => {
    expect(getSpotifyTrackId('https://open.spotify.com/album/abcdefg')).toBeNull()
  })

  it('returns null for a non-Spotify URL', () => {
    expect(getSpotifyTrackId('https://youtu.be/dQw4w9WgXcQ')).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(getSpotifyTrackId(undefined)).toBeNull()
  })
})

describe('isSpotifyUrl / isYouTubeUrl', () => {
  const isSpotifyUrl = extractFromApp('isSpotifyUrl')
  const isYouTubeUrl = extractFromApp('isYouTubeUrl')

  it('isSpotifyUrl recognizes spotify.com links', () => {
    expect(isSpotifyUrl('https://open.spotify.com/track/abc')).toBe(true)
  })

  it('isSpotifyUrl rejects non-Spotify links', () => {
    expect(isSpotifyUrl('https://youtu.be/abc')).toBe(false)
  })

  it('isSpotifyUrl handles undefined/empty without throwing', () => {
    expect(isSpotifyUrl(undefined)).toBe(false)
    expect(isSpotifyUrl('')).toBe(false)
  })

  it('isYouTubeUrl recognizes youtube.com and youtu.be links', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isYouTubeUrl('https://youtu.be/abc')).toBe(true)
  })

  it('isYouTubeUrl rejects non-YouTube links', () => {
    expect(isYouTubeUrl('https://open.spotify.com/track/abc')).toBe(false)
  })

  it('isYouTubeUrl handles undefined/empty without throwing', () => {
    expect(isYouTubeUrl(undefined)).toBe(false)
    expect(isYouTubeUrl('')).toBe(false)
  })
})

describe('hasAdmin / hasOrg', () => {
  const hasAdmin = extractFromApp('hasAdmin')
  const hasOrg = extractFromApp('hasOrg')

  it.each([
    ['admin', true],
    ['admin+org', true],
    ['org', false],
    ['organisation', false],
    ['member', false],
    ['pending', false],
  ])('hasAdmin({role: %s}) -> %s', (role, expected) => {
    expect(hasAdmin({ role })).toBe(expected)
  })

  it.each([
    ['org', true],
    ['admin+org', true],
    ['organisation', true],
    ['admin', false],
    ['member', false],
  ])('hasOrg({role: %s}) -> %s', (role, expected) => {
    expect(hasOrg({ role })).toBe(expected)
  })

  it('handles a null/undefined user without throwing', () => {
    expect(hasAdmin(undefined)).toBe(false)
    expect(hasOrg(null)).toBe(false)
  })
})

describe('getUA / getDisplayName', () => {
  const getUA = extractFromApp('getUA')
  const getDisplayName = extractFromApp('getDisplayName')
  const users = [
    { username: 'Doom', animal_avatar: 3, photo_url: 'https://x.test/doom.jpg', display_name: 'Dom' },
    { username: 'Bram', avatar: 5, photo_url: '' },
  ]

  it('getUA finds a user case-insensitively and prefers animal_avatar over avatar', () => {
    expect(getUA('doom', users)).toEqual({ index: 3, photoUrl: 'https://x.test/doom.jpg' })
  })

  it('getUA falls back to avatar when animal_avatar is absent', () => {
    expect(getUA('Bram', users)).toEqual({ index: 5, photoUrl: '' })
  })

  it('getUA defaults to index 0 / empty photo for an unknown user', () => {
    expect(getUA('Nobody', users)).toEqual({ index: 0, photoUrl: '' })
  })

  it('getUA defaults safely with no users array supplied', () => {
    expect(getUA('Doom')).toEqual({ index: 0, photoUrl: '' })
  })

  it('getDisplayName prefers display_name when set', () => {
    expect(getDisplayName('doom', users)).toBe('Dom')
  })

  it('getDisplayName falls back to the raw name when display_name is unset', () => {
    expect(getDisplayName('Bram', users)).toBe('Bram')
  })

  it('getDisplayName falls back to the raw name for an unknown user', () => {
    expect(getDisplayName('Nobody', users)).toBe('Nobody')
  })
})

describe('computeMemberStats', () => {
  const computeMemberStats = extractFromApp('computeMemberStats')

  const events = [
    {
      archived: true,
      type: 'day',
      attendees: [{ name: 'Doom', status: 'went' }, { name: 'Bram', status: 'absent' }],
      quizzes: [{ scores: { Doom: 300, Bram: 100 } }],
      winners: [{ winner: 'Doom', category: 'MVP' }],
    },
    {
      archived: true,
      type: 'weekend',
      attendees: [{ name: 'Doom', status: 'went' }],
      quizzes: [],
      winners: [],
    },
    {
      // Not archived: should not count toward attended totals.
      archived: false,
      type: 'day',
      attendees: [{ name: 'Doom', status: 'went' }],
      quizzes: [],
      winners: [],
    },
  ]

  it('counts mensdays and weekends only from archived events', () => {
    const stats = computeMemberStats('Doom', events)
    expect(stats.mensdays).toBe(1)
    expect(stats.weekends).toBe(1)
    expect(stats.total).toBe(2)
  })

  it('is case-insensitive on username', () => {
    const stats = computeMemberStats('DOOM', events)
    expect(stats.total).toBe(2)
  })

  it('counts a quiz win only for the strict top score', () => {
    const stats = computeMemberStats('Doom', events)
    expect(stats.quizWins).toBe(1)
    const bramStats = computeMemberStats('Bram', events)
    expect(bramStats.quizWins).toBe(0)
  })

  it('collects winner mentions with the event name attached', () => {
    const named = [{ ...events[0], name: 'Mensday 2025' }, events[1], events[2]]
    const stats = computeMemberStats('Doom', named)
    expect(stats.mentions).toHaveLength(1)
    expect(stats.mentions[0]).toMatchObject({ winner: 'Doom', eventName: 'Mensday 2025' })
  })

  it('returns zeroed stats for a user with no attendance', () => {
    const stats = computeMemberStats('Nobody', events)
    expect(stats).toMatchObject({ mensdays: 0, weekends: 0, quizWins: 0, total: 0 })
    expect(stats.mentions).toEqual([])
  })
})

describe('normalizeQuiz', () => {
  // normalizeQuiz references the module-scope TEAM_AVATARS const, so it
  // must be extracted alongside it (see extractFromAppSource.js docs).
  const normalizeQuiz = extractFromApp('TEAM_AVATARS', 'normalizeQuiz')

  it('wraps legacy flat `questions` into a single `rounds[0]`', () => {
    const legacy = { id: 'q1', questions: [{ q: 'Q1', options: ['a', 'b'], answer: 1, points: 10 }] }
    const normalized = normalizeQuiz(legacy)
    expect(normalized.rounds).toHaveLength(1)
    expect(normalized.rounds[0].questions[0]).toMatchObject({ q: 'Q1', type: 'multiple' })
  })

  it('normalizes a bare numeric `answer` into an array', () => {
    const legacy = { questions: [{ q: 'Q1', options: ['a', 'b'], answer: 1 }] }
    const normalized = normalizeQuiz(legacy)
    expect(normalized.rounds[0].questions[0].answer).toEqual([1])
  })

  it('leaves an already-array `answer` untouched', () => {
    const legacy = { questions: [{ q: 'Q1', options: ['a', 'b'], answer: [0, 1] }] }
    const normalized = normalizeQuiz(legacy)
    expect(normalized.rounds[0].questions[0].answer).toEqual([0, 1])
  })

  it('defaults a missing `answer` to [0]', () => {
    const legacy = { questions: [{ q: 'Q1', options: ['a', 'b'] }] }
    const normalized = normalizeQuiz(legacy)
    expect(normalized.rounds[0].questions[0].answer).toEqual([0])
  })

  it('passes through an already-`rounds`-shaped quiz, filling round defaults', () => {
    const modern = { id: 'q2', rounds: [{ id: 'r0', title: 'Round 1', questions: [] }] }
    const normalized = normalizeQuiz(modern)
    expect(normalized.rounds[0]).toMatchObject({ id: 'r0', icon: '🎯', secret: false })
  })

  it('assigns team avatars round-robin from TEAM_AVATARS', () => {
    const withTeams = { questions: [], teams: [{ name: 'Team A' }, { name: 'Team B' }] }
    const normalized = normalizeQuiz(withTeams)
    expect(normalized.teams[0]).toMatchObject({ name: 'Team A' })
    expect(typeof normalized.teams[0].avatar).toBe('string')
    expect(normalized.teams[0].avatar).not.toBe(normalized.teams[1].avatar)
  })
})
