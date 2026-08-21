// Integration coverage for the coordinator-requested guarantee: the trailer
// adapter (`toTrailerInput`, an un-exported module-scope const inside
// App.jsx) must not run on every EventPage render -- only once the trailer
// is actually opened.
//
// Updated 2026-08-21 for the owner's direction change (a real video + a
// single end card replaces the generated beat sequence): `toTrailerInput`
// shrank to {eventId, name, videoUrl, kretjes, goingCount, going}, and its
// one remaining non-trivial step is validating each "going" attendee's
// `photoUrl` via `isSafeImageUrl` before handing it to the roster. That's
// this test's proxy now, in place of the old schedule-stop-image check
// (`toTrailerInput` no longer reads `evt.schedule` at all -- there's no
// montage any more). A repo-wide grep confirms `isSafeImageUrl` has exactly
// one call site in App.jsx, inside `toTrailerInput`, so "isSafeImageUrl was
// never called" is equivalent to "toTrailerInput never ran" for the
// purposes of this test, without needing to reach into App.jsx's private
// scope.
//
// Note: `canTrailer` (the "Watch the trailer" button's own visibility gate)
// now reads `isSafeVideoUrl(evt.trailer_video_url)` directly on every
// EventPage render -- unlike the old `findChampion`-driven adapter, that
// gate is cheap (one URL parse + a regex), so there's no equivalent
// "wasted work" concern for it the way there was for the old champion scan.
// This test is scoped to the one adapter step that still only makes sense
// to run once the trailer is open.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const isSafeImageUrlSpy = vi.fn()
vi.mock('../../features/trailer/safeUrl.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isSafeImageUrl: (...args) => {
      isSafeImageUrlSpy(...args)
      return actual.isSafeImageUrl(...args)
    },
  }
})

vi.mock('../../supabase.js', async () => {
  const { makeSupabaseMock } = await import('../mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      users: {
        data: [
          {
            id: 'u-1',
            username: 'Doom',
            role: 'admin',
            display_name: 'Doom',
            pin_hash: 'irrelevant-for-session-shortcut-login',
            joined_at: '2023-01-01',
            avatar: 0,
            photo_url: 'https://example.com/doom.jpg',
          },
        ],
        error: null,
      },
      events: {
        data: [
          {
            id: 'evt-1',
            name: 'Mensdag XL',
            type: 'day',
            date: '2099-09-12', // far future -> "upcoming", clickable on Home
            end_date: '',
            start_time: '18:00',
            end_time: '',
            location: 'Amsterdam',
            description: '',
            theme: '',
            // Non-empty + a safe video extension is what makes `canTrailer`
            // true (isSafeVideoUrl, gated separately from this test's proxy).
            trailer_video_url: 'https://example.com/trailer.mp4',
            // A "going" attendee whose photo_url is what would call
            // `isSafeImageUrl` the instant `toTrailerInput` runs (via the
            // roster-mapping step).
            attendees: [{ name: 'Doom', status: 'going' }],
            schedule: [],
            polls: [],
            photos: [],
            quizzes: [],
            winners: [],
            highlights: [],
            faqs: [],
            archived: false,
            kretjes: 0,
          },
        ],
        error: null,
      },
      announcements: { data: [], error: null },
    }),
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../../App.jsx')

afterEach(() => {
  cleanup()
  isSafeImageUrlSpy.mockClear()
  localStorage.removeItem('md-session')
  vi.restoreAllMocks()
})

describe('trailer adapter gating (toTrailerInput only validates roster photos when the trailer is open)', () => {
  it('does not call isSafeImageUrl (i.e. does not run toTrailerInput) while the event page is open but the trailer is closed, and does once the trailer is opened', async () => {
    localStorage.setItem('md-session', 'u-1')
    render(<App />)

    // Auto-logged-in via the session shortcut -- straight past the login
    // screen to Home once the mount-time fetch resolves.
    await waitFor(() => {
      expect(screen.getByText('MENSAPP')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Mensdag XL'))

    // EventPage is open (the "Watch the trailer" button only renders when
    // `canTrailer` is true, i.e. `trailer_video_url` is set and valid) --
    // and `trailerOpen` is still false at this point.
    const trailerBtn = await screen.findByRole('button', { name: /watch the trailer/i })

    expect(isSafeImageUrlSpy).not.toHaveBeenCalled()

    fireEvent.click(trailerBtn)

    // Opening it flips `trailerOpen`, which is the only thing gating
    // `toTrailerInput`'s useMemo -- now it must have run at least once,
    // and `isSafeImageUrl` (called on the one "going" attendee's photo_url)
    // is the observable proof.
    await waitFor(() => {
      expect(isSafeImageUrlSpy).toHaveBeenCalled()
    })
    expect(isSafeImageUrlSpy).toHaveBeenCalledWith('https://example.com/doom.jpg')
  })
})
