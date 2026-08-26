// src/features/quiz/TeamSetPicker.jsx -- the legacy-team-import flow (owner
// brief, 2026-08-26). See that file's own header for the full design; these
// tests cover the UI/write-path half `legacyTeamsImport.test.js` (pure
// model.js logic) doesn't: the explicit-action gate, the match-vs-create
// branch, the ready-vs-live/finished rewrite boundary, and a failed write
// surfacing a visible retry rather than a silent no-op.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const saveTeamSet = vi.fn();
vi.mock('../../features/teamlib/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveTeamSet: (...args) => saveTeamSet(...args),
}));

const { TeamSetPicker } = await import('../../features/quiz/TeamSetPicker.jsx');

const LEGACY_TEAMS = [
  { id: 'legacy-a', name: 'De Kraaien', avatar: '🦅', members: ['Doom', 'Tim'], captain: 'Doom' },
  { id: 'legacy-b', name: 'De Wolven', avatar: '🐺', members: ['Bram'] },
];

beforeEach(() => {
  saveTeamSet.mockReset();
});

describe('TeamSetPicker -- legacy team import', () => {
  it('shows the import callout only for teams with no teamSetId, never for an already-linked quiz', () => {
    const { rerender } = render(
      <TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={() => {}} teamSets={[]} title="Editie 7" />
    );
    expect(screen.getByText(/nog niet in de bibliotheek/i)).toBeInTheDocument();

    rerender(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId="ts_1" onChange={() => {}} teamSets={[]} title="Editie 7" />);
    expect(screen.queryByText(/nog niet in de bibliotheek/i)).toBeNull();
  });

  it('does not offer an import for an individual (teamless) quiz', () => {
    render(<TeamSetPicker teams={[]} teamSetId={null} onChange={() => {}} teamSets={[]} />);
    expect(screen.queryByText(/nog niet in de bibliotheek/i)).toBeNull();
  });

  it('never writes anything on mount/open -- the callout is inert until clicked', () => {
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={() => {}} teamSets={[]} title="Editie 7" />);
    expect(saveTeamSet).not.toHaveBeenCalled();
    expect(screen.queryByText(/wordt aangemaakt/i)).toBeNull();
  });

  it('ready quiz, no existing match: creates a new set and re-snapshots teams+teamSetId from it', async () => {
    saveTeamSet.mockResolvedValue({
      ok: true, error: null,
      teamSet: { id: 'ts_new', name: 'Editie 7 — Teams', category: '', status: 'active', teams: LEGACY_TEAMS.map((t) => ({ ...t, id: `tm_${t.name}` })), eventIds: [], awards: [], createdBy: '', createdAt: '', archivedAt: null },
    });
    const onChange = vi.fn();
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={onChange} teamSets={[]} title="Editie 7" status="ready" />);

    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    expect(screen.getByText(/wordt aangemaakt/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Aanmaken en koppelen'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(saveTeamSet).toHaveBeenCalledTimes(1);
    const savedDraft = saveTeamSet.mock.calls[0][0];
    expect(savedDraft.name).toBe('Editie 7 — Teams');
    expect(savedDraft.teams.map((t) => t.name)).toEqual(['De Kraaien', 'De Wolven']);

    const arg = onChange.mock.calls[0][0];
    expect(arg.teamSetId).toBe('ts_new');
    // Re-snapshotted (ready quiz) -- new ids, real provenance, not the stale
    // legacy ids that had no library meaning.
    expect(arg.teams[0].sourceTeamId).toBe('tm_De Kraaien');
    expect(arg.teams[0].teamSetId).toBe('ts_new');
  });

  it('live/finished quiz: links teamSetId but leaves `teams` byte-for-byte -- the archive is never rewritten', async () => {
    saveTeamSet.mockResolvedValue({
      ok: true, error: null,
      teamSet: { id: 'ts_new', name: 'Editie 7 — Teams', status: 'active', teams: [], eventIds: [], awards: [], createdBy: '', createdAt: '', archivedAt: null },
    });
    const onChange = vi.fn();
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={onChange} teamSets={[]} title="Editie 7" status="finished" />);

    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    fireEvent.click(screen.getByText('Aanmaken en koppelen'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const arg = onChange.mock.calls[0][0];
    expect(arg.teamSetId).toBe('ts_new');
    // Exactly the same array reference the quiz already had -- proof nothing
    // about the finished quiz's own team records (ids the archive's own
    // score/override keys could depend on) was touched.
    expect(arg.teams).toBe(LEGACY_TEAMS);
  });

  it('an identical roster already in the library is offered as a link, with no write at all', () => {
    const existingSet = {
      id: 'ts_existing', name: 'Kroeg Teams', status: 'active',
      teams: [
        { id: 'tm_a', name: 'De Kraaien', members: ['Doom', 'Tim'] },
        { id: 'tm_b', name: 'De Wolven', members: ['Bram'] },
      ],
    };
    const onChange = vi.fn();
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={onChange} teamSets={[existingSet]} title="Editie 7" status="ready" />);

    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    expect(screen.getByText(/bestaat al een teamset met precies deze teams/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Koppel aan.*Kroeg Teams/ }));

    expect(saveTeamSet).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].teamSetId).toBe('ts_existing');
  });

  it('"toch een nieuwe set maken" overrides a found match and creates one anyway', async () => {
    const existingSet = {
      id: 'ts_existing', name: 'Kroeg Teams', status: 'active',
      teams: [
        { id: 'tm_a', name: 'De Kraaien', members: ['Doom', 'Tim'] },
        { id: 'tm_b', name: 'De Wolven', members: ['Bram'] },
      ],
    };
    saveTeamSet.mockResolvedValue({ ok: true, error: null, teamSet: { id: 'ts_new', name: 'X', status: 'active', teams: [], eventIds: [], awards: [] } });
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={() => {}} teamSets={[existingSet]} title="Editie 7" status="ready" />);

    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    fireEvent.click(screen.getByText('Toch een nieuwe set maken'));
    expect(screen.getByText(/wordt aangemaakt/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Aanmaken en koppelen'));
    await waitFor(() => expect(saveTeamSet).toHaveBeenCalledTimes(1));
  });

  it('duplicate names within the legacy quiz itself are auto-renamed for the library copy, with a visible notice -- never silently, never blocked', () => {
    const dupTeams = [
      { id: 'tm1000', name: 'Team Gamma', members: [] },
      { id: 'tm2000', name: 'team gamma', members: ['Bram'] },
    ];
    render(<TeamSetPicker teams={dupTeams} teamSetId={null} onChange={() => {}} teamSets={[]} title="Editie 7" status="ready" />);
    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent(/hernoemd in de bibliotheek/i);
    expect(notice).toHaveTextContent(/team gamma/i);
    expect(notice).toHaveTextContent(/Team Gamma \(2\)/);
    // And the button to actually do it is still there -- not blocked.
    expect(screen.getByText('Aanmaken en koppelen')).toBeInTheDocument();
  });

  it('a failed library write surfaces a visible retry and never touches the quiz', async () => {
    saveTeamSet.mockResolvedValueOnce({ ok: false, error: { message: 'network down' } });
    const onChange = vi.fn();
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={onChange} teamSets={[]} title="Editie 7" status="ready" />);

    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    fireEvent.click(screen.getByText('Aanmaken en koppelen'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/mislukt/i));
    expect(screen.getByRole('alert')).toHaveTextContent(/network down/);
    expect(onChange).not.toHaveBeenCalled();

    // Retry, this time it succeeds -- reuses the exact same draft (no
    // regenerated id/name on the second attempt).
    saveTeamSet.mockResolvedValueOnce({ ok: true, error: null, teamSet: { id: 'ts_retry', name: 'Editie 7 — Teams', status: 'active', teams: [], eventIds: [], awards: [] } });
    fireEvent.click(screen.getByText('Probeer opnieuw'));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(saveTeamSet).toHaveBeenCalledTimes(2);
    expect(saveTeamSet.mock.calls[0][0].id).toBe(saveTeamSet.mock.calls[1][0].id);
    expect(onChange.mock.calls[0][0].teamSetId).toBe('ts_retry');
  });

  it('"Annuleren" closes the panel without writing or changing anything', () => {
    const onChange = vi.fn();
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={onChange} teamSets={[]} title="Editie 7" />);
    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    fireEvent.click(screen.getByText('Annuleren'));
    expect(screen.queryByText(/wordt aangemaakt/i)).toBeNull();
    expect(screen.getByText('Voeg toe aan de bibliotheek')).toBeInTheDocument();
    expect(saveTeamSet).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('surfaces a degraded-matching warning when the team-sets library failed to load, instead of silently assuming "no match"', () => {
    render(<TeamSetPicker teams={LEGACY_TEAMS} teamSetId={null} onChange={() => {}} teamSets={[]} teamSetsError={{ message: 'boom' }} title="Editie 7" />);
    fireEvent.click(screen.getByText('Voeg toe aan de bibliotheek'));
    expect(screen.getByText(/konden niet controleren of deze teams daar al bestaan/i)).toBeInTheDocument();
  });
});
