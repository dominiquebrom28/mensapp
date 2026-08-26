// Pure quiz data model -- no React, no Supabase, no DOM (docs/
// quiz-unification-spec.md §8.1). `ALPHA`, `blankQuestion`, `TEAM_AVATARS`,
// `normalizeQuiz`, `ROUND_ICONS`, `TYPE_META` and `fmtTime` are moved out of
// App.jsx **verbatim** (§8.3 "moved out and re-exported") -- this is a
// relocation, not a redesign, so App.jsx re-exports them from here instead
// of a second copy drifting into existence. `blankQuiz` and
// `teamsFromTeamSet` are new, mirroring the equivalent builders in
// `mensgames/model.js` (`blankTournament`, `entrantsFromTeamSet`) for the
// same reasons: an injectable `now`/`Date.now()` default so tests get a
// reproducible id, and a teams-library **snapshot** (not a live reference)
// per §5.3 -- `quizzes.scores` is name-keyed, so a rename in the library
// after the snapshot must never orphan a finished quiz's results.
//
// `buildLegacyImportPlan`/`buildLegacyTeamSetDraft` (2026-08-26, owner brief:
// "give the owner a way to bring a legacy quiz's teams into the Team Creator
// library") are the pure half of that flow -- everything a legacy quiz's
// `teams[]` (built by the deleted inline builder, §5.1, so never carrying
// `teamSetId`/`sourceTeamId`) needs to become a real `team_sets` row, or to
// be recognised as one that already exists. `TeamSetPicker.jsx` owns the one
// Supabase write (`saveTeamSet`) and the explicit-action UI around it; this
// module only ever decides *what* to write, never whether to.
import { blankTeamSet } from '../teamlib/model.js';

export const ALPHA = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const TEAM_AVATARS = [
  '🦁', '🐻', '🦊', '🐺', '🦅', '🐉', '🦄', '🐯', '🦈', '🦜', '🐸', '🦀', '🐙', '🦋',
  '🐊', '🦏', '🦖', '🎭', '⚡', '🔥', '💎', '👑', '🎸', '🏆', '🎪', '🦝', '🐬', '🦓',
];

export const ROUND_ICONS = [
  '🎯', '🎵', '🧠', '🌍', '🎬', '🍺', '⚽', '🔬', '🎨', '🏆',
  '🎭', '🌟', '🍕', '🚀', '🦁', '🎸', '🏎️', '💡', '🎲', '🌈',
];

export const TYPE_META = {
  multiple: { label: 'Multiple Choice', icon: '🔤', color: 'var(--blue)', bg: 'rgba(91,155,213,.1)', border: 'rgba(91,155,213,.28)' },
  open: { label: 'Open', icon: '💬', color: 'var(--green)', bg: 'rgba(76,175,125,.1)', border: 'rgba(76,175,125,.28)' },
  music: { label: 'Music', icon: '🎵', color: 'var(--purple)', bg: 'rgba(155,127,232,.12)', border: 'rgba(155,127,232,.28)' },
};

export const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const blankQuestion = (type = 'multiple') => ({
  type,
  q: '',
  // multiple choice
  options: ['', '', '', ''],
  answer: [0],
  // open
  openAnswer: '',
  // music
  songUrl: '',
  songStartSeconds: 0,
  songPlaySeconds: 30,
  songArtist: '',
  songTitle: '',
  // common
  points: 10,
  timeLimit: null,
  image: null,
});

// Backwards-compat: old quizzes had flat `questions`, new ones use `rounds`.
export const normalizeQuiz = q => {
  const normAnswer = a => (Array.isArray(a) ? a : (a != null ? [a] : [0]));
  const withType = qs => (qs || []).map(q => ({
    ...q,
    type: q.type || 'multiple',
    answer: normAnswer(q.answer),
    openAnswer: q.openAnswer || '',
    songUrl: q.songUrl || '',
    songStartSeconds: q.songStartSeconds || 0,
    songPlaySeconds: q.songPlaySeconds || 30,
    songArtist: q.songArtist || '',
    songTitle: q.songTitle || '',
  }));
  const normTeams = (ts = []) => ts.map((t, i) => ({ avatar: TEAM_AVATARS[i % TEAM_AVATARS.length], ...t }));
  if (q.rounds) {
    return {
      ...q,
      teams: normTeams(q.teams),
      rounds: q.rounds.map(r => ({ icon: '🎯', description: '', bgImage: null, secret: false, ...r, questions: withType(r.questions) })),
    };
  }
  return {
    ...q,
    teams: normTeams(q.teams),
    defaultTime: 30,
    rounds: [{ id: 'r0', title: 'Round 1', theme: '', icon: '🎯', description: '', bgImage: null, secret: false, questions: withType(q.questions) }],
  };
};

