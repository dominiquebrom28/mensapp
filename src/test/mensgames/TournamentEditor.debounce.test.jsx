// Component test for src/features/mensgames/TournamentEditor.jsx's
// autosave debounce (docs/mensgames-spec.md §5 WP-E: "Writes debounced
// 400ms so a stepper click doesn't fire six upserts"). Mocks api.js
// directly (not supabase) since TournamentEditor only ever talks to
// tournaments through that module.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../features/mensgames/api.js', () => ({
  saveTournament: vi.fn(async (t) => ({ ok: true, tournament: t })),
  deleteTournament: vi.fn(async () => ({ ok: true })),
  subscribeTournament: vi.fn(() => () => {}),
}));

import { saveTournament } from '../../features/mensgames/api.js';
import TournamentEditor from '../../features/mensgames/TournamentEditor.jsx';
import { blankMatch, blankRound, blankTournament } from '../../features/mensgames/model.js';

function buildTournament() {
  const t = blankTournament({ name: 'Test Cup', now: 1000 });
  t.status = 'live';
  t.entrants = [
    { id: 'ent_a', kind: 'team', name: 'Team A', avatar: '🦁', memberNames: [], teamSetId: null, sourceTeamId: null },
    { id: 'ent_b', kind: 'team', name: 'Team B', avatar: '🐻', memberNames: [], teamSetId: null, sourceTeamId: null },
  ];
  const round = blankRound({ name: 'Ronde 1', scoringTypeId: 'best-of', format: 'matches', now: 1001 });
  round.scoring.config = { sets: 15 };
  round.entrantIds = ['ent_a', 'ent_b'];
  round.matches = [blankMatch('ent_a', 'ent_b', { id: 'mt_1' })];
  round.status = 'live';
  t.rounds = [round];
  return t;
}

describe('TournamentEditor autosave debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('six rapid stepper taps produce exactly one saveTournament call, 400ms after the last tap', async () => {
    const tournament = buildTournament();
    render(<TournamentEditor tournament={tournament} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    // Expand the round to reach the match's score stepper.
    fireEvent.click(screen.getByText('Ronde 1').closest('button'));

    const incButtons = screen.getAllByRole('button', { name: /sets verhogen/i });
    expect(incButtons.length).toBeGreaterThan(0);
    const incA = incButtons[0];

    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(incA);
    }

    // Not yet -- still inside the debounce window.
    expect(saveTournament).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(saveTournament).toHaveBeenCalledTimes(1);
    const saved = saveTournament.mock.calls[0][0];
    expect(saved.rounds[0].matches[0].entry.a.sets).toBe(6);
  });

  it('a structural action (locking a round) flushes immediately rather than waiting for the debounce', async () => {
    const tournament = buildTournament();
    render(<TournamentEditor tournament={tournament} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);
    fireEvent.click(screen.getByText('Ronde 1').closest('button'));

    fireEvent.click(screen.getByRole('button', { name: /vergrendel ronde/i }));

    // No `advanceTimersByTime` needed -- an immediate write already fired.
    expect(saveTournament).toHaveBeenCalledTimes(1);
    expect(saveTournament.mock.calls[0][0].rounds[0].status).toBe('done');
  });

  it('opening a still-pending round marks it live immediately, so the scoreboard has something to show', async () => {
    const tournament = buildTournament();
    tournament.rounds[0].status = 'pending';
    render(<TournamentEditor tournament={tournament} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    fireEvent.click(screen.getByText('Ronde 1').closest('button'));

    expect(saveTournament).toHaveBeenCalledTimes(1);
    expect(saveTournament.mock.calls[0][0].rounds[0].status).toBe('live');
  });
});
