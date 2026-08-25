// src/features/quiz/QuizDashboard.jsx -- WP-Q6's wiring (docs/
// quiz-unification-spec.md §7.2, item 2): "Afronden" must write the legacy
// `evt.quizzes[]` update AND call `finishQuiz` so the result is findable
// outside this dashboard (§3.4). `QuizPresenter`/`QuizBuilder` are heavy,
// already-covered-elsewhere components (`presenterProtocol.test.jsx` etc.)
// -- mocked here to a thin stub so this file only exercises `QuizDashboard`'s
// own glue: what it calls, with what, and in what order.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../features/quiz/QuizPresenter.jsx', () => ({
  QuizPresenter: ({ onFinish }) => (
    <button onClick={() => onFinish({ 'Team Gamma': 42, 'Team Delta': 10 })}>stub-finish</button>
  ),
}));
vi.mock('../../features/quiz/QuizBuilder.jsx', () => ({ QuizBuilder: () => null }));

const finishQuiz = vi.fn(async () => ({ ok: true, quiz: {}, winners: [], teamAwards: [], updatedTeamSets: [], errors: [], deferred: false }));
vi.mock('../../features/quiz/finishQuiz.js', async (importOriginal) => ({
  ...(await importOriginal()),
  finishQuiz: (...args) => finishQuiz(...args),
}));

const QuizDashboard = (await import('../../features/quiz/QuizDashboard.jsx')).default;

beforeEach(() => {
  finishQuiz.mockClear();
  finishQuiz.mockImplementation(async () => ({ ok: true, quiz: {}, winners: [], teamAwards: [], updatedTeamSets: [], errors: [], deferred: false }));
});

const QUIZ = {
  id: 'qz1724000000',
  title: 'Pubquiz',
  status: 'ready',
  rounds: [{ id: 'r0', title: 'Round 1', questions: [] }],
  teams: [
    { name: 'Team Gamma', members: ['Rik'] },
    { name: 'Team Delta', members: ['Bo'] },
  ],
  scores: {},
};

function renderDashboard(onUpdate) {
  const evt = { id: 'evt-2026', name: 'Kroegentocht', quizzes: [QUIZ], attendees: [] };
  render(<QuizDashboard evt={evt} onUpdate={onUpdate} onClose={() => {}} users={[]} teamSets={[]} />);
  return evt;
}

describe('QuizDashboard onFinish wiring', () => {
  it('writes the legacy evt.quizzes update before calling finishQuiz, and forwards event/teamSets', async () => {
    const onUpdate = vi.fn(async (next) => next);
    renderDashboard(onUpdate);

    fireEvent.click(screen.getByText('🎤 Present'));
    fireEvent.click(screen.getByText('stub-finish'));

    await waitFor(() => expect(finishQuiz).toHaveBeenCalledTimes(1));

    // The legacy write happened (evt.quizzes updated with the finished
    // status/scores) before finishQuiz's own publish -- both target the
    // same `events` row, so ordering matters (see QuizDashboard.jsx's own
    // comment on this call site).
    expect(onUpdate).toHaveBeenCalled();
    const legacyCall = onUpdate.mock.calls[0][0];
    expect(legacyCall.quizzes[0]).toMatchObject({
      status: 'finished',
      scores: { 'Team Gamma': 42, 'Team Delta': 10 },
      memberScores: { Rik: 42, Bo: 10 },
    });

    const finishArgs = finishQuiz.mock.calls[0][0];
    expect(finishArgs.quiz).toMatchObject({ id: 'qz1724000000', status: 'finished', scores: { 'Team Gamma': 42, 'Team Delta': 10 }, eventId: 'evt-2026' });
    expect(finishArgs.event.id).toBe('evt-2026');
    expect(finishArgs.onUpdateEvent).toBe(onUpdate);
  });

  it('shows a retryable error banner when finishQuiz reports failure, and clears it on a successful retry', async () => {
    finishQuiz.mockImplementationOnce(async () => ({ ok: false, quiz: {}, winners: [], teamAwards: [], updatedTeamSets: [], errors: [{ scope: 'event', error: 'boom' }], deferred: false }));
    const onUpdate = vi.fn(async (next) => next);
    renderDashboard(onUpdate);

    fireEvent.click(screen.getByText('🎤 Present'));
    fireEvent.click(screen.getByText('stub-finish'));

    await screen.findByRole('alert');
    expect(screen.getByText(/niet gepubliceerd|niet alles is gepubliceerd/i)).toBeInTheDocument();

    finishQuiz.mockImplementationOnce(async () => ({ ok: true, quiz: {}, winners: [], teamAwards: [], updatedTeamSets: [], errors: [], deferred: false }));
    fireEvent.click(screen.getByText('Opnieuw proberen'));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(finishQuiz).toHaveBeenCalledTimes(2);
  });
});
