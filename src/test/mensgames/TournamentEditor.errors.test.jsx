// Regression coverage for two of the fix pass's findings:
//  - `doDelete` used to show `saveError`'s "Opslaan is mislukt" wording on
//    a failed *delete* -- a message about the wrong operation.
//  - EntrantPicker's team-set picker used to render "Nog geen teamsets in
//    de bibliotheek" even when the read had actually failed.
// Mocks mensgames/api.js directly, same isolation level as
// TournamentEditor.debounce.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../features/mensgames/api.js', () => ({
  saveTournament: vi.fn(async (t) => ({ ok: true, tournament: t })),
  deleteTournament: vi.fn(),
  subscribeTournament: vi.fn(() => () => {}),
}));

import { deleteTournament } from '../../features/mensgames/api.js';
import TournamentEditor from '../../features/mensgames/TournamentEditor.jsx';
import { blankTournament } from '../../features/mensgames/model.js';

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TournamentEditor doDelete error handling', () => {
  it('on a failed delete: shows its own message, not "Opslaan is mislukt"', async () => {
    const user = userEvent.setup();
    deleteTournament.mockResolvedValue({ ok: false, error: { message: 'boom' } });
    const onDeleted = vi.fn();
    const t = blankTournament({ name: 'Test Cup', now: 1000 });
    render(<TournamentEditor tournament={t} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={onDeleted} />);

    await user.click(screen.getByRole('button', { name: 'Verwijder' }));

    expect(await screen.findByText(/verwijderen is mislukt/i)).toBeInTheDocument();
    expect(screen.queryByText(/opslaan is mislukt/i)).not.toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('on a successful delete: calls onDeleted and shows no error', async () => {
    const user = userEvent.setup();
    deleteTournament.mockResolvedValue({ ok: true });
    const onDeleted = vi.fn();
    const t = blankTournament({ name: 'Test Cup', now: 1000 });
    render(<TournamentEditor tournament={t} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={onDeleted} />);

    await user.click(screen.getByRole('button', { name: 'Verwijder' }));

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/mislukt/i)).not.toBeInTheDocument();
  });
});

describe('TournamentEditor -> EntrantPicker teamSetsError wiring', () => {
  it('shows a real error, not "Nog geen teamsets", when the library read failed', async () => {
    const t = blankTournament({ name: 'Test Cup', now: 1000 });
    render(<TournamentEditor tournament={t} events={[]} teamSets={[]} teamSetsError="boom" canManage onBack={() => {}} onDeleted={() => {}} />);

    expect(screen.getByText(/kon de teams-bibliotheek niet laden/i)).toBeInTheDocument();
    expect(screen.queryByText(/nog geen teamsets in de bibliotheek/i)).not.toBeInTheDocument();
  });

  it('shows the genuinely-empty message when there is no error', async () => {
    const t = blankTournament({ name: 'Test Cup', now: 1000 });
    render(<TournamentEditor tournament={t} events={[]} teamSets={[]} canManage onBack={() => {}} onDeleted={() => {}} />);

    expect(screen.getByText(/nog geen teamsets in de bibliotheek/i)).toBeInTheDocument();
    expect(screen.queryByText(/kon de teams-bibliotheek niet laden/i)).not.toBeInTheDocument();
  });
});
