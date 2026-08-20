// Component tests for src/features/trailer/EventTrailer.jsx (technical spec
// §8's `EventTrailer.render.test.jsx`). Uses the shared, OPT-IN
// src/test/mocks/mediaEnv.js -- installed/restored per test, never via the
// shared setup.js (zero risk to the rest of the suite).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { installMediaEnv } from '../mocks/mediaEnv.js'
import EventTrailer from '../../features/trailer/EventTrailer.jsx'

// Deliberately the same shape as buildBeats.test.js's `baseInput` -- a
// no-media, no-schedule event resolves to the floor sequence
// [title, meta, outro], keeping these tests fast/deterministic and
// exercising the "no images anywhere" degrade path incidentally.
const baseInput = (overrides = {}) => ({
  eventId: 'evt-1',
  name: 'Mensdag XL',
  type: 'day',
  theme: '',
  location: 'Amsterdam',
  dateLabel: '12 september 2026',
  startsAtIso: '2026-09-12T12:00:00',
  dayCount: 1,
  stops: [],
  secretCount: 0,
  goingCount: 0,
  going: [],
  ...overrides,
})

let env
afterEach(() => {
  cleanup()
  env?.restore()
  env = null
  vi.restoreAllMocks()
})

describe('EventTrailer', () => {
  it('renders the start poster and does not call play() before the tap', () => {
    env = installMediaEnv()
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
    render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    expect(screen.getByRole('button', { name: /play trailer/i })).toBeInTheDocument()
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('calls play() once on tap', async () => {
    env = installMediaEnv()
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
    render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play trailer/i }))
    })

    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('a rejected play() still starts the visual trailer', async () => {
    env = installMediaEnv()
    env.setPlayResult('reject')
    render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play trailer/i }))
    })

    // The poster is gone and the tap-zone chrome (only mounted once
    // `started` is true) is in the document -- the visual sequence started
    // regardless of the audio promise rejecting.
    expect(screen.queryByRole('button', { name: /play trailer/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next beat/i })).toBeInTheDocument()
  })

  it('Escape closes the trailer', () => {
    env = installMediaEnv()
    const onClose = vi.fn()
    render(<EventTrailer input={baseInput()} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the always-visible Skip control closes the trailer', () => {
    env = installMediaEnv()
    const onClose = vi.fn()
    render(<EventTrailer input={baseInput()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /skip trailer/i }))

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

  // Mobile pause control (technical spec §5.4's "tap/click the stage:
  // toggle() pause/resume" -- reachable on a touchscreen, since the
  // creative-spec tap zones claim the whole stage for skip/replay instead;
  // see EventTrailer.jsx's own "FLAGGED SPEC CONFLICT" docblock). This is
  // wiring coverage only -- `toggle()`/`pause()` actually halting the rAF
  // clock is the (already-QA'd, unchanged) engine layer's own contract,
  // covered by useTrailerClock.test.js's pause/resume assertions.
  describe('mobile pause control', () => {
    async function startedTrailer() {
      const onClose = vi.fn()
      const utils = render(<EventTrailer input={baseInput()} onClose={onClose} />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /play trailer/i }))
      })
      return utils
    }

    it('renders a 44x44 Pause control once playing, that flips to Play on click and back on a second click', async () => {
      env = installMediaEnv()
      await startedTrailer()

      const toggleBtn = await screen.findByRole('button', { name: /^pause$/i })
      expect(toggleBtn).toHaveClass('tr-icon-btn') // min-width/min-height:44px, see TrailerStyles.jsx
      expect(toggleBtn).toHaveTextContent('⏸')

      fireEvent.click(toggleBtn)
      expect(screen.getByRole('button', { name: /^play$/i })).toHaveTextContent('▶')
      expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
      expect(screen.getByRole('button', { name: /^pause$/i })).toHaveTextContent('⏸')
    })

    it('is present at both the mobile and desktop chrome layout (no viewport-gated rendering)', async () => {
      // The control's *rendering* isn't behind any matchMedia/viewport
      // check -- it's a plain conditional on clock.state, so it exists in
      // the DOM regardless of viewport. (Pixel-level position at each
      // breakpoint is a visual/layout concern outside jsdom's box-model
      // support -- see the trailer QA report for a static CSS-math flag
      // about the neighbouring Mute control's position at the mobile
      // breakpoint specifically.)
      env = installMediaEnv()
      await startedTrailer()
      expect(await screen.findByRole('button', { name: /^pause$/i })).toBeInTheDocument()
    })

    it('Space bar toggles the same control (shared handler with the on-screen button)', async () => {
      env = installMediaEnv()
      await startedTrailer()
      await screen.findByRole('button', { name: /^pause$/i })

      fireEvent.keyDown(window, { key: ' ' })
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()

      fireEvent.keyDown(window, { key: ' ' })
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument()
    })

    it('does not throw when Space is pressed before the trailer has started (no clock yet)', () => {
      env = installMediaEnv()
      render(<EventTrailer input={baseInput()} onClose={() => {}} />)
      expect(() => fireEvent.keyDown(window, { key: ' ' })).not.toThrow()
    })
  })
})
