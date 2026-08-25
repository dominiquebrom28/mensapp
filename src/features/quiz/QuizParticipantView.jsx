// Live quiz view for everyone who isn't presenting (docs/
// quiz-unification-spec.md §4, §8.1 -- WP-Q4). Rewired off
// `evt.quizzes[]._liveState` onto the narrow `quiz_live` row + one-row-per-
// answer `quiz_answers` table (§3.2, §3.3): this is one half of the
// production bug fix in §2. A tap now costs one `quiz_answers` upsert
// (`answers.js`'s `upsertAnswer`, ~150 bytes, **no read first**) instead of
// a read-modify-write of the 39 kB event row. `evt`/`onUpdate` are gone
// from this component's signature entirely -- nothing in here writes to
// `events`, ever (see `src/test/quiz/liveProtocol.test.jsx`, which spies on
// every table `upsertAnswer`'s call chain touches and asserts `events`
// isn't one of them).
//
// Team-avatar picker dropped on purpose (spec §14 decision 3, default: the
// team library sets avatars now). That's not just tidying: it was the only
// other participant write besides an answer, so dropping it is what makes
// "one write, ever" (§4.1) literally true rather than true-in-the-common-
// case.
//
// `liveQ` is still the full quiz *definition* (rounds, teams, id, rev,
// title) -- the same prop shape this component took from `evt.quizzes[]`
// before this rewire, so a caller that already has the definition object in
// hand (today's App.jsx, until WP-Q8 rewires its discovery -- see that
// work package's report for exactly what's needed there) can keep passing
// it unchanged. Internally the definition is only ever a *seed*:
// `quiz_live.quiz_rev` is watched, and the definition is refetched via
// `fetchQuiz` only when it bumps (§4.3), so a mid-quiz builder typo-fix
// reaches every phone without re-shipping the 33 kB `rounds` blob on every
// slide change the way polling the whole event used to.
import { useEffect, useRef, useState } from 'react';
import { normalizeQuiz, clampAnswerValue } from './model.js';
import { getYouTubeId } from './urls.js';
import { getDisplayName } from './users.js';
import { fetchQuiz, patchQuiz } from './api.js';
import { fetchQuizLive, subscribeQuizLive, deleteQuizLive } from './live.js';
import { fetchOwnAnswer, upsertAnswer, deleteAnswersForQuiz } from './answers.js';

