// Beat 5 -- Legacy flash (creative spec §3 Beat 5). Only mounted when the
// App.jsx adapter supplied a `champion` (buildBeats.js's LEGACY beat, an
// extension beyond the technical spec's original enum -- see
// buildBeats.js's own docblock for why). No prior-edition data -> the beat
// simply doesn't exist; no placeholder is ever rendered here.
import { TrailerAvatar } from './BeatRoster.jsx';

export default function BeatLegacy({ data }) {
  const { name, photoUrl, avatarIndex, title, detail } = data;
  return (
    <div className="tr-content tr-content-center">
      <div className="tr-kicker" style={{ marginBottom: '1.1rem' }}>👑 Reigning champion</div>
      <TrailerAvatar name={name} photoUrl={photoUrl} avatarIndex={avatarIndex} size={104} />
      <h2 className="tr-title tr-slam" style={{ fontSize: 'clamp(1.7rem,7vw,3rem)', marginTop: '1.1rem' }}>
        {name}
      </h2>
      {title && <div className="tr-sub fu1" style={{ marginTop: '.5rem' }}>{title}</div>}
      {detail && <div className="tr-note fu2" style={{ marginTop: '.4rem', maxWidth: 460 }}>{detail}</div>}
    </div>
  );
}
