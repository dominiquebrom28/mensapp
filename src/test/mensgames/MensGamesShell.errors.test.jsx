// Regression coverage for the "mens-games error messages are misattributed"
// fix pass: `createTournament` used to reuse the list-load `error` flag on
// a failed *create*, closing the modal (losing the typed name) and showing
// a message about the wrong operation. Mocks mensgames/api.js directly
// (not supabase), same isolation level as TournamentEditor.debounce.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockFetchTournaments = vi.fn();
const mockSaveTournament = vi.fn();

// `isMissingTableError` is real logic (mirrored from api.js, not imported --
// this file deliberately mocks api.js wholesale to stay isolated from
// supabase.js), used by MensGamesShell.jsx's own error classification below.
vi.mock('../../features/mensgames/api.js', () => ({
  fetchTournaments: (...args) => mockFetchTournaments(...args),
  saveTournament: (...args) => mockSaveTournament(...args),
  deleteTournament: vi.fn(async () => ({ ok: true })),
  subscribeTournament: vi.fn(() => () => {}),
  isMissingTableError: (error) => error?.code === 'PGRST205' || error?.code === '42P01',
}));

import MensGamesShell from '../../features/mensgames/MensGamesShell.jsx';

beforeEach(() => {
  mockFetchTournaments.mockReset();
  mockSaveTournament.mockReset();
  mockFetchTournaments.mockResolvedValue({ ok: true, error: null, tournaments: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openNewTournamentModal(user) {
  await waitFor(() => expect(screen.queryByText(/toernooien laden/i)).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: '+ Nieuw toernooi' }));
  await user.type(screen.getByLabelText('Naam'), 'Mens-Games 2026');
}

describe('MensGamesShell createTournament error handling', () => {
  it('on a failed create: keeps the modal open (with the typed name) and shows its own error, not the list-load one', async () => {
    const user = userEvent.setup();
    mockSaveTournament.mockResolvedValue({ ok: false, error: { message: 'boom' } });
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await openNewTournamentModal(user);
    await user.click(screen.getByRole('button', { name: 'Aanmaken' }));

    // The modal is still open, the typed name is still there.
    expect(screen.getByLabelText('Naam')).toHaveValue('Mens-Games 2026');
    // Its own error message, not the list-load "Kon de toernooien niet laden".
    expect(await screen.findByText(/aanmaken van het toernooi is mislukt/i)).toBeInTheDocument();
    expect(screen.queryByText(/kon de toernooien niet laden/i)).not.toBeInTheDocument();
  });

  it('on a successful create: closes the modal and opens the new tournament', async () => {
    const user = userEvent.setup();
    mockSaveTournament.mockImplementation(async (t) => ({ ok: true, tournament: t }));
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    await openNewTournamentModal(user);
    await user.click(screen.getByRole('button', { name: 'Aanmaken' }));

    await waitFor(() => expect(screen.queryByLabelText('Naam')).not.toBeInTheDocument());
    expect(await screen.findByText('← Terug')).toBeInTheDocument();
  });

  it('disables "+ Nieuw toernooi" while the tournament list itself failed to load, rather than inviting a retry against a backend already known to be down', async () => {
    mockFetchTournaments.mockResolvedValue({ ok: false, error: { message: 'boom' }, tournaments: [] });
    render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

    expect(await screen.findByText(/kon de toernooien niet laden/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Nieuw toernooi' })).toBeDisabled();
  });

  // REGRESSION (owner-reported, 2026-08-21g): against the real backend the
  // list-load failure was a missing migration (PostgREST's PGRST205,
  // "Could not find the table 'public.tournaments' in the schema cache"),
  // not a network problem -- but the UI said "Controleer je verbinding",
  // sending the owner looking for the wrong cause entirely.
  describe('list-load error message matches the actual failure', () => {
    it('a PGRST205 (missing table) error gets its own true, actionable message -- not the generic connectivity one', async () => {
      mockFetchTournaments.mockResolvedValue({ ok: false, error: { code: 'PGRST205', message: "Could not find the table 'public.tournaments' in the schema cache" }, tournaments: [] });
      render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

      expect(await screen.findByText(/tabellen ontbreken/i)).toBeInTheDocument();
      expect(screen.getByText(/geen verbindingsprobleem/i)).toBeInTheDocument();
      expect(screen.queryByText(/controleer je verbinding/i)).not.toBeInTheDocument();
      // Never dumps the raw Supabase error text into the DOM.
      expect(screen.queryByText(/schema cache/i)).not.toBeInTheDocument();
    });

    it('a Postgres 42P01 (undefined_table) error is treated the same as PGRST205', async () => {
      mockFetchTournaments.mockResolvedValue({ ok: false, error: { code: '42P01', message: 'relation "tournaments" does not exist' }, tournaments: [] });
      render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

      expect(await screen.findByText(/tabellen ontbreken/i)).toBeInTheDocument();
    });

    it('a genuine connectivity failure keeps the original "check your connection" message', async () => {
      mockFetchTournaments.mockResolvedValue({ ok: false, error: { message: 'Failed to fetch' }, tournaments: [] });
      render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);

      expect(await screen.findByText(/kon de toernooien niet laden.*controleer je verbinding/i)).toBeInTheDocument();
      expect(screen.queryByText(/tabellen ontbreken/i)).not.toBeInTheDocument();
    });

    it('retrying a missing-table error re-fetches, same as the network error path', async () => {
      const user = userEvent.setup();
      mockFetchTournaments.mockResolvedValueOnce({ ok: false, error: { code: 'PGRST205' }, tournaments: [] });
      render(<MensGamesShell scope="page" events={[]} teamSets={[]} currentUser={{ display_name: 'Doom' }} canManage />);
      await screen.findByText(/tabellen ontbreken/i);

      mockFetchTournaments.mockResolvedValueOnce({ ok: true, error: null, tournaments: [] });
      await user.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));

      await waitFor(() => expect(screen.queryByText(/tabellen ontbreken/i)).not.toBeInTheDocument());
      expect(mockFetchTournaments).toHaveBeenCalledTimes(2);
    });
  });
});
