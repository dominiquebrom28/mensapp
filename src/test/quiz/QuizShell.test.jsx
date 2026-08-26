// src/features/quiz/QuizShell.jsx -- WP-Q7 (docs/quiz-unification-spec.md
// §8.1/§14 decision 1): the shared internals behind both quiz mount points.
// `QuizDashboard`/`QuizBuilder`/`QuizPresenter` are heavy, already-covered-
// elsewhere components -- mocked here to thin stubs so this file only
// exercises `QuizShell`'s own glue: what it renders, what it merges, and
// what it calls the `quizzes`-table API with.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../features/quiz/QuizDashboard.jsx', () => ({
  default: ({ evt, initialQuizId, initialNew, onClose }) => (
    <div>
      <div>stub-dashboard for {evt.name}</div>
      <div>initialQuizId={String(initialQuizId)}</div>
      <div>initialNew={String(initialNew)}</div>
      <button onClick={onClose}>stub-close-dashboard</button>
    </div>
  ),
}));
vi.mock('../../features/quiz/QuizBuilder.jsx', () => ({
  QuizBuilder: ({ onSave, existing }) => (
    <button onClick={() => onSave({ title: existing ? `${existing.title} bewerkt` : 'Nieuwe Standalone Quiz', defaultTime: 30, rounds: [{ id: 'r0', title: 'Round 1', questions: [] }], teams: [], teamSetId: null, introText: '', introBg: '' })}>
      stub-save-builder
    </button>
  ),
}));
vi.mock('../../features/quiz/QuizPresenter.jsx', () => ({ QuizPresenter: () => <div>stub-presenter</div> }));

const saveQuiz = vi.fn(async (q) => ({ ok: true, error: null, quiz: q }));
const deleteQuiz = vi.fn(async () => ({ ok: true, error: null }));
const fetchQuizzes = vi.fn();
vi.mock('../../features/quiz/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchQuizzes: (...args) => fetchQuizzes(...args),
  saveQuiz: (...args) => saveQuiz(...args),
  deleteQuiz: (...args) => deleteQuiz(...args),
}));

const QuizShell = (await import('../../features/quiz/QuizShell.jsx')).default;

const CAN = { hostQuiz: () => true };

beforeEach(() => {
  saveQuiz.mockClear();
  deleteQuiz.mockClear();
  fetchQuizzes.mockReset();
  fetchQuizzes.mockResolvedValue({ ok: true, error: null, quizzes: [] });
});

describe('QuizShell scope="event" -- pure relocation of what EventPage used to own inline', () => {
  it('renders the event quiz tab and opens/closes the exact QuizDashboard on demand', async () => {
    const evt = { id: 'evt-1', name: 'Kroegentocht', quizzes: [], attendees: [] };
    render(<QuizShell scope="event" evt={evt} onUpdate={() => {}} currentUser={{ role: 'org' }} users={[]} isPast={false} can={CAN} teamSets={[]} />);

    fireEvent.click(screen.getByText('Open Quiz Dashboard'));
    expect(await screen.findByText('stub-dashboard for Kroegentocht')).toBeInTheDocument();

    fireEvent.click(screen.getByText('stub-close-dashboard'));
    expect(screen.queryByText('stub-dashboard for Kroegentocht')).not.toBeInTheDocument();
    // Back on the tab -- the dashboard really closed rather than the whole
    // tree unmounting.
    expect(screen.getByText('Open Quiz Dashboard')).toBeInTheDocument();
  });
});

describe('QuizShell scope="page" -- the new standalone capability', () => {
  it('lists a quiz from the `quizzes` table AND one only found in evt.quizzes[] (the "built-since" gap), each correctly labelled', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-standalone', title: 'Tafelquiz', eventId: null, status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [{ id: 'qz-legacy', title: 'Oude Pubquiz', status: 'ready', rounds: [] }] }];
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);

    expect(await screen.findByText('Tafelquiz')).toBeInTheDocument();
    expect(screen.getByText('Oude Pubquiz')).toBeInTheDocument();
    expect(screen.getByText(/· Kroegentocht/)).toBeInTheDocument();
  });

  it('creating a standalone quiz (no event picked) saves straight to the quizzes table and renders it in the list, with no evt.quizzes write', async () => {
    const onUpdateEvent = vi.fn();
    render(<QuizShell scope="page" events={[]} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={onUpdateEvent} onSendNotif={() => {}} />);
    await waitFor(() => expect(fetchQuizzes).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ Nieuwe quiz'));
    fireEvent.click(screen.getByText('Verder →')); // no event selected -> standalone
    fireEvent.click(await screen.findByText('stub-save-builder'));

    await waitFor(() => expect(saveQuiz).toHaveBeenCalledTimes(1));
    expect(saveQuiz.mock.calls[0][0]).toMatchObject({ title: 'Nieuwe Standalone Quiz', eventId: null, status: 'ready' });
    expect(await screen.findByText('Nieuwe Standalone Quiz')).toBeInTheDocument();
    expect(onUpdateEvent).not.toHaveBeenCalled();
  });

  it('opening an event-linked row delegates to the real QuizDashboard, pre-selected on that quiz', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Gekoppelde Quiz', eventId: 'evt-1', status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }];
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);

    fireEvent.click(await screen.findByText('Gekoppelde Quiz'));

    expect(await screen.findByText('stub-dashboard for Kroegentocht')).toBeInTheDocument();
    expect(screen.getByText('initialQuizId=qz-1')).toBeInTheDocument();
    expect(screen.getByText('initialNew=false')).toBeInTheDocument();
  });

  it('a non-admin sees the same rows but cannot open QuizDashboard -- rows are inert, not a disguised button', async () => {
    const NOT_HOST = { hostQuiz: () => false };
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Alleen-lezen Quiz', eventId: 'evt-1', status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }];
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'lad' }} can={NOT_HOST} teamSets={[]} onUpdateEvent={() => {}} />);

    const row = await screen.findByText('Alleen-lezen Quiz');
    expect(screen.queryByText('+ Nieuwe quiz')).not.toBeInTheDocument();
    // A real button would be reachable by role; an inert row must not be.
    expect(screen.queryByRole('button', { name: /Alleen-lezen Quiz/ })).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.queryByText(/stub-dashboard/)).not.toBeInTheDocument();
  });

  it('deleting a standalone quiz removes it from the list and calls deleteQuiz', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Weg Ermee', eventId: null, status: 'ready', rounds: [] }],
    });
    render(<QuizShell scope="page" events={[]} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);
    await screen.findByText('Weg Ermee');

    fireEvent.click(screen.getByText('✕ Verwijder “Weg Ermee”'));

    expect(deleteQuiz).toHaveBeenCalledWith('qz-1');
    await waitFor(() => expect(screen.queryByText('Weg Ermee')).not.toBeInTheDocument());
  });

  it('shows a real error state (not a false empty state) when the quizzes table read fails', async () => {
    fetchQuizzes.mockResolvedValue({ ok: false, error: { message: 'boom' }, quizzes: [] });
    render(<QuizShell scope="page" events={[]} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/kon de quizzen niet laden/i)).toBeInTheDocument();
    expect(screen.queryByText(/nog geen quizzen/i)).not.toBeInTheDocument();
  });
});
