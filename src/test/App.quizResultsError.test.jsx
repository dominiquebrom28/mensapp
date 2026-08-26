// Regression coverage for the same "must never reject" contract
// `App.teamSetsError.test.jsx` guards for `fetchTeamSets` (docs/
// quiz-unification-spec.md §9): `fetchQuizResults()` is folded into the boot
// `Promise.all` right alongside it (App.jsx), and a failed/erroring
// `quizzes` read must degrade -- boot still finishes, Home still renders,
// Hall of Fame still renders off the `evt.quizzes[]`/`events.winners` data
// it already has -- rather than ever blocking the app on the loading screen
// (that failure mode is `App.bootFailure.test.jsx`'s whole subject, for a
// hard rejection; this one is the "resolved {error}" shape instead).
// Full-`<App/>`-render, same approach as those two files.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const USER_ROW = {
  id: 'u-1', username: 'Doom', role: 'admin', display_name: 'Doom',
  pin_hash: 'irrelevant-in-this-test', joined_at: '2023-01-01', avatar: 0,
}

vi.mock('../supabase.js', async () => {
  const { makeQueryBuilder, makeChannel } = await import('./mocks/supabaseMock.js')
  return {
    supabase: {
      from: (table) => {
        if (table === 'users') return makeQueryBuilder({ data: [USER_ROW], error: null })
        // Every `quizzes` read -- both `fetchQuizResults()` (boot) and
        // `fetchQuizzes()` (the standalone page, WP-Q7) -- fails the same
        // way a genuinely down table would: a resolved {error}, not a
        // throw.
        if (table === 'quizzes') return makeQueryBuilder({ data: null, error: { message: 'network unreachable' } })
        return makeQueryBuilder({ data: [], error: null })
      },
      channel: () => makeChannel(),
      removeChannel: () => {},
    },
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../App.jsx')

describe('fetchQuizResults failure does not block boot or crash quiz-results consumers', () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('boots straight to Home, with no loading screen stuck and no crash', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('🍺 MensApp')).toBeInTheDocument())
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('Hall of Fame still renders off events.winners/evt.quizzes -- quizResults degrades to [], not a crash', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /hall of fame/i })).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: /hall of fame/i })[0])
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Hall of Fame' })).toBeInTheDocument())
  })

  it('the standalone quiz page still opens and shows its own error state instead of crashing the app', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /tools menu/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /tools menu/i }))
    await user.click(await screen.findByRole('button', { name: /🧠 quiz/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '🧠 Quiz' })).toBeInTheDocument())
    expect(await screen.findByText(/kon de quizzen niet laden/i)).toBeInTheDocument()
  })
})
