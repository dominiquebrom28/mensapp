// The "🏆 Winner" builder tab (Winner-tab brief, 2026-08-26): today the
// winner is only ever derived from `quiz.scores` (top scorer) and cannot be
// corrected -- a tie, a disqualification, an award for something other than
// the top score, or a score typed in wrong all have no fix. This tab is the
// fix: Automatisch / Kies een team / Zelf invullen, plus a preview card that
// shows exactly what will land on the event's Winners & Highlights, so the
// owner never has to save-leave-navigate to find out what he just did.
//
// `resolveQuizWinner` (`model.js`) is the only place "who won" is decided --
// this component calls it purely for its own preview, the same call
// `WinnersTab` (App.jsx) and `finishQuiz.js` make. It never reimplements any
// part of that decision itself.
//
// `winner` is `quiz.settings.winner` verbatim (`null`/absent === automatic).
// `onChange(nextWinnerOrNull)` -- passing `null` is how "Automatisch" is
// supposed to discard a stale override cleanly, never leaving a dangling
// `teamId` behind.
import { resolveQuizWinner, teamStableId } from './model.js';
import { Lbl, Inp, EmptyState } from './ui/Kit.jsx';

const MODES = [
  { id: 'auto', label: 'Automatisch' },
  { id: 'team', label: 'Kies een team' },
  { id: 'manual', label: 'Zelf invullen' },
];

function ModeRow({ id, label, checked, onSelect }) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
        padding: '8px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        border: `1px solid ${checked ? 'rgba(232,148,58,.4)' : 'var(--border)'}`,
        background: checked ? 'rgba(232,148,58,.08)' : 'transparent',
        transition: 'border-color .15s,background .15s',
      }}>
      <input
        type="radio" name="qz-winner-mode" value={id} checked={checked} onChange={onSelect}
        style={{ width: 18, height: 18, flexShrink: 0, accentColor: 'var(--amber)' }}
      />
      <span style={{ fontSize: '.88rem', color: checked ? 'var(--amber2)' : 'var(--cream)', fontWeight: checked ? 600 : 400 }}>{label}</span>
    </label>
  );
}

export const WinnerTab = ({ teams = [], scores = {}, title = '', winner = null, onChange }) => {
  const mode = winner && typeof winner.mode === 'string' ? winner.mode : 'auto';
  const teamId = winner && typeof winner.teamId === 'string' ? winner.teamId : null;
  const manualName = winner && typeof winner.name === 'string' ? winner.name : '';
  const detail = winner && typeof winner.detail === 'string' ? winner.detail : '';

  // Preview reflects the *draft* teams (this tab's own tab-strip sibling,
  // not necessarily saved yet) and the quiz's last-known `scores` -- exactly
  // what `resolveQuizWinner` would see if this were saved right now.
  const previewQuiz = { teams, scores, settings: { winner } };
  const resolved = resolveQuizWinner(previewQuiz);

  const setMode = (nextMode) => {
    if (nextMode === 'auto') { onChange(null); return; } // discard cleanly -- no stale teamId
    if (nextMode === 'team') { onChange({ mode: 'team', teamId: null, name: '', detail }); return; }
    onChange({ mode: 'manual', teamId: null, name: manualName, detail });
  };
  const pickTeam = (nextTeamId) => onChange({ mode: 'team', teamId: nextTeamId, name: '', detail });
  const setManualName = (value) => onChange({ mode: 'manual', teamId: null, name: value, detail });
  const setDetail = (value) => onChange({ mode, teamId, name: manualName, detail: value });

  const teamMissing = mode === 'team' && !!teamId && !teams.some((t) => teamStableId(t) === teamId);

  let emptyPreviewText = null;
  if (!resolved) {
    if (mode === 'auto') emptyPreviewText = 'De winnaar verschijnt zodra de quiz is afgerond.';
    else if (mode === 'team') emptyPreviewText = teamMissing
      ? 'Het gekozen team bestaat niet meer bij deze quiz — kies hierboven opnieuw.'
      : 'Kies hierboven een team om een voorbeeld te zien.';
    else emptyPreviewText = 'Vul een naam in om een voorbeeld te zien.';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem', maxWidth: 640 }}>
      <div role="radiogroup" aria-label="Hoe wordt de winnaar bepaald?" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {MODES.map((m) => (
          <ModeRow key={m.id} id={m.id} label={m.label} checked={mode === m.id} onSelect={() => setMode(m.id)} />
        ))}
      </div>

      {mode === 'auto' && (
        <div style={{ fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          De winnaar wordt automatisch bepaald op basis van de hoogste score, zodra de quiz is afgerond.
        </div>
      )}

      {mode === 'team' && (
        teams.length === 0 ? (
          <EmptyState icon="👥" title="Nog geen teams gekozen" hint="Kies eerst teams op het tabblad 👥 Teams om er hier een als winnaar te kunnen aanwijzen." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div role="radiogroup" aria-label="Kies het winnende team" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {teams.map((t) => {
                const tid = teamStableId(t);
                const checked = !!tid && tid === teamId;
                const memberCount = Array.isArray(t.members) ? t.members.length : 0;
                return (
                  <label
                    key={tid || t.name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
                      padding: '7px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      border: `1px solid ${checked ? 'rgba(232,148,58,.4)' : 'var(--border)'}`,
                      background: checked ? 'rgba(232,148,58,.08)' : 'var(--bg3)',
                    }}>
                    <input type="radio" name="qz-winner-team" checked={checked} onChange={() => pickTeam(tid)}
                      style={{ width: 18, height: 18, flexShrink: 0, accentColor: 'var(--amber)' }} />
                    <span aria-hidden="true" style={{ fontSize: '1.05rem' }}>{t.avatar || '🎯'}</span>
                    <span style={{ flex: 1, fontSize: '.85rem', fontWeight: 600, color: 'var(--cream)' }}>{t.name}</span>
                    <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{memberCount === 1 ? '1 lid' : `${memberCount} leden`}</span>
                  </label>
                );
              })}
            </div>
            <div>
              <Lbl>Extra detail (optioneel)</Lbl>
              <Inp value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Bijv. reden, tie-break vraag…" />
            </div>
          </div>
        )
      )}

      {mode === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
          <div>
            <Lbl>Naam winnaar</Lbl>
            <Inp value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Naam van de winnaar of het winnende team…" />
          </div>
          <div>
            <Lbl>Extra detail (optioneel)</Lbl>
            <Inp value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Bijv. reden, score…" />
          </div>
        </div>
      )}

      <div>
        <Lbl>Voorbeeld op Winnaars &amp; Hoogtepunten</Lbl>
        {resolved ? (
          <div style={{ background: 'var(--bg2)', border: '1px solid rgba(139,92,246,.35)', borderRadius: 'var(--radius)', padding: '1.1rem', maxWidth: 280, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,#6c63ff,#a78bfa,#6c63ff)' }} />
            <div style={{ fontSize: '1.7rem', marginBottom: '.45rem' }}>{resolved.avatar}</div>
            <div style={{ fontSize: '.7rem', color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 3 }}>🧠 {title || 'Naamloze quiz'}</div>
            <div style={{ fontFamily: 'var(--font-h)', fontSize: '1.2rem', color: '#a78bfa', marginBottom: 5 }}>{resolved.name}</div>
            {resolved.detail && <div style={{ fontSize: '.8rem', color: 'var(--cream)', opacity: .7, lineHeight: 1.5 }}>{resolved.detail}</div>}
          </div>
        ) : (
          <div style={{ fontSize: '.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>{emptyPreviewText}</div>
        )}
      </div>
    </div>
  );
};

export default WinnerTab;
