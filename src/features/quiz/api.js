// Quiz definition/archive data layer -- Supabase I/O for the `quizzes`
// table (docs/quiz-unification-spec.md §3.1, §8.1). Maps snake_case DB rows
// <-> the camelCase shape `model.js`'s `normalizeQuiz`/`blankQuiz` produce,
// at this one boundary -- nothing above it (QuizDashboard, QuizBuilder,
// QuizPresenter) should ever see `member_scores` vs `memberScores`
// inconsistency. Same idiom as `mensgames/api.js` for `tournaments` and
// `teamlib/api.js` for `team_sets`: full-row upsert (callers already hold
// the current object in local state), `{ok,error,...}` never-reject
// contract, and the same `isMissingTableError` classification mens-games
// added so a missing table reports as "not set up" rather than "check your
// connection".
//
// `rounds` is the bulk of the row (§3.1: "never read in the live loop") --
// this module is for the definition/archive path only. The hot live-quiz
// loop lives in `live.js`/`answers.js`, and the eager, tiny "list finished
// quizzes for stats" path lives in `results.js` with its own narrow
// projection. Nothing here is imported eagerly by App.jsx; it only loads as
// part of this feature's lazy chunk.
import { supabase } from '../../supabase.js';

const STATUSES = ['ready', 'live', 'finished'];

// Defensive against hand-edited JSONB: every array/object-shaped field is
// coerced rather than trusted, and a malformed row never throws -- it just
// degrades to a safe default, same rule `teamlib/api.js`'s `fromRow` uses.
function fromRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    title: row.title || '',
    eventId: row.event_id ?? null,
    status: STATUSES.includes(row.status) ? row.status : 'ready',
    rounds: Array.isArray(row.rounds) ? row.rounds : [],
    defaultTime: Number.isFinite(row.default_time) ? row.default_time : 30,
    introText: row.intro_text || '',
    introBg: row.intro_bg || '',
    teamSetId: row.team_set_id ?? null,
    teams: Array.isArray(row.teams) ? row.teams : [],
    participants: Array.isArray(row.participants) ? row.participants : [],
    scores: row.scores && typeof row.scores === 'object' ? row.scores : {},
    memberScores: row.member_scores && typeof row.member_scores === 'object' ? row.member_scores : {},
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
    rev: Number.isFinite(row.rev) ? row.rev : 1,
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    finishedAt: row.finished_at || null,
  };
}

function toRow(q) {
  return {
    id: q.id,
    title: (typeof q.title === 'string' && q.title.trim()) || 'Naamloze quiz',
    event_id: q.eventId ?? null,
    status: STATUSES.includes(q.status) ? q.status : 'ready',
    rounds: Array.isArray(q.rounds) ? q.rounds : [],
    default_time: Number.isFinite(q.defaultTime) ? q.defaultTime : 30,
    intro_text: q.introText || '',
    intro_bg: q.introBg || '',
    team_set_id: q.teamSetId ?? null,
    teams: Array.isArray(q.teams) ? q.teams : [],
    participants: Array.isArray(q.participants) ? q.participants : [],
    scores: q.scores && typeof q.scores === 'object' ? q.scores : {},
    member_scores: q.memberScores && typeof q.memberScores === 'object' ? q.memberScores : {},
    settings: q.settings && typeof q.settings === 'object' ? q.settings : {},
    rev: Number.isFinite(q.rev) ? q.rev : 1,
    created_by: q.createdBy || '',
    created_at: q.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    finished_at: q.finishedAt || null,
  };
}

// Distinguishes "this feature's tables haven't been migrated yet" from a
// genuine connectivity failure -- identical classification to
// `mensgames/api.js`'s `isMissingTableError` (2026-08-21g fix), duplicated
// here rather than imported cross-feature (matching the existing
// mensgames/teamlib precedent of each feature owning its own copy) so this
// module has no dependency on another feature's lazy chunk. `live.js`,
// `answers.js` and `results.js` import this one copy, since they're all
// part of the same `quiz` feature.
export function isMissingTableError(error) {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

export async function fetchQuizzes() {
  const { data, error } = await supabase
    .from('quizzes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchQuizzes failed:', error);
    return { ok: false, error, quizzes: [] };
  }
  return { ok: true, error: null, quizzes: (Array.isArray(data) ? data : []).map(fromRow).filter(Boolean) };
}

export async function fetchQuizzesForEvent(eventId) {
  const { data, error } = await supabase
    .from('quizzes')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchQuizzesForEvent failed:', error);
    return { ok: false, error, quizzes: [] };
  }
  return { ok: true, error: null, quizzes: (Array.isArray(data) ? data : []).map(fromRow).filter(Boolean) };
}

export async function fetchQuiz(id) {
  const { data, error } = await supabase.from('quizzes').select('*').eq('id', id).single();
  if (error) {
    console.error('fetchQuiz failed:', error);
    return { ok: false, error, quiz: null };
  }
  return { ok: true, error: null, quiz: fromRow(data) };
}

// App root / `liveWatch.js`'s discovery query (§4.2, §4.5) -- narrow on
// purpose: no `rounds`, so a phone that isn't even on the quiz yet never
// pays for the 33 kB definition just to learn one is live.
export async function fetchLiveQuizzes() {
  const { data, error } = await supabase
    .from('quizzes')
    .select('id,title,event_id')
    .eq('status', 'live');
  if (error) {
    console.error('fetchLiveQuizzes failed:', error);
    return { ok: false, error, liveQuizzes: [] };
  }
  return {
    ok: true,
    error: null,
    liveQuizzes: (Array.isArray(data) ? data : [])
      .filter(r => r && typeof r === 'object' && r.id)
      .map(r => ({ id: r.id, title: r.title || '', eventId: r.event_id ?? null })),
  };
}

// Full-row upsert -- matches `saveTournament`/`saveTeamSet`. Bumping `rev`
// on a definition change (§4.1, §4.3) is a caller decision (the builder's
// save flow, wired in a later work package), not this function's job; it
// persists whatever `rev` the caller passes (defaulting to 1 for a brand
// new quiz via `blankQuiz`).
export async function saveQuiz(quiz) {
  const row = toRow(quiz);
  const { error } = await supabase.from('quizzes').upsert([row]);
  if (error) {
    console.error('saveQuiz failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null, quiz: fromRow(row) };
}

export async function deleteQuiz(id) {
  const { error } = await supabase.from('quizzes').delete().eq('id', id);
  if (error) {
    console.error('deleteQuiz failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null };
}
