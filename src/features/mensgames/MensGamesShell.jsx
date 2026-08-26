// The UI for mens-games (docs/mensgames-spec.md §4.6), behind one lazy
// entry point: `MensGamesPage.jsx`, the top-level page reached from
// Nav/Home.
//
// It was two. The `"Mens-Games 🏆"` event tab and its `MensGamesTab.jsx`
// entry point were deleted 2026-08-26 when the owner moved mens-games out
// of the event page for good: it is a standalone tool, and an event now
// shows its tournament results through Winners & Highlights instead. The
// `scope` prop and its `"event"` branch survive because the scoping logic
// is still what filters tournaments to one event -- but nothing mounts
// this with `scope="event"` today.
import { useEffect, useMemo, useState } from 'react';
import MensGamesStyles from './ui/styles.jsx';
import { Btn, EmptyState, ErrorState, H, Inp, LoadingBlock, Modal, Switch, Tag } from './ui/Kit.jsx';
import TournamentEditor from './TournamentEditor.jsx';
import { blankTournament } from './model.js';
import { fetchTournaments, isMissingTableError, saveTournament } from './api.js';
import { tournamentWinnerPlacement } from './tournamentResults.js';

const STATUS_LABEL = { draft: 'Concept', live: 'Bezig', finished: 'Afgerond' };
const STATUS_COLOR = { draft: 'var(--muted2)', live: 'var(--red)', finished: 'var(--green)' };
const STATUS_FILTERS = ['alle', 'draft', 'live', 'finished'];
const STATUS_FILTER_LABEL = { alle: 'Alles', draft: 'Concept', live: 'Bezig', finished: 'Afgerond' };
// Standalone filter value never collides with a real event id -- tournament
// ids/event ids are `trn_<epoch>`/app-generated text, never this literal.
const STANDALONE_FILTER = 'standalone';

