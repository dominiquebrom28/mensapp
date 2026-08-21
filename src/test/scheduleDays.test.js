// Unit tests for the new schedule "day" helpers added for per-day
// scheduling (src/App.jsx, right after formatEventDateRange):
//   - eventDayCount(dateStr, endDateStr)
//   - dateForEventDay(dateStr, dayIndex)
//   - dayHeadingLabel(dateStr, dayIndex)   (depends on dateForEventDay)
//   - scheduleDayTimeOrder(a, b)
//
// All four are module-scope `const`s, extracted from App.jsx's real,
// current source text via extractFromAppSource.js -- see that file's
// docblock for why (App.jsx exports nothing but the default `App`, and we
// deliberately don't add exports as part of this change).
import { describe, it, expect } from 'vitest'
import { extractFromApp } from './extractFromAppSource.js'

const eventDayCount = extractFromApp('eventDayCount')
const dateForEventDay = extractFromApp('dateForEventDay')
const dayHeadingLabel = extractFromApp('dateForEventDay', 'dayHeadingLabel')
const scheduleDayTimeOrder = extractFromApp('padTimeForSort', 'scheduleDayTimeOrder')
const padTimeForSort = extractFromApp('padTimeForSort')

describe('eventDayCount', () => {
  it('no end_date -> single day', () => {
    expect(eventDayCount('2026-09-12', undefined)).toBe(1)
    expect(eventDayCount('2026-09-12', null)).toBe(1)
    expect(eventDayCount('2026-09-12', '')).toBe(1)
  })

  it('end_date equal to date -> single day', () => {
    expect(eventDayCount('2026-09-12', '2026-09-12')).toBe(1)
  })

  it('a normal 3-day weekend (Fri-Sun) counts as 3', () => {
    expect(eventDayCount('2026-09-11', '2026-09-13')).toBe(3)
  })

  it('counts correctly across a month boundary', () => {
    // Aug 30, 31, Sep 1 = 3 days
    expect(eventDayCount('2026-08-30', '2026-09-01')).toBe(3)
  })

  it('counts correctly across a year boundary', () => {
    expect(eventDayCount('2026-12-30', '2027-01-01')).toBe(3)
  })

  it('is defensive against a reversed range (end before start), same as formatEventDateRange', () => {
    expect(eventDayCount('2026-09-13', '2026-09-11')).toBe(3)
  })

  it('missing dateStr -> 1 (never throws)', () => {
    expect(eventDayCount('', '2026-09-13')).toBe(1)
    expect(eventDayCount(undefined, undefined)).toBe(1)
  })
})

