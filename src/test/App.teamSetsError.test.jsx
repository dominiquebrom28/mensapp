// Regression coverage for "can't read" vs "nothing here": `fetchTeamSets`
// now reports {ok,error,teamSets} instead of a bare [] on failure
// (teamlib/api.js), and every read site must show a real error instead of
// a false "Nog geen teamsets opgeslagen". Full-`<App/>`-render, same
// approach as App.smoke.test.jsx / hallOfFame.integration.test.jsx, since
// neither `App`'s boot effect nor TeamCreatorPage's closures are reachable
// any other way per §5.4.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const USER_ROW = {
  id: 'u-1', username: 'Doom', role: 'admin', display_name: 'Doom',
  pin_hash: 'irrelevant-in-this-test', joined_at: '2023-01-01', avatar: 0,
}

vi.mock('../supabase.js', async () => {
  const { makeQueryBuilder, makeChannel } = await import('./mocks/supabaseMock.js')
  // Mutable so the "retry" test can flip it mid-test, same idiom
  // updateEvent.writeFailure.test.js uses for "the wifi came back".
  const state = {
    teamSets: { data: null, error: { message: 'PGRST205: Could not find the table' } },
  }
  return {
    supabase: {
      from: (table) => {
        if (table === 'users') return makeQueryBuilder({ data: [USER_ROW], error: null })
        if (table === 'team_sets') return makeQueryBuilder(state.teamSets)
        return makeQueryBuilder({ data: [], error: null })
      },
      channel: () => makeChannel(),
      removeChannel: () => {},
      __setTeamSets: (result) => { state.teamSets = result },
    },
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../App.jsx')
const { supabase } = await import('../supabase.js')

async function openTeamCreator(user) {
  render(<App />)
  await waitFor(() => expect(screen.getByText('Team Creator')).toBeInTheDocument())
  await user.click(screen.getByText('Team Creator'))
  await waitFor(() => expect(screen.getByRole('heading', { name: /🎲 Team Creator/i })).toBeInTheDocument())
}

describe('TeamCreatorPage library read failure', () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('shows a real error, not "Nog geen teamsets opgeslagen", when the read failed', async () => {
    const user = userEvent.setup()
    await openTeamCreator(user)

    expect(await screen.findByText(/kon de teams-bibliotheek niet laden/i)).toBeInTheDocument()
    expect(screen.queryByText(/nog geen teamsets opgeslagen/i)).not.toBeInTheDocument()
  })

  it('"Opnieuw proberen" re-fetches and clears the error once the read succeeds', async () => {
    const user = userEvent.setup()
    await openTeamCreator(user)
    await screen.findByText(/kon de teams-bibliotheek niet laden/i)

    supabase.__setTeamSets({ data: [], error: null })
    await user.click(screen.getByRole('button', { name: /opnieuw proberen/i }))

    await waitFor(() => expect(screen.queryByText(/kon de teams-bibliotheek niet laden/i)).not.toBeInTheDocument())
    expect(screen.getByText(/nog geen teamsets opgeslagen/i)).toBeInTheDocument()
  })
})
