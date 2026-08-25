// `quiz_answers` data layer -- one row per answer (docs/
// quiz-unification-spec.md §3.3, §4). **This module is the production bug
// fix** (§1, §2): `upsertAnswer` below is a composite-PK upsert with no
// read beforehand. Fifteen concurrent phones writing their own
// `(quiz_id, round_idx, q_idx, answer_key)` row each can never clobber
// another team's answer, and never has to download the 39 kB event row (or
// even the 33 kB quiz `rounds`) just to change one field and write it back.
// Everything else in this file is scaffolding around that one property.
//
// `answer_key` is `t:<sourceTeamId>` or `p:<username lowercased>` (§3.3) --
// a stable id, not the mutable, user-typed team *name* the old write path
// keyed on. Building that string is the caller's job (it needs the current
// team snapshot / logged-in username, which this data-layer module has no
// business knowing about); this file only ever treats `answerKey` as an
// opaque string.
import { supabase } from '../../supabase.js';

function fromRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    quizId: row.quiz_id,
    roundIdx: Number.isFinite(row.round_idx) ? row.round_idx : 0,
    qIdx: Number.isFinite(row.q_idx) ? row.q_idx : 0,
    answerKey: row.answer_key || '',
    value: Array.isArray(row.value) ? row.value : [],
    updatedAt: row.updated_at || '',
  };
}

function toRow(a) {
  return {
    quiz_id: a.quizId,
    round_idx: Number.isFinite(a.roundIdx) ? a.roundIdx : 0,
    q_idx: Number.isFinite(a.qIdx) ? a.qIdx : 0,
    answer_key: a.answerKey || '',
    value: Array.isArray(a.value) ? a.value : [],
    updated_at: new Date().toISOString(),
  };
}

/**
 * The whole point of this module (§2.3, §15 "never cut, priority 1"). One
 * row, one upsert, **no read beforehand** -- structurally impossible to
 * lose another writer's answer the way the old read-modify-write on the
 * 39 kB event row could. `onConflict` is spelled out explicitly (rather
 * than relying on "no `onConflict` targets the PK by default") so this
 * property survives even if the table's PK definition is ever touched
 * without this file being read first.
 *
 * Wire payload for one call: `{quiz_id, round_idx, q_idx, answer_key,
 * value, updated_at}` -- measured at ~130-150 bytes (0.13-0.15 kB) as JSON
 * for a realistic id/value, comfortably under the spec's ~0.2 kB estimate.
 */
export async function upsertAnswer({ quizId, roundIdx, qIdx, answerKey, value }) {
  const row = toRow({ quizId, roundIdx, qIdx, answerKey, value });
  const { error } = await supabase
    .from('quiz_answers')
    .upsert([row], { onConflict: 'quiz_id,round_idx,q_idx,answer_key' });
  if (error) {
    console.error('upsertAnswer failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null, answer: fromRow(row) };
}

/**
 * Presenter aggregation (§4.1, §4.2): "current slide's answers every 3 s"
 * plus the realtime subscription below. There is deliberately no single
 * "the answers" object to read -- the presenter assembles ~15 rows itself
 * (§16's accepted tradeoff for the composite-PK upsert).
 */
export async function fetchAnswersForSlide(quizId, roundIdx, qIdx) {
  const { data, error } = await supabase
    .from('quiz_answers')
    .select('*')
    .eq('quiz_id', quizId)
    .eq('round_idx', roundIdx)
    .eq('q_idx', qIdx);
  if (error) {
    console.error('fetchAnswersForSlide failed:', error);
    return { ok: false, error, answers: [] };
  }
  return { ok: true, error: null, answers: (Array.isArray(data) ? data : []).map(fromRow).filter(Boolean) };
}

/**
 * Participant's own-answer read (§4.2: "own answer only, on question
 * change | one shot + 3 s while unsubmitted") -- deliberately narrow to one
 * `answer_key`, never the whole slide. Participants must never see anyone
 * else's answer before the reveal (§4.2's closed leak); this function
 * structurally can't return one, since the caller has no way to ask for a
 * key that isn't their own. No `.single()` for the same "zero rows isn't
 * an error" reason as `live.js`'s `fetchQuizLive` -- an unanswered question
 * has no row yet.
 */
export async function fetchOwnAnswer(quizId, roundIdx, qIdx, answerKey) {
  const { data, error } = await supabase
    .from('quiz_answers')
    .select('*')
    .eq('quiz_id', quizId)
    .eq('round_idx', roundIdx)
    .eq('q_idx', qIdx)
    .eq('answer_key', answerKey);
  if (error) {
    console.error('fetchOwnAnswer failed:', error);
    return { ok: false, error, answer: null };
  }
  const rows = Array.isArray(data) ? data : [];
  return { ok: true, error: null, answer: rows.length ? fromRow(rows[0]) : null };
}

// End Session / reset (§4.1) -- wipes every answer for this quiz so a
// re-presented quiz starts clean. Paired with `live.js`'s `deleteQuizLive`.
export async function deleteAnswersForQuiz(quizId) {
  const { error } = await supabase.from('quiz_answers').delete().eq('quiz_id', quizId);
  if (error) {
    console.error('deleteAnswersForQuiz failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null };
}

/**
 * Presenter's realtime feed (§4.2): INSERT/UPDATE on `quiz_answers`,
 * filtered to this quiz only -- never scoped down to (round_idx, q_idx) at
 * the subscription level, since Supabase realtime filters are single
 * equality columns; the presenter filters to "the current slide's answers"
 * client-side from `onChange`'s payload. **Participants deliberately do
 * not get an equivalent subscription** (§4.2) -- that's the second half of
 * closing the pre-reveal leak, and it means this function is presenter-only
 * by convention, not by any enforcement this file can provide (§12: no
 * server-side authorization exists in this app).
 */
export function subscribeAnswers(quizId, onChange) {
  const channel = supabase
    .channel(`quiz-answers-${quizId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quiz_answers', filter: `quiz_id=eq.${quizId}` }, ({ new: row }) => {
      if (row) onChange(fromRow(row));
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quiz_answers', filter: `quiz_id=eq.${quizId}` }, ({ new: row }) => {
      if (row) onChange(fromRow(row));
    })
    .subscribe();
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    supabase.removeChannel(channel);
  };
}
