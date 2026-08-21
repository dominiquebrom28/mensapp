// Central home for every "open question" default from docs/mensgames-spec.md
// §13. The owner is away, so this build ships against the *proposed*
// defaults listed there -- keep them here as named constants (never inline
// the numbers below into scoring/standings logic) so a confirmed answer
// from Dom later is a one-line change, not a hunt through the feature.

// §13 Q1 — default placement award table. index 0 = 1st place. Editable
// per round via round.award.table; this is only the seed value blankRound()
// writes.
export const DEFAULT_PLACEMENT_TABLE = [10, 6, 3, 1];

// Default per-win / per-draw points for round.award.mode === 'perWin'.
export const DEFAULT_PER_WIN = 3;
export const DEFAULT_PER_DRAW = 1;

// Default multiplier for round.award.mode === 'raw' -- e.g. scaling a
// 300-point quiz down so it doesn't swamp a best-of-3 pool round (§4.3).
export const DEFAULT_RAW_FACTOR = 1;

// §13 Q4 — overall tournament tie-break order on equal points. Proposed:
// most round wins → head-to-head → joint placing (share the rank).
export const DEFAULT_TIE_BREAK_ORDER = ['roundWins', 'headToHead', 'jointPlacing'];

// §13 Q3 — draws allowed per scoring type. Currently `simple-points`,
// `race-time` and `goal-diff` allow a draw outcome; `best-of`/`first-to`
// (majority-of-N formats) do not. `manual` always allows it since the admin
// is picking the outcome directly. Read by each plugin's own resolve() --
// kept here so the policy is visible in one place, not buried in 7 files.
export const ALLOW_DRAWS = {
  manual: true,
  'simple-points': true,
  'best-of': false,
  'first-to': false,
  'race-time': true,
  'goal-diff': true,
  'quiz-linked': false, // n/a — quiz rounds never resolve a head-to-head match
};

// Attendee RSVP statuses counted as "actually there" when seeding player
// entrants from evt.attendees (mens-games rounds like pool/darts).
export const ATTENDING_STATUSES = ['went', 'going'];

// Round timer bounds, matching the existing clamp already documented for
// this feature (docs/mensgames-spec.md §7: "Timer seconds clamped 1–7200").
export const ROUND_TIMER_MIN_SECONDS = 1;
export const ROUND_TIMER_MAX_SECONDS = 7200;
export const ROUND_TIMER_DEFAULT_SECONDS = 600;

// Sane input caps for numeric score fields, so a fat-fingered phone tap at
// the bar can't produce an absurd, standings-breaking value.
export const SIMPLE_POINTS_MAX = 999;
export const GOAL_DIFF_MAX_GOALS = 200;
export const RACE_TIME_MAX_SECONDS = ROUND_TIMER_MAX_SECONDS;
export const GOAL_DIFF_WIN_POINTS = 3;
export const GOAL_DIFF_DRAW_POINTS = 1;
