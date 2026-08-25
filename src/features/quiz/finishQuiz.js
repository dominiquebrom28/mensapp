// The quiz -> `quizzes` table / event / team-library write-back (docs/
// quiz-unification-spec.md §7.2, WP-Q6). "Afronden" (finish) on a quiz today
// only ever writes into `events.quizzes[]` (the legacy JSONB column,
// App.jsx-owned, out of scope here) -- `fetchQuizResults()` (WP-Q2) and the
// Hall of Fame never see it, and the awards system (`awards/
// publishResults.js`, WP-Q1) never fires. This module is what makes
// finishing a quiz mean something outside the dashboard that finished it:
//  - `quizzes.status`/`scores`/`member_scores`/`finished_at` get written so
//    a quiz played through the current Present flow is actually findable
//    (§3.4's whole justification for this work package).
//  - every medalled team/player gets a `Winner` row on the linked event
//    (`WinnersTab`/`HallOfFame`, zero changes to either) and every medalled
//    *team* additionally gets a `TeamAward` on its originating `team_sets`
//    row -- both via `awards/publishResults.js` (WP-Q1's source-agnostic
//    core), never a second copy of that write-back logic.
//  - a secret quiz (`quiz.settings.secret`) defers both of those writes,
//    exactly like `mensgames/finishTournament.js` does for a secret
//    tournament -- see `finishQuiz`'s own comment for why "afronden" and
//    "publish" are two different moments for one.
//
// This file is deliberately the thin adapter `finishTournament.js` already
// demonstrates the shape of: `quizPlacements` turns a finished quiz into the
// `Placement[]` shape `awards/publishResults.js` understands (team ->
// kind:'team' with library provenance; individual -> kind:'player'), and
// only `finishQuiz` itself does I/O. `quizPlacements`/`computeMemberScores`/
// `winnerRowsFromQuiz`/`buildTeamAwards` are pure, synchronous, and never
// throw on malformed input -- `quiz.teams`, `quiz.scores` and `teamSets` are
// all ultimately hand-editable JSONB, same posture as the tournament side.
import { patchQuiz, quizRowExists, saveQuiz } from './api.js';
import { deleteQuizLive } from './live.js';
import { deleteAnswersForQuiz } from './answers.js';
import { buildTeamAwards as buildTeamAwardsForSource, publishResults, winnerRowsFromPlacements } from '../awards/publishResults.js';

function isoOf(now) {
  return new Date(now).toISOString();
}

function safeQuizTitle(quiz) {
  return (quiz && typeof quiz.title === 'string' && quiz.title.trim()) || 'Quiz';
}

function quizIdOf(quiz) {
  return (quiz && typeof quiz.id === 'string' && quiz.id) || 'qz';
}

function quizEventId(quiz) {
  return (quiz && typeof quiz.eventId === 'string' && quiz.eventId) || null;
}

function toSource(quiz) {
  return { kind: 'quiz', id: quizIdOf(quiz), name: safeQuizTitle(quiz), eventId: quizEventId(quiz) };
}

function isSecretQuiz(quiz) {
  return !!(quiz && quiz.settings && quiz.settings.secret);
}

/**
 * Mode is derived, never a stored flag (§6: `isTeamQuiz = teams.length > 0`,
 * consistent with every other place in this codebase that makes the same
 * call -- `QuizPresenter.jsx`, `live.js`'s `is_team_quiz` column).
 */
export function isTeamQuiz(quiz) {
  return Array.isArray(quiz?.teams) && quiz.teams.length > 0;
}

/**
 * Team quiz: distribute each team's final score across its members -- the
 * existing App.jsx:2408-2412 logic (now `QuizDashboard.jsx`'s `onFinish`),
 * moved here verbatim rather than duplicated, so there is exactly one place
 * this happens. Individual quiz: `memberScores === scores`, already
 * username-keyed.
 *
 * **§6's `member_scores` bug, and why this function does not touch it:**
 * this write-side distribution has always been correct. The bug §6 flags is
 * on the *read* side -- `HallOfFame`'s per-person leaderboard (App.jsx:1025)
 * reads `scores` instead of `member_scores`, so a team quiz's team name
 * shows up on the individual board as if it were a lad. That's an
 * App.jsx-owned read, explicitly cut from this work package (§15 #7,
 * "HallOfFame member_scores fix -- pre-existing bug, can wait"), and
 * App.jsx is off limits here regardless. This function's only job is to
 * make sure `member_scores` is written *correctly* so that fix, whenever it
 * lands, has correct data to read.
 */
