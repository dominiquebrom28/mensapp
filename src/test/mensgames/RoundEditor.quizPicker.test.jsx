// Mounts the real RoundEditor/QuizPanel — WP-Q10, docs/
// quiz-unification-spec.md §8.4, extended by the owner's direct request
// (2026-08-26): "make it possible to create a quiz round and select one of
// the created quizzes from the quiz feature". A unit test on
// `combineFinishedQuizzes` alone would pass even if the picker never wired
// the merged list into the dropdown a human actually sees — this file is
// the "a human can see the result" check the brief asks for.
//
// Mocks `features/quiz/results.js` (not supabase.js directly) — the same
// isolation level `MensGamesShell.errors.test.jsx` uses for `mensgames/
// api.js`, one level above the wire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockFetchQuizResults = vi.fn();

vi.mock('../../features/quiz/results.js', () => ({
  fetchQuizResults: (...args) => mockFetchQuizResults(...args),
  isMissingTableError: (error) => error?.code === 'PGRST205' || error?.code === '42P01',
}));

import RoundEditor from '../../features/mensgames/RoundEditor.jsx';
import { blankRound } from '../../features/mensgames/model.js';

const entrants = [
  { id: 'ent_1', name: 'Team Alfa' },
  { id: 'ent_2', name: 'Team Beta' },
];
const entrantsById = { ent_1: entrants[0], ent_2: entrants[1] };

function makeRound(sourcePatch = {}) {
  const round = blankRound({ format: 'quiz', scoringTypeId: 'quiz-linked', now: 1 });
  round.entrantIds = ['ent_1', 'ent_2'];
  round.source = { ...round.source, ...sourcePatch };
  return round;
}

async function waitForQuizzesToLoad() {
  await waitFor(() => expect(screen.queryByText(/quizzes laden/i)).not.toBeInTheDocument());
}

function quizSelect() {
  return screen.getByLabelText('Quiz (afgerond)');
}

