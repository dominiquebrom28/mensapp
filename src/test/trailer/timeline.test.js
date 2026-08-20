// Unit tests for src/features/trailer/timeline.js -- pure.
import { describe, it, expect } from 'vitest'
import { buildTimeline, beatIndexAt, progressAt } from '../../features/trailer/timeline.js'

const beat = (id, durationMs) => ({ id, kind: 'stop', durationMs, data: {} })

describe('buildTimeline', () => {
  it('lays out segments back to back and sums totalMs', () => {
    const timeline = buildTimeline([beat('a', 1000), beat('b', 500), beat('c', 2000)])
    expect(timeline.totalMs).toBe(3500)
    expect(timeline.segments).toEqual([
      { beat: beat('a', 1000), startMs: 0, endMs: 1000 },
      { beat: beat('b', 500), startMs: 1000, endMs: 1500 },
      { beat: beat('c', 2000), startMs: 1500, endMs: 3500 },
    ])
  })

  it('an empty beat list -> zero segments, totalMs 0', () => {
    const timeline = buildTimeline([])
    expect(timeline.segments).toEqual([])
    expect(timeline.totalMs).toBe(0)
  })

  it('treats a missing/negative durationMs as 0 rather than throwing or going negative', () => {
    const timeline = buildTimeline([beat('a', undefined), beat('b', -500), beat('c', 100)])
    expect(timeline.totalMs).toBe(100)
    expect(timeline.segments[0]).toMatchObject({ startMs: 0, endMs: 0 })
    expect(timeline.segments[1]).toMatchObject({ startMs: 0, endMs: 0 })
    expect(timeline.segments[2]).toMatchObject({ startMs: 0, endMs: 100 })
  })
})

describe('beatIndexAt', () => {
  const timeline = buildTimeline([beat('a', 1000), beat('b', 500), beat('c', 2000)])
  // segments: a [0,1000)  b [1000,1500)  c [1500,3500)  totalMs 3500

  it('clamps negative t to index 0', () => {
    expect(beatIndexAt(timeline, -1)).toBe(0)
    expect(beatIndexAt(timeline, -9999)).toBe(0)
  })

  it('t = 0 -> first segment', () => {
    expect(beatIndexAt(timeline, 0)).toBe(0)
  })

  it('exact segment starts land in that segment', () => {
    expect(beatIndexAt(timeline, 1000)).toBe(1)
    expect(beatIndexAt(timeline, 1500)).toBe(2)
  })

  it('end - 1 of a segment still belongs to that segment', () => {
    expect(beatIndexAt(timeline, 999)).toBe(0)
    expect(beatIndexAt(timeline, 1499)).toBe(1)
  })

  it('totalMs and totalMs + 1 both return -1 (ended)', () => {
    expect(beatIndexAt(timeline, 3500)).toBe(-1)
    expect(beatIndexAt(timeline, 3501)).toBe(-1)
  })

  it('an empty timeline always returns -1', () => {
    const empty = buildTimeline([])
    expect(beatIndexAt(empty, 0)).toBe(-1)
    expect(beatIndexAt(empty, -1)).toBe(-1)
    expect(beatIndexAt(empty, 100)).toBe(-1)
  })

  it('zero-duration beat guard: a zero-duration beat in the middle is never returned as the active index', () => {
    const withZero = buildTimeline([beat('a', 1000), beat('zero', 0), beat('c', 1000)])
    // segments: a [0,1000) zero [1000,1000) c [1000,2000)
    expect(beatIndexAt(withZero, 1000)).toBe(2) // falls through the empty zero-duration range straight into 'c'
    expect(beatIndexAt(withZero, 999)).toBe(0)
    expect(beatIndexAt(withZero, 1999)).toBe(2)
  })

  it('zero-duration beat guard: an all-zero-duration timeline never returns a valid index (totalMs is 0, so every t is "ended")', () => {
    const allZero = buildTimeline([beat('a', 0), beat('b', 0)])
    expect(allZero.totalMs).toBe(0)
    expect(beatIndexAt(allZero, 0)).toBe(-1)
  })
})

describe('progressAt', () => {
  const timeline = buildTimeline([beat('a', 1000), beat('b', 1000)])

  it('reports index, localMs, localPct and globalPct mid-beat', () => {
    const p = progressAt(timeline, 250)
    expect(p.index).toBe(0)
    expect(p.localMs).toBe(250)
    expect(p.localPct).toBeCloseTo(0.25)
    expect(p.globalPct).toBeCloseTo(0.125)
  })

  it('the second beat resets localMs/localPct relative to its own start', () => {
    const p = progressAt(timeline, 1500)
    expect(p.index).toBe(1)
    expect(p.localMs).toBe(500)
    expect(p.localPct).toBeCloseTo(0.5)
    expect(p.globalPct).toBeCloseTo(0.75)
  })

  it('past totalMs -> index -1, pct fields at 1 (held state, not NaN)', () => {
    const p = progressAt(timeline, 5000)
    expect(p.index).toBe(-1)
    expect(p.localPct).toBe(1)
    expect(p.globalPct).toBe(1)
  })

  it('an empty timeline never produces NaN/Infinity', () => {
    const empty = buildTimeline([])
    const p = progressAt(empty, 0)
    expect(Number.isFinite(p.localMs)).toBe(true)
    expect(Number.isFinite(p.localPct)).toBe(true)
    expect(Number.isFinite(p.globalPct)).toBe(true)
  })
})
