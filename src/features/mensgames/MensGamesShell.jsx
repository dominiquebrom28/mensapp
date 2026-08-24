// Shared internals for both mount points (docs/mensgames-spec.md §4.6):
// the top-level page (`pageView==="mensgames"`, reached from Nav/Home
// because a tournament can exist without an event) and the event tab
// (`"Mens-Games 🏆"` on `TABS`, tournaments where `event_id===evt.id`).
// Both mount the *same* component with a different `scope` -- `MensGamesPage.jsx`
// and `MensGamesTab.jsx` are just the two lazy default-export entry points
// App.jsx's two `lazy(() => import(...))` calls need (§5.3); this is where
// the actual UI lives, so nothing drifts between the two mount points.
import { useEffect, useMemo, useState } from 'react';
import MensGamesStyles from './ui/styles.jsx';
import { Btn, EmptyState, ErrorState, H, Inp, LoadingBlock, Modal, Switch, Tag } from './ui/Kit.jsx';
import TournamentEditor from './TournamentEditor.jsx';
import { blankTournament } from './model.js';
import { fetchTournaments, isMissingTableError, saveTournament } from './api.js';

const STATUS_LABEL = { draft: 'Concept', live: 'Bezig', finished: 'Afgerond' };
const STATUS_COLOR = { draft: 'var(--muted2)', live: 'var(--red)', finished: 'var(--green)' };
const STATUS_FILTERS = ['alle', 'draft', 'live', 'finished'];
const STATUS_FILTER_LABEL = { alle: 'Alles', draft: 'Concept', live: 'Bezig', finished: 'Afgerond' };

function TournamentRow({ t, eventName, onOpen }) {
  const secret = !!t.settings?.secret;
  return (
    <button type="button" onClick={onOpen} className="mg-card-hover" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg2)', border: `1px solid ${secret ? 'rgba(224,85,85,.35)' : 'var(--border)'}`, borderRadius: 12, padding: '.9rem 1rem', cursor: 'pointer', color: 'var(--cream)', fontFamily: 'var(--font-b)', minHeight: 44 }}>
      <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>🏆</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
        <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{(t.rounds || []).length} ronde{(t.rounds || []).length === 1 ? '' : 's'} · {(t.entrants || []).length} deelnemers{eventName ? ` · ${eventName}` : ''}</div>
      </span>
      {/* Only editors ever see this row for a secret tournament at all
          (MensGamesShell filters it out of `scoped` for everyone else) --
          same "🤫 Secret" tag treatment PollsTab gives an org-only-visible
          secret poll, so an editor can tell at a glance which of their own
          tournaments are still under wraps. */}
      {secret && <Tag color="var(--red)">🤫 Geheim</Tag>}
      <Tag color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Tag>
    </button>
  );
}

// Non-editors never get a secret tournament's row (see `scoped` below) --
// but per the schedule-stop pattern (App.jsx's sneak-peek strip), they
// aren't left with no signal at all either: this tells them *something* is
// coming without saying what.
function HiddenTournamentsNotice({ count }) {
  if (count <= 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(224,85,85,.06)', border: '1px solid rgba(224,85,85,.25)', borderRadius: 12, padding: '.7rem 1rem', color: 'rgba(224,85,85,.75)', fontSize: '.82rem' }}>
      <span aria-hidden="true">🔒</span>
      <span>{count} geheim toernooi{count === 1 ? '' : 'en'} — nog niet onthuld</span>
    </div>
  );
}