beforeEach(() => {
  mockFetchQuizResults.mockReset();
  mockFetchQuizResults.mockResolvedValue({ ok: true, error: null, quizResults: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoundEditor quiz picker', () => {
  it('"migrated": a table-only quiz (no event) is selectable with no event required first', async () => {
    mockFetchQuizResults.mockResolvedValue({
      ok: true, error: null,
      quizResults: [{ id: 'qz_migrated', title: 'Standalone Pubquiz', eventId: null, status: 'finished', scores: { 'Team Alfa': 40 }, memberScores: {}, teams: [], settings: {} }],
    });
    render(<RoundEditor round={makeRound()} allEntrants={entrants} entrantsById={entrantsById} events={[]} canManage onChange={() => {}} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();
    expect(within(quizSelect()).getByText(/Standalone Pubquiz.*Losstaand/)).toBeInTheDocument();
  });

  it('"built-since": a quiz that only lives in evt.quizzes[] (no table row) still appears', async () => {
    const events = [{ id: 'evt-1', name: 'Zomerfeest', quizzes: [{ id: 'qz_legacy', title: 'Vorige Week Quiz', status: 'finished', scores: { 'Team Alfa': 12 } }] }];
    render(<RoundEditor round={makeRound()} allEntrants={entrants} entrantsById={entrantsById} events={events} canManage onChange={() => {}} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();
    expect(within(quizSelect()).getByText(/Vorige Week Quiz.*Zomerfeest/)).toBeInTheDocument();
  });

  it('"new": a quiz present in both the table and evt.quizzes[] shows once, not twice', async () => {
    const events = [{ id: 'evt-1', name: 'Zomerfeest', quizzes: [{ id: 'qz_both', title: 'Beide Plekken', status: 'finished', scores: { a: 1 } }] }];
    mockFetchQuizResults.mockResolvedValue({
      ok: true, error: null,
      quizResults: [{ id: 'qz_both', title: 'Beide Plekken', eventId: 'evt-1', status: 'finished', scores: { a: 1 }, memberScores: {}, teams: [], settings: {} }],
    });
    render(<RoundEditor round={makeRound()} allEntrants={entrants} entrantsById={entrantsById} events={events} canManage onChange={() => {}} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();
    expect(within(quizSelect()).getAllByText(/Beide Plekken/)).toHaveLength(1);
  });

  it('picking a quiz and pulling snapshots its scores via onChange -- the full click-through', async () => {
    const user = userEvent.setup();
    mockFetchQuizResults.mockResolvedValue({
      ok: true, error: null,
      quizResults: [{ id: 'qz1', title: 'Pubquiz 12', eventId: null, status: 'finished', scores: { 'Team Alfa': 300, 'Team Beta': 120 }, memberScores: {}, teams: [], settings: {} }],
    });
    const onChange = vi.fn();
    const round = makeRound();
    const { rerender } = render(<RoundEditor round={round} allEntrants={entrants} entrantsById={entrantsById} events={[]} canManage onChange={onChange} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();

    await user.selectOptions(quizSelect(), 'qz1');
    const nextRound = onChange.mock.calls.at(-1)[0];
    expect(nextRound.source.quizId).toBe('qz1');
    rerender(<RoundEditor round={nextRound} allEntrants={entrants} entrantsById={entrantsById} events={[]} canManage onChange={onChange} onLock={() => {}} onUnlock={() => {}} />);

    await user.click(screen.getByRole('button', { name: /haal resultaten op/i }));
    const pulled = onChange.mock.calls.at(-1)[0];
    expect(pulled.source.raw).toEqual({ 'Team Alfa': 300, 'Team Beta': 120 });
    expect(pulled.source.pulledAt).toBeTruthy();
  });

  it('a round configured last week against source.eventId + source.quizId (pre-this-change) still resolves and can pull', async () => {
    // Simulates an existing round saved before this change, when the event
    // was a hard requirement -- must not be orphaned by this rework.
    const events = [{ id: 'evt-2026', name: 'Event 2026', quizzes: [{ id: 'q1', title: 'Legacy-configured Quiz', status: 'finished', scores: { 'Team Alfa': 55 } }] }];
    const round = makeRound({ eventId: 'evt-2026', quizId: 'q1' });
    const onChange = vi.fn();
    render(<RoundEditor round={round} allEntrants={entrants} entrantsById={entrantsById} events={events} canManage onChange={onChange} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();

    expect(quizSelect()).toHaveValue('q1');
    expect(screen.queryByText(/kan niet gevonden worden/i)).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /haal resultaten op/i }));
    const pulled = onChange.mock.calls.at(-1)[0];
    expect(pulled.source.raw).toEqual({ 'Team Alfa': 55 });
  });

  it('a stale/mismatched event filter never hides the round\'s already-selected quiz', async () => {
    // The round is filtered to "evt-other" but its selected quiz actually
    // belongs to a different event -- must still show up (and stay
    // pullable), never silently disappear because the filter doesn't match.
    const events = [
      { id: 'evt-other', name: 'Ander Event', quizzes: [] },
      { id: 'evt-real', name: 'Echt Event', quizzes: [{ id: 'q1', title: 'Mijn Quiz', status: 'finished', scores: { a: 9 } }] },
    ];
    const round = makeRound({ eventId: 'evt-other', quizId: 'q1' });
    const onChange = vi.fn();
    render(<RoundEditor round={round} allEntrants={entrants} entrantsById={entrantsById} events={events} canManage onChange={onChange} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();

    expect(quizSelect()).toHaveValue('q1');
    expect(within(quizSelect()).getByText(/Mijn Quiz.*Echt Event/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /haal resultaten op/i })).not.toBeDisabled();

    await userEvent.setup().click(screen.getByRole('button', { name: /haal resultaten op/i }));
    expect(onChange.mock.calls.at(-1)[0].source.raw).toEqual({ a: 9 });
  });

  it('a genuinely-missing selected quiz (deleted) disables the pull button instead of silently no-op-ing on click', async () => {
    const round = makeRound({ eventId: null, quizId: 'ghost-quiz' });
    const onChange = vi.fn();
    render(<RoundEditor round={round} allEntrants={entrants} entrantsById={entrantsById} events={[]} canManage onChange={onChange} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();

    expect(screen.getByText(/kan niet gevonden worden/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /haal resultaten op/i })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('empty state says plainly that no finished quiz exists yet -- not a silent blank', async () => {
    render(<RoundEditor round={makeRound()} allEntrants={entrants} entrantsById={entrantsById} events={[]} canManage onChange={() => {}} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();
    expect(screen.getByText(/nog geen afgeronde quiz gevonden/i)).toBeInTheDocument();
  });

  it('a real fetch error is shown distinctly from "no quizzes exist", and legacy results still show', async () => {
    mockFetchQuizResults.mockResolvedValue({ ok: false, error: { message: 'network down' }, quizResults: [] });
    const events = [{ id: 'evt-1', name: 'Zomerfeest', quizzes: [{ id: 'qz_legacy', title: 'Vorige Week Quiz', status: 'finished', scores: { a: 1 } }] }];
    render(<RoundEditor round={makeRound()} allEntrants={entrants} entrantsById={entrantsById} events={events} canManage onChange={() => {}} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();
    expect(screen.getByText(/kon de quizzes niet laden/i)).toBeInTheDocument();
    expect(screen.queryByText(/nog geen afgeronde quiz gevonden/i)).not.toBeInTheDocument();
    expect(within(quizSelect()).getByText(/Vorige Week Quiz/)).toBeInTheDocument();
  });

  it('a missing quizzes table (pre-migration) gets its own distinct message, not the generic network one', async () => {
    mockFetchQuizResults.mockResolvedValue({ ok: false, error: { code: 'PGRST205', message: "Could not find the table 'public.quizzes'" }, quizResults: [] });
    render(<RoundEditor round={makeRound()} allEntrants={entrants} entrantsById={entrantsById} events={[]} canManage onChange={() => {}} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();
    expect(screen.getByText(/quiz-tabel bestaat nog niet/i)).toBeInTheDocument();
    expect(screen.queryByText(/kon de quizzes niet laden uit de database\. wat hieronder/i)).not.toBeInTheDocument();
  });

  it('the optional event filter narrows the list but never hides a standalone quiz when left on "Alle quizzes"', async () => {
    const events = [{ id: 'evt-1', name: 'Zomerfeest', quizzes: [] }];
    mockFetchQuizResults.mockResolvedValue({
      ok: true, error: null,
      quizResults: [{ id: 'qz_standalone', title: 'Los Quiz', eventId: null, status: 'finished', scores: {}, memberScores: {}, teams: [], settings: {} }],
    });
    render(<RoundEditor round={makeRound()} allEntrants={entrants} entrantsById={entrantsById} events={events} canManage onChange={() => {}} onLock={() => {}} onUnlock={() => {}} />);
    await waitForQuizzesToLoad();
    expect(screen.getByLabelText('Event (filter, optioneel)')).toHaveValue('');
    expect(within(quizSelect()).getByText(/Los Quiz.*Losstaand/)).toBeInTheDocument();
  });
});
