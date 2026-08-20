// QA pass: adversarial / gap-filling tests for useTrailerClock.js beyond
// useTrailerClock.test.js. Focus: an ACTUAL React.StrictMode double-invoke
// (not just a manual unmount), seek past-end/negative, restart-from-ended,
// and a zero-duration beat walked through mid-playback.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
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

describe('useTrailerClock -- real React.StrictMode double-invoke (not a manual unmount)', () => {
  it('mounting under StrictMode (mount -> cleanup -> mount, all before the test can act) never leaves two live loops: playback runs at normal speed, not double speed', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result } = renderHook(
      () => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }),
      { wrapper: ({ children }) => React.createElement(React.StrictMode, null, children) },
    )

    act(() => result.current.play())
    // Exactly one pending frame, not two -- StrictMode's extra mount/unmount
    // cycle must not have left a duplicate rAF loop registered.
    expect(fake.pending()).toBe(1)

    // Advance in increments comfortably under the 100ms frame-delta clamp,
    // so a doubled loop shows up as literal double-speed progress rather
    // than being masked by the clamp.
    for (let i = 0; i < 5; i++) act(() => fake.advance(30))
    // If a second loop were alive, each advance() would apply the delta
    // twice (each queued callback independently reads/writes tRef via
    // applyTime), producing double-speed progress. 150ms of wall time must
    // map to exactly 150ms of clock time, not ~300ms.
    expect(result.current.tRef.current).toBe(150)

    for (let i = 0; i < 5; i++) act(() => fake.advance(30))
    expect(result.current.tRef.current).toBe(300)
  })

  it('StrictMode double-invoke + immediate unmount leaves nothing pending at all', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('long', 100000)])
    const { result, unmount } = renderHook(
      () => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }),
      { wrapper: ({ children }) => React.createElement(React.StrictMode, null, children) },
    )
    act(() => result.current.play())
    unmount()
    expect(fake.pending()).toBe(0)
  })
})

describe('useTrailerClock -- seek/restart edge cases', () => {
  it('seek() past the end lands on the final beat, fires onEnd once, and holds state "ended"', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('a', 100), beat('b', 100)])
    const onEnd = vi.fn()
    const { result } = renderHook(() => useTrailerClock({ timeline, onEnd, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.seek(999999))
    expect(result.current.state).toBe('ended')
    expect(result.current.index).toBe(1) // holds on the final beat, not -1
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('seek() with a negative time clamps to 0 / index 0, never throws, never goes negative', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('a', 100), beat('b', 100)])
    const { result } = renderHook(() => useTrailerClock({ timeline, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.seek(500)) // move away from 0 first
    expect(() => act(() => result.current.seek(-500))).not.toThrow()
    expect(result.current.tRef.current).toBe(0)
    expect(result.current.index).toBe(0)
  })

  it('restart() from "ended" resets time/index to 0 and resumes playing (not stuck in ended)', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('a', 100)])
    const onEnd = vi.fn()
    const { result } = renderHook(() => useTrailerClock({ timeline, onEnd, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => fake.advance(200))
    expect(result.current.state).toBe('ended')
    expect(onEnd).toHaveBeenCalledTimes(1)

    act(() => result.current.restart())
    expect(result.current.state).toBe('playing')
    expect(result.current.tRef.current).toBe(0)
    expect(result.current.index).toBe(0)

    // Playing back to the end again fires onEnd exactly a second time (not
    // suppressed by the earlier "already ended" flag).
    act(() => fake.advance(200))
    expect(result.current.state).toBe('ended')
    expect(onEnd).toHaveBeenCalledTimes(2)
  })

  it('a zero-duration beat sandwiched between two real beats still gets its own onBeatChange call while walking through in one tick', () => {
    const fake = makeFakeClock()
    // a[0,50) zero[50,50) b[50,5000) -- a single clamped 100ms frame from
    // t=0 would overshoot straight past zero into b; use a smaller delta so
    // the walk lands exactly on the zero-duration beat's boundary first.
    const timeline = buildTimeline([beat('a', 50), beat('zero', 0), beat('b', 5000)])
    const onBeatChange = vi.fn()
    const { result } = renderHook(() => useTrailerClock({ timeline, onBeatChange, now: fake.now, raf: fake.raf, caf: fake.caf }))

    act(() => result.current.play())
    act(() => fake.advance(50)) // lands exactly at t=50 -> beatIndexAt resolves straight through zero to 'b' (index 2)
    // The walk mode steps index-by-index from prev(0) to resolved(2), so it
    // must still fire once for index 1 (the zero-duration beat) even though
    // no wall-clock time was ever "spent" inside it.
    expect(onBeatChange.mock.calls).toEqual([[1, 0], [2, 1]])
  })

  it('a zero-duration FIRST beat (index 0 has durationMs 0) does not break the very first tick', () => {
    const fake = makeFakeClock()
    const timeline = buildTimeline([beat('zero', 0), beat('a', 1000)])
    const onBeatChange = vi.fn()
    const { result } = renderHook(() => useTrailerClock({ timeline, onBeatChange, now: fake.now, raf: fake.raf, caf: fake.caf }))

    expect(result.current.index).toBe(0) // initial index, zero-duration beat included in count
    act(() => result.current.play())
    act(() => fake.advance(1))
    expect(result.current.index).toBe(1)
    expect(onBeatChange).toHaveBeenCalledWith(1, 0)
  })
})
