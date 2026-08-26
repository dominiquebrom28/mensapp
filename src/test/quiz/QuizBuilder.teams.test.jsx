// src/features/quiz/QuizBuilder.jsx -- WP-Q5 (docs/quiz-unification-spec.md
// §5.1/§5.2). Two things this file exists to prove that QuizDashboard's own
// tests (which stub QuizBuilder out entirely) cannot:
//  - the inline team builder is really gone, not just visually replaced --
//    no hand-typed "Team name…" input, no captain-toggle crown UI here
//    anymore (§5.1's exact deletion list).
//  - `teamSetId` -- set via `TeamSetPicker`'s `onChange` -- actually reaches
//    `onSave`'s payload alongside `teams`, since `QuizDashboard`'s save path
//    (§4.1) needs it to persist `quizzes.team_set_id` for provenance.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuizBuilder } from '../../features/quiz/QuizBuilder.jsx';

const TEAM_SET = {
  id: 'ts_1', name: 'Kroeg Teams', status: 'active',
  teams: [{ id: 'tm_1', name: 'Team Alfa', members: ['Rik'] }],
};

describe('QuizBuilder -- teams come from the library only (§5.1 deletion)', () => {
  it('has no inline "create team" input or captain-toggle crown -- the library picker replaced it', () => {
    render(<QuizBuilder onSave={() => {}} onCancel={() => {}} team_sets={[TEAM_SET]} />);
    fireEvent.click(screen.getByText('👥 Teams'));
    expect(screen.queryByPlaceholderText('Team name…')).toBeNull();
    expect(screen.queryByText('+ Create Team')).toBeNull();
    expect(screen.queryByTitle('Change avatar')).toBeNull();
    // The library picker's own UI is there instead.
    expect(screen.getByText('Teamset uit de bibliotheek')).toBeInTheDocument();
  });

  it('picking a team set in the Teams tab carries teamSetId through to onSave, alongside the snapshotted teams', () => {
    const onSave = vi.fn();
    render(<QuizBuilder onSave={onSave} onCancel={() => {}} team_sets={[TEAM_SET]} />);

    fireEvent.change(screen.getByPlaceholderText('Quiz title…'), { target: { value: 'Pubquiz' } });
    // Make the default round's question valid so "Create Quiz" isn't disabled
    // -- unrelated to what this test is about, but `valid` is computed over
    // the whole quiz. Question 1 is expanded by default (`expandedQ` starts
    // at 0).
    fireEvent.change(screen.getByPlaceholderText('Type your question…'), { target: { value: 'Wat is dit?' } });
    fireEvent.change(screen.getByPlaceholderText('Option A'), { target: { value: 'Ja' } });
    fireEvent.change(screen.getByPlaceholderText('Option B'), { target: { value: 'Nee' } });

    fireEvent.click(screen.getByText('👥 Teams'));
    fireEvent.change(screen.getByDisplayValue('Kies een teamset…'), { target: { value: 'ts_1' } });

    fireEvent.click(screen.getByText('Create Quiz'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.teamSetId).toBe('ts_1');
    expect(payload.teams.map(t => t.name)).toEqual(['Team Alfa']);
  });

  it('an existing quiz\'s teamSetId seeds the picker, and is preserved through onSave when untouched', () => {
    const onSave = vi.fn();
    const existing = {
      id: 'qz1', title: 'Bestaande Quiz', status: 'ready', defaultTime: 30, introText: '', introBg: '',
      rounds: [{ id: 'r0', title: 'Round 1', questions: [{ type: 'multiple', q: 'Vraag?', options: ['A', 'B'], answer: [0], points: 10 }] }],
      teams: [{ id: 'tm_1', name: 'Team Alfa', members: [], avatar: '🦁' }],
      teamSetId: 'ts_1',
    };
    render(<QuizBuilder onSave={onSave} onCancel={() => {}} existing={existing} team_sets={[TEAM_SET]} />);

    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave.mock.calls[0][0].teamSetId).toBe('ts_1');
  });
});
