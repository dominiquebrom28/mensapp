// Eager, tiny -- imported by App.jsx directly, NOT part of the lazy quiz
// chunk (docs/quiz-unification-spec.md §8.1, mirrors `teamlib/api.js`'s
// reasoning for its own eager exports). `fetchQuizResults()` feeds
// `computeMemberStats`/`HallOfFame` at boot, so it must project columns
// explicitly -- never `select *` -- to keep a finished quiz at ~1 kB
// instead of ~33 kB of `rounds`. It also must **never reject**: the App
// boot `Promise.all` (App.jsx, alongside `fetchTeamSets`) depends on that,
// and `App.quizResultsError.test.jsx`-style coverage guards it below.
import { supabase } from '../../supabase.js';
import { isMissingTableError } from './api.js';

export { isMissingTableError };

function fromResultRow(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  return {
    id: row.id,
    title: row.title || '',
    eventId: row.event_id ?? null,
    status: row.status || 'finished',
    teams: Array.isArray(row.teams) ? row.teams : [],
    scores: row.scores && typeof row.scores === 'object' ? row.scores : {},
    memberScores: row.member_scores && typeof row.member_scores === 'object' ? row.member_scores : {},
    finishedAt: row.finished_at || null,
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
  };
}

/**
 * Column projection only -- `id,title,event_id,status,teams,scores,
 * member_scores,finished_at,settings`, deliberately excluding `rounds`
 * (the ~33 kB field). ~1 kB per finished quiz. Never rejects: a Supabase
 * error (including a missing-table error pre-migration) resolves to
 * `{ok:false,error,quizResults:[]}`, exactly like `fetchTeamSets` in
 * `teamlib/api.js` -- callers that need to tell "not set up" apart from
 * "network problem" use the re-exported `isMissingTableError(error)`.
 */
export async function fetchQuizResults() {
  try {
    const { data, error } = await supabase
      .from('quizzes')
      .select('id,title,event_id,status,teams,scores,member_scores,finished_at,settings')
      .eq('status', 'finished');
    if (error) {
      console.error('fetchQuizResults failed:', error);
      return { ok: false, error, quizResults: [] };
    }
    return { ok: true, error: null, quizResults: (Array.isArray(data) ? data : []).map(fromResultRow).filter(Boolean) };
  } catch (error) {
    // Belt-and-braces: a hard network throw (not a resolved {error}) must
    // still resolve, never reject -- the boot `Promise.all` has no `.catch`
    // per-item, only one at the very end for a genuinely unreachable app.
    console.error('fetchQuizResults threw:', error);
    return { ok: false, error, quizResults: [] };
  }
}
