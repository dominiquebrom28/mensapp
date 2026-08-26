// End-to-end coverage for the owner's 2026-08-26 decision: the event page
// drops its Quiz/Teams/Mens-Games 🏆 tabs (each is a stand-alone Tool now,
// reached via Tools/Home with its own linked-event history), and Winners &
// Highlights connects itself to finished tournaments automatically --
// mirroring the existing quiz-AUTO-card pattern (§7.4,
// `src/test/quiz/quizStandalone.integration.test.jsx`'s own "suppresses the
// AUTO card for the already-published quiz" test is the direct template for
// this file). Full `<App/>`, mocked Supabase, navigation via the real
// buttons -- the pattern `hallOfFame.integration.test.jsx` and
// `src/test/quiz/liveDiscovery.integration.test.jsx` set: assert what
// renders, not that a function was called.
//
// The task brief is explicit that this invariant has already been broken
// twice on this project: "a secret tournament must never appear". The last
// two tests below exist specifically to catch that regression -- see their
// own comments for the mutation-testing note in the work's own report.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const ENTRANTS = [
  { id: 'ent_1', kind: 'player', name: 'Doom', avatar: '🙂', memberNames: [] },
]

// Linked to evt-1, finished, not secret, no real award row yet -- the AUTO
// card must show (the "legacy tournament, or the event write hasn't landed
// yet" case, exact mirror of the quiz's QUIZ_AUTO fixture).
const TOURNAMENT_AUTO = {
  id: 'trn-auto', name: 'Darts Cup', event_id: 'evt-1', status: 'finished',
  entrants: ENTRANTS, rounds: [{ id: 'r1', status: 'done', results: { points: { ent_1: 12 } } }],
  settings: {},
}
// Linked to evt-1, finished, not secret, and a real `mg-trn-published-ent_1`
// award row already sits on `events.winners` -- the AUTO card for this one
// must be suppressed (§7.4's whole point, mirrored for tournaments).
const TOURNAMENT_PUBLISHED = {
  id: 'trn-published', name: 'Pool Toernooi', event_id: 'evt-1', status: 'finished',
  entrants: ENTRANTS, rounds: [{ id: 'r1', status: 'done', results: { points: { ent_1: 30 } } }],
  settings: {},
}
// Linked to evt-1, finished, SECRET -- must never appear anywhere on the
// Winners tab, in any form, under any label.
const TOURNAMENT_SECRET = {
  id: 'trn-secret', name: 'Geheim Toernooi', event_id: 'evt-1', status: 'finished',
  entrants: ENTRANTS, rounds: [{ id: 'r1', status: 'done', results: { points: { ent_1: 99 } } }],
  settings: { secret: true },
}
// Finished, not secret, but linked to a DIFFERENT event -- must never show
// up on evt-1's Winners tab.
const TOURNAMENT_OTHER_EVENT = {
  id: 'trn-other', name: 'Ander Event Cup', event_id: 'evt-2', status: 'finished',
  entrants: ENTRANTS, rounds: [{ id: 'r1', status: 'done', results: { points: { ent_1: 5 } } }],
  settings: {},
}

