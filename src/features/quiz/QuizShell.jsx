// Shared internals for both quiz mount points (docs/quiz-unification-spec.md
// §8.1/§14 decision 1, WP-Q7) -- the top-level page (`pageView==="quiz"`,
// reached from Nav/Home because a quiz can now exist without an event, the
// owner's own framing: "its own general feature, that CAN be connected to an
// event") and the event tab ("Quiz" on `TABS`). Mirrors
// `mensgames/MensGamesShell.jsx`'s scope split. There is one lazy entry
// point now, `QuizPage.jsx`: the event tab and its `QuizTabMount.jsx` were
// deleted 2026-08-26 when the quiz became a standalone tool. The `scope`
// prop and its `"event"` branch survive -- the scoping logic still filters
// quizzes to one event -- but nothing mounts this with `scope="event"`
// today.
//
// `scope="event"` is a pure relocation of what `EventPage` used to own
// inline (the `quizDash` boolean + the `QuizTab`/`QuizDashboard` pair) --
// zero behaviour change, verified by QuizDashboard's own untouched test
// suite (QuizDashboard.save/finish.test.jsx) plus the event-scoped half of
// `QuizShell.event.test.jsx`.
//
// `scope="page"` is the new capability. It does NOT reimplement quiz
// editing for a *dashboard-managed* quiz -- one actually embedded in some
// event's own `evt.quizzes[]` array, which is what `QuizDashboard` itself
// reads/writes/presents/finishes off (verified by reading that file). Any
// such quiz -- migrated, built-since-the-dual-write, or brand new -- opens
// through the exact same, already-tested `QuizDashboard` (via its
// additive `initialQuizId`/`initialNew` props), so there is no second
// write path to keep in sync. `findHomeEvent` below is the structural
// check for this, deliberately NOT `quiz.eventId`: 2026-08-26's
// link/relink/unlink feature (`applyLink`) can leave a quiz with a real
// `eventId` that names an event it was never physically moved into --
// see that function's own comment for why that's a deliberate choice, not
// a gap. A quiz that ISN'T dashboard-managed -- `eventId===null` (never
// linked), or a real `eventId` set purely as attribution by the link
// feature -- is built/presented/finished here directly, against the
// `quizzes` table (`api.js`), with no `evt.quizzes[]` entry to keep in
// sync because it was deliberately never given one.
import { useEffect, useMemo, useState } from 'react';
import QuizTab from './QuizTab.jsx';
import QuizDashboard from './QuizDashboard.jsx';
import { QuizBuilder } from './QuizBuilder.jsx';
import { QuizPresenter } from './QuizPresenter.jsx';
import { normalizeQuiz } from './model.js';
import { computeMemberScores, finishQuiz } from './finishQuiz.js';
import { deleteQuiz, fetchQuizzes, isMissingTableError, patchQuizEventId, saveQuiz } from './api.js';
import { Btn, EmptyState, ErrorState, H, LoadingBlock, Modal, SubTab, Tag } from './ui/Kit.jsx';

const STATUS_LABEL = { ready: 'Klaar', live: 'Bezig', finished: 'Afgerond' };
const STATUS_COLOR = { ready: 'var(--muted2)', live: 'var(--red)', finished: 'var(--green)' };
const STATUS_FILTERS = ['alle', 'ready', 'live', 'finished'];
const STATUS_FILTER_LABEL = { alle: 'Alles', ready: 'Klaar', live: 'Bezig', finished: 'Afgerond' };
// Same list App.jsx's own (unexported, per docs/mensgames-spec.md §5.4)
// `ACTIVE_ROLES` uses -- duplicated here rather than imported, same posture
// `isMissingTableError` already takes in `api.js`/`results.js` for a
// feature-owned copy of a cross-cutting constant.
const ACTIVE_ROLES = ['admin', 'admin+org', 'org', 'organisation', 'lad', 'member'];

// §6's standalone-individual-quiz default roster ("standalone -> active-role
// users") -- the `participants` picker itself is cut (§15 #5), so this is
// the seed `QuizPresenter` needs for its per-person score table, not a
// dedicated UI. Event-linked quizzes never reach this: they always present
// through `QuizDashboard`, which already seeds from `evt.attendees`.
function activeUserRoster(users) {
  return (Array.isArray(users) ? users : [])
    .filter(u => u && ACTIVE_ROLES.includes(u.role))
    .map(u => ({ name: u.display_name || u.username, status: 'going' }));
}

