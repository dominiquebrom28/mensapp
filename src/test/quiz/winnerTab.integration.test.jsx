// The Winner-tab brief (2026-08-26): "I want the winner to show up there
// automatically BUT also be able to manually edit or select a winner per
// quiz […] The winner shown/selected here will show up in the event's
// winners & highlights." One resolver (`resolveQuizWinner`, `model.js`)
// feeds the builder's own preview, `WinnersTab` and `finishQuiz.js` --
// the risk named in the brief is exactly the one a unit test cannot catch:
// a read/write that fails without erroring, so the tab shows one winner and
// the event page shows another. This is the end-to-end check, in the
// pattern `hallOfFame.integration.test.jsx` / `quizStandalone.integration.
// test.jsx` set: full `<App/>`, mocked Supabase, real Nav/tab clicks,
// assert what renders.
//
// The quiz fixture below is deliberately LEGACY-ONLY -- present in
// `evt.quizzes[]` but with NO matching row in the mocked `quizzes` table --
// covering "an override on a legacy-only quiz" from the brief's list: the
// override must still reach `WinnersTab` purely through the dual-write
// object the builder already holds, with no `quizzes`-table round trip.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const QUIZ = {
  id: 'qz-override-1', title: 'Override Pubquiz', status: 'finished',
  rounds: [{ id: 'r0', title: 'Round 1', theme: '', icon: '🎯', description: '', bgImage: null, secret: false, questions: [] }],
  defaultTime: 30, introText: '', introBg: '', teamSetId: null,
  teams: [
    { id: 'tm_1', name: 'Team Alfa', avatar: '🦅', members: ['Doom'] },
    { id: 'tm_2', name: 'Team Bravo', avatar: '🐺', members: ['Bram'] },
  ],
  // Team Alfa is the natural top scorer -- the override below picks Team
  // Bravo instead, the brief's "select one of the teams selected at the
  // start" path.
  scores: { 'Team Alfa': 50, 'Team Bravo': 20 },
  memberScores: { Doom: 50, Bram: 20 },
  settings: {},
}

// A second, separate quiz: finished, but with NO scores recorded at all
// (the brief's "override on a quiz with no scores at all") -- covered here
// purely as a render assertion off the fixture, no builder interaction
// needed since `resolveQuizWinner`'s manual-mode path is already
// unit-tested against exactly this input in model.test.js.
const NO_SCORE_QUIZ = {
  id: 'qz-no-score', title: 'Verpeste Quiz', status: 'finished', teams: [], scores: {}, memberScores: {}, rounds: [],
  settings: { winner: { mode: 'manual', name: 'Sven', detail: 'Enige die nog nuchter was' } },
}

vi.mock('../../supabase.js', async () => {
  const { makeSupabaseMock } = await import('../mocks/supabaseMock.js')
  return {
    supabase: makeSupabaseMock({
      users: {
        data: [
          { id: 'u-1', username: 'Doom', display_name: 'Doom', role: 'admin+org', pin_hash: 'x', joined_at: '2023-01-01', avatar: 0 },
          { id: 'u-2', username: 'Bram', display_name: 'Bram', role: 'lad', pin_hash: 'x', joined_at: '2023-01-01', avatar: 1 },
        ],
        error: null,
      },
      events: {
        data: [
          {
            id: 'evt-1', name: 'Mensdag 2025', type: 'day', date: '2025-06-01', end_date: '', start_time: '12:00', end_time: '',
            location: 'TBD', description: '', theme: '', trailer_video_url: '', teaser_active: false, teaser_title: '', teaser_text: '', teaser_button_label: '',
            archived: true, kretjes: 0,
            attendees: [{ name: 'Doom', status: 'went' }, { name: 'Bram', status: 'went' }],
            schedule: [], polls: [], photos: [], highlights: [], faqs: [],
            quizzes: [QUIZ, NO_SCORE_QUIZ],
            winners: [],
          },
        ],
        error: null,
      },
      // Legacy-only: no row for either quiz id in the `quizzes` table.
      quizzes: { data: [], error: null },
      quiz_live: { data: [], error: null },
      announcements: { data: [], error: null },
      team_sets: { data: [], error: null },
    }),
    hashPin: async () => 'mock-hash',
  }
})

