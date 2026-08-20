// QA pass: gap-filling / adversarial tests for useTrailerAudio.js beyond
// useTrailerAudio.test.js. Focus: play() rejecting, overlapping duck ramps
// not stranding volume mid-fade, mute mid-duck, "audio is never the clock",
// and double-start/double-toggle safety.
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

let env
afterEach(() => {
  cleanup()
  env?.restore()
  env = null
})

describe('useTrailerAudio -- play() rejecting (autoplay policy) never breaks the trailer', () => {
  it('a rejected music play() marks unavailable but throws nothing, and start() itself does not throw', async () => {
    env = installMediaEnv()
    env.setPlayResult('reject')
    const fake = makeFakeClock()
    const { factory } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    let threw = false
    act(() => {
      try { result.current.start() } catch { threw = true }
    })
    expect(threw).toBe(false)
    // Let the rejected promise's microtask settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(result.current.unavailable).toBe(true)
  })

  it('a rejected VO play() undoes the duck (music returns to full) and never throws', async () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, volume: 1, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    // Music resolves play() fine; only the VO's play() call will reject --
    // simulate by flipping the whole mock to reject just for the VO start.
    env.setPlayResult('reject')
    act(() => { result.current.start() })
    // Duck-down was applied optimistically before the rejection settles.
    act(() => fake.advance(300))
    expect(created[0].volume).toBeCloseTo(DUCK_VOLUME_RATIO * 1 /* music started at 0, fade-in also rejected */, 1)

    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    // After the rejection settles, the duck must be undone (ramping back up).
    act(() => fake.advance(500))
    expect(created[0].volume).toBeGreaterThan(DUCK_VOLUME_RATIO)
  })
})

describe('useTrailerAudio -- overlapping ramps do not fight or strand volume', () => {
  it('toggling mute mid-duck-down does not leave the music bed stranded at an intermediate volume forever', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, volume: 1, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() })
    // With voStartMs 0, the VO starts in the same tick as start(), so the
    // duck-down ramp (musicFadeHandleRef) supersedes the fade-in ramp
    // immediately (both share the same ref -- the second `ramp()` call
    // cancels the first). Catch it mid-flight, before the 300ms duck window
    // finishes.
    act(() => fake.advance(150))
    const midDuck = created[0].volume
    expect(midDuck).toBeGreaterThan(0)
    expect(midDuck).toBeLessThan(DUCK_VOLUME_RATIO)

    act(() => result.current.toggleMute())
    expect(created[0].volume).toBe(0) // mute wins immediately, not stranded mid-ramp

    act(() => result.current.toggleMute())
    // Unmuting restores to the CURRENT resting target (still ducked, VO
    // hasn't ended), not back to full volume, and not stuck at the
    // mid-ramp value it was interrupted at.
    expect(created[0].volume).toBeCloseTo(DUCK_VOLUME_RATIO, 2)

    // And the pre-existing (now-orphaned) ramp step, if it ever fires again,
    // must not un-mute or overshoot past the ducked target.
    act(() => fake.advance(1000))
    expect(created[0].volume).toBeCloseTo(DUCK_VOLUME_RATIO, 2)
  })

  it('duck-down immediately followed by duck-up (VO ends almost instantly) settles at full volume, not stranded partway', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, volume: 1, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() })
    act(() => fake.advance(400))
    // Duck starts, but VO "ends" almost immediately (overlapping ramps:
    // duck-down cancelled mid-flight by duck-up).
    act(() => fake.advance(30))
    act(() => { created[1].dispatchEvent(new Event('ended')) })
    act(() => fake.advance(1000)) // more than enough for the duck-up ramp to finish

    expect(created[0].volume).toBeCloseTo(1, 1) // settled at full, not stuck between DUCK_VOLUME_RATIO and 1
  })

  it('calling start() a second time does not create a second overlapping fade-in ramp', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    act(() => { result.current.start() })
    act(() => { result.current.start() }) // second call before fade-in even settles
    act(() => fake.advance(400))
    expect(created[0].volume).toBeCloseTo(1, 1) // reaches full, no runaway/overshoot from two competing ramps
  })
})

describe('useTrailerAudio -- audio is never the clock', () => {
  it('the hook exposes no play/tick/advance/seek surface of its own -- only getCurrentTimeMs (read-only) and startVoIfDue (event-driven, not time-driven)', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    const api = Object.keys(result.current)
    for (const forbidden of ['tick', 'advance', 'seek', 'play', 'index', 'onBeatChange']) {
      expect(api).not.toContain(forbidden)
    }
  })

  it('getCurrentTimeMs never advances on its own -- it only reflects whatever the mocked <audio>.currentTime happens to be, never ticks via the injected raf/now', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voSrc: '', now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    created[0].currentTime = 1
    expect(result.current.getCurrentTimeMs()).toBe(1000)
    act(() => fake.advance(5000)) // advancing the injected clock must not change audio.currentTime itself
    expect(created[0].currentTime).toBe(1)
    expect(result.current.getCurrentTimeMs()).toBe(1000)
  })
})

describe('useTrailerAudio -- mute mid-duck restores the correct (ducked, not full) level', () => {
  it('un-muting while the VO is still audible restores the ducked resting volume, not full volume', () => {
    env = installMediaEnv()
    const fake = makeFakeClock()
    const { factory, created } = makeTrackingAudioFactory()
    const { result } = renderHook(() => useTrailerAudio({ voStartMs: 0, volume: 1, now: fake.now, raf: fake.raf, caf: fake.caf, createAudio: factory }))

    readyUp(created[1])
    act(() => { result.current.start() })
    act(() => fake.advance(700)) // fade-in + full duck-down settled
    expect(created[0].volume).toBeCloseTo(DUCK_VOLUME_RATIO, 2)

    act(() => result.current.toggleMute())
    expect(created[0].volume).toBe(0)
    act(() => result.current.toggleMute())
    expect(created[0].volume).toBeCloseTo(DUCK_VOLUME_RATIO, 2) // ducked, not 1
  })
})
