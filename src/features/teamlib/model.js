// Team library -- pure data functions. No React, no Supabase, no DOM.
// Consumed eagerly by App.jsx (TeamsTab, TeamCreatorPage) -- see
// docs/mensgames-spec.md §2.3, §3.1.
//
// `Team` shape (spec §3.1): { id, name, avatar, members:string[], captain:string|null }
// `TeamSet` (JS/camelCase) shape: { id, name, category, teams:Team[], eventIds:string[],
//   status:'active'|'archived', awards:TeamAward[], createdBy, createdAt, archivedAt }
// api.js maps this camelCase shape to/from the snake_case DB row -- nothing
// above that boundary (TeamCreatorPage, TeamsTab) ever sees `event_ids`.

// Small fallback avatar set used only when `generateTeams`/`blankTeam` are
// called without an explicit avatar -- callers inside App.jsx should always
// pass one from the app's own `TEAM_AVATARS` (kept there, not duplicated
// here, since it's a plain data array with no source-parsing constraint).
const FALLBACK_AVATARS = ["🎯", "🦁", "🐻", "🦊", "🦅", "🐺"];

export function blankTeamSet(overrides = {}) {
  return {
    id: `ts_${Date.now()}`,
    name: "",
    category: "",
    teams: [],
    eventIds: [],
    status: "active",
    awards: [],
    createdBy: "",
    createdAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

export function blankTeam(index = 0, avatar = "") {
  return {
    id: `tm_${Date.now()}_${index}`,
    name: `Team ${index + 1}`,
    avatar: avatar || FALLBACK_AVATARS[index % FALLBACK_AVATARS.length],
    members: [],
    captain: null,
  };
}

// Toggles captaincy for `name` on `team`. Defensive: refuses to crown
// someone who isn't actually a member (guards against hand-edited JSONB /
// stale UI state pointing at a name that's since been removed).
export function setCaptain(team, name) {
  if (!team || typeof team !== "object") return team;
  const members = Array.isArray(team.members) ? team.members : [];
  if (!members.includes(name)) return team;
  return { ...team, captain: team.captain === name ? null : name };
}

// Removes `name` from `team.members`; clears captaincy too if that member
// was the captain -- the one rule ticket #8 explicitly calls out ("removing
// a member clears their captaincy").
export function removeMember(team, name) {
  if (!team || typeof team !== "object") return team;
  const members = Array.isArray(team.members) ? team.members : [];
  return {
    ...team,
    members: members.filter(m => m !== name),
    captain: team.captain === name ? null : team.captain,
  };
}

// Defensive summary used by every list of team sets -- guards against a
// hand-edited row where `teams` isn't an array, or a team's `members` isn't.
export function teamSetSummary(teamSet) {
  const teams = Array.isArray(teamSet?.teams) ? teamSet.teams : [];
  const teamCount = teams.length;
  const memberCount = teams.reduce(
    (sum, t) => sum + (Array.isArray(t?.members) ? t.members.length : 0),
    0,
  );
  return { teamCount, memberCount };
}

// Flattens display names off a users array (`display_name` falling back to
// `username`), for "select all" / bulk-add flows. Never throws on bad input.
export function namesFromUsers(users) {
  return (Array.isArray(users) ? users : [])
    .map(u => u?.display_name || u?.username)
    .filter(Boolean);
}

// Order-preserving union, deduped -- used by "select all" and "everyone
// attending event X" to merge into the existing participant list.
export function mergeNames(existing, incoming) {
  const seen = new Set(Array.isArray(existing) ? existing : []);
  const merged = Array.isArray(existing) ? [...existing] : [];
  (Array.isArray(incoming) ? incoming : []).forEach(n => {
    if (n && !seen.has(n)) {
      seen.add(n);
      merged.push(n);
    }
  });
  return merged;
}

// Team Creator rebuild (2026-08-25 -- "brackets first, then fill"): the
// owner picks a team count (or size), gets that many empty brackets on
// screen immediately, and places people into them by hand before ever
// touching Generate. That retires the #7 pin concept entirely -- there is
// no longer a separate "pinned" state to track, because *being a member of
// a bracket* now means exactly what "pinned" used to mean: this person
// stays exactly where they are on every future call. `generateTeams` only
// ever ADDS people to `existingTeams` shells; it never removes or moves
// anyone already seated, manually placed or auto-filled alike. So calling
// it again with its own previous result as `existingTeams` (a "re-roll")
// is a no-op unless the roster grew or a bracket was removed and returned
// people to the pool -- which is exactly "Genereer only fills empty seats".
//
// `existingTeams`, when given, supplies the team shells (id/name/avatar/
// captain/members) to keep exactly as-is aside from adding the unplaced
// pool into them -- pass `[]` (or omit) for a first-time generation from
// scratch, which also derives how many shells to build (see `resizeTeams`
// for the shell-count logic the UI actually drives off `teamCount`/
// `teamSize` directly; this fallback exists so the function stays
// self-sufficient for direct/test callers that don't pre-build shells).
//
// `shuffle` is injectable purely for deterministic tests; production calls
// omit it and get the default Math.random shuffle.
//
// Team Creator ticket (2026-08-24): the owner wants to drive this off "how
// many teams" rather than "how many people per team" -- pick `teamCount`
// explicitly and everyone gets balanced as evenly as possible across that
// many teams (round-robin: whoever has the fewest members so far gets the
// next unplaced name), which is a different fill *shape* than the legacy
// `teamSize` chunking below (fill team 0 to capacity, then team 1, ...).
// Passing `teamCount` selects the balanced fill; passing only `teamSize`
// keeps the exact pre-existing chunking behaviour (and its tests). If both
// are given, `teamCount` wins -- there is no sane "size AND count" combo to
// reconcile, and the UI never sends both at once.
export function generateTeams({
  participants = [],
  teamSize = 1,
  teamCount,
  existingTeams = [],
  shuffle,
} = {}) {
  const names = (Array.isArray(participants) ? participants : []).filter(Boolean);
  if (names.length === 0) return [];
  const shells0 = Array.isArray(existingTeams) ? existingTeams : [];

  // Which fill strategy applies is decided purely by whether `teamCount`
  // was explicitly passed -- not by whether this happens to be a first
  // generation or a re-roll, so a re-roll of a count-driven set stays
  // balanced too.
  const balanced = teamCount != null;
  const count = shells0.length > 0
    ? shells0.length
    : balanced
      ? Math.max(1, Math.round(Number(teamCount)) || 1)
      : Math.max(1, Math.ceil(names.length / Math.max(1, Number(teamSize) || 1)));

  // Unlike the pre-rebuild version, shells keep whatever members they
  // already had -- nothing here ever wipes a seat clean before refilling
  // it. Only `members`/`captain` need defensive array/null guards; the
  // rest of an existing shell (id/name/avatar) passes through untouched.
  const shells = shells0.length > 0
    ? shells0.map(t => ({
      id: t?.id, name: t?.name, avatar: t?.avatar, captain: t?.captain ?? null,
      members: Array.isArray(t?.members) ? [...t.members] : [],
    }))
    : Array.from({ length: count }, (_, i) => blankTeam(i, ""));

  // Anyone already seated on any shell -- manually placed or left over
  // from an earlier generate -- is untouchable. Only the rest of the
  // roster is up for grabs.
  const alreadyPlaced = new Set(shells.flatMap(t => t.members));
  const toPlace = names.filter(n => !alreadyPlaced.has(n));
  const doShuffle = typeof shuffle === "function" ? shuffle : arr => [...arr].sort(() => Math.random() - 0.5);
  const shuffled = doShuffle(toPlace);

  if (balanced) {
    // Team-count mode: hand each unplaced name to whichever team currently
    // has the fewest members (earliest team wins a tie) -- handles uneven
    // splits (7 people / 3 teams -> 3/2/2) and manually-skewed starting
    // points sensibly, and simply leaves extra teams empty when there are
    // more teams than people rather than erroring.
    for (const name of shuffled) {
      let target = shells[0];
      for (const t of shells) {
        if (t.members.length < target.members.length) target = t;
      }
      target.members.push(name);
    }
  } else {
    // Legacy people-per-team mode: fill remaining capacity team-by-team, in
    // order (matches the pre-#7 chunking behaviour when nothing is placed
    // yet).
    const size = Math.max(1, Number(teamSize) || 1);
    let cursor = 0;
    for (const team of shells) {
      while (team.members.length < size && cursor < shuffled.length) {
        team.members.push(shuffled[cursor++]);
      }
    }
    // Defensive overflow (shouldn't happen given the shell-count calc
    // above, but a hand-edited members list could already overfill a
    // team): dump any leftovers on the last team rather than silently
    // dropping people.
    while (cursor < shuffled.length) {
      shells[shells.length - 1].members.push(shuffled[cursor++]);
    }
  }

  // A captain whose team got emptied out from under them by a stale/
  // hand-edited shell is no longer captain of anything -- same rule as
  // `removeMember`. Generate itself never removes a member from a team it
  // was already on, so this only ever bites on defensive/edge input.
  shells.forEach(t => {
    if (t.captain && !t.members.includes(t.captain)) t.captain = null;
  });

  return shells;
}

// Team Creator rebuild: "changing the count adds or removes brackets
// live... removing a bracket that has people in it must not silently
// discard them -- return them to the unassigned pool". This is the pure
// resize step the count/size stepper drives on every change. Growing
// appends fresh blank shells (cycling through `avatars`, skipping ones
// already in use so two brackets don't default to the same icon -- same
// courtesy `QuizBuilder`'s `addTeam` extends its own teams). Shrinking
// drops shells off the end; it does NOT touch `members`, so anyone who was
// on a dropped bracket simply stops appearing in any team's roster -- the
// caller derives "unassigned" as participants minus everyone still seated
// somewhere, so those people surface in the pool automatically rather than
// being deleted.
export function resizeTeams(teams, count, avatars = []) {
  const list = Array.isArray(teams) ? teams : [];
  const n = Math.max(0, Math.round(Number(count)) || 0);
  if (n === list.length) return list;
  if (n < list.length) return list.slice(0, n);
  const pool = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
  const used = new Set(list.map(t => t?.avatar));
  const next = [...list];
  for (let i = list.length; i < n; i++) {
    let avatar = "";
    if (pool.length > 0) {
      avatar = pool.find(a => !used.has(a)) || pool[i % pool.length];
      used.add(avatar);
    }
    next.push(blankTeam(i, avatar));
  }
  return next;
}

// "Here's what will happen" preview -- shown next to the team-count
// stepper before the owner commits to Genereer (2026-08-24 ticket: "the UI
// should say what will happen before he commits"). Deliberately ignorant of
// pins (there's nothing to pin before a first generation exists); it's just
// the plain base+remainder split `generateTeams`'s balanced fill converges
// on for a fresh, unpinned roster of this size. Pure and defensive -- never
// throws, always returns exactly `count` numbers (0 for a 0-person roster,
// so "3 teams, 0 personen" still renders three honest zeroes rather than
// nothing).
export function splitPreview(total, count) {
  const n = Math.max(0, Math.round(Number(total)) || 0);
  const c = Math.max(1, Math.round(Number(count)) || 1);
  const base = Math.floor(n / c);
  const remainder = n % c;
  return Array.from({ length: c }, (_, i) => base + (i < remainder ? 1 : 0));
}