export function computeMemberScores(quiz, finalScores) {
  const scores = finalScores && typeof finalScores === 'object' ? finalScores : {};
  if (!isTeamQuiz(quiz)) return { ...scores };
  const memberScores = {};
  (quiz.teams || []).forEach((t) => {
    if (!t || typeof t !== 'object' || typeof t.name !== 'string') return;
    const pts = Number.isFinite(scores[t.name]) ? scores[t.name] : 0;
    (Array.isArray(t.members) ? t.members : []).forEach((m) => {
      if (typeof m !== 'string' || !m) return;
      memberScores[m] = (memberScores[m] || 0) + pts;
    });
  });
  return memberScores;
}

/**
 * Standard competition ranking (1-2-2-4, not 1-2-2-3): the same algorithm
 * `mensgames/standings.js`'s `computeStandings` already uses. Two rows tied
 * for 1st both come back at rank 1 and there is no rank 2 that round --
 * `quizPlacements` below then drops anything outside 1-3.
 */
function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  const out = [];
  let rank = 0;
  sorted.forEach((row, i) => {
    if (i === 0 || sorted[i - 1].points !== row.points) rank = i + 1;
    out.push({ ...row, rank });
  });
  return out;
}

/**
 * `quiz` (with its final `scores` already set -- see `finishQuiz`) ->
 * `Placement[]` (`awards/publishResults.js`'s source-agnostic shape). Team
 * quiz: one row per `quiz.teams` entry, `kind:'team'`, carrying whatever
 * library provenance (`teamSetId`/`sourceTeamId`) that team snapshot has --
 * which is `null` for a quiz built through the not-yet-shipped `TeamSetPicker`
 * (WP-Q5) or a quiz built before it, so `buildTeamAwards` simply won't award
 * a `TeamAward` for those (still-correct `Winner` rows on the event either
 * way; see this file's own report for the full reasoning). Individual quiz:
 * one row per `scores` entry, `kind:'player'`. Ties share a rank; only
 * ranks 1-3 survive.
 */
export function quizPlacements(quiz) {
  const scores = quiz && quiz.scores && typeof quiz.scores === 'object' ? quiz.scores : {};
  let rows;
  if (isTeamQuiz(quiz)) {
    rows = (quiz.teams || [])
      .filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.name.trim())
      .map((t) => {
        const name = t.name.trim();
        return {
          name,
          points: Number.isFinite(scores[name]) ? scores[name] : 0,
          kind: 'team',
          memberNames: Array.isArray(t.members) ? t.members.filter((m) => typeof m === 'string' && m) : [],
          teamSetId: typeof t.teamSetId === 'string' ? t.teamSetId : null,
          sourceTeamId: typeof t.sourceTeamId === 'string' ? t.sourceTeamId : null,
        };
      });
  } else {
    rows = Object.entries(scores)
      .filter(([name]) => typeof name === 'string' && name)
      .map(([name, points]) => ({
        name,
        points: Number.isFinite(points) ? points : 0,
        kind: 'player',
        memberNames: [],
        teamSetId: null,
        sourceTeamId: null,
      }));
  }
  return rankRows(rows)
    .filter((r) => r.rank >= 1 && r.rank <= 3)
    .map((r) => ({
      rank: r.rank,
      name: r.name,
      kind: r.kind,
      memberNames: r.memberNames,
      teamSetId: r.teamSetId,
      sourceTeamId: r.sourceTeamId,
      detail: `${r.points} punt${r.points === 1 ? '' : 'en'}`,
      slot: r.sourceTeamId || undefined,
    }));
}

export function winnerRowsFromQuiz(quiz) {
  return winnerRowsFromPlacements(toSource(quiz), quizPlacements(quiz));
}

export function buildTeamAwards(quiz, teamSets, opts = {}) {
  return buildTeamAwardsForSource(toSource(quiz), quizPlacements(quiz), teamSets, opts);
}

/**
 * The reveal-time publish (mirrors `finishTournament.js`'s
 * `publishTournamentResults`): pushes `Winner` rows onto the linked event
 * and a `TeamAward` onto every medalled team's originating team set. Called
 * either by `finishQuiz` itself (non-secret quiz) or, once a "🤫 Geheime
 * quiz" reveal action exists (see this file's own report -- no such UI
 * exists yet, since nothing today can even mark a quiz secret), by that
 * action once the owner lifts the secrecy.
 */
export async function publishQuizResults({ quiz, event = null, onUpdateEvent, teamSets = [], archiveWinningSets = false, now = Date.now() }) {
  return publishResults({ source: toSource(quiz), placements: quizPlacements(quiz), event, onUpdateEvent, teamSets, archiveWinningSets, now });
}

