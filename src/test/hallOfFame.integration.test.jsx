// HallOfFame (App.jsx, un-exported per §5.4 -- it's a React component with
// JSX, so extractFromAppSource.js's `new Function` technique genuinely
// cannot reach it, unlike the pure helpers in helpers.pure.test.js).
// Verified before assuming otherwise, per the task brief.
//
// So this exercises HallOfFame the only way available without editing
// App.jsx: a full `<App/>` render, resumed straight into a logged-in
// session via `md-session` (same trick `App.smoke.test.jsx` documents),
// navigated to the Hall of Fame page via the real Nav button.
//
// Two things under test:
//  1. Tournament champions written by `finishTournament` (WP-J) land in
//     "Most Awards Won" with NO changes to HallOfFame's existing winners
//     aggregation -- because they're shaped exactly like a hand-added
//     `events.winners` entry. This is the "verify it actually happens
//     rather than assuming" the task asked for.
//  2. The new blocks (#16): the team trophy cabinet, and the three "other
//     ideas" categories (Lens Legend, On a Roll, the kretjes tally).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../supabase.js', async () => {
  const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      users: {
        data: [
          { id: 'u-1', username: 'Doom', display_name: 'Doom', role: 'admin', pin_hash: 'x', joined_at: '2023-01-01', avatar: 0 },
          { id: 'u-2', username: 'Bram', display_name: 'Bram', role: 'lad', pin_hash: 'x', joined_at: '2023-01-01', avatar: 1 },
        ],
        error: null,
      },
      events: {
        data: [
          {
            id: 'evt-1', name: 'Mensdag 2025', type: 'day', date: '2025-06-01', end_date: '', start_time: '12:00', end_time: '',
            location: 'TBD', description: '', theme: '', trailer_video_url: '', teaser_active: false, teaser_title: '', teaser_text: '', teaser_button_label: '',
            archived: true, kretjes: 5,
            attendees: [{ name: 'Doom', status: 'went' }, { name: 'Bram', status: 'went' }],
            schedule: [], polls: [], quizzes: [], highlights: [], faqs: [],
            photos: [
              { id: 'ph1', uploader: 'Doom', src: '', caption: '', reactions: {}, uploadedAt: '2025-06-01T00:00:00Z' },
              { id: 'ph2', uploader: 'Doom', src: '', caption: '', reactions: {}, uploadedAt: '2025-06-01T00:00:00Z' },
              { id: 'ph3', uploader: 'Bram', src: '', caption: '', reactions: {}, uploadedAt: '2025-06-01T00:00:00Z' },
            ],
            // A manual award (existing path) alongside a tournament-authored
            // one written the way finishTournament (WP-J) writes it -- same
            // shape, no HallOfFame/WinnersTab changes needed to render it.
            winners: [
              { id: 'w1', category: '🏎️ Go-Kart Winner', winner: 'Doom', detail: 'Fastest lap', icon: '🏁' },
              { id: 'mg-trn_1-ent_1', category: '🏆 Mens-Games 2025 — 1e plaats', winner: 'De Kraaien', detail: '10 punten · Doom, Bram', icon: '🥇' },
            ],
          },
          {
            id: 'evt-2', name: 'Mensdag 2026', type: 'day', date: '2026-06-01', end_date: '', start_time: '12:00', end_time: '',
            location: 'TBD', description: '', theme: '', trailer_video_url: '', teaser_active: false, teaser_title: '', teaser_text: '', teaser_button_label: '',
            archived: true, kretjes: 3,
            attendees: [{ name: 'Doom', status: 'went' }, { name: 'Bram', status: 'absent' }],
            schedule: [], polls: [], quizzes: [], photos: [], winners: [], highlights: [], faqs: [],
          },
        ],
        error: null,
      },
      announcements: { data: [], error: null },
      team_sets: {
        data: [
          {
            id: 'ts_1', name: 'Kroeg Teams', category: 'Mens-Games', event_ids: [], status: 'active',
            teams: [{ id: 'tm_1', name: 'De Kraaien', avatar: '🦅', members: ['Doom', 'Bram'], captain: null }],
            awards: [{ id: 'aw_1', teamId: 'tm_1', label: '🥇 Mens-Games 2025 — 1e plaats', placement: 1, tournamentId: 'trn_1', eventId: 'evt-1', note: '', awardedAt: '2025-06-01T20:00:00Z' }],
            created_by: '', created_at: '2025-06-01T00:00:00Z', archived_at: null,
          },
        ],
        error: null,
      },
    }),
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../App.jsx')

async function openHallOfFame() {
  render(<App />)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /hall of fame/i })).toBeInTheDocument()
  })
  const user = userEvent.setup()
  await user.click(screen.getAllByRole('button', { name: /hall of fame/i })[0])
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Hall of Fame' })).toBeInTheDocument()
  })
}

describe('Hall of Fame (#16)', () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('a tournament champion written to events.winners by finishTournament shows up in "Most Awards Won" unaided', async () => {
    await openHallOfFame()
    const section = screen.getByRole('heading', { name: /most awards won/i }).closest('div')
    expect(within(section).getByText('De Kraaien')).toBeInTheDocument()
  })

  it('renders the team trophy cabinet for a team set carrying a TeamAward', async () => {
    await openHallOfFame()
    expect(screen.getByRole('heading', { name: /team trophy cabinet/i })).toBeInTheDocument()
    expect(screen.getByText('Kroeg Teams')).toBeInTheDocument()
    expect(screen.getByText('🥇 Mens-Games 2025 — 1e plaats')).toBeInTheDocument()
  })

  it('renders Lens Legend ranking photo uploaders', async () => {
    await openHallOfFame()
    const section = screen.getByRole('heading', { name: /lens legend/i }).closest('div')
    expect(within(section).getByText('2 photos uploaded')).toBeInTheDocument()
  })

  it('renders the all-time kretjes tally as a single group stat, not a per-person leaderboard', async () => {
    await openHallOfFame()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText(/kretjes and counting/i)).toBeInTheDocument()
  })

  it('renders "On a Roll" for an attendee with a current streak of 2+', async () => {
    await openHallOfFame()
    const section = screen.getByRole('heading', { name: /on a roll/i }).closest('div')
    expect(within(section).getByText('🔥 2')).toBeInTheDocument()
    // Bram missed the most recent event -- streak broken, excluded.
    expect(within(section).queryByText('Bram')).not.toBeInTheDocument()
  })
})
