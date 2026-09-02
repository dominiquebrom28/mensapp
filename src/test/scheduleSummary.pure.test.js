// Unit tests for `buildScheduleSummary` (src/App.jsx, declared right after
// `scheduleDayTimeOrder`) -- the pure data-shaping function behind
// OverviewTab's "Summary" view (the schedule view toggle). It is the single
// choke point deciding what a non-editor is allowed to see: a secret stop's
// activity/location/note must never appear in its output for a non-editor,
// only an honest hidden count. Extracted from App.jsx's real, current
// source text via extractFromAppSource.js, same technique as
// scheduleDays.test.js -- so a regression to the real filtering logic fails
// this test, not a hand-copied reimplementation.
import { describe, it, expect } from 'vitest'
import { extractFromApp } from './extractFromAppSource.js'

const buildScheduleSummary = extractFromApp(
  'dateForEventDay',
  'dayHeadingLabel',
  'padTimeForSort',
  'scheduleDayTimeOrder',
  'buildScheduleSummary',
)

describe('buildScheduleSummary', () => {
  it('groups stops by day, using the real dayHeadingLabel for each group label', () => {
    const schedule = [
      { day: 0, time: '12:00', activity: 'Lunch', location: 'Café X' },
      { day: 1, time: '09:00', activity: 'Ontbijt', location: 'Hotel' },
    ]
    const { days } = buildScheduleSummary(schedule, '2026-09-12', false)
    expect(days).toHaveLength(2)
    expect(days[0]).toMatchObject({ day: 0, label: 'Dag 1 · zaterdag 12 september' })
    expect(days[1]).toMatchObject({ day: 1, label: 'Dag 2 · zondag 13 september' })
  })

  it('sorts days ascending regardless of input order, and stops within a day by time (real scheduleDayTimeOrder)', () => {
    const schedule = [
      { day: 1, time: '09:00', activity: 'day1-early' },
      { day: 0, time: '20:00', activity: 'day0-late' },
      { day: 0, time: '09:00', activity: 'day0-early' },
    ]
    const { days } = buildScheduleSummary(schedule, '2026-09-12', false)
    expect(days.map((d) => d.day)).toEqual([0, 1])
    expect(days[0].stops.map((s) => s.activity)).toEqual(['day0-early', 'day0-late'])
  })

  it('a stop with no `day` field is grouped under day 0, same as the rest of the app treats legacy data', () => {
    const schedule = [{ activity: 'legacy, no day field', time: '10:00' }]
    const { days } = buildScheduleSummary(schedule, '2026-09-12', false)
    expect(days).toHaveLength(1)
    expect(days[0].day).toBe(0)
  })

  it('carries time/activity/location through into each stop entry, defaulting missing fields to ""', () => {
    const schedule = [{ day: 0, time: '18:30', activity: 'Diner', location: 'Kroeg' }, { day: 0, activity: 'No time or location' }]
    const { days } = buildScheduleSummary(schedule, '2026-09-12', false)
    // Blank times sort before timed stops (scheduleDayTimeOrder's existing,
    // already-tested behaviour), so the untimed stop lands first here.
    expect(days[0].stops).toEqual([
      { time: '', activity: 'No time or location', location: '', secret: false },
      { time: '18:30', activity: 'Diner', location: 'Kroeg', secret: false },
    ])
  })

  describe('secret-aware filtering -- the load-bearing behaviour', () => {
    const schedule = [
      { day: 0, time: '12:00', activity: 'Public lunch', location: 'Café X', secret: false },
      { day: 0, time: '20:00', activity: 'TOP SECRET surprise', location: 'Undisclosed bunker', note: 'do not leak', secret: true },
    ]

    it('a non-editor (isEditor=false) never receives the secret stop -- not its activity, not its location -- only an honest hidden count', () => {
      const { days, hiddenCount } = buildScheduleSummary(schedule, '2026-09-12', false)
      const allActivities = days.flatMap((d) => d.stops.map((s) => s.activity))
      const allLocations = days.flatMap((d) => d.stops.map((s) => s.location))
      expect(allActivities).not.toContain('TOP SECRET surprise')
      expect(allLocations).not.toContain('Undisclosed bunker')
      expect(allActivities).toEqual(['Public lunch'])
      expect(hiddenCount).toBe(1)
    })

    it('an editor (isEditor=true) sees every stop, secret or not, exactly like the existing Stops view', () => {
      const { days, hiddenCount } = buildScheduleSummary(schedule, '2026-09-12', true)
      const allActivities = days.flatMap((d) => d.stops.map((s) => s.activity))
      expect(allActivities).toEqual(['Public lunch', 'TOP SECRET surprise'])
      // hiddenCount is reported regardless of who's asking -- it's the
      // editor-only reveal-toggle UI that decides what to do with it.
      expect(hiddenCount).toBe(1)
    })

    it('a secret stop is flagged (secret:true) in the editor output so the UI can badge it, without exposing anything extra to a non-editor', () => {
      const { days } = buildScheduleSummary(schedule, '2026-09-12', true)
      const secretStop = days[0].stops.find((s) => s.activity === 'TOP SECRET surprise')
      expect(secretStop.secret).toBe(true)
    })

    it('hiddenCount is 0 when nothing is secret', () => {
      const { hiddenCount } = buildScheduleSummary(
        [{ day: 0, time: '12:00', activity: 'Public', secret: false }],
        '2026-09-12',
        false,
      )
      expect(hiddenCount).toBe(0)
    })

    it('a day that becomes entirely secret disappears from `days` for a non-editor rather than rendering an empty group', () => {
      const allSecretDay = [
        { day: 0, time: '12:00', activity: 'Public', secret: false },
        { day: 1, time: '09:00', activity: 'Fully secret day', secret: true },
      ]
      const { days } = buildScheduleSummary(allSecretDay, '2026-09-11', false)
      expect(days.map((d) => d.day)).toEqual([0])
    })
  })

  it('an empty schedule produces no day groups and a zero hidden count', () => {
    const { days, hiddenCount } = buildScheduleSummary([], '2026-09-12', false)
    expect(days).toEqual([])
    expect(hiddenCount).toBe(0)
  })
})
