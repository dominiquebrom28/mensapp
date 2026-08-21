// The tournament workspace: entrants, the round list, standings, and the
// cast-to-a-room scoreboard (docs/mensgames-spec.md §3.2, §5 WP-F).
//
// Autosave: every edit updates local state immediately (so the UI never
// waits on a round trip) and schedules a write 400ms later -- WP-E's "a
// stepper click doesn't fire six upserts". Structural actions (create/
// delete a round, reorder, lock/unlock, change tournament status, delete
// the tournament) flush immediately instead, so a lad who locks a round and
// immediately backs out never loses that specific write to a
// still-pending, later-superseded debounce timer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Card, Divider, ErrorState, H, Inp, Lbl, Modal, Switch, Tag } from './ui/Kit.jsx';
import EntrantPicker from './EntrantPicker.jsx';
import RoundCard from './RoundCard.jsx';
import RoundEditor from './RoundEditor.jsx';
import StandingsTable from './StandingsTable.jsx';
import ScoreboardPanel from './ScoreboardPanel.jsx';
import { blankRound } from './model.js';
import { computeStandings, lockRound, unlockRound } from './standings.js';
import { finishTournament } from './finishTournament.js';
import { listScoringTypes } from './scoring/index.js';
import { deleteTournament, saveTournament, subscribeTournament } from './api.js';

const SAVE_DEBOUNCE_MS = 400;
const ICON_PRESETS = ['⚽', '🏓', '🎯', '🎱', '🎳', '🃏', '🧠', '🏹', '🍺', '🎮'];
const STATUS_LABEL = { draft: 'Concept', live: 'Bezig', finished: 'Afgerond' };
const STATUS_COLOR = { draft: 'var(--muted2)', live: 'var(--red)', finished: 'var(--green)' };