const ALPHA_P=["A","B","C","D","E","F"];
const QuizParticipantView=({liveQ,currentUser,users=[],can,onHide})=>{
  const quizId=liveQ.id;

  // Quiz *definition* (rounds/teams/title/rev) -- seeded from the prop,
  // refreshed only on a `rev` bump (§4.3 effect below).
  const [quizDef,setQuizDef]=useState(()=>normalizeQuiz(liveQ));
  // Re-seed when a genuinely *different* quiz is opened. Not on every
  // render: App.jsx recomputes its `liveQuiz` object on each render, and
  // re-seeding then would clobber a definition this component already
  // refreshed for itself via the rev-watch effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on `liveQ.id`, not `liveQ` itself; see the comment above.
  useEffect(()=>{setQuizDef(normalizeQuiz(liveQ));},[liveQ.id]);
  const quiz=quizDef;

  // `quiz_live` -- the hot, narrow broadcast row (§3.2, §4.2).
  const [quizLive,setQuizLive]=useState(null);
  const [liveLoaded,setLiveLoaded]=useState(false);
  const [liveError,setLiveError]=useState(null);
  const ls=quizLive||{};
  const currentRound=quiz.rounds[ls.roundIdx]||quiz.rounds[0];
  const currentQ=currentRound?.questions?.[ls.qIdx];

  const [myAnswer,setMyAnswer]=useState([]); // always an array
  const [submitted,setSubmitted]=useState(false);
  const submittedRef=useRef(false);
  submittedRef.current=submitted;
  const [localTimer,setLocalTimer]=useState(null);
  const localTimerRef=useRef(null);

  // Determine if this user is in a team, from the *definition* (§3.1
  // `quizzes.teams` is a library snapshot -- teams don't live in
  // `quiz_live`, they barely ever change mid-quiz, and putting them there
  // would just be more bytes on every broadcast for nothing).
  const myTeam=(quiz.teams||[]).find(t=>(t.members||[]).some(m=>m.toLowerCase()===currentUser.username.toLowerCase()));
  // Stable answer key (§3.3): `t:<sourceTeamId>` or `p:<username lowercased>`.
  // `sourceTeamId` is set for a library snapshot (`teamsFromTeamSet`); a
  // team built the old way (or migrated from `events.quizzes[]`, §10.2)
  // only has `id` -- both are stable across a rename, unlike the old
  // name-keyed answer.
  const answerKey=ls.isTeamQuiz
    ?(myTeam?`t:${myTeam.sourceTeamId||myTeam.id}`:null)
    :`p:${currentUser.username.toLowerCase()}`;
  // Captain gate: if a team has a captain set, only that person can submit answers
  const isCaptain=!ls.isTeamQuiz||!myTeam?.captain||myTeam.captain.toLowerCase()===currentUser.username.toLowerCase();
  const canAnswer=!!answerKey&&isCaptain;

  // ── `quiz_live`: realtime UPDATE/DELETE + 5s safety poll (§4.2) ─────────
  useEffect(()=>{
    let cancelled=false;
    const load=()=>{
      fetchQuizLive(quizId).then(res=>{
        if(cancelled)return;
        setLiveLoaded(true);
        if(res.ok){setQuizLive(res.quizLive);setLiveError(null);}
        else setLiveError(res.error);
      });
    };
    load();
    const unsubscribe=subscribeQuizLive(quizId,next=>{if(!cancelled)setQuizLive(next);});
    const poll=setInterval(load,5000);
    return()=>{cancelled=true;unsubscribe();clearInterval(poll);};
  },[quizId]);

  // ── Definition refresh, only on a `rev` bump (§4.3) ─────────────────────
  // Gated on the SEED carrying a finite `rev`, which is what tells us the
  // definition came from the `quizzes` table. Until WP-Q5/Q7 move the
  // builder, quizzes are still authored into `events.quizzes` and reach us
  // as a prop with no `rev` at all -- and for those, the `quizzes` row is
  // either missing (built after §10.2's one-time migration) or a stale
  // pre-migration snapshot. Refetching in that state is worse than not: on
  // a missing row it's a 404 on every mount, and on a stale one it would
  // silently replace the questions the presenter is actually showing with
  // the ones the quiz had weeks ago. The prop is authoritative until the
  // table is.
  const seedRev=Number.isFinite(liveQ&&liveQ.rev)?liveQ.rev:null;
  useEffect(()=>{
    if(seedRev===null)return;
    if(!quizLive||!Number.isFinite(quizLive.quizRev)||quizLive.quizRev===quiz.rev)return;
    let cancelled=false;
    fetchQuiz(quizId).then(res=>{if(!cancelled&&res.ok&&res.quiz)setQuizDef(normalizeQuiz(res.quiz));});
    return()=>{cancelled=true;};
    // `quiz.rev` intentionally excluded -- this must fire only when the
    // *live row's* rev changes, not when our own refetch above changes
    // `quiz.rev` to match it (that would be a fetch loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[quizId,quizLive?.quizRev,seedRev]);

  // ── Own-answer only: one shot + 3s while unsubmitted (§4.2) ─────────────
  // Never fetches (or could return) anyone else's answer -- `fetchOwnAnswer`
  // is scoped to exactly one `answer_key`, which structurally can't be
  // someone else's. That, plus never subscribing to `quiz_answers` at all,
  // is what closes the pre-reveal leak (§4.2): today's `_liveState.answers`
  // ships every answer to every phone before the reveal.
  useEffect(()=>{
    setMyAnswer([]);
    setSubmitted(false);
    if(!answerKey||ls.phase!=="question")return;
    let cancelled=false,timer=null;
    const ri=ls.roundIdx??0,qi=ls.qIdx??0;
    const tick=()=>{
      fetchOwnAnswer(quizId,ri,qi,answerKey).then(res=>{
        if(cancelled)return;
        if(res.ok&&res.answer){setMyAnswer(res.answer.value);setSubmitted(true);return;}
        if(submittedRef.current)return; // answered locally meanwhile -- stop polling
        timer=setTimeout(tick,3000);
      });
    };
    tick();
    return()=>{cancelled=true;clearTimeout(timer);};
  },[quizId,answerKey,ls.roundIdx,ls.qIdx,ls.phase]);

  // Escape leaves the overlay without ending the session for anyone else.
  // Mirrors PresentationMode's viewer behaviour (App.jsx `viewerDismissed`):
  // EventPage unmounts us and shows a rejoin banner instead.
  useEffect(()=>{
    if(!onHide)return;
    const onKey=e=>{if(e.key==="Escape")onHide();};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[onHide]);

  useEffect(()=>{
    clearInterval(localTimerRef.current);
    setLocalTimer(null);
    if(ls.phase!=="question"||ls.slidePhase!=="question"||!currentQ||currentQ.type==="open"||currentQ.type==="music"||!ls.timerStartedAt)return;
    const limit=ls.timerLimit||30;
    const tick=()=>setLocalTimer(Math.max(0,limit-Math.floor((Date.now()-ls.timerStartedAt)/1000)));
    tick();
    localTimerRef.current=setInterval(tick,500);
    return()=>clearInterval(localTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ls.phase,ls.slidePhase,ls.qIdx,ls.roundIdx,ls.timerStartedAt,ls.timerLimit]);

  const toggleAnswer=optIdx=>{
    if(!canAnswer||ls.slidePhase==="answer")return;
    const correctSet=Array.isArray(currentQ?.answer)?currentQ.answer:[currentQ?.answer??0];
    const isMulti=correctSet.length>1;
    const newAns=isMulti
      ?(myAnswer.includes(optIdx)?myAnswer.filter(x=>x!==optIdx):[...myAnswer,optIdx])
      :[optIdx];
    setMyAnswer(newAns);
    setSubmitted(newAns.length>0);
    // §2/§4.1's whole point: one row, one upsert, no read before it.
    upsertAnswer({quizId,roundIdx:ls.roundIdx??0,qIdx:ls.qIdx??0,answerKey,value:newAns});
  };

  const scores=ls.scores||{};
  const sortedScores=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const medal=["🥇","🥈","🥉"];

  const timedOut=localTimer===0&&ls.slidePhase==="question"&&currentQ?.type==="multiple";
  const phaseBg={background:"#070501",color:"#fff",fontFamily:"var(--font-b)"};
  const Waiting=({icon,title,sub})=>(
    <div style={{textAlign:"center",padding:"3rem 2rem"}}>
      <div style={{fontSize:"3rem",marginBottom:"1rem"}}>{icon}</div>
      <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.4rem,5vw,2.2rem)",color:"var(--amber2)",marginBottom:".6rem"}}>{title}</div>
      {sub&&<div style={{color:"rgba(255,255,255,.4)",fontSize:".9rem"}}>{sub}</div>}
    </div>
  );

  return(
    <div style={{position:"fixed",inset:0,zIndex:999,...phaseBg,overflowY:"auto"}}>
      {/* Gold top bar */}
      <div style={{position:"fixed",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange))",backgroundSize:"300% 100%",animation:"goldShimmer 3s linear infinite",zIndex:30}}/>

      {/* Header */}
      <div style={{position:"fixed",top:3,left:0,right:0,background:"rgba(7,5,1,.92)",backdropFilter:"blur(12px)",zIndex:20,borderBottom:"1px solid rgba(255,255,255,.07)"}}>
        <div style={{padding:".7rem 1.2rem",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {ls.isTeamQuiz&&myTeam?(
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontSize:"1.4rem",lineHeight:1,padding:"2px 4px",borderRadius:6,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.05)"}}>
                  {myTeam.avatar||"🎯"}
                </div>
                <div>
                  <div style={{fontFamily:"var(--font-h)",fontSize:".85rem",color:"var(--amber2)",lineHeight:1}}>{quiz.title}</div>
                  <div style={{fontSize:".65rem",color:"var(--muted)",marginTop:2}}>
                    Team <strong style={{color:"var(--amber)"}}>{myTeam.name}</strong>
                    {isCaptain&&myTeam?.captain&&<span style={{color:"var(--gold)",marginLeft:5}}>👑 Captain</span>}
                  </div>
                </div>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:"1rem"}}>🧠</span>
                <div>
                  <div style={{fontFamily:"var(--font-h)",fontSize:".85rem",color:"var(--amber2)",lineHeight:1}}>{quiz.title}</div>
                  {ls.isTeamQuiz&&<div style={{fontSize:".65rem",color:"var(--muted)",marginTop:2}}>👀 Watching</div>}
                </div>
              </div>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{fontSize:".7rem",color:"rgba(255,255,255,.3)",letterSpacing:".06em",textTransform:"uppercase"}}>
              {ls.phase==="question"&&`Q${(ls.qIdx||0)+1} · Round ${(ls.roundIdx||0)+1}`}
              {ls.phase==="round-intro"&&`Round ${(ls.roundIdx||0)+1}`}
              {ls.phase==="round-summary"&&`Round ${(ls.roundIdx||0)+1} Summary`}
              {ls.phase==="final"&&"Final Results"}
            </div>
            {onHide&&(
              <button onClick={onHide} title="Hide the quiz — you can rejoin any time"
                style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.18)",borderRadius:7,color:"var(--cream)",padding:"4px 10px",minHeight:32,cursor:"pointer",fontSize:".65rem",fontFamily:"var(--font-b)",fontWeight:700,letterSpacing:".04em",whiteSpace:"nowrap"}}>
                ✕ Hide
              </button>
            )}
            {can.hostQuiz(currentUser)&&(
              <button onClick={()=>{
                deleteQuizLive(quizId);
                deleteAnswersForQuiz(quizId);
                patchQuiz(quizId,{status:"ready"});
              }} style={{background:"rgba(224,85,85,.15)",border:"1px solid rgba(224,85,85,.35)",borderRadius:7,color:"rgba(224,85,85,.9)",padding:"4px 10px",cursor:"pointer",fontSize:".65rem",fontFamily:"var(--font-b)",fontWeight:700,letterSpacing:".04em",whiteSpace:"nowrap"}}>
                ✕ End Session
              </button>
            )}
          </div>
        </div>
        {liveError&&liveLoaded&&(
          <div style={{padding:"2px 1.2rem 5px",textAlign:"center",fontSize:".62rem",color:"rgba(255,255,255,.35)"}}>
            Verbinding wankel — laatst bekende status wordt getoond
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{paddingTop:"4rem",paddingBottom:"2rem",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>

        {/* ── Loading / ended (loading, empty states) ── */}
        {!liveLoaded&&(
          <Waiting icon="⏳" title="Quiz laden…" sub="Een moment geduld"/>
        )}
        {liveLoaded&&!quizLive&&(
          <Waiting icon="🏁" title="Geen actieve sessie" sub="De quizmaster is nog niet begonnen, of heeft de sessie beëindigd."/>
        )}

        {liveLoaded&&quizLive&&(<>

        {/* ── Intro ── */}
        {ls.phase==="intro"&&(
          <Waiting icon="🧠" title={quiz.title} sub={`${(quiz.rounds||[]).reduce((s,r)=>s+(r.questions||[]).length,0)} questions · Get ready!`}/>
        )}

        {/* ── Round intro ── */}
        {ls.phase==="round-intro"&&(()=>{
          const hasBg=!!currentRound?.bgImage;
          return(
          <>
            {hasBg&&<div style={{position:"fixed",inset:0,backgroundImage:`url(${currentRound.bgImage})`,backgroundSize:"cover",backgroundPosition:"center",zIndex:2,pointerEvents:"none"}}/>}
            {hasBg&&<div style={{position:"fixed",inset:0,background:"rgba(7,5,1,.55)",zIndex:2,pointerEvents:"none"}}/>}
            <div style={{position:"relative",zIndex:3,textAlign:"center",padding:"3rem 2rem",
              ...(hasBg?{background:"rgba(0,0,0,.5)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderRadius:20,border:"1px solid rgba(255,255,255,.1)",boxShadow:"0 8px 60px rgba(0,0,0,.6)"}:{})}}>
              <div style={{fontSize:"3rem",marginBottom:"1rem"}}>{currentRound?.icon||"🎯"}</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.4rem,5vw,2.2rem)",color:"var(--amber2)",marginBottom:".6rem",textShadow:hasBg?"0 2px 12px rgba(0,0,0,.9)":"none"}}>{currentRound?.title||"Next Round"}</div>
              <div style={{color:hasBg?"rgba(255,255,255,.75)":"rgba(255,255,255,.4)",fontSize:".9rem"}}>{currentRound?.theme||`${(currentRound?.questions||[]).length} questions`}</div>
            </div>
          </>
          );
        })()}

        {/* ── Pause ── */}
        {ls.phase==="pause"&&(
          <div style={{textAlign:"center",padding:"2rem 1.4rem",maxWidth:480,width:"100%"}}>
            {ls.pauseConfig?.image
              ?<img src={ls.pauseConfig.image} alt="" style={{maxWidth:"90%",maxHeight:200,borderRadius:12,marginBottom:"1.5rem",objectFit:"contain"}} onError={e=>{e.target.style.display="none";}}/>
              :<div style={{fontSize:"3rem",marginBottom:"1.2rem"}}>⏸</div>
            }
            <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.5rem,5vw,2.4rem)",color:"var(--amber2)",marginBottom:".6rem",lineHeight:1.1}}>{ls.pauseConfig?.title||"Break Time"}</div>
            <div style={{color:"rgba(255,255,255,.45)",fontSize:".9rem",lineHeight:1.5}}>{ls.pauseConfig?.text||"The quizmaster will resume shortly…"}</div>
            {ls.pauseConfig?.musicUrl&&getYouTubeId(ls.pauseConfig.musicUrl)&&(
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${getYouTubeId(ls.pauseConfig.musicUrl)}?autoplay=1&controls=0&loop=1&playlist=${getYouTubeId(ls.pauseConfig.musicUrl)}&modestbranding=1`}
                allow="autoplay"
                style={{position:"absolute",width:1,height:1,opacity:0,pointerEvents:"none"}}
                title="break-music"/>
            )}
          </div>
        )}

        {/* ── Round summary ── */}
        {ls.phase==="round-summary"&&(
          <div style={{width:"100%",maxWidth:580,padding:"0 1.2rem"}}>
            <div style={{textAlign:"center",marginBottom:"1.4rem"}}>
              <div style={{fontSize:"1.8rem",marginBottom:".4rem"}}>📋</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.6rem",color:"#fff"}}>Round {(ls.roundIdx||0)+1} Summary</div>
              <div style={{color:"rgba(255,255,255,.4)",fontSize:".78rem",marginTop:3}}>{currentRound?.title}</div>
            </div>
            <div style={{display:"grid",gap:".65rem"}}>
              {(currentRound?.questions||[]).map((q,qi)=>{
                const revealed=(ls.summaryRevealed||[]).includes(qi);
                const correctSet=Array.isArray(q.answer)?q.answer:[q.answer??0];
                return(
                  <div key={qi} style={{background:revealed?"rgba(76,175,125,.07)":"rgba(255,255,255,.04)",border:revealed?"1px solid rgba(76,175,125,.22)":"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"10px 14px",transition:"all .4s"}}>
                    <div style={{fontSize:".62rem",color:"var(--muted)",marginBottom:3}}>Q{qi+1}</div>
                    <div style={{color:"#fff",fontSize:".9rem",fontWeight:600,lineHeight:1.3,marginBottom:revealed?".5rem":0}}>{q.q}</div>
                    {revealed&&q.type==="multiple"&&(
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {q.options.map((opt,oi)=>correctSet.includes(oi)&&(
                          <span key={oi} style={{background:"rgba(76,175,125,.18)",border:"1px solid rgba(76,175,125,.4)",borderRadius:8,padding:"2px 9px",fontSize:".75rem",color:"var(--green)",fontWeight:700}}>✓ {opt}</span>
                        ))}
                      </div>
                    )}
                    {revealed&&q.type==="open"&&q.openAnswer&&(
                      <div style={{color:"var(--green)",fontSize:".82rem",fontWeight:600}}>✓ {q.openAnswer}</div>
                    )}
                    {revealed&&q.type==="music"&&(
                      <div style={{color:"var(--amber2)",fontSize:".82rem"}}>{q.songTitle||"?"}{q.songArtist&&` — ${q.songArtist}`}</div>
                    )}
                    {!revealed&&<div style={{color:"rgba(255,255,255,.22)",fontSize:".72rem",fontStyle:"italic",marginTop:3}}>Waiting for reveal…</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Round scores ── */}
        {ls.phase==="round-scores"&&(
          <div style={{width:"100%",maxWidth:480,padding:"0 1.2rem"}}>
            <div style={{textAlign:"center",marginBottom:"1.5rem"}}>
              <div style={{fontSize:"2rem",marginBottom:".5rem"}}>📊</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.8rem",color:"#fff"}}>After Round {(ls.roundIdx||0)+1}</div>
            </div>
            <div style={{display:"grid",gap:".5rem"}}>
              {sortedScores.map(([name,score],i)=>{
                const team=ls.isTeamQuiz?(quiz.teams||[]).find(t=>t.name===name):null;
                const teamMembers=team?.members||[];
                return(
                  <div key={name} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,.05)",border:i===0?"1px solid rgba(232,148,58,.35)":"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{minWidth:24,textAlign:"center"}}>{medal[i]||`${i+1}.`}</div>
                    {ls.isTeamQuiz&&<span style={{fontSize:"1.2rem"}}>{team?.avatar||"🎯"}</span>}
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,color:"#fff"}}>{ls.isTeamQuiz?name:getDisplayName(name,users)}</div>
                      {ls.isTeamQuiz&&teamMembers.length>0&&(
                        <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:3}}>
                          {teamMembers.map(m=><span key={m} style={{background:"rgba(255,255,255,.08)",borderRadius:20,padding:"2px 7px",fontSize:".6rem",color:"rgba(255,255,255,.5)"}}>{getDisplayName(m,users)}</span>)}
                        </div>
                      )}
                    </div>
                    <div style={{fontFamily:"var(--font-h)",color:"var(--amber2)",fontWeight:700}}>{score}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Final ── */}
        {ls.phase==="final"&&(
          <div style={{width:"100%",maxWidth:480,padding:"0 1.2rem"}}>
            <div style={{textAlign:"center",marginBottom:"1.5rem"}}>
              <div style={{fontSize:"3rem",marginBottom:".5rem",animation:"float 3.5s ease-in-out infinite"}}>🏆</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"2rem",color:"var(--amber2)"}}>Quiz Complete!</div>
            </div>
            <div style={{display:"grid",gap:".5rem"}}>
              {sortedScores.map(([name,score],i)=>{
                const team=ls.isTeamQuiz?(quiz.teams||[]).find(t=>t.name===name):null;
                const teamMembers=team?.members||[];
                return(
                  <div key={name} style={{display:"flex",alignItems:"center",gap:10,background:i===0?"rgba(232,148,58,.12)":"rgba(255,255,255,.05)",border:i===0?"1px solid rgba(232,148,58,.45)":"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:i===0?"13px 16px":"10px 14px"}}>
                    <div style={{minWidth:28,textAlign:"center",fontSize:i===0?"1.3rem":"1rem"}}>{medal[i]||`${i+1}.`}</div>
                    {ls.isTeamQuiz&&<span style={{fontSize:i===0?"1.6rem":"1.2rem"}}>{team?.avatar||"🎯"}</span>}
                    <div style={{flex:1}}>
                      <div style={{fontWeight:i===0?700:600,color:i===0?"var(--amber2)":"#fff"}}>{ls.isTeamQuiz?name:getDisplayName(name,users)}</div>
                      {ls.isTeamQuiz&&teamMembers.length>0&&(
                        <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:3}}>
                          {teamMembers.map(m=><span key={m} style={{background:"rgba(255,255,255,.08)",borderRadius:20,padding:"2px 7px",fontSize:".6rem",color:"rgba(255,255,255,.5)"}}>{getDisplayName(m,users)}</span>)}
                        </div>
                      )}
                    </div>
                    <div style={{fontFamily:"var(--font-h)",color:i===0?"var(--amber2)":"rgba(255,255,255,.65)",fontWeight:700,fontSize:i===0?"1.2rem":"1rem"}}>{score}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Question ── */}
        {ls.phase==="question"&&currentQ&&(
          <div style={{width:"100%",maxWidth:580,padding:"0 1.2rem"}}>
            {/* Question type badge */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"1.2rem",flexWrap:"wrap"}}>
              <span style={{background:"rgba(232,148,58,.18)",border:"1px solid rgba(232,148,58,.4)",borderRadius:20,padding:"3px 12px",fontSize:".68rem",color:"var(--amber)",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase"}}>
                {currentQ.type==="music"?"🎵 Music":currentQ.type==="open"?"💬 Open":"🔤 Multiple Choice"} · Q{(ls.qIdx||0)+1}
              </span>
              <span style={{marginLeft:"auto",color:"rgba(255,255,255,.3)",fontSize:".75rem"}}>{currentQ.points||100} pts</span>
            </div>

            {/* Timer ring */}
            {ls.slidePhase==="question"&&currentQ.type==="multiple"&&localTimer!==null&&!timedOut&&(
              <div style={{textAlign:"center",marginBottom:"1.4rem"}}>
                <div style={{position:"relative",width:80,height:80,margin:"0 auto"}}>
                  <svg width="80" height="80" style={{transform:"rotate(-90deg)"}}>
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="5"/>
                    <circle cx="40" cy="40" r="34" fill="none"
                      stroke={localTimer/(ls.timerLimit||30)>0.33?"var(--amber)":"var(--red)"} strokeWidth="5"
                      strokeDasharray="214" strokeDashoffset={214*(1-localTimer/(ls.timerLimit||30))}
                      style={{transition:"stroke-dashoffset .5s linear,stroke .5s"}}/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
                    ...(localTimer<=5?{animation:"timerPulse .6s ease-in-out infinite"}:{})}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"1.6rem",fontWeight:900,lineHeight:1,
                      color:localTimer/(ls.timerLimit||30)>0.33?"var(--amber)":"var(--red)"}}>{localTimer}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Question text */}
            {!timedOut&&<div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.2rem,4vw,1.9rem)",color:"#fff",lineHeight:1.25,marginBottom:"1.5rem",textShadow:"0 2px 15px rgba(0,0,0,.4)"}}>{currentQ.q}</div>}

            {/* Time's up screen */}
            {timedOut&&(
              <div style={{textAlign:"center",padding:"2.5rem 1rem"}}>
                <div style={{fontSize:"2.5rem",marginBottom:".8rem",animation:"timerPulse .6s ease-in-out infinite"}}>⏰</div>
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.4rem,5vw,2rem)",color:"var(--red)",marginBottom:".5rem",fontWeight:900}}>Time&apos;s up!</div>
                <div style={{color:"rgba(255,255,255,.4)",fontSize:".85rem"}}>Waiting for the host…</div>
              </div>
            )}

            {/* ── Answer phase: show correct answer ── */}
            {ls.slidePhase==="answer"&&currentQ.type==="multiple"&&(()=>{
              const correctSet=Array.isArray(currentQ.answer)?currentQ.answer:[currentQ.answer??0];
              const myAnswerClamped=clampAnswerValue(myAnswer,currentQ.options.length);
              const isMyCorrect=correctSet.length>0&&correctSet.every(c=>myAnswerClamped.includes(c))&&myAnswerClamped.length===correctSet.length;
              return(
                <div style={{display:"grid",gap:".7rem"}}>
                  {currentQ.options.map((opt,i)=>{
                    const isCorrect=correctSet.includes(i);
                    const iMine=myAnswerClamped.includes(i);
                    return(
                      <div key={i} style={{borderRadius:10,padding:"12px 16px",border:isCorrect?"2px solid var(--green)":iMine?"1px solid rgba(224,85,85,.5)":"1px solid rgba(255,255,255,.08)",background:isCorrect?"rgba(76,175,125,.15)":iMine?"rgba(224,85,85,.07)":"rgba(255,255,255,.04)",transition:"all .3s"}}>
                        <div style={{fontSize:".95rem",fontWeight:600,color:isCorrect?"var(--green)":iMine?"rgba(224,85,85,.8)":"rgba(255,255,255,.7)"}}>{ALPHA_P[i]}. {opt}</div>
                        {isCorrect&&<div style={{fontSize:".72rem",color:"var(--green)",marginTop:3,fontWeight:700}}>✓ Correct</div>}
                        {iMine&&!isCorrect&&<div style={{fontSize:".72rem",color:"rgba(224,85,85,.8)",marginTop:3}}>Your pick</div>}
                      </div>
                    );
                  })}
                  {isMyCorrect&&<div style={{textAlign:"center",padding:".8rem",color:"var(--green)",fontWeight:700,fontSize:"1.1rem"}}>🎉 +{currentQ.points||10} pts!</div>}
                </div>
              );
            })()}

            {/* ── Answer phase: open question ── */}
            {ls.slidePhase==="answer"&&currentQ.type==="open"&&currentQ.openAnswer&&(
              <div style={{background:"rgba(76,175,125,.12)",border:"2px solid var(--green)",borderRadius:12,padding:"1.2rem 1.6rem",textAlign:"center"}}>
                <div style={{fontSize:".7rem",color:"var(--green)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:".4rem",fontWeight:700}}>✓ Answer</div>
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.1rem,4vw,1.8rem)",color:"#fff"}}>{currentQ.openAnswer}</div>
              </div>
            )}

            {/* ── Answer phase: music ── */}
            {ls.slidePhase==="answer"&&currentQ.type==="music"&&(
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:".72rem",color:"var(--green)",letterSpacing:".14em",textTransform:"uppercase",fontWeight:700,marginBottom:".5rem"}}>🎵 The song was…</div>
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.3rem,4vw,2rem)",color:"var(--amber2)",marginBottom:".2rem"}}>{currentQ.songTitle||"?"}</div>
                {currentQ.songArtist&&<div style={{color:"rgba(255,255,255,.5)",marginBottom:"1rem"}}>{currentQ.songArtist}</div>}
              </div>
            )}

            {/* ── Question phase: multiple choice ── */}
            {ls.slidePhase==="question"&&currentQ.type==="multiple"&&!timedOut&&(()=>{
              const correctSet=Array.isArray(currentQ.answer)?currentQ.answer:[currentQ.answer??0];
              const isMulti=correctSet.length>1;
              return(
                <div>
                  {isMulti&&<div style={{color:"rgba(255,255,255,.45)",fontSize:".76rem",fontStyle:"italic",marginBottom:".7rem",textAlign:"center"}}>meerdere antwoorden zijn mogelijk</div>}
                  {!canAnswer&&(
                    <div style={{textAlign:"center",color:"rgba(255,255,255,.35)",padding:"1.5rem",fontSize:".85rem",lineHeight:1.6}}>
                      {!answerKey
                        ?"You're not assigned to a team — watching only"
                        :<span>Only 👑 <strong style={{color:"var(--amber)"}}>{myTeam?.captain}</strong> can answer for {myTeam?.name}</span>
                      }
                    </div>
                  )}
                  {canAnswer&&(
                    <div style={{display:"grid",gap:".7rem"}}>
                      {currentQ.options.map((opt,i)=>{
                        const isSel=myAnswer.includes(i);
                        return(
                          <button key={i} onClick={()=>toggleAnswer(i)}
                            style={{background:isSel?"rgba(232,148,58,.2)":"rgba(255,255,255,.06)",border:isSel?"2px solid rgba(232,148,58,.7)":"1px solid rgba(255,255,255,.12)",borderRadius:10,padding:"13px 16px",cursor:"pointer",textAlign:"left",color:isSel?"var(--amber2)":"#fff",fontSize:".95rem",fontWeight:isSel?700:500,fontFamily:"var(--font-b)",transition:"all .15s",display:"flex",alignItems:"center",gap:10}}>
                            {isMulti&&<div style={{width:18,height:18,borderRadius:4,border:`2px solid ${isSel?"var(--amber)":"rgba(255,255,255,.3)"}`,background:isSel?"rgba(232,148,58,.3)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                              {isSel&&<span style={{color:"var(--amber2)",fontSize:10,fontWeight:900}}>✓</span>}
                            </div>}
                            <span>{ALPHA_P[i]}. {opt}</span>
                          </button>
                        );
                      })}
                      {submitted&&<div style={{textAlign:"center",color:"rgba(76,175,125,.85)",fontSize:".78rem",padding:".4rem 0",fontWeight:600}}>
                        {isMulti?`${myAnswer.length} selected — tap to change`:"✓ Answer locked in — tap to change"}
                      </div>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Question phase: open ── */}
            {ls.slidePhase==="question"&&currentQ.type==="open"&&(
              <div style={{textAlign:"center",padding:"1.5rem",color:"rgba(255,255,255,.4)",fontSize:"1rem"}}>
                <div style={{fontSize:"2rem",marginBottom:".6rem"}}>✏️</div>
                Write down your answer!
              </div>
            )}

            {/* ── Question phase: music ── */}
            {ls.slidePhase==="question"&&currentQ.type==="music"&&(
              <div style={{textAlign:"center",padding:"1.5rem"}}>
                <div style={{fontSize:"2.5rem",marginBottom:".5rem"}}>🎵</div>
                <div style={{color:"rgba(255,255,255,.5)",fontSize:".9rem"}}>Listen and guess the song!</div>
                {currentQ.songTitle&&<div style={{marginTop:"1rem",color:"rgba(255,255,255,.2)",fontSize:".75rem"}}>⚠️ No peeking at the title</div>}
              </div>
            )}
          </div>
        )}

        </>)}
      </div>
    </div>
  );
};
export default QuizParticipantView;
