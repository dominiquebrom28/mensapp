// Music-round audio player, shown by `QuizPresenter` (docs/
// quiz-unification-spec.md §8.1, App.jsx 3265-3337). Pure move (§8.3, Q3) --
// body is byte-identical; only the imports below are new.
import { getYouTubeId, getSpotifyTrackId } from './urls.js';

export const MusicPlayer=({q,onPlayStart,onPlayEnd,musicPhase,musicTimer})=>{
  const ytId=getYouTubeId(q.songUrl);
  const spId=getSpotifyTrackId(q.songUrl);
  const totalSecs=q.songPlaySeconds||30;
  const startSecs=q.songStartSeconds||0;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"1.6rem"}}>
      {/* YouTube audio-only: mount hidden so audio keeps playing, video never shown */}
      {ytId&&musicPhase==="playing"&&(
        <div style={{position:"fixed",left:"-9999px",top:0,width:1,height:1,overflow:"hidden",pointerEvents:"none"}} aria-hidden>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&controls=0&modestbranding=1&rel=0${startSecs>0?`&start=${startSecs}`:""}`}
            allow="autoplay; encrypted-media"
            style={{width:320,height:180,border:"none"}}
            title="audio"/>
        </div>
      )}

      {/* Spotify — already audio-only embed */}
      {spId&&musicPhase!=="ready"&&(
        <iframe
          src={`https://open.spotify.com/embed/track/${spId}?utm_source=generator&theme=0`}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          style={{width:300,height:80,borderRadius:12,border:"none"}}
          title="spotify"/>
      )}

      {/* Big music timer ring */}
      {musicPhase==="playing"&&(
        <div style={{position:"relative",width:140,height:140}}>
          <svg width="140" height="140" style={{transform:"rotate(-90deg)"}}>
            <circle cx="70" cy="70" r="62" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="6"/>
            <circle cx="70" cy="70" r="62" fill="none" stroke={musicTimer/totalSecs>0.33?"var(--amber)":"var(--red)"} strokeWidth="6"
              strokeDasharray="390" strokeDashoffset={390*(1-musicTimer/totalSecs)}
              style={{transition:"stroke-dashoffset 1s linear,stroke .5s"}}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}>
            <div style={{fontFamily:"var(--font-h)",fontSize:"3rem",color:musicTimer/totalSecs>0.33?"var(--amber)":"var(--red)",fontWeight:900,lineHeight:1,
              ...(musicTimer<=5?{animation:"timerPulse .6s ease-in-out infinite"}:{})}}>{musicTimer}</div>
            <div style={{fontSize:".62rem",color:"rgba(255,255,255,.3)",letterSpacing:".1em",textTransform:"uppercase"}}>sec</div>
          </div>
        </div>
      )}

      {/* Waveform bars when playing */}
      {musicPhase==="playing"&&(
        <div style={{display:"flex",gap:4,alignItems:"flex-end",height:36}}>
          {[1,1.6,1.2,1.8,1,1.4,1.2,1.7,1,1.5].map((h,i)=>(
            <div key={i} style={{width:5,borderRadius:3,background:"var(--amber)",height:`${h*12}px`,animation:`musicWave ${0.5+i*.08}s ease-in-out infinite alternate`,animationDelay:`${i*.06}s`}}/>
          ))}
        </div>
      )}

      {musicPhase==="ready"&&<div style={{fontSize:"3.5rem",filter:"drop-shadow(0 0 24px rgba(232,148,58,.45))"}}>🎵</div>}

      {/* Controls */}
      <div style={{display:"flex",gap:10}}>
        {(musicPhase==="ready"||musicPhase==="done")&&(
          <button onClick={onPlayStart} style={{background:"rgba(232,148,58,.2)",border:"1px solid var(--amber)",borderRadius:12,color:"var(--amber2)",padding:"12px 32px",fontSize:"1rem",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:700,letterSpacing:".05em",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",gap:8}}>
            {musicPhase==="done"?"↺ Replay":"▶ Play"} ({startSecs>0?`${startSecs}s – ${startSecs+totalSecs}s`:`${totalSecs}s`})
            <span style={{fontSize:".6rem",opacity:.35,fontWeight:400}}>[P]</span>
          </button>
        )}
        {musicPhase==="playing"&&(
          <button onClick={onPlayEnd} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.2)",borderRadius:12,color:"rgba(255,255,255,.6)",padding:"12px 26px",fontSize:".88rem",cursor:"pointer",fontFamily:"var(--font-b)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",gap:8}}>
            ⏹ Stop early
            <span style={{fontSize:".6rem",opacity:.35,fontWeight:400}}>[P]</span>
          </button>
        )}
      </div>
    </div>
  );
};
