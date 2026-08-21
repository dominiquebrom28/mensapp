// A pending (not-yet-approved) user must never see the login teaser -- the
// App-root evaluation effect is gated on `ACTIVE_ROLES`, and `role==="pending"`
// renders `PendingScreen` before the teaser's mount point is ever reached.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../supabase.js', async () => {
  const { makeSupabaseMock } = await import('../mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      users: {
        data: [
          {
            id: 'u-pending',
            username: 'Newbie',
            role: 'pending',
            display_name: 'Newbie',
            pin_hash: 'irrelevant-for-session-shortcut-login',
            joined_at: '2026-01-01',
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
            date: '2026-09-12',
            end_date: '',
            start_time: '18:00',
            end_time: '',
            location: 'Amsterdam',
            description: '',
            theme: '',
            trailer_video_url: 'https://example.com/trailer.mp4',
            teaser_active: true,
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
  localStorage.setItem('md-session', 'u-pending')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('login teaser: pending users', () => {
  it('never shows the teaser to a pending user -- PendingScreen renders instead', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/pending/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /watch the trailer/i })).not.toBeInTheDocument()
  })
})