function NewTournamentModal({ onClose, onCreate, error, events, fixedEventId }) {
  const [name, setName] = useState('');
  const [eventId, setEventId] = useState(fixedEventId || '');
  const [secret, setSecret] = useState(false);
  const headingId = 'mg-new-trn-title';
  const activeEvents = (events || []).filter((e) => !e.archived);
  return (
    <Modal onClose={onClose} labelledBy={headingId}>
      <H id={headingId} size="1.15rem">Nieuw toernooi</H>
      <div style={{ display: 'grid', gap: '.8rem' }}>
        <div>
          <label htmlFor="mg-new-trn-name" style={{ display: 'block', fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>Naam</label>
          <Inp id="mg-new-trn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bv. Mens-Games 2026" autoFocus />
        </div>
        {!fixedEventId && (
          <div>
            <label htmlFor="mg-new-trn-evt" style={{ display: 'block', fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>Koppel aan event (optioneel)</label>
            <select id="mg-new-trn-evt" value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' }}>
              <option value="">Geen event</option>
              {activeEvents.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        )}
        {/* 2026-08-24: "let me create a tournament but make it secret" --
            same idea as PollsTab's "🤫 Secret poll" toggle on its own new-poll
            form, so a tournament can be born hidden instead of flashing
            visible for however long it takes to open it and toggle it after
            creating it. */}
        <Switch id="mg-new-trn-secret" checked={secret} onChange={setSecret} label="🤫 Geheim — verborgen tot je het onthult" />
        {/* Its own error, distinct from the list-load one -- and the modal
            (with whatever the lad already typed) stays open on failure so
            a flaky write doesn't also cost the input. */}
        {error && <ErrorState message="Aanmaken van het toernooi is mislukt. Probeer het opnieuw." />}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Annuleren</Btn>
          <Btn disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), eventId: eventId || null, secret })}>Aanmaken</Btn>
        </div>
      </div>
    </Modal>
  );
}

export default function MensGamesShell({ scope = 'page', evt, events = [], teamSets = [], teamSetsError = null, onRetryTeamSets, currentUser, canManage = false, onUpdateEvent, onTeamSetsChanged, onSendNotif }) {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  // 2026-08-21g fix: was a plain boolean, which could only ever drive the
  // generic "check your connection" message -- by the time it was set, the
  // actual Supabase error (e.g. PGRST205, a missing migration) had already
  // been discarded. Now `null | 'missing-table' | 'network'`, so the render
  // below can say something true. Still never renders the raw error itself
  // (security review flagged that pattern elsewhere) -- just this one
  // classification, computed by `isMissingTableError` in api.js.
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  // Separate from the list-load `error` above: reusing that flag for a
  // failed *create* used to close the modal (losing the typed name) and
  // show "Kon de toernooien niet laden" -- a message about the wrong
  // operation entirely.
  const [createError, setCreateError] = useState(false);
  const [statusFilter, setStatusFilter] = useState('alle');

  const load = () => {
    setLoading(true);
    setError(null);
    fetchTournaments().then((res) => {
      setLoading(false);
      if (!res.ok) { setError(isMissingTableError(res.error) ? 'missing-table' : 'network'); return; }
      setTournaments(res.tournaments);
    });
  };
  useEffect(load, []);

  // Mirrors App.jsx's secret-schedule-stop pattern: a non-editor never sees
  // a secret tournament's row anywhere in this list -- not the top-level
  // page, not an event's Mens-Games tab -- an editor sees every row
  // (secret ones flagged with the 🤫 tag in `TournamentRow`, same as an
  // editor keeps seeing full detail on the schedule tab's own secret rows).
  const scopedAll = useMemo(() => {
    if (scope === 'event') return tournaments.filter((t) => t.eventId === evt?.id);
    return tournaments;
  }, [tournaments, scope, evt?.id]);
  const scoped = useMemo(
    () => (canManage ? scopedAll : scopedAll.filter((t) => !t.settings?.secret)),
    [scopedAll, canManage],
  );
  const hiddenSecretCount = useMemo(
    () => (canManage ? 0 : scopedAll.filter((t) => t.settings?.secret).length),
    [scopedAll, canManage],
  );

  const visible = useMemo(() => (statusFilter === 'alle' ? scoped : scoped.filter((t) => t.status === statusFilter)), [scoped, statusFilter]);

  const eventNameFor = (t) => (scope === 'page' && t.eventId ? (events.find((e) => e.id === t.eventId)?.name || null) : null);

  const createTournament = async ({ name, eventId, secret = false }) => {
    setCreateError(false);
    const t = blankTournament({ name, eventId: scope === 'event' ? evt.id : eventId, createdBy: currentUser?.display_name || currentUser?.username || '' });
    if (secret) t.settings = { ...t.settings, secret: true };
    const res = await saveTournament(t);
    // On failure, keep the modal open (and its typed name) rather than
    // discarding the lad's input -- and never borrow the list-load `error`
    // flag for this, which would misreport a failed *create* as "kon de
    // toernooien niet laden".
    if (!res.ok) { setCreateError(true); return; }
    setShowNew(false);
    setTournaments((prev) => [res.tournament, ...prev]);
    setSelectedId(res.tournament.id);
  };

  // Reads off `scoped` (already secret-filtered for non-editors), not the
  // raw `tournaments` list -- so a stale/manipulated `selectedId` can never
  // hand a non-editor the editor view of a tournament they're not supposed
  // to see (defence in depth: the list never renders a clickable row for
  // one either, but this closes the direct-selectedId path too).
  const selected = scoped.find((t) => t.id === selectedId) || null;

  const heading = scope === 'event' ? 'Mens-Games' : '🏆 Mens-Games';

  return (
    <div className="mg-root">
      <MensGamesStyles />

      {selected ? (
        <TournamentEditor
          tournament={selected}
          events={events}
          teamSets={teamSets}
          teamSetsError={teamSetsError}
          onRetryTeamSets={onRetryTeamSets}
          canManage={canManage}
          onBack={() => setSelectedId(null)}
          onDeleted={() => { setTournaments((prev) => prev.filter((t) => t.id !== selected.id)); setSelectedId(null); }}
          onLocalChange={(next) => setTournaments((prev) => prev.map((t) => (t.id === next.id ? next : t)))}
          onUpdateEvent={onUpdateEvent}
          onTeamSetsChanged={onTeamSetsChanged}
          onSendNotif={onSendNotif}
        />
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {scope === 'page' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <H size="1.6rem" style={{ marginBottom: 0 }}>{heading}</H>
              {/* Disabled while the list itself couldn't load -- a backend
                  already known to be down is not worth inviting a retry
                  against for a create too. */}
              {canManage && <Btn onClick={() => { setCreateError(false); setShowNew(true); }} disabled={!!error} title={error ? 'Toernooien konden niet geladen worden -- probeer eerst opnieuw te laden.' : undefined}>+ Nieuw toernooi</Btn>}
            </div>
          )}
          {scope === 'event' && canManage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn size="sm" onClick={() => { setCreateError(false); setShowNew(true); }} disabled={!!error} title={error ? 'Toernooien konden niet geladen worden -- probeer eerst opnieuw te laden.' : undefined}>+ Nieuw toernooi voor dit event</Btn>
            </div>
          )}

          {loading && <LoadingBlock label="Toernooien laden…" />}
          {!loading && error === 'missing-table' && (
            <ErrorState
              message="Mens-Games staat nog niet klaar aan de databasekant: de tabellen ontbreken. Dit is geen verbindingsprobleem -- vraag de beheerder om de mens-games migratie uit te voeren (docs/mensgames-spec.md §9.1-§9.2)."
              onRetry={load}
            />
          )}
          {!loading && error === 'network' && <ErrorState message="Kon de toernooien niet laden. Controleer je verbinding." onRetry={load} />}

          {!loading && !error && (
            <>
              {scope === 'page' && scoped.length > 0 && (
                <div className="mg-fu" style={{ display: 'flex', gap: '.2rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
                  {STATUS_FILTERS.map((f) => (
                    <button key={f} onClick={() => setStatusFilter(f)} className="mg-subtab"
                      style={{ borderBottom: statusFilter === f ? '2px solid var(--amber)' : '2px solid transparent', color: statusFilter === f ? 'var(--amber2)' : 'var(--muted)', fontWeight: statusFilter === f ? 600 : 400, marginBottom: -1 }}>
                      {STATUS_FILTER_LABEL[f]}
                    </button>
                  ))}
                </div>
              )}

              {visible.length === 0 ? (
                <>
                  <EmptyState
                    icon="🏆"
                    title={scoped.length === 0 ? 'Nog geen toernooien' : 'Niets in dit filter'}
                    hint={canManage ? 'Maak er eentje aan om te beginnen.' : 'Vraag een org/admin om een toernooi te starten.'}
                  />
                  <HiddenTournamentsNotice count={hiddenSecretCount} />
                </>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {visible.map((t) => <TournamentRow key={t.id} t={t} eventName={eventNameFor(t)} onOpen={() => setSelectedId(t.id)} />)}
                  <HiddenTournamentsNotice count={hiddenSecretCount} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showNew && <NewTournamentModal onClose={() => { setShowNew(false); setCreateError(false); }} onCreate={createTournament} error={createError} events={events} fixedEventId={scope === 'event' ? evt?.id : null} />}
    </div>
  );
}
