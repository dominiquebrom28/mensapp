// src/features/quiz/QuizDashboard.jsx -- WP-Q5 (docs/quiz-unification-spec.md
// §4.1, §4.3, §10.4). The builder used to write ONLY into `events.quizzes[]`
// (the legacy JSONB column) -- that single fact is what made discovery via
// `quizzes.status='live'` see nothing, made a §4.3 definition refetch replace
// live questions with a stale pre-migration snapshot, and made `finishQuiz`
// need a no-row fallback before it could persist a result at all. This file
// proves the fix: every builder save now writes BOTH `events.quizzes[]`
// (kept, per §10.4 -- not dropped until a release after the next event) AND
// a real `quizzes` row via `saveQuiz`'s full-row upsert, and bumps `rev` on
// every definition change (the mechanism a mid-quiz typo fix rides to reach
// every phone, §4.3).
//
// Covers the three migration-state groups the brief calls out, because the
// event is soon and a quiz built last week must still work:
//  - "migrated": a `quizzes` row already exists (from the one-time §10.2
//    copy) but the legacy `evt.quizzes[]` object -- what this dashboard
//    actually edits -- has no `rev` field yet (the migration never wrote
//    back into `events`).
//  - "built-since": no `quizzes` row at all, same missing-`rev` shape.
//  Both groups are indistinguishable from this dashboard's point of view --
//  it never reads the `quizzes` table, only `evt.quizzes` -- and both must
//  be treated identically: `rev` defaults to 1, first edit under this code
//  bumps it to 2, and `saveQuiz`'s upsert inserts-or-overwrites either way.
//  - "already fixed": a quiz created (or previously edited) through this
//    same code, which already carries a real `rev` in `evt.quizzes[]` --
//    proving the count keeps incrementing rather than resetting.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../features/quiz/QuizPresenter.jsx', () => ({ QuizPresenter: () => null }));

vi.mock('../../features/quiz/QuizBuilder.jsx', () => ({
  QuizBuilder: ({ onSave }) => (
    <button onClick={() => onSave({ title: 'Herziene titel', defaultTime: 45, rounds: [{ id: 'r0', title: 'Round 1', questions: [] }], teams: [], teamSetId: null, introText: '', introBg: '' })}>stub-save</button>
  ),
}));

const saveQuiz = vi.fn(async (q) => ({ ok: true, error: null, quiz: q }));
const deleteQuiz = vi.fn(async () => ({ ok: true, error: null }));
vi.mock('../../features/quiz/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveQuiz: (...args) => saveQuiz(...args),
  deleteQuiz: (...args) => deleteQuiz(...args),
}));

const QuizDashboard = (await import('../../features/quiz/QuizDashboard.jsx')).default;

beforeEach(() => {
  saveQuiz.mockClear();
  deleteQuiz.mockClear();
  saveQuiz.mockImplementation(async (q) => ({ ok: true, error: null, quiz: q }));
});

function renderWith(evt) {
  const onUpdate = vi.fn(async (next) => next);
  render(<QuizDashboard evt={evt} onUpdate={onUpdate} onClose={() => {}} users={[]} teamSets={[]} />);
  return onUpdate;
}

