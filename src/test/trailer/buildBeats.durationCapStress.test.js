// QA pass: adversarial stress tests for the total-duration invariant added
// under instruction (buildBeats.js, MAX_TOTAL_MS trim loop). Goal: actually
// try to break the cap, not just re-confirm the implementer's five cases.
// See docs/trailer-technical-spec.md §5.3 and buildBeats.js's own trim
// comment.
import { describe, it, expect } from 'vitest'
import { buildBeats, BEAT_KINDS } from '../../features/trailer/buildBeats.js'
import { buildTimeline } from '../../features/trailer/timeline.js'
import { MAX_TOTAL_MS, DURATIONS, ROSTER_MAX_MS } from '../../features/trailer/constants.js'

const baseInput = (overrides = {}) => ({
  eventId: 'evt-1', name: 'Mensdag XL', type: 'weekend', theme: '', location: 'Amsterdam',
  dateLabel: '12 september 2026', startsAtIso: '2026-06-01T12:00:00', dayCount: 3,
  stops: [], secretCount: 0, goingCount: 0, going: [],
  ...overrides,
})

const manyStops = (count, days) => Array.from({ length: count }, (_, i) => {
  const day = i % days
  const hour = String(6 + Math.floor(i / days) % 18).padStart(2, '0')
  return {
    key: `stop-${i}`, secret: false, day, dayLabel: `Dag ${day + 1}`, time: `${hour}:${String(i % 60).padStart(2, '0')}`,
    icon: '🍺', activity: `Stop ${i}`, location: 'Somewhere', note: '', image: '',
  }
})

