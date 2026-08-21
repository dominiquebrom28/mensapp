// End-to-end (App-root) coverage for the no-video edge case's chosen
// behaviour: `teaser_active` on an event with no (or an invalid)
// `trailer_video_url` is excluded from the candidate pool at selection --
// it does NOT suppress the whole feature, and does NOT point its button at
// the event page as a fallback destination. If a different qualifying event
// DOES have a valid video, the teaser still shows for that one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

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
            // Soonest date, teaser_active, but NO trailer video -- must be
            // excluded, not just leave the whole feature silent.
            id: 'evt-no-video',
            name: 'Winterborrel',
            type: 'day',
            date: '2026-01-05',
            end_date: '',
            start_time: '18:00',
            end_time: '',
            location: 'Utrecht',
            description: '',
            theme: '',
            trailer_video_url: '',
            teaser_active: true,
            teaser_title: 'Winterborrel teaser (must not show)',
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
          {
            // Later date, but DOES have a valid video -- this is the one
            // that must be teased.
            id: 'evt-has-video',
            name: 'Mensdag XL',
            type: 'day',
            date: '2026-09-12',
            end_date: '',
            start_time: '18:00',
            end_time: '',
            location: 'Amsterdam',
            description: '',
            theme: '',
            trailer_video_url: 'https://example.com/trailer.mp4',
            teaser_active: true,
            teaser_title: 'Mensdag XL teaser (must show)',
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

describe('login teaser: no-video edge case falls through to the next qualifying event', () => {
  it('skips the soonest teaser_active event because it has no trailer video, and teases the later one that does', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Mensdag XL teaser (must show)')).toBeInTheDocument()
    })
    expect(screen.queryByText('Winterborrel teaser (must not show)')).not.toBeInTheDocument()
  })
})
