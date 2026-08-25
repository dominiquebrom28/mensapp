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
