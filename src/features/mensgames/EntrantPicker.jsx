// Entrant management (docs/mensgames-spec.md §4.2). Two modes, one file:
//  - `mode="tournament"` -- who's IN the tournament at all: pull a team set
//    from the library (snapshotted by copy, §4.2), optionally seed
//    individual players from the linked event's attendees, or hand-type a
//    one-off player name (needed for "table football, pool, a quiz, or
//    anything typed by hand" without requiring the library/attendees at
//    all).
//  - `mode="round"` -- which of those entrants plays THIS round (a checklist
//    over `round.entrantIds`, §4.2's "entrants who played some rounds and
//    not others").
// Both are plain list UIs, not drag/drop or a keyboard-only concern -- so
// unlike MatchRow/ConfigFields this one leans on ordinary tap targets
// rather than steppers; nothing here is live score entry.
import { useState } from 'react';
import { Btn, Card, EmptyState, Inp, Lbl, Tag } from './ui/Kit.jsx';
import { entrantsFromAttendees, entrantsFromTeamSet } from './model.js';

function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'speler';
}

function EntrantChip({ entrant, onRemove, disabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '7px 10px' }}>
      <span aria-hidden="true">{entrant.avatar || (entrant.kind === 'player' ? '🙂' : '🎯')}</span>
      <span style={{ fontSize: '.85rem', color: 'var(--cream)' }}>{entrant.name}</span>
      {entrant.kind === 'player' && <Tag color="var(--blue)">Speler</Tag>}
      {onRemove && !disabled && (
        <button type="button" onClick={() => onRemove(entrant.id)} aria-label={`Verwijder ${entrant.name} uit het toernooi`} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '.9rem', padding: 4, minWidth: 24, minHeight: 24, lineHeight: 1 }}>✕</button>
      )}
    </div>
  );
}

function TournamentEntrants({ entrants, teamSets, teamSetId, linkedEvent, onChangeEntrants, onSetTeamSetId, disabled }) {
  const [manualName, setManualName] = useState('');
  const activeSets = (Array.isArray(teamSets) ? teamSets : []).filter((s) => s.status !== 'archived');

  const addTeamSet = (setId) => {
    const set = activeSets.find((s) => s.id === setId);
    if (!set) return;
    const incoming = entrantsFromTeamSet(set);
    const existingSourceIds = new Set(entrants.filter((e) => e.sourceTeamId).map((e) => e.sourceTeamId));
    const merged = [...entrants, ...incoming.filter((e) => !existingSourceIds.has(e.sourceTeamId))];
    onChangeEntrants(merged);
    onSetTeamSetId(setId);
  };

  const addAttendees = () => {
    if (!linkedEvent) return;
    const incoming = entrantsFromAttendees(linkedEvent.attendees);
    const existingIds = new Set(entrants.map((e) => e.id));
    onChangeEntrants([...entrants, ...incoming.filter((e) => !existingIds.has(e.id))]);
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    let id = `ent_p_${slug(name)}`;
    let n = 1;
    const ids = new Set(entrants.map((e) => e.id));
    while (ids.has(id)) { n += 1; id = `ent_p_${slug(name)}_${n}`; }
    onChangeEntrants([...entrants, { id, kind: 'player', name, avatar: '🙂', memberNames: [], teamSetId: null, sourceTeamId: null }]);
    setManualName('');
  };

  const removeEntrant = (id) => onChangeEntrants(entrants.filter((e) => e.id !== id));

  return (
    <div style={{ display: 'grid', gap: '.9rem' }}>
      {!disabled && (
        <div style={{ display: 'grid', gap: '.6rem' }}>
          <div>
            <Lbl htmlFor="mg-teamset-pick">Teamset uit de bibliotheek</Lbl>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select id="mg-teamset-pick" value={teamSetId || ''} onChange={(e) => { if (e.target.value) addTeamSet(e.target.value); }} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.88rem', minHeight: 44, flex: '1 1 200px' }}>
                <option value="">Kies een teamset…</option>
                {activeSets.map((s) => <option key={s.id} value={s.id}>{s.name} ({(s.teams || []).length} teams)</option>)}
              </select>
            </div>
            {activeSets.length === 0 && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>Nog geen teamsets in de bibliotheek — maak er een via Team Creator.</div>}
          </div>
          {linkedEvent && (
            <div>
              <Btn variant="subtle" size="sm" onClick={addAttendees}>+ Aanwezigen van {linkedEvent.name} als spelers</Btn>
            </div>
          )}
          <div>
            <Lbl htmlFor="mg-manual-player">Losse speler toevoegen</Lbl>
            <div style={{ display: 'flex', gap: 8 }}>
              <Inp id="mg-manual-player" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Naam" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }} />
              <Btn variant="subtle" onClick={addManual} disabled={!manualName.trim()}>+ Toevoegen</Btn>
            </div>
          </div>
        </div>
      )}
      {entrants.length === 0
        ? <EmptyState icon="🧑‍🤝‍🧑" title="Nog geen deelnemers" hint="Kies een teamset of voeg spelers toe om te beginnen." />
        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{entrants.map((e) => <EntrantChip key={e.id} entrant={e} onRemove={disabled ? null : removeEntrant} disabled={disabled} />)}</div>}
    </div>
  );
}

function RoundEntrants({ entrants, selectedIds, onChange, disabled }) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };
  if (entrants.length === 0) return <EmptyState icon="🧑‍🤝‍🧑" title="Nog geen deelnemers in het toernooi" hint="Voeg eerst deelnemers toe bovenaan het toernooi." />;
  return (
    <div style={{ display: 'grid', gap: '.6rem' }}>
      {!disabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="sm" variant="ghost" onClick={() => onChange(entrants.map((e) => e.id))}>Alles selecteren</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onChange([])}>Niets selecteren</Btn>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8 }}>
        {entrants.map((e) => {
          const isOn = selected.has(e.id);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => !disabled && toggle(e.id)}
              disabled={disabled}
              aria-pressed={isOn}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', minHeight: 44,
                background: isOn ? 'rgba(232,148,58,.12)' : 'var(--bg3)',
                border: `1px solid ${isOn ? 'var(--amber)' : 'var(--border)'}`,
                borderRadius: 10, padding: '8px 10px', cursor: disabled ? 'default' : 'pointer', color: 'var(--cream)', fontFamily: 'var(--font-b)', fontSize: '.85rem',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: '1rem' }}>{isOn ? '✅' : (e.avatar || '🎯')}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function EntrantPicker(props) {
  const { mode = 'tournament' } = props;
  const body = mode === 'round'
    ? <RoundEntrants entrants={props.entrants || []} selectedIds={props.selectedIds} onChange={props.onChange} disabled={props.disabled} />
    : <TournamentEntrants entrants={props.entrants || []} teamSets={props.teamSets || []} teamSetId={props.teamSetId} linkedEvent={props.linkedEvent} onChangeEntrants={props.onChange} onSetTeamSetId={props.onSetTeamSetId || (() => {})} disabled={props.disabled} />;
  if (props.bare) return body;
  return <Card style={props.cardStyle}>{body}</Card>;
}