/**
 * Persist the finished quiz where the rest of the app can find it: a narrow
 * `.update()` via `api.js`'s `patchQuiz` -- never the full-row `saveQuiz`
 * upsert, which would re-send the ~33 kB `rounds` blob just to flip a status
 * flag (exactly what `patchQuiz` exists to avoid, §4.1).
 *
 * **The no-row trap.** The builder still only writes `events.quizzes[]`
 * (WP-Q5/Q7, not shipped yet) -- so a quiz built since §10.2's one-time
 * migration copy has NO row in the `quizzes` table at all, and `patchQuiz`'s
 * `.update().eq('id',…)` against zero matching rows is a silent, error-free
 * no-op (see that function's own comment). Finishing such a quiz through
 * `patchQuiz` alone would report success and persist nothing -- the exact
 * failure this work package exists to close (an end-to-end test caught this
 * once already tonight, on the discovery path). So: check whether the row
 * exists first (`quizRowExists`, one cheap `select id` -- a non-concern in a
 * once-per-quiz "Afronden" action the way it would be in the hot per-answer
 * path) and, if it's missing -- or the check itself fails, e.g. a transient
 * network blip; correctness wins over the wasted bytes on this rare branch
 * -- fall back to a full `saveQuiz` upsert. The caller already holds the
 * whole quiz object in memory (`rounds` included), so this is a one-time
 * seed, not a redesign.
 */
async function persistFinishedQuiz(finishedQuiz) {
  const existsRes = await quizRowExists(finishedQuiz.id);
  if (existsRes.ok && existsRes.exists) {
    return patchQuiz(finishedQuiz.id, {
      status: 'finished',
      scores: finishedQuiz.scores,
      memberScores: finishedQuiz.memberScores,
      finishedAt: finishedQuiz.finishedAt,
    });
  }
  return saveQuiz(finishedQuiz);
}

/**
 * The write-back itself (WP-Q6). Always finishes the quiz's own record
 * (`quizzes.status='finished'` + archived scores) -- "afronden" locks
 * scoring either way. When the quiz is secret, publishing is deferred: like
 * `finishTournament`, `events.winners` (every member, via WinnersTab/
 * HallOfFame) and `team_sets.awards` (every member, via the Team Trophy
 * Cabinet, also on Hall of Fame) are both visible surfaces that would spoil
 * the reveal the instant "Afronden" is clicked -- regardless of the quiz
 * row itself being reachable only from an editor's own dashboard. Not to be
 * confused with a round's own `secret` flag (App.jsx/QuizBuilder, hides
 * only that round's title) -- this is the whole quiz.
 *
 * `quiz.scores` is read as the FINAL scores for this finish -- the caller
 * (`QuizDashboard.jsx`'s `onFinish`) is expected to pass the quiz object
 * with the presenter's final `scores` already merged in, exactly as it
 * already merges `status`/`_liveState` today.
 */
export async function finishQuiz({ quiz, event = null, onUpdateEvent, teamSets = [], archiveWinningSets = false, now = Date.now() }) {
  const finalScores = quiz && quiz.scores && typeof quiz.scores === 'object' ? quiz.scores : {};
  const memberScores = computeMemberScores(quiz, finalScores);
  const finishedAt = isoOf(now);
  const finishedQuiz = { ...quiz, status: 'finished', scores: finalScores, memberScores, finishedAt, updatedAt: finishedAt };

  // Ephemeral live-play state must never survive a finish (§3.2, §4.1).
  // `QuizPresenter.jsx`'s own `clearLive()` already does this immediately
  // before calling `onFinish` -- these two calls are therefore normally a
  // harmless no-op (deleting rows already gone). Kept here too, defensively,
  // so a `finishQuiz` call from anywhere else (there is exactly one caller
  // today, but this module has no way to enforce that) can never leave a
  // stale live row or leaked pre-reveal answers behind.
  await Promise.all([deleteQuizLive(finishedQuiz.id), deleteAnswersForQuiz(finishedQuiz.id)]);

  const writeResult = await persistFinishedQuiz(finishedQuiz);
  const writeErrors = writeResult.ok ? [] : [{ scope: 'quiz', error: writeResult.error }];

  if (isSecretQuiz(quiz)) {
    const winners = winnerRowsFromQuiz(finishedQuiz);
    const teamAwards = buildTeamAwards(finishedQuiz, teamSets, { now });
    return { ok: writeResult.ok, quiz: finishedQuiz, winners, teamAwards, updatedTeamSets: [], errors: writeErrors, deferred: true };
  }

  const published = await publishQuizResults({ quiz: finishedQuiz, event, onUpdateEvent, teamSets, archiveWinningSets, now });
  return { ...published, quiz: finishedQuiz, errors: [...writeErrors, ...published.errors], ok: published.ok && writeResult.ok, deferred: false };
}
