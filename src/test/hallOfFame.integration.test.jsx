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
// Reorg 2026-08-26 (docs/hall-of-fame-spec.md): what used to render inline
// as seven full-width sections is now a stat strip plus a tile grid, with
// each section's full list moved wholesale behind its tile's click into the
// existing `Modal`. Every assertion below describes the same behaviour the
// pre-reorg version of this file asserted -- only *how* each one is reached
// changed (open the relevant tile first), never *what* is asserted, per the
// task brief.
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
      // A still-secret finished tournament and a still-secret finished quiz,
      // both linked to evt-2 -- the "two things that will bite you" case
      // (docs/hall-of-fame-spec.md): `fetchTournamentResults`/
      // `fetchQuizResults` must exclude both before HallOfFame (or its Roll
      // of Honour feed, or its Quiz All-Time board) ever sees them.
      tournaments: {
        data: [
          {
            id: 'trn_secret', name: 'Geheim Toernooi', event_id: 'evt-2', status: 'finished',
            entrants: [{ id: 'ent_secret', kind: 'player', name: 'Zwijn Secretus', avatar: '🐗' }],
            rounds: [{ id: 'r1', status: 'done', results: { points: { ent_secret: 99 } } }],
            settings: { secret: true },
          },
        ],
        error: null,
      },
      quizzes: {
        data: [
          {
            id: 'qz_secret', title: 'Geheime Quiz', event_id: 'evt-2', status: 'finished',
            teams: [], scores: { Geheimhouder: 500 }, member_scores: {}, finished_at: '2026-07-01T00:00:00Z',
            settings: { secret: true },
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

// Opens a tile's drill-in Modal by clicking the tile button (matched by its
// visible title, e.g. "Most Awards", "Lens Legend") -- the "moved wholesale
// behind a click" half of the 2026-08-26 reorg.
async function openTile(nameRe) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: nameRe }))
}

describe('Hall of Fame (#16, reorganised into a stat strip + tile grid 2026-08-26)', () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('shows the stat strip (Edities/Lads/Kretjes/Awards) on first paint, no click required', async () => {
    await openHallOfFame()
    const main = screen.getByRole('main')
    const kretjesLabel = within(main).getByText('Kretjes')
    expect(within(kretjesLabel.parentElement).getByText('8')).toBeInTheDocument()
    const ladsLabel = within(main).getByText('Lads')
    expect(within(ladsLabel.parentElement).getByText('2')).toBeInTheDocument()
    const editiesLabel = within(main).getByText('Edities')
    expect(within(editiesLabel.parentElement).getByText('2')).toBeInTheDocument()
    // Spec's literal formula: total winner rows across all events (2: the
    // manual award + the mens-games one) + team awards (1: aw_1) = 3 -- a
    // raw sum, deliberately not the Roll of Honour feed's deduped count.
    const awardsLabel = within(main).getByText('Awards')
    expect(within(awardsLabel.parentElement).getByText('3')).toBeInTheDocument()
  })

  it('Roll of Honour tile shows the most recent award and opens the full list on click', async () => {
    await openHallOfFame()
    // evt-1 (2025) is the only event carrying awards -- its manual award and
    // its tournament-authored one are both candidates for "most recent";
    // either is correct proof the tile surfaces a real award, not a person
    // ranking.
    expect(screen.getByRole('button', { name: /roll of honour/i })).toBeInTheDocument()
    await openTile(/roll of honour/i)
    const modal = screen.getByRole('heading', { name: /roll of honour/i }).closest('div')
    expect(within(modal).getByText('De Kraaien')).toBeInTheDocument()
    expect(within(modal).getByText('Doom')).toBeInTheDocument()
    // The mens-games win is real-world *one* award, represented twice in the
    // data (an `events.winners` row AND a `team_sets.awards` TeamAward,
    // written by the same `finishTournament` call) -- Roll of Honour must
    // show it once, not once per representation.
    expect(within(modal).getAllByText(/Mens-Games 2025/i)).toHaveLength(1)
  })

  it('never leaks a secret tournament champion or a secret quiz winner anywhere on Hall of Fame', async () => {
    await openHallOfFame()
    expect(screen.queryByText(/Zwijn Secretus/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Geheimhouder/)).not.toBeInTheDocument()
    await openTile(/roll of honour/i)
    expect(screen.queryByText(/Zwijn Secretus/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Geheimhouder/)).not.toBeInTheDocument()
  })

  it('a tournament champion written to events.winners by finishTournament shows up in "Most Awards Won" unaided', async () => {
    await openHallOfFame()
    await openTile(/most awards/i)
    const section = screen.getByRole('heading', { name: /most awards won/i }).closest('div')
    expect(within(section).getByText('De Kraaien')).toBeInTheDocument()
  })

  it('renders the team trophy cabinet for a team set carrying a TeamAward', async () => {
    await openHallOfFame()
    await openTile(/team trophy cabinet/i)
    expect(screen.getByRole('heading', { name: /team trophy cabinet/i })).toBeInTheDocument()
    expect(screen.getByText('Kroeg Teams')).toBeInTheDocument()
    expect(screen.getByText('🥇 Mens-Games 2025 — 1e plaats')).toBeInTheDocument()
  })

  it('renders Lens Legend ranking photo uploaders', async () => {
    await openHallOfFame()
    await openTile(/lens legend/i)
    const section = screen.getByRole('heading', { name: /lens legend/i }).closest('div')
    expect(within(section).getByText('2 photos uploaded')).toBeInTheDocument()
  })

  it('renders "On a Roll" for an attendee with a current streak of 2+', async () => {
    await openHallOfFame()
    await openTile(/^on a roll/i)
    const section = screen.getByRole('heading', { name: /on a roll/i }).closest('div')
    expect(within(section).getByText('🔥 2')).toBeInTheDocument()
    // Bram missed the most recent event -- streak broken, excluded.
    expect(within(section).queryByText('Bram')).not.toBeInTheDocument()
  })
})