function totalQuestions(quiz) {
  return normalizeQuiz(quiz).rounds.reduce((s, r) => s + r.questions.length, 0);
}

// `interactive` (docs/quiz-unification-spec.md §14 decision 6: "who may
// present -- unchanged, org/admin"): `QuizDashboard` has no permission check
// of its own -- it trusts whoever mounts it, same as it always has, because
// the only mount site used to be `QuizTab`'s own `isAdmin`-gated "Open Quiz
// Dashboard" button. This top-level list is a second mount site, so it has
// to reproduce that gate itself rather than let a plain lad tap a row and
// land in the full editor. Non-admins get the identical row, minus the
// click -- a real `<div>`, not a `<button>` pretending to be inert, so
// nothing here silently claims a role it doesn't have.
// The row is a container, NOT one big button. It used to be a single
// full-width `<button>`, which meant per-quiz actions could not live on it
// (nesting a button inside a button is invalid HTML) and had to be exiled
// to a strip under the whole list -- where each one had to repeat the quiz
// title to say what it acted on, and read as detached from the thing it
// belonged to. The owner asked for them on the tile, which is also where
// they belong.
//
// So: the label area is its own button (the open affordance, still fully
// keyboard-reachable), and the actions are its siblings. No nesting, every
// action a real `<button>`, and each carries an `aria-label` naming the
// quiz because the visible text alone ("Present") is ambiguous once it is
// one of several identical-looking rows.
function QuizRow({ quiz, eventName, onOpen, interactive, actions }) {
  const nq = normalizeQuiz(quiz);
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '.9rem 1rem', color: 'var(--cream)', fontFamily: 'var(--font-b)', minHeight: 44, flexWrap: 'wrap' };
  const labelStyle = { flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', padding: 0, margin: 0, textAlign: 'left', color: 'inherit', font: 'inherit', minHeight: 44, cursor: interactive ? 'pointer' : 'default' };
  const label = (
    <>
      <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>{nq.rounds[0]?.icon || '🎯'}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quiz.title}</div>
        <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{nq.rounds.length} ronde{nq.rounds.length === 1 ? '' : 's'} · {totalQuestions(quiz)} vraag{totalQuestions(quiz) === 1 ? '' : 'en'}{eventName ? ` · ${eventName}` : ' · Losstaand'}</div>
      </span>
    </>
  );
  return (
    <div style={rowStyle}>
      {interactive
        ? <button type="button" onClick={onOpen} style={labelStyle}>{label}</button>
        : <div style={labelStyle}>{label}</div>}
      <Tag color={STATUS_COLOR[quiz.status] || 'var(--muted2)'}>{STATUS_LABEL[quiz.status] || quiz.status}</Tag>
      {actions}
    </div>
  );
}

// Every finished quiz not present in `tableQuizzes` because it predates
// WP-Q5's dual write (the brief's "built-since" state: legacy column only,
// no `quizzes` row yet) -- scanned out of the `events` this page already has
// in hand rather than dropped silently, which is exactly the "a row is
// missing and nothing errors" shape this whole work package exists to close.
// Editing one of these still goes through the exact same `QuizDashboard`
// (found via its real `eventId`), so there is no second edit path for it --
// only its *discoverability* from this page is new.
function legacyOnlyQuizzes(events, tableIds) {
  const out = [];
  (Array.isArray(events) ? events : []).forEach(evt => {
    (evt.quizzes || []).forEach(q => {
      if (!q || !q.id || tableIds.has(q.id)) return;
      out.push({ ...q, eventId: q.eventId ?? evt.id });
      tableIds.add(q.id);
    });
  });
  return out;
}

// The one place that answers "which event, if any, actually owns this
// quiz's editable definition" -- i.e. is it present in some event's own
// `evt.quizzes[]` array, the array `QuizDashboard` exclusively reads/writes
// (verified by reading that file: its sidebar, its editor, its presenter,
// its finish flow are ALL `evt.quizzes`-driven; a `quizzes`-table row only
// ever gets a fire-and-forget mirror write from there, never a read). A
// quiz's `eventId` FIELD (on the merged row, or on a `quizzes` table row) is
// just a label -- this function is the one thing that checks the actual
// structure, deliberately by scanning every event rather than trusting
// `quiz.eventId` to name the right one, because the whole point of the
// link/relink feature below is a state where those two can legitimately
// disagree for a moment (a "move" whose second write hasn't landed, or
// simply chose not to -- see `applyLink`'s own comment). Search order
// matches `legacyOnlyQuizzes`'s own iteration.
function findHomeEvent(quizId, events) {
  return (Array.isArray(events) ? events : []).find(evt => (evt.quizzes || []).some(q => q && q.id === quizId)) || null;
}

