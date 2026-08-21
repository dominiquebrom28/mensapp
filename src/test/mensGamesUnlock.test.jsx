// Integration coverage for the mens-games admin on/off switch -- an exact
// mirror of the existing Sara Jay pattern (root state seeded from
// localStorage["md-mg-unlocked"], synced via a system row `__mens_games__`
// in the `announcements` table, no dedicated table/migration). See
// docs references in the task brief; this file follows the same full-`<App/>`
// integration technique trailerAdapterGating.integration.test.jsx and
// hallOfFame.integration.test.jsx use (mocked supabase + the
// `md-session` resume shortcut), plus mocking the two mens-games lazy entry
// modules so we can prove -- not just assume -- that locked state never
// triggers their `import()` at all (the lazy chunk must never load, not
// merely have its buttons hidden).
//
// UPDATE (2026-08-21): the admin on/off *mechanism* is still an exact mirror
// of Sara Jay, but the LOCKED LABEL is not -- Sara Jay's "🔒 ???" mystery-box
// treatment made no sense for mens-games (just a feature not switched on
// yet, not a deliberate surprise) and produced two indistinguishable "🔒 ???"
// buttons side by side. Mens-games now keeps its real name when locked
// ("🔒 Mens-Games" in Nav, "Mens-Games" + a lock icon on the Home tile);
// Sara Jay's own "🔒 ???" treatment is untouched. Sara Jay is kept UNLOCKED
// (`md-sj-unlocked` seeded `true`) in most tests here purely so its own
// button/tile don't add noise to assertions that aren't about it -- Sara Jay
// itself is out of scope for this file except the one test below that
// locks both, to prove the two labels no longer collide.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mensGamesPageLoaded = vi.fn()
const mensGamesTabLoaded = vi.fn()

vi.mock('../features/mensgames/MensGamesPage.jsx', () => {
  mensGamesPageLoaded()
  return { default: () => <div data-testid="mens-games-page-stub">Mens-Games Page</div> }
})
vi.mock('../features/mensgames/MensGamesTab.jsx', () => {
  mensGamesTabLoaded()
  return { default: () => <div data-testid="mens-games-tab-stub">Mens-Games Tab</div> }
})

// Records every `announcements` upsert (table + row) so the toggle's write
// path can be asserted on, layered over the shared query-builder mock the
// same way every other table read/write in this mock behaves.
function makeSupabaseMockWithUpsertSpy(tableData, upsertSpy) {
  return async () => {
    const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
    const base = makeSupabaseMock(tableData)
    const supabase = {
      ...base,
      from: (table) => {
        const builder = base.from(table)
        if (table === 'announcements') {
          const origUpsert = builder.upsert
          builder.upsert = (rows) => {
            upsertSpy(table, rows)
            return origUpsert(rows)
          }
        }
        return builder
      },
    }
    return { supabase, hashPin: async () => 'mock-hash' }
  }
}

const ADMIN_USER = {
  id: 'u-1',
  username: 'Doom',
  role: 'admin',
  display_name: 'Doom',
  pin_hash: 'irrelevant-for-session-shortcut-login',
  joined_at: '2023-01-01',
  avatar: 0,
}

const EVENT = {
  id: 'evt-1',
  name: 'Mensdag XL',
  type: 'day',
  date: '2099-09-12', // far future -> upcoming, clickable from Home
  end_date: '',
  start_time: '18:00',
  end_time: '',
  location: 'Amsterdam',
  description: '',
  theme: '',
  trailer_video_url: '',
  teaser_active: false,
  teaser_title: '',
  teaser_text: '',
  teaser_button_label: '',
  attendees: [],
  schedule: [],
  polls: [],
  quizzes: [],
  photos: [],
  winners: [],
  highlights: [],
  faqs: [],
  archived: false,
  kretjes: 0,
}

function setDesktop() {
  window.innerWidth = 1024
  window.dispatchEvent(new Event('resize'))
}
function setMobile() {
  window.innerWidth = 375
  window.dispatchEvent(new Event('resize'))
}

async function goHome() {
  await waitFor(() => {
    expect(screen.getByText('MENSAPP')).toBeInTheDocument()
  })
}

async function openEventPage() {
  fireEvent.click(screen.getByText('Mensdag XL'))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument()
  })
}

async function openAdminFeaturesTab() {
  fireEvent.click(screen.getAllByRole('button', { name: /admin/i })[0])
  const featuresTab = await screen.findByRole('button', { name: /features/i })
  fireEvent.click(featuresTab)
}