// The event-linkage badge, styled to match `TournamentEditor`'s own
// "📅 {event name}" tag (same 📅 glyph, same --blue treatment) rather than
// inventing a second look for the same fact -- but rendered as a real
// `<button>`, not `Tag`'s `<span>`, because on THIS row it doubles as the
// "jump to this event's history" action (this file's answer to the gap the
// owner flagged: mens-games surfaced no way to see an event's tournament
// history once its own tab was removed). A standalone tournament gets
// plain text, not a button -- there is no event to jump to, and a disabled-
// looking control inviting a tap that does nothing is worse than no control
// (§13 Q2 / the brief: standalone stays first-class, not a dead affordance).
// `show`: false only for `scope="event"` -- every row there already IS this
// event's, so falling back to "standalone" text (legitimate for a genuinely
// unlinked tournament under `scope="page"`) would misreport it.
function EventBadge({ eventName, onClick, show = true }) {
  if (!show) return null;
  if (!eventName) return <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Losstaand</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Bekijk geschiedenis van ${eventName}`}
      title={`Bekijk toernooien van ${eventName}`}
      // `minHeight:44` + flex-centering (not just padding) -- this is a
      // per-row control a member taps often to jump around, so it gets the
      // feature's own 44px minimum (ui/styles.jsx's own stated reason: "at
      // a bar, on a phone, one-handed") rather than the 36px `Btn size="sm"`
      // convention this row's other secondary actions use.
      style={{ background: 'rgba(91,155,213,.15)', border: '1px solid rgba(91,155,213,.3)', color: 'var(--blue)', borderRadius: 8, padding: '6px 12px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-b)', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
    >
      📅 {eventName}
    </button>
  );
}

// A row is a container with two independent controls, not one big button
// (same fix `QuizShell.jsx`'s `QuizRow` already applied, same reason: once
// the event badge became clickable, nesting it inside the row's own
// open-editor button would be invalid HTML and the badge would be
// unreachable). The label area opens the tournament; the badge jumps the
// list to that event's history.
function TournamentRow({ t, eventName, onOpen, onViewEventHistory, showEventBadge = true }) {
  const secret = !!t.settings?.secret;
  // "How it finished" (the brief's second ask) -- reuses the same pure,
  // synchronous winner derivation `WinnersTab`'s AUTO card already relies on
  // (`tournamentResults.js`) rather than a second scoring implementation.
  // Only ever computed on a row that already passed `scoped`'s secret
  // filter, so a still-secret finished tournament's placement is never
  // derived for anyone it isn't already visible to.
  const winner = t.status === 'finished' ? tournamentWinnerPlacement(t) : null;
  return (
    <div className="mg-card-hover" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg2)', border: `1px solid ${secret ? 'rgba(224,85,85,.35)' : 'var(--border)'}`, borderRadius: 12, padding: '.9rem 1rem', color: 'var(--cream)', fontFamily: 'var(--font-b)', minHeight: 44, flexWrap: 'wrap' }}>
      <button type="button" onClick={onOpen} style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', padding: 0, margin: 0, textAlign: 'left', color: 'inherit', font: 'inherit', minHeight: 44, cursor: 'pointer' }}>
        <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>🏆</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
          <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{(t.rounds || []).length} ronde{(t.rounds || []).length === 1 ? '' : 's'} · {(t.entrants || []).length} deelnemers</div>
          {winner && (
            <div style={{ fontSize: '.72rem', color: 'var(--amber2)', marginTop: 2 }}>🏆 {winner.name}{winner.detail ? ` · ${winner.detail}` : ''}</div>
          )}
        </span>
      </button>
      <EventBadge eventName={eventName} onClick={onViewEventHistory} show={showEventBadge} />
      {/* Only editors ever see this row for a secret tournament at all
          (MensGamesShell filters it out of `scoped` for everyone else) --
          same "🤫 Secret" tag treatment PollsTab gives an org-only-visible
          secret poll, so an editor can tell at a glance which of their own
          tournaments are still under wraps. */}
      {secret && <Tag color="var(--red)">🤫 Geheim</Tag>}
      <Tag color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Tag>
    </div>
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
  // '' (alle) | STANDALONE_FILTER | a real event id. Page-scope only --
  // `scope="event"` is already narrowed to one event, so there is nothing
  // left to filter by here.
  const [eventFilter, setEventFilter] = useState('');

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

  // The event-history view (owner brief: "we can view its linked
  // event-history from there", the second half of removing the Mens-Games
  // event tab that the tab removal itself didn't ship -- see this file's
  // own header). Shape chosen over a grouped list or a separate drill-in
  // screen: it's the same widget `statusFilter` already is (a `<select>`
  // next to the status subtabs), it needs no second fetch (everything here
  // already came back on `scoped`, `select('*')`-loaded by `fetchTournaments`
  // for the editor's own use), and it reads identically to `QuizShell.jsx`'s
  // own filter row rather than inventing a second "view history" surface
  // this app doesn't have anywhere else. Built off `scoped`, never the raw
  // `tournaments` list, so a non-editor can only ever filter down to an
  // event by way of tournaments they're already allowed to see -- an event
  // whose only tournament is secret simply never gets an option here,
  // which is the fetch-time half of "not its existence" (§ this file's own
  // secret-filtering comment above).
  const linkedEventOptions = useMemo(() => {
    if (scope !== 'page') return [];
    const seen = new Map();
    scoped.forEach((t) => {
      if (!t.eventId || seen.has(t.eventId)) return;
      seen.set(t.eventId, events.find((e) => e.id === t.eventId)?.name || 'Onbekend event');
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
  }, [scoped, events, scope]);
  const hasStandaloneTournament = useMemo(() => scoped.some((t) => !t.eventId), [scoped]);

  const byEvent = useMemo(() => {
    if (!eventFilter) return scoped;
    if (eventFilter === STANDALONE_FILTER) return scoped.filter((t) => !t.eventId);
    return scoped.filter((t) => t.eventId === eventFilter);
  }, [scoped, eventFilter]);

  const visible = useMemo(() => (statusFilter === 'alle' ? byEvent : byEvent.filter((t) => t.status === statusFilter)), [byEvent, statusFilter]);

  // `|| 'Onbekend event'` (not `|| null`) once `t.eventId` is set -- a
  // tournament whose event was since deleted still belongs to *an* event,
  // just not one this list can name anymore. Collapsing that into "Losstaand"
  // would misreport a broken link as never having had one (same "Onbekend
  // team"/"Naamloze teams" precedent the Hall of Fame already uses for the
  // identical dangling-reference case).
  const eventNameFor = (t) => (scope === 'page' && t.eventId ? (events.find((e) => e.id === t.eventId)?.name || 'Onbekend event') : null);
  const viewEventHistory = (t) => {
    if (!t.eventId) return;
    setStatusFilter('alle');
    setEventFilter(t.eventId);
  };
  const activeEventFilterName = eventFilter === STANDALONE_FILTER
    ? 'Losstaand'
    : (eventFilter ? (linkedEventOptions.find((o) => o.id === eventFilter)?.name || 'Onbekend event') : null);

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

              {/* The event-history filter (this file's header comment) --
                  only worth showing once there is actually an event to
                  filter down to; a group that has only ever run standalone
                  tournaments would see a selector with nothing useful in
                  it otherwise. */}
              {scope === 'page' && linkedEventOptions.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label htmlFor="mg-event-filter" style={{ fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Geschiedenis</label>
                  <select
                    id="mg-event-filter"
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value)}
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', color: 'var(--cream)', fontSize: '.85rem', minHeight: 44 }}
                  >
                    <option value="">Alle events</option>
                    {hasStandaloneTournament && <option value={STANDALONE_FILTER}>Losstaand</option>}
                    {linkedEventOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {eventFilter && (
                    <Btn size="sm" variant="ghost" onClick={() => setEventFilter('')}>✕ {activeEventFilterName}</Btn>
                  )}
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
                  {visible.map((t) => <TournamentRow key={t.id} t={t} eventName={eventNameFor(t)} onOpen={() => setSelectedId(t.id)} onViewEventHistory={() => viewEventHistory(t)} showEventBadge={scope === 'page'} />)}
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
