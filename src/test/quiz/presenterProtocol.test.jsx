// The presenter's half of docs/quiz-unification-spec.md §4 (WP-Q4): every
// slide-navigation/state publish goes to the narrow `quiz_live` row (§3.2,
// upsert, no `rounds`/`answers`/`teams` riding along), current-slide
// answers are read from `quiz_answers` (§3.3) via a realtime subscription
// plus a 3s safety poll (§4.2), going live/ending flips `quizzes.status`
// through a narrow `.update()` (never the full-row `saveQuiz`), and none of
// it ever touches `events`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockTableData = {};
let calls = [];
let mockChannelCalls = [];

function makeSpyBuilder(table, result) {
  const builder = {};
  ['select', 'eq', 'insert', 'update', 'delete'].forEach(m => {
    builder[m] = (...args) => { calls.push({ table, method: m, args }); return builder; };
  });
  builder.upsert = (...args) => { calls.push({ table, method: 'upsert', args }); return builder; };
  builder.single = () => { calls.push({ table, method: 'single', args: [] }); return Promise.resolve(result); };
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  builder.catch = (reject) => Promise.resolve(result).catch(reject);
  return builder;
}

vi.mock('../../supabase.js', () => ({
  supabase: {
    from: (table) => makeSpyBuilder(table, mockTableData[table] ?? { data: [], error: null }),
    channel: (name) => {
      const handlers = [];
      const ch = {
        on: (event, filter, cb) => { handlers.push({ event, filter, cb }); return ch; },
        subscribe: () => ch,
      };
      mockChannelCalls.push({ name, handlers, ch });
      return ch;
    },
    removeChannel: vi.fn(),
  },
}));

const { QuizPresenter } = await import('../../features/quiz/QuizPresenter.jsx');

const quiz = {
  id: 'qz1', title: 'Pubquiz', rev: 1, teams: [],
  rounds: [{ id: 'r1', title: 'Round 1', questions: [{ q: 'How many?', type: 'multiple', options: ['One', 'Two'], answer: [0], points: 10 }] }],
};
const evt = { id: 'evt1', name: 'Event', attendees: [] };

beforeEach(() => {
  mockTableData = {};
  calls = [];
  mockChannelCalls = [];
});
afterEach(() => { vi.restoreAllMocks(); });

describe('presenter write path -- §4.1', () => {
  it('mounting flips quizzes.status to live via a narrow update, never touches events', async () => {
    render(<QuizPresenter quiz={quiz} evt={evt} onClose={() => {}} onFinish={() => {}} users={[]} />);
    await screen.findByText('Start Quiz →');
    expect(calls.some(c => c.table === 'quizzes' && c.method === 'update')).toBe(true);
    expect(calls.some(c => c.table === 'events')).toBe(false);
  });

  it('publishes slide state as a narrow quiz_live upsert -- no rounds/answers/teams riding along', async () => {
    render(<QuizPresenter quiz={quiz} evt={evt} onClose={() => {}} onFinish={() => {}} users={[]} />);
    await screen.findByText('Start Quiz →');
    const liveUpserts = calls.filter(c => c.table === 'quiz_live' && c.method === 'upsert');
    expect(liveUpserts.length).toBeGreaterThan(0);
    const row = liveUpserts[0].args[0][0];
    expect(row).toMatchObject({ quiz_id: 'qz1', phase: 'intro' });
    expect(row.rounds).toBeUndefined();
    expect(row.answers).toBeUndefined();
    expect(row.teams).toBeUndefined();
  });

  it('subscribes to quiz_answers and polls the current slide every 3s', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    try {
      render(<QuizPresenter quiz={quiz} evt={evt} onClose={() => {}} onFinish={() => {}} users={[]} />);
      await screen.findByText('Start Quiz →');
      expect(mockChannelCalls.some(c => c.name === 'quiz-answers-qz1')).toBe(true);
      expect(intervalSpy.mock.calls.some(([, ms]) => ms === 3000)).toBe(true);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('also subscribes to its own quiz_live row, for the presenter-claim check (§4.4)', async () => {
    render(<QuizPresenter quiz={quiz} evt={evt} onClose={() => {}} onFinish={() => {}} users={[]} />);
    await screen.findByText('Start Quiz →');
    expect(mockChannelCalls.some(c => c.name === 'quiz-live-qz1')).toBe(true);
  });

  it('Exit deletes quiz_live + quiz_answers and reverts status to ready -- never touches events', async () => {
    const onClose = vi.fn();
    render(<QuizPresenter quiz={quiz} evt={evt} onClose={onClose} onFinish={() => {}} users={[]} />);
    await screen.findByText('Start Quiz →');
    calls.length = 0; // isolate the close action from mount-time noise

    fireEvent.click(screen.getByText(/Exit/));

    expect(calls.some(c => c.table === 'quiz_live' && c.method === 'delete')).toBe(true);
    expect(calls.some(c => c.table === 'quiz_answers' && c.method === 'delete')).toBe(true);
    expect(calls.some(c => c.table === 'quizzes' && c.method === 'update')).toBe(true);
    expect(calls.some(c => c.table === 'events')).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
