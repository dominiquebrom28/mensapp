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
// A `finalScores` button, not a static stub -- needed to exercise
// `QuizPageShell`'s own `onFinish` callback (which event/onUpdateEvent it
// hands `finishQuiz`), the thing the link feature changes.
vi.mock('../../features/quiz/QuizPresenter.jsx', () => ({
  QuizPresenter: ({ onFinish }) => <button onClick={() => onFinish({ Piet: 3 })}>stub-finish-presenter</button>,
}));

const saveQuiz = vi.fn(async (q) => ({ ok: true, error: null, quiz: q }));
const deleteQuiz = vi.fn(async () => ({ ok: true, error: null }));
const patchQuizEventId = vi.fn(async () => ({ ok: true, error: null }));
const fetchQuizzes = vi.fn();
vi.mock('../../features/quiz/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchQuizzes: (...args) => fetchQuizzes(...args),
  saveQuiz: (...args) => saveQuiz(...args),
  deleteQuiz: (...args) => deleteQuiz(...args),
  patchQuizEventId: (...args) => patchQuizEventId(...args),
}));

const finishQuiz = vi.fn(async () => ({ ok: true, error: null, winners: [], teamAwards: [], updatedTeamSets: [], errors: [] }));
vi.mock('../../features/quiz/finishQuiz.js', async (importOriginal) => ({
  ...(await importOriginal()),
  finishQuiz: (...args) => finishQuiz(...args),
}));

const QuizShell = (await import('../../features/quiz/QuizShell.jsx')).default;

const CAN = { hostQuiz: () => true };

