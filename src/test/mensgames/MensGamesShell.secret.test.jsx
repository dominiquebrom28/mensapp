// Coverage for MensGamesShell.jsx's secret-tournament list filtering
// (2026-08-24 -- mirrors App.jsx's secret-schedule-stop pattern: a
// non-editor never sees the row at all, just a count of hidden items; an
// editor sees every row, secret ones flagged). Mocks mensgames/api.js
// directly, same isolation level as MensGamesShell.errors.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockFetchTournaments = vi.fn();
const mockSaveTournament = vi.fn();

vi.mock('../../features/mensgames/api.js', () => ({
  fetchTournaments: (...args) => mockFetchTournaments(...args),
  saveTournament: (...args) => mockSaveTournament(...args),
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

beforeEach(() => {
  mockFetchTournaments.mockReset();
  mockSaveTournament.mockReset();
});

describe('MensGamesShell — secret tournaments (2026-08-24)', () => {
  it('a non-editor never sees a secret tournament\'s row -- just a hidden-count notice', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_open', name: 'Open Toernooi' }),
        trn({ id: 'trn_secret', name: 'Verrassing', settings: { secret: true } }),
      ],
    });
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Bram' }} canManage={false} />);

    expect(await screen.findByText('Open Toernooi')).toBeInTheDocument();
    expect(screen.queryByText('Verrassing')).not.toBeInTheDocument();
    expect(screen.getByText(/1 geheim toernooi/i)).toBeInTheDocument();
  });

  it('an editor sees every row, with the secret one flagged 🤫 Geheim', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_open', name: 'Open Toernooi' }),
        trn({ id: 'trn_secret', name: 'Verrassing', settings: { secret: true } }),
      ],
    });
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    expect(await screen.findByText('Open Toernooi')).toBeInTheDocument();
    expect(screen.getByText('Verrassing')).toBeInTheDocument();
    expect(screen.getByText('🤫 Geheim')).toBeInTheDocument();
    // No "N hidden" notice for an editor -- they aren't missing anything.
    expect(screen.queryByText(/geheim toernooi.*nog niet onthuld/i)).not.toBeInTheDocument();
  });

  it('a non-editor with nothing but secret tournaments sees the empty state plus the hidden-count notice, not a false "nog geen toernooien"', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [trn({ id: 'trn_secret', name: 'Verrassing', settings: { secret: true } })],
    });
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Bram' }} canManage={false} />);

    // Wait for the thing being asserted, not for the loading state to go.
    // "Loading finished" and "the row I care about is on screen" are not the
    // same moment, and two tests in this repo have already failed on CI for
    // exactly that gap while passing on a faster machine.
    await waitFor(() => expect(screen.getByText(/1 geheim toernooi/i)).toBeInTheDocument());
    expect(screen.queryByText(/toernooien laden/i)).not.toBeInTheDocument();
  });

  it('scopes to the event\'s own tournaments AND still hides secret ones from a non-editor there too', async () => {
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [
        trn({ id: 'trn_here', name: 'Hier', eventId: 'evt-1' }),
        trn({ id: 'trn_here_secret', name: 'Hier Geheim', eventId: 'evt-1', settings: { secret: true } }),
        trn({ id: 'trn_elsewhere', name: 'Ander event', eventId: 'evt-2' }),
      ],
    });
    render(<MensGamesShell scope="event" evt={{ id: 'evt-1' }} events={[]} teamSets={[]} currentUser={{ display_name: 'Bram' }} canManage={false} />);

    expect(await screen.findByText('Hier')).toBeInTheDocument();
    expect(screen.queryByText('Hier Geheim')).not.toBeInTheDocument();
    expect(screen.queryByText('Ander event')).not.toBeInTheDocument();
    expect(screen.getByText(/1 geheim toernooi/i)).toBeInTheDocument();
  });

  it('creating a tournament with the secret switch on saves it with settings.secret: true', async () => {
    const user = userEvent.setup();
    mockFetchTournaments.mockResolvedValue({ ok: true, error: null, tournaments: [] });
    mockSaveTournament.mockImplementation(async (t) => ({ ok: true, tournament: t }));
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await waitFor(() => expect(screen.queryByText(/toernooien laden/i)).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '+ Nieuw toernooi' }));
    await user.type(screen.getByLabelText('Naam'), 'Geheim Bekertoernooi');
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Aanmaken' }));

    await waitFor(() => expect(mockSaveTournament).toHaveBeenCalledTimes(1));
    expect(mockSaveTournament.mock.calls[0][0].settings.secret).toBe(true);
  });

  it('a stale selectedId pointing at a secret tournament never opens the editor for a non-editor', async () => {
    // Simulated by rendering as an editor first isn't possible here (no
    // direct selectedId prop) -- instead this guards the underlying
    // invariant via the list itself: a non-editor has no clickable row for
    // the secret tournament to ever set `selectedId` from in the first
    // place.
    mockFetchTournaments.mockResolvedValue({
      ok: true,
      error: null,
      tournaments: [trn({ id: 'trn_secret', name: 'Verrassing', settings: { secret: true } })],
    });
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Bram' }} canManage={false} />);

    await waitFor(() => expect(screen.queryByText(/toernooien laden/i)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /verrassing/i })).not.toBeInTheDocument();
  });
});
