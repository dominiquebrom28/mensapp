// The owner, on seeing the standalone quiz list: "i want the controls for
// each quiz to be on the quiz-tile itself. not below".
//
// They were below because `QuizRow` was a single full-width <button>, and a
// button cannot contain buttons. The workaround exiled Present/Duplicate/
// Delete to a strip under the whole list, where each one had to repeat the
// quiz title to say what it acted on. The row is a container now: the label
// is its own button, the actions are its siblings.
//
// Two things this guards, both of which fail silently rather than loudly:
//   - a button nested inside a button (invalid HTML, and the inner click
//     target behaves differently across browsers)
//   - an icon-only action with no accessible name. `Btn` used to drop every
//     prop it did not explicitly name, so `aria-label` vanished without a
//     word and "✕" announced as nothing at all.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

// Same stubbing as QuizShell.test.jsx: the heavy children are covered
// elsewhere, this file is only about the row's own composition.
vi.mock('../../features/quiz/QuizDashboard.jsx', () => ({ default: () => <div>stub-dashboard</div> }))
vi.mock('../../features/quiz/QuizBuilder.jsx', () => ({ QuizBuilder: () => <div>stub-builder</div> }))
vi.mock('../../features/quiz/QuizPresenter.jsx', () => ({ QuizPresenter: () => <div>stub-presenter</div> }))

const fetchQuizzes = vi.fn()
vi.mock('../../features/quiz/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchQuizzes: (...a) => fetchQuizzes(...a),
  saveQuiz: async q => ({ ok: true, error: null, quiz: q }),
  deleteQuiz: async () => ({ ok: true, error: null }),
}))

const { Btn } = await import('../../features/quiz/ui/Kit.jsx')
const QuizShell = (await import('../../features/quiz/QuizShell.jsx')).default

// One standalone quiz (gets actions) and one event-linked (must not).
const renderShell = async () => {
  fetchQuizzes.mockResolvedValue({
    ok: true, error: null,
    quizzes: [{ id: 'qz-standalone', title: 'Tafelquiz', eventId: null, status: 'ready', rounds: [] }],
  })
  const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [{ id: 'qz-legacy', title: 'Oude Pubquiz', status: 'ready', rounds: [] }] }]
  return render(
    <QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }}
      can={{ hostQuiz: () => true, runTournament: () => true }} teamSets={[]}
      onUpdateEvent={() => {}} onSendNotif={() => {}} />,
  )
}

describe('quiz Btn passes through what it is given', () => {
  it('forwards aria-label instead of swallowing it', () => {
    render(<Btn aria-label="Verwijder trst 2" onClick={() => {}}>✕</Btn>)
    expect(screen.getByRole('button', { name: 'Verwijder trst 2' })).toBeInTheDocument()
  })

  it('forwards arbitrary attributes it does not name', () => {
    render(<Btn data-testid="passthrough" title="tip" onClick={() => {}}>x</Btn>)
    const b = screen.getByTestId('passthrough')
    expect(b.getAttribute('title')).toBe('tip')
  })

  it('has the same minimum tap targets as the other two Btn forks', () => {
    // jsdom has no layout engine, so assert the declared value, not geometry.
    const sizes = { sm: '36px', md: '44px', lg: '48px' }
    for (const [size, expected] of Object.entries(sizes)) {
      const { unmount } = render(<Btn size={size} onClick={() => {}}>x</Btn>)
      expect(screen.getByRole('button').style.minHeight, `size=${size}`).toBe(expected)
      unmount()
    }
  })
})

describe('standalone quiz row', () => {
  it('puts the actions inside the row, not in a strip below the list', async () => {
    const { container } = await renderShell()
    const title = await screen.findByText('Tafelquiz')

    // Walk up to the row: the nearest ancestor that also contains the
    // status Tag. If the actions were still a strip under the list they
    // would not be inside it.
    let row = title.parentElement
    while (row && !within(row).queryByRole('button', { name: /Verwijder Tafelquiz/ })) row = row.parentElement
    expect(row, 'no ancestor of the title contains the delete action').not.toBeNull()
    expect(within(row).getByText('Tafelquiz')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Presenteer Tafelquiz/ })).toBeInTheDocument()

    // And the row is genuinely a row, not the whole page.
    expect(row.contains(container.firstChild)).toBe(false)
  })

  it('names every icon-only action, so "✕" is not an unlabelled button', async () => {
    await renderShell()
    await screen.findByText('Tafelquiz')
    expect(screen.getByRole('button', { name: /Dupliceer Tafelquiz/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Verwijder Tafelquiz/ })).toBeInTheDocument()
  })

  it('never nests a button inside a button', async () => {
    const { container } = await renderShell()
    await screen.findByText('Tafelquiz')
    expect(container.querySelectorAll('button button')).toHaveLength(0)
  })

  it('stops repeating the quiz title in the visible label -- that was a symptom of being detached', async () => {
    await renderShell()
    await screen.findByText('Tafelquiz')
    expect(screen.queryByText(/Dupliceer\s*[\u201c"]/)).toBeNull()
  })

  it('gives an event-linked quiz no standalone actions -- it is managed from its event dashboard', async () => {
    await renderShell()
    await screen.findByText('Oude Pubquiz')
    expect(screen.queryByRole('button', { name: /Verwijder Oude Pubquiz/ })).toBeNull()
  })
})
