// Regression coverage for the participant trap (Notion Order 0.4).
//
// QuizParticipantView mounts itself the moment any quiz in the event has a
// `_liveState` -- fixed, inset 0, zIndex 999, over everything. Before this
// fix its ONLY exit was "✕ End Session", gated behind
// `can.hostQuiz(currentUser)`, which kills the quiz for all ~15 people. A
// member who opened the event during a live quiz had no way out of the
// overlay at all: no close button, no Escape, no backdrop.
//
// The fix mirrors the pattern PresentationMode's viewer already uses
// (App.jsx `viewerDismissed` + a "▶ Rejoin" banner): an `onHide` prop that
// tells EventPage to unmount the overlay, reachable from a "✕ Hide" button
// and from Escape. Hiding never touches the shared `_liveState` -- that
// distinction is the whole point, so it's asserted explicitly below.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeSupabaseMock } from '../mocks/supabaseMock.js'

vi.mock('../../supabase.js', () => ({ supabase: makeSupabaseMock() }))

const QuizParticipantView = (await import('../../features/quiz/QuizParticipantView.jsx')).default

const liveQ = {
  id: 'q1',
  title: 'Pubquiz',
  _liveState: {
    phase: 'question',
    roundIdx: 0,
    qIdx: 0,
    slidePhase: 'question',
    isTeamQuiz: false,
    teams: [],
    answers: {},
  },
  rounds: [
    { id: 'r1', title: 'Round 1', questions: [{ q: 'How many?', type: 'multiple', options: ['One', 'Two'], answer: 0, points: 10 }] },
  ],
}
const evt = { id: 'e1', attendees: [{ name: 'sander' }], quizzes: [liveQ] }
const member = { username: 'sander', name: 'Sander' }

const renderAs = (can, onHide) =>
  render(<QuizParticipantView evt={evt} liveQ={liveQ} currentUser={member} onUpdate={() => {}} users={[]} can={can} onHide={onHide} />)

const memberCan = { hostQuiz: () => false }
const hostCan = { hostQuiz: () => true }

describe('QuizParticipantView exit', () => {
  it('gives a member a Hide button -- the trap was having none', () => {
    const onHide = vi.fn()
    renderAs(memberCan, onHide)
    expect(screen.queryByText(/End Session/)).toBeNull()
    fireEvent.click(screen.getByText(/Hide/))
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('lets Escape out too', () => {
    const onHide = vi.fn()
    renderAs(memberCan, onHide)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('hiding is local only -- it must not write to the event', () => {
    const onUpdate = vi.fn()
    const onHide = vi.fn()
    render(<QuizParticipantView evt={evt} liveQ={liveQ} currentUser={member} onUpdate={onUpdate} users={[]} can={memberCan} onHide={onHide} />)
    fireEvent.click(screen.getByText(/Hide/))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(liveQ._liveState).not.toBeNull()
  })

  it('a host keeps both: Hide for themselves, End Session for the room', () => {
    const onHide = vi.fn()
    renderAs(hostCan, onHide)
    expect(screen.getByText(/Hide/)).toBeTruthy()
    expect(screen.getByText(/End Session/)).toBeTruthy()
  })

  it('renders without a Hide button when no onHide is wired (nothing to click into a crash)', () => {
    renderAs(memberCan, undefined)
    expect(screen.queryByText(/Hide/)).toBeNull()
  })
})

// EventPage's half of the fix. Mounting the whole app with a live quiz just
// to read one banner isn't worth the fragility (same call
// modalBackdrop.wiring.test.js makes), so this asserts the wiring against
// App.jsx's source text: the overlay must be gated on the dismissal, the
// dismissal must clear when the live session changes, and there must be a
// way back in.
describe('EventPage wiring', () => {
  const source = readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf-8')

  it('gates the overlay on the dismissal and passes onHide', () => {
    expect(source).toMatch(/\{liveQuiz&&!quizDash&&!quizDismissed&&<Suspense/)
    expect(source).toMatch(/<QuizParticipantView[^/]*onHide=\{\(\)=>setQuizDismissed\(true\)\}/)
  })

  it('clears the dismissal when the live quiz changes, so the next session is not suppressed', () => {
    expect(source).toMatch(/useEffect\(\(\)=>\{setQuizDismissed\(false\)\},\[liveQuizId\]\)/)
  })

  it('shows a rejoin banner while hidden', () => {
    expect(source).toMatch(/\{liveQuiz&&quizDismissed&&!quizDash&&\(/)
    expect(source).toMatch(/onClick=\{\(\)=>setQuizDismissed\(false\)\}[^>]*>▶ Rejoin</)
  })
})