/**
 * Defensive clamp for a `quiz_answers.value` array (docs/
 * quiz-unification-spec.md §12 trust boundary: "a hand-crafted `[999]` must
 * score zero, not throw"). No server-side authorization exists on this
 * table (§12), so any client can write any JSONB into `value` -- this
 * coerces whatever comes back over the wire (realtime payload, poll, or an
 * own-answer read) into an array of option indices inside
 * `[0, optionCount)`, silently dropping anything else, before it's used to
 * render a count or decide a score.
 */
export const clampAnswerValue = (value, optionCount) =>
  (Array.isArray(value) ? value : [])
    .map(v => Number(v))
    .filter(v => Number.isInteger(v) && v >= 0 && v < optionCount);

function isoOf(now) {
  return new Date(now).toISOString();
}

function blankRound(now) {
  return { id: `r${now}`, title: 'Round 1', theme: '', icon: '🎯', description: '', bgImage: null, secret: false, questions: [blankQuestion()] };
}

/**
 * A brand-new, empty quiz (spec §3.1). `now` is injectable so tests (and
 * the "Copy of ..." / re-create flows) get a reproducible id, same
 * convention as `mensgames/model.js`'s `blankTournament`.
 */
export const blankQuiz = ({ title = '', eventId = null, createdBy = '', now = Date.now() } = {}) => ({
  id: `qz${now}`,
  title: (typeof title === 'string' && title.trim()) || 'Naamloze quiz',
  eventId: eventId ?? null,
  status: 'ready',
  rounds: [blankRound(now)],
  defaultTime: 30,
  introText: '',
  introBg: '',
  teamSetId: null,
  teams: [],
  participants: [],
  scores: {},
  memberScores: {},
  settings: { secret: false, published: false },
  rev: 1,
  createdBy: typeof createdBy === 'string' ? createdBy : '',
  createdAt: isoOf(now),
  updatedAt: isoOf(now),
  finishedAt: null,
});

/**
 * Materialises `quiz.teams` from a `team_sets` row (§5.2/§5.3) -- a
 * snapshot **copy**, not a live reference. Keeps the team's own library id
 * (quiz `scores`/UI already key off it as a React key and via
 * `captain`/`members`), and stamps `sourceTeamId` + `teamSetId` provenance
 * alongside it so the live-answer hot path (§3.3: `answer_key = "t:" +
 * sourceTeamId`) has a stable id to write against even though the archive
 * (`quizzes.scores`) stays name-keyed. Defensive against a hand-edited
 * team_sets row: skips any team missing a usable `id`, coerces `members`
 * to an array of strings, falls back to a numbered avatar/name.
 */
/**
 * A stable identifier for a `quiz.teams` entry -- prefers the library id
 * (`sourceTeamId`, or the snapshot's own `id`, which `teamsFromTeamSet` sets
 * to the same value), and only falls back to the team's `name` for a legacy
 * team that predates library provenance entirely (§5.1: the old inline team
 * builder never stamped an id). Exported so `resolveQuizWinner` below and
 * the Winner tab UI (docs/quiz-unification-spec.md's Winner-tab brief,
 * 2026-08-26) key/match on exactly the same thing -- a team picked as the
 * winner must still resolve after "↻ Ververs uit bibliotheek" changes its
 * `name` (the whole reason the brief insists on a stable id, never a name,
 * for `settings.winner.teamId`).
 */
export function teamStableId(team) {
  if (!team || typeof team !== 'object') return null;
  if (typeof team.id === 'string' && team.id) return team.id;
  if (typeof team.sourceTeamId === 'string' && team.sourceTeamId) return team.sourceTeamId;
  if (typeof team.name === 'string' && team.name.trim()) return team.name.trim();
  return null;
}

