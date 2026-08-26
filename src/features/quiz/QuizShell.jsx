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
// editing for an event-linked quiz -- every quiz with a real `eventId` that
// resolves to a known event is opened through the exact same, already-tested
// `QuizDashboard` (via its new, additive `initialQuizId`/`initialNew` props),
// so a migrated/built-since/brand-new quiz keeps working exactly the way it
// does from the event tab, no second write path to keep in sync. Only a
// truly standalone quiz (`eventId===null` -- the owner's "own general
// feature" case) is built/presented/finished here directly, against the
// `quizzes` table (`api.js`) with no legacy array to dual-write into,
// because a standalone quiz never had one.
import { useEffect, useMemo, useState } from 'react';
import QuizTab from './QuizTab.jsx';
import QuizDashboard from './QuizDashboard.jsx';
import { QuizBuilder } from './QuizBuilder.jsx';
import { QuizPresenter } from './QuizPresenter.jsx';
import { normalizeQuiz } from './model.js';
import { computeMemberScores, finishQuiz } from './finishQuiz.js';
import { deleteQuiz, fetchQuizzes, isMissingTableError, saveQuiz } from './api.js';
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
function QuizRow({ quiz, eventName, onOpen, interactive }) {
  const nq = normalizeQuiz(quiz);
  const content = (
    <>
      <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>{nq.rounds[0]?.icon || '🎯'}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quiz.title}</div>
        <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{nq.rounds.length} ronde{nq.rounds.length === 1 ? '' : 's'} · {totalQuestions(quiz)} vraag{totalQuestions(quiz) === 1 ? '' : 'en'}{eventName ? ` · ${eventName}` : ' · Losstaand'}</div>
      </span>
      <Tag color={STATUS_COLOR[quiz.status] || 'var(--muted2)'}>{STATUS_LABEL[quiz.status] || quiz.status}</Tag>
    </>
  );
  const rowStyle = { width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '.9rem 1rem', color: 'var(--cream)', fontFamily: 'var(--font-b)', minHeight: 44 };
  if (!interactive) return <div style={rowStyle}>{content}</div>;
  return (
    <button type="button" onClick={onOpen} style={{ ...rowStyle, cursor: 'pointer' }}>
      {content}
    </button>
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
    const linkedEvent = quiz.eventId ? events.find(e => e.id === quiz.eventId) : null;
    if (linkedEvent) { setDashEvt(linkedEvent); setDashQuizId(quiz.id); setDashNew(false); return; }
    setStandaloneEdit(quiz);
  };

  const closeDash = () => { setDashEvt(null); setDashQuizId(null); setDashNew(false); };

  const saveStandalone = quiz => {
    const nowIso = new Date().toISOString();
    const wasNew = standaloneEdit === 'new';
    let fullQuiz;
    if (wasNew) {
      fullQuiz = { ...quiz, id: `qz${Date.now()}`, eventId: null, status: 'ready', scores: {}, memberScores: {}, participants: [], settings: { secret: false, published: false }, rev: 1, createdBy: currentUser?.username || '', createdAt: nowIso, updatedAt: nowIso, finishedAt: null };
    } else {
      const prior = tableQuizzes.find(q => q.id === standaloneEdit.id) || standaloneEdit;
      const priorRev = Number.isFinite(prior.rev) ? prior.rev : 1;
      fullQuiz = { ...prior, ...quiz, eventId: null, rev: priorRev + 1, updatedAt: nowIso };
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

  const duplicateStandalone = quiz => {
    const dup = { ...quiz, id: `qz${Date.now()}`, title: `Copy of ${quiz.title}`, eventId: null, status: 'ready', scores: {}, memberScores: {}, rev: 1, finishedAt: null };
    saveQuiz(dup).then(res => { if (res.ok) setTableQuizzes(prev => [dup, ...prev]); });
  };
  const removeStandalone = quiz => {
    setTableQuizzes(prev => prev.filter(q => q.id !== quiz.id));
    deleteQuiz(quiz.id);
  };

  const retryFinishPublish = () => {
    if (!finishError) return;
    finishQuiz({ quiz: finishError.quiz, event: null, onUpdateEvent: undefined, teamSets }).then(
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
              {visible.map(q => <QuizRow key={q.id} quiz={q} eventName={eventNameFor(q)} onOpen={() => openQuizRow(q)} interactive={isAdmin} />)}
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
            finishQuiz({ quiz: finishedQuiz, event: null, onUpdateEvent: undefined, teamSets }).then(result => {
              setTableQuizzes(prev => prev.map(q => (q.id === finishedQuiz.id ? finishedQuiz : q)));
              setFinishError(result.ok ? null : { quiz: finishedQuiz });
            });
          }}
        />
      )}

      {/* Present/duplicate/delete for a standalone quiz row -- kept as a
          lightweight action strip under the list rather than a second
          click layer inside `QuizRow` (which is a single full-width button,
          the same shape `mensgames/MensGamesShell.jsx`'s `TournamentRow`
          uses), so every action stays a real, keyboard-reachable `<button>`. */}
      {visible.filter(q => !q.eventId).length > 0 && !standaloneEdit && !presenterQuiz && (
        <div style={{ display: 'grid', gap: 6 }}>
          {visible.filter(q => !q.eventId).map(q => (
            <div key={`actions-${q.id}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {isAdmin && q.status !== 'finished' && <Btn size="sm" variant="ghost" onClick={() => setPresenterQuiz(normalizeQuiz(q))}>🎤 Present &ldquo;{q.title}&rdquo;</Btn>}
              {isAdmin && <Btn size="sm" variant="ghost" onClick={() => duplicateStandalone(q)}>⧉ Dupliceer &ldquo;{q.title}&rdquo;</Btn>}
              {isAdmin && <Btn size="sm" variant="danger" onClick={() => removeStandalone(q)}>✕ Verwijder &ldquo;{q.title}&rdquo;</Btn>}
            </div>
          ))}
        </div>
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