describe('dateForEventDay', () => {
  it('day 0 is the start date itself', () => {
    expect(dateForEventDay('2026-09-12', 0)).toBe('2026-09-12')
  })

  it('treats a missing/undefined dayIndex as day 0', () => {
    expect(dateForEventDay('2026-09-12', undefined)).toBe('2026-09-12')
  })

  it('day N offsets forward within the same month', () => {
    expect(dateForEventDay('2026-09-11', 1)).toBe('2026-09-12')
    expect(dateForEventDay('2026-09-11', 2)).toBe('2026-09-13')
  })

  it('rolls over a month boundary correctly', () => {
    expect(dateForEventDay('2026-08-31', 1)).toBe('2026-09-01')
    expect(dateForEventDay('2026-08-30', 2)).toBe('2026-09-01')
  })

  it('rolls over a year boundary correctly', () => {
    expect(dateForEventDay('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('rolls over a leap-day February correctly', () => {
    expect(dateForEventDay('2024-02-28', 1)).toBe('2024-02-29')
    expect(dateForEventDay('2024-02-28', 2)).toBe('2024-03-01')
  })

  it('empty dateStr returns an empty string rather than throwing', () => {
    expect(dateForEventDay('', 2)).toBe('')
    expect(dateForEventDay(undefined, 2)).toBe('')
  })
})

describe('dayHeadingLabel', () => {
  it('formats day 0 as "Dag 1 · <weekday> <day> <month>" in nl-NL', () => {
    // 2026-09-12 is a Saturday
    expect(dayHeadingLabel('2026-09-12', 0)).toBe('Dag 1 · zaterdag 12 september')
  })

  it('is 1-indexed for humans while the underlying day param stays 0-based', () => {
    expect(dayHeadingLabel('2026-09-11', 1)).toBe('Dag 2 · zaterdag 12 september')
    expect(dayHeadingLabel('2026-09-11', 2)).toBe('Dag 3 · zondag 13 september')
  })

  it('carries the month-boundary date roll-over into the label', () => {
    expect(dayHeadingLabel('2026-08-31', 1)).toBe('Dag 2 · dinsdag 1 september')
  })

  it('falls back to a bare "Dag N" when there is no date to format', () => {
    expect(dayHeadingLabel('', 0)).toBe('Dag 1')
    expect(dayHeadingLabel(undefined, 3)).toBe('Dag 4')
  })
})

describe('scheduleDayTimeOrder', () => {
  const sorted = (stops) => [...stops].sort(scheduleDayTimeOrder)

  it('orders by day first', () => {
    const stops = [
      { activity: 'B', day: 1, time: '09:00' },
      { activity: 'A', day: 0, time: '20:00' },
    ]
    expect(sorted(stops).map((s) => s.activity)).toEqual(['A', 'B'])
  })

  it('orders by time within the same day', () => {
    const stops = [
      { activity: 'late', day: 0, time: '20:00' },
      { activity: 'early', day: 0, time: '09:00' },
      { activity: 'mid', day: 0, time: '14:00' },
    ]
    expect(sorted(stops).map((s) => s.activity)).toEqual(['early', 'mid', 'late'])
  })

  it('treats a missing/undefined `day` as day 0 (backwards compatibility with pre-multi-day stops)', () => {
    const stops = [
      { activity: 'day1', day: 1, time: '08:00' },
      { activity: 'legacyNoDay', time: '23:00' }, // no `day` field at all
    ]
    expect(sorted(stops).map((s) => s.activity)).toEqual(['legacyNoDay', 'day1'])
  })

  it('is stable: equal (day,time) pairs keep their original relative order', () => {
    const stops = [
      { activity: 'first', day: 0, time: '12:00' },
      { activity: 'second', day: 0, time: '12:00' },
      { activity: 'third', day: 0, time: '12:00' },
    ]
    expect(sorted(stops).map((s) => s.activity)).toEqual(['first', 'second', 'third'])
  })

  it('sorts blank times before timed stops on the same day (empty string sorts first)', () => {
    const stops = [
      { activity: 'timed', day: 0, time: '09:00' },
      { activity: 'blank', day: 0, time: '' },
    ]
    expect(sorted(stops).map((s) => s.activity)).toEqual(['blank', 'timed'])
  })

  // FIX, formerly a CHARACTERIZATION TEST pinning the wrong behavior -- see
  // QA priority area #3. Plain `.localeCompare` on raw "H:MM" vs "HH:MM"
  // strings did a lexicographic (character-by-character) comparison, not a
  // numeric one: "9:00" > "10:00" because '9' > '1' as the very first
  // character. Every *current* write path (the modals' `<Inp type="time">`)
  // always emits a zero-padded "HH:MM", so this couldn't be produced by the
  // app today -- but `time` has been free text historically and `schedule`
  // is hand-editable JSONB, so a legacy/imported unpadded value was a real
  // (if dormant) risk for existing production data. `scheduleDayTimeOrder`
  // now pads through `padTimeForSort` before comparing, so this sorts
  // correctly regardless of padding.
  it('an unpadded legacy time ("9:00") sorts BEFORE a later zero-padded time ("10:00") on the same day -- numeric, not lexicographic, comparison', () => {
    const stops = [
      { activity: '10:00 stop', day: 0, time: '10:00' },
      { activity: '9:00 stop', day: 0, time: '9:00' },
    ]
    // Numerically (and now, actually) 9:00 sorts before 10:00.
    expect(sorted(stops).map((s) => s.activity)).toEqual(['9:00 stop', '10:00 stop'])
  })

  it('two unpadded single-digit-hour times still sort correctly relative to EACH OTHER ("8:00" < "9:00")', () => {
    const stops = [
      { activity: '9am', day: 0, time: '9:00' },
      { activity: '8am', day: 0, time: '8:00' },
    ]
    expect(sorted(stops).map((s) => s.activity)).toEqual(['8am', '9am'])
  })

  it('a padded and an equivalent unpadded time on the same day are treated as equal (tie), preserving original relative order', () => {
    const stops = [
      { activity: 'padded', day: 0, time: '09:00' },
      { activity: 'unpadded', day: 0, time: '9:00' },
    ]
    expect(sorted(stops).map((s) => s.activity)).toEqual(['padded', 'unpadded'])
  })

  it('an empty-string time on both sides of the tie is stable (no crash, no throw) -- covers the (a.time||"") fallback for null/undefined time', () => {
    const stops = [
      { activity: 'null-time', day: 0, time: null },
      { activity: 'undefined-time', day: 0 }, // time key entirely absent
      { activity: 'empty-string-time', day: 0, time: '' },
    ]
    expect(() => sorted(stops)).not.toThrow()
    // all three are treated identically (fall back to ""), so original
    // relative order is preserved (stable sort, all keys equal).
    expect(sorted(stops).map((s) => s.activity)).toEqual(['null-time', 'undefined-time', 'empty-string-time'])
  })
})

describe('padTimeForSort', () => {
  it('zero-pads a single-digit hour', () => {
    expect(padTimeForSort('9:00')).toBe('09:00')
    expect(padTimeForSort('1:45')).toBe('01:45')
  })

  it('leaves an already-padded double-digit hour untouched', () => {
    expect(padTimeForSort('09:00')).toBe('09:00')
    expect(padTimeForSort('20:00')).toBe('20:00')
  })

  it('leaves falsy input as "" (never throws)', () => {
    expect(padTimeForSort('')).toBe('')
    expect(padTimeForSort(null)).toBe('')
    expect(padTimeForSort(undefined)).toBe('')
  })

  it('leaves a value that does not look like "H(:...)" untouched rather than mangling it', () => {
    expect(padTimeForSort('noon')).toBe('noon')
  })
})
