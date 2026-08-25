// `quiz_live` data layer -- the hot, narrow, broadcast row (docs/
// quiz-unification-spec.md §3.2, §4). This table exists only while a quiz
// is live and carries **no questions, no answers** -- that's the whole
// point of splitting it out of `quizzes` (§2.3): a presenter's slide change
// or a score update broadcasts ~0.5-1 kB to every connected phone instead
// of the 33 kB `rounds` blob riding along on every `postgres_changes`
// payload. Same snake_case<->camelCase boundary convention as `api.js`.
//
// `fetchQuizLive` deliberately doesn't use `.single()` -- a quiz that isn't
// live yet (or just had its live row deleted on End Session) has *no* row,
// and `.single()` treats zero rows as an error (`PGRST116`) rather than a
// clean "nothing here". Selecting a set and taking the first element keeps
// "not live" and "a real fetch failure" distinguishable without leaning on
// a mock/PostgREST feature (`maybeSingle`) other modules in this codebase
// don't already rely on.
import { supabase } from '../../supabase.js';

const PHASES = ['intro', 'round-intro', 'question', 'pause', 'round-summary', 'round-scores', 'final'];

function fromRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    quizId: row.quiz_id,
    quizRev: Number.isFinite(row.quiz_rev) ? row.quiz_rev : 1,
    eventId: row.event_id ?? null,
    phase: PHASES.includes(row.phase) ? row.phase : 'intro',
    roundIdx: Number.isFinite(row.round_idx) ? row.round_idx : 0,
    qIdx: Number.isFinite(row.q_idx) ? row.q_idx : 0,
    slidePhase: row.slide_phase || 'question',
    scores: row.scores && typeof row.scores === 'object' ? row.scores : {},
    summaryRevealed: Array.isArray(row.summary_revealed) ? row.summary_revealed : [],
    pauseConfig: row.pause_config && typeof row.pause_config === 'object' ? row.pause_config : {},
    timerStartedAt: Number.isFinite(row.timer_started_at) ? row.timer_started_at : null,
    timerLimit: Number.isFinite(row.timer_limit) ? row.timer_limit : null,
    isTeamQuiz: row.is_team_quiz === true,
    presenterId: row.presenter_id || '',
    updatedAt: row.updated_at || '',
  };
}

function toRow(ls) {
  return {
    quiz_id: ls.quizId,
    quiz_rev: Number.isFinite(ls.quizRev) ? ls.quizRev : 1,
    event_id: ls.eventId ?? null,
    phase: PHASES.includes(ls.phase) ? ls.phase : 'intro',
    round_idx: Number.isFinite(ls.roundIdx) ? ls.roundIdx : 0,
    q_idx: Number.isFinite(ls.qIdx) ? ls.qIdx : 0,
    slide_phase: ls.slidePhase || 'question',
    scores: ls.scores && typeof ls.scores === 'object' ? ls.scores : {},
    summary_revealed: Array.isArray(ls.summaryRevealed) ? ls.summaryRevealed : [],
    pause_config: ls.pauseConfig && typeof ls.pauseConfig === 'object' ? ls.pauseConfig : {},
    timer_started_at: Number.isFinite(ls.timerStartedAt) ? ls.timerStartedAt : null,
    timer_limit: Number.isFinite(ls.timerLimit) ? ls.timerLimit : null,
    is_team_quiz: ls.isTeamQuiz === true,
    presenter_id: ls.presenterId || '',
    updated_at: new Date().toISOString(),
  };
}

export async function fetchQuizLive(quizId) {
  const { data, error } = await supabase.from('quiz_live').select('*').eq('quiz_id', quizId);
  if (error) {
    console.error('fetchQuizLive failed:', error);
    return { ok: false, error, quizLive: null };
  }
  const rows = Array.isArray(data) ? data : [];
  return { ok: true, error: null, quizLive: rows.length ? fromRow(rows[0]) : null };
}

// Presenter's narrow update (§4.1: ~120x/night, ≈1 kB) and the initial
// "go live" write (creates the row, `presenter_id` = this session's claim,
// §4.4). Plain upsert on the `quiz_id` primary key -- one writer at a time
// in the intended flow, so a full-row upsert is fine here (unlike
// `answers.js`, there's no concurrent-writer race this table needs to
// avoid).
export async function upsertQuizLive(liveState) {
  const row = toRow(liveState);
  const { error } = await supabase.from('quiz_live').upsert([row]);
  if (error) {
    console.error('upsertQuizLive failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null, quizLive: fromRow(row) };
}

// End Session / reset (§4.1) -- the live row and all its answers
// (`answers.js`'s `deleteAnswersForQuiz`) both get dropped so a re-presented
// quiz starts clean.
export async function deleteQuizLive(quizId) {
  const { error } = await supabase.from('quiz_live').delete().eq('quiz_id', quizId);
  if (error) {
    console.error('deleteQuizLive failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null };
}

/**
 * Participant subscription (§4.2): UPDATE/DELETE only, filtered to this
 * quiz's row -- mirrors `mensgames/api.js`'s `subscribeTournament`. No
 * INSERT here on purpose: a participant only starts watching a specific
 * `quiz_id` after learning it's live via `subscribeLiveQuizFeed`/the
 * banner, by which point the row already exists. `onChange` receives the
 * updated live state (already through `fromRow`), or `null` on DELETE (End
 * Session) so the caller can drop the participant back out of the overlay
 * instead of operating on a ghost row.
 */
export function subscribeQuizLive(quizId, onChange) {
  const channel = supabase
    .channel(`quiz-live-${quizId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quiz_live', filter: `quiz_id=eq.${quizId}` }, ({ new: row }) => {
      if (row) onChange(fromRow(row));
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'quiz_live', filter: `quiz_id=eq.${quizId}` }, () => {
      onChange(null);
    })
    .subscribe();
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    supabase.removeChannel(channel);
  };
}

/**
 * App-root discovery feed (§4.2, §4.5): INSERT/DELETE on `quiz_live` with
 * **no filter** -- any quiz going live or ending anywhere fires this.
 * `liveWatch.js`'s `useLiveQuizWatch()` uses it purely as a "something
 * changed, go refetch `fetchLiveQuizzes()`" signal (this table doesn't
 * carry a title, so the payload itself is intentionally not passed
 * through). Returns an idempotent unsubscribe, same as every other
 * channel helper in this codebase.
 */
export function subscribeLiveQuizFeed(onChange) {
  const channel = supabase
    .channel('quiz-live-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quiz_live' }, () => onChange())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'quiz_live' }, () => onChange())
    .subscribe();
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    supabase.removeChannel(channel);
  };
}