/**
 * The one place "who won this quiz" is decided (docs/
 * quiz-unification-spec.md's Winner-tab brief, 2026-08-26). The new Winner
 * tab's own preview, `WinnersTab` (App.jsx) and `finishQuiz.js`'s placement/
 * award path all call this and only this -- if any of the three ever
 * derived a winner independently, the builder's preview, the event's
 * Winners & Highlights tab and the published award could each show a
 * different name for the same quiz.
 *
 * `quiz.settings.winner` (jsonb, additive, no migration) is the override:
 * `{ mode:'auto'|'team'|'manual', teamId, name, detail }`. Absent, `null`,
 * or `mode:'auto'` all mean the same thing -- "derive from scores, as
 * before" -- so switching back to Automatisch and simply never having set
 * an override look identical to every caller.
 *
 * Returns `null` when there is nothing to show yet: no override AND no
 * scores. Callers render an honest empty state for that ("de winnaar
 * verschijnt zodra de quiz is afgerond"), never a broken-looking one.
 *
 * The brief's literal return shape is `{name, detail, avatar, source}`, and
 * those four are always present and mean exactly what it says. This returns
 * a superset -- `kind`/`memberNames`/`teamSetId`/`sourceTeamId` in addition
 * -- because `finishQuiz.js`'s `quizPlacements` needs that provenance to
 * build a correct `TeamAward` for a team override (§3.4 needs a
 * `teamSetId`/`sourceTeamId` pair, which a bare name can't supply), and the
 * brief names no second place that data could legitimately come from
 * without re-deriving the winner a second time -- the exact drift this
 * function exists to prevent. Callers that only care about the four
 * documented fields simply ignore the rest.
 */
export function resolveQuizWinner(quiz) {
  const settings = quiz && quiz.settings && typeof quiz.settings === 'object' ? quiz.settings : {};
  const w = settings.winner && typeof settings.winner === 'object' ? settings.winner : null;
  const mode = w && typeof w.mode === 'string' ? w.mode : 'auto';
  const overrideDetail = w && typeof w.detail === 'string' ? w.detail.trim() : '';

  if (mode === 'manual') {
    const name = w && typeof w.name === 'string' ? w.name.trim() : '';
    if (!name) return null;
    return { name, detail: overrideDetail, avatar: '🏆', source: 'manual', kind: 'player', memberNames: [], teamSetId: null, sourceTeamId: null };
  }

  if (mode === 'team') {
    const teamId = w && typeof w.teamId === 'string' && w.teamId ? w.teamId : null;
    if (!teamId) return null;
    const team = (Array.isArray(quiz?.teams) ? quiz.teams : []).find((t) => teamStableId(t) === teamId);
    if (!team) return null;
    const name = (typeof team.name === 'string' && team.name.trim()) || 'Team';
    const memberNames = Array.isArray(team.members) ? team.members.filter((m) => typeof m === 'string' && m) : [];
    const detail = overrideDetail || (memberNames.length ? memberNames.join(', ') : '');
    return {
      name,
      detail,
      avatar: (typeof team.avatar === 'string' && team.avatar) || '🎯',
      source: 'team',
      kind: 'team',
      memberNames,
      teamSetId: typeof team.teamSetId === 'string' ? team.teamSetId : null,
      sourceTeamId: typeof team.sourceTeamId === 'string' ? team.sourceTeamId : (typeof team.id === 'string' ? team.id : null),
    };
  }

  // 'auto' (or any unrecognised mode -- fail safe onto the derived winner,
  // never onto a throw). Mirrors WinnersTab's pre-existing top-of-`scores`
  // card byte-for-byte (icon/detail formatting included), since that card's
  // *display* is unchanged -- only its *source* moves to this one function.
  const scores = quiz && quiz.scores && typeof quiz.scores === 'object' ? quiz.scores : {};
  const entries = Object.entries(scores).filter(([n, v]) => typeof n === 'string' && n && Number.isFinite(v));
  if (!entries.length) return null;
  const [topName, topScore] = [...entries].sort((a, b) => b[1] - a[1])[0];
  const isTeam = Array.isArray(quiz?.teams) && quiz.teams.length > 0;
  const team = isTeam ? (quiz.teams || []).find((t) => t && t.name === topName) : null;
  const memberNames = team && Array.isArray(team.members) ? team.members.filter((m) => typeof m === 'string' && m) : [];
  const detail = isTeam && memberNames.length ? `${topScore} pts · ${memberNames.join(', ')}` : `${topScore} pts`;
  return {
    name: topName,
    detail,
    avatar: (team && typeof team.avatar === 'string' && team.avatar) || (isTeam ? '🎯' : '🧠'),
    source: 'auto',
    kind: isTeam ? 'team' : 'player',
    memberNames,
    teamSetId: team && typeof team.teamSetId === 'string' ? team.teamSetId : null,
    sourceTeamId: team && typeof team.sourceTeamId === 'string' ? team.sourceTeamId : (team && typeof team.id === 'string' ? team.id : null),
  };
}

