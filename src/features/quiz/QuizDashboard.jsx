// Quiz Dashboard -- fullscreen modal, list + editor in one place (docs/
// quiz-unification-spec.md §8.1, App.jsx 2443-2647). Pure move (§8.3, Q3) --
// body is byte-identical to the App.jsx original; only the imports below
// are new. Lazy-mounted by App.jsx (`lazy(() => import(
// "./features/quiz/QuizDashboard.jsx"))`), same pattern as
// `MensGamesTab`/`MensGamesPage` -- hence the default export.
import { useState, useEffect } from 'react';
import { normalizeQuiz } from './model.js';
import { getDisplayName } from './users.js';
import { Btn } from './ui/Kit.jsx';
import { QuizBuilder } from './QuizBuilder.jsx';
import { QuizPresenter } from './QuizPresenter.jsx';

const QuizDashboard=({evt,onUpdate,onClose,users=[],teamSets=[],teamSetsError=null,onRetryTeamSets})=>{
  const quizzes=evt.quizzes||[];
  const saveQuizzes=q=>onUpdate({...evt,quizzes:q});

  const [panel,setPanel]=useState("welcome");   // "welcome" | "new" | "edit"
  const [editTarget,setEditTarget]=useState(null);
  const [presenterQuiz,setPresenterQuiz]=useState(null);

  const openNew=()=>{setEditTarget(null);setPanel("new");};
  const openEdit=quiz=>{setEditTarget(normalizeQuiz(quiz));setPanel("edit");};
  const closePanel=()=>{setPanel("welcome");setEditTarget(null);};

  // Keyboard close
  useEffect(()=>{
    const h=e=>{if(e.key==="Escape"&&panel==="welcome")onClose();};
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[panel,onClose]);

  // Presenter overlays the entire dashboard
  if(presenterQuiz) return(
    <QuizPresenter quiz={presenterQuiz} evt={evt} users={users} onUpdate={onUpdate}
      onClose={()=>setPresenterQuiz(null)}
      onFinish={finalScores=>{
        // For team quizzes: distribute team scores to individual members for stats
        const pq=normalizeQuiz(presenterQuiz);
        const hasTeams=(pq.teams||[]).length>0;
        let memberScores={};
        if(hasTeams){
          pq.teams.forEach(t=>{
            const pts=finalScores[t.name]||0;
            (t.members||[]).forEach(m=>{memberScores[m]=(memberScores[m]||0)+pts;});
          });
        } else {
          memberScores=finalScores;
        }
        saveQuizzes(quizzes.map(q=>q.id===presenterQuiz.id?{...q,status:"finished",scores:finalScores,memberScores,_liveState:null}:q));
        setPresenterQuiz(null);
      }}/>
  );

  const SbBtn=({label,active=false,onClick})=>(
    <button onClick={onClick}
      style={{display:"block",width:"100%",textAlign:"left",padding:".65rem .85rem",borderRadius:"var(--radius-sm)",border:`1px solid ${active?"rgba(232,148,58,.4)":"transparent"}`,background:active?"rgba(232,148,58,.1)":"transparent",color:active?"var(--amber2)":"var(--cream)",cursor:"pointer",fontFamily:"var(--font-b)",fontSize:".83rem",fontWeight:active?600:400,marginBottom:2,transition:"all .12s"}}
      onMouseEnter={e=>{if(!active)e.currentTarget.style.background="rgba(255,255,255,.04)";}}
      onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent";}}>
      {label}
    </button>
  );

  return(
    <div style={{position:"fixed",inset:0,zIndex:998,background:"var(--bg)",display:"flex",flexDirection:"column",fontFamily:"var(--font-b)"}}>
      {/* Gold shimmer line */}
      <div style={{height:3,flexShrink:0,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange))",backgroundSize:"300% 100%",animation:"goldShimmer 3s linear infinite"}}/>

      {/* Header */}
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:".9rem 1.4rem",borderBottom:"1px solid var(--border)",background:"var(--bg2)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:"1.3rem"}}>🧠</span>
          <div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)",lineHeight:1.1}}>Quiz Dashboard</div>
            <div style={{fontSize:".7rem",color:"var(--muted)"}}>{evt.name}</div>
          </div>
        </div>
        <button onClick={onClose}
          style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--muted)",padding:"6px 14px",cursor:"pointer",fontFamily:"var(--font-b)",fontSize:".8rem",transition:"all .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.background="rgba(224,85,85,.12)";e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="rgba(224,85,85,.4)";}}
          onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="var(--muted)";e.currentTarget.style.borderColor="var(--border)";}}>
          ✕ Close
        </button>
      </div>

      {/* Body */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"270px 1fr",overflow:"hidden"}}>

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
        <div style={{borderRight:"1px solid var(--border)",background:"var(--bg2)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* New quiz CTA */}
          <div style={{padding:".85rem",borderBottom:"1px solid var(--border)",flexShrink:0}}>
            <button onClick={openNew}
              style={{width:"100%",background:panel==="new"?"rgba(232,148,58,.15)":"rgba(232,148,58,.07)",border:`1px dashed rgba(232,148,58,${panel==="new"?.6:.3})`,borderRadius:"var(--radius-sm)",color:"var(--amber)",padding:"9px 12px",cursor:"pointer",fontFamily:"var(--font-b)",fontSize:".83rem",fontWeight:700,transition:"all .15s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(232,148,58,.15)";}}
              onMouseLeave={e=>{e.currentTarget.style.background=panel==="new"?"rgba(232,148,58,.15)":"rgba(232,148,58,.07)";}}>
              + New Quiz
            </button>
          </div>

          {/* Quiz list */}
          <div style={{flex:1,overflowY:"auto",padding:".5rem"}}>
            {quizzes.length===0&&(
              <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"var(--muted2)"}}>
                <div style={{fontSize:"2rem",marginBottom:".5rem"}}>📋</div>
                <div style={{fontSize:".78rem"}}>No quizzes yet</div>
              </div>
            )}
            {quizzes.map(quiz=>{
              const nq=normalizeQuiz(quiz);
              const totalQ=nq.rounds.reduce((s,r)=>s+r.questions.length,0);
              const isActive=panel==="edit"&&editTarget?.id===quiz.id;
              const typeBreakdown=nq.rounds.flatMap(r=>r.questions).reduce((acc,q)=>{acc[q.type||"multiple"]=(acc[q.type||"multiple"]||0)+1;return acc;},{});
              return(
                <div key={quiz.id}
                  style={{borderRadius:"var(--radius-sm)",marginBottom:4,border:`1px solid ${isActive?"rgba(232,148,58,.4)":"transparent"}`,background:isActive?"rgba(232,148,58,.08)":"transparent",overflow:"hidden",transition:"all .15s"}}>
                  {/* Clickable main row */}
                  <div onClick={()=>openEdit(quiz)} style={{padding:".65rem .85rem",cursor:"pointer"}}
                    onMouseEnter={e=>{if(!isActive)e.currentTarget.parentElement.style.background="rgba(255,255,255,.03)";}}
                    onMouseLeave={e=>{if(!isActive)e.currentTarget.parentElement.style.background="transparent";}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                      <span style={{fontSize:".95rem",flexShrink:0}}>{nq.rounds[0]?.icon||"🎯"}</span>
                      <div style={{flex:1,fontWeight:600,fontSize:".82rem",color:isActive?"var(--amber2)":"var(--cream)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{quiz.title}</div>
                      <span style={{fontSize:".6rem",padding:"1px 6px",borderRadius:4,flexShrink:0,background:quiz.status==="finished"?"rgba(76,175,125,.15)":"rgba(255,255,255,.06)",color:quiz.status==="finished"?"var(--green)":"var(--muted2)",fontWeight:600}}>
                        {quiz.status==="finished"?"✓ Done":"Ready"}
                      </span>
                    </div>
                    <div style={{fontSize:".68rem",color:"var(--muted2)",display:"flex",gap:8}}>
                      <span>{nq.rounds.length} round{nq.rounds.length!==1?"s":""}</span>
                      <span>{totalQ}q</span>
                      {typeBreakdown.music&&<span style={{color:"var(--purple)"}}>🎵 {typeBreakdown.music}</span>}
                      {typeBreakdown.open&&<span style={{color:"var(--green)"}}>💬 {typeBreakdown.open}</span>}
                    </div>
                  </div>
                  {/* Action bar */}
                  <div style={{display:"flex",gap:4,padding:"0 .65rem .55rem"}} onClick={e=>e.stopPropagation()}>
                    {quiz.status!=="finished"&&(
                      <button onClick={()=>setPresenterQuiz(normalizeQuiz(quiz))}
                        style={{flex:1,background:"rgba(232,148,58,.12)",border:"1px solid rgba(232,148,58,.3)",borderRadius:6,color:"var(--amber)",padding:"4px 8px",cursor:"pointer",fontSize:".7rem",fontFamily:"var(--font-b)",fontWeight:700,transition:"background .12s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(232,148,58,.25)"}
                        onMouseLeave={e=>e.currentTarget.style.background="rgba(232,148,58,.12)"}>
                        🎤 Present
                      </button>
                    )}
                    <button onClick={()=>{const dup={...quiz,id:`qz${Date.now()}`,title:`Copy of ${quiz.title}`,status:"ready",scores:{},_liveState:null};saveQuizzes([...quizzes,dup]);}}
                      title="Duplicate quiz"
                      style={{background:"rgba(91,155,213,.08)",border:"1px solid rgba(91,155,213,.2)",borderRadius:6,color:"var(--blue)",padding:"4px 9px",cursor:"pointer",fontSize:".7rem",fontFamily:"var(--font-b)",transition:"background .12s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(91,155,213,.2)"}
                      onMouseLeave={e=>e.currentTarget.style.background="rgba(91,155,213,.08)"}>
                      ⧉
                    </button>
                    <button onClick={()=>{if(isActive)closePanel();saveQuizzes(quizzes.filter(q=>q.id!==quiz.id));}}
                      style={{background:"rgba(224,85,85,.08)",border:"1px solid rgba(224,85,85,.2)",borderRadius:6,color:"var(--red)",padding:"4px 9px",cursor:"pointer",fontSize:".7rem",fontFamily:"var(--font-b)",transition:"background .12s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(224,85,85,.2)"}
                      onMouseLeave={e=>e.currentTarget.style.background="rgba(224,85,85,.08)"}>
                      ✕
                    </button>
                  </div>
                  {/* Finished scores mini-board */}
                  {quiz.status==="finished"&&quiz.scores&&(
                    <div style={{padding:"0 .65rem .65rem",display:"flex",gap:4,flexWrap:"wrap"}}>
                      {Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,score],i)=>(
                        <div key={name} style={{display:"flex",alignItems:"center",gap:4,background:"var(--bg3)",borderRadius:6,padding:"3px 7px"}}>
                          <span style={{fontSize:".62rem"}}>{["🥇","🥈","🥉"][i]}</span>
                          <span style={{fontSize:".7rem",fontWeight:600,color:"var(--cream)"}}>{getDisplayName(name,users)}</span>
                          <span style={{fontSize:".68rem",color:"var(--amber)"}}>{score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sidebar footer stats */}
          {quizzes.length>0&&(
            <div style={{flexShrink:0,padding:".6rem 1rem",borderTop:"1px solid var(--border)",fontSize:".68rem",color:"var(--muted2)",display:"flex",gap:"1.2rem"}}>
              <span>{quizzes.length} quiz{quizzes.length!==1?"zes":""}</span>
              <span>{quizzes.reduce((s,q)=>s+normalizeQuiz(q).rounds.reduce((rs,r)=>rs+r.questions.length,0),0)} total questions</span>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────────────── */}
        <div style={{overflowY:"auto",background:"var(--bg)"}}>
          {panel==="welcome"&&(
            <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:"2rem",color:"var(--muted)"}}>
              <div style={{fontSize:"3.5rem",marginBottom:"1.2rem",filter:"drop-shadow(0 0 30px rgba(232,148,58,.2))"}}>🎯</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.4rem",color:"var(--amber2)",marginBottom:".5rem"}}>Select a quiz to edit</div>
              <div style={{fontSize:".85rem",marginBottom:"2rem"}}>Or create a new one from the sidebar</div>
              <Btn onClick={openNew} variant="gold">+ New Quiz</Btn>
            </div>
          )}

          {(panel==="new"||panel==="edit")&&(
            <div style={{padding:"1.5rem",maxWidth:820,margin:"0 auto"}}>
              <QuizBuilder
                existing={panel==="edit"?editTarget:null}
                attendees={evt.attendees||[]}
                team_sets={teamSets.filter(ts=>ts.status==="active")}
                teamSetsError={teamSetsError}
                onRetryTeamSets={onRetryTeamSets}
                onSave={quiz=>{
                  if(panel==="new"){
                    saveQuizzes([...quizzes,{...quiz,id:`qz${Date.now()}`,status:"ready",scores:{}}]);
                  } else {
                    saveQuizzes(quizzes.map(q=>q.id===editTarget.id?{...q,...quiz}:q));
                  }
                  closePanel();
                }}
                onCancel={closePanel}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizDashboard;