function toRow(t) {
  return { id: t.id, name: t.name, event_id: t.event_id, status: t.status, entrants: t.entrants, rounds: t.rounds, settings: t.settings, team_set_id: null, created_by: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
}

vi.mock('../../supabase.js', async () => {
  const { makeSupabaseMock } = await import('../mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      users: {
        data: [
          { id: 'u-1', username: 'Doom', display_name: 'Doom', role: 'admin+org', pin_hash: 'x', joined_at: '2023-01-01', avatar: 0 },
        ],
        error: null,
      },
      events: {
        data: [
          {
            id: 'evt-1', name: 'Mensdag 2025', type: 'day', date: '2025-06-01', end_date: '', start_time: '12:00', end_time: '',
            location: 'TBD', description: '', theme: '', trailer_video_url: '', teaser_active: false, teaser_title: '', teaser_text: '', teaser_button_label: '',
            archived: true, kretjes: 0,
            attendees: [{ name: 'Doom', status: 'went' }],
            schedule: [], polls: [], quizzes: [], photos: [], highlights: [], faqs: [],
            winners: [{ id: 'mg-trn-published-ent_1', category: '🏆 Pool Toernooi — 1e plaats', winner: 'Doom', detail: '30 punten', icon: '🥇' }],
          },
        ],
        error: null,
      },
      tournaments: {
        data: [TOURNAMENT_AUTO, TOURNAMENT_PUBLISHED, TOURNAMENT_SECRET, TOURNAMENT_OTHER_EVENT].map(toRow),
        error: null,
      },
      quiz_live: { data: [], error: null },
      announcements: { data: [], error: null },
      team_sets: { data: [], error: null },
    }),
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../../App.jsx')

async function openEventPage(user) {
  await waitFor(() => expect(screen.getByText('Mensdag 2025')).toBeInTheDocument())
  await user.click(screen.getByText('Mensdag 2025'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument())
}

describe('the event page no longer hosts Quiz/Teams/Mens-Games 🏆 tabs', () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
    localStorage.setItem('md-mg-unlocked', 'true')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('shows only Overview/Polls/Photos/Winners & Highlights/FAQ/Kretjes -- Quiz, Teams and Mens-Games 🏆 are gone', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openEventPage(user)

    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Polls' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Winners & Highlights' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'FAQ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kretjes 🍺' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Quiz' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Teams' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mens-Games 🏆' })).not.toBeInTheDocument()
  })

  it('Mens-Games is still reachable -- just from Tools, not the event page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /tools menu/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /tools menu/i }))
    expect(screen.getByRole('button', { name: '🏆 Mens-Games' })).toBeInTheDocument()
  })
})

describe("Winners & Highlights connects itself to finished tournaments (mirrors the quiz's §7.4 AUTO card)", () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
    localStorage.setItem('md-mg-unlocked', 'true')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('shows an AUTO card for the finished, linked, non-secret tournament with no real award row yet', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openEventPage(user)
    await user.click(await screen.findByText('Winners & Highlights'))

    const section = screen.getByRole('heading', { name: /awards & winners/i }).closest('div').parentElement
    // Scoped to this specific AUTO card -- "Doom" alone also matches the
    // real Pool Toernooi award card (both name the same lad) and the Nav's
    // own account-menu button.
    const card = within(section).getByText('🏆 Darts Cup').parentElement
    expect(within(card).getByText('Doom')).toBeInTheDocument()
    expect(within(card).getByText('12 pts')).toBeInTheDocument()
  })

  it('suppresses the AUTO card once a real award row exists for that tournament, but still shows the real one', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openEventPage(user)
    await user.click(await screen.findByText('Winners & Highlights'))

    const section = screen.getByRole('heading', { name: /awards & winners/i }).closest('div').parentElement
    // The real award (from events.winners) always renders.
    expect(within(section).getByText('🏆 Pool Toernooi — 1e plaats')).toBeInTheDocument()
    // Its AUTO twin must NOT also render.
    expect(within(section).queryByText('🏆 Pool Toernooi')).not.toBeInTheDocument()
  })

  it('never shows a tournament linked to a different event', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openEventPage(user)
    await user.click(await screen.findByText('Winners & Highlights'))

    expect(screen.queryByText(/Ander Event Cup/)).not.toBeInTheDocument()
  })

  // The invariant the task brief calls out by name: "A secret tournament
  // must never appear." Two independent layers are asserted separately so a
  // bug in either one alone is still caught: the fetch layer
  // (`fetchTournamentResults` excluding it from `tournamentResults`
  // entirely) and the display layer (`WinnersTab`'s own `!settings.secret`
  // filter, in case a secret row ever reached the prop some other way).
  it('never shows the secret tournament\'s name, an AUTO card, or a real award for it -- anywhere on the page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openEventPage(user)
    await user.click(await screen.findByText('Winners & Highlights'))

    expect(screen.queryByText(/Geheim Toernooi/)).not.toBeInTheDocument()
    expect(screen.queryByText('99 pts')).not.toBeInTheDocument()
  })

  it('never leaks the secret tournament anywhere else on Overview either (belt and braces on the whole event page)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openEventPage(user)

    expect(screen.queryByText(/Geheim Toernooi/)).not.toBeInTheDocument()
  })
})
