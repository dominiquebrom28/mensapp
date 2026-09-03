// Wiring tests for the Overview Summary view's "share/download as image"
// button (owner request: "make the summary downloadable as image(s) for
// users" -- the Summary card is already built to be screenshotted into the
// group chat; this makes that a real action). `modern-screenshot` is loaded
// lazily inside the click handler and jsdom cannot rasterise a canvas
// anyway, so these tests mock the library outright and assert the WIRING:
// which branch is taken (native share vs. plain download), that a user
// cancelling the share sheet (AbortError) is treated as a normal outcome
// rather than a failure, that a real failure surfaces visibly, that a
// capture which never settles at all is recovered by a hard timeout rather
// than hanging the button forever, and -- load-bearing for this app
// specifically, per its own history of shipping this exact leak twice --
// that a non-editor's captured node never contains a secret stop's content
// while an editor's deliberately does.
//
// Why `modern-screenshot` and not `html-to-image` (the first choice here):
// a real-browser check surfaced `html-to-image`'s `toBlob` hanging forever
// even on a trivial `<div>hello</div>` -- no error, no result. Source
// inspection (`html-to-image/lib/util.js`'s `createImage`) plus upstream
// GitHub confirmed this matches a known, still-open, unmerged bug
// (bubkoo/html-to-image #589: `img.decode()` rejecting leaves the promise
// neither resolved nor rejected -- "hangs forever"), alongside two 2025
// reports of the same library freezing the tab on ordinary DOM in current
// Chrome/Firefox (#544, #536). `modern-screenshot` is the actively
// maintained fork created to fix exactly this class of bug. See
// `shareOrDownloadSummary`'s own comment in App.jsx for the full citation.
//
// Same integration technique as overviewScheduleSummary.integration.test.jsx
// (drives a real `<App/>` resumed into a logged-in session via the
// `md-session` trick, navigated to a real event via the real EventCard):
// `OverviewTab` has no module export to import directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockDomToBlob } = vi.hoisted(() => ({
  mockDomToBlob: vi.fn(async () => new Blob(['fake-png-bytes'], { type: 'image/png' })),
}))

// The real, load-bearing assertion that this module is never in the main
// chunk lives in the build-output check (chunk breakdown, reported
// separately) -- this mock only exists so the dynamic `await
// import('modern-screenshot')` inside the click handler resolves to
// something jsdom can actually run.
vi.mock('modern-screenshot', () => ({
  domToBlob: mockDomToBlob,
}))

vi.mock('../supabase.js', async () => {
  const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      users: {
        data: [
          { id: 'u-1', username: 'Doom', display_name: 'Doom', role: 'admin+org', pin_hash: 'x', joined_at: '2023-01-01', avatar: 0 },
          { id: 'u-2', username: 'Bram', display_name: 'Bram', role: 'lad', pin_hash: 'x', joined_at: '2023-01-01', avatar: 1 },
        ],
        error: null,
      },
      events: {
        data: [
          {
            id: 'evt-1',
            name: 'Zomerweekend 2026',
            type: 'weekend',
            date: '2026-09-11',
            end_date: '2026-09-12',
            start_time: '12:00',
            end_time: '',
            location: 'Camping De Lach',
            description: '',
            theme: '',
            trailer_video_url: '',
            teaser_active: false,
            teaser_title: '',
            teaser_text: '',
            teaser_button_label: '',
            polls: [],
            photos: [],
            quizzes: [],
            winners: [],
            highlights: [],
            faqs: [],
            archived: false,
            kretjes: 0,
            attendees: [],
            // One public stop + one SECRET stop -- the exact shape the
            // capture must never leak for a non-editor.
            schedule: [
              { day: 0, time: '12:00', activity: 'Aankomst lunch', location: 'Café De Kroeg', secret: false },
              { day: 0, time: '20:00', activity: 'Geheime verrassing', location: 'Onbekende bunker', note: 'niet lekken', secret: true },
            ],
            bring: ['Regenjas'],
          },
        ],
        error: null,
      },
      announcements: { data: [], error: null },
    }),
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../App.jsx')

async function openSummaryView() {
  render(<App />)
  await waitFor(() => {
    expect(screen.getByText('Zomerweekend 2026')).toBeInTheDocument()
  })
  const user = userEvent.setup()
  await user.click(screen.getByText('Zomerweekend 2026'))
  await waitFor(() => {
    expect(screen.getByText("👀 What's on the Menu")).toBeInTheDocument()
  })
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await waitFor(() => {
    expect(screen.getByText('🎒 MEENEMEN')).toBeInTheDocument()
  })
  return user
}

