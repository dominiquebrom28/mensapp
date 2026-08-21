// The scoring registry (docs/mensgames-spec.md §4.3). Adding a type is one
// file + one line here — never an enum/switch.
import manual from './manual.js';
import simplePoints from './simple-points.js';
import bestOf from './best-of.js';
import firstTo from './first-to.js';
import raceTime from './race-time.js';
import goalDiff from './goal-diff.js';
import quizLinked from './quiz-linked.js';

export const SCORING_TYPES = {
  [manual.id]: manual,
  [simplePoints.id]: simplePoints,
  [bestOf.id]: bestOf,
  [firstTo.id]: firstTo,
  [raceTime.id]: raceTime,
  [goalDiff.id]: goalDiff,
  [quizLinked.id]: quizLinked,
};

export function listScoringTypes() {
  return Object.values(SCORING_TYPES);
}

/**
 * **Hard requirement** (§4.3): a tournament saved with a scoring type this
 * client doesn't know (built on a newer client, or hand-typed into JSONB)
 * must still open, degrading to "pick the winner by hand" instead of a
 * white screen. Any id that isn't a registered key — including `null`,
 * `undefined`, or a non-string — falls back to `manual`.
 */
export function getScoringType(id) {
  if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(SCORING_TYPES, id)) {
    return SCORING_TYPES[id];
  }
  return SCORING_TYPES.manual;
}

export default SCORING_TYPES;