beforeEach(() => {
  saveQuiz.mockClear();
  deleteQuiz.mockClear();
  patchQuizEventId.mockReset();
  patchQuizEventId.mockResolvedValue({ ok: true, error: null });
  fetchQuizzes.mockReset();
  fetchQuizzes.mockResolvedValue({ ok: true, error: null, quizzes: [] });
  finishQuiz.mockClear();
  finishQuiz.mockResolvedValue({ ok: true, error: null, winners: [], teamAwards: [], updatedTeamSets: [], errors: [] });
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
    // Realistic fixture: a dashboard-managed quiz is structurally embedded
    // in its event's own `evt.quizzes[]` (QuizDashboard's dual-write, or
    // §10.2's migration, always guarantee this -- see QuizShell.jsx's own
    // `findHomeEvent` comment). The `quizzes`-table row above is the mirror
    // that same dual-write produces.
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [{ id: 'qz-1', title: 'Gekoppelde Quiz', status: 'ready', rounds: [] }] }];
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);

    fireEvent.click(await screen.findByText('Gekoppelde Quiz'));

    expect(await screen.findByText('stub-dashboard for Kroegentocht')).toBeInTheDocument();
    expect(screen.getByText('initialQuizId=qz-1')).toBeInTheDocument();
    expect(screen.getByText('initialNew=false')).toBeInTheDocument();
  });

  it('a table row whose eventId names a real event it is NOT structurally embedded in (an incomplete link) falls back to the standalone editor instead of a QuizDashboard that could never find it', async () => {
    // This is exactly the state `applyLink` can produce (deliberately --
    // see its own comment): the `quizzes` row already says `eventId:
    // 'evt-1'`, but nothing was ever written into `evt-1.quizzes[]`.
    // `QuizDashboard` only ever reads `evt.quizzes`, so routing there on
    // `eventId` alone would open a dashboard that can never find this quiz
    // -- a click that lands nowhere, with no error. Falling back to the
    // page's own standalone builder (already proven safe/working by the
    // "creating a standalone quiz" test above) is the fix.
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Half Gekoppeld', eventId: 'evt-1', status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }];
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);

    fireEvent.click(await screen.findByText('Half Gekoppeld'));

    expect(await screen.findByText('stub-save-builder')).toBeInTheDocument();
    expect(screen.queryByText(/stub-dashboard/)).not.toBeInTheDocument();
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

    // Was `getByText('✕ Verwijder “Weg Ermee”')`. The actions moved onto the
    // row itself (owner request, 2026-08-26), so the visible label no longer
    // repeats the quiz title -- that repetition only existed because the
    // strip sat under the whole list and had to say what it acted on. The
    // title now lives in an `aria-label`, which is the better target anyway:
    // it asserts the button is findable the way a screen reader finds it.
    fireEvent.click(screen.getByRole('button', { name: 'Verwijder Weg Ermee' }));

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

// Owner brief, 2026-08-26: "i want to be able to still connect a quiz to an
// event afterwards, when the quiz is already created" -- link/relink/unlink
// from the standalone Quiz page's own row actions.
describe('QuizShell scope="page" -- link/relink/unlink an existing quiz to an event', () => {
  it('links a never-linked, table-backed standalone quiz with ONE narrow patchQuizEventId write -- no evt.quizzes[] touched', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Tafelquiz', eventId: null, status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }];
    const onUpdateEvent = vi.fn();
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={onUpdateEvent} />);
    await screen.findByText('Tafelquiz');

    fireEvent.click(screen.getByRole('button', { name: 'Event-koppeling van Tafelquiz' }));
    fireEvent.change(screen.getByLabelText('Koppel aan event'), { target: { value: 'evt-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));

    await waitFor(() => expect(patchQuizEventId).toHaveBeenCalledWith('qz-1', 'evt-1'));
    expect(saveQuiz).not.toHaveBeenCalled();
    expect(onUpdateEvent).not.toHaveBeenCalled(); // nothing to clean up -- it was never structurally anywhere
    expect(await screen.findByText(/· Kroegentocht/)).toBeInTheDocument();
    // Still standalone-tool-managed (never embedded in evt.quizzes), so its
    // own Present/Duplicate/Delete stay reachable rather than silently
    // vanishing behind a QuizDashboard that has never heard of it.
    expect(screen.getByRole('button', { name: 'Presenteer Tafelquiz' })).toBeInTheDocument();
  });

  it('unlinks a table-backed, linked-but-standalone-managed quiz back to "Losstaand" with the same narrow write', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Al Gekoppeld', eventId: 'evt-1', status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }]; // NOT structurally embedded
    const onUpdateEvent = vi.fn();
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={onUpdateEvent} />);
    await screen.findByText(/· Kroegentocht/);

    fireEvent.click(screen.getByRole('button', { name: 'Event-koppeling van Al Gekoppeld' }));
    expect(screen.getByLabelText('Koppel aan event').value).toBe('evt-1'); // pre-selected on the current link
    fireEvent.change(screen.getByLabelText('Koppel aan event'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));

    await waitFor(() => expect(patchQuizEventId).toHaveBeenCalledWith('qz-1', null));
    expect(onUpdateEvent).not.toHaveBeenCalled();
    expect(await screen.findByText(/· Losstaand/)).toBeInTheDocument();
  });

  it('editing a linked-but-standalone-managed quiz through the builder does NOT silently unlink it on save', async () => {
    // Before this feature, `saveStandalone` hardcoded `eventId: null` on
    // every content edit -- harmless then, because only a never-linked
    // quiz ever reached this builder. Now a linked quiz can land here too
    // (see `openQuizRow`), and the stub builder's `onSave` never sends an
    // `eventId` field at all, so the fix must come from `saveStandalone`
    // itself carrying the prior value forward.
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Al Gekoppeld', eventId: 'evt-1', status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }];
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);
    await screen.findByText(/· Kroegentocht/);

    fireEvent.click(screen.getByText('Al Gekoppeld')); // not dashboard-managed -> opens the standalone builder
    fireEvent.click(await screen.findByText('stub-save-builder'));

    await waitFor(() => expect(saveQuiz).toHaveBeenCalledTimes(1));
    expect(saveQuiz.mock.calls[0][0]).toMatchObject({ eventId: 'evt-1' });
    expect(await screen.findByText(/· Kroegentocht/)).toBeInTheDocument();
  });

  it('re-picking the quiz\'s own current event is a no-op -- "Opslaan" stays disabled, no write fires', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Al Gekoppeld', eventId: 'evt-1', status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }];
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);
    await screen.findByText(/· Kroegentocht/);

    fireEvent.click(screen.getByRole('button', { name: 'Event-koppeling van Al Gekoppeld' }));
    expect(screen.getByRole('button', { name: 'Opslaan' })).toBeDisabled();
    expect(patchQuizEventId).not.toHaveBeenCalled();
  });

  it('moves a legacy-only quiz to a different event: seeds a full quizzes row (saveQuiz) with the new eventId, then removes it from the OLD event\'s evt.quizzes[]', async () => {
    fetchQuizzes.mockResolvedValue({ ok: true, error: null, quizzes: [] }); // no table row at all
    const eventA = { id: 'evt-a', name: 'Oude Borrel', quizzes: [{ id: 'qz-legacy', title: 'Oude Pubquiz', status: 'ready', rounds: [], scores: {} }] };
    const eventB = { id: 'evt-b', name: 'Nieuwe Mensdag', quizzes: [] };
    const onUpdateEvent = vi.fn();
    render(<QuizShell scope="page" events={[eventA, eventB]} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={onUpdateEvent} />);
    await screen.findByText('Oude Pubquiz');

    fireEvent.click(screen.getByRole('button', { name: 'Event-koppeling van Oude Pubquiz' }));
    expect(screen.getByLabelText('Koppel aan event').value).toBe('evt-a'); // structural home, pre-selected
    fireEvent.change(screen.getByLabelText('Koppel aan event'), { target: { value: 'evt-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));

    await waitFor(() => expect(saveQuiz).toHaveBeenCalledTimes(1));
    expect(saveQuiz.mock.calls[0][0]).toMatchObject({ id: 'qz-legacy', eventId: 'evt-b' });
    expect(patchQuizEventId).not.toHaveBeenCalled();
    await waitFor(() => expect(onUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-a', quizzes: [] })));
    // The move is visible immediately, regardless of the cleanup write's
    // own (undetectable) fate -- `legacyOnlyQuizzes` excludes any id the
    // fresh `quizzes` row already covers.
    expect(await screen.findByText(/· Nieuwe Mensdag/)).toBeInTheDocument();
  });

  it('shows the stranded-awards warning for a finished quiz, and not for a ready one', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [
        { id: 'qz-done', title: 'Klaar Quiz', eventId: null, status: 'finished', rounds: [], scores: { Bob: 3 } },
        { id: 'qz-ready', title: 'Verse Quiz', eventId: null, status: 'ready', rounds: [] },
      ],
    });
    render(<QuizShell scope="page" events={[]} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);
    await screen.findByText('Klaar Quiz');

    fireEvent.click(screen.getByRole('button', { name: 'Event-koppeling van Klaar Quiz' }));
    expect(screen.getByText(/al afgerond/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));

    fireEvent.click(screen.getByRole('button', { name: 'Event-koppeling van Verse Quiz' }));
    expect(screen.queryByText(/al afgerond/i)).not.toBeInTheDocument();
  });

  it('a failed link write rolls back the optimistic change and surfaces a retryable error -- never a silent no-op', async () => {
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Tafelquiz', eventId: null, status: 'ready', rounds: [] }],
    });
    const events = [{ id: 'evt-1', name: 'Kroegentocht', quizzes: [] }];
    patchQuizEventId.mockResolvedValueOnce({ ok: false, error: { message: 'boom' } });
    render(<QuizShell scope="page" events={events} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={() => {}} />);
    await screen.findByText('Tafelquiz');

    fireEvent.click(screen.getByRole('button', { name: 'Event-koppeling van Tafelquiz' }));
    fireEvent.change(screen.getByLabelText('Koppel aan event'), { target: { value: 'evt-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/kon niet worden opgeslagen/i);
    // Rolled back -- the row must still read "Losstaand", not the failed link.
    expect(screen.getByText(/· Losstaand/)).toBeInTheDocument();

    patchQuizEventId.mockResolvedValueOnce({ ok: true, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    await waitFor(() => expect(patchQuizEventId).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/· Kroegentocht/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('finishing a linked-but-standalone-managed quiz from this page publishes to its REAL linked event, not nowhere', async () => {
    // Before the link feature, every quiz presented from this page had
    // `eventId===null` by construction, so hardcoding `event: null` into
    // `finishQuiz` was correct. It stops being correct the moment a linked
    // quiz can be presented from here too (`openQuizRow`) -- finishing it
    // with `event: null` would compute placements and call `finishQuiz`
    // "successfully" while `pushWinnersToEvent` silently never runs.
    fetchQuizzes.mockResolvedValue({
      ok: true, error: null,
      quizzes: [{ id: 'qz-1', title: 'Gelinkte Quiz', eventId: 'evt-1', status: 'ready', rounds: [], teams: [] }],
    });
    const evt1 = { id: 'evt-1', name: 'Kroegentocht', quizzes: [] }; // NOT structurally embedded -> standalone-managed
    const onUpdateEvent = vi.fn();
    render(<QuizShell scope="page" events={[evt1]} users={[]} currentUser={{ role: 'org' }} can={CAN} teamSets={[]} onUpdateEvent={onUpdateEvent} />);
    await screen.findByText(/· Kroegentocht/);

    fireEvent.click(screen.getByRole('button', { name: 'Presenteer Gelinkte Quiz' }));
    fireEvent.click(await screen.findByText('stub-finish-presenter'));

    await waitFor(() => expect(finishQuiz).toHaveBeenCalledTimes(1));
    const call = finishQuiz.mock.calls[0][0];
    expect(call.event).toEqual(evt1);
    expect(call.onUpdateEvent).toBe(onUpdateEvent);
  });
});