function moveItem(arr, index, dir) {
  const to = index + dir;
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export default function TournamentEditor({ tournament: initialTournament, events, teamSets, teamSetsError = null, onRetryTeamSets, canManage, onBack, onDeleted, onLocalChange, onUpdateEvent, onTeamSetsChanged }) {
  const [tournament, setTournamentState] = useState(initialTournament);
  const [expandedRoundId, setExpandedRoundId] = useState(null);
  const [showNewRound, setShowNewRound] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Own wording, not `saveError` -- a failed delete used to show "Opslaan
  // is mislukt" (a message about saving), which is the wrong operation.
  const [deleteError, setDeleteError] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const idRef = useRef(initialTournament.id);
  // Synchronous mirror of `tournament`, used only so `update()` (below) can
  // compute its next value without depending on React's deferred updater
  // invocation -- see that function's own comment for why.
  const tournamentRef = useRef(initialTournament);
  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  useEffect(() => {
    // A different tournament was opened -- reset local state rather than
    // merging stale edits from the previous one into it.
    if (initialTournament.id !== idRef.current) {
      idRef.current = initialTournament.id;
      setTournamentState(initialTournament);
      setExpandedRoundId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTournament.id]);

  const persist = (next) => {
    setSaving(true);
    saveTournament(next).then((res) => {
      setSaving(false);
      setSaveError(!res.ok);
    });
  };

  // Computes `next` off `tournamentRef` (updated synchronously right here,
  // not via a `setTournamentState` functional updater) rather than off
  // React's own deferred `prev` -- two things this avoids:
  //  - `onLocalChange`/`persist` running from *inside* a `setState`
  //    updater, which React may invoke more than once per commit
  //    (StrictMode does, in dev) and which is itself a parent `setState`
  //    call (`onLocalChange` is the parent's `setTournaments`) fired
  //    mid-child-render -- both flagged by the security review.
  //  - a stale read: several rapid calls to `update()` inside the same
  //    synchronous batch (six stepper taps -- WP-E) must each chain off the
  //    PREVIOUS tap's result, not off whatever `tournament` still was at
  //    the start of the batch -- `setTournamentState`'s own `prev` isn't
  //    guaranteed to reflect that yet when read synchronously afterwards,
  //    since React defers invoking a functional updater until it processes
  //    the batch. `tournamentRef` is updated inline instead, so it always
  //    reflects the running total mid-batch.
  const update = (updater, { immediate = false } = {}) => {
    const next = typeof updater === 'function' ? updater(tournamentRef.current) : updater;
    tournamentRef.current = next;
    setTournamentState(next);
    onLocalChange?.(next);
    if (immediate) {
      clearTimeout(timerRef.current);
      pendingRef.current = null;
      persist(next);
    } else {
      pendingRef.current = next;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const toSave = pendingRef.current;
        pendingRef.current = null;
        persist(toSave);
      }, SAVE_DEBOUNCE_MS);
    }
  };

  // Flush any pending debounced write on unmount so navigating straight
  // back to the list after a score tap never silently drops it.
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (pendingRef.current) saveTournament(pendingRef.current);
  }, []);

  // Realtime: pick up another device's writes (§2.2 -- one JSONB row gives
  // every viewer a live scoreboard for free via Postgres realtime), same
  // `postgres_changes` idiom EventPage uses for a single event row.
  // Last-write-wins, no merge -- concurrent-edit banner is a documented cut
  // line (§10 #6); the realtime resync itself is the mitigation risk #4
  // calls out ("the second device sees the change within ~1s").
  useEffect(() => {
    const unsubscribe = subscribeTournament(initialTournament.id, (updated) => {
      if (updated) setTournamentState(updated);
      else onDeleted?.();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTournament.id]);

  const linkedEvent = useMemo(() => (events || []).find((e) => e.id === tournament.eventId) || null, [events, tournament.eventId]);
  const entrantsById = useMemo(() => Object.fromEntries((tournament.entrants || []).map((e) => [e.id, e])), [tournament.entrants]);

  const setStatus = (status) => update((t) => ({ ...t, status }), { immediate: true });

  // WP-J: finishing a tournament writes medal winners onto the linked event
  // (reusing `events.winners` -- WinnersTab/HallOfFame pick them up with no
  // changes to either) and a TeamAward onto each medalled team's
  // originating team set (§3.1). A tournament with no linked event still
  // awards teams -- `finishTournament` treats `event` as optional. Archiving
  // the awarded team set(s) is the modal's own explicit opt-in, default off
  // (§13 Q5) -- never automatic.
  const finalStandings = useMemo(() => computeStandings(tournament), [tournament]);
  const medalCount = useMemo(() => finalStandings.filter((s) => Number.isFinite(s.rank) && s.rank >= 1 && s.rank <= 3).length, [finalStandings]);
  const doFinish = async (archiveWinningSets) => {
    setFinishing(true);
    setFinishError(false);
    const result = await finishTournament({ tournament, standings: finalStandings, event: linkedEvent, onUpdateEvent, teamSets, archiveWinningSets });
    setFinishing(false);
    setShowFinish(false);
    if (!result.ok) { setFinishError(true); return; }
    if (result.updatedTeamSets.length && typeof onTeamSetsChanged === 'function') {
      onTeamSetsChanged((prev) => (Array.isArray(prev) ? prev : []).map((ts) => result.updatedTeamSets.find((u) => u.id === ts.id) || ts));
    }
    update(() => result.tournament, { immediate: true });
  };

  const doDelete = async () => {
    if (!window.confirm(`"${tournament.name}" definitief verwijderen? Dit kan niet ongedaan gemaakt worden.`)) return;
    clearTimeout(timerRef.current);
    setDeleteError(false);
    const result = await deleteTournament(tournament.id);
    if (result.ok) onDeleted?.();
    else setDeleteError(true);
  };

  const rounds = tournament.rounds || [];
  const moveRound = (index, dir) => update((t) => ({ ...t, rounds: moveItem(t.rounds, index, dir) }), { immediate: true });
  const deleteRound = (id) => {
    update((t) => ({ ...t, rounds: t.rounds.filter((r) => r.id !== id) }), { immediate: true });
    if (expandedRoundId === id) setExpandedRoundId(null);
  };
  const changeRound = (nextRound) => update((t) => ({ ...t, rounds: t.rounds.map((r) => (r.id === nextRound.id ? nextRound : r)) }));
  const doLock = (roundId) => update((t) => lockRound(t, roundId), { immediate: true });
  const doUnlock = (roundId) => update((t) => unlockRound(t, roundId), { immediate: true });
  // A round's `status` starts 'pending' (blankRound) and only ever flips to
  // 'done' on lock -- nothing marked it 'live' along the way, so the
  // scoreboard's "what's being played right now" section would never find
  // anything to show. Opening a still-pending round to actually work on it
  // is that signal; a structural change (immediate), not a debounced one.
  const toggleRound = (roundId) => {
    setExpandedRoundId((id) => (id === roundId ? null : roundId));
    const round = rounds.find((r) => r.id === roundId);
    if (round && round.status === 'pending') {
      update((t) => ({ ...t, rounds: t.rounds.map((r) => (r.id === roundId ? { ...r, status: 'live' } : r)) }), { immediate: true });
    }
  };

  return (
    <div className="mg-fu" style={{ display: 'grid', gap: '1.2rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Btn variant="ghost" size="sm" onClick={onBack} style={{ marginBottom: 8 }}>← Terug</Btn>
          {canManage ? (
            <Inp value={tournament.name} onChange={(e) => update((t) => ({ ...t, name: e.target.value }))} style={{ fontFamily: 'var(--font-h)', fontSize: '1.4rem', color: 'var(--amber2)', background: 'transparent', border: '1px solid transparent', padding: '2px 4px' }} />
          ) : (
            <H size="1.4rem" style={{ marginBottom: 0 }}>{tournament.name}</H>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <Tag color={STATUS_COLOR[tournament.status]}>{STATUS_LABEL[tournament.status]}</Tag>
            {linkedEvent && <Tag color="var(--blue)">📅 {linkedEvent.name}</Tag>}
            {saving && <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Opslaan…</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="subtle" onClick={() => setShowScoreboard(true)}>📺 Scorebord</Btn>
          {canManage && tournament.status === 'draft' && <Btn onClick={() => setStatus('live')}>▶ Start toernooi</Btn>}
          {canManage && tournament.status === 'live' && <Btn variant="success" onClick={() => setShowFinish(true)}>🏁 Afronden</Btn>}
          {canManage && tournament.status === 'finished' && <Btn variant="ghost" onClick={() => setStatus('live')}>↺ Heropenen</Btn>}
          {canManage && <Btn variant="danger" onClick={doDelete}>Verwijder</Btn>}
        </div>
      </div>

      {saveError && <ErrorState message="Opslaan is mislukt — je laatste wijziging staat mogelijk niet online. Probeer het opnieuw." onRetry={() => persist(tournament)} />}
      {deleteError && <ErrorState message="Verwijderen is mislukt. Probeer het opnieuw." onRetry={doDelete} />}
      {finishError && <ErrorState message="Afronden is niet volledig gelukt — sommige awards zijn mogelijk niet opgeslagen. Probeer het opnieuw." onRetry={() => setShowFinish(true)} />}

      <Card>
        <H size="1.05rem">🧑‍🤝‍🧑 Deelnemers</H>
        <EntrantPicker mode="tournament" bare entrants={tournament.entrants} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={onRetryTeamSets} teamSetId={tournament.teamSetId} linkedEvent={linkedEvent} disabled={!canManage}
          onChange={(entrants) => update((t) => ({ ...t, entrants }))}
          onSetTeamSetId={(id) => update((t) => ({ ...t, teamSetId: id }), { immediate: true })} />
      </Card>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.7rem' }}>
          <H size="1.05rem" style={{ marginBottom: 0 }}>🗂 Rondes</H>
          {canManage && <Btn size="sm" onClick={() => setShowNewRound(true)}>+ Nieuwe ronde</Btn>}
        </div>
        {rounds.length === 0 && <Tag color="var(--muted2)">Nog geen rondes — voeg er eentje toe.</Tag>}
        <div style={{ display: 'grid', gap: 8 }}>
          {rounds.map((round, i) => (
            <div key={round.id}>
              <RoundCard round={round} index={i} roundCount={rounds.length} expanded={expandedRoundId === round.id} disabled={!canManage}
                onToggle={() => toggleRound(round.id)}
                onMoveUp={() => moveRound(i, -1)} onMoveDown={() => moveRound(i, 1)} onDelete={() => deleteRound(round.id)} />
              {expandedRoundId === round.id && (
                <RoundEditor round={round} allEntrants={tournament.entrants} entrantsById={entrantsById} events={events} canManage={canManage}
                  onChange={changeRound} onLock={() => doLock(round.id)} onUnlock={() => doUnlock(round.id)} />
              )}
            </div>
          ))}
        </div>
      </div>

      <StandingsTable tournament={tournament} entrantsById={entrantsById} roundsCount={rounds.length} />

      {showNewRound && (
        <NewRoundModal entrantCount={(tournament.entrants || []).length} onClose={() => setShowNewRound(false)}
          onCreate={(draft) => {
            const round = blankRound(draft);
            round.entrantIds = (tournament.entrants || []).map((e) => e.id);
            update((t) => ({ ...t, rounds: [...t.rounds, round] }), { immediate: true });
            setShowNewRound(false);
            setExpandedRoundId(round.id);
          }} />
      )}

      {showScoreboard && <ScoreboardPanel tournament={tournament} entrantsById={entrantsById} onClose={() => setShowScoreboard(false)} />}

      {showFinish && (
        <FinishTournamentModal
          tournamentName={tournament.name}
          medalCount={medalCount}
          linkedEventName={linkedEvent?.name || null}
          busy={finishing}
          onClose={() => setShowFinish(false)}
          onConfirm={doFinish}
        />
      )}
    </div>
  );
}

function FinishTournamentModal({ tournamentName, medalCount, linkedEventName, busy, onClose, onConfirm }) {
  const [archive, setArchive] = useState(false);
  const headingId = 'mg-finish-title';
  return (
    <Modal onClose={busy ? () => {} : onClose} labelledBy={headingId} maxWidth={440}>
      <H id={headingId} size="1.15rem">🏁 &ldquo;{tournamentName}&rdquo; afronden?</H>
      <div style={{ display: 'grid', gap: '.9rem' }}>
        <div style={{ fontSize: '.86rem', color: 'var(--cream)', lineHeight: 1.5 }}>
          {medalCount > 0
            ? <>Dit kroont {medalCount} deelnemer{medalCount === 1 ? '' : 's'} met een medaille (op basis van de vergrendelde rondes). Elke medaillewinnaar krijgt een award{linkedEventName ? <> en verschijnt bij de Winners van <strong>{linkedEventName}</strong></> : ''}.</>
            : <>Er zijn nog geen vergrendelde rondes met een medaillewinnaar — er worden geen awards toegekend, maar het toernooi wordt wel afgesloten.</>}
        </div>
        <Switch id="mg-finish-archive" checked={archive} onChange={setArchive} label="Archiveer de teamset(s) van de medaillewinnaars" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Annuleren</Btn>
          <Btn variant="success" onClick={() => onConfirm(archive)} disabled={busy}>{busy ? 'Bezig…' : '🏁 Afronden'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function NewRoundModal({ onCreate, onClose, entrantCount }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🎮');
  const [format, setFormat] = useState('matches');
  const compatible = listScoringTypes().filter((t) => t.appliesTo.includes(format));
  const [scoringTypeId, setScoringTypeId] = useState('manual');
  const validTypeId = compatible.some((t) => t.id === scoringTypeId) ? scoringTypeId : (compatible[0]?.id || 'manual');

  const headingId = 'mg-new-round-title';
  return (
    <Modal onClose={onClose} labelledBy={headingId}>
      <H id={headingId} size="1.15rem">Nieuwe ronde</H>
      <div style={{ display: 'grid', gap: '.8rem' }}>
        <div>
          <Lbl htmlFor="mg-new-round-name">Naam</Lbl>
          <Inp id="mg-new-round-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bv. Tafelvoetbal" autoFocus />
        </div>
        <div>
          <Lbl>Icoon</Lbl>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICON_PRESETS.map((ic) => (
              <button key={ic} type="button" onClick={() => setIcon(ic)} aria-pressed={icon === ic} aria-label={`Kies icoon ${ic}`} style={{ width: 40, height: 40, borderRadius: 8, background: icon === ic ? 'rgba(232,148,58,.18)' : 'var(--bg3)', border: `1px solid ${icon === ic ? 'var(--amber)' : 'var(--border)'}`, fontSize: '1.1rem', cursor: 'pointer' }}>{ic}</button>
            ))}
          </div>
        </div>
        <div>
          <Lbl htmlFor="mg-new-round-format">Vorm</Lbl>
          <select id="mg-new-round-format" value={format} onChange={(e) => setFormat(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' }}>
            <option value="matches">Wedstrijden (1-tegen-1)</option>
            <option value="freeform">Vrije score (iedereen los)</option>
            <option value="quiz">Quiz (gekoppeld aan een event)</option>
          </select>
        </div>
        {format !== 'quiz' && (
          <div>
            <Lbl htmlFor="mg-new-round-type">Scoretype</Lbl>
            <select id="mg-new-round-type" value={validTypeId} onChange={(e) => setScoringTypeId(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' }}>
              {compatible.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
            </select>
          </div>
        )}
        {entrantCount === 0 && <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Nog geen deelnemers in het toernooi — deze ronde start leeg, voeg deelnemers hierboven toe.</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Annuleren</Btn>
          <Btn disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), icon, format, scoringTypeId: format === 'quiz' ? 'quiz-linked' : validTypeId })}>Ronde toevoegen</Btn>
        </div>
      </div>
    </Modal>
  );
}
