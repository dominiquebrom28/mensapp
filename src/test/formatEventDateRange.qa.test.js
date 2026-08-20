// QA verification pass for the multi-day-event date range feature
// (formatEventDateRange, src/App.jsx:267 and its 6 call sites).
//
// This file is deliberately separate from helpers.pure.test.js (which
// already covers the core formatting cases the feature author wrote tests
// for) and focuses on:
//   1. Byte-for-byte backwards compatibility against the pre-change
//      formulas at every call site, reconstructed from git history
//      (git show HEAD:src/App.jsx), for null / "" / undefined end_date --
//      the three shapes existing + new + cleared rows can actually have.
//   2. Edge cases not in the original test pass: reversed ranges (end
//      before start), the month:"short" option combo (used by
//      TeamCreatorPage, a 6th call site not mentioned in the task's list
//      of 5), and DST-boundary safety of the noon-anchored parse.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { extractFromApp } from './extractFromAppSource.js'

const formatEventDateRange = extractFromApp('formatEventDateRange')

// Runs a real `node` subprocess with TZ forced, to get ground-truth
// old-vs-new rendering for a given IANA zone without depending on
// process.env.TZ being honored dynamically inside this already-running
// vitest process (Node/V8 may cache timezone data at startup).
function renderInTimezone(tz, dateStr) {
  const script = `
    const dateStr = ${JSON.stringify(dateStr)};
    const oldRender = new Date(dateStr).toLocaleDateString('nl-NL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const newRender = new Date(dateStr + 'T12:00:00').toLocaleDateString('nl-NL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    process.stdout.write(JSON.stringify({ oldRender, newRender }));
  `
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, TZ: tz },
  })
  return JSON.parse(out)
}

// ── 1. Backwards compatibility: null / "" / undefined end_date must all
// render identically to the pre-change single-date formula at each call
// site. Formulas below are copied verbatim from `git show HEAD:src/App.jsx`
// (i.e. the code as it existed before this diff), not re-derived, so a
// regression to the actual old formatting shows up here.
describe('formatEventDateRange backwards compatibility (byte-identical to pre-change code)', () => {
  const sampleDates = ['2026-09-13', '2026-01-01', '2026-12-31', '2024-02-29']

  describe('EventCard compact (old App.jsx:1091 -- {day:"numeric",month:"long"}, no T12:00:00 anchor)', () => {
    it.each(sampleDates)('matches for %s with end_date null/""/undefined', (dateStr) => {
      const old = new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })
      const opts = { weekday: false, year: false }
      expect(formatEventDateRange(dateStr, null, opts)).toBe(old)
      expect(formatEventDateRange(dateStr, '', opts)).toBe(old)
      expect(formatEventDateRange(dateStr, undefined, opts)).toBe(old)
    })
  })

  describe('EventCard full / EventPage (old App.jsx:1137/:1360 -- full weekday+day+month+year, no T12:00:00 anchor)', () => {
    it.each(sampleDates)('matches for %s with end_date null/""/undefined', (dateStr) => {
      const old = new Date(dateStr).toLocaleDateString('nl-NL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      expect(formatEventDateRange(dateStr, null)).toBe(old)
      expect(formatEventDateRange(dateStr, '')).toBe(old)
      expect(formatEventDateRange(dateStr, undefined)).toBe(old)
    })
  })

  describe('PresentationMode intro (old App.jsx:4957 -- already T12:00:00-anchored)', () => {
    it.each(sampleDates)('matches for %s with end_date null/""/undefined', (dateStr) => {
      const old = new Date(dateStr + 'T12:00:00').toLocaleDateString('nl-NL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      expect(formatEventDateRange(dateStr, null)).toBe(old)
      expect(formatEventDateRange(dateStr, '')).toBe(old)
      expect(formatEventDateRange(dateStr, undefined)).toBe(old)
    })
  })

  describe('TeamCreatorPage event picker (old App.jsx:5685 -- {day,month:"short",year}, no T12:00:00 anchor)', () => {
    it.each(sampleDates)('matches for %s with end_date null/""/undefined', (dateStr) => {
      const old = new Date(dateStr).toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      const opts = { weekday: false, month: 'short' }
      expect(formatEventDateRange(dateStr, null, opts)).toBe(old)
      expect(formatEventDateRange(dateStr, '', opts)).toBe(old)
      expect(formatEventDateRange(dateStr, undefined, opts)).toBe(old)
    })
  })

  // KNOWN, DOCUMENTED DIVERGENCE -- not a bug in formatEventDateRange itself,
  // but a real difference from the pre-change code that is NOT byte-identical
  // in every timezone. Old call sites (all except PresentationMode) built
  // `new Date(dateStr)` with no time component, which the spec parses as UTC
  // midnight; `.toLocaleDateString` then renders that instant in the
  // browser/runtime's LOCAL timezone. For any timezone behind UTC (the
  // Americas, and effectively half the world's population), UTC midnight is
  // still "yesterday evening" locally, so the OLD code silently rendered the
  // day *before* evt.date. The new noon-anchored `dateStr+"T12:00:00"` parse
  // (used both by the helper and, already, by the old PresentationMode line)
  // is immune to this and always shows the correct calendar day. That means:
  // for a device set to Europe/Amsterdam (the app's actual audience) output
  // is unchanged; for a device set to e.g. America/Los_Angeles it is NOT --
  // the single-day date shown for the exact same evt.date changes by this
  // diff. This is a net bug fix, but it fails a literal "byte identical in
  // all timezones" bar and is worth a conscious sign-off, not a silent
  // side-effect.
  it('Europe/Amsterdam (the app\'s actual audience): old and new render the SAME calendar day', () => {
    const { oldRender, newRender } = renderInTimezone('Europe/Amsterdam', '2026-08-20')
    expect(newRender).toBe(oldRender)
    expect(newRender).toContain('20 augustus')
  })

  it('America/Los_Angeles (a timezone behind UTC): old and new render DIFFERENT calendar days -- the diff changes real output here', () => {
    const { oldRender, newRender } = renderInTimezone('America/Los_Angeles', '2026-08-20')
    expect(oldRender).toContain('19 augustus') // old: UTC-midnight parse rolls back to the previous local day
    expect(newRender).toContain('20 augustus') // new: noon-anchored parse is correct
    expect(newRender).not.toBe(oldRender)
  })

  it('UTC and timezones ahead of UTC: old and new agree (old bug only manifests west of UTC)', () => {
    for (const tz of ['UTC', 'Pacific/Kiritimati']) {
      const { oldRender, newRender } = renderInTimezone(tz, '2026-08-20')
      expect(newRender).toBe(oldRender)
    }
  })
})

