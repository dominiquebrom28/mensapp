// Full editor for one round (docs/mensgames-spec.md §3.2 `Round`, §4.3
// award decoupling, §4.4 quiz adapter, §4.5 round timer). Rendered by
// `TournamentEditor` right below the matching `RoundCard` when expanded.
//
// The round's `format` (matches/freeform/quiz) is fixed at creation time
// (`TournamentEditor`'s "new round" flow, via `blankRound`) -- this editor
// changes the *scoring type within* that format, entrants, award config,
// and the round's actual content, but never migrates a round between
// formats, so there's no ambiguous "what happens to the existing matches"
// case to reason about.
import { useMemo, useState } from 'react';
import { Btn, Card, Divider, EmptyState, ErrorState, H, Inp, Lbl, Stepper, Tag } from './ui/Kit.jsx';
import ConfigFields from './ConfigFields.jsx';
import EntrantPicker from './EntrantPicker.jsx';
import MatchRow from './MatchRow.jsx';
import { blankMatch, generateRandomPairs, generateRoundRobin } from './model.js';
import { getScoringType, listScoringTypes, SCORING_TYPES } from './scoring/index.js';
import { rankRound } from './standings.js';
import { matchQuizNames, pullQuizResults } from './quizRound.js';
import { useFinishedQuizzes } from './quizPicker.js';
import { useRoundTimer } from './useRoundTimer.js';
import { ROUND_TIMER_MAX_SECONDS, ROUND_TIMER_MIN_SECONDS } from './constants.js';

const ICON_PRESETS = ['⚽', '🏓', '🎯', '🎱', '🎳', '🃏', '🧠', '🏹', '🍺', '🎮'];
const FORMAT_LABEL = { matches: 'Wedstrijden', freeform: 'Vrije score', quiz: 'Quiz' };

function defaultConfigFor(type) {
  const cfg = {};
  (type.configFields || []).forEach((f) => { cfg[f.key] = f.default; });
  return cfg;
}

function AwardEditor({ award, entrantCount, onChange, disabled }) {
  const mode = award?.mode || 'placement';
  const slots = Math.max(4, entrantCount || 0);
  const table = Array.isArray(award?.table) ? award.table : [];
  return (
    <div style={{ display: 'grid', gap: '.7rem' }}>
      <div>
        <Lbl htmlFor="mg-award-mode">Puntenverdeling</Lbl>
        <select id="mg-award-mode" value={mode} disabled={disabled} onChange={(e) => onChange({ ...award, mode: e.target.value })} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' }}>
          <option value="placement">Op klassering (1e, 2e, 3e…)</option>
          <option value="perWin">Per overwinning</option>
          <option value="raw">Rechtstreeks (met factor)</option>
        </select>
      </div>
      {mode === 'placement' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(90px,1fr))', gap: '.6rem' }}>
          {Array.from({ length: slots }).map((_, i) => (
            <Stepper key={i} label={`${i + 1}e plaats`} value={Number.isFinite(table[i]) ? table[i] : 0} min={0} max={999} disabled={disabled} onChange={(v) => { const next = table.slice(); next[i] = v; onChange({ ...award, table: next }); }} />
          ))}
        </div>
      )}
      {mode === 'perWin' && (
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
          <Stepper label="Punten per winst" value={award?.perWin ?? 0} min={0} max={999} disabled={disabled} onChange={(v) => onChange({ ...award, perWin: v })} />
          <Stepper label="Punten per gelijkspel" value={award?.perDraw ?? 0} min={0} max={999} disabled={disabled} onChange={(v) => onChange({ ...award, perDraw: v })} />
        </div>
      )}
      {mode === 'raw' && (
        <div>
          <Lbl htmlFor="mg-raw-factor">Factor (bv. 0.1 om een quiz met 300 punten af te toppen)</Lbl>
          <Inp id="mg-raw-factor" type="number" inputMode="decimal" value={String(award?.rawFactor ?? 1)} disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (e.target.value === '' ) { onChange({ ...award, rawFactor: 0 }); return; }
              if (!Number.isFinite(n)) return;
              onChange({ ...award, rawFactor: Math.min(100, Math.max(0, n)) });
            }} style={{ width: 140 }} />
        </div>
      )}
    </div>
  );
}

