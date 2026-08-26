// Quiz Dashboard -- fullscreen modal, list + editor in one place (docs/
// quiz-unification-spec.md §8.1, App.jsx 2443-2647). Pure move (§8.3, Q3) --
// body is byte-identical to the App.jsx original; only the imports below
// are new. Lazy-mounted by App.jsx (`lazy(() => import(
// "./features/quiz/QuizDashboard.jsx"))`), same pattern as
// `MensGamesTab`/`MensGamesPage` -- hence the default export.
import { useState, useEffect } from 'react';
import { normalizeQuiz } from './model.js';
import { getDisplayName } from './users.js';
import { Btn, ErrorState } from './ui/Kit.jsx';
import { QuizBuilder } from './QuizBuilder.jsx';
import { QuizPresenter } from './QuizPresenter.jsx';
import { computeMemberScores, finishQuiz } from './finishQuiz.js';
import { deleteQuiz, saveQuiz } from './api.js';

const QuizDashboard=({evt,onUpdate,onClose,users=[],teamSets=[],teamSetsError=null,onRetryTeamSets})=>{
  const quizzes=evt.quizzes||[];
  const saveQuizzes=q=>onUpdate({...evt,quizzes:q});

  const [panel,setPanel]=useState("welcome");   // "welcome" | "new" | "edit"
  const [editTarget,setEditTarget]=useState(null);
  const [presenterQuiz,setPresenterQuiz]=useState(null);
  // WP-Q6 (docs/quiz-unification-spec.md §7.2): a failed publish after a
  // quiz finished -- distinct from a rendering error, holds what's needed
  // to retry the publish half without re-running the whole finish (which
  // would be safe too, `finishQuiz`/`publishResults` are idempotent on
  // every id they write, but retrying just the publish is the smaller ask).
  const [finishError,setFinishError]=useState(null);
  const retryFinishPublish=()=>{
    if(!finishError)return;
    finishQuiz({quiz:finishError.quiz,event:evt,onUpdateEvent:onUpdate,teamSets}).then(
      result=>setFinishError(result.ok?null:{quiz:finishError.quiz})
    );
  };

  // WP-Q5 (docs/quiz-unification-spec.md §4.1/§4.3, §10.4): the builder now
  // writes BOTH `events.quizzes[]` (legacy, kept per §10.4 -- not dropped
  // until a release after the next event) AND a real `quizzes` row, via
  // `saveQuiz`'s full-row upsert. The two are kept consistent by construction
  // rather than by reconciliation: `persistQuizRow` is always called with the
  // exact same object `saveQuizzes` just wrote into the event, so there is
  // never a moment where the two disagree on anything but latency (the
  // `quizzes` write is fire-and-forget after the legacy write/panel close,
  // same "local state is truth, remote is best-effort" posture `saveQuizzes`
  // itself already has for every other quiz mutation in this file).
  // Failure here doesn't block editing (the legacy write already succeeded,
  // and the whole point of §10 is that `events.quizzes` remains a working
  // fallback) but the whole reason this write exists is to make the quiz
  // discoverable/presentable/finishable -- see the three workarounds this
  // work package's brief names -- so a failure gets a visible, retryable
  // banner rather than only a console.error buried in `saveQuiz` itself.
  const [saveError,setSaveError]=useState(null);
  const persistQuizRow=fullQuiz=>{
    saveQuiz(fullQuiz).then(res=>setSaveError(res.ok?null:{quiz:fullQuiz}));
  };
  const retrySaveQuiz=()=>{
    if(!saveError)return;
    persistQuizRow(saveError.quiz);
  };

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
        // WP-Q6 (docs/quiz-unification-spec.md §7.2): finishing a quiz used
        // to write only into `evt.quizzes[]` (the legacy column) -- a result
        // `fetchQuizResults()`/the Hall of Fame/the awards system could
        // never see. `computeMemberScores` (team quiz: distribute each
        // team's score across its members; individual: memberScores===
        // scores) is the same logic that used to live inline here, moved to
        // `finishQuiz.js` so there is exactly one copy of it.
        const pq=normalizeQuiz(presenterQuiz);
        const memberScores=computeMemberScores(pq,finalScores);
        const finishedQuiz={...pq,eventId:pq.eventId??evt.id,status:"finished",scores:finalScores,memberScores};
        (async()=>{
          // The legacy write is awaited (not fire-and-forget, unlike this
          // dashboard's other `saveQuizzes` callers) and happens BEFORE
          // `finishQuiz`'s own award publish below. Both ultimately
          // full-row-upsert this same `events` row (`onUpdate`) -- `finishQuiz`
          // re-reads it fresh immediately before writing winners
          // (`awards/publishResults.js`'s `pushWinnersToEvent`), and that
          // fresh read must see this quiz's finished status/scores, or a
          // race between the two writes could silently drop whichever
          // lands second.
          await saveQuizzes(quizzes.map(q=>q.id===presenterQuiz.id?{...q,status:"finished",scores:finalScores,memberScores,_liveState:null}:q));
          setPresenterQuiz(null);
          const result=await finishQuiz({quiz:finishedQuiz,event:evt,onUpdateEvent:onUpdate,teamSets});
          setFinishError(result.ok?null:{quiz:finishedQuiz});
        })();
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

      {finishError&&(
        <div style={{flexShrink:0,padding:".9rem 1.4rem 0"}}>
          <ErrorState message="Quiz afgerond, maar niet alles is gepubliceerd -- sommige awards staan mogelijk nog niet online. Probeer het opnieuw." onRetry={retryFinishPublish}/>
        </div>
      )}

      {saveError&&(
        <div style={{flexShrink:0,padding:".9rem 1.4rem 0"}}>
          <ErrorState message="Wijzigingen zijn lokaal opgeslagen, maar konden niet naar de quiz-tabel geschreven worden -- de quiz is mogelijk niet vindbaar voor deelnemers. Probeer het opnieuw." onRetry={retrySaveQuiz}/>
        </div>
      )}

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
                    <button onClick={()=>{
                        // A duplicate is a brand-new definition (its own id,
                        // reset scores, `rev` restarts at 1) -- written to
                        // both places for the same reason the builder's own
                        // save is, below.
                        const dup={...quiz,id:`qz${Date.now()}`,title:`Copy of ${quiz.title}`,eventId:quiz.eventId??evt.id,status:"ready",scores:{},memberScores:{},rev:1,finishedAt:null,_liveState:null};
                        saveQuizzes([...quizzes,dup]);
                        persistQuizRow(dup);
                      }}
                      title="Duplicate quiz"
                      style={{background:"rgba(91,155,213,.08)",border:"1px solid rgba(91,155,213,.2)",borderRadius:6,color:"var(--blue)",padding:"4px 9px",cursor:"pointer",fontSize:".7rem",fontFamily:"var(--font-b)",transition:"background .12s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(91,155,213,.2)"}
                      onMouseLeave={e=>e.currentTarget.style.background="rgba(91,155,213,.08)"}>
                      ⧉
                    </button>
                    <button onClick={()=>{
                        if(isActive)closePanel();
                        saveQuizzes(quizzes.filter(q=>q.id!==quiz.id));
                        // Keep the `quizzes` table from accumulating rows for
                        // quizzes no longer reachable from any event -- best
                        // effort, same posture as every other write here:
                        // the legacy delete above is what actually removes
                        // the quiz from this dashboard regardless of outcome.
                        deleteQuiz(quiz.id);
                      }}
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
                  // WP-Q5 (docs/quiz-unification-spec.md §4.1, §4.3, §10.4).
                  // `fullQuiz` is the one object written to BOTH places --
                  // `events.quizzes[]` (legacy, via `saveQuizzes`/`onUpdate`)
                  // and the real `quizzes` row (via `persistQuizRow`/
                  // `saveQuiz`, api.js's full-row upsert) -- so the two can
                  // never disagree on shape, only on which one's write has
                  // landed yet.
                  const nowIso=new Date().toISOString();
                  let fullQuiz;
                  if(panel==="new"){
                    fullQuiz={...quiz,id:`qz${Date.now()}`,eventId:evt.id,status:"ready",scores:{},memberScores:{},participants:[],settings:{secret:false,published:false},rev:1,createdBy:"",createdAt:nowIso,updatedAt:nowIso,finishedAt:null};
                    saveQuizzes([...quizzes,fullQuiz]);
                  } else {
                    // Merge onto the freshest copy of this quiz this
                    // dashboard holds (`quizzes`, not the possibly-stale
                    // `editTarget` snapshot taken when the editor opened) --
                    // preserves `scores`/`participants`/`settings`/etc. the
                    // builder never touches.
                    const prior=quizzes.find(q=>q.id===editTarget.id)||editTarget;
                    // §4.1/§4.3: bump `rev` on every definition save -- the
                    // mechanism `QuizParticipantView`'s rev-watch effect
                    // relies on so a mid-quiz typo fix reaches every phone
                    // without re-shipping the whole ~33 kB definition. A
                    // quiz that predates this work package (or a `quizzes`
                    // row that was never written at all) has no `rev` yet;
                    // treat that as rev 1 so the first save under this code
                    // bumps it to 2, same as any other edit.
                    const priorRev=Number.isFinite(prior.rev)?prior.rev:1;
                    fullQuiz={...prior,...quiz,eventId:prior.eventId??evt.id,rev:priorRev+1,updatedAt:nowIso};
                    saveQuizzes(quizzes.map(q=>q.id===editTarget.id?fullQuiz:q));
                  }
                  closePanel();
                  persistQuizRow(fullQuiz);
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
