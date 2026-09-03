// Unit tests for `buildScheduleSummary` (src/App.jsx, declared right after
// `scheduleDayTimeOrder`) -- the pure data-shaping function behind
// OverviewTab's "Summary" view (the schedule view toggle) AND
// PresentationMode's closing slide's day/label grouping. It is the single
// choke point deciding what a non-editor is allowed to see: a secret stop's
// activity/location/note must never appear in its output for a non-editor.
// Extracted from App.jsx's real, current source text via
// extractFromAppSource.js, same technique as scheduleDays.test.js -- so a
// regression to the real filtering logic fails this test, not a hand-copied
// reimplementation.
//
// SHAPE CHANGE (owner direction, 2026-09-03), deliberate: a secret stop used
// to be dropped from `days` entirely for a non-editor, with a separate
// `hiddenCount` field driving a "N stops still a secret" count bar
// elsewhere. The owner asked for that bar removed -- the per-stop lock badge
// already says enough -- and for a held-back stop to render INLINE instead,
// in its correct time slot, masked: its time and a secret marker, never its
// activity, location, or note. So every stop now always gets an entry in
// `days` (nothing is dropped any more), and each stop entry carries a new
// `masked` boolean (true only when `secret && !isEditor`) that the caller
// blanks the display for -- `activity`/`location` are already blanked at
// the source here when `masked` is true, rather than trusted to stay blank
// in every render branch that touches this data. `hiddenCount` is gone:
// nothing needs a count once nothing is dropped.
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

  it('carries time/activity/location through into each stop entry, defaulting missing fields to "", and flags a non-secret stop as unmasked', () => {
    const schedule = [{ day: 0, time: '18:30', activity: 'Diner', location: 'Kroeg' }, { day: 0, activity: 'No time or location' }]
    const { days } = buildScheduleSummary(schedule, '2026-09-12', false)
    // Blank times sort before timed stops (scheduleDayTimeOrder's existing,
    // already-tested behaviour), so the untimed stop lands first here.
    expect(days[0].stops).toEqual([
      { time: '', activity: 'No time or location', location: '', secret: false, masked: false },
      { time: '18:30', activity: 'Diner', location: 'Kroeg', secret: false, masked: false },
    ])
  })

  describe('secret-aware masking -- the load-bearing behaviour', () => {
    const schedule = [
      { day: 0, time: '12:00', activity: 'Public lunch', location: 'Café X', secret: false },
      { day: 0, time: '20:00', activity: 'TOP SECRET surprise', location: 'Undisclosed bunker', note: 'do not leak', secret: true },
    ]

    it('a non-editor (isEditor=false) gets an entry for the secret stop too (same time slot), but its activity/location come back blank and `masked` is true', () => {
      const { days } = buildScheduleSummary(schedule, '2026-09-12', false)
      const allActivities = days.flatMap((d) => d.stops.map((s) => s.activity))
      const allLocations = days.flatMap((d) => d.stops.map((s) => s.location))
      // The secret content itself never appears anywhere in the output.
      expect(allActivities).not.toContain('TOP SECRET surprise')
      expect(allLocations).not.toContain('Undisclosed bunker')
      // But the stop is NOT dropped -- it's still there, blanked, in its
      // real time slot.
      const maskedStop = days[0].stops.find((s) => s.time === '20:00')
      expect(maskedStop).toEqual({ time: '20:00', activity: '', location: '', secret: true, masked: true })
      // The public stop is unaffected.
      expect(allActivities).toContain('Public lunch')
    })

    it('an editor (isEditor=true) sees every stop in full, secret or not, exactly like the existing Stops view -- and masked is always false for an editor', () => {
      const { days } = buildScheduleSummary(schedule, '2026-09-12', true)
      const allActivities = days.flatMap((d) => d.stops.map((s) => s.activity))
      expect(allActivities).toEqual(['Public lunch', 'TOP SECRET surprise'])
      expect(days[0].stops.every((s) => s.masked === false)).toBe(true)
    })

    it('a secret stop is flagged (secret:true) for BOTH an editor (full detail) and a non-editor (masked) -- the flag is what the caller badges on', () => {
      const editorView = buildScheduleSummary(schedule, '2026-09-12', true)
      const editorSecretStop = editorView.days[0].stops.find((s) => s.activity === 'TOP SECRET surprise')
      expect(editorSecretStop.secret).toBe(true)

      const memberView = buildScheduleSummary(schedule, '2026-09-12', false)
      const memberMaskedStop = memberView.days[0].stops.find((s) => s.time === '20:00')
      expect(memberMaskedStop.secret).toBe(true)
    })

    it('a day whose only stop is secret still appears for a non-editor -- as a masked row, not an empty/missing group', () => {
      const allSecretDay = [
        { day: 0, time: '12:00', activity: 'Public', secret: false },
        { day: 1, time: '09:00', activity: 'Fully secret day', secret: true },
      ]
      const { days } = buildScheduleSummary(allSecretDay, '2026-09-11', false)
      expect(days.map((d) => d.day)).toEqual([0, 1])
      const day1 = days.find((d) => d.day === 1)
      expect(day1.stops).toEqual([{ time: '09:00', activity: '', location: '', secret: true, masked: true }])
    })
  })

  it('an empty schedule produces no day groups', () => {
    const { days } = buildScheduleSummary([], '2026-09-12', false)
    expect(days).toEqual([])
  })
})
