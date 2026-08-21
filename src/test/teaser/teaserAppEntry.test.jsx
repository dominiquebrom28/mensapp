// Full-App integration coverage for the login teaser, same technique
// trailerAdapterGating.integration.test.jsx uses (a mocked supabase client +
// the session-shortcut login via `localStorage['md-session']`, since the
// teaser must show on session-RESUME entry, not just a fresh credential
// login -- gating on the literal login flow would mean almost nobody ever
// sees it, per the spec).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { markTrailerSeen } from '../../features/trailer/seen.js'

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
            id: 'evt-teaser',
            name: 'Mensdag XL',
            type: 'day',
            // Deliberately PAST-dated -- the selection rule must not care.
            date: '2020-01-01',
            end_date: '',
            start_time: '18:00',
            end_time: '',
            location: 'Amsterdam',
            description: '',
            theme: '',
            trailer_video_url: 'https://example.com/trailer.mp4',
            teaser_active: true,
            // teaser_title/teaser_text/teaser_button_label deliberately left
            // unset -- exercises TeaserModal's fallback copy.
            attendees: [],
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

beforeEach(() => {
  localStorage.setItem('md-session', 'u-1')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('login teaser: app-entry visibility, fallback copy, backdrop, skip', () => {
  it('shows on session-resume entry (not a fresh credential login) with sensible fallback copy for a past-dated but teaser_active event', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('🎬 A new trailer just dropped')).toBeInTheDocument()
    })
    expect(screen.getByText(/get hyped/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🎬 Watch the trailer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
  })

  it('a stray backdrop click does nothing -- the modal stays open, not silently dismissed forever', async () => {
    const { container } = render(<App />)

    await waitFor(() => {
      expect(screen.getByText('🎬 A new trailer just dropped')).toBeInTheDocument()
    })

    fireEvent.click(container.querySelector('.ov'))

    // Still visible -- a stray click must never count as a permanent skip.
    expect(screen.getByText('🎬 A new trailer just dropped')).toBeInTheDocument()
  })

  it('Skip dismisses it, and the dismissal persists across the next app entry (remount)', async () => {
    const { unmount } = render(<App />)

    await waitFor(() => {
      expect(screen.getByText('🎬 A new trailer just dropped')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.queryByText('🎬 A new trailer just dropped')).not.toBeInTheDocument()

    unmount()

    // Next "app entry" (a fresh App mount, session still present) -- the
    // teaser must not come back for this event on this device.
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('MENSAPP')).toBeInTheDocument()
    })
    expect(screen.queryByText('🎬 A new trailer just dropped')).not.toBeInTheDocument()
  })

  it('does not show at all if the trailer was already watched to the end on a previous entry (md-trailer-seen)', async () => {
    markTrailerSeen('evt-teaser')

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MENSAPP')).toBeInTheDocument()
    })
    expect(screen.queryByText('🎬 A new trailer just dropped')).not.toBeInTheDocument()
  })
})
