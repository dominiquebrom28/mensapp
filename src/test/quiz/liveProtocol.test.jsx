// WP-Q4's acceptance criterion, verbatim from docs/quiz-unification-spec.md
// §4.1: "a participant writes exactly one thing -- one row into
// `quiz_answers`, by upsert, with no read first. Nothing else, ever." This
// is the guard rail for §2's whole thesis (39.3 kB read + 39.3 kB write per
// answer, today, vs. ~150 bytes, one upsert, here) -- asserted against a
// spying Supabase mock, not by reading the source.
//
// Also covers the rest of §4.2's participant half of the protocol: the 5s
// `quiz_live` safety poll, the `quiz_rev`-gated definition refetch (§4.3),
// and that a participant never subscribes to `quiz_answers` at all (the
// other half of closing the pre-reveal leak -- not fetching everyone else's
// answer is only half the story if you're still subscribed to it).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockTableData = {};
let calls = [];
let mockChannelCalls = [];

// Same hand-built spy builder as answers.test.js -- logs every method call
// so a test can assert on the *sequence and table* of Supabase calls, not
// just the end result.
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

const QuizParticipantView = (await import('../../features/quiz/QuizParticipantView.jsx')).default;

const liveRow = {
  quiz_id: 'qz1', quiz_rev: 1, event_id: null, phase: 'question', round_idx: 0, q_idx: 0,
  slide_phase: 'question', scores: {}, summary_revealed: [], pause_config: {},
  timer_started_at: null, timer_limit: null, is_team_quiz: false, presenter_id: 'presenter-1',
  updated_at: '2026-08-26T00:00:00Z',
};

const liveQ = {
  id: 'qz1', title: 'Pubquiz', rev: 1, teams: [],
  rounds: [{ id: 'r1', title: 'Round 1', questions: [{ q: 'How many?', type: 'multiple', options: ['One', 'Two'], answer: [0], points: 10 }] }],
};
const currentUser = { username: 'sander' };
const memberCan = { hostQuiz: () => false };

beforeEach(() => {
  mockTableData = {
    quiz_live: { data: [liveRow], error: null },
    quiz_answers: { data: [], error: null }, // no existing own answer
  };
  calls = [];
  mockChannelCalls = [];
});

describe('participant answer write path -- §4.1 acceptance criterion', () => {
  it('answering writes exactly one quiz_answers upsert and never touches `events`', async () => {
    render(<QuizParticipantView liveQ={liveQ} currentUser={currentUser} users={[]} can={memberCan} onHide={() => {}} />);
    await screen.findByText(/One/);

    // Mounting alone (own-answer read, live-state read, subscriptions) must
    // never touch `events` -- the whole point of moving off the event row.
    expect(calls.some(c => c.table === 'events')).toBe(false);

    const before = calls.length;
    fireEvent.click(screen.getByText(/One/));
    const during = calls.slice(before);

    expect(during).toHaveLength(1);
    expect(during[0].table).toBe('quiz_answers');
    expect(during[0].method).toBe('upsert');
    const [rows] = during[0].args;
    expect(rows[0]).toMatchObject({ quiz_id: 'qz1', round_idx: 0, q_idx: 0, answer_key: 'p:sander', value: [0] });

    // Still nothing on `events`, post-answer.
    expect(calls.some(c => c.table === 'events')).toBe(false);
  });

  it('the answer key is the stable, lowercased `p:<username>` form, not the mutable display name', async () => {
    render(<QuizParticipantView liveQ={liveQ} currentUser={{ username: 'Sander' }} users={[]} can={memberCan} onHide={() => {}} />);
    fireEvent.click(await screen.findByText(/One/));
    const upsertCall = calls.find(c => c.table === 'quiz_answers' && c.method === 'upsert');
    expect(upsertCall.args[0][0].answer_key).toBe('p:sander');
  });
});

describe('quiz_live: realtime + 5s safety poll (§4.2), no quiz_answers subscription', () => {
  it('subscribes only to quiz_live -- never to quiz_answers', async () => {
    render(<QuizParticipantView liveQ={liveQ} currentUser={currentUser} users={[]} can={memberCan} onHide={() => {}} />);
    await screen.findByText(/One/);
    expect(mockChannelCalls.some(c => c.name === 'quiz-live-qz1')).toBe(true);
    expect(mockChannelCalls.some(c => c.name.startsWith('quiz-answers'))).toBe(false);
  });

  it('polls the quiz_live row every 5s, not the 2s the old event-poll used', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    try {
      render(<QuizParticipantView liveQ={liveQ} currentUser={currentUser} users={[]} can={memberCan} onHide={() => {}} />);
      await screen.findByText(/One/);
      expect(intervalSpy.mock.calls.some(([, ms]) => ms === 5000)).toBe(true);
      expect(intervalSpy.mock.calls.some(([, ms]) => ms === 2000)).toBe(false);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('polls its own answer every 3s while unsubmitted, via setTimeout (one-shot + re-arm, not setInterval)', async () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    try {
      render(<QuizParticipantView liveQ={liveQ} currentUser={currentUser} users={[]} can={memberCan} onHide={() => {}} />);
      await screen.findByText(/One/);
      expect(timeoutSpy.mock.calls.some(([, ms]) => ms === 3000)).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});

describe('definition refresh only on a `quiz_rev` bump (§4.3)', () => {
  it('does not refetch the definition while quiz_rev is unchanged', async () => {
    render(<QuizParticipantView liveQ={liveQ} currentUser={currentUser} users={[]} can={memberCan} onHide={() => {}} />);
    await screen.findByText(/One/);
    expect(calls.some(c => c.table === 'quizzes')).toBe(false);
  });

  it('refetches the full definition once quiz_live.quiz_rev bumps past what we have', async () => {
    mockTableData.quizzes = {
      data: {
        id: 'qz1', title: 'Pubquiz v2', event_id: null, status: 'live',
        rounds: liveQ.rounds, default_time: 30, intro_text: '', intro_bg: '',
        team_set_id: null, teams: [], participants: [], scores: {}, member_scores: {},
        settings: {}, rev: 2, created_by: '', created_at: '', updated_at: '', finished_at: null,
      },
      error: null,
    };
    render(<QuizParticipantView liveQ={liveQ} currentUser={currentUser} users={[]} can={memberCan} onHide={() => {}} />);
    await screen.findByText(/One/);

    const liveChannel = mockChannelCalls.find(c => c.name === 'quiz-live-qz1');
    const updateHandler = liveChannel.handlers.find(h => h.filter.event === 'UPDATE');
    updateHandler.cb({ new: { ...liveRow, quiz_rev: 2 } });

    await screen.findByText('Pubquiz v2');
    expect(calls.some(c => c.table === 'quizzes')).toBe(true);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