// Both AdminPanel toggle pills render identical "🔓 Live" / "🔒 Locked" text
// (exact mirror of Sara Jay's own), so once Sara Jay is forced unlocked
// (see the top-level beforeEach) a plain getByText('🔓 Live') is ambiguous
// once mens-games is unlocked too -- and "Mens-Games" itself also appears
// on the (still-mounted-behind-the-modal) Home tile once unlocked. Scope to
// the AdminPanel's own overlay (Modal's ".ov" wrapper) and, within that, to
// the row carrying the "Mens-Games" label.
function mensGamesTogglePill() {
  const overlay = document.querySelector('.ov')
  const label = within(overlay).getByText('Mens-Games')
  const row = label.parentElement.parentElement
  return within(row).getByRole('button')
}

beforeEach(() => {
  localStorage.setItem('md-session', 'u-1')
  // Disambiguates the shared "🔒 ???" locked label from Sara Jay's own --
  // see file header.
  localStorage.setItem('md-sj-unlocked', 'true')
  setDesktop()
})

afterEach(() => {
  cleanup()
  mensGamesPageLoaded.mockClear()
  mensGamesTabLoaded.mockClear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('mens-games admin toggle -- locked (default)', () => {
  beforeEach(() => {
    vi.doMock('../supabase.js', async () => {
      const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
      return {
        supabase: makeSupabaseMock({
          users: { data: [ADMIN_USER], error: null },
          events: { data: [EVENT], error: null },
          // No `__mens_games__` system row at all -- a genuinely fresh
          // install (owner hasn't toggled it on yet anywhere).
          announcements: { data: [], error: null },
        }),
        hashPin: async () => 'mock-hash',
      }
    })
  })

  it('hides the Nav entry (desktop) and does not let it be opened -- with a recognisable locked label, not Sara Jay\'s "🔒 ???" mystery treatment', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    expect(screen.getByRole('button', { name: '🔒 Mens-Games' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '🏆 Mens-Games' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '🔒 Mens-Games' }))
    // Nothing navigated -- still on Home, mens-games chunk never touched.
    expect(screen.getByText('MENSAPP')).toBeInTheDocument()
    expect(mensGamesPageLoaded).not.toHaveBeenCalled()
  })

  it('hides the Nav entry in the mobile menu too, same recognisable label', async () => {
    setMobile()
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    fireEvent.click(screen.getByRole('button', { name: '☰' }))
    expect(screen.getByRole('button', { name: '🔒 Mens-Games' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '🏆 Mens-Games' })).not.toBeInTheDocument()
  })

  it('shows the Home tile as locked, still labelled "Mens-Games" (not a mystery box), and it is not clickable', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    expect(screen.getByText('Mens-Games')).toBeInTheDocument()
    expect(screen.getByText('Binnenkort beschikbaar... 👀')).toBeInTheDocument()
    expect(mensGamesPageLoaded).not.toHaveBeenCalled()
  })

  it('is distinguishable from Sara Jay\'s own "🔒 ???" mystery-box treatment when BOTH are locked', async () => {
    localStorage.setItem('md-sj-unlocked', 'false')
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    // Two distinct locked buttons, neither collapsing to the other's label.
    expect(screen.getByRole('button', { name: '🔒 Mens-Games' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🔒 ???' })).toBeInTheDocument()

    // Same distinction on the Home tiles: mens-games keeps its name, Sara
    // Jay stays a mystery box.
    expect(screen.getByText('Mens-Games')).toBeInTheDocument()
    expect(screen.getByText('???')).toBeInTheDocument()
    expect(screen.queryByText('Sara Jay or JAI')).not.toBeInTheDocument()
  })

  it('drops the "Mens-Games 🏆" tab from an event page entirely', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()
    await openEventPage()

    expect(screen.queryByRole('button', { name: 'Mens-Games 🏆' })).not.toBeInTheDocument()
    expect(mensGamesTabLoaded).not.toHaveBeenCalled()
  })

  it('the AdminPanel toggle shows Locked', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()
    await openAdminFeaturesTab()

    expect(mensGamesTogglePill()).toHaveTextContent('🔒 Locked')
  })
})

describe('mens-games admin toggle -- unlocked via the system row', () => {
  beforeEach(() => {
    vi.doMock('../supabase.js', async () => {
      const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
      return {
        supabase: makeSupabaseMock({
          users: { data: [ADMIN_USER], error: null },
          events: { data: [EVENT], error: null },
          announcements: {
            data: [
              {
                id: '__mens_games__',
                title: '__mens_games__',
                body: '',
                created_by: 'system',
                created_at: '2026-01-01T00:00:00Z',
                active: true,
              },
            ],
            error: null,
          },
        }),
        hashPin: async () => 'mock-hash',
      }
    })
  })

  it('shows the Nav entry (desktop) and opens the real route, whose lazy chunk actually loads', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    expect(screen.queryByRole('button', { name: '🔒 ???' })).not.toBeInTheDocument()
    const navBtn = screen.getByRole('button', { name: '🏆 Mens-Games' })
    fireEvent.click(navBtn)

    await waitFor(() => {
      expect(screen.getByTestId('mens-games-page-stub')).toBeInTheDocument()
    })
    expect(mensGamesPageLoaded).toHaveBeenCalled()
  })

  it('shows the Nav entry in the mobile menu too', async () => {
    setMobile()
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    fireEvent.click(screen.getByRole('button', { name: '☰' }))
    expect(screen.getByRole('button', { name: '🏆 Mens-Games' })).toBeInTheDocument()
  })

  it('shows the Home tile as unlocked and clickable', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    expect(screen.getByText('Mens-Games')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Mens-Games'))
    await waitFor(() => {
      expect(screen.getByTestId('mens-games-page-stub')).toBeInTheDocument()
    })
  })

  it('shows the "Mens-Games 🏆" tab on an event page, and it loads the real (mocked) tab component', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()
    await openEventPage()

    const tabBtn = screen.getByRole('button', { name: 'Mens-Games 🏆' })
    fireEvent.click(tabBtn)
    await waitFor(() => {
      expect(screen.getByTestId('mens-games-tab-stub')).toBeInTheDocument()
    })
    expect(mensGamesTabLoaded).toHaveBeenCalled()
  })

  it('the AdminPanel toggle shows Live', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()
    await openAdminFeaturesTab()

    expect(mensGamesTogglePill()).toHaveTextContent('🔓 Live')
  })

  it('never renders the system row `__mens_games__` as a real announcement banner', async () => {
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    expect(screen.queryByText('__mens_games__')).not.toBeInTheDocument()
  })
})