// Owner brief, 2026-08-26: "i want to be able to still connect a quiz to an
// event afterwards, when the quiz is already created". Modelled on
// `NewQuizModal` right above it -- same event dropdown, same "geen event"
// option, same modal shell -- because this is the same choice
// (event-or-standalone) made a second time, not a new kind of decision.
//
// `homeEventId` is the *structural* current link (`findHomeEvent`'s
// result), not `quiz.eventId` -- see that function's own comment for why
// they can disagree. Pre-selecting the structural truth, and treating a
// re-pick of the exact same value as a no-op (`QuizPageShell`'s `applyLink`
// short-circuits on it too, belt and suspenders), is what stops a click on
// "Opslaan" from ever silently re-running a move that already happened, or
// -- worse -- silently deleting a legacy quiz's only home by "moving" it
// onto itself (§ this file's own `applyLink` comment).
function LinkQuizModal({ quiz, homeEventId, events, onClose, onSave }) {
  const [eventId, setEventId] = useState(homeEventId || '');
  const activeEvents = (events || []).filter(e => !e.archived);
  const headingId = 'qz-link-title';
  const unchanged = (eventId || null) === (homeEventId || null);
  return (
    <Modal onClose={onClose} labelledBy={headingId}>
      <H id={headingId} size="1.15rem">Quiz koppelen</H>
      <div style={{ display: 'grid', gap: '.8rem' }}>
        <div style={{ fontSize: '.85rem', color: 'var(--cream)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quiz.title}</div>
        {quiz.status === 'finished' && (
          <div role="note" style={{ background: 'rgba(232,148,58,.09)', border: '1px solid rgba(232,148,58,.3)', borderRadius: 10, padding: '.7rem .85rem', fontSize: '.78rem', color: 'var(--cream)', lineHeight: 1.5 }}>
            ⚠️ Deze quiz is al afgerond. Eventuele gepubliceerde prijzen (Winners &amp; Highlights, team-prestaties) blijven staan op het event waarvoor ze zijn uitgereikt op het moment van afronden -- die verhuizen niet automatisch mee als je nu een ander event kiest.
          </div>
        )}
        <div>
          <label htmlFor="qz-link-evt" style={{ display: 'block', fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>Koppel aan event</label>
          <select id="qz-link-evt" value={eventId} onChange={e => setEventId(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' }}>
            <option value="">Geen event — losstaande quiz</option>
            {activeEvents.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Annuleren</Btn>
          <Btn onClick={() => onSave(eventId || null)} disabled={unchanged}>Opslaan</Btn>
        </div>
      </div>
    </Modal>
  );
}

function NewQuizModal({ events, onClose, onPickEvent, onPickStandalone }) {
  const [eventId, setEventId] = useState('');
  const activeEvents = (events || []).filter(e => !e.archived);
  const headingId = 'qz-new-title';
  return (
    <Modal onClose={onClose} labelledBy={headingId}>
      <H id={headingId} size="1.15rem">Nieuwe quiz</H>
      <div style={{ display: 'grid', gap: '.8rem' }}>
        <div>
          <label htmlFor="qz-new-evt" style={{ display: 'block', fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>Koppel aan event (optioneel)</label>
          <select id="qz-new-evt" value={eventId} onChange={e => setEventId(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' }}>
            <option value="">Geen event — losstaande quiz</option>
            {activeEvents.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <div style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
            Een quiz kan altijd los bestaan, of aan één event hangen — precies zoals Mens-Games.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Annuleren</Btn>
          <Btn onClick={() => (eventId ? onPickEvent(eventId) : onPickStandalone())}>Verder →</Btn>
        </div>
      </div>
    </Modal>
  );
}

function QuizPageShell({ events = [], users = [], currentUser, can, teamSets = [], teamSetsError = null, onRetryTeamSets, onUpdateEvent, onSendNotif }) {
  const [tableQuizzes, setTableQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // null | 'missing-table' | 'network'
  const [statusFilter, setStatusFilter] = useState('alle');
  const [showNew, setShowNew] = useState(false);

  // Delegated editing: a real event object + which quiz (or "new") to land
  // on inside its `QuizDashboard` -- see this file's own header for why an
  // event-linked quiz is never edited a second way here.
  const [dashEvt, setDashEvt] = useState(null);
  const [dashQuizId, setDashQuizId] = useState(null);
  const [dashNew, setDashNew] = useState(false);

  // Standalone editing/presenting -- the one genuinely new write path,
  // straight against the `quizzes` table.
  const [standaloneEdit, setStandaloneEdit] = useState(null); // quiz object | 'new' | null
  const [presenterQuiz, setPresenterQuiz] = useState(null);
  const [finishError, setFinishError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  // Link/relink/unlink (owner brief 2026-08-26: "i want to be able to still
  // connect a quiz to an event afterwards, when the quiz is already
  // created") -- `linkTarget` is the quiz whose modal is open, `linkError`
  // holds what to retry.
  const [linkTarget, setLinkTarget] = useState(null); // quiz object | null
  const [linkError, setLinkError] = useState(null); // { quiz, targetEventId } | null

  const load = () => {
    setLoading(true);
    setError(null);
    fetchQuizzes().then(res => {
      setLoading(false);
      if (!res.ok) { setError(isMissingTableError(res.error) ? 'missing-table' : 'network'); return; }
      setTableQuizzes(res.quizzes);
    });
  };
  useEffect(load, []);

  const isAdmin = can ? can.hostQuiz(currentUser) : false;

  const merged = useMemo(() => {
    const ids = new Set(tableQuizzes.map(q => q.id));
    return [...tableQuizzes, ...legacyOnlyQuizzes(events, ids)];
  }, [tableQuizzes, events]);

  const visible = useMemo(
    () => (statusFilter === 'alle' ? merged : merged.filter(q => q.status === statusFilter)),
    [merged, statusFilter],
  );

  const eventNameFor = quiz => (quiz.eventId ? (events.find(e => e.id === quiz.eventId)?.name || null) : null);

  const openQuizRow = quiz => {
    // Defence in depth alongside `QuizRow`'s own `interactive` gate below --
    // this function is the one thing that actually mounts the (unguarded)
    // `QuizDashboard`/builder, so it refuses on its own too rather than
    // trusting every call site to remember the check.
    if (!isAdmin) return;
    // `findHomeEvent`, not `quiz.eventId` -- routing on the field alone was
    // fine when the two could never disagree (every existing write path
    // that sets a real `event_id` also guarantees the matching
    // `evt.quizzes[]` entry -- the migration, and `QuizDashboard`'s own
    // dual-write). The link/relink feature below deliberately does NOT
    // maintain that mirror (see `applyLink`'s comment for why), so a
    // link/unlink can leave `eventId` naming an event this quiz was never
    // physically moved into. Routing on the field regardless would open
    // `QuizDashboard` for that event, whose own sidebar/editor only ever
    // reads `evt.quizzes` -- it would find nothing, land on "Select a quiz
    // to edit", and the admin would have clicked a quiz and landed nowhere
    // near it. Structural membership is what `QuizDashboard` actually acts
    // on, so it's what decides here too.
    const homeEvent = findHomeEvent(quiz.id, events);
    if (homeEvent) { setDashEvt(homeEvent); setDashQuizId(quiz.id); setDashNew(false); return; }
    setStandaloneEdit(quiz);
  };
  const isDashboardManaged = quiz => !!findHomeEvent(quiz.id, events);

  const closeDash = () => { setDashEvt(null); setDashQuizId(null); setDashNew(false); };

  const saveStandalone = quiz => {
    const nowIso = new Date().toISOString();
    const wasNew = standaloneEdit === 'new';
    let fullQuiz;
    if (wasNew) {
      // Winner-tab brief (2026-08-26): merge, don't overwrite -- a `winner`
      // override picked before the very first save must survive alongside
      // the brand-new quiz's literal defaults.
      fullQuiz = { ...quiz, id: `qz${Date.now()}`, eventId: null, status: 'ready', scores: {}, memberScores: {}, participants: [], settings: { secret: false, published: false, ...(quiz.settings && typeof quiz.settings === 'object' ? quiz.settings : {}) }, rev: 1, createdBy: currentUser?.username || '', createdAt: nowIso, updatedAt: nowIso, finishedAt: null };
    } else {
      const prior = tableQuizzes.find(q => q.id === standaloneEdit.id) || standaloneEdit;
      const priorRev = Number.isFinite(prior.rev) ? prior.rev : 1;
      // `eventId: prior.eventId` (was a hardcoded `null`) -- until the link
      // feature below, a quiz reaching this branch could never have a
      // non-null `eventId` in the first place (only `!eventId` rows ever
      // opened the standalone builder), so hardcoding `null` was a no-op.
      // Now a linked-but-standalone-managed quiz can land here too (see
      // `openQuizRow`), and the builder's own `onSave` never sends an
      // `eventId` field at all (it doesn't know about one) -- forcing
      // `null` would silently unlink the quiz on its very next content
      // edit, the exact "click Save, and something you didn't touch
      // changed" shape this whole feature exists to avoid.
      fullQuiz = { ...prior, ...quiz, eventId: prior.eventId ?? null, rev: priorRev + 1, updatedAt: nowIso };
    }
    setStandaloneEdit(null);
    saveQuiz(fullQuiz).then(res => {
      if (!res.ok) { setSaveError({ quiz: fullQuiz }); return; }
      setTableQuizzes(prev => (wasNew ? [fullQuiz, ...prev] : prev.map(q => (q.id === fullQuiz.id ? fullQuiz : q))));
      if (wasNew) onSendNotif?.({ message: `Nieuwe quiz beschikbaar: "${fullQuiz.title}"`, type: 'quiz', tab: null, targetId: null, eventId: null, event: fullQuiz.title });
    });
  };
  const retrySaveStandalone = () => {
    if (!saveError) return;
    saveQuiz(saveError.quiz).then(res => setSaveError(res.ok ? null : { quiz: saveError.quiz }));
  };

  // Link / relink / unlink an existing quiz (§ this file's own report --
  // docs/quiz-unification-spec.md has no section for this yet, this is new
  // ground). Two real storage states behave differently:
  //
  // - Already a `quizzes` row (`hasTableRow`, true for every standalone
  //   quiz AND every dashboard-managed quiz built since QuizDashboard
  //   started dual-writing this week): the write IS narrow, exactly as
  //   the spec's §3.1 "no FK, same as `tournaments`" framing implies --
  //   `patchQuizEventId`, one column, never the ~33 kB `rounds` blob.
  // - No row yet (a legacy quiz that predates the dual-write): there is
  //   nothing to patch, so this seeds one with a full `saveQuiz` upsert --
  //   same "exists? patch : seed" idiom `finishQuiz.js`'s
  //   `persistFinishedQuiz` already uses for the identical no-row trap,
  //   reusing the object this page already holds in memory rather than an
  //   extra `quizRowExists` round trip (this page already knows via
  //   `tableQuizzes`).
  //
  // Either way, if the quiz is structurally embedded in some event's own
  // `evt.quizzes[]` (`homeEvent` -- true for a legacy-only quiz, and for a
  // dashboard-managed quiz that also has a table mirror), that embedding
  // is what `QuizDashboard` actually reads/writes/presents/finishes off,
  // so a "link" that only touches the `quizzes` table would leave the old
  // event still fully able to edit/present/finish its own copy --
  // divergence waiting to happen, and exactly the "the merge keeps
  // showing the legacy copy and the link silently does nothing" failure
  // the brief warns about. So a move out of `homeEvent` is real: after the
  // table write above lands, this quiz is removed from `homeEvent.quizzes`
  // too. That happens through `onUpdateEvent` (App.jsx's `updateEvent`),
  // which -- unlike every `api.js` function here -- reports NO success or
  // failure to its caller: it rolls its own local `events` state back and
  // shows its own global `writeError` banner on a Supabase error, but
  // returns nothing to branch on. That is why this cleanup runs LAST,
  // strictly after the table write is confirmed `ok`, and never the other
  // way around: the table write is the one thing this function can verify,
  // so it is the one thing that gets to be a precondition for anything
  // destructive. If this last step fails, nothing here can know -- the
  // quiz then exists in the `quizzes` table (new link, already correct)
  // AND still physically inside `homeEvent.quizzes` (a stale duplicate).
  // Not silent -- the app's own `writeError` banner fires -- and not data
  // loss, since `legacyOnlyQuizzes` above already excludes any id present
  // in `tableQuizzes`, so THIS page's list shows only the new, correct
  // link regardless. The stale duplicate is a real, acknowledged residual
  // risk (`homeEvent`'s own Quiz tab would still offer to edit/present/
  // finish it) that only retrying this action -- or a fix inside
  // `QuizDashboard.jsx` itself, out of this file's reach -- clears.
  //
  // Deliberately does NOT mirror the quiz INTO the new target event's own
  // `evt.quizzes[]` (the brief's suggested recipe doesn't either). Doing
  // that would face the identical undetectable-failure problem one step
  // earlier and for no gain: `openQuizRow` above already treats "not
  // structurally embedded" as "edit it here, standalone" rather than as an
  // error, so a freshly linked quiz is fully editable/presentable/
  // finishable the moment this function's table write lands -- just via
  // this page's own `QuizBuilder`/`QuizPresenter`, the same components
  // `QuizDashboard` uses internally, not via that event's own dashboard
  // shell. Re-picking the SAME event a legacy quiz is already
  // structurally home in is guarded against for exactly this reason: doing
  // the full move for a no-op target would strip it out of its only home
  // without anywhere else to land it.
  const applyLink = (quiz, targetEventId) => {
    const homeEvent = findHomeEvent(quiz.id, events);
    const currentEventId = homeEvent ? homeEvent.id : (quiz.eventId || null);
    const nextEventId = targetEventId || null;
    // Closes the modal synchronously either way -- matching this file's own
    // established idiom (`saveStandalone`/`NewQuizModal` both close on
    // click and let a failure surface through the page-level `ErrorState` +
    // retry, rather than keeping the dialog open across the round trip).
    setLinkTarget(null);
    if (nextEventId === currentEventId) return;

    const nowIso = new Date().toISOString();
    const cleanupHomeEvent = () => {
      if (homeEvent) onUpdateEvent({ ...homeEvent, quizzes: (homeEvent.quizzes || []).filter(q => q && q.id !== quiz.id) });
    };

    if (tableQuizzes.some(q => q.id === quiz.id)) {
      const priorEventId = currentEventId;
      const priorUpdatedAt = quiz.updatedAt;
      // Optimistic, matching this app's own convention (App.jsx's
      // `updateEvent`) -- rolled back below on a confirmed failure.
      setTableQuizzes(prev => prev.map(q => (q.id === quiz.id ? { ...q, eventId: nextEventId, updatedAt: nowIso } : q)));
      patchQuizEventId(quiz.id, nextEventId).then(res => {
        if (!res.ok) {
          setTableQuizzes(prev => prev.map(q => (q.id === quiz.id ? { ...q, eventId: priorEventId, updatedAt: priorUpdatedAt } : q)));
          setLinkError({ quiz, targetEventId: nextEventId });
          return;
        }
        setLinkError(null);
        cleanupHomeEvent();
      });
    } else {
      const fullQuiz = normalizeQuiz({ ...quiz, eventId: nextEventId, updatedAt: nowIso });
      saveQuiz(fullQuiz).then(res => {
        if (!res.ok) { setLinkError({ quiz, targetEventId: nextEventId }); return; }
        setLinkError(null);
        setTableQuizzes(prev => [fullQuiz, ...prev]);
        cleanupHomeEvent();
      });
    }
  };
  const retryLink = () => {
    if (!linkError) return;
    applyLink(linkError.quiz, linkError.targetEventId);
  };

  const duplicateStandalone = quiz => {
    const dup = { ...quiz, id: `qz${Date.now()}`, title: `Copy of ${quiz.title}`, eventId: null, status: 'ready', scores: {}, memberScores: {}, rev: 1, finishedAt: null };
    saveQuiz(dup).then(res => { if (res.ok) setTableQuizzes(prev => [dup, ...prev]); });
  };
  const removeStandalone = quiz => {
    setTableQuizzes(prev => prev.filter(q => q.id !== quiz.id));
    deleteQuiz(quiz.id);
  };

  // `eventFor` resolves the REAL event object a (now possibly linked)
  // standalone quiz should publish its `Winner` rows onto -- before the
  // link feature existed, every quiz reaching this page's own
  // `QuizPresenter` had `eventId===null` by construction (the actions
  // block only ever showed "Present" for `!q.eventId` rows), so hardcoding
  // `event: null` here was correct, not an oversight. It no longer is: a
  // quiz can now carry a real `eventId` while still being presented/
  // finished from THIS page (see `openQuizRow`'s comment for why that's
  // deliberate), and finishing it with `event: null` would silently skip
  // `pushWinnersToEvent` -- awards computed, never written anywhere,
  // reported as a success. Exactly the failure shape this whole feature
  // exists to close, just relocated to "Afronden" instead of "Koppelen".
  const eventFor = quiz => (quiz.eventId ? events.find(e => e.id === quiz.eventId) || null : null);

  const retryFinishPublish = () => {
    if (!finishError) return;
    const linkedEvent = eventFor(finishError.quiz);
    finishQuiz({ quiz: finishError.quiz, event: linkedEvent, onUpdateEvent: linkedEvent ? onUpdateEvent : undefined, teamSets }).then(
      result => setFinishError(result.ok ? null : { quiz: finishError.quiz }),
    );
  };

  if (loading) return <LoadingBlock label="Quizzen laden…" />;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <H size="1.6rem" style={{ marginBottom: 0 }}>🧠 Quiz</H>
        {isAdmin && <Btn onClick={() => setShowNew(true)} disabled={!!error} title={error ? 'Quizzen konden niet geladen worden -- probeer eerst opnieuw te laden.' : undefined}>+ Nieuwe quiz</Btn>}
      </div>

      {finishError && <ErrorState message="Quiz afgerond, maar niet alles is gepubliceerd -- sommige awards staan mogelijk nog niet online. Probeer het opnieuw." onRetry={retryFinishPublish} />}
      {saveError && <ErrorState message="Opslaan is mislukt. Probeer het opnieuw." onRetry={retrySaveStandalone} />}
      {linkError && <ErrorState message="De event-koppeling kon niet worden opgeslagen. Probeer het opnieuw." onRetry={retryLink} />}

      {error === 'missing-table' && (
        <ErrorState message="Quiz staat nog niet klaar aan de databasekant: de tabellen ontbreken. Vraag de beheerder om de quiz-migratie uit te voeren (docs/quiz-unification-spec.md §10)." onRetry={load} />
      )}
      {error === 'network' && <ErrorState message="Kon de quizzen niet laden. Controleer je verbinding." onRetry={load} />}

      {!error && (
        <>
          {merged.length > 0 && (
            <div style={{ display: 'flex', gap: '.2rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
              {STATUS_FILTERS.map(f => (
                <SubTab key={f} active={statusFilter === f} onClick={() => setStatusFilter(f)}>
                  {STATUS_FILTER_LABEL[f]}
                </SubTab>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState icon="🧠" title={merged.length === 0 ? 'Nog geen quizzen' : 'Niets in dit filter'} hint={isAdmin ? 'Maak er eentje aan om te beginnen -- los, of gekoppeld aan een event.' : 'Vraag een org/admin om een quiz te starten.'} />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {visible.map(q => (
                <QuizRow
                  key={q.id}
                  quiz={q}
                  eventName={eventNameFor(q)}
                  onOpen={() => openQuizRow(q)}
                  interactive={isAdmin}
                  actions={isAdmin && !standaloneEdit && !presenterQuiz ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* Present/Duplicate/Delete stay restricted to a
                          standalone-managed row (`!isDashboardManaged`) --
                          a dashboard-managed quiz already has this exact
                          functionality inside its own `QuizDashboard`
                          (real event tab or delegated here), and duplicating
                          that set of controls here would be a second,
                          divergent copy of the same three actions, the
                          precise thing this file's own header says the
                          delegated-editing design avoids. Link/unlink is
                          new and applies to every row -- it's the only
                          action that changes WHICH of those two management
                          styles applies, so it has to be reachable from
                          both. */}
                      {!isDashboardManaged(q) && q.status !== 'finished' && (
                        <Btn size="sm" variant="ghost" aria-label={`Presenteer ${q.title}`} onClick={() => setPresenterQuiz(normalizeQuiz(q))}>🎤 Present</Btn>
                      )}
                      {!isDashboardManaged(q) && (
                        <Btn size="sm" variant="ghost" aria-label={`Dupliceer ${q.title}`} onClick={() => duplicateStandalone(q)}>⧉</Btn>
                      )}
                      <Btn size="sm" variant="ghost" aria-label={`Event-koppeling van ${q.title}`} onClick={() => setLinkTarget(q)}>🔗</Btn>
                      {!isDashboardManaged(q) && (
                        <Btn size="sm" variant="danger" aria-label={`Verwijder ${q.title}`} onClick={() => removeStandalone(q)}>✕</Btn>
                      )}
                    </div>
                  ) : null}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showNew && (
        <NewQuizModal
          events={events}
          onClose={() => setShowNew(false)}
          onPickEvent={eventId => { setShowNew(false); const linkedEvent = events.find(e => e.id === eventId); if (linkedEvent) { setDashEvt(linkedEvent); setDashQuizId(null); setDashNew(true); } }}
          onPickStandalone={() => { setShowNew(false); setStandaloneEdit('new'); }}
        />
      )}

      {dashEvt && (
        <QuizDashboard evt={dashEvt} onUpdate={onUpdateEvent} onClose={closeDash} users={users} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={onRetryTeamSets} onSendNotif={onSendNotif} initialQuizId={dashQuizId} initialNew={dashNew} />
      )}

      {standaloneEdit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 998, background: 'var(--bg)', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.9rem 1.4rem', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
            <div style={{ fontFamily: 'var(--font-h)', fontSize: '1.05rem', color: 'var(--amber2)' }}>🧠 {standaloneEdit === 'new' ? 'Nieuwe losstaande quiz' : `Quiz bewerken`}</div>
            <button onClick={() => setStandaloneEdit(null)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--muted)', padding: '6px 14px', cursor: 'pointer', fontFamily: 'var(--font-b)', fontSize: '.8rem' }}>✕ Sluiten</button>
          </div>
          <div style={{ padding: '1.5rem', maxWidth: 820, margin: '0 auto' }}>
            <QuizBuilder
              existing={standaloneEdit === 'new' ? null : normalizeQuiz(standaloneEdit)}
              attendees={activeUserRoster(users)}
              team_sets={teamSets.filter(ts => ts.status === 'active')}
              teamSetsError={teamSetsError}
              onRetryTeamSets={onRetryTeamSets}
              onSave={saveStandalone}
              onCancel={() => setStandaloneEdit(null)}
            />
          </div>
        </div>
      )}

      {presenterQuiz && (
        <QuizPresenter
          quiz={presenterQuiz}
          evt={{ id: presenterQuiz.id, attendees: activeUserRoster(users) }}
          users={users}
          onClose={() => setPresenterQuiz(null)}
          onFinish={finalScores => {
            const pq = normalizeQuiz(presenterQuiz);
            const memberScores = computeMemberScores(pq, finalScores);
            const finishedQuiz = { ...pq, status: 'finished', scores: finalScores, memberScores };
            setPresenterQuiz(null);
            const linkedEvent = eventFor(finishedQuiz);
            finishQuiz({ quiz: finishedQuiz, event: linkedEvent, onUpdateEvent: linkedEvent ? onUpdateEvent : undefined, teamSets }).then(result => {
              setTableQuizzes(prev => prev.map(q => (q.id === finishedQuiz.id ? finishedQuiz : q)));
              setFinishError(result.ok ? null : { quiz: finishedQuiz });
            });
          }}
        />
      )}

      {linkTarget && (
        <LinkQuizModal
          quiz={linkTarget}
          homeEventId={findHomeEvent(linkTarget.id, events)?.id || linkTarget.eventId || null}
          events={events}
          onClose={() => setLinkTarget(null)}
          onSave={eventId => applyLink(linkTarget, eventId)}
        />
      )}

    </div>
  );
}

function QuizEventShell({ evt, onUpdate, currentUser, users, isPast, can, teamSets, teamSetsError, onRetryTeamSets, onSendNotif }) {
  const [quizDash, setQuizDash] = useState(false);
  return (
    <>
      <QuizTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast} users={users} onOpenQuizDash={() => setQuizDash(true)} can={can} />
      {quizDash && (
        <QuizDashboard evt={evt} onUpdate={onUpdate} users={users} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={onRetryTeamSets} onClose={() => setQuizDash(false)} onSendNotif={onSendNotif} />
      )}
    </>
  );
}

export default function QuizShell({ scope = 'page', evt, onUpdate, isPast, events = [], onUpdateEvent, users = [], currentUser, can, teamSets = [], teamSetsError = null, onRetryTeamSets, onSendNotif }) {
  if (scope === 'event') {
    return <QuizEventShell evt={evt} onUpdate={onUpdate} currentUser={currentUser} users={users} isPast={isPast} can={can} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={onRetryTeamSets} onSendNotif={onSendNotif} />;
  }
  return <QuizPageShell events={events} users={users} currentUser={currentUser} can={can} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={onRetryTeamSets} onUpdateEvent={onUpdateEvent} onSendNotif={onSendNotif} />;
}