describe('QuizDashboard -- new quiz creation writes both places at rev 1', () => {
  it('writes the legacy evt.quizzes entry AND calls saveQuiz, both carrying rev:1', async () => {
    const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [], attendees: [] };
    const onUpdate = renderWith(evt);

    fireEvent.click(screen.getAllByText('+ New Quiz')[0]);
    fireEvent.click(await screen.findByText('stub-save'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const legacyQuiz = onUpdate.mock.calls[0][0].quizzes[0];
    expect(legacyQuiz).toMatchObject({ title: 'Herziene titel', status: 'ready', rev: 1, eventId: 'evt-2026' });

    await waitFor(() => expect(saveQuiz).toHaveBeenCalledTimes(1));
    expect(saveQuiz.mock.calls[0][0]).toMatchObject({ title: 'Herziene titel', rev: 1, eventId: 'evt-2026', status: 'ready' });
    // Same id both places -- there is exactly one quiz, not two.
    expect(saveQuiz.mock.calls[0][0].id).toBe(legacyQuiz.id);
  });
});

describe('QuizDashboard -- editing bumps rev and writes both places, for every migration-state group', () => {
  it('"migrated" / "built-since" (no `rev` on the legacy object yet): rev defaults to 1 and the edit bumps it to 2', async () => {
    // Indistinguishable from this dashboard's perspective -- neither has a
    // `rev` on the `evt.quizzes[]` object it actually edits, regardless of
    // whether a stale `quizzes` row exists server-side.
    const LEGACY_QUIZ = { id: 'qz1700000000', title: 'Oude Pubquiz', status: 'ready', rounds: [{ id: 'r0', title: 'Round 1', questions: [] }], teams: [], scores: {} };
    const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [LEGACY_QUIZ], attendees: [] };
    const onUpdate = renderWith(evt);

    fireEvent.click(screen.getByText('Oude Pubquiz'));
    fireEvent.click(await screen.findByText('stub-save'));

    const legacyQuiz = onUpdate.mock.calls[0][0].quizzes[0];
    expect(legacyQuiz.rev).toBe(2);
    expect(legacyQuiz.title).toBe('Herziene titel');

    await waitFor(() => expect(saveQuiz).toHaveBeenCalledTimes(1));
    expect(saveQuiz.mock.calls[0][0]).toMatchObject({ id: 'qz1700000000', rev: 2, title: 'Herziene titel' });
  });

  it('"already fixed" (a real rev already on the legacy object): the count keeps incrementing, not resetting', async () => {
    const FIXED_QUIZ = { id: 'qz1724000000', title: 'Nieuwe Pubquiz', status: 'ready', rounds: [{ id: 'r0', title: 'Round 1', questions: [] }], teams: [], scores: {}, rev: 4, eventId: 'evt-2026' };
    const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [FIXED_QUIZ], attendees: [] };
    const onUpdate = renderWith(evt);

    fireEvent.click(screen.getByText('Nieuwe Pubquiz'));
    fireEvent.click(await screen.findByText('stub-save'));

    expect(onUpdate.mock.calls[0][0].quizzes[0].rev).toBe(5);
    await waitFor(() => expect(saveQuiz).toHaveBeenCalledTimes(1));
    expect(saveQuiz.mock.calls[0][0].rev).toBe(5);
  });

  it('preserves fields the builder never touches (scores/status/participants) by merging onto the freshest evt.quizzes entry', async () => {
    const QUIZ = { id: 'qz1', title: 'Pubquiz', status: 'finished', rounds: [{ id: 'r0', title: 'Round 1', questions: [] }], teams: [], scores: { Doom: 10 }, memberScores: { doom: 10 }, participants: ['doom'], rev: 1 };
    const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [QUIZ], attendees: [] };
    const onUpdate = renderWith(evt);

    fireEvent.click(screen.getByText('Pubquiz'));
    fireEvent.click(await screen.findByText('stub-save'));

    const legacyQuiz = onUpdate.mock.calls[0][0].quizzes[0];
    expect(legacyQuiz.scores).toEqual({ Doom: 10 });
    expect(legacyQuiz.status).toBe('finished');
    expect(legacyQuiz.participants).toEqual(['doom']);
  });
});

describe('QuizDashboard -- a failed quizzes-table write surfaces a retryable banner, without blocking the legacy save', () => {
  it('shows a banner on saveQuiz failure and clears it once a retry succeeds', async () => {
    saveQuiz.mockImplementationOnce(async () => ({ ok: false, error: { message: 'boom' } }));
    const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [], attendees: [] };
    const onUpdate = renderWith(evt);

    fireEvent.click(screen.getAllByText('+ New Quiz')[0]);
    fireEvent.click(await screen.findByText('stub-save'));

    // The legacy write is not blocked by the table write failing.
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await screen.findByRole('alert');
    expect(screen.getByText(/niet naar de quiz-tabel/i)).toBeInTheDocument();

    saveQuiz.mockImplementationOnce(async (q) => ({ ok: true, error: null, quiz: q }));
    fireEvent.click(screen.getByText('Opnieuw proberen'));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(saveQuiz).toHaveBeenCalledTimes(2);
    // Retried with the exact same object, not a re-derived one.
    expect(saveQuiz.mock.calls[1][0]).toEqual(saveQuiz.mock.calls[0][0]);
  });
});

describe('QuizDashboard -- duplicate and delete stay consistent across both writes', () => {
  it('duplicating a quiz resets rev to 1 and calls saveQuiz for the new id', async () => {
    const QUIZ = { id: 'qz1', title: 'Origineel', status: 'ready', rounds: [{ id: 'r0', title: 'Round 1', questions: [] }], teams: [], scores: {}, rev: 6 };
    const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [QUIZ], attendees: [] };
    renderWith(evt);

    fireEvent.click(screen.getByTitle('Duplicate quiz'));

    await waitFor(() => expect(saveQuiz).toHaveBeenCalledTimes(1));
    const dup = saveQuiz.mock.calls[0][0];
    expect(dup.id).not.toBe('qz1');
    expect(dup.rev).toBe(1);
    expect(dup.title).toBe('Copy of Origineel');
  });

  it('deleting a quiz removes it from evt.quizzes AND calls deleteQuiz for that id', async () => {
    const QUIZ = { id: 'qz1', title: 'Weg ermee', status: 'ready', rounds: [{ id: 'r0', title: 'Round 1', questions: [] }], teams: [], scores: {} };
    const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [QUIZ], attendees: [] };
    const onUpdate = renderWith(evt);

    fireEvent.click(screen.getByText('✕'));

    expect(onUpdate.mock.calls[0][0].quizzes).toEqual([]);
    expect(deleteQuiz).toHaveBeenCalledWith('qz1');
  });
});
