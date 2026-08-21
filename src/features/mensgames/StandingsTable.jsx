// The rolled-up tournament standings (docs/mensgames-spec.md §3.2, §4.3).
// `computeStandings` already does every bit of ranking/tie-break math --
// this just renders its output, big enough to read at a glance and honest
// about partial participation (an entrant who's only played one round of
// three still shows up, with a "1/3 rondes" hint, not silently dropped).
import { computeStandings } from './standings.js';
import { Card, EmptyState, H, Tag } from './ui/Kit.jsx';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function StandingsTable({ tournament, entrantsById, roundsCount, compact = false }) {
  const includeUnlocked = tournament?.settings?.showLivePreview !== false;
  const rows = computeStandings(tournament, { includeUnlocked });

  if (rows.length === 0) {
    return <EmptyState icon="🏆" title="Nog geen stand" hint="Voeg deelnemers en rondes toe, en vergrendel een ronde om de stand te vullen." />;
  }

  return (
    <Card>
      {!compact && <H size="1.05rem">🏆 Stand</H>}
      <div role="table" aria-label="Toernooistand" style={{ display: 'grid', gap: 6 }}>
        <div role="row" style={{ display: 'grid', gridTemplateColumns: '2.2rem 1fr auto', gap: 10, fontSize: '.68rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', padding: '0 .3rem' }}>
          <span role="columnheader">#</span>
          <span role="columnheader">Deelnemer</span>
          <span role="columnheader">Punten</span>
        </div>
        {rows.map((row) => {
          const entrant = entrantsById?.[row.entrantId];
          return (
            <div key={row.entrantId} role="row" style={{ display: 'grid', gridTemplateColumns: '2.2rem 1fr auto', gap: 10, alignItems: 'center', background: 'var(--bg3)', borderRadius: 10, padding: '.6rem .7rem' }}>
              <span role="cell" className={compact ? 'mg-scoreboard-rank' : undefined} style={compact ? undefined : { fontFamily: 'var(--font-h)', color: 'var(--amber)', fontSize: '1.1rem' }}>
                {MEDALS[row.rank] || row.rank}
              </span>
              <span role="cell" style={{ minWidth: 0 }}>
                <div className={compact ? 'mg-scoreboard-name' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                  <span aria-hidden="true">{entrant?.avatar || '🎯'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: compact ? undefined : 600 }}>{entrant?.name || 'Onbekende deelnemer'}</span>
                </div>
                {!compact && (
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 2 }}>
                    {row.roundsPlayed}{roundsCount ? `/${roundsCount}` : ''} ronde{row.roundsPlayed === 1 ? '' : 's'} gespeeld
                    {row.roundWins > 0 ? ` · ${row.roundWins} rondewinst${row.roundWins === 1 ? '' : 'en'}` : ''}
                  </div>
                )}
              </span>
              <span role="cell" className={compact ? 'mg-scoreboard-pts' : undefined} style={compact ? undefined : { fontFamily: 'var(--font-h)', fontSize: '1.15rem', color: 'var(--amber2)' }}>
                {row.points}
              </span>
            </div>
          );
        })}
      </div>
      {!includeUnlocked && !compact && (
        <div style={{ marginTop: 10 }}><Tag color="var(--muted2)">Alleen vergrendelde rondes tellen mee</Tag></div>
      )}
    </Card>
  );
}
