// One match, live-scored (docs/mensgames-spec.md §3.2 `Match`, §11 risk 7).
// `manual` scoring gets its own three-big-buttons UI (there's nothing to
// step through -- the admin just picks a winner); every other plugin drives
// its two `entry.a`/`entry.b` objects through `ConfigFields`, so a new sport
// added to the registry gets a working MatchRow for free.
import { Btn, Card, Tag } from './ui/Kit.jsx';
import ConfigFields from './ConfigFields.jsx';
import { ALLOW_DRAWS } from './constants.js';

function EntrantLabel({ entrant, won }) {
  if (!entrant) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: won ? 700 : 500, color: won ? 'var(--green)' : 'var(--cream)' }}>
      <span aria-hidden="true">{entrant.avatar || '🎯'}</span>
      {entrant.name}
      {won && <span aria-hidden="true">✓</span>}
    </span>
  );
}

export default function MatchRow({ match, scoringType, config, entrantsById, onChange, onDelete, disabled = false }) {
  const a = entrantsById[match.aId];
  const b = match.bId ? entrantsById[match.bId] : null;
  const isBye = match.bId == null;
  let resolved = { winnerId: null, complete: false, label: '–' };
  try { resolved = scoringType.resolve(match, config) || resolved; } catch { /* defensive -- see standings.rankRound */ }

  const setEntry = (side, next) => {
    const entry = { ...match.entry, [side]: next };
    const draft = { ...match, entry };
    let r = resolved;
    try { r = scoringType.resolve(draft, config) || resolved; } catch { /* defensive */ }
    onChange({ ...draft, status: r.complete ? 'done' : 'pending', winnerId: r.complete ? r.winnerId : null });
  };

  const setWinner = (winnerId) => {
    const draft = { ...match, winnerId };
    let r = resolved;
    try { r = scoringType.resolve(draft, config) || resolved; } catch { /* defensive */ }
    onChange({ ...draft, status: r.complete ? 'done' : 'pending' });
  };

  const allowDraw = ALLOW_DRAWS[scoringType.id] ?? true;
  const fields = (() => { try { return scoringType.entryFields(config) || []; } catch { return []; } })();
  const blank = (() => { try { return scoringType.blankEntry(config) || {}; } catch { return {}; } })();

  return (
    <Card style={{ padding: '1rem', display: 'grid', gap: '.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.92rem' }}>
          <EntrantLabel entrant={a} won={resolved.winnerId === match.aId} />
          <span style={{ color: 'var(--muted)' }}>vs</span>
          {isBye ? <Tag color="var(--muted2)">vrijstelling</Tag> : <EntrantLabel entrant={b} won={resolved.winnerId === match.bId} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {resolved.winnerId === 'draw' && <Tag color="var(--blue)">gelijkspel</Tag>}
          <Tag color={resolved.complete ? 'var(--green)' : 'var(--muted2)'}>{resolved.label}</Tag>
          {!disabled && onDelete && (
            <button type="button" onClick={() => { if (window.confirm('Deze wedstrijd verwijderen?')) onDelete(); }} aria-label="Verwijder wedstrijd" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', minWidth: 32, minHeight: 32, fontSize: '.9rem' }}>✕</button>
          )}
        </div>
      </div>

      {isBye ? null : scoringType.id === 'manual' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn size="lg" variant={resolved.winnerId === match.aId ? 'success' : 'subtle'} onClick={() => setWinner(match.aId)} disabled={disabled} style={{ flex: '1 1 120px' }}>{a?.name || 'A'} wint</Btn>
          {allowDraw && <Btn size="lg" variant={resolved.winnerId === 'draw' ? 'success' : 'subtle'} onClick={() => setWinner('draw')} disabled={disabled} style={{ flex: '1 1 100px' }}>Gelijk</Btn>}
          <Btn size="lg" variant={resolved.winnerId === match.bId ? 'success' : 'subtle'} onClick={() => setWinner(match.bId)} disabled={disabled} style={{ flex: '1 1 120px' }}>{b?.name || 'B'} wint</Btn>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 6 }}>{a?.name || 'A'}</div>
            <ConfigFields fields={fields} value={{ ...blank, ...match.entry?.a }} onChange={(v) => setEntry('a', v)} disabled={disabled} idPrefix={`${match.id}-a`} />
          </div>
          <div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 6 }}>{b?.name || 'B'}</div>
            <ConfigFields fields={fields} value={{ ...blank, ...match.entry?.b }} onChange={(v) => setEntry('b', v)} disabled={disabled} idPrefix={`${match.id}-b`} />
          </div>
        </div>
      )}
    </Card>
  );
}
