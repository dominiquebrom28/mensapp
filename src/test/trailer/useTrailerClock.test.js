// Unit tests for src/features/trailer/useTrailerClock.js.
//
// Per docs/trailer-technical-spec.md §8: dependency injection, NOT fake
// timers -- `makeFakeClock()` below is lifted verbatim from the spec.
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrailerClock } from '../../features/trailer/useTrailerClock.js'
import { buildTimeline } from '../../features/trailer/timeline.js'

function makeFakeClock() {
  let t = 0, queue = [], id = 0
  return {
    now: () => t,
    raf: (cb) => { queue.push({ id: ++id, cb }); return id },
    caf: (x) => { queue = queue.filter((q) => q.id !== x) },
    advance(dtMs) { t += dtMs; const q = queue; queue = []; q.forEach((e) => e.cb(t)) },
    pending: () => queue.length,
  }
}

const beat = (id, durationMs) => ({ id, kind: 'stop', durationMs, data: {} })

describe('useTrailerClock', () => {
  it('does not fire onBeatChange for the initial index on mount', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('a', 1000), beat('b', 1000)])
    const onBeatChange = vi.fn()
    renderHook(() => useTrailerClock({ timeline, onBeatChange, now: fake.now, raf: fake.raf, caf: fake.caf }))
    expect(onBeatChange).not.toHaveBeenCalled()
  })

  it('no drift over 500 frames of 16ms each', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    for (let i = 0; i < 500; i++) {
      act(() => fake.advance(16))
    }
    expect(result.current.tRef.current).toBe(8000)
  })

  it('pause/resume conserves elapsed time exactly -- no time lost or gained across a pause', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => fake.advance(16))
    act(() => fake.advance(16))
    expect(result.current.tRef.current).toBe(32)

    act(() => result.current.pause())
    expect(result.current.state).toBe('paused')
    // Time "passes" in the real world while paused -- the fake clock's `t`
    // keeps ticking, but with the loop cancelled there's nothing queued to
    // consume it.
    fake.advance(5000)
    expect(result.current.tRef.current).toBe(32) // unchanged while paused

    act(() => result.current.play())
    act(() => fake.advance(16))
    expect(result.current.tRef.current).toBe(48) // 32 + 16, the paused gap never counted
  })

  it('seek jumps directly to a time and updates the index once (not a walk through every intermediate beat)', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('a', 1000), beat('b', 1000), beat('c', 1000), beat('d', 1000)])
    const onBeatChange = vi.fn()
    const { result } = renderHook(() => useTrailerClock({ timeline, onBeatChange, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.seek(2500))
    expect(result.current.index).toBe(2)
    expect(result.current.tRef.current).toBe(2500)
    expect(onBeatChange).toHaveBeenCalledTimes(1)
    expect(onBeatChange).toHaveBeenCalledWith(2, 0)
  })

  it('restart() resets to index 0 and time 0, and (re)starts playback', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('a', 100), beat('b', 100)])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => fake.advance(250)) // clamped to 100/frame -> ends after enough frames
    act(() => fake.advance(100))
    expect(result.current.state).toBe('ended')

    act(() => result.current.restart())
    expect(result.current.state).toBe('playing')
    expect(result.current.index).toBe(0)
    expect(result.current.tRef.current).toBe(0)
  })

  it('onBeatChange fires exactly once per boundary crossed, even when a single (clamped) frame spans two short beats', () => {
    const fake = makeFakeClock()
    // Two 50ms beats, then a long one. A single 100ms-clamped frame from
    // t=0 lands exactly at t=100 -- the start of the third beat, having
    // crossed both the a->b and b->c boundaries in one tick.
    const timeline = buildTimeline([beat('a', 50), beat('b', 50), beat('c', 5000)])
    const onBeatChange = vi.fn()
    const { result } = renderHook(() => useTrailerClock({ timeline, onBeatChange, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => fake.advance(100))

    expect(onBeatChange.mock.calls).toEqual([[1, 0], [2, 1]])
    expect(result.current.index).toBe(2)
  })

  it('frame delta is clamped to 100ms: a single huge wall-clock jump only advances the clock by 100ms', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => fake.advance(10000)) // backgrounded-tab-style jump
    expect(result.current.tRef.current).toBe(100)
  })

  it('onEnd fires exactly once when playback reaches the end, and state holds at "ended" on the final beat', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('a', 100), beat('b', 100)])
    const onEnd = vi.fn()
    const { result } = renderHook(() => useTrailerClock({ timeline, onEnd, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => fake.advance(100))
    act(() => fake.advance(100))
    expect(result.current.state).toBe('ended')
    expect(result.current.index).toBe(1) // holds on the final beat, not -1
    expect(onEnd).toHaveBeenCalledTimes(1)

    // Further frames must not fire onEnd again or move the loop.
    act(() => fake.advance(100))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(fake.pending()).toBe(0)
  })

  it('on unmount, caf is called and no frames remain pending (the StrictMode double-loop guard)', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result, unmount } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    expect(fake.pending()).toBe(1)

    unmount()
    expect(fake.pending()).toBe(0)
  })

  it('play() called twice in a row does not create a second concurrent loop', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => result.current.play())
    expect(fake.pending()).toBe(1)
  })

  it('toggle() pauses when playing and resumes when paused', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.toggle())
    expect(result.current.state).toBe('playing')
    act(() => result.current.toggle())
    expect(result.current.state).toBe('paused')
    expect(fake.pending()).toBe(0)
  })

  it('an empty timeline never starts a loop and reports index -1', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    expect(fake.pending()).toBe(0)
    expect(result.current.index).toBe(-1)
  })
})