function CompactTimer({ seconds, onChangeSeconds, disabled }) {
  const timer = useRoundTimer(seconds || 600);
  const m = Math.floor(timer.remaining / 60);
  const s = timer.remaining % 60;
  const atStart = timer.remaining === timer.totalSeconds && !timer.running && !timer.finished;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: 'var(--font-h)', fontSize: '1.8rem', minWidth: 84, color: timer.finished ? 'var(--red)' : timer.running ? 'var(--amber2)' : 'var(--cream)' }} aria-live="polite">
        {timer.finished ? 'TIJD!' : `${m}:${String(s).padStart(2, '0')}`}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!timer.running && !timer.finished && <Btn size="md" onClick={timer.start}>▶ Start</Btn>}
        {timer.running && <Btn size="md" variant="subtle" onClick={timer.pause}>⏸ Pauze</Btn>}
        {(!atStart || timer.finished) && <Btn size="md" variant="ghost" onClick={timer.reset}>↺ Reset</Btn>}
      </div>
      {!disabled && atStart && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Stepper label="Duur (sec)" value={timer.totalSeconds} min={ROUND_TIMER_MIN_SECONDS} max={ROUND_TIMER_MAX_SECONDS} step={30} onChange={(v) => { timer.setSeconds(v); onChangeSeconds(v); }} />
        </div>
      )}
    </div>
  );
}

