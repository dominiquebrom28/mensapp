// End-to-end coverage for WP-Q7/Q8 (docs/quiz-unification-spec.md §8.1/§8.3,
// §14 decision 1): the quiz as a top-level page, reached through the real
// Nav, and the three places that now read the `quizzes` table
// (`fetchQuizResults()`) alongside the legacy `evt.quizzes[]` --
// `computeMemberStats`, `HallOfFame`'s quiz leaderboard, and `WinnersTab`'s
// §7.4 dedup. Full `<App/>`, mocked Supabase, navigation via the real
// buttons -- the pattern `hallOfFame.integration.test.jsx` and
// `src/test/quiz/liveDiscovery.integration.test.jsx` set, per the brief:
// assert what renders, not that a function was called.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// A standalone quiz -- no `event_id` at all, the owner's "own general
// feature" case. Only reachable through the top-level page: it has no
// `evt.quizzes[]` home to have ever lived in.
const STANDALONE_QUIZ_ROW = {
  id: 'qz-standalone', title: 'Losstaande Weetjesquiz', event_id: null, status: 'finished',
  rounds: [{ id: 'r0', title: 'Ronde 1', theme: '', icon: '🧠', description: '', bgImage: null, secret: false, questions: [] }],
  default_time: 30, intro_text: '', intro_bg: '', team_set_id: null, teams: [], participants: [],
  scores: { Bram: 50 }, member_scores: { Bram: 50 }, settings: {}, rev: 1, created_by: '',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T20:00:00Z',
}

// Event-linked, finished, and already has a real WP-Q6 award row on
// `events.winners` (`qz-qz-published-...`) -- the §7.4 case: the derived
// AUTO card must be suppressed for this one.
const QUIZ_PUBLISHED = { id: 'qz-published', title: 'Gepubliceerde Quiz', status: 'finished', teams: [], scores: { Doom: 40 }, memberScores: { Doom: 40 }, rounds: [] }
// Event-linked, finished, but never went through `finishQuiz` (a legacy
// quiz, or one finished before WP-Q6 shipped) -- no matching award row, so
// its AUTO card must still show.
const QUIZ_AUTO = { id: 'qz-auto', title: 'Onopgehaalde Quiz', status: 'finished', teams: [], scores: { Bram: 25 }, memberScores: { Bram: 25 }, rounds: [] }

vi.mock('../../supabase.js', async () => {
  const { makeSupabaseMock } = await import('../mocks/supabaseMock.js')
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
            id: 'evt-1', name: 'Mensdag 2025', type: 'day', date: '2025-06-01', end_date: '', start_time: '12:00', end_time: '',
            location: 'TBD', description: '', theme: '', trailer_video_url: '', teaser_active: false, teaser_title: '', teaser_text: '', teaser_button_label: '',
            archived: true, kretjes: 0,
            attendees: [{ name: 'Doom', status: 'went' }, { name: 'Bram', status: 'went' }],
            schedule: [], polls: [], photos: [], highlights: [], faqs: [],
            quizzes: [QUIZ_PUBLISHED, QUIZ_AUTO],
            winners: [{ id: 'qz-qz-published-solo-doom', category: '🏆 Gepubliceerde Quiz — 1e plaats', winner: 'Doom', detail: '40 punten', icon: '🥇' }],
          },
        ],
        error: null,
      },
      quizzes: { data: [STANDALONE_QUIZ_ROW], error: null },
      quiz_live: { data: [], error: null },
      announcements: { data: [], error: null },
      team_sets: { data: [], error: null },
    }),
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../../App.jsx')

describe('the quiz as a standalone tool, reached through the real Nav', () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('opens the top-level quiz page via Tools > Quiz and lists both a standalone quiz and event-linked ones', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(screen.getByRole('button', { name: /tools menu/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /tools menu/i }))
    await user.click(await screen.findByRole('button', { name: /🧠 quiz/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: '🧠 Quiz' })).toBeInTheDocument())
    // The standalone quiz -- from the `quizzes` table, no event at all.
    expect(await screen.findByText('Losstaande Weetjesquiz')).toBeInTheDocument()
    // Anchored at the end -- "Losstaande Weetjesquiz" (the title) also
    // contains the substring "Losstaand" and would otherwise false-match.
    expect(screen.getByText(/· Losstaand$/)).toBeInTheDocument()
    // The event-linked ones -- found via the `evt.quizzes[]` merge (WP-Q7's
    // "built-since" gap-closer), each annotated with its event's name.
    expect(screen.getByText('Gepubliceerde Quiz')).toBeInTheDocument()
    expect(screen.getByText('Onopgehaalde Quiz')).toBeInTheDocument()
    expect(screen.getAllByText(/Mensdag 2025/).length).toBeGreaterThan(0)
  })

  it('also reaches the quiz page from the Home "Tools" tile row', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('Quiz')).toBeInTheDocument())
    await user.click(screen.getByText('Quiz'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '🧠 Quiz' })).toBeInTheDocument())
  })

  it("Hall of Fame's quiz leaderboard includes the standalone quiz's member_scores, not just evt.quizzes", async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /hall of fame/i })).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: /hall of fame/i })[0])
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Hall of Fame' })).toBeInTheDocument())
    // Hall of Fame's 2026-08-26 reorg (docs/hall-of-fame-spec.md) moved this
    // leaderboard behind the "Quiz All-Time" tile's click -- same underlying
    // content, opened on demand instead of always rendered inline.
    await user.click(screen.getByRole('button', { name: /quiz all-time/i }))

    const heading = await screen.findByRole('heading', { name: /quiz all-time scores/i })
    const section = heading.closest('div')
    // Bram: 25 (evt.quizzes' QUIZ_AUTO) + 50 (the standalone quiz) = 75,
    // across 2 quizzes -- proves the merge adds on top rather than only
    // showing one source.
    expect(within(section).getByText('75')).toBeInTheDocument()
    expect(within(section).getByText(/2 quizzes played/)).toBeInTheDocument()
  })

  it("WinnersTab suppresses the AUTO card for the already-published quiz but keeps it for the one that never got a real award", async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('Mensdag 2025')).toBeInTheDocument())
    await user.click(screen.getByText('Mensdag 2025'))
    await user.click(await screen.findByText('Winners & Highlights'))

    // Scoped to the awards section -- "Doom" alone also matches the Nav's
    // own account-menu button.
    await screen.findByText('🏆 Gepubliceerde Quiz — 1e plaats')
    const section = screen.getByRole('heading', { name: /awards & winners/i }).closest('div').parentElement
    // The real award (from `events.winners`) always renders.
    expect(within(section).getByText('Doom')).toBeInTheDocument()
    expect(within(section).getByText('🏆 Gepubliceerde Quiz — 1e plaats')).toBeInTheDocument()
    // Its AUTO twin must NOT also render -- §7.4's whole point.
    expect(within(section).queryByText('🧠 Gepubliceerde Quiz')).not.toBeInTheDocument()
    // The quiz with no real award row still gets its AUTO card.
    expect(within(section).getByText('🧠 Onopgehaalde Quiz')).toBeInTheDocument()
  })
})
