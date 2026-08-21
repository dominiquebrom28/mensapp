// Component tests for src/features/trailer/EventTrailer.jsx.
//
// Rewritten 2026-08-21 for the owner's direction change: the generated beat
// sequence (tap-to-start poster, buildBeats/timeline/clock, media
// preloader, dual-layer audio) is gone. EventTrailer now (1) runs a 3-2-1
// countdown then autoplays (2026-08-21b amendment -- no tap-to-play any
// more), with an autoplay-unlock mitigation and a manual-play fallback for
// when the browser refuses anyway; (2) plays a real video via native
// `<video controls>`; (3) on the video ending, shows a single end-card view
// with the roster, the kretjes counter, and both CTAs. Uses the shared,
// OPT-IN src/test/mocks/mediaEnv.js -- installed/restored per test, never
// via the shared setup.js (zero risk to the rest of the suite).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { installMediaEnv } from '../mocks/mediaEnv.js'
import { SEEN_KEY, TRAILER_VERSION } from '../../features/trailer/constants.js'
import EventTrailer from '../../features/trailer/EventTrailer.jsx'

const baseInput = (overrides = {}) => ({
  eventId: 'evt-1',
  name: 'Mensdag XL',
  videoUrl: 'https://example.com/trailer.mp4',
  kretjes: 42,
  goingCount: 0,
  going: [],
  ...overrides,
})

const goingList = (n) => Array.from({ length: n }, (_, i) => ({ name: `Lad ${i}`, photoUrl: '', avatarIndex: i % 4 }))

// Tap the countdown to skip it -- the same affordance a real viewer has,
// and the fastest way for every other test to reach 'playing' without
// depending on real (or even faked) 3-second timers.
async function skipToPlaying() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /tap or press enter to skip/i }))
  })
}

// Advance the (faked) countdown clock one second at a time rather than in
// one 3000ms jump. The countdown effect reschedules its own next
// setTimeout from inside a state-update-triggered re-render each tick --
// collapsing all three ticks into a single `advanceTimersByTime(3000)` call
// does not reliably let React re-render and re-run the effect (and so
// schedule the *next* timer) between ticks within one synchronous advance,
// so it can stall partway through. One second per `act()` call gives each
// tick's state update and effect re-run room to actually happen.
async function advanceCountdownFully() {
  for (let i = 0; i < 3; i += 1) {
    // Deliberately sequential (not Promise.all) -- see the comment above.
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
  }
}

let env

