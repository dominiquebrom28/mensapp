// Integration coverage for OverviewTab's schedule "Summary" view toggle
// (the owner's request: one summary-overview of the whole schedule + a
// meenemen list, as a view on the existing block rather than a new tab).
// `OverviewTab` is a React component with JSX and no module export, so --
// same reasoning as hallOfFame.integration.test.jsx -- this drives it via a
// full `<App/>` render resumed straight into a logged-in session (the same
// `md-session` trick), navigated to a real event via the real EventCard,
// rather than a source-extraction technique. Both test users (an org/admin
// editor and a regular member) see the exact same event data below -- only
// `md-session` differs per test, same as hallOfFame.integration.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
            // Two-day schedule: one public stop per day, plus one SECRET
            // stop on day 0 -- the exact case the Summary view must never
            // leak to a non-editor.
            schedule: [
              { day: 0, time: '12:00', activity: 'Aankomst lunch', location: 'Café De Kroeg', secret: false },
              { day: 0, time: '20:00', activity: 'Geheime verrassing', location: 'Onbekende bunker', note: 'niet lekken', secret: true },
              { day: 1, time: '09:00', activity: 'Ontbijt', location: 'De Grote Tent', secret: false },
            ],
            // Event-level meenemen list -- never per-stop.
            bring: ['Regenjas', 'Zonnebrand'],
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

async function openEventOverview() {
  render(<App />)
  await waitFor(() => {
    expect(screen.getByText('Zomerweekend 2026')).toBeInTheDocument()
  })
  const user = userEvent.setup()
  await user.click(screen.getByText('Zomerweekend 2026'))
  await waitFor(() => {
    expect(screen.getByText("👀 What's on the Menu")).toBeInTheDocument()
  })
  return user
}

describe('OverviewTab schedule Summary view (view toggle on the existing schedule block)', () => {
  afterEach(() => {
    localStorage.clear()
  })

  describe('as an org/admin editor (sees everything, exactly like the Stops view already does)', () => {
    beforeEach(() => {
      localStorage.setItem('md-session', 'u-1')
    })

    it('defaults to the Stops view (unchanged behaviour) with the Summary toggle available', async () => {
      await openEventOverview()
      expect(screen.getByRole('button', { name: 'Stops' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Stops' })).toHaveAttribute('aria-pressed', 'true')
      // Summary-only content (the meenemen section) isn't mounted yet.
      expect(screen.queryByText('🎒 MEENEMEN')).not.toBeInTheDocument()
    })

    it('switching to Summary shows one compact line per stop, grouped by day, plus the meenemen list -- editor sees the secret stop too', async () => {
      const user = await openEventOverview()
      await user.click(screen.getByRole('button', { name: 'Summary' }))

      await waitFor(() => {
        expect(screen.getByText('🎒 MEENEMEN')).toBeInTheDocument()
      })

      // Day grouping via the real dayHeadingLabel.
      expect(screen.getByText(/Dag 1/)).toBeInTheDocument()
      expect(screen.getByText(/Dag 2/)).toBeInTheDocument()

      // Every stop, INCLUDING the secret one -- an editor sees everything.
      expect(screen.getByText('Aankomst lunch')).toBeInTheDocument()
      expect(screen.getByText('Geheime verrassing')).toBeInTheDocument()
      expect(screen.getByText('Ontbijt')).toBeInTheDocument()

      // The meenemen list, event-level, not attached to any stop.
      expect(screen.getByText(/Regenjas/)).toBeInTheDocument()
      expect(screen.getByText(/Zonnebrand/)).toBeInTheDocument()
    })
  })

  describe('as a regular member (non-editor) -- the secret stop must never leak', () => {
    beforeEach(() => {
      localStorage.setItem('md-session', 'u-2')
    })

    it("Summary view never renders the secret stop's activity, location, or note -- only an honest hidden-count line", async () => {
      const user = await openEventOverview()
      await user.click(screen.getByRole('button', { name: 'Summary' }))

      await waitFor(() => {
        expect(screen.getByText('🎒 MEENEMEN')).toBeInTheDocument()
      })

      // Public stops still show.
      expect(screen.getByText('Aankomst lunch')).toBeInTheDocument()
      expect(screen.getByText('Ontbijt')).toBeInTheDocument()

      // The secret stop's content is nowhere in the document -- not the
      // activity, not the location, not the note.
      expect(screen.queryByText('Geheime verrassing')).not.toBeInTheDocument()
      expect(screen.queryByText('Onbekende bunker')).not.toBeInTheDocument()
      expect(screen.queryByText(/niet lekken/)).not.toBeInTheDocument()

      // An honest count of what's hidden, instead.
      expect(screen.getByText(/1 stop.*nog geheim/)).toBeInTheDocument()

      // The meenemen list is NOT secret -- a regular member sees it too.
      expect(screen.getByText(/Regenjas/)).toBeInTheDocument()
      expect(screen.getByText(/Zonnebrand/)).toBeInTheDocument()
    })

    it('the existing Stops view keeps filtering the secret stop the same way it always has (regression guard, not a new behaviour)', async () => {
      await openEventOverview()
      // Default view is Stops -- secret stop already excluded today.
      expect(screen.queryByText('Geheime verrassing')).not.toBeInTheDocument()
      expect(screen.getByText('Aankomst lunch')).toBeInTheDocument()
    })
  })
})
