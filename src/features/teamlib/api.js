// Team library -- Supabase I/O. Maps snake_case DB rows <-> the camelCase
// `TeamSet` shape (see model.js) at this boundary, so nothing above it
// (App.jsx, TeamCreatorPage, TeamsTab) ever has to know the column is
// `event_ids` and not `eventIds`. Spec §3.1 / §9.1.
//
// Every mutator here takes the *whole* JS-shape team set object already
// held in App.jsx state and upserts the full row -- matching this app's
// existing idiom (`updateEvent`'s full-row upsert) rather than issuing
// narrow `.update()` patches. Callers already hold the current object
// (from the `teamSets` array threaded down from App root), so this never
// needs a read-before-write.
import { supabase } from "../../supabase.js";

// Defensive against hand-edited JSONB: every array-shaped field is coerced
// to an array rather than trusted, and nothing throws on a malformed row.
function fromRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    name: row.name || "",
    category: row.category || "",
    teams: Array.isArray(row.teams) ? row.teams : [],
    eventIds: Array.isArray(row.event_ids) ? row.event_ids : [],
    status: row.status === "archived" ? "archived" : "active",
    awards: Array.isArray(row.awards) ? row.awards : [],
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    archivedAt: row.archived_at || null,
  };
}

function toRow(set) {
  return {
    id: set.id,
    name: set.name || "",
    category: set.category || "",
    teams: Array.isArray(set.teams) ? set.teams : [],
    event_ids: Array.isArray(set.eventIds) ? set.eventIds : [],
    status: set.status === "archived" ? "archived" : "active",
    awards: Array.isArray(set.awards) ? set.awards : [],
    created_by: set.createdBy || "",
    created_at: set.createdAt || new Date().toISOString(),
    archived_at: set.archivedAt || null,
  };
}

// Shape mirrors mensgames/api.js's `fetchTournaments` ({ok, error, teamSets})
// on purpose -- App.jsx and every other caller need a way to tell "the
// table is empty" from "we couldn't reach it" apart (a bare [] used to
// collapse both into the same, misleading "Nog geen teamsets opgeslagen").
// Still never rejects -- the boot `Promise.all` in App.jsx depends on that.
export async function fetchTeamSets() {
  const { data, error } = await supabase
    .from("team_sets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchTeamSets failed:", error);
    return { ok: false, error, teamSets: [] };
  }
  return { ok: true, error: null, teamSets: (Array.isArray(data) ? data : []).map(fromRow).filter(Boolean) };
}

export async function saveTeamSet(teamSet) {
  const row = toRow(teamSet);
  const { error } = await supabase.from("team_sets").upsert([row]);
  if (error) {
    console.error("saveTeamSet failed:", error);
    return { ok: false, error };
  }
  return { ok: true, error: null, teamSet: fromRow(row) };
}

export async function deleteTeamSet(id) {
  const { error } = await supabase.from("team_sets").delete().eq("id", id);
  if (error) {
    console.error("deleteTeamSet failed:", error);
    return { ok: false, error };
  }
  return { ok: true, error: null };
}

export async function archiveTeamSet(teamSet) {
  return saveTeamSet({ ...teamSet, status: "archived", archivedAt: new Date().toISOString() });
}

export async function unarchiveTeamSet(teamSet) {
  return saveTeamSet({ ...teamSet, status: "active", archivedAt: null });
}

export async function linkTeamSetToEvent(teamSet, eventId) {
  const current = Array.isArray(teamSet?.eventIds) ? teamSet.eventIds : [];
  if (current.includes(eventId)) return { ok: true, error: null, teamSet };
  return saveTeamSet({ ...teamSet, eventIds: [...current, eventId] });
}

export async function unlinkTeamSetFromEvent(teamSet, eventId) {
  const current = Array.isArray(teamSet?.eventIds) ? teamSet.eventIds : [];
  return saveTeamSet({ ...teamSet, eventIds: current.filter(id => id !== eventId) });
}

// TeamAward — spec §3.1. Not called anywhere yet in this pass (mens-games,
// the feature that will award trophies, is being built concurrently) --
// wired here so that feature has a stable, tested entry point to land on.
export async function addTeamAward(teamSet, award) {
  const current = Array.isArray(teamSet?.awards) ? teamSet.awards : [];
  return saveTeamSet({ ...teamSet, awards: [...current, award] });
}
