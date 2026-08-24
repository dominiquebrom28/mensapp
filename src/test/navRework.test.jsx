// Coverage for the 2026-08-24 Nav rework: the old 10-button row (Lads, Hall
// of Fame, Teams, Timer, Mens-Games, Sara Jay, Announce, Admin, the
// notification bell, and the avatar chip + Logout) silently clipped items
// off-screen at 768-1000px (measured in-browser -- see the task brief;
// jsdom has no layout engine and cannot reproduce that directly, so this
// file proves the *structural* part of the fix instead: Team Creator,
// Timer, Mens-Games and Sara Jay are grouped behind a "Tools" trigger;
// Profile/Announce/Admin/Logout move behind the avatar's "account menu"
// trigger, gated by role; and both hand-rolled dropdowns open/close on
// trigger click, outside click, and Escape.
//
// mensGamesUnlock.test.jsx already covers the locked-label distinction
// (Mens-Games's "🔒 Mens-Games" vs Sara Jay's "🔒 ???") in detail from the
// feature-toggle's own perspective; this file covers Nav's structure from
// its own perspective and doesn't re-litigate that distinction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const ADMIN_USER = {
  id: 'u-1',
  username: 'Doom',
  role: 'admin',
  display_name: 'Doom',
  pin_hash: 'irrelevant-for-session-shortcut-login',
  joined_at: '2023-01-01',
  avatar: 0,
}

const LAD_USER = {
  id: 'u-2',
  username: 'Bram',
  role: 'lad',
  display_name: 'Bram',
  pin_hash: 'irrelevant-for-session-shortcut-login',
  joined_at: '2023-01-01',
  avatar: 1,
}

function setDesktop() {
  window.innerWidth = 1024
  window.dispatchEvent(new Event('resize'))
}

async function goHome() {
  await waitFor(() => {
    expect(screen.getByText('MENSAPP')).toBeInTheDocument()
  })
}

function mockSupabase(users) {
  vi.doMock('../supabase.js', async () => {
    const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
    return {
      supabase: makeSupabaseMock({
        users: { data: users, error: null },
        events: { data: [], error: null },
        announcements: { data: [], error: null },
      }),
      hashPin: async () => 'mock-hash',
    }
  })
}

beforeEach(() => {
  setDesktop()
  // Both features unlocked by default so neither locked-label treatment
  // adds noise to tests that aren't about locking.
  localStorage.setItem('md-sj-unlocked', 'true')
  localStorage.setItem('md-mg-unlocked', 'true')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('Nav Tools menu', () => {
  it('is closed by default and, once opened, holds all four grouped items', async () => {
    localStorage.setItem('md-session', 'u-1')
    mockSupabase([ADMIN_USER])
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    const trigger = screen.getByRole('button', { name: /tools menu/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '🎲 Team Creator' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '🎲 Team Creator' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '⏱ Timer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🏆 Mens-Games' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🤖 Sara Jay' })).toBeInTheDocument()
  })

  it('renders locked items disabled and greyed, without dropping them from the list', async () => {
    localStorage.setItem('md-session', 'u-1')
    localStorage.setItem('md-sj-unlocked', 'false')
    localStorage.setItem('md-mg-unlocked', 'false')
    mockSupabase([ADMIN_USER])
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()
    fireEvent.click(screen.getByRole('button', { name: /tools menu/i }))

    const mensGames = screen.getByRole('button', { name: '🔒 Mens-Games' })
    const saraJay = screen.getByRole('button', { name: '🔒 ???' })
    expect(mensGames).toBeDisabled()
    expect(saraJay).toBeDisabled()
    // Still listed alongside the two always-on items -- greyed, not dropped.
    expect(screen.getByRole('button', { name: '🎲 Team Creator' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '⏱ Timer' })).toBeInTheDocument()
  })

  it('closes on outside click', async () => {
    localStorage.setItem('md-session', 'u-1')
    mockSupabase([ADMIN_USER])
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    fireEvent.click(screen.getByRole('button', { name: /tools menu/i }))
    expect(screen.getByRole('button', { name: '⏱ Timer' })).toBeInTheDocument()

    fireEvent.click(document.body)
    expect(screen.queryByRole('button', { name: '⏱ Timer' })).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    localStorage.setItem('md-session', 'u-1')
    mockSupabase([ADMIN_USER])
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    const trigger = screen.getByRole('button', { name: /tools menu/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: '⏱ Timer' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '⏱ Timer' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('Nav account menu', () => {
  it('admin: shows Profile, Announce and Admin (carrying the pending-user badge) plus Uitloggen', async () => {
    localStorage.setItem('md-session', 'u-1')
    mockSupabase([ADMIN_USER, { ...LAD_USER, role: 'pending' }])
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    const trigger = screen.getByRole('button', { name: /account menu/i })
    // The pending-count signal must still reach admins even though Admin
    // moved behind the avatar -- surfaced on the closed trigger itself, so
    // the signal isn't lost behind an extra click.
    expect(within(trigger).getByText('1')).toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: /profile/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /announce/i })).toBeInTheDocument()
    const adminItem = screen.getByRole('button', { name: /admin/i })
    expect(within(adminItem).getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uitloggen' })).toBeInTheDocument()
  })

  it('non-admin lad: shows only Profile and Uitloggen -- no Announce/Admin, no pending badge', async () => {
    localStorage.setItem('md-session', 'u-2')
    mockSupabase([
      ADMIN_USER,
      LAD_USER,
      { id: 'u-3', username: 'PendingPete', role: 'pending', display_name: 'Pending Pete', pin_hash: 'x', joined_at: '2023-01-01', avatar: 2 },
    ])
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    const trigger = screen.getByRole('button', { name: /account menu/i })
    expect(within(trigger).queryByText('1')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: /profile/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uitloggen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /announce/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument()
  })

  it('closes on outside click and on Escape (returning focus to the trigger)', async () => {
    localStorage.setItem('md-session', 'u-1')
    mockSupabase([ADMIN_USER])
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    const trigger = screen.getByRole('button', { name: /account menu/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'Uitloggen' })).toBeInTheDocument()

    fireEvent.click(document.body)
    expect(screen.queryByRole('button', { name: 'Uitloggen' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Uitloggen' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('Nav at the mobile tier (<768px)', () => {
  it('leaves the hamburger flat list unchanged -- no Tools/account triggers', async () => {
    localStorage.setItem('md-session', 'u-1')
    mockSupabase([ADMIN_USER])
    window.innerWidth = 375
    window.dispatchEvent(new Event('resize'))
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    expect(screen.queryByRole('button', { name: /tools menu/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '☰' }))
    expect(screen.getByRole('button', { name: '🎲 Team Creator' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uitloggen' })).toBeInTheDocument()
  })
})