describe('mens-games admin toggle -- round-trips through localStorage and the system row', () => {
  it('root state is seeded from localStorage["md-mg-unlocked"] on mount, mirroring Sara Jay', async () => {
    localStorage.setItem('md-mg-unlocked', 'true')
    vi.doMock('../supabase.js', async () => {
      const { makeSupabaseMock } = await import('./mocks/supabaseMock.js')
      return {
        supabase: makeSupabaseMock({
          users: { data: [ADMIN_USER], error: null },
          events: { data: [], error: null },
          // No system row this time -- the localStorage-seeded value must
          // still be what's shown (boot only overwrites it if a row IS found).
          announcements: { data: [], error: null },
        }),
        hashPin: async () => 'mock-hash',
      }
    })
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()

    expect(screen.getByRole('button', { name: '🏆 Mens-Games' })).toBeInTheDocument()
  })

  it('toggling in AdminPanel flips localStorage and upserts the `__mens_games__` system row, both directions', async () => {
    const upsertSpy = vi.fn()
    vi.doMock('../supabase.js', makeSupabaseMockWithUpsertSpy(
      {
        users: { data: [ADMIN_USER], error: null },
        events: { data: [], error: null },
        announcements: { data: [], error: null },
      },
      upsertSpy,
    ))
    const { default: App } = await import('../App.jsx')
    render(<App />)
    await goHome()
    await openAdminFeaturesTab()

    expect(mensGamesTogglePill()).toHaveTextContent('🔒 Locked')
    fireEvent.click(mensGamesTogglePill())

    await waitFor(() => {
      expect(mensGamesTogglePill()).toHaveTextContent('🔓 Live')
    })
    expect(localStorage.getItem('md-mg-unlocked')).toBe('true')
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [table, row] = upsertSpy.mock.calls[0]
    expect(table).toBe('announcements')
    expect(row).toMatchObject({ id: '__mens_games__', title: '__mens_games__', active: true, created_by: 'system' })

    fireEvent.click(mensGamesTogglePill())
    await waitFor(() => {
      expect(mensGamesTogglePill()).toHaveTextContent('🔒 Locked')
    })
    expect(localStorage.getItem('md-mg-unlocked')).toBe('false')
    expect(upsertSpy).toHaveBeenCalledTimes(2)
    expect(upsertSpy.mock.calls[1][1]).toMatchObject({ id: '__mens_games__', active: false })
  })
})
