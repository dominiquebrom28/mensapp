// Tests for App.jsx's un-exported pure helpers, reached via
// extractFromAppSource.js (see that file for how/why). These run against
// the real, current source text of App.jsx -- not a re-implementation.
//
// docs/quiz-unification-spec.md §8.3/§9 (WP-Q3 pure move): `getYouTubeId`,
// `getSpotifyTrackId`, `isSpotifyUrl`, `isYouTubeUrl` and `normalizeQuiz`
// left App.jsx entirely -- they're real exports on `features/quiz/urls.js`
// / `model.js` now, so those five import the real thing directly below
// instead of slicing source text. Every assertion is unchanged.
//
// FOLLOW-UP (still not done, per task scope: no edits to App.jsx):
// the remaining helpers below are un-exported `const`s reached only via
// `extractFromApp`. The same one-line fix applies to them, e.g.
//   const hasAdmin=u=>{...};   ->   export const hasAdmin=u=>{...};
// Worth doing for: hasAdmin, hasOrg, getUA, getDisplayName,
// computeMemberStats, formatEventDateRange -- all pure, side-effect-free,
// and already reachable by this extraction technique.
import { describe, it, expect } from 'vitest'
import { extractFromApp } from './extractFromAppSource.js'
import { getYouTubeId, getSpotifyTrackId, isSpotifyUrl, isYouTubeUrl } from '../features/quiz/urls.js'
import { normalizeQuiz } from '../features/quiz/model.js'

describe('getYouTubeId', () => {
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

describe('formatEventDateRange', () => {
  const formatEventDateRange = extractFromApp('formatEventDateRange')

  it('formats a single day (no end_date) exactly like the pre-range format', () => {
    expect(formatEventDateRange('2026-09-12', undefined)).toBe(
      new Date('2026-09-12T12:00:00').toLocaleDateString('nl-NL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    )
  })

  it('treats an end_date equal to the start date as a single day', () => {
    expect(formatEventDateRange('2026-09-12', '2026-09-12')).toBe(
      formatEventDateRange('2026-09-12', undefined),
    )
  })

  it('collapses a same-month range to "wd d – wd d month year"', () => {
    expect(formatEventDateRange('2026-09-12', '2026-09-14')).toBe('za 12 – ma 14 september 2026')
  })

  it('spells out both months for a cross-month range within the same year', () => {
    expect(formatEventDateRange('2026-08-28', '2026-09-01')).toBe(
      'vr 28 augustus – di 1 september 2026',
    )
  })

  it('spells out both years for a cross-year range', () => {
    expect(formatEventDateRange('2026-12-30', '2027-01-01')).toBe(
      'wo 30 december 2026 – vr 1 januari 2027',
    )
  })

  it('omits weekday and year when opts request it (compact card style)', () => {
    expect(formatEventDateRange('2026-09-12', undefined, { weekday: false, year: false })).toBe(
      '12 september',
    )
    expect(
      formatEventDateRange('2026-09-12', '2026-09-14', { weekday: false, year: false }),
    ).toBe('12 – 14 september')
  })

  it('still shows the year in a compact cross-year range even with year:false', () => {
    expect(
      formatEventDateRange('2026-12-30', '2027-01-01', { weekday: false, year: false }),
    ).toBe('30 december 2026 – 1 januari 2027')
  })

  it('returns an empty string for a missing start date', () => {
    expect(formatEventDateRange('', '2026-09-14')).toBe('')
    expect(formatEventDateRange(undefined, undefined)).toBe('')
  })
})

describe('normalizeQuiz', () => {
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
