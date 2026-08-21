// Regression coverage: the mens-games scoreboard (docs/mensgames-spec.md §11
// risk 7, "readable across a room") clipped long team names to a single-line
// ellipsis on mobile -- "De Gouden Kroeg" rendered as "De Gouden …" -- on
// exactly the screen whose entire purpose is legibility at distance. Fixed
// by letting the compact (scoreboard) name wrap instead of truncating; the
// non-compact (tournament editor) path keeps its original single-line
// ellipsis, which wasn't reported as broken and is a much smaller UI.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StandingsTable from '../../features/mensgames/StandingsTable.jsx';
import ScoreboardPanel from '../../features/mensgames/ScoreboardPanel.jsx';

const LONG_NAME = 'De Gouden Kroegentocht Kampioenen';

const entrantsById = {
  ent_1: { id: 'ent_1', name: LONG_NAME, avatar: '🏆' },
};

function tournamentWith(rounds) {
  return {
    id: 'trn_1',
    name: 'Mens-Games 2026',
    entrants: [{ id: 'ent_1' }],
    rounds,
    settings: { showLivePreview: true },
  };
}

describe('StandingsTable compact (scoreboard) rows: long names wrap instead of truncating', () => {
  it('compact mode does not clip the name with a single-line ellipsis', () => {
    render(
      <StandingsTable
        tournament={tournamentWith([{ id: 'rnd_1', status: 'done', entrantIds: ['ent_1'], results: { ranking: [], points: { ent_1: 5 }, lockedAt: 'now' } }])}
        entrantsById={entrantsById}
        roundsCount={1}
        compact
      />,
    );
    const nameEl = screen.getByText(LONG_NAME);
    expect(nameEl.style.whiteSpace).not.toBe('nowrap');
    expect(nameEl.style.textOverflow).not.toBe('ellipsis');
    expect(nameEl.style.wordBreak).toBe('break-word');
  });

  it('non-compact mode (the tournament editor’s own standings list) is unchanged: still a single-line ellipsis', () => {
    render(
      <StandingsTable
        tournament={tournamentWith([{ id: 'rnd_1', status: 'done', entrantIds: ['ent_1'], results: { ranking: [], points: { ent_1: 5 }, lockedAt: 'now' } }])}
        entrantsById={entrantsById}
        roundsCount={1}
      />,
    );
    const nameEl = screen.getByText(LONG_NAME);
    expect(nameEl.style.whiteSpace).toBe('nowrap');
    expect(nameEl.style.textOverflow).toBe('ellipsis');
  });
});

describe('ScoreboardPanel: the live-round entrant name can also wrap rather than being squeezed against its Tag', () => {
  it('the live-round name span can shrink (minWidth 0) and wraps long text', () => {
    const tournament = tournamentWith([
      { id: 'rnd_1', status: 'live', name: 'Tafelvoetbal', icon: '⚽', entrantIds: ['ent_1'], matches: [] },
    ]);
    const { container } = render(<ScoreboardPanel tournament={tournament} entrantsById={entrantsById} onClose={() => {}} />);
    // The same entrant name also appears in the standings table rendered
    // below the live round -- scope to the live-round's own name span
    // (the only element actually carrying `.mg-scoreboard-name` directly)
    // rather than `screen.getByText`, which would match both.
    const nameEl = container.querySelector('span.mg-scoreboard-name');
    expect(nameEl).toHaveTextContent(LONG_NAME);
    expect(nameEl.style.minWidth).toBe('0px');
    expect(nameEl.style.wordBreak).toBe('break-word');
  });
});
