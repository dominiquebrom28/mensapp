// Coverage for the event-history view added to MensGamesShell.jsx
// (2026-08-26): the owner removed the event page's "Mens-Games 🏆" tab on
// the promise that "we can view its linked event-history from there"
// (i.e. from Mens-Games itself) -- this file proves that promise actually
// holds. Same isolation level as MensGamesShell.secret.test.jsx: mocks
// mensgames/api.js directly, not supabase.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockFetchTournaments = vi.fn();

vi.mock('../../features/mensgames/api.js', () => ({
  fetchTournaments: (...args) => mockFetchTournaments(...args),
  saveTournament: vi.fn(async (t) => ({ ok: true, tournament: t })),
  deleteTournament: vi.fn(async () => ({ ok: true })),
  subscribeTournament: vi.fn(() => () => {}),
  isMissingTableError: (error) => error?.code === 'PGRST205' || error?.code === '42P01',
}));

import MensGamesShell from '../../features/mensgames/MensGamesShell.jsx';

function trn(overrides = {}) {
  return {
    id: 'trn_1',
    name: 'Open Toernooi',
    eventId: null,
    status: 'live',
    entrants: [],
    rounds: [],
    settings: {},
    teamSetId: null,
    createdBy: '',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

// A finished tournament with one locked round, so `tournamentWinnerPlacement`
// (the exact function `WinnersTab`'s AUTO card already relies on) has
// something to derive a winner from.
function finishedTrn(overrides = {}) {
  return trn({
    status: 'finished',
    entrants: [
      { id: 'ent_a', kind: 'team', name: 'De Kraaien', avatar: '🦅', memberNames: ['Doom', 'Tim'] },
      { id: 'ent_b', kind: 'team', name: 'De Leeuwen', avatar: '🦁', memberNames: [] },
    ],
    rounds: [
      { id: 'rnd_1', status: 'done', results: { points: { ent_a: 10, ent_b: 6 }, ranking: [], lockedAt: '2026-01-01T00:00:00Z' } },
    ],
    ...overrides,
  });
}

const EVENTS = [
  { id: 'evt-1', name: 'Mensdag 2026' },
  { id: 'evt-2', name: 'Zomerfeest' },
];

beforeEach(() => {
  mockFetchTournaments.mockReset();
});

describe('MensGamesShell — event linkage on the list', () => {
  it('shows a 📅 event badge on a linked tournament and plain "Losstaand" text on a standalone one', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_linked', name: 'Bekertoernooi', eventId: 'evt-1' }),
        trn({ id: 'trn_solo', name: 'Vrijdagpoule', eventId: null }),
      ],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    expect(await screen.findByRole('button', { name: /bekijk geschiedenis van mensdag 2026/i })).toBeInTheDocument();
    // Scoped to a `<span>` -- the "Geschiedenis" `<select>` also renders a
    // "Losstaand" `<option>` once a standalone tournament exists, and both
    // legitimately share the exact same text.
    expect(screen.getByText('Losstaand', { selector: 'span' })).toBeInTheDocument();
  });

  it('a tournament linked to a since-deleted event says "Onbekend event", not "Losstaand" -- the link existed, only the name is gone', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [trn({ id: 'trn_ghost', name: 'Oud toernooi', eventId: 'evt-deleted' })],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    expect(await screen.findByRole('button', { name: /bekijk geschiedenis van onbekend event/i })).toBeInTheDocument();
    expect(screen.queryByText('Losstaand')).not.toBeInTheDocument();
  });

  it('an event-scoped mount never shows the badge or "Losstaand" text -- every row there is already the same event', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [trn({ id: 'trn_here', name: 'Hier', eventId: 'evt-1' })],
    });
    render(<MensGamesShell scope="event" evt={{ id: 'evt-1' }} events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    expect(await screen.findByText('Hier')).toBeInTheDocument();
    // Would be actively misleading here -- every row IS this event's, so
    // falling back to "standalone" text (the way `scope="page"` legitimately
    // does for a genuinely unlinked tournament) would claim the opposite of
    // the truth.
    expect(screen.queryByText('Losstaand', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bekijk geschiedenis/i })).not.toBeInTheDocument();
  });

  it('shows a winner line for a finished tournament, and none for a live one', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        finishedTrn({ id: 'trn_done', name: 'Afgeronde Cup' }),
        trn({ id: 'trn_live', name: 'Bezige Cup', status: 'live' }),
      ],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    expect(await screen.findByText(/🏆 de kraaien/i)).toBeInTheDocument();
    const liveRow = (await screen.findByText('Bezige Cup')).closest('.mg-card-hover');
    expect(within(liveRow).queryByText(/🏆 de kraaien/i)).not.toBeInTheDocument();
  });
});

