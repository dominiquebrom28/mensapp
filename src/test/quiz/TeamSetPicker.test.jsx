// src/features/quiz/TeamSetPicker.jsx -- WP-Q5 (docs/quiz-unification-spec.md
// §5.2, §5.3). Teams are a library concept now; this is the only place a
// quiz gets them. Two things earn their own tests here rather than living
// only in model.test.js's `teamsFromTeamSet` coverage:
//  - the duplicate-name REJECTION (§3.3: `quizzes.scores` is name-keyed, so
//    two teams sharing a name in one set would collide the instant the quiz
//    finishes) -- a picker-level guard, not a model-level one.
//  - the SNAPSHOT semantics (§5.3) as seen from a consumer: picking a set
//    hands back a fresh copy, and picking it again after the library
//    changed hands back an updated copy -- there is no live binding to break.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TeamSetPicker } from '../../features/quiz/TeamSetPicker.jsx';

const CLEAN_SET = {
  id: 'ts_1', name: 'Kroeg Teams', category: 'Kroeg', status: 'active',
  teams: [
    { id: 'tm_1', name: 'Team Alfa', members: ['Rik', 'Sanne'], captain: 'Rik' },
    { id: 'tm_2', name: 'Team Beta', members: ['Bo'] },
  ],
};

const DUPLICATE_SET = {
  id: 'ts_2', name: 'Dubbele Namen', status: 'active',
  teams: [
    { id: 'tm_3', name: 'Team Gamma', members: [] },
    { id: 'tm_4', name: 'team gamma', members: [] }, // same name, different case
  ],
};

const ARCHIVED_SET = { id: 'ts_3', name: 'Oude set', status: 'archived', teams: [{ id: 'tm_9', name: 'X', members: [] }] };

describe('TeamSetPicker', () => {
  it('lists only active team sets, never an archived one', () => {
    render(<TeamSetPicker teams={[]} teamSetId={null} onChange={() => {}} teamSets={[CLEAN_SET, ARCHIVED_SET]} />);
    expect(screen.getByText(/Kroeg Teams/)).toBeInTheDocument();
    expect(screen.queryByText(/Oude set/)).toBeNull();
  });

  it('selecting a clean set snapshots teamsFromTeamSet(set) into teams and sets teamSetId', () => {
    const onChange = vi.fn();
    render(<TeamSetPicker teams={[]} teamSetId={null} onChange={onChange} teamSets={[CLEAN_SET]} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ts_1' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0];
    expect(arg.teamSetId).toBe('ts_1');
    expect(arg.teams.map(t => t.name)).toEqual(['Team Alfa', 'Team Beta']);
    expect(arg.teams[0].sourceTeamId).toBe('tm_1');
    // Snapshot, not a live reference (§5.3): the returned team objects are
    // not the same object identity as the library's own team rows.
    expect(arg.teams[0]).not.toBe(CLEAN_SET.teams[0]);
  });

  it('rejects a set with duplicate team names (case-insensitive) -- no onChange call, an inline message instead', () => {
    const onChange = vi.fn();
    render(<TeamSetPicker teams={[]} teamSetId={null} onChange={onChange} teamSets={[DUPLICATE_SET]} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ts_2' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Dubbele Namen/);
  });

  it('shows a read-only preview of the currently-snapshotted teams', () => {
    render(<TeamSetPicker teams={[{ id: 'tm_1', name: 'Team Alfa', avatar: '🦁', members: ['Rik'], captain: 'Rik' }]} teamSetId="ts_1" onChange={() => {}} teamSets={[CLEAN_SET]} />);
    expect(screen.getByText('Team Alfa')).toBeInTheDocument();
    expect(screen.getByTitle(/Kapitein: Rik/i)).toBeInTheDocument();
  });

  it('an empty selection shows the empty state, not a blank panel', () => {
    render(<TeamSetPicker teams={[]} teamSetId={null} onChange={() => {}} teamSets={[CLEAN_SET]} />);
    expect(screen.getByText(/Nog geen teams gekozen/i)).toBeInTheDocument();
  });

  it('"↻ Ververs" is only enabled while status==="ready" -- never on a live or finished quiz', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TeamSetPicker teams={[{ id: 'tm_1', name: 'Team Alfa', members: [] }]} teamSetId="ts_1" onChange={onChange} teamSets={[CLEAN_SET]} status="live" />
    );
    const refreshBtn = screen.getByText(/Ververs uit bibliotheek/);
    expect(refreshBtn).toBeDisabled();
    fireEvent.click(refreshBtn);
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <TeamSetPicker teams={[{ id: 'tm_1', name: 'Team Alfa', members: [] }]} teamSetId="ts_1" onChange={onChange} teamSets={[CLEAN_SET]} status="ready" />
    );
    const refreshBtnReady = screen.getByText(/Ververs uit bibliotheek/);
    expect(refreshBtnReady).not.toBeDisabled();
    fireEvent.click(refreshBtnReady);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].teamSetId).toBe('ts_1');
  });

  it('re-picking the same set after the library changed hands back the updated snapshot -- no live binding to go stale', () => {
    const onChange = vi.fn();
    const renamedSet = { ...CLEAN_SET, teams: [{ ...CLEAN_SET.teams[0], name: 'Team Alfa (hernoemd)' }, CLEAN_SET.teams[1]] };
    render(<TeamSetPicker teams={[]} teamSetId="ts_1" onChange={onChange} teamSets={[renamedSet]} status="ready" />);
    fireEvent.click(screen.getByText(/Ververs uit bibliotheek/));
    expect(onChange.mock.calls[0][0].teams.map(t => t.name)).toContain('Team Alfa (hernoemd)');
  });

  it('lists attendees not present on any current team under "Niet ingedeeld"', () => {
    render(
      <TeamSetPicker
        teams={[{ id: 'tm_1', name: 'Team Alfa', members: ['Rik'] }]}
        teamSetId="ts_1"
        onChange={() => {}}
        teamSets={[CLEAN_SET]}
        attendees={[{ name: 'Rik' }, { name: 'Ongedeeld Fred' }]}
      />
    );
    expect(screen.getByText('Ongedeeld Fred')).toBeInTheDocument();
    expect(screen.getByText('Niet ingedeeld')).toBeInTheDocument();
  });

  it('shows the library-read error notice, with retry, when there are no active sets because the read failed', () => {
    const onRetry = vi.fn();
    render(<TeamSetPicker teams={[]} teamSetId={null} onChange={() => {}} teamSets={[]} teamSetsError={{ message: 'boom' }} onRetryTeamSets={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Opnieuw proberen/));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// Dutch, not "lid/leden". This app is written for a Dutch friend group and
// its owner reads every string in it; the codebase has already shipped
// "1 personen" and "blijften" once each. The plural of "lid" is "leden".
describe('member count reads as Dutch', () => {
  const MIXED_SET = {
    id: 'ts_4', name: 'Gemengd', status: 'active',
    teams: [
      { id: 'tm_solo', name: 'Solo', members: ['Bakker'] },
      { id: 'tm_duo', name: 'Duo', members: ['Bakker', 'Doom'] },
    ],
  };

  it('says "1 lid" for one and "N leden" for more', () => {
    const teams = MIXED_SET.teams.map(t => ({ ...t }));
    render(<TeamSetPicker teams={teams} teamSetId="ts_4" onChange={() => {}} teamSets={[MIXED_SET]} />);

    expect(screen.getByText('1 lid')).toBeInTheDocument();
    expect(screen.getByText('2 leden')).toBeInTheDocument();
    expect(screen.queryByText(/lid\/leden/)).toBeNull();
  });
});
