// The "hold the phone up, or cast it" view (docs/mensgames-spec.md §11 risk
// 7: "The live scoreboard should be readable across a room"). A full-bleed
// overlay with the standings blown up to `compact` size plus whichever
// round is currently `live`, nothing else competing for attention -- no nav
// chrome, no editing controls. Read-only by construction: it takes the
// tournament, never a setter.
import { useEffect } from 'react';
import { Btn, Card, H, LiveDot, Tag } from './ui/Kit.jsx';
import StandingsTable from './StandingsTable.jsx';
import { rankRound } from './standings.js';

export default function ScoreboardPanel({ tournament, entrantsById, onClose }) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const liveRound = (tournament.rounds || []).find((r) => r.status === 'live');
  const liveRanking = liveRound ? rankRound(liveRound) : [];

  return (
    <div role="dialog" aria-modal="true" aria-label={`Scorebord — ${tournament.name}`} className="mg-scoreboard mg-fu" style={{ position: 'fixed', inset: 0, zIndex: 900, overflowY: 'auto', padding: '1.4rem 1.2rem 3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem', gap: 10 }}>
        <H size="1.6rem" style={{ marginBottom: 0 }}>🏆 {tournament.name}</H>
        <Btn variant="ghost" size="lg" onClick={onClose} ariaLabel="Sluit scorebord">✕ Sluiten</Btn>
      </div>

      {liveRound && (
        <Card style={{ marginBottom: '1.2rem', borderColor: 'var(--border2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '.8rem' }}>
            <span aria-hidden="true" style={{ fontSize: '1.4rem' }}>{liveRound.icon}</span>
            <H size="1.2rem" style={{ marginBottom: 0 }}>{liveRound.name}</H>
            <LiveDot label="Nu bezig" />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {liveRanking.map((r) => (
              <div key={r.entrantId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', borderRadius: 10, padding: '.5rem .8rem' }}>
                <span className="mg-scoreboard-name" style={{ fontSize: '1.15rem' }}>{entrantsById?.[r.entrantId]?.name || '—'}</span>
                <Tag color="var(--amber)">{r.label}</Tag>
              </div>
            ))}
          </div>
        </Card>
      )}

      <StandingsTable tournament={tournament} entrantsById={entrantsById} roundsCount={(tournament.rounds || []).length} compact />
    </div>
  );
}
