// Component tests for src/features/trailer/EventTrailer.jsx.
//
// Rewritten 2026-08-21 for the owner's direction change: the generated beat
// sequence (tap-to-start poster, buildBeats/timeline/clock, media
// preloader, dual-layer audio) is gone. EventTrailer now (1) plays a real
// video via native `<video controls>`, and (2) on the video ending, shows a
// single end-card view with the roster, the kretjes counter, and both
// CTAs. Uses the shared, OPT-IN src/test/mocks/mediaEnv.js -- installed/
// restored per test, never via the shared setup.js (zero risk to the rest
// of the suite).
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

let env

afterEach(() => {
  cleanup()
  env?.restore()
  env = null
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('EventTrailer', () => {
  it('renders the video with controls and the event as its accessible label, no end card yet', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput()} onClose={() => {}} />)

    const video = screen.getByLabelText('Mensdag XL trailer video')
    expect(video.tagName).toBe('VIDEO')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('src', 'https://example.com/trailer.mp4')
    expect(screen.queryByText('↻ Watch again')).not.toBeInTheDocument()
  })

  it('shows the end card (roster + kretjes + both CTAs) once the video ends, and marks the trailer seen', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 2, going: goingList(2) })} onClose={() => {}} />)

    const video = screen.getByLabelText('Mensdag XL trailer video')
    fireEvent.ended(video)

    expect(screen.getByText('2 confirmed')).toBeInTheDocument()
    expect(screen.getByText('Lad 0')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument() // kretjes count
    expect(screen.getByRole('button', { name: '↻ Watch again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RSVP now →' })).toBeInTheDocument()

    const seen = JSON.parse(localStorage.getItem(SEEN_KEY))
    expect(seen['evt-1']).toEqual({ v: TRAILER_VERSION, at: expect.any(Number) })
  })

  it('an empty roster (goingCount 0) shows the empty-state nudge, never an empty grid', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 0, going: [] })} onClose={() => {}} />)

    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByText("Nobody's locked in yet")).toBeInTheDocument()
    expect(screen.queryByText(/confirmed$/)).not.toBeInTheDocument()
  })

  it('caps the named roster and shows a "+N more legends" tile beyond the cap', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 13, going: goingList(13) })} onClose={() => {}} />)

    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByText('13 confirmed')).toBeInTheDocument()
    expect(screen.getByText('Lad 9')).toBeInTheDocument() // 10th named (index 9), within the cap
    expect(screen.queryByText('Lad 10')).not.toBeInTheDocument() // 11th, beyond the cap
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('more legends')).toBeInTheDocument()
  })

  it('a video error surfaces a clear message AND still shows the end card, rather than a dead black screen', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)

    fireEvent.error(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t play the trailer video/i)
    expect(screen.getByText('1 confirmed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RSVP now →' })).toBeInTheDocument()
  })

  it('no video URL at all goes straight to the end card with the same error messaging (defensive -- the entry point should already gate on this)', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ videoUrl: '', goingCount: 1, going: goingList(1) })} onClose={() => {}} />)

    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t play the trailer video/i)
    expect(screen.getByRole('button', { name: '↻ Watch again' })).toBeInTheDocument()
  })

  it('"Watch again" returns to the player and calls play() on the video element (no reload needed on the plain end-of-video path)', async () => {
    env = installMediaEnv()
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)

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

  it('"RSVP now" closes the trailer', () => {
    env = installMediaEnv()
    const onClose = vi.fn()
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={onClose} />)

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

  it('the RSVP CTA is a real ≥44px target (WCAG 2.2 target size)', () => {
    env = installMediaEnv()
    render(<EventTrailer input={baseInput({ goingCount: 1, going: goingList(1) })} onClose={() => {}} />)
    fireEvent.ended(screen.getByLabelText('Mensdag XL trailer video'))

    expect(screen.getByRole('button', { name: 'RSVP now →' })).toHaveClass('tr-cta')
  })
})
