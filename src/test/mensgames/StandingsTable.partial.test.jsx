// Component tests for src/features/mensgames/StandingsTable.jsx --
// docs/mensgames-spec.md §4.2: "entrants who played some rounds and not
// others" must still show up, honestly, rather than being dropped from the
// table or silently defaulted somewhere that hides the gap.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StandingsTable from '../../features/mensgames/StandingsTable.jsx';

const entrantsById = {
  ent_1: { id: 'ent_1', name: 'De Kraaien', avatar: '🦅' },
  ent_2: { id: 'ent_2', name: 'De Adelaars', avatar: '🦉' },
  ent_3: { id: 'ent_3', name: 'De Wolven', avatar: '🐺' },
};

function tournamentWith(rounds, entrantIds = ['ent_1', 'ent_2', 'ent_3']) {
  return {
    id: 'trn_1',
    entrants: entrantIds.map((id) => ({ id })),
    rounds,
    settings: { showLivePreview: true },
  };
}

describe('StandingsTable', () => {
  it('shows an entrant who only played one of two locked rounds, with their real points and rounds-played count', () => {
    const rounds = [
      {
        id: 'rnd_1', status: 'done', entrantIds: ['ent_1', 'ent_2', 'ent_3'],
        results: {
          ranking: [
            { entrantId: 'ent_1', rank: 1, value: 10, label: '' },
            { entrantId: 'ent_2', rank: 2, value: 6, label: '' },
            { entrantId: 'ent_3', rank: 3, value: 3, label: '' },
          ],
          points: { ent_1: 10, ent_2: 6, ent_3: 3 }, lockedAt: 'now',
        },
      },
      {
        id: 'rnd_2', status: 'done', entrantIds: ['ent_1', 'ent_2'], // ent_3 didn't play this one
        results: {
          ranking: [
            { entrantId: 'ent_1', rank: 1, value: 10, label: '' },
            { entrantId: 'ent_2', rank: 2, value: 6, label: '' },
          ],
          points: { ent_1: 10, ent_2: 6 }, lockedAt: 'now',
        },
      },
    ];
    render(<StandingsTable tournament={tournamentWith(rounds)} entrantsById={entrantsById} roundsCount={2} />);

    expect(screen.getByText('De Kraaien')).toBeInTheDocument();
    expect(screen.getByText('De Wolven')).toBeInTheDocument();
    // ent_3 only contributed to one round -- 1/2, not silently 2/2 or absent.
    expect(screen.getByText((_, node) => node.tagName === 'DIV' && node.textContent === '1/2 ronde gespeeld')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument(); // ent_1: 10+10
    expect(screen.getByText('3')).toBeInTheDocument(); // ent_3: 3+0
  });

  it('shows the empty state when the tournament has no entrants at all', () => {
    render(<StandingsTable tournament={tournamentWith([], [])} entrantsById={{}} roundsCount={0} />);
    expect(screen.getByText(/nog geen stand/i)).toBeInTheDocument();
  });

  it('still lists every entrant at 0 points when there are entrants but no locked rounds yet, rather than hiding them', () => {
    render(<StandingsTable tournament={tournamentWith([])} entrantsById={entrantsById} roundsCount={0} />);
    expect(screen.getByText('De Kraaien')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('flags that only locked rounds count once live-preview is turned off', () => {
    const t = { ...tournamentWith([
      { id: 'rnd_1', status: 'done', entrantIds: ['ent_1'], results: { ranking: [], points: { ent_1: 5 }, lockedAt: 'now' } },
    ]), settings: { showLivePreview: false } };
    render(<StandingsTable tournament={t} entrantsById={entrantsById} roundsCount={1} />);
    expect(screen.getByText(/alleen vergrendelde rondes tellen mee/i)).toBeInTheDocument();
  });
});
