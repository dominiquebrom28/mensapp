// Live quiz view for everyone who isn't presenting (docs/
// quiz-unification-spec.md §8.1, App.jsx 4215-4679). Pure move (§8.3, Q3) --
// body is byte-identical to the App.jsx original; only the imports below
// are new. `can` (App.jsx's un-exported permissions helper, docs/
// mensgames-spec.md §5.4) can't be imported, so it's threaded in as a prop
// from `EventPage` instead -- the one signature-line change this move
// requires; the `can.hostQuiz(currentUser)` call site inside stays
// untouched. Still polls/writes `evt.quizzes` directly -- WP-Q4 rewires
// this onto `quiz_live`/`quiz_answers`, out of scope here.
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabase.js';
import { normalizeQuiz, TEAM_AVATARS } from './model.js';
import { getYouTubeId } from './urls.js';
import { getDisplayName } from './users.js';

const ALPHA_P=["A","B","C","D","E","F"];
const QuizParticipantView=({evt,liveQ,currentUser,onUpdate,users=[],can})=>{
  const ls=liveQ._liveState||{};
  const quiz=normalizeQuiz(liveQ);
  const currentRound=quiz.rounds[ls.roundIdx]||quiz.rounds[0];
  const currentQ=currentRound?.questions[ls.qIdx];
  const [myAnswer,setMyAnswer]=useState([]); // always an array
  const [submitted,setSubmitted]=useState(false);
  const [showAvatarPicker,setShowAvatarPicker]=useState(false);
  const [localTimer,setLocalTimer]=useState(null);
  const localTimerRef=useRef(null);
  const evtRef=useRef(evt);
  evtRef.current=evt;

  // Determine if this user is in a team (use live teams which may have updated avatars)
  const myTeam=(ls.teams||[]).find(t=>(t.members||[]).some(m=>m.toLowerCase()===currentUser.username.toLowerCase()));
  const answerKey=ls.isTeamQuiz?(myTeam?.name||null):currentUser.username;
  // Captain gate: if a team has a captain set, only that person can submit answers
  const isCaptain=!ls.isTeamQuiz||!myTeam?.captain||myTeam.captain.toLowerCase()===currentUser.username.toLowerCase();
  const canAnswer=!!answerKey&&isCaptain;

  // Reset submission state when question changes
  useEffect(()=>{
    setMyAnswer([]);
    setSubmitted(false);
    setShowAvatarPicker(false);
  },[ls.qIdx,ls.roundIdx,ls.phase]);

  // Reflect existing answer (e.g. team member already answered)
  useEffect(()=>{
    const existing=(ls.answers||{})[answerKey];
    if(existing!=null){setMyAnswer(Array.isArray(existing)?existing:[existing]);setSubmitted(true);}
  },[ls.answers,answerKey]);

  // Fast-poll for fresh liveState every 2s
  useEffect(()=>{
    const evtId=evtRef.current.id;
    const poll=setInterval(async()=>{
      const {data}=await supabase.from("events").select("*").eq("id",evtId).single();
      if(data)onUpdate(data);
    },2000);
    return()=>clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[evt.id]);

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

  const writeAnswer=async(newAns)=>{
    const {data:fresh}=await supabase.from("events").select("*").eq("id",evtRef.current.id).single();
    if(!fresh)return;
    const freshLiveQ=(fresh.quizzes||[]).find(q=>q.id===liveQ.id);
    if(!freshLiveQ?._liveState)return;
    const updatedQuizzes=(fresh.quizzes||[]).map(q=>q.id===liveQ.id
      ?{...q,_liveState:{...q._liveState,answers:{...(q._liveState.answers||{}),[answerKey]:newAns}}}
      :q
    );
    const updated={...fresh,quizzes:updatedQuizzes};
    await supabase.from("events").upsert([updated]);
    onUpdate(updated);
  };

  const toggleAnswer=async(optIdx)=>{
    if(!canAnswer||ls.slidePhase==="answer")return;
    const correctSet=Array.isArray(currentQ?.answer)?currentQ.answer:[currentQ?.answer??0];
    const isMulti=correctSet.length>1;
    const newAns=isMulti
      ?(myAnswer.includes(optIdx)?myAnswer.filter(x=>x!==optIdx):[...myAnswer,optIdx])
      :[optIdx];
    setMyAnswer(newAns);
    setSubmitted(newAns.length>0);
    await writeAnswer(newAns);
  };

  const changeTeamAvatar=async(emoji)=>{
    setShowAvatarPicker(false);
    const {data:fresh}=await supabase.from("events").select("*").eq("id",evtRef.current.id).single();
    if(!fresh)return;
    const updatedQuizzes=(fresh.quizzes||[]).map(q=>q.id===liveQ.id?{
      ...q,_liveState:{...q._liveState,
        teams:(q._liveState?.teams||[]).map(t=>t.name===myTeam?.name?{...t,avatar:emoji}:t)
      }}:q);
    const updated={...fresh,quizzes:updatedQuizzes};
    await supabase.from("events").upsert([updated]);
    onUpdate(updated);
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
                <div onClick={()=>setShowAvatarPicker(p=>!p)} title="Change team avatar"
                  style={{fontSize:"1.4rem",cursor:"pointer",lineHeight:1,padding:"2px 4px",borderRadius:6,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.05)",userSelect:"none"}}>
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
            {can.hostQuiz(currentUser)&&(
              <button onClick={async()=>{
                const {data:fresh}=await supabase.from("events").select("*").eq("id",evtRef.current.id).single();
                if(!fresh)return;
                const cleaned=(fresh.quizzes||[]).map(q=>q.id===liveQ.id?{...q,_liveState:null}:q);
                const updated={...fresh,quizzes:cleaned};
                await supabase.from("events").upsert([updated]);
                onUpdate(updated);
              }} style={{background:"rgba(224,85,85,.15)",border:"1px solid rgba(224,85,85,.35)",borderRadius:7,color:"rgba(224,85,85,.9)",padding:"4px 10px",cursor:"pointer",fontSize:".65rem",fontFamily:"var(--font-b)",fontWeight:700,letterSpacing:".04em",whiteSpace:"nowrap"}}>
                ✕ End Session
              </button>
            )}
          </div>
        </div>
        {/* Avatar picker dropdown */}
        {showAvatarPicker&&myTeam&&(
          <div style={{padding:".4rem .8rem .6rem",borderTop:"1px solid rgba(255,255,255,.07)"}}>
            <div style={{fontSize:".6rem",color:"rgba(255,255,255,.3)",marginBottom:5,letterSpacing:".06em",textTransform:"uppercase"}}>Choose team avatar</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {TEAM_AVATARS.map(e=>(
                <div key={e} onClick={()=>changeTeamAvatar(e)}
                  style={{fontSize:"1.3rem",cursor:"pointer",padding:"4px 5px",borderRadius:6,border:myTeam.avatar===e?"2px solid var(--amber)":"1px solid transparent",background:myTeam.avatar===e?"rgba(232,148,58,.12)":"transparent",userSelect:"none"}}>
                  {e}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{paddingTop:"4rem",paddingBottom:"2rem",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>

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
                const team=ls.isTeamQuiz?(ls.teams||[]).find(t=>t.name===name):null;
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
                const team=ls.isTeamQuiz?(ls.teams||[]).find(t=>t.name===name):null;
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
              const isMyCorrect=correctSet.length>0&&correctSet.every(c=>myAnswer.includes(c))&&myAnswer.length===correctSet.length;
              return(
                <div style={{display:"grid",gap:".7rem"}}>
                  {currentQ.options.map((opt,i)=>{
                    const isCorrect=correctSet.includes(i);
                    const iMine=myAnswer.includes(i);
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
      </div>
    </div>
  );
};
export default QuizParticipantView;