afterEach(() => {
  cleanup()
  env?.restore()
  env = null
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('EventTrailer', () => {
  it('opens straight into a 3-2-1 countdown, video mounted underneath but not yet the active phase', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('↻ Watch again')).not.toBeInTheDocument()

    const video = screen.getByLabelText('Mensdag XL trailer video')
    expect(video.tagName).toBe('VIDEO')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('src', 'https://example.com/trailer.mp4')
  })

  describe('countdown + autoplay', () => {
    it('ticks down 3 -> 2 -> 1 at one-second intervals', () => {
      vi.useFakeTimers()
      env = installMediaEnv()
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)

      expect(screen.getByText('3')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.getByText('2')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('mounts by "blessing" the video element -- play() then pause() + currentTime reset -- while the opening tap is still fresh, before the countdown even finishes', async () => {
      env = installMediaEnv()
      const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
      const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause')
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)

      expect(playSpy).toHaveBeenCalledTimes(1) // the unlock/bless attempt, synchronous on mount

      await act(async () => {}) // flush the bless promise's .then()

      expect(pauseSpy).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('Mensdag XL trailer video').paused).toBe(true)
      // Blessing is invisible/instant -- it must not visibly interrupt the countdown.
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('autoplays for real once the countdown finishes (a second, later play() call)', async () => {
      vi.useFakeTimers()
      env = installMediaEnv()
      const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)
      playSpy.mockClear() // isolate the post-countdown call from the mount-time bless call

      await advanceCountdownFully()

      expect(playSpy).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('1')).not.toBeInTheDocument() // countdown overlay is gone
      expect(screen.queryByRole('button', { name: /play trailer/i })).not.toBeInTheDocument() // resolved -- no fallback needed
    })

    it('a tap on the countdown skips straight to the video -- no dead air', async () => {
      env = installMediaEnv()
      const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)
      playSpy.mockClear()

      await skipToPlaying()

      expect(screen.queryByRole('button', { name: /tap or press enter to skip/i })).not.toBeInTheDocument()
      expect(playSpy).toHaveBeenCalledTimes(1)
    })

    it('Escape during the countdown exits the trailer entirely rather than trapping the viewer in it', () => {
      env = installMediaEnv()
      const onClose = vi.fn()
      render(<EventTrailer input={baseInput()} onClose={onClose} />)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('when the post-countdown play() is rejected, shows a large obvious play button rather than a frozen countdown or forced-muted autoplay', async () => {
      vi.useFakeTimers()
      env = installMediaEnv()
      env.setPlayResult('reject')
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)

      await advanceCountdownFully()

      const fallback = screen.getByRole('button', { name: /play trailer/i })
      expect(fallback).toBeInTheDocument()
      expect(screen.getByLabelText('Mensdag XL trailer video').muted).toBe(false) // never forced-muted to sneak autoplay through
    })

    it('tapping the manual-play fallback (a fresh, direct gesture) starts playback and hides the fallback', async () => {
      vi.useFakeTimers()
      env = installMediaEnv()
      env.setPlayResult('reject')
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)
      await advanceCountdownFully()
      vi.useRealTimers()

      env.setPlayResult('resolve') // this tap is a fresh gesture -- it succeeds
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /play trailer/i }))
      })

      expect(screen.queryByRole('button', { name: /play trailer/i })).not.toBeInTheDocument()
    })

    it('the fallback stays visible (does not silently disappear) if a retry tap is ALSO rejected', async () => {
      vi.useFakeTimers()
      env = installMediaEnv()
      env.setPlayResult('reject')
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)
      await advanceCountdownFully()
      vi.useRealTimers()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /play trailer/i }))
      })

      expect(screen.getByRole('button', { name: /play trailer/i })).toBeInTheDocument()
    })

    // REGRESSION (2026-08-21c): "the video keeps starting over" -- a real
    // file over a real connection can leave the mount-time unlock's play()
    // pending for seconds while it buffers, well past the point the
    // post-countdown play() has already started real playback. A mock that
    // always resolves play() instantly cannot see this ordering at all --
    // `mediaEnv`'s `defer` mode exists specifically to reproduce it.
    it('REGRESSION: a late-resolving unlock attempt must never pause/reset a video that has already started real playback', async () => {
      vi.useFakeTimers()
      env = installMediaEnv()
      env.setPlayResult('defer') // the mount-time "bless" play() stays pending, like a real buffering video
      const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause')
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)

      expect(env.pendingPlayCount()).toBe(1) // the bless attempt is in flight, unresolved
      expect(pauseSpy).not.toHaveBeenCalled()

      // By the time the countdown finishes, the real play() call succeeds
      // promptly (the video is actually ready by then) -- this is call #2,
      // made while mode is 'resolve', so it's NOT added to the deferred
      // queue; `pendingPlayCount()` still refers only to the bless call.
      env.setPlayResult('resolve')
      await advanceCountdownFully()

      const video = screen.getByLabelText('Mensdag XL trailer video')
      expect(screen.queryByRole('button', { name: /play trailer/i })).not.toBeInTheDocument() // real playback took -- no fallback
      video.currentTime = 12.5 // simulate real playback progress

      // NOW the stale bless promise finally resolves -- late, after real
      // playback has already begun. It must be a complete no-op: never
      // pauses, never resets currentTime back to 0.
      await act(async () => {
        env.resolveNextDeferredPlay(0)
        await Promise.resolve()
      })

      expect(pauseSpy).not.toHaveBeenCalled()
      expect(video.currentTime).toBe(12.5)
    })
  })

  it('shows the end card (roster + kretjes + both CTAs) once the video ends, and marks the trailer seen', async () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 2, going: goingList(2) })} onClose={() => {}} />)
    await skipToPlaying()

    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByText('2 confirmed')).toBeInTheDocument()
    expect(screen.getByText('Lad 0')).toBeInTheDocument()
    expect(screen.getByText('Kretjes so far')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument() // kretjes count
    expect(screen.getByRole('button', { name: '↻ Watch again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RSVP now →' })).toBeInTheDocument()

    const seen = JSON.parse(localStorage.getItem(SEEN_KEY))
    expect(seen['evt-1']).toEqual({ v: TRAILER_VERSION, at: expect.any(Number) })
  })

  it('the kretjes nudge and the empty-roster nudge both land the "we need YOU" point, direct and urgent', async () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 0, going: [] })} onClose={() => {}} />)
    await skipToPlaying()

    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByText("Nobody's locked in yet")).toBeInTheDocument()
    expect(screen.getAllByText(/we need you to rsvp/i).length).toBeGreaterThanOrEqual(2) // both the roster nudge and the kretjes nudge
    expect(screen.queryByText(/confirmed$/)).not.toBeInTheDocument()
  })

  it('caps the named roster and shows a "+N more legends" tile beyond the cap', async () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 13, going: goingList(13) })} onClose={() => {}} />)
    await skipToPlaying()

    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByText('13 confirmed')).toBeInTheDocument()
    expect(screen.getByText('Lad 9')).toBeInTheDocument() // 10th named (index 9), within the cap
    expect(screen.queryByText('Lad 10')).not.toBeInTheDocument() // 11th, beyond the cap
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('more legends')).toBeInTheDocument()
  })

  it('a video error surfaces a clear message AND still shows the end card, rather than a dead black screen', async () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
    await skipToPlaying()

    fireEvent.error(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t play the trailer video/i)
    expect(screen.getByText('1 confirmed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RSVP now →' })).toBeInTheDocument()
  })

  it('no video URL at all goes straight to the end card with the same error messaging, skipping the countdown too (defensive -- the entry point should already gate on this)', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ videoUrl: '', goingCount: 1, going: goingList(1) })} onClose={() => {}} />)

    expect(screen.queryByText('3')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t play the trailer video/i)
    expect(screen.getByRole('button', { name: '↻ Watch again' })).toBeInTheDocument()
  })

  it('"Watch again" returns to the player and calls play() on the video element (no reload needed on the plain end-of-video path)', async () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
    await skipToPlaying()
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')

    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))
    expect(screen.getByRole('button', { name: '↻ Watch again' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '↻ Watch again' }))
    })

    expect(playSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '↻ Watch again' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mensdag XL trailer video')).toBeInTheDocument()
  })

  it('"Watch again" after a video error re-primes the source (calls load()) before playing, and clears the error banner', async () => {
    env = installMediaEnv()
    const loadSpy = vi.fn()
    window.HTMLMediaElement.prototype.load = loadSpy
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
    await skipToPlaying()

    fireEvent.error(screen.getByLabelText('Mensdag XL trailer video'))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '↻ Watch again' }))
    })

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mensdag XL trailer video')).toBeInTheDocument()
  })

  it('"Watch again" is a no-op (stays on the end card) when there was never a video URL to replay', () => {
    env = installMediaEnv()
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
    render(<EventTrailer input={baseInput({ videoUrl: '', goingCount: 1, going: goingList(1) })} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '↻ Watch again' }))

    expect(playSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '↻ Watch again' })).toBeInTheDocument()
  })

  it('"RSVP now" closes the trailer', async () => {
    env = installMediaEnv()
    const onClose = vi.fn()
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={onClose} />)
    await skipToPlaying()

    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))
    fireEvent.click(screen.getByRole('button', { name: 'RSVP now →' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the trailer', () => {
    env = installMediaEnv()
    const onClose = vi.fn()
    render(<EventTrailer input={baseInput()} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the always-visible close control closes the trailer', () => {
    env = installMediaEnv()
    const onClose = vi.fn()
    render(<EventTrailer input={baseInput()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /close trailer/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reduced motion sets data-tr-rm="1" on the root', () => {
    env = installMediaEnv({ reducedMotion: true })
    const { container } = render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    expect(container.querySelector('.tr-root')).toHaveAttribute('data-tr-rm', '1')
  })

  it('does not set data-tr-rm when the user has no reduced-motion preference', () => {
    env = installMediaEnv({ reducedMotion: false })
    const { container } = render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    expect(container.querySelector('.tr-root')).not.toHaveAttribute('data-tr-rm')
  })

  it('unmount restores document.body.style.overflow to its prior value', () => {
    env = installMediaEnv()
    document.body.style.overflow = 'auto'
    const { unmount } = render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('the RSVP CTA is a real ≥44px target (WCAG 2.2 target size)', async () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
    await skipToPlaying()
    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByRole('button', { name: 'RSVP now →' })).toHaveClass('tr-cta')
  })

  // REGRESSION (owner-reported, 2026-08-21f): native `<video controls>`'s
  // fullscreen button fullscreens the <video> ELEMENT ITSELF, not our
  // `.tr-root` container -- `.tr-endcard` is a sibling, so it renders
  // invisibly behind fullscreen chrome once the video ends while still
  // fullscreened, stranding the viewer with no reachable Watch again/RSVP.
  // See EventTrailer.jsx's own module docblock's "FULLSCREEN TRAP" note.
  describe('leaving native fullscreen so the end card is actually reachable', () => {
    it('standard Fullscreen API: ending the video while it is the fullscreened element calls exitFullscreen()', async () => {
      env = installMediaEnv()
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')

      await act(async () => { await video.requestFullscreen() })
      expect(document.fullscreenElement).toBe(video)

      fireEvent.ended(video)

      expect(document.fullscreenElement).toBe(null) // exited
      expect(screen.getByText('Kretjes so far')).toBeInTheDocument() // end card is actually reachable
      expect(screen.getByRole('button', { name: 'RSVP now →' })).toBeInTheDocument()
    })

    it('does NOT call exitFullscreen when some OTHER, unrelated element is fullscreened -- never yanks the viewer out of it', async () => {
      env = installMediaEnv()
      const unrelated = document.createElement('div')
      document.body.appendChild(unrelated)
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      env.setFullscreenElement(unrelated)

      fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

      expect(document.fullscreenElement).toBe(unrelated) // left alone
      expect(screen.getByText('Kretjes so far')).toBeInTheDocument() // end card still shows regardless
      unrelated.remove()
    })

    it('a rejected exitFullscreen() never blocks the end card from appearing', async () => {
      env = installMediaEnv()
      env.setExitFullscreenMode('reject')
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      await act(async () => { await video.requestFullscreen() })

      await act(async () => {
        fireEvent.ended(video)
        await Promise.resolve() // flush the rejected exitFullscreen().catch()
      })

      expect(screen.getByText('Kretjes so far')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'RSVP now →' })).toBeInTheDocument()
    })

    it('a synchronously-throwing exitFullscreen() never blocks the end card from appearing', async () => {
      env = installMediaEnv()
      env.setExitFullscreenMode('throw')
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      await act(async () => { await video.requestFullscreen() })

      expect(() => fireEvent.ended(video)).not.toThrow()

      expect(screen.getByText('Kretjes so far')).toBeInTheDocument()
    })

    it('the same treatment applies on the video error path, not just ended', async () => {
      env = installMediaEnv()
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      await act(async () => { await video.requestFullscreen() })

      fireEvent.error(video)

      expect(document.fullscreenElement).toBe(null)
      expect(screen.getByRole('status')).toHaveTextContent(/couldn.t play the trailer video/i)
      expect(screen.getByText('Kretjes so far')).toBeInTheDocument()
    })

    it('iOS Safari: ending the video while it is displaying its native fullscreen player calls video.webkitExitFullscreen()', async () => {
      env = installMediaEnv()
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      video.webkitDisplayingFullscreen = true // no document.fullscreenElement involved on iOS at all

      fireEvent.ended(video)

      expect(video.webkitDisplayingFullscreen).toBe(false) // exited
      expect(screen.getByText('Kretjes so far')).toBeInTheDocument()
    })

    it('iOS Safari: copes with fullscreen having ALREADY been left (device auto-exit on ended) without double-exiting or throwing', async () => {
      env = installMediaEnv()
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      // iOS often auto-dismisses its native player right as the video ends,
      // before our handler even runs -- simulate that having already
      // happened (flag already false) by the time `ended` fires.
      video.webkitDisplayingFullscreen = false

      expect(() => fireEvent.ended(video)).not.toThrow()

      expect(screen.getByText('Kretjes so far')).toBeInTheDocument()
    })

    it('iOS Safari: a throwing video.webkitExitFullscreen() never blocks the end card from appearing', async () => {
      env = installMediaEnv()
      env.setVideoWebkitExitFullscreenMode('throw')
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      video.webkitDisplayingFullscreen = true

      expect(() => fireEvent.ended(video)).not.toThrow()

      expect(screen.getByText('Kretjes so far')).toBeInTheDocument()
    })

    it('the webkitendfullscreen event (device-driven dismissal) re-focuses the end card once the exit has actually completed', async () => {
      env = installMediaEnv()
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      video.webkitDisplayingFullscreen = true

      fireEvent.ended(video) // -> phase 'ended', video.webkitExitFullscreen() fires webkitendfullscreen synchronously

      const endCard = document.querySelector('.tr-endcard')
      expect(endCard).toHaveFocus()
    })

    it('Replay works normally after ending fullscreen -- no lingering fullscreen state blocks it, and Replay itself does not try to restore fullscreen', async () => {
      env = installMediaEnv()
      const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
      render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
      await skipToPlaying()
      const video = screen.getByLabelText('Mensdag XL trailer video')
      await act(async () => { await video.requestFullscreen() })
      fireEvent.ended(video)
      playSpy.mockClear()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '↻ Watch again' }))
      })

      expect(playSpy).toHaveBeenCalledTimes(1) // playback works fine post-exit
      expect(document.fullscreenElement).toBe(null) // Replay never re-requests fullscreen on its own
      expect(screen.queryByRole('button', { name: '↻ Watch again' })).not.toBeInTheDocument()
    })
  })
})
