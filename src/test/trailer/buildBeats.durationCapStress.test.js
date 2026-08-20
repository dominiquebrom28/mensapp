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
    // TITLE + META + SECRET + LEGACY + ROSTER(max) + OUTRO, all maxed
    // simultaneously -- the true ceiling of every *non-stop* beat kind
    // combined, fixed by the DURATIONS constants regardless of input
    // content. COUNTDOWN is deliberately NOT added here any more: it was
    // folded onto META's `data` by a visual-QA amendment (see
    // buildBeats.js's comment on the META beat) without changing META's
    // own `durationMs` -- so counting `DURATIONS.COUNTDOWN` again here
    // would overstate the real floor by 3s and understate the true
    // available headroom for stop beats. Re-derived, not just patched, per
    // the instruction to independently re-verify this rather than assume
    // the reasoning still holds.
    const floorMax = DURATIONS.TITLE + DURATIONS.META + DURATIONS.SECRET
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
    for (const kind of [BEAT_KINDS.TITLE, BEAT_KINDS.META, BEAT_KINDS.SECRET, BEAT_KINDS.LEGACY, BEAT_KINDS.ROSTER, BEAT_KINDS.OUTRO]) {
      expect(beats.some((b) => b.kind === kind)).toBe(true)
    }
    // The countdown data itself (this input has a future startsAtIso and a
    // real nowMs) still rides along on META, unaffected by any of the
    // above -- re-proving the gate moved intact, not just that META exists.
    const meta = beats.find((b) => b.kind === BEAT_KINDS.META)
    expect(meta.data).toHaveProperty('daysToGo')
    expect(meta.durationMs).toBe(DURATIONS.META) // carrying countdown data costs zero extra screen time
    expect(beats.map((b) => b.kind)).not.toContain(BEAT_KINDS.COUNTDOWN)
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
    // COUNTDOWN excluded from this list on purpose (see the "floor" test
    // above for the full reasoning) -- it is no longer a standalone beat
    // kind at all, so asserting `toHaveLength(1)` for it would always fail
    // now, and asserting its absence here would be a tautology rather than
    // a real regression check on the trim loop specifically.
    for (const kind of [BEAT_KINDS.TITLE, BEAT_KINDS.META, BEAT_KINDS.SECRET, BEAT_KINDS.LEGACY, BEAT_KINDS.ROSTER, BEAT_KINDS.OUTRO]) {
      expect(beats.filter((b) => b.kind === kind)).toHaveLength(1)
    }
    expect(beats.filter((b) => b.kind === BEAT_KINDS.COUNTDOWN)).toHaveLength(0)
  })

  // Independent re-verification (per instruction, not just trusting the
  // implementer's reasoning) that folding COUNTDOWN onto META can only ever
  // shrink or hold steady the total duration relative to the old two-beat
  // shape, at the two most adversarial scales this suite already exercises
  // -- 2000 stops, and maxStopBeats:500 -- both WITH a real future
  // startsAtIso/nowMs so the countdown data path is actually exercised
  // (the pre-existing 2000-stop stress case above doesn't pass a
  // startsAtIso at all, so it never touched this code path).
  it('the duration cap still holds with the countdown-on-META shape, at the 2000-stop and maxStopBeats:500 extremes, with a genuinely future startsAtIso', () => {
    const nowMs = Date.parse('2026-01-01T00:00:00')
    const futureIso = '2026-06-01T12:00:00'

    const hugeStops = buildBeats(
      baseInput({ stops: manyStops(2000, 3), startsAtIso: futureIso, goingCount: 50, going: Array.from({ length: 50 }, (_, i) => ({ name: `L${i}`, photoUrl: '', avatarIndex: i % 8 })) }),
      { maxStopBeats: 2000, nowMs },
    )
    expect(buildTimeline(hugeStops).totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    let meta = hugeStops.find((b) => b.kind === BEAT_KINDS.META)
    expect(meta.data.daysToGo).toBeGreaterThan(0)
    expect(hugeStops.filter((b) => b.kind === BEAT_KINDS.COUNTDOWN)).toHaveLength(0)

    const hugeCap = buildBeats(
      baseInput({
        stops: [...manyStops(500, 3), { key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '23:00' }],
        secretCount: 1,
        startsAtIso: futureIso,
        goingCount: 12,
        going: Array.from({ length: 12 }, (_, i) => ({ name: `L${i}`, photoUrl: '', avatarIndex: i % 8 })),
        champion: { name: 'K', photoUrl: '', avatarIndex: 0, title: 'T', detail: 'D' },
      }),
      { maxStopBeats: 500, nowMs },
    )
    expect(buildTimeline(hugeCap).totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    meta = hugeCap.find((b) => b.kind === BEAT_KINDS.META)
    expect(meta.data.daysToGo).toBeGreaterThan(0)
    expect(hugeCap.filter((b) => b.kind === BEAT_KINDS.COUNTDOWN)).toHaveLength(0)
  })
})
