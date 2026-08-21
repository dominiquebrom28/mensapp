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

// Ticket #7: pin specific people to specific teams, then have "generate"
// fill only the remaining slots from the unpinned pool -- and have pinned
// members stay exactly where they were put across a re-roll.
//
// `pins` is a map of participant name -> team id. `existingTeams`, when
// given, supplies the team shells (id/name/avatar/captain) to keep --
// pass `[]` (or omit) for a first-time generation from scratch.
//
// `shuffle` is injectable purely for deterministic tests; production calls
// omit it and get the default Math.random shuffle.
export function generateTeams({
  participants = [],
  teamSize = 1,
  existingTeams = [],
  pins = {},
  shuffle,
} = {}) {
  const names = (Array.isArray(participants) ? participants : []).filter(Boolean);
  if (names.length === 0) return [];
  const size = Math.max(1, Number(teamSize) || 1);
  const shells0 = Array.isArray(existingTeams) ? existingTeams : [];
  const pinMap = pins && typeof pins === "object" ? pins : {};

  const pinnedTeamIds = new Set(
    names.filter(n => pinMap[n]).map(n => pinMap[n]),
  );
  const teamCount = shells0.length > 0
    ? shells0.length
    : Math.max(1, Math.ceil(names.length / size), pinnedTeamIds.size);

  const shells = Array.from({ length: teamCount }, (_, i) => {
    const prev = shells0[i];
    return prev && typeof prev === "object"
      ? { id: prev.id, name: prev.name, avatar: prev.avatar, captain: prev.captain ?? null, members: [] }
      : blankTeam(i, "");
  });
  const shellById = new Map(shells.map(s => [s.id, s]));

  // 1. Seat pinned participants in their pinned team first.
  const pinnedSet = new Set();
  names.forEach(n => {
    const teamId = pinMap[n];
    if (teamId && shellById.has(teamId)) {
      shellById.get(teamId).members.push(n);
      pinnedSet.add(n);
    }
  });

  // 2. Shuffle everyone else.
  const rest = names.filter(n => !pinnedSet.has(n));
  const doShuffle = typeof shuffle === "function" ? shuffle : arr => [...arr].sort(() => Math.random() - 0.5);
  const shuffled = doShuffle(rest);

  // 3. Fill remaining capacity team-by-team, in order (matches the
  // pre-#7 chunking behaviour when nothing is pinned).
  let cursor = 0;
  for (const team of shells) {
    while (team.members.length < size && cursor < shuffled.length) {
      team.members.push(shuffled[cursor++]);
    }
  }
  // Defensive overflow (shouldn't happen given the teamCount calc above,
  // but a hand-edited pins map could reference a team id that no longer
  // matches the shell count): dump any leftovers on the last team rather
  // than silently dropping people.
  while (cursor < shuffled.length) {
    shells[shells.length - 1].members.push(shuffled[cursor++]);
  }

  // 4. A captain who got reshuffled off their team is no longer captain
  // of anything -- same rule as `removeMember`.
  shells.forEach(t => {
    if (t.captain && !t.members.includes(t.captain)) t.captain = null;
  });

  return shells;
}
