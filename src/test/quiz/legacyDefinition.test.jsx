// The companion to liveDiscovery.integration.test.jsx, one layer down.
//
// §4.3's `rev` mechanism refetches the quiz definition from the `quizzes`
// table whenever `quiz_live.quiz_rev` differs from the definition we hold,
// so a mid-quiz typo fix reaches every phone. Correct — once the builder
// writes to that table. It does not yet: until WP-Q5/Q7, quizzes are
// authored into `events.quizzes` and arrive here as a prop with no `rev`.
//
// In that state the `quizzes` row is either absent (built after §10.2's
// one-time migration) or a stale pre-migration snapshot, and `quiz_rev`
// will essentially never equal an absent `rev`. So an ungated refetch fires
// on every mount and, on a stale row, replaces the questions the presenter
// is showing with the ones the quiz had weeks ago — fifteen phones quietly
// on the wrong quiz. The refetch is therefore gated on the seed carrying a
// real `rev`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { makeSupabaseMock } from '../mocks/supabaseMock.js'

const LIVE_ROW = {
  quiz_id: 'qz1', quiz_rev: 7, event_id: 'evt-1',
  phase: 'question', round_idx: 0, q_idx: 0, slide_phase: 'question',
  scores: {}, summary_revealed: [], pause_config: {},
  timer_started_at: null, timer_limit: null,
  is_team_quiz: false, presenter_id: 'presenter-1',
  updated_at: '2026-08-26T00:00:00Z',
}

vi.mock('../../supabase.js', () => ({
  supabase: makeSupabaseMock({ quiz_live: { data: [LIVE_ROW], error: null } }),
}))

const fetchQuiz = vi.fn(async () => ({ ok: true, error: null, quiz: { id: 'qz1', title: 'STALE', rounds: [] } }))
vi.mock('../../features/quiz/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchQuiz: (...a) => fetchQuiz(...a),
}))

const QuizParticipantView = (await import('../../features/quiz/QuizParticipantView.jsx')).default

const currentQuestions = [{ q: 'The question the presenter is actually showing', type: 'multiple', options: ['A', 'B'], answer: 0, points: 10 }]
const base = { id: 'qz1', title: 'Pubquiz', teams: [], rounds: [{ id: 'r1', title: 'Ronde 1', questions: currentQuestions }] }
const member = { username: 'doom', name: 'Doom' }
const can = { hostQuiz: () => false }

const mount = liveQ =>
  render(<QuizParticipantView liveQ={liveQ} currentUser={member} users={[]} can={can} onHide={() => {}} />)

describe('definition refresh vs. a legacy-authored quiz', () => {
  beforeEach(() => { fetchQuiz.mockClear() })

  it('does NOT refetch when the definition arrived without a rev, and keeps showing it', async () => {
    mount(base)
    await waitFor(() => expect(screen.getByText(currentQuestions[0].q)).toBeInTheDocument())
    expect(fetchQuiz).not.toHaveBeenCalled()
    expect(screen.queryByText('STALE')).toBeNull()
  })

  it('DOES refetch when the definition carries a rev and the live row has moved past it', async () => {
    mount({ ...base, rev: 3 })
    await waitFor(() => expect(fetchQuiz).toHaveBeenCalledWith('qz1'))
  })

  it('does not refetch when a rev-carrying definition is already current', async () => {
    mount({ ...base, rev: 7 })
    await waitFor(() => expect(screen.getByText(currentQuestions[0].q)).toBeInTheDocument())
    expect(fetchQuiz).not.toHaveBeenCalled()
  })
})
