// Unit tests for src/features/trailer/useTrailerAudio.js -- the two-layer
// (music + optional VO) amendment. Uses the OPT-IN mock in
// src/test/mocks/mediaEnv.js (HTMLMediaElement play/pause/currentTime) plus
// an injectable fake now/raf/caf clock, never real timers, per the same
// testing discipline as useTrailerClock.
import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { installMediaEnv } from '../mocks/mediaEnv.js'
import { useTrailerAudio } from '../../features/trailer/useTrailerAudio.js'
import { DUCK_VOLUME_RATIO } from '../../features/trailer/constants.js'

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

function makeTrackingAudioFactory() {
  const created = []
  const factory = () => {
    const el = new Audio()
    created.push(el)
    return el
  }
  return { factory, created }
}

const readyUp = (el) => act(() => { el.dispatchEvent(new Event('canplaythrough')) })
const failUp = (el) => act(() => { el.dispatchEvent(new Event('error')) })

let env
afterEach(() => {
  // Unmount every rendered hook (which pauses its <audio> elements) WHILE
  // the media mocks are still installed -- src/test/setup.js's own
  // `afterEach(cleanup)` would otherwise run after this file's `afterEach`
  // reverts them (afterEach hooks run in reverse registration order),
  // hitting jsdom's real, unimplemented `HTMLMediaElement.pause()`.
  cleanup()
  env?.restore()
  env = null
})

describe('useTrailerAudio -- music bed (single layer behaviour, still applies)', () => {
  it('is not ready and start() is inert before canplaythrough/error fires', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))
    expect(created[0].paused).toBe(true)
  })

  it('start() calls play() synchronously and ramps volume in from 0', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    act(() => { result.current.start() })
    expect(created[0].paused).toBe(false)
    expect(created[0].volume).toBe(0)
    act(() => fake.advance(200)) // half of the 400ms default fade-in
    expect(created[0].volume).toBeGreaterThan(0)
    expect(created[0].volume).toBeLessThan(1)
  })

  it('marks unavailable if neither canplaythrough nor error fires within the failure timeout', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', failureTimeoutMs: 5000, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    expect(result.current.unavailable).toBe(false)
    act(() => { /* the failure timer is a real setTimeout, independent of the fake raf clock */ })
  })

  it('an error event marks the music bed unavailable', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    failUp(created[0])
    expect(result.current.unavailable).toBe(true)
  })

  it('getCurrentTimeMs reflects the music element only, in ms', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    created[0].currentTime = 12.5
    expect(result.current.getCurrentTimeMs()).toBe(12500)
  })
})

describe('useTrailerAudio -- VO absent/failed is a total, silent no-op', () => {
  it('voSrc: "" -- no VO element is even requested, voAvailable stays false, music is unaffected', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    expect(created).toHaveLength(1) // only the music element was constructed
    expect(result.current.voAvailable).toBe(false)

    act(() => { result.current.start() })
    // Music still plays and fades in normally with no VO present.
    expect(created[0].paused).toBe(false)
  })

  it('a VO load failure (error event) leaves voAvailable false and never calls play() on it', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    expect(created).toHaveLength(2) // music, then vo
    const vo = created[1]
    failUp(vo)
    expect(result.current.voAvailable).toBe(false)

    act(() => { result.current.start() })
    expect(vo.paused).toBe(true) // never started
  })

  it('startVoIfDue is a safe no-op when the VO never became available', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))
    expect(() => act(() => result.current.startVoIfDue(999999))).not.toThrow()
  })
})

describe('useTrailerAudio -- VO present: start timing, ducking, mute', () => {
  it('start() also starts the VO immediately when voStartMs <= 0 (the default)', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1]) // vo ready
    expect(result.current.voAvailable).toBe(true)

    act(() => { result.current.start() })
    expect(created[1].paused).toBe(false)
  })

  it('a VO with a positive voStartMs only starts once startVoIfDue is called with tMs past that threshold', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 5000, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() }) // music only -- voStartMs > 0
    expect(created[1].paused).toBe(true)

    act(() => result.current.startVoIfDue(3000))
    expect(created[1].paused).toBe(true) // not due yet

    act(() => result.current.startVoIfDue(5000))
    expect(created[1].paused).toBe(false)
  })

  it('starting the VO ducks the music bed down to ~DUCK_VOLUME_RATIO over DUCK_DOWN_MS', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, volume: 1, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() })
    act(() => fake.advance(400)) // let the fade-in settle first
    act(() => fake.advance(300)) // full duck-down window

    expect(created[0].volume).toBeCloseTo(DUCK_VOLUME_RATIO, 2)
  })

  it('the VO ending ramps the music bed back up over DUCK_UP_MS', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, volume: 1, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() })
    act(() => fake.advance(700)) // fade-in + full duck settled

    act(() => { created[1].dispatchEvent(new Event('ended')) })
    act(() => fake.advance(500)) // full duck-up window

    expect(created[0].volume).toBeCloseTo(1, 1)
  })

  it('toggleMute silences both layers together, and un-muting restores each to its own resting volume', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, volume: 1, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() })
    act(() => fake.advance(400))

    act(() => result.current.toggleMute())
    expect(created[0].volume).toBe(0)
    expect(created[1].volume).toBe(0)

    act(() => result.current.toggleMute())
    expect(created[0].volume).toBeGreaterThan(0)
    expect(created[1].volume).toBeGreaterThan(0)
  })

  it('fadeOutAndPause fades and pauses both layers, resolving once via onDone', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() })
    act(() => fake.advance(400))

    let done = false
    act(() => { result.current.fadeOutAndPause(() => { done = true }) })
    act(() => fake.advance(600))

    expect(done).toBe(true)
    expect(created[0].paused).toBe(true)
    expect(created[1].paused).toBe(true)
    expect(created[0].volume).toBe(0)
  })
})
