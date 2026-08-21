import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// App.jsx imports src/supabase.js, which calls createClient(...) using
// import.meta.env.VITE_SUPABASE_* at module load, then App.jsx fires three
// supabase.from(...).select(...) queries plus two realtime channel
// subscriptions on mount. None of that should ever hit a real network or a
// real Supabase project in a test -- so we replace the whole module with a
// fake client. The factory uses a dynamic import (not a reference to an
// outer-scope binding) specifically to sidestep vi.mock's hoisting rules.
vi.mock('../supabase.js', async () => {
  const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      // One real (non-pending) user so App.jsx's mount effect goes straight
      // to "loaded" without exercising the first-run DB-seeding path (which
      // calls hashPin -> crypto.subtle -- doable in jsdom, but irrelevant to
      // what this smoke test is checking).
      users: {
        data: [
          {
            id: 'u-1',
            username: 'Doom',
            role: 'admin',
            display_name: 'Doom',
            pin_hash: 'irrelevant-in-this-test',
            joined_at: '2023-01-01',
            avatar: 0,
          },
        ],
        error: null,
      },
      events: { data: [], error: null },
      announcements: { data: [], error: null },
    }),
    hashPin: async () => 'mock-hash',
  }
})

// Imported dynamically, after vi.mock is registered, so App.jsx (and its
// `import { supabase, hashPin } from './supabase.js'`) resolves to the mock.
const { default: App } = await import('../App.jsx')

describe('App', () => {
  it('imports and renders without throwing, past the loading state, to the login screen', async () => {
    render(<App />)

    // App.jsx renders "Loading…" until its mount-time Promise.all(...) of
    // supabase queries resolves. The mock resolves on a microtask, so we
    // still need waitFor to flush it before asserting on the next screen.
    await waitFor(() => {
      expect(screen.getByText('Welcome back')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })
})
