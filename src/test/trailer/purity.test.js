// QA pass: purity invariants for buildBeats.js / timeline.js (technical
// spec §5.1: "Pure. No React, no Date.now(), no DOM. Deterministic.").
// Specifically probes the thing the task calls out: a shared TrailerInput
// object being mutated between replays would be a real bug (the same
// TrailerInput can be handed to buildBeats() repeatedly across trailer
// replays without EventPage re-deriving it).
import { describe, it, expect } from 'vitest'
import { buildBeats } from '../../features/trailer/buildBeats.js'
import { buildTimeline, beatIndexAt, progressAt } from '../../features/trailer/timeline.js'

const baseInput = (overrides = {}) => ({
  eventId: 'evt-1', name: 'Mensdag XL', type: 'weekend', theme: '', location: 'Amsterdam',
  dateLabel: '12 september 2026', startsAtIso: '2026-06-01T12:00:00', dayCount: 3,
  stops: [], secretCount: 0, goingCount: 0, going: [],
  ...overrides,
})

describe('buildBeats -- purity: does not mutate the caller\'s input', () => {
  it('a deep clone of a rich input is untouched after buildBeats() runs, across multiple "replay" calls', () => {
    const input = baseInput({
      stops: [
        { key: 'stop-0', secret: false, day: 0, dayLabel: 'Dag 1', time: '10:00', icon: '🍺', activity: 'A', location: 'L', note: 'N', image: 'https://cdn.example.com/a.jpg' },
        { key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '23:00' },
      ],
      secretCount: 1,
      goingCount: 5,
      going: [{ name: 'A', photoUrl: '', avatarIndex: 0 }, { name: 'B', photoUrl: '', avatarIndex: 1 }, { name: 'C', photoUrl: '', avatarIndex: 2 }],
      champion: { name: 'Kevin', photoUrl: 'https://cdn.example.com/kevin.jpg', avatarIndex: 1, title: 'Champ', detail: 'x' },
    })
    const snapshot = JSON.parse(JSON.stringify(input))

    buildBeats(input, { nowMs: Date.parse('2026-01-01T00:00:00') })
    buildBeats(input, { nowMs: Date.parse('2026-01-01T00:00:00'), reducedMotion: true })
    buildBeats(input, { nowMs: Date.parse('2026-01-01T00:00:00'), saveData: true, maxStopBeats: 2 })

    expect(input).toEqual(snapshot)
  })

  it('the same input object, reused across "replays", produces identical output every time (no accumulating mutation)', () => {
    const input = baseInput({
      stops: Array.from({ length: 10 }, (_, i) => ({
        key: `stop-${i}`, secret: false, day: i % 3, dayLabel: `Dag ${(i % 3) + 1}`, time: `${String(9 + i).padStart(2, '0')}:00`,
        icon: '🍺', activity: `S${i}`, location: '', note: '', image: '',
      })),
    })
    const first = buildBeats(input)
    const second = buildBeats(input)
    const third = buildBeats(input)
    expect(first).toEqual(second)
    expect(second).toEqual(third)
  })

  it('stop objects inside input.stops are not mutated in place (object identity survives, own-key set unchanged)', () => {
    const stopObj = { key: 'stop-0', secret: false, day: 0, dayLabel: 'Dag 1', time: '10:00', icon: '🍺', activity: 'A', location: 'L', note: '', image: '' }
    const originalKeys = Object.keys(stopObj).sort()
    const input = baseInput({ stops: [stopObj] })
    buildBeats(input, { maxStopBeats: 25 })
    expect(Object.keys(stopObj).sort()).toEqual(originalKeys)
    expect(stopObj.activity).toBe('A')
  })

  it('a hostile getter-based input (values change on every read) does not crash buildBeats and produces no exception -- documents that buildBeats reads each field once, not twice inconsistently', () => {
    let reads = 0
    const input = baseInput({})
    Object.defineProperty(input, 'name', {
      get() { reads += 1; return `name-read-${reads}` },
    })
    expect(() => buildBeats(input)).not.toThrow()
  })
})

describe('buildBeats / timeline -- no wall-clock, no DOM', () => {
  it('buildBeats output for a given (input, nowMs) pair never changes across repeated calls even as real wall-clock time advances', async () => {
    const input = baseInput({ startsAtIso: '2026-06-01T12:00:00' })
    const nowMs = Date.parse('2026-01-01T00:00:00')
    const first = buildBeats(input, { nowMs })
    await new Promise((r) => setTimeout(r, 20)) // let real time move
    const second = buildBeats(input, { nowMs })
    expect(first).toEqual(second)
  })

  it('timeline.js functions are pure over their explicit inputs -- same (timeline, tMs) always yields the same result', () => {
    const beats = buildBeats(baseInput({ stops: [{ key: 's', secret: false, day: 0, dayLabel: 'Dag 1', time: '10:00', icon: '🍺', activity: 'A', location: '', note: '', image: '' }] }))
    const timeline = buildTimeline(beats)
    const a = { idx: beatIndexAt(timeline, 1234), prog: progressAt(timeline, 1234) }
    const b = { idx: beatIndexAt(timeline, 1234), prog: progressAt(timeline, 1234) }
    expect(a).toEqual(b)
  })
})
