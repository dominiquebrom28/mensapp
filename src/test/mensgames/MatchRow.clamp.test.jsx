// Component tests for src/features/mensgames/MatchRow.jsx -- score entry
// for one match (docs/mensgames-spec.md §11 risk 7: "scored at a bar, on a
// phone"). Covers the hard requirement from the task brief: numeric input
// parses, clamps to the plugin's min/max, and rejects NaN before it's ever
// written into `match.entry`.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MatchRow from '../../features/mensgames/MatchRow.jsx';
import { blankMatch } from '../../features/mensgames/model.js';
import { getScoringType } from '../../features/mensgames/scoring/index.js';

const entrantsById = {
  ent_a: { id: 'ent_a', name: 'De Kraaien', avatar: '🦅' },
  ent_b: { id: 'ent_b', name: 'De Adelaars', avatar: '🦉' },
};

describe('MatchRow', () => {
  it('best-of: taps on the stepper clamp at the configured max and never write a value above it', () => {
    const type = getScoringType('best-of');
    const config = { sets: 3 };
    const match = blankMatch('ent_a', 'ent_b', { id: 'mt1' });
    const onChange = vi.fn();
    render(<MatchRow match={match} scoringType={type} config={config} entrantsById={entrantsById} onChange={onChange} />);

    const incA = screen.getAllByRole('button', { name: /sets verhogen/i })[0];
    fireEvent.click(incA); fireEvent.click(incA); fireEvent.click(incA); fireEvent.click(incA);
    const lastCall = onChange.mock.calls.at(-1)[0];
    expect(lastCall.entry.a.sets).toBeLessThanOrEqual(3);
  });

  it('race-time: typing a non-numeric time never calls onChange (rejects NaN before writing)', () => {
    const type = getScoringType('race-time');
    const match = blankMatch('ent_a', 'ent_b', { id: 'mt2' });
    const onChange = vi.fn();
    render(<MatchRow match={match} scoringType={type} config={{}} entrantsById={entrantsById} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton', { name: /tijd \(sec\)/i });
    fireEvent.change(inputs[0], { target: { value: 'not a number' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('race-time: typing an out-of-range time clamps to RACE_TIME_MAX_SECONDS instead of writing the raw value', () => {
    const type = getScoringType('race-time');
    const match = blankMatch('ent_a', 'ent_b', { id: 'mt3' });
    const onChange = vi.fn();
    render(<MatchRow match={match} scoringType={type} config={{}} entrantsById={entrantsById} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton', { name: /tijd \(sec\)/i });
    fireEvent.change(inputs[0], { target: { value: '999999' } });
    const lastCall = onChange.mock.calls.at(-1)[0];
    expect(lastCall.entry.a.seconds).toBe(7200);
  });

  it('manual scoring: shows three big pick-a-winner buttons, no numeric entry at all', () => {
    const type = getScoringType('manual');
    const match = blankMatch('ent_a', 'ent_b', { id: 'mt4' });
    const onChange = vi.fn();
    render(<MatchRow match={match} scoringType={type} config={{}} entrantsById={entrantsById} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /de kraaien wint/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ winnerId: 'ent_a', status: 'done' }));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('a bye match (bId null) shows no entry controls at all', () => {
    const type = getScoringType('best-of');
    const match = blankMatch('ent_a', null, { id: 'mt5' });
    render(<MatchRow match={match} scoringType={type} config={{ sets: 3 }} entrantsById={entrantsById} onChange={() => {}} />);
    expect(screen.getByText(/vrijstelling/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verhogen/i })).not.toBeInTheDocument();
  });
});