describe('buildBeats -- duration-cap invariant, adversarial', () => {
  it('an absurd stop count (2000) with an equally absurd maxStopBeats never exceeds MAX_TOTAL_MS and terminates promptly', () => {
    const input = baseInput({ stops: manyStops(2000, 3), goingCount: 50, going: Array.from({ length: 50 }, (_, i) => ({ name: `L${i}`, photoUrl: '', avatarIndex: i % 8 })) })
    const start = Date.now()
    const beats = buildBeats(input, { maxStopBeats: 2000, nowMs: Date.parse('2026-01-01T00:00:00') })
    const elapsedMs = Date.now() - start
    const { totalMs } = buildTimeline(beats)
    expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    expect(elapsedMs).toBeLessThan(5000) // not hung, not pathologically slow
  })

  it('the floor (no stop beats at all) is analytically far below MAX_TOTAL_MS, so at least one STOP beat always survives trimming when any are eligible', () => {
    // TITLE + META + COUNTDOWN + SECRET + LEGACY + ROSTER(max) + OUTRO, all
    // maxed simultaneously -- the true ceiling of every *non-stop* beat kind
    // combined, fixed by the DURATIONS constants regardless of input content.
    const floorMax = DURATIONS.TITLE + DURATIONS.META + DURATIONS.COUNTDOWN + DURATIONS.SECRET
      + DURATIONS.LEGACY + ROSTER_MAX_MS + DURATIONS.OUTRO
    expect(floorMax).toBeLessThan(MAX_TOTAL_MS)
    const headroomMs = MAX_TOTAL_MS - floorMax
    expect(headroomMs).toBeGreaterThanOrEqual(DURATIONS.STOP) // room for >=1 stop beat, always

    const input = baseInput({
      stops: [...manyStops(50, 3), { key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '23:00' }],
      secretCount: 1,
      goingCount: 50,
      going: Array.from({ length: 50 }, (_, i) => ({ name: `L${i}`, photoUrl: '', avatarIndex: i % 8 })),
      champion: { name: 'Kevin', photoUrl: '', avatarIndex: 1, title: 'Champ', detail: 'x' },
      startsAtIso: '2026-06-01T12:00:00',
    })
    const beats = buildBeats(input, { maxStopBeats: 50, nowMs: Date.parse('2026-01-01T00:00:00') })
    const { totalMs } = buildTimeline(beats)
    expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    expect(beats.some((b) => b.kind === BEAT_KINDS.STOP)).toBe(true) // never trimmed to zero
    // Every other kind survives too -- the trim loop must never touch them.
    for (const kind of [BEAT_KINDS.TITLE, BEAT_KINDS.META, BEAT_KINDS.COUNTDOWN, BEAT_KINDS.SECRET, BEAT_KINDS.LEGACY, BEAT_KINDS.ROSTER, BEAT_KINDS.OUTRO]) {
      expect(beats.some((b) => b.kind === kind)).toBe(true)
    }
  })

  it('moreCount stays exactly accurate across a range of maxStopBeats values that force different amounts of trimming', () => {
    const stops = [...manyStops(40, 3)]
    const input = baseInput({ stops })
    for (const maxStopBeats of [7, 10, 15, 25, 40]) {
      const beats = buildBeats(input, { maxStopBeats })
      const stopBeats = beats.filter((b) => b.kind === BEAT_KINDS.STOP)
      expect(stopBeats.length).toBeGreaterThan(0)
      const last = stopBeats[stopBeats.length - 1]
      expect(last.data.moreCount ?? 0).toBe(Math.max(0, 40 - stopBeats.length))
      // No stale moreCount anywhere else.
      for (const b of stopBeats.slice(0, -1)) {
        expect(b.data).not.toHaveProperty('moreCount')
      }
      const { totalMs } = buildTimeline(beats)
      expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    }
  })

  it('a single-stop spotlight event (13s beat) combined with every other max-duration beat still fits comfortably', () => {
    const input = baseInput({
      stops: [
        { key: 'stop-0', secret: false, day: 0, dayLabel: 'Dag 1', time: '20:00', icon: '🍺', activity: 'Solo stop', location: '', note: '', image: '' },
        { key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '23:00' },
      ],
      secretCount: 1,
      goingCount: 50,
      going: Array.from({ length: 50 }, (_, i) => ({ name: `L${i}`, photoUrl: '', avatarIndex: i % 8 })),
      champion: { name: 'Kevin', photoUrl: '', avatarIndex: 1, title: 'Champ', detail: 'x' },
      startsAtIso: '2026-06-01T12:00:00',
    })
    const beats = buildBeats(input, { nowMs: Date.parse('2026-01-01T00:00:00') })
    const { totalMs } = buildTimeline(beats)
    expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    expect(beats.filter((b) => b.kind === BEAT_KINDS.STOP)).toHaveLength(1)
  })

  it('repeated calls on the same pathological input are deterministic (replay-safe even under trimming)', () => {
    const input = baseInput({ stops: manyStops(30, 3) })
    const opts = { maxStopBeats: 30 }
    const a = buildBeats(input, opts)
    const b = buildBeats(input, opts)
    expect(a).toEqual(b)
  })

  it('trimming never removes a TITLE, META, COUNTDOWN, SECRET, LEGACY, ROSTER or OUTRO beat under any maxStopBeats value, even ones absurdly larger than any real schedule could produce', () => {
    const input = baseInput({
      stops: [...manyStops(500, 3), { key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '23:00' }],
      secretCount: 1,
      goingCount: 12,
      going: Array.from({ length: 12 }, (_, i) => ({ name: `L${i}`, photoUrl: '', avatarIndex: i % 8 })),
      champion: { name: 'K', photoUrl: '', avatarIndex: 0, title: 'T', detail: 'D' },
      startsAtIso: '2026-06-01T12:00:00',
    })
    const beats = buildBeats(input, { maxStopBeats: 500, nowMs: Date.parse('2026-01-01T00:00:00') })
    const { totalMs } = buildTimeline(beats)
    expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    for (const kind of [BEAT_KINDS.TITLE, BEAT_KINDS.META, BEAT_KINDS.COUNTDOWN, BEAT_KINDS.SECRET, BEAT_KINDS.LEGACY, BEAT_KINDS.ROSTER, BEAT_KINDS.OUTRO]) {
      expect(beats.filter((b) => b.kind === kind)).toHaveLength(1)
    }
  })
})