const { default: App } = await import('../../App.jsx')

async function openQuizBuilder(user) {
  await user.click(screen.getByRole('button', { name: /tools menu/i }))
  await user.click(await screen.findByRole('button', { name: /🧠 quiz/i }))
  await waitFor(() => expect(screen.getByRole('heading', { name: '🧠 Quiz' })).toBeInTheDocument())
  await user.click(await screen.findByText('Override Pubquiz'))
  // Lands straight in the builder's edit panel (`initialQuizId`) -- assert
  // it actually opened before driving tabs inside it.
  await screen.findByText('🏆 Winner')
}

async function goToWinnersTab(user) {
  // "← Terug" only renders once away from Home -- absent on the very first
  // call, present after the builder round trip below.
  const back = screen.queryByRole('button', { name: /terug/i })
  if (back) await user.click(back)
  await waitFor(() => expect(screen.getByText('Mensdag 2025')).toBeInTheDocument())
  await user.click(screen.getByText('Mensdag 2025'))
  await user.click(await screen.findByText('Winners & Highlights'))
  return screen.getByRole('heading', { name: /awards & winners/i }).closest('div').parentElement
}

describe('the Winner tab, end to end', () => {
  beforeEach(() => {
    localStorage.setItem('md-session', 'u-1')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('a team override picked in the builder is what actually renders on the event Winners & Highlights, and Automatisch cleanly discards it again', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /tools menu/i })).toBeInTheDocument())

    // Sanity: before any override, the OTHER quiz's no-score manual override
    // already renders -- proves the "no scores at all" path independently
    // of the flow this test drives.
    let section = await goToWinnersTab(user)
    expect(within(section).getByText('Sven')).toBeInTheDocument()
    expect(within(section).getByText('🧠 Verpeste Quiz')).toBeInTheDocument()
    // And, before any override, Override Pubquiz shows its natural top
    // scorer, Team Alfa.
    expect(within(section).getByText('Team Alfa')).toBeInTheDocument()
    expect(within(section).queryByText('Team Bravo')).not.toBeInTheDocument()

    // ── Drive the builder: Winner tab -> Kies een team -> Team Bravo ────
    await openQuizBuilder(user)
    await user.click(screen.getByText('🏆 Winner'))
    await user.click(screen.getByRole('radio', { name: /kies een team/i }))
    // The preview card inside the builder already shows Team Bravo before
    // any save -- the brief's whole point ("should not have to save, leave,
    // and navigate to an event to find out").
    await user.click(screen.getByRole('radio', { name: /team bravo/i }))
    await screen.findByText('Voorbeeld op Winnaars & Hoogtepunten')
    const previewHeading = screen.getByText('Voorbeeld op Winnaars & Hoogtepunten').parentElement
    expect(within(previewHeading).getByText('Team Bravo')).toBeInTheDocument()
    await user.click(screen.getByText('Save Changes'))

    // ── The event's Winners & Highlights now shows the override, not the
    //    natural top scorer -- the legacy-only quiz's `settings.winner`
    //    survived purely through the evt.quizzes[] dual-write object. ────
    await user.click(screen.getByText('✕ Close'))
    section = await goToWinnersTab(user)
    await waitFor(() => expect(within(section).getByText('Team Bravo')).toBeInTheDocument())
    expect(within(section).queryByText('Team Alfa')).not.toBeInTheDocument()

    // ── Reopening the builder shows the override still selected (round
    //    trip through the saved event, not just component state). ────
    await openQuizBuilder(user)
    await user.click(screen.getByText('🏆 Winner'))
    expect(screen.getByRole('radio', { name: /kies een team/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /team bravo/i })).toBeChecked()

    // ── Switching back to Automatisch discards the override cleanly -- the
    //    natural top scorer (Team Alfa) reappears, not a stale Team Bravo
    //    nor a blank/broken card. ────
    await user.click(screen.getByRole('radio', { name: /^automatisch$/i }))
    await user.click(screen.getByText('Save Changes'))
    await user.click(screen.getByText('✕ Close'))
    section = await goToWinnersTab(user)
    await waitFor(() => expect(within(section).getByText('Team Alfa')).toBeInTheDocument())
    expect(within(section).queryByText('Team Bravo')).not.toBeInTheDocument()
  })
})