describe('MensGamesShell — event-history filter', () => {
  it('clicking a row\'s event badge narrows the list to that event\'s tournaments only, with a removable active-filter chip', async () => {
    const user = userEvent.setup();
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_a', name: 'Bekertoernooi', eventId: 'evt-1' }),
        trn({ id: 'trn_b', name: 'Zomerpoule', eventId: 'evt-2' }),
        trn({ id: 'trn_c', name: 'Vrijgezel', eventId: null }),
      ],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await screen.findByText('Bekertoernooi');
    await user.click(screen.getByRole('button', { name: /bekijk geschiedenis van mensdag 2026/i }));

    expect(screen.getByText('Bekertoernooi')).toBeInTheDocument();
    expect(screen.queryByText('Zomerpoule')).not.toBeInTheDocument();
    expect(screen.queryByText('Vrijgezel')).not.toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: /✕ mensdag 2026/i });
    await user.click(clearBtn);
    expect(await screen.findByText('Zomerpoule')).toBeInTheDocument();
  });

  it('the "Geschiedenis" select filters to standalone tournaments too, and "Alle events" resets', async () => {
    const user = userEvent.setup();
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_a', name: 'Bekertoernooi', eventId: 'evt-1' }),
        trn({ id: 'trn_c', name: 'Vrijgezel', eventId: null }),
      ],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await screen.findByText('Bekertoernooi');
    const select = screen.getByLabelText('Geschiedenis');
    await user.selectOptions(select, 'Losstaand');
    expect(screen.getByText('Vrijgezel')).toBeInTheDocument();
    expect(screen.queryByText('Bekertoernooi')).not.toBeInTheDocument();

    await user.selectOptions(select, 'Alle events');
    expect(await screen.findByText('Bekertoernooi')).toBeInTheDocument();
    expect(screen.getByText('Vrijgezel')).toBeInTheDocument();
  });

  it('jumping into an event\'s history resets the status filter, so a "finished"-filtered view still shows that event\'s live/draft tournaments too', async () => {
    const user = userEvent.setup();
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        finishedTrn({ id: 'trn_done', name: 'Afgeronde Cup', eventId: 'evt-1' }),
        trn({ id: 'trn_live', name: 'Bezige Cup', eventId: 'evt-1', status: 'live' }),
        trn({ id: 'trn_other', name: 'Ander Event', eventId: 'evt-2' }),
      ],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await screen.findByText('Afgeronde Cup');
    await user.click(screen.getByRole('button', { name: 'Afgerond' })); // status subtab
    expect(screen.queryByText('Bezige Cup')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /bekijk geschiedenis van mensdag 2026/i })[0]);
    expect(screen.getByText('Afgeronde Cup')).toBeInTheDocument();
    expect(screen.getByText('Bezige Cup')).toBeInTheDocument();
    expect(screen.queryByText('Ander Event')).not.toBeInTheDocument();
  });

  it('no "Geschiedenis" filter is rendered at all when every tournament is standalone -- nothing meaningful to filter by', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [trn({ id: 'trn_a', name: 'Solo', eventId: null })],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await screen.findByText('Solo');
    expect(screen.queryByLabelText('Geschiedenis')).not.toBeInTheDocument();
  });
});

describe('MensGamesShell — a secret tournament never leaks through the event-history filter', () => {
  it('a non-editor never gets a filter option for an event whose only tournament is secret', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [trn({ id: 'trn_secret', name: 'Verrassing', eventId: 'evt-1', settings: { secret: true } })],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Bram' }} canManage={false} />);

    await waitFor(() => expect(screen.queryByText(/toernooien laden/i)).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Geschiedenis')).not.toBeInTheDocument();
    expect(screen.queryByText('Mensdag 2026')).not.toBeInTheDocument();
  });

  it('a non-editor filtering an event with both a public and a secret tournament sees only the public one -- name, badge and result all withheld for the secret one', async () => {
    const user = userEvent.setup();
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_public', name: 'Open Cup', eventId: 'evt-1' }),
        finishedTrn({ id: 'trn_secret', name: 'Geheime Cup', eventId: 'evt-1', settings: { secret: true } }),
      ],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Bram' }} canManage={false} />);

    await screen.findByText('Open Cup');
    const select = screen.getByLabelText('Geschiedenis');
    await user.selectOptions(select, 'Mensdag 2026');

    expect(screen.getByText('Open Cup')).toBeInTheDocument();
    expect(screen.queryByText('Geheime Cup')).not.toBeInTheDocument();
    // The secret tournament's own frozen winner ("De Kraaien") never
    // surfaces via this filtered view either -- not its result, per the
    // invariant this whole feature has already broken twice before.
    expect(screen.queryByText(/de kraaien/i)).not.toBeInTheDocument();
  });

  it('an editor sees the secret tournament in the same event-filtered view, still tagged 🤫 Geheim', async () => {
    const user = userEvent.setup();
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_public', name: 'Open Cup', eventId: 'evt-1' }),
        trn({ id: 'trn_secret', name: 'Geheime Cup', eventId: 'evt-1', settings: { secret: true } }),
      ],
    });
    render(<MensGamesShell scope="page" events={EVENTS} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await screen.findByText('Open Cup');
    const select = screen.getByLabelText('Geschiedenis');
    await user.selectOptions(select, 'Mensdag 2026');

    expect(screen.getByText('Geheime Cup')).toBeInTheDocument();
    expect(screen.getByText('🤫 Geheim')).toBeInTheDocument();
  });
});
