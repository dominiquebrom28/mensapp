// End-to-end coverage for the primary button's actual wiring: clicking it
// navigates to the event's page and auto-opens the SAME trailer overlay the
// page's own "🎬 Watch the trailer" button uses (EventPage's
// `autoOpenTrailerId` effect), rather than a separate/duplicated code path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installMediaEnv } from '../mocks/mediaEnv.js'

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
            date: '2099-09-12',
            end_date: '',
            start_time: '18:00',
            end_time: '',
            location: 'Amsterdam',
            description: '',
            theme: '',
            trailer_video_url: 'https://example.com/trailer.mp4',
            teaser_active: true,
            teaser_title: 'The trailer just dropped',
            teaser_button_label: 'Watch it now',
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

let media

beforeEach(() => {
  localStorage.setItem('md-session', 'u-1')
  media = installMediaEnv()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  media.restore()
  vi.restoreAllMocks()
})

describe('login teaser: primary button navigates to the event page and auto-opens the trailer', () => {
  it('clicking the (admin-labelled) primary button lands on the event page with the trailer overlay already open', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('The trailer just dropped')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Watch it now' }))

    // The trailer overlay (EventTrailer, lazy-loaded) auto-opens once
    // EventPage mounts with `autoOpenTrailerId` matching -- its countdown
    // phase is the first thing rendered.
    await waitFor(() => {
      expect(screen.getByText('Tap to skip')).toBeInTheDocument()
    })

    // Underneath, we really did navigate to the event page (not some
    // App-root-level trailer overlay decoupled from it) -- closing the
    // trailer should reveal the event page with its own "Watch the trailer"
    // button still present.
    fireEvent.click(screen.getByRole('button', { name: /close trailer/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /watch the trailer/i })).toBeInTheDocument()
    })
  })
})
