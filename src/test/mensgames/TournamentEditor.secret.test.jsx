// Component coverage for TournamentEditor.jsx's secret-tournament toggle
// (2026-08-24 -- "let me create a tournament but make it secret, same as
// other features"). Mocks api.js and finishTournament.js directly, same
// isolation level as TournamentEditor.debounce.test.jsx /
// TournamentEditor.errors.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../features/mensgames/api.js', () => ({
  saveTournament: vi.fn(async (t) => ({ ok: true, tournament: t })),
  deleteTournament: vi.fn(async () => ({ ok: true })),
  subscribeTournament: vi.fn(() => () => {}),
}));

const mockPublish = vi.fn(async () => ({ ok: true, winners: [], teamAwards: [], updatedTeamSets: [], errors: [] }));
vi.mock('../../features/mensgames/finishTournament.js', () => ({
  finishTournament: vi.fn(),
  publishTournamentResults: (...args) => mockPublish(...args),
}));

import { saveTournament } from '../../features/mensgames/api.js';
import TournamentEditor from '../../features/mensgames/TournamentEditor.jsx';
import { blankTournament } from '../../features/mensgames/model.js';

beforeEach(() => {
  saveTournament.mockClear();
  mockPublish.mockClear();
  mockPublish.mockResolvedValue({ ok: true, winners: [], teamAwards: [], updatedTeamSets: [], errors: [] });
});

function secretTournament(overrides = {}) {
  const t = blankTournament({ name: 'Geheim Toernooi', now: 1000 });
  t.settings = { ...t.settings, secret: true };
  return { ...t, ...overrides };
}

describe('TournamentEditor — secret tournaments (2026-08-24)', () => {
  it('shows a 🤫 Geheim tag and an "Onthullen" action for an editor', () => {
    render(<TournamentEditor tournament={secretTournament()} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);
    expect(screen.getByText('🤫 Geheim')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /onthullen/i })).toBeInTheDocument();
  });

  it('a non-secret tournament shows "Geheim maken" instead, and no tag', () => {
    render(<TournamentEditor tournament={blankTournament({ name: 'Open Toernooi', now: 1000 })} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);
    expect(screen.queryByText('🤫 Geheim')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /geheim maken/i })).toBeInTheDocument();
  });

  it('a non-editor never sees the secret toggle at all', () => {
    render(<TournamentEditor tournament={secretTournament()} events={[]} teamSets={[]} canManage={false} onBack={() => {}} onDeleted={() => {}} />);
    expect(screen.queryByRole('button', { name: /onthullen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /geheim maken/i })).not.toBeInTheDocument();
  });

  it('making a tournament secret saves immediately (structural, not debounced)', async () => {
    const user = userEvent.setup();
    render(<TournamentEditor tournament={blankTournament({ name: 'Open Toernooi', now: 1000 })} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    await user.click(screen.getByRole('button', { name: /geheim maken/i }));

    expect(saveTournament).toHaveBeenCalledTimes(1);
    expect(saveTournament.mock.calls[0][0].settings.secret).toBe(true);
    expect(screen.getByRole('button', { name: /onthullen/i })).toBeInTheDocument();
  });

  it('revealing offers to notify members, and sends it on Verstuur', async () => {
    const user = userEvent.setup();
    const onSendNotif = vi.fn();
    render(<TournamentEditor tournament={secretTournament({ name: 'Verrassingstoernooi' })} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} onSendNotif={onSendNotif} />);

    await user.click(screen.getByRole('button', { name: /onthullen/i }));

    expect(await screen.findByText(/leden inlichten over deze reveal/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verstuur' }));

    expect(onSendNotif).toHaveBeenCalledTimes(1);
    expect(onSendNotif.mock.calls[0][0].message).toMatch(/onthuld/i);
    expect(onSendNotif.mock.calls[0][0].message).toMatch(/Verrassingstoernooi/);
    expect(screen.queryByText(/leden inlichten over deze reveal/i)).not.toBeInTheDocument();
  });

  it('"Niet nu" dismisses the notify banner without calling onSendNotif', async () => {
    const user = userEvent.setup();
    const onSendNotif = vi.fn();
    render(<TournamentEditor tournament={secretTournament()} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} onSendNotif={onSendNotif} />);

    await user.click(screen.getByRole('button', { name: /onthullen/i }));
    await user.click(screen.getByRole('button', { name: 'Niet nu' }));

    expect(onSendNotif).not.toHaveBeenCalled();
    expect(screen.queryByText(/leden inlichten over deze reveal/i)).not.toBeInTheDocument();
  });

  it('revealing a secret tournament that already finished publishes its deferred results', async () => {
    const user = userEvent.setup();
    const t = secretTournament();
    t.status = 'finished';
    render(<TournamentEditor tournament={t} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    await user.click(screen.getByRole('button', { name: /onthullen/i }));

    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    const arg = mockPublish.mock.calls[0][0];
    expect(arg.tournament.settings.secret).toBe(false);
  });

  it('revealing a still-live secret tournament does NOT call publishTournamentResults -- nothing finished yet to publish', async () => {
    const user = userEvent.setup();
    render(<TournamentEditor tournament={secretTournament()} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    await user.click(screen.getByRole('button', { name: /onthullen/i }));

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('shows a retry action if the reveal-time publish fails, without flipping secrecy back on', async () => {
    const user = userEvent.setup();
    mockPublish.mockResolvedValueOnce({ ok: false, winners: [], teamAwards: [], updatedTeamSets: [], errors: [{ scope: 'event', error: 'boom' }] });
    const t = secretTournament();
    t.status = 'finished';
    render(<TournamentEditor tournament={t} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    await user.click(screen.getByRole('button', { name: /onthullen/i }));

    expect(await screen.findByText(/onthullen is gelukt, maar het publiceren/i)).toBeInTheDocument();
    // Secrecy itself is already off (the tournament row/settings really are
    // public now) -- only the publish half needs a retry.
    expect(screen.queryByText('🤫 Geheim')).not.toBeInTheDocument();
  });

  it('the finish modal warns that awards stay hidden while the tournament is still secret', async () => {
    const user = userEvent.setup();
    const t = secretTournament();
    t.status = 'live';
    t.entrants = [{ id: 'ent_1', kind: 'player', name: 'Solo', avatar: '🙂', memberNames: [], teamSetId: null, sourceTeamId: null }];
    t.rounds = [{ id: 'r1', name: 'R1', icon: '🎮', notes: '', entrantIds: ['ent_1'], teamSetId: null, scoring: { typeId: 'manual', config: {} }, format: 'freeform', matches: [], freeform: { entries: { ent_1: { points: 10 } } }, source: null, timer: { seconds: 60, perMatch: false }, award: { mode: 'placement', table: [3, 2, 1], perWin: 1, perDraw: 0, rawFactor: 1 }, status: 'done', results: null }];
    render(<TournamentEditor tournament={t} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    await user.click(screen.getByRole('button', { name: '🏁 Afronden' }));

    expect(await screen.findByText(/nog geheim.*awards worden pas zichtbaar/i)).toBeInTheDocument();
  });
});
