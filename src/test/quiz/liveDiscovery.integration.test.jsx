// The bug this exists to prevent: a live quiz that nobody can see.
//
// WP-Q4 stopped writing `events.quizzes[]._liveState`, which is what
// EventPage used to scan to decide whether to mount the participant
// overlay. Discovery moved to the `quiz_live` table -- and the first
// version of that discovery queried `quizzes where status='live'` instead.
// That looks equivalent and is not: §10.2's migration was a ONE-TIME copy,
// the builder still writes only to `events.quizzes`, and `patchQuiz` is a
// silent no-op on a row that doesn't exist. So for any quiz built after the
// migration -- i.e. every quiz built between now and WP-Q5/Q7 -- going live
// would have written a `quiz_live` row, failed silently to flag `quizzes`,
// found nothing in discovery, and shown fifteen people nothing at all. No
// error, no failing unit test, just a dead quiz on the night.
//
// So this asserts the whole path end to end, through a real <App/>: a
// `quiz_live` row for a quiz that exists ONLY in `events.quizzes` must put
// the participant in the overlay.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const QUIZ = {
  id: 'qz-unmigrated',
  title: 'De Grote Pubquiz',
  status: 'ready',
  defaultTime: 30,
  introText: '',
  introBg: '',
  teams: [],
  scores: {},
  memberScores: {},
  rounds: [
    { id: 'r1', title: 'Ronde 1', theme: '', icon: '🎯', description: '', bgImage: null,
      questions: [{ q: 'Hoeveel?', type: 'multiple', options: ['Een', 'Twee'], answer: 0, points: 10 }] },
  ],
}

const LIVE_ROW = {
  quiz_id: 'qz-unmigrated', quiz_rev: 1, event_id: 'evt-1',
  phase: 'question', round_idx: 0, q_idx: 0, slide_phase: 'question',
  scores: {}, summary_revealed: [], pause_config: {},
  timer_started_at: null, timer_limit: null,
  is_team_quiz: false, presenter_id: 'someone-else',
  updated_at: '2026-08-26T00:00:00Z',
}

vi.mock('../../supabase.js', async () => {
  const { makeSupabaseMock } = await import('../mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      users: {
        data: [{ id: 'u-1', username: 'Doom', display_name: 'Doom', role: 'lad', pin_hash: 'x', joined_at: '2023-01-01', avatar: 0 }],
        error: null,
      },
      events: {
        data: [{
          id: 'evt-1', name: 'Mensdag 2026', type: 'day', date: '2026-12-01', end_date: '',
          start_time: '12:00', end_time: '', location: 'TBD', description: '', theme: '',
          trailer_video_url: '', teaser_active: false, teaser_title: '', teaser_text: '', teaser_button_label: '',
          archived: false, kretjes: 0,
          attendees: [{ name: 'Doom', status: 'going' }],
          schedule: [], polls: [], photos: [], winners: [], highlights: [], faqs: [],
          // The quiz exists HERE and nowhere else. There is no `quizzes` row.
          quizzes: [QUIZ],
        }],
        error: null,
      },
      // Deliberately empty: this quiz was never migrated.
      quizzes: { data: [], error: null },
      quiz_live: { data: [LIVE_ROW], error: null },
      quiz_answers: { data: [], error: null },
      announcements: { data: [], error: null },
      team_sets: { data: [], error: null },
    }),
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../../App.jsx')

describe('live-quiz discovery, end to end', () => {
  beforeEach(() => { localStorage.setItem('md-session', 'u-1') })
  afterEach(() => { localStorage.clear() })

  it('puts a member into the participant overlay for a quiz that has no `quizzes` row', async () => {
    render(<App />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByText('Mensdag 2026')).toBeInTheDocument())
    await user.click(screen.getByText('Mensdag 2026'))

    // The overlay is a lazy chunk behind Suspense, and discovery is async
    // (fetchLiveQuizzes -> resolve the definition locally -> mount).
    await waitFor(
      () => expect(screen.getByText('De Grote Pubquiz')).toBeInTheDocument(),
      { timeout: 4000 },
    )
    // The live question itself, i.e. the overlay really rendered rather than
    // some other surface happening to print the title.
    expect(screen.getByText('Hoeveel?')).toBeInTheDocument()
    // And the exit added in 50b8690 is reachable from it.
    expect(screen.getByText(/Hide/)).toBeInTheDocument()
  })
})
