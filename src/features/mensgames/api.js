// Tournament data layer -- Supabase I/O (WP-E; docs/mensgames-spec.md §3.2,
// §6). Maps snake_case DB rows <-> the camelCase `Tournament` shape
// `model.js`'s builders already produce, at this one boundary, exactly like
// `teamlib/api.js` does for `team_sets`. Mens-games owns this I/O itself --
// App.jsx never fetches tournaments (§5.3), so nothing here is imported
// eagerly; it only loads as part of this feature's lazy chunk.
//
// Every mutator upserts the *whole* tournament row, matching this app's
// existing full-row-upsert idiom (`updateEvent`, `teamlib/api.js`'s
// `saveTeamSet`) -- callers already hold the current object in local state.
// `saveTournament` itself is a plain, immediate upsert; the 400ms write
// debounce called for in §5 WP-E lives in the UI layer (TournamentEditor's
// autosave), not here -- a caller that needs an immediate, un-debounced
// write (locking a round, finishing a tournament) must get exactly that.
import { supabase } from '../../supabase.js';

function fromRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    name: row.name || '',
    eventId: row.event_id ?? null,
    status: ['draft', 'live', 'finished'].includes(row.status) ? row.status : 'draft',
    entrants: Array.isArray(row.entrants) ? row.entrants : [],
    rounds: Array.isArray(row.rounds) ? row.rounds : [],
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
    teamSetId: row.team_set_id ?? null,
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function toRow(t) {
  return {
    id: t.id,
    name: t.name || 'Naamloos toernooi',
    event_id: t.eventId ?? null,
    status: ['draft', 'live', 'finished'].includes(t.status) ? t.status : 'draft',
    entrants: Array.isArray(t.entrants) ? t.entrants : [],
    rounds: Array.isArray(t.rounds) ? t.rounds : [],
    settings: t.settings && typeof t.settings === 'object' ? t.settings : {},
    team_set_id: t.teamSetId ?? null,
    created_by: t.createdBy || '',
    created_at: t.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function fetchTournaments() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchTournaments failed:', error);
    return { ok: false, error, tournaments: [] };
  }
  return { ok: true, error: null, tournaments: (Array.isArray(data) ? data : []).map(fromRow).filter(Boolean) };
}

export async function fetchTournament(id) {
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).single();
  if (error) {
    console.error('fetchTournament failed:', error);
    return { ok: false, error, tournament: null };
  }
  return { ok: true, error: null, tournament: fromRow(data) };
}

export async function saveTournament(tournament) {
  const row = toRow(tournament);
  const { error } = await supabase.from('tournaments').upsert([row]);
  if (error) {
    console.error('saveTournament failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null, tournament: fromRow(row) };
}

export async function deleteTournament(id) {
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) {
    console.error('deleteTournament failed:', error);
    return { ok: false, error };
  }
  return { ok: true, error: null };
}

/**
 * Mirrors the existing `postgres_changes` pattern EventPage uses for a
 * single event row (App.jsx's `event-data-${evt.id}` channel) -- so every
 * open viewer's tournament state (and therefore its live standings/
 * scoreboard) catches up within ~1s of another device's write, giving a
 * free "live scoreboard" per §2.2's rationale for one JSONB row.
 * `onChange` receives the updated tournament (already through `fromRow`) --
 * or `null` if the row was deleted while a viewer had it open, so the
 * caller can drop back out of the editor rather than operating on a ghost.
 * Returns an unsubscribe function; always safe to call more than once.
 */
export function subscribeTournament(id, onChange) {
  const channel = supabase
    .channel(`tournament-${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, ({ new: row }) => {
      if (row) onChange(fromRow(row));
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, () => {
      onChange(null);
    })
    .subscribe();
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    supabase.removeChannel(channel);
  };
}
