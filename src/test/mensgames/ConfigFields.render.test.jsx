// Component tests for src/features/mensgames/ConfigFields.jsx -- "the
// load-bearing piece" (docs/mensgames-spec.md §5): renders a scoring
// plugin's declared fields generically, so adding a sport to the registry
// gets a working entry UI for free. Exercises it against two real plugins
// (best-of's `stepper` entryFields, race-time's `number` entryFields)
// rather than a hand-rolled fake field list, so a drift in either plugin's
// field shape would fail here too.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ConfigFields from '../../features/mensgames/ConfigFields.jsx';
import bestOf from '../../features/mensgames/scoring/best-of.js';
import raceTime from '../../features/mensgames/scoring/race-time.js';

describe('ConfigFields', () => {
  it('renders a stepper for each entryFields entry and clamps taps at min/max', () => {
    const config = { sets: 3 };
    const onChange = vi.fn();
    const { rerender } = render(<ConfigFields fields={bestOf.entryFields(config)} value={{ sets: 0 }} onChange={onChange} idPrefix="a" />);

    const inc = screen.getByRole('button', { name: /sets verhogen/i });
    const dec = screen.getByRole('button', { name: /sets verlagen/i });

    // At the field's min (0), decrementing is disabled -- never lets a tap
    // push a value out of the plugin-declared range.
    expect(dec).toBeDisabled();

    fireEvent.click(inc);
    expect(onChange).toHaveBeenCalledWith({ sets: 1 });

    // Simulate the parent re-rendering with the new value (as MatchRow
    // would after `onChange`), then drive it up to the declared max.
    rerender(<ConfigFields fields={bestOf.entryFields(config)} value={{ sets: 3 }} onChange={onChange} idPrefix="a" />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sets verhogen/i })).toBeDisabled();
  });

  it('renders a number input for a "number" field (race-time) with a stepper fallback, and rejects non-numeric text', () => {
    const onChange = vi.fn();
    render(<ConfigFields fields={raceTime.entryFields({})} value={{ seconds: null }} onChange={onChange} idPrefix="b" />);

    const input = screen.getByRole('spinbutton', { name: /tijd \(sec\)/i });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith({ seconds: 42 });
  });

  it('clamps a typed number to the field max rather than writing the raw out-of-range value', () => {
    const onChange = vi.fn();
    render(<ConfigFields fields={raceTime.entryFields({})} value={{ seconds: 0 }} onChange={onChange} idPrefix="c" />);
    const input = screen.getByRole('spinbutton', { name: /tijd \(sec\)/i });
    fireEvent.change(input, { target: { value: '999999' } });
    expect(onChange).toHaveBeenCalledWith({ seconds: 7200 }); // RACE_TIME_MAX_SECONDS
  });

  it('gives two ConfigFields instances with the same field keys distinct DOM ids via idPrefix (no duplicate-id a11y bug)', () => {
    render(
      <div>
        <ConfigFields fields={bestOf.entryFields({ sets: 3 })} value={{ sets: 0 }} onChange={() => {}} idPrefix="side-a" />
        <ConfigFields fields={bestOf.entryFields({ sets: 3 })} value={{ sets: 0 }} onChange={() => {}} idPrefix="side-b" />
      </div>,
    );
    const values = screen.getAllByText('0');
    expect(values[0].id).not.toBe(values[1].id);
  });

  it('renders nothing for a plugin with no fields (manual)', () => {
    const { container } = render(<ConfigFields fields={[]} value={{}} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