const QUIZ_SELECT_STYLE = { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' };

function QuizPanel({ round, entrants, events, onChange, disabled }) {
  const source = round.source || {};
  const { quizzes: allQuizzes, hiddenSecret, loading, error, isMissingTable, refetch } = useFinishedQuizzes(events);

  // The event picker is an *optional* filter now (owner brief, 2026-08-26 —
  // extends docs/quiz-unification-spec.md §8.4): a quiz can exist with no
  // event at all, so requiring one first would hide it. `source.eventId`
  // keeps its old meaning for a round configured before this change (it
  // still narrows the list to that event by default), but nothing about
  // finding or pulling a quiz depends on it any more.
  const filterEventId = source.eventId || '';
  const filtered = filterEventId ? allQuizzes.filter((q) => q.eventId === filterEventId) : allQuizzes;
  const selectedQuiz = allQuizzes.find((q) => q.id === source.quizId) || null;
  // A round configured before this change (or against a filter that no
  // longer matches) must never look like its quiz vanished — surface it as
  // an extra option rather than silently hiding the current selection.
  const quizOptions = (selectedQuiz && !filtered.some((q) => q.id === selectedQuiz.id))
    ? [selectedQuiz, ...filtered]
    : filtered;

  const hasRaw = source.raw && Object.keys(source.raw).length > 0;
  const { matched, unmatched } = useMemo(() => matchQuizNames(source.raw, entrants, source.nameMap), [source.raw, source.nameMap, entrants]);
  const ranking = hasRaw ? rankRound(round) : [];

  const setSource = (patch) => onChange({ ...round, source: { ...source, ...patch } });
  const eventNameFor = (id) => (events || []).find((e) => e.id === id)?.name || null;
  const optionLabel = (q) => `${q.title || 'Naamloze quiz'} — ${q.eventId ? (eventNameFor(q.eventId) || 'gekoppeld event') : 'Losstaand'}`;

  return (
    <div style={{ display: 'grid', gap: '.8rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '.7rem' }}>
        <div>
          <Lbl htmlFor="mg-quiz-evt">Event (filter, optioneel)</Lbl>
          <select id="mg-quiz-evt" value={filterEventId} disabled={disabled} onChange={(e) => setSource({ eventId: e.target.value || null })} style={QUIZ_SELECT_STYLE}>
            <option value="">Alle quizzes</option>
            {(events || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <Lbl htmlFor="mg-quiz-quiz">Quiz (afgerond)</Lbl>
          <select id="mg-quiz-quiz" value={source.quizId || ''} disabled={disabled || loading} onChange={(e) => setSource({ quizId: e.target.value || null, nameMap: {}, raw: {}, pulledAt: null })} style={QUIZ_SELECT_STYLE}>
            <option value="">{loading ? 'Quizzes laden…' : 'Kies een afgeronde quiz…'}</option>
            {quizOptions.map((q) => <option key={q.id} value={q.id}>{optionLabel(q)}</option>)}
          </select>
          {source.quizId && !selectedQuiz && !loading && (
            <div style={{ fontSize: '.75rem', color: 'var(--red)', marginTop: 4 }}>⚠ Deze quiz kan niet gevonden worden — mogelijk verwijderd.</div>
          )}
        </div>
      </div>

      {!loading && error && (
        <ErrorState
          message={isMissingTable
            ? 'De quiz-tabel bestaat nog niet in de database (migratie nog niet gedraaid). Afgeronde quizzes uit oude events staan hieronder wel gewoon.'
            : 'Kon de quizzes niet laden uit de database. Wat hieronder staat komt alleen uit oude events — probeer opnieuw voor de rest.'}
          onRetry={refetch}
        />
      )}

      {!loading && !error && allQuizzes.length === 0 && (
        <EmptyState
          icon="🧠"
          title={hiddenSecret > 0 ? 'Alleen geheime quizzes gevonden' : 'Nog geen afgeronde quiz gevonden'}
          hint={hiddenSecret > 0
            ? 'Een geheime quiz blijft hier verborgen tot je hem onthult — anders verklap je de uitslag via de mens-games.'
            : 'Rond eerst een quiz af via de Quiz-tool — los of gekoppeld aan een event — en die verschijnt dan hier.'}
        />
      )}

      {/* A secret quiz is correctly withheld, but withheld and non-existent
          look identical in a dropdown. Saying so turns a silent gap into an
          explanation -- the same failure shape that cost this project an
          evening. Deliberately vague about the count for table-only
          quizzes: `fetchQuizResults()` filters those server-side before we
          ever see them, so this number only covers the legacy half. */}
      {!loading && allQuizzes.length > 0 && hiddenSecret > 0 && (
        <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>
          🔒 {hiddenSecret === 1 ? 'Eén afgeronde quiz staat' : `${hiddenSecret} afgeronde quizzes staan`} nog op geheim en {hiddenSecret === 1 ? 'is' : 'zijn'} hier verborgen.
        </div>
      )}

      <div>
        <Btn variant="subtle" disabled={disabled || !selectedQuiz} onClick={() => onChange(pullQuizResults(round, selectedQuiz))}>⬇ Haal resultaten op</Btn>
        {source.pulledAt && <span style={{ fontSize: '.74rem', color: 'var(--muted)', marginLeft: 10 }}>Opgehaald {new Date(source.pulledAt).toLocaleString('nl-NL')}</span>}
      </div>

      {hasRaw && unmatched.length > 0 && (
        <Card style={{ borderColor: 'rgba(232,148,58,.4)', background: 'rgba(232,148,58,.06)' }}>
          <Tag color="var(--amber)">⚠ {unmatched.length} niet-gekoppelde naam{unmatched.length === 1 ? '' : 'en'}</Tag>
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {unmatched.map((u) => (
              <div key={u.name} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.85rem', minWidth: 120 }}>{u.name} <span style={{ color: 'var(--muted)' }}>({u.score} pt)</span></span>
                <select disabled={disabled} defaultValue="" onChange={(e) => { if (!e.target.value) return; setSource({ nameMap: { ...source.nameMap, [u.name]: e.target.value } }); }} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--cream)', fontSize: '.82rem', minHeight: 36 }}>
                  <option value="">Koppel aan deelnemer…</option>
                  {entrants.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </Card>
      )}

      {hasRaw && (
        <div>
          <Divider label={`${matched.length} gekoppeld`} />
          <div style={{ display: 'grid', gap: 6 }}>
            {ranking.map((r) => (
              <div key={r.entrantId} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg3)', borderRadius: 8, padding: '.4rem .7rem', fontSize: '.85rem' }}>
                <span>{entrants.find((e) => e.id === r.entrantId)?.name || '—'}</span>
                <span style={{ color: 'var(--amber2)', fontWeight: 600 }}>{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RoundEditor({ round, allEntrants, entrantsById, events, onChange, onLock, onUnlock, canManage }) {
  const [manualB, setManualB] = useState('');
  const isLocked = round.status === 'done';
  const disabled = !canManage || isLocked;
  const roundEntrants = (round.entrantIds || []).map((id) => entrantsById[id]).filter(Boolean);
  const type = getScoringType(round.scoring?.typeId);
  const isUnknownType = !Object.prototype.hasOwnProperty.call(SCORING_TYPES, round.scoring?.typeId);
  const compatibleTypes = listScoringTypes().filter((t) => t.appliesTo.includes(round.format));

  const setRound = (patch) => onChange({ ...round, ...patch });

  const changeScoringType = (typeId) => {
    const nextType = getScoringType(typeId);
    const nextConfig = defaultConfigFor(nextType);
    const resetMatches = (round.matches || []).map((m) => ({ ...m, entry: { a: nextType.blankEntry(nextConfig), b: nextType.blankEntry(nextConfig) }, winnerId: null, status: 'pending' }));
    setRound({ scoring: { typeId: nextType.id, config: nextConfig }, matches: round.format === 'matches' ? resetMatches : round.matches, status: round.status === 'done' ? 'live' : round.status });
  };

  const config = round.scoring?.config || {};

  const addMatch = () => {
    const ids = round.entrantIds || [];
    if (ids.length < 1) return;
    const bId = manualB || null;
    const aId = ids.find((id) => id !== bId) || ids[0];
    setRound({ matches: [...(round.matches || []), blankMatch(aId, bId === aId ? null : bId)] });
  };

  const updateMatch = (matchId, next) => setRound({ matches: round.matches.map((m) => (m.id === matchId ? next : m)) });
  const deleteMatch = (matchId) => setRound({ matches: round.matches.filter((m) => m.id !== matchId) });

  return (
    <Card style={{ marginTop: -4, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {isLocked && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, background: 'rgba(76,175,125,.08)', border: '1px solid rgba(76,175,125,.35)', borderRadius: 10, padding: '.7rem .9rem' }}>
            <span style={{ fontSize: '.85rem', color: 'var(--green)' }}>✓ Ronde vergrendeld — stand staat vast.</span>
            {canManage && <Btn size="sm" variant="ghost" onClick={() => { if (window.confirm('Ronde ontgrendelen? De uitslag wordt opnieuw bewerkbaar.')) onUnlock(); }}>Ontgrendelen</Btn>}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '.8rem' }}>
          <div>
            <Lbl htmlFor="mg-round-name">Naam</Lbl>
            <Inp id="mg-round-name" value={round.name} disabled={disabled} onChange={(e) => setRound({ name: e.target.value })} />
          </div>
          <div>
            <Lbl>Icoon</Lbl>
            {/* 2026-08-21g fix: presets were 40x40px, below the 44px minimum
                tap target -- the container is `flexWrap: 'wrap'` already, so
                the larger size just wraps one preset earlier rather than
                overflowing. */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ICON_PRESETS.map((ic) => (
                <button key={ic} type="button" disabled={disabled} onClick={() => setRound({ icon: ic })} aria-pressed={round.icon === ic} aria-label={`Kies icoon ${ic}`} style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: round.icon === ic ? 'rgba(232,148,58,.18)' : 'var(--bg3)', border: `1px solid ${round.icon === ic ? 'var(--amber)' : 'var(--border)'}`, fontSize: '1.1rem', cursor: disabled ? 'default' : 'pointer' }}>{ic}</button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <Lbl>Type ({FORMAT_LABEL[round.format]})</Lbl>
          <select value={round.scoring?.typeId} disabled={disabled} onChange={(e) => changeScoringType(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, width: '100%' }}>
            {compatibleTypes.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
          </select>
          {isUnknownType && <div style={{ marginTop: 6 }}><Tag color="var(--amber)">⚠ Onbekend scoretype opgeslagen — degradeert naar handmatig scoren</Tag></div>}
          {type.configFields.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <ConfigFields fields={type.configFields} value={config} disabled={disabled} idPrefix={`${round.id}-config`} onChange={(next) => setRound({ scoring: { typeId: type.id, config: next } })} />
            </div>
          )}
        </div>

        <div>
          <Lbl>Deelnemers in deze ronde</Lbl>
          <EntrantPicker mode="round" bare entrants={allEntrants} selectedIds={round.entrantIds} disabled={disabled} onChange={(ids) => setRound({ entrantIds: ids })} />
        </div>

        <Divider label="Speeltijd" />
        <CompactTimer seconds={round.timer?.seconds} disabled={disabled} onChangeSeconds={(s) => setRound({ timer: { ...round.timer, seconds: s } })} />

        <Divider label={FORMAT_LABEL[round.format]} />

        {round.format === 'matches' && (
          <div style={{ display: 'grid', gap: '.7rem' }}>
            {!disabled && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn size="sm" variant="subtle" onClick={() => setRound({ matches: generateRoundRobin(round.entrantIds) })} disabled={(round.entrantIds || []).length < 2}>🔁 Iedereen tegen iedereen</Btn>
                <Btn size="sm" variant="subtle" onClick={() => setRound({ matches: generateRandomPairs(round.entrantIds) })} disabled={(round.entrantIds || []).length < 2}>🎲 Willekeurige paren</Btn>
              </div>
            )}
            {!disabled && (round.entrantIds || []).length >= 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={manualB} onChange={(e) => setManualB(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', color: 'var(--cream)', fontSize: '.82rem', minHeight: 40 }}>
                  <option value="">Vrijstelling (bye)</option>
                  {roundEntrants.map((e) => <option key={e.id} value={e.id}>tegen {e.name}</option>)}
                </select>
                <Btn size="sm" variant="ghost" onClick={addMatch}>+ Wedstrijd toevoegen</Btn>
              </div>
            )}
            {(round.matches || []).length === 0
              ? <Tag color="var(--muted2)">Nog geen wedstrijden</Tag>
              : (round.matches || []).map((m) => (
                <MatchRow key={m.id} match={m} scoringType={type} config={config} entrantsById={entrantsById} disabled={disabled} onChange={(next) => updateMatch(m.id, next)} onDelete={disabled ? null : () => deleteMatch(m.id)} />
              ))}
          </div>
        )}

        {round.format === 'freeform' && (
          <div style={{ display: 'grid', gap: '.7rem' }}>
            {roundEntrants.length === 0
              ? <Tag color="var(--muted2)">Selecteer eerst deelnemers voor deze ronde</Tag>
              : roundEntrants.map((en) => {
                const fields = (() => { try { return type.entryFields(config) || []; } catch { return []; } })();
                const blank = (() => { try { return type.blankEntry(config) || {}; } catch { return {}; } })();
                const entry = { ...blank, ...(round.freeform?.entries?.[en.id]?.value !== undefined ? { value: round.freeform.entries[en.id].value } : {}), ...(round.freeform?.entries?.[en.id] || {}) };
                return (
                  <Card key={en.id} style={{ padding: '.8rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{en.avatar} {en.name}</span>
                    <ConfigFields fields={fields.length ? fields : [{ key: 'value', label: 'Score', type: 'stepper', min: 0, max: 999 }]} value={entry} disabled={disabled} idPrefix={`${round.id}-${en.id}`}
                      onChange={(next) => setRound({ freeform: { entries: { ...round.freeform?.entries, [en.id]: next } } })} />
                  </Card>
                );
              })}
          </div>
        )}

        {round.format === 'quiz' && (
          <QuizPanel round={round} entrants={roundEntrants} events={events} disabled={disabled} onChange={onChange} />
        )}

        {!isLocked && canManage && (
          <div>
            <Divider />
            <Btn size="lg" onClick={onLock} disabled={(round.entrantIds || []).length === 0}>🔒 Vergrendel ronde &amp; ken punten toe</Btn>
          </div>
        )}

        <Divider label="Puntenverdeling voor deze ronde" />
        <AwardEditor award={round.award} entrantCount={(round.entrantIds || []).length} disabled={disabled} onChange={(award) => setRound({ award })} />

        <div>
          <Lbl htmlFor="mg-round-notes">Notities</Lbl>
          <Inp id="mg-round-notes" multiline rows={2} value={round.notes || ''} disabled={!canManage} onChange={(e) => setRound({ notes: e.target.value })} placeholder="Bv. speciale regels voor deze ronde" />
        </div>
      </div>
    </Card>
  );
}
