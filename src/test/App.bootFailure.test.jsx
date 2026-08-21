// Regression coverage for "app can hang on the loading screen forever":
// the boot `Promise.all(...)` had no `.catch()`, so a genuine rejection (a
// hard offline `fetch` throw, not one of its four calls' own resolved
// {error}) left `setLoaded(true)` uncalled and the app stuck on "Loading…"
// with no feedback and no way to recover short of a hard refresh.
// Full-`<App/>`-render, same approach as App.smoke.test.jsx.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const USER_ROW = {
  id: 'u-1', username: 'Doom', role: 'admin', display_name: 'Doom',
  pin_hash: 'irrelevant-in-this-test', joined_at: '2023-01-01', avatar: 0,
}

vi.mock('../supabase.js', async () => {
  const { makeQueryBuilder, makeChannel } = await import('./mocks/supabaseMock.js')
  // First boot attempt: "events" rejects outright (simulating a hard
  // offline fetch throw). Second attempt (triggered by the retry button):
  // succeeds, same as a normal boot.
  let attempt = 0
  return {
    supabase: {
      from: (table) => {
        if (table === 'events' && attempt === 0) {
          attempt += 1
          return { select: () => ({ order: () => Promise.reject(new Error('network down')) }) }
        }
        if (table === 'users') return makeQueryBuilder({ data: [USER_ROW], error: null })
        return makeQueryBuilder({ data: [], error: null })
      },
      channel: () => makeChannel(),
      removeChannel: () => {},
    },
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../App.jsx')

describe('App boot survives a genuine Promise.all rejection', () => {
  it('shows a recoverable error screen instead of hanging on "Loading…" forever, and "Opnieuw proberen" recovers', async () => {
    const user = userEvent.setup()
    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/kon de app niet laden/i)
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /opnieuw proberen/i }))

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument())
  })
})
