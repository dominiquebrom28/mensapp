// One round's collapsed summary row inside a tournament's round list
// (docs/mensgames-spec.md §3.2 `Round`). Expands into `RoundEditor`
// (rendered by the parent, `TournamentEditor`, right below this when
// `expanded`) -- kept as a separate file so the always-visible row (name,
// status, reorder, delete) doesn't drag in every match/quiz/timer control
// just to show a collapsed list.
import { Btn, Tag } from './ui/Kit.jsx';
import { getScoringType, SCORING_TYPES } from './scoring/index.js';

const STATUS_COLOR = { pending: 'var(--muted2)', live: 'var(--red)', done: 'var(--green)' };
const STATUS_LABEL = { pending: 'Nog niet gestart', live: 'Bezig', done: 'Vergrendeld' };

export default function RoundCard({ round, index, roundCount, expanded, onToggle, onMoveUp, onMoveDown, onDelete, disabled = false }) {
  const type = getScoringType(round?.scoring?.typeId);
  const isUnknownType = !Object.prototype.hasOwnProperty.call(SCORING_TYPES, round?.scoring?.typeId);
  const pointsAwarded = round.results ? Object.values(round.results.points || {}).reduce((s, v) => s + v, 0) : null;

  return (
    <div className="mg-card-hover" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '.85rem 1rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 220px', minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cream)', fontFamily: 'var(--font-b)', textAlign: 'left', minHeight: 44, padding: 0 }}
        >
          <span aria-hidden="true" style={{ fontSize: '1.3rem' }}>{round.icon}</span>
          <span style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '.94rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{round.name}</div>
            <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{type.icon} {type.label} · {(round.entrantIds || []).length} deelnemers</div>
          </span>
          <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--muted)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isUnknownType && <Tag color="var(--amber)">⚠ Onbekend scoretype</Tag>}
          <Tag color={STATUS_COLOR[round.status] || 'var(--muted2)'}>{STATUS_LABEL[round.status] || round.status}</Tag>
          {pointsAwarded !== null && <Tag color="var(--gold, var(--amber))">{pointsAwarded} pt verdeeld</Tag>}
        </div>
        {!disabled && (
          // 2026-08-21g fix: these were 32x32px, below the 44px minimum tap
          // target this spec explicitly calls for ("one-handed, in a bar,
          // several beers in"). The row above already wraps
          // (`flexWrap: 'wrap'`), so bumping these to 44px just costs a
          // little more vertical space on the narrowest screens rather than
          // causing any overflow.
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button type="button" onClick={onMoveUp} disabled={index === 0} aria-label={`Verplaats "${round.name}" omhoog`} style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--cream)', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? .4 : 1 }}>↑</button>
            <button type="button" onClick={onMoveDown} disabled={index === roundCount - 1} aria-label={`Verplaats "${round.name}" omlaag`} style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--cream)', cursor: index === roundCount - 1 ? 'not-allowed' : 'pointer', opacity: index === roundCount - 1 ? .4 : 1 }}>↓</button>
            <Btn size="sm" variant="danger" onClick={() => { if (window.confirm(`Ronde "${round.name}" verwijderen? Dit kan niet ongedaan gemaakt worden.`)) onDelete(); }}>Verwijder</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