// ── 2. Edge cases beyond the original test pass ─────────────────────────
describe('formatEventDateRange additional edge cases', () => {
  it('month:"short" option (TeamCreatorPage combo) formats a range', () => {
    expect(
      formatEventDateRange('2026-09-12', '2026-09-14', { weekday: false, month: 'short' }),
    ).toBe('12 – 14 sep 2026')
  })

  it('null, "", and undefined end_date are all treated identically as "single day"', () => {
    const a = formatEventDateRange('2026-09-12', null)
    const b = formatEventDateRange('2026-09-12', '')
    const c = formatEventDateRange('2026-09-12', undefined)
    const d = formatEventDateRange('2026-09-12', '2026-09-12') // equal-to-start also single-day
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(c).toBe(d)
  })

  // REGRESSION GUARD (was a documented defect, fixed in App.jsx:285): the
  // helper now normalizes a reversed pair (`[from,to]=endRaw<start?[endRaw,start]:[start,endRaw]`)
  // before formatting, so a reversed (dateStr, endDateStr) pair renders
  // identically to the correctly-ordered pair instead of producing garbled
  // "later date first" output. Also a defense-in-depth net given that
  // EditEventModal/NewEventModal's Save/Create are now `disabled={!!dateErr}`
  // (verified separately in EventModals.typeTouched.test.jsx) -- any bad
  // data that reaches this helper by another path (legacy row, manual DB
  // edit, a future caller that doesn't validate) still renders sanely.
  it('REGRESSION GUARD: a reversed range (end_date before date) is reordered before formatting, not rendered garbled', () => {
    expect(formatEventDateRange('2026-09-14', '2026-09-12')).toBe('za 12 – ma 14 september 2026')
    // Same result as passing the pair in the correct order -- proves this
    // is a real reorder, not a coincidence of this particular pair.
    expect(formatEventDateRange('2026-09-14', '2026-09-12')).toBe(
      formatEventDateRange('2026-09-12', '2026-09-14'),
    )
  })

  it('REGRESSION GUARD: reorder also normalizes reversed cross-month and cross-year ranges', () => {
    expect(formatEventDateRange('2026-09-01', '2026-08-28')).toBe(
      formatEventDateRange('2026-08-28', '2026-09-01'),
    )
    expect(formatEventDateRange('2027-01-01', '2026-12-30')).toBe(
      formatEventDateRange('2026-12-30', '2027-01-01'),
    )
  })

  it('REGRESSION GUARD: formatEventDateRange is order-independent for any distinct date pair (symmetry property)', () => {
    const pairs = [
      ['2026-09-12', '2026-09-14'],
      ['2026-08-28', '2026-09-01'],
      ['2026-12-30', '2027-01-01'],
      ['2024-02-28', '2024-03-01'],
    ]
    for (const [a, b] of pairs) {
      expect(formatEventDateRange(a, b)).toBe(formatEventDateRange(b, a))
    }
  })

  it('cross-year range collapse still fires when opts.month is "short"', () => {
    expect(
      formatEventDateRange('2026-12-30', '2027-01-01', { weekday: false, month: 'short' }),
    ).toBe('30 dec 2026 – 1 jan 2027')
  })

  it('leap-day start/end date does not throw and produces a valid date', () => {
    expect(() => formatEventDateRange('2024-02-29', '2024-03-01')).not.toThrow()
    expect(formatEventDateRange('2024-02-29', '2024-03-01')).toBe('do 29 februari – vr 1 maart 2024')
  })
})