describe('Overview Summary view — share/download as image', () => {
  afterEach(() => {
    localStorage.clear()
    delete navigator.share
    delete navigator.canShare
    // Safety net for the fake-timer tests below -- a test that threw before
    // reaching its own `vi.useRealTimers()` would otherwise leave every
    // subsequent test running on a fake clock.
    vi.useRealTimers()
  })

  beforeEach(() => {
    mockDomToBlob.mockReset().mockResolvedValue(new Blob(['fake-png-bytes'], { type: 'image/png' }))
  })

  describe('as a regular member (non-editor)', () => {
    beforeEach(() => {
      localStorage.setItem('md-session', 'u-2')
    })

    it('a device that can share files gets the share button, and clicking it calls navigator.share with the PNG', async () => {
      const shareMock = vi.fn(async () => {})
      navigator.canShare = vi.fn(() => true)
      navigator.share = shareMock

      const user = await openSummaryView()
      const btn = screen.getByRole('button', { name: '📤 Deel als afbeelding' })
      await user.click(btn)

      await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1))
      const call = shareMock.mock.calls[0][0]
      expect(call.files).toHaveLength(1)
      expect(call.files[0].type).toBe('image/png')
      expect(call.files[0].name).toMatch(/^zomerweekend-2026-2026-09-11-summary\.png$/)
      expect(call.title).toBe('Zomerweekend 2026')

      // Background/scale/a library-level timeout were all actually wired
      // through to the capture call, not left at the library's defaults.
      expect(mockDomToBlob).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({
          backgroundColor: expect.any(String),
          scale: expect.any(Number),
          timeout: expect.any(Number),
        }),
      )

      // No error surfaced, button back to its resting label.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: '📤 Deel als afbeelding' })).not.toBeDisabled())
    })

    it('a device that cannot share files falls back to a plain download (no share call)', async () => {
      navigator.share = vi.fn(async () => {}) // present, but...
      navigator.canShare = vi.fn(() => false) // ...cannot share files

      let capturedAnchor = null
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick() {
        capturedAnchor = this
      })
      const createObjectURL = vi.fn(() => 'blob:mock-url')
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

      const user = await openSummaryView()
      const btn = screen.getByRole('button', { name: '⬇ Download als afbeelding' })
      await user.click(btn)

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
      expect(capturedAnchor).not.toBeNull()
      expect(capturedAnchor.download).toMatch(/^zomerweekend-2026-2026-09-11-summary\.png$/)
      expect(capturedAnchor.href).toBe('blob:mock-url')
      expect(navigator.share).not.toHaveBeenCalled()

      // The object URL is revoked ~1s later (real `setTimeout`, not
      // mocked) -- wait for that to actually happen *before* unstubbing
      // `URL`, otherwise this leaves a dangling real timer that fires after
      // the stub is gone and calls jsdom's non-existent real
      // `URL.revokeObjectURL`, corrupting whichever test runs next.
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url'), { timeout: 2000 })

      vi.unstubAllGlobals()
    })

    it('pads the exported image without touching the on-screen card -- capture target is a padded offscreen wrapper around a CLONE, and the real card never leaves the page', async () => {
      navigator.canShare = vi.fn(() => true)
      navigator.share = vi.fn(async () => {})

      const user = await openSummaryView()
      // Unique to the summary card's own header (not duplicated in Nav,
      // unlike the event name).
      const visibleLocationLine = screen.getByText(/· Camping De Lach/)

      await user.click(screen.getByRole('button', { name: '📤 Deel als afbeelding' }))

      await waitFor(() => expect(mockDomToBlob).toHaveBeenCalledTimes(1))
      const capturedNode = mockDomToBlob.mock.calls[0][0]

      // The capture target carries its own padding/background -- not the
      // real card, a wrapper around a clone of it.
      expect(capturedNode.style.padding).toBe('32px')
      expect(capturedNode.contains(visibleLocationLine)).toBe(false)

      // The real, on-screen card was never detached from the page during
      // capture (a live React-owned node must never be pulled out from
      // under the reconciler, even briefly) -- it's still there afterwards,
      // with its own spacing completely untouched.
      expect(document.body.contains(visibleLocationLine)).toBe(true)
      expect(visibleLocationLine.closest('div').style.padding).toBe('')
    })

    it("the exported image's width tracks the real, on-screen card's width -- not a fixed/shrunk value (regression: an unconstrained offscreen wrapper used to shrink-wrap to ~340px regardless of the real ~795px card)", async () => {
      navigator.canShare = vi.fn(() => true)
      navigator.share = vi.fn(async () => {})

      const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
      let stubbedWidth = 795
      Element.prototype.getBoundingClientRect = function stubGetBoundingClientRect() {
        return { width: stubbedWidth, height: 400, top: 0, left: 0, right: stubbedWidth, bottom: 400, x: 0, y: 0, toJSON() {} }
      }

      try {
        const user = await openSummaryView()
        await user.click(screen.getByRole('button', { name: '📤 Deel als afbeelding' }))
        await waitFor(() => expect(mockDomToBlob).toHaveBeenCalledTimes(1))
        const firstCapture = mockDomToBlob.mock.calls[0][0]
        expect(firstCapture.firstElementChild.style.width).toBe('795px')

        // A second width, to prove this is genuinely DERIVED from the real
        // node's measured size on each capture, not a constant that just
        // happened to match once.
        stubbedWidth = 500
        mockDomToBlob.mockClear()
        await user.click(screen.getByRole('button', { name: '📤 Deel als afbeelding' }))
        await waitFor(() => expect(mockDomToBlob).toHaveBeenCalledTimes(1))
        const secondCapture = mockDomToBlob.mock.calls[0][0]
        expect(secondCapture.firstElementChild.style.width).toBe('500px')
      } finally {
        Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
      }
    })

    it('the user cancelling the native share sheet (AbortError) is a normal outcome, not a reported failure', async () => {
      navigator.canShare = vi.fn(() => true)
      navigator.share = vi.fn(async () => {
        throw new DOMException('cancelled by user', 'AbortError')
      })

      const user = await openSummaryView()
      const btn = screen.getByRole('button', { name: '📤 Deel als afbeelding' })
      await user.click(btn)

      await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1))
      // Never shows an error for a cancel, and the button becomes usable
      // again rather than staying stuck on "working".
      await waitFor(() => expect(screen.getByRole('button', { name: '📤 Deel als afbeelding' })).not.toBeDisabled())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('a real failure (image generation itself throwing) is surfaced visibly, not swallowed', async () => {
      navigator.canShare = vi.fn(() => true)
      navigator.share = vi.fn(async () => {})
      mockDomToBlob.mockReset().mockRejectedValue(new Error('rasterisation boom'))

      const user = await openSummaryView()
      const btn = screen.getByRole('button', { name: '📤 Deel als afbeelding' })
      await user.click(btn)

      expect(await screen.findByRole('alert')).toHaveTextContent('Kon de afbeelding niet maken')
      expect(navigator.share).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByRole('button', { name: '📤 Deel als afbeelding' })).not.toBeDisabled())
    })

    it('a capture that NEVER settles (the exact upstream failure that forced the html-to-image → modern-screenshot switch) is recovered by a hard timeout -- real error, actionable copy, button re-enabled, no permanent spinner', async () => {
      navigator.canShare = vi.fn(() => true)
      navigator.share = vi.fn(async () => {})
      // A promise that neither resolves nor rejects, ever -- reproduces the
      // reported real-browser symptom exactly (no blob, no error, button
      // stuck on "Bezig met afbeelding…" indefinitely) so this test would
      // fail against the pre-timeout implementation.
      mockDomToBlob.mockReset().mockReturnValue(new Promise(() => {}))

      await openSummaryView()
      const btn = screen.getByRole('button', { name: '📤 Deel als afbeelding' })

      vi.useFakeTimers()
      try {
        // Plain `fireEvent.click`, not `userEvent.click` -- user-event's
        // realistic pointer-event sequencing depends on internal
        // timer/rAF plumbing that does not play well with a faked clock
        // even with `advanceTimers` configured. `fireEvent` dispatches the
        // click synchronously (still wrapped in `act` by RTL), which is
        // all a plain enabled `<button onClick>` needs here.
        await act(async () => {
          fireEvent.click(btn)
        })
        expect(screen.getByRole('button', { name: '⏳ Bezig met afbeelding…' })).toBeDisabled()

        // Advance past the hard timeout. Wrapped in `act` so React commits
        // the resulting state update before we assert on the DOM.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(13000)
        })

        expect(screen.getByRole('alert')).toHaveTextContent('Kon de afbeelding niet maken')
        expect(screen.getByRole('alert')).toHaveTextContent('screenshot')
        expect(screen.getByRole('button', { name: '📤 Deel als afbeelding' })).not.toBeDisabled()
        expect(navigator.share).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    }, 15000)

    it("the secret stop's activity/location/note never reach the node handed to the capture library", async () => {
      navigator.canShare = vi.fn(() => true)
      navigator.share = vi.fn(async () => {})

      const user = await openSummaryView()
      await user.click(screen.getByRole('button', { name: '📤 Deel als afbeelding' }))

      await waitFor(() => expect(mockDomToBlob).toHaveBeenCalledTimes(1))
      const capturedNode = mockDomToBlob.mock.calls[0][0]
      expect(capturedNode.textContent).toContain('Aankomst lunch')
      expect(capturedNode.textContent).not.toContain('Geheime verrassing')
      expect(capturedNode.textContent).not.toContain('Onbekende bunker')
      expect(capturedNode.textContent).not.toContain('niet lekken')
    })
  })

  describe('as an org/admin editor', () => {
    beforeEach(() => {
      localStorage.setItem('md-session', 'u-1')
    })

    it("an editor's captured node DOES include the secret stop -- same as the existing Stops view already shows them", async () => {
      navigator.canShare = vi.fn(() => true)
      navigator.share = vi.fn(async () => {})

      const user = await openSummaryView()
      await user.click(screen.getByRole('button', { name: '📤 Deel als afbeelding' }))

      await waitFor(() => expect(mockDomToBlob).toHaveBeenCalledTimes(1))
      const capturedNode = mockDomToBlob.mock.calls[0][0]
      expect(capturedNode.textContent).toContain('Geheime verrassing')
    })
  })
})