// Case-insensitive, trim-insensitive dedupe for a list of team names --
// `TeamSetPicker`'s own `duplicateNameIn` guard rejects a set with two teams
// sharing a name (§3.3: `quizzes.scores` is name-keyed), and a legacy quiz
// built through the deleted inline builder (which never enforced that rule)
// may already have exactly that. Rather than blocking the import outright --
// there is no other UI left to rename a legacy team, since the only editor
// that ever wrote these names was deleted alongside the inline builder --
// this renames every name after the first occurrence by appending " (2)",
// " (3)", … until it's unique, so the library copy this produces can never
// be a set `TeamSetPicker` would then refuse. Blank/whitespace-only names
// fall back to `Team <n>` first, same default `teamsFromTeamSet` uses, so
// they dedupe against each other too rather than colliding as `''`.
//
// Returns `{ names, renamed }` -- `names` is the same length/order as the
// input, `renamed` is only the entries that actually changed
// (`{ index, from, to }`), so a caller can show an honest "nothing was
// renamed" when the input was already clean.
export function dedupeTeamNames(names) {
  const canonicalBase = new Map(); // lowercased key -> the FIRST display form seen for it
  const nextSuffix = new Map(); // lowercased key -> next "(n)" to try
  const used = new Set(); // lowercased FINAL (already-emitted) names
  const out = [];
  const renamed = [];
  (Array.isArray(names) ? names : []).forEach((raw, i) => {
    const own = (typeof raw === 'string' && raw.trim()) || `Team ${i + 1}`;
    const key = own.toLowerCase();
    // Every occurrence of the same name (case-insensitively) is renamed off
    // of whichever spelling showed up FIRST, not off its own casing --
    // otherwise "Team Gamma" / "team gamma" / "TEAM GAMMA" would each grow
    // their own suffix chain instead of becoming one deduped family.
    if (!canonicalBase.has(key)) canonicalBase.set(key, own);
    const base = canonicalBase.get(key);
    let candidate = base;
    let finalKey = candidate.toLowerCase();
    if (used.has(finalKey)) {
      let n = nextSuffix.get(key) || 2;
      do {
        candidate = `${base} (${n})`;
        finalKey = candidate.toLowerCase();
        n += 1;
      } while (used.has(finalKey));
      nextSuffix.set(key, n);
    }
    used.add(finalKey);
    out.push(candidate);
    if (candidate !== raw) renamed.push({ index: i, from: typeof raw === 'string' ? raw : '', to: candidate });
  });
  return { names: out, renamed };
}

// A canonical, order-independent fingerprint for a team roster -- one string
// per team (`name|sorted,lowercased,members`), the whole array sorted, so
// two rosters compare equal regardless of team order. Used only to detect
// "this is the same teams, already in the library" (below); deliberately
// keyed on name AND members together, not name alone, so two unrelated teams
// that happen to share a name (a common one, "Team 1") don't get treated as
// the same roster just because the label matches.
function rosterSignature(teams) {
  return (Array.isArray(teams) ? teams : [])
    .map((t) => {
      const name = (t && typeof t.name === 'string' ? t.name : '').trim().toLowerCase();
      const members = (Array.isArray(t?.members) ? t.members : [])
        .filter((m) => typeof m === 'string' && m)
        .map((m) => m.trim().toLowerCase())
        .sort();
      return `${name}|${members.join(',')}`;
    })
    .sort()
    .join(';');
}

