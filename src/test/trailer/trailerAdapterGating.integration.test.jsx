// Integration coverage for the coordinator-requested guarantee: the trailer
// adapter (`toTrailerInput`, and therefore `findChampion` inside it) must
// not run on every EventPage render -- only once the trailer is actually
// opened. `toTrailerInput`/`findChampion` are un-exported module-scope
// consts inside App.jsx, so they can't be `vi.mock`-ed directly. Instead
// this spies on `isSafeImageUrl` (a real ES-module import in App.jsx) as an
// unambiguous proxy: a repo-wide grep confirms it has exactly three call
// sites, and every one of them is inside `toTrailerInput`/`findChampion`
// (App.jsx:364, 389, 412) -- nowhere else in the ~6,300-line file reads it.
// So "isSafeImageUrl was never called" is equivalent to "toTrailerInput
// never ran" for the purposes of this test, without needing to reach into
// App.jsx's private scope.
//
// This renders the *real* `<App/>` (same pattern as App.smoke.test.jsx),
// auto-logged-in via the `md-session` localStorage shortcut App.jsx itself
// supports, so the event page is reached without simulating the full
// username/PIN login form.
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
            attendees: [],
            // Non-empty schedule with an image is what makes `canTrailer`
            // true AND what would call `isSafeImageUrl` the instant
            // `toTrailerInput` runs (via the stops.map redaction step).
            schedule: [
              { day: 0, time: '18:00', icon: '🍺', activity: 'Borrel', location: 'Kroeg', note: '', image: 'https://example.com/borrel.jpg' },
            ],
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

describe('trailer adapter gating (toTrailerInput/findChampion only run when the trailer is open)', () => {
  it('does not call isSafeImageUrl (i.e. does not run toTrailerInput/findChampion) while the event page is open but the trailer is closed, and does once the trailer is opened', async () => {
    localStorage.setItem('md-session', 'u-1')
    render(<App />)

    // Auto-logged-in via the session shortcut -- straight past the login
    // screen to Home once the mount-time fetch resolves.
    await waitFor(() => {
      expect(screen.getByText('MENSDAY')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Mensdag XL'))

    // EventPage is open (the "Watch the trailer" button only renders when
    // `canTrailer` is true, i.e. we're really on the event page with a
    // non-empty schedule) -- and `trailerOpen` is still false at this point.
    const trailerBtn = await screen.findByRole('button', { name: /watch the trailer/i })

    expect(isSafeImageUrlSpy).not.toHaveBeenCalled()

    fireEvent.click(trailerBtn)

    // Opening it flips `trailerOpen`, which is the only thing gating
    // `toTrailerInput`'s useMemo -- now it must have run at least once,
    // and `isSafeImageUrl` (called on the one schedule stop's image) is the
    // observable proof.
    await waitFor(() => {
      expect(isSafeImageUrlSpy).toHaveBeenCalled()
    })
    expect(isSafeImageUrlSpy).toHaveBeenCalledWith('https://example.com/borrel.jpg')
  })
})