/**
 * The pure half of "bring a legacy quiz's teams into the library" (owner
 * brief, 2026-08-26). Takes the quiz as it stands today (`quiz.teams`, never
 * mutated) and the library's current active sets, and decides:
 *  - what the imported teams would look like as fresh `team_sets` `Team[]`
 *    rows (`candidateTeams` -- new `tm_…` ids, since a legacy team's own id,
 *    if it has one at all, was never a library id and carries no meaning
 *    there; names deduped per `dedupeTeamNames` above),
 *  - whether an identical roster (by `rosterSignature`) already exists as an
 *    ACTIVE set in the library -- "two quizzes played with the same teams
 *    should not create two near-identical library sets" -- so the caller can
 *    offer "link to this existing set" instead of creating a duplicate,
 *  - a proposed name for a brand-new set, derived from the quiz title so the
 *    library doesn't fill up with anonymous "Geïmporteerde teams" rows.
 *
 * Never mutates its inputs, never throws on malformed `quiz.teams`/
 * `teamSets` (both are ultimately hand-editable JSONB, same posture as every
 * other reader in this feature). `now` is injectable for reproducible ids in
 * tests, same convention as `blankQuiz`.
 */
export function buildLegacyImportPlan(quiz, teamSets = [], { now = Date.now() } = {}) {
  const legacyTeams = (Array.isArray(quiz?.teams) ? quiz.teams : []).filter((t) => t && typeof t === 'object');
  const { names, renamed } = dedupeTeamNames(legacyTeams.map((t) => t.name));
  const candidateTeams = legacyTeams.map((t, i) => ({
    id: `tm_${now}_${i}`,
    name: names[i],
    avatar: (typeof t.avatar === 'string' && t.avatar) || TEAM_AVATARS[i % TEAM_AVATARS.length],
    members: Array.isArray(t.members) ? t.members.filter((m) => typeof m === 'string') : [],
    captain: typeof t.captain === 'string' ? t.captain : null,
  }));

  const signature = rosterSignature(candidateTeams);
  const activeSets = (Array.isArray(teamSets) ? teamSets : []).filter((s) => s && s.status === 'active');
  const match = activeSets.find((s) => rosterSignature(s.teams) === signature) || null;

  const titleText = (typeof quiz?.title === 'string' && quiz.title.trim()) || '';
  const setName = titleText ? `${titleText} — Teams` : 'Geïmporteerde teams';

  return { candidateTeams, renamed, match, setName };
}

/**
 * The other half: a real `team_sets` row (teamlib's own JS shape, ready for
 * `saveTeamSet`) for a plan's `candidateTeams` when no match was found.
 * `blankTeamSet` supplies every field this feature doesn't care about
 * (`awards: []`, `eventIds: []`, `status: 'active'`) so a set born from an
 * import is indistinguishable from one built by hand in the Team Creator --
 * it is one, from this point on. `category` marks its origin only for the
 * owner's own orientation in the Team Creator list; nothing reads it back.
 */
export function buildLegacyTeamSetDraft(plan, { now = Date.now(), createdBy = '' } = {}) {
  return blankTeamSet({
    id: `ts_${now}`,
    name: plan.setName,
    category: 'Quiz (geïmporteerd)',
    teams: plan.candidateTeams,
    createdBy,
    createdAt: new Date(now).toISOString(),
  });
}

export const teamsFromTeamSet = (teamSet) => {
  const teams = teamSet && Array.isArray(teamSet.teams) ? teamSet.teams : [];
  const setId = (teamSet && typeof teamSet.id === 'string' && teamSet.id) || null;
  return teams
    .filter(t => t && typeof t === 'object' && typeof t.id === 'string' && t.id)
    .map((t, i) => ({
      id: t.id,
      name: (typeof t.name === 'string' && t.name.trim()) || `Team ${i + 1}`,
      avatar: (typeof t.avatar === 'string' && t.avatar) || TEAM_AVATARS[i % TEAM_AVATARS.length],
      members: Array.isArray(t.members) ? t.members.filter(m => typeof m === 'string') : [],
      captain: typeof t.captain === 'string' ? t.captain : null,
      teamSetId: setId,
      sourceTeamId: t.id,
    }));
};
