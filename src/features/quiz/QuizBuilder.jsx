// Quiz round/question editor (docs/quiz-unification-spec.md §8.1, App.jsx
// 2734-3258). Pure move (§8.3, Q3) -- body is byte-identical to the App.jsx
// original; only the imports below are new, replacing what used to be
// same-file `const`s. `SEL_STYLE`/`ICON_BTN`/`SONG_SECS` are quiz-builder-
// only (grep-verified, spec §8.3) and move here as local consts rather than
// into `model.js`, since nothing else needs them. `ALPHA`, `ROUND_ICONS`,
// `TYPE_META`, `blankQuestion` were already extracted to `model.js` in
// WP-Q2 -- imported from there instead of a third copy.
// WP-Q5 (docs/quiz-unification-spec.md §5.1/§5.2): the inline team-creation
// UI that used to live in the Teams tab below (hand-typed team names, its
// own avatar picker, and a second 👑-captain-toggle write site duplicating
// the Team Creator's) is deleted. Teams now come from the library
// exclusively, via `TeamSetPicker` -- see that file for the
// snapshot-not-live-reference reasoning (§5.3).
import { useState } from 'react';
import { supabase } from '../../supabase.js';
import { ALPHA, ROUND_ICONS, TYPE_META, blankQuestion } from './model.js';
import { getYouTubeId, isSpotifyUrl, isYouTubeUrl } from './urls.js';
import { Btn, Inp, Lbl } from './ui/Kit.jsx';
import { TeamSetPicker } from './TeamSetPicker.jsx';
import { WinnerTab } from './WinnerTab.jsx';

const SEL_STYLE={background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"5px 8px",color:"var(--muted)",fontSize:".75rem",fontFamily:"var(--font-b)"};
const ICON_BTN={background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:5,color:"var(--muted)",padding:"3px 8px",cursor:"pointer",fontSize:".75rem",fontFamily:"var(--font-b)",lineHeight:1.2,transition:"all .12s"};
const SONG_SECS=[3,5,7,10,15,20,25,30,45,60,90,120];

export const QuizBuilder=({onSave,onCancel,existing=null,attendees=[],team_sets=[],teamSetsError=null,onRetryTeamSets})=>{
  const [title,setTitle]=useState(existing?.title||"");
  const [defaultTime,setDefaultTime]=useState(existing?.defaultTime||30);
  const [introText,setIntroText]=useState(existing?.introText||"");
  const [introBg,setIntroBg]=useState(existing?.introBg||"");
  const [rounds,setRounds]=useState(()=>{
    if(existing?.rounds)return existing.rounds.map(r=>({icon:"🎯",description:"",...r,questions:r.questions.map(q=>({...blankQuestion(q.type||"multiple"),...q}))}));
    return[{id:`r${Date.now()}`,title:"Round 1",theme:"",icon:"🎯",description:"",bgImage:null,questions:[blankQuestion()]}];
  });
  const [teams,setTeams]=useState(existing?.teams||[]);
  const [teamSetId,setTeamSetId]=useState(existing?.teamSetId||null);
  // Winner-tab brief (2026-08-26): `quiz.settings.winner` -- the override,
  // `null`/absent meaning "Automatisch". Kept as its own bit of state rather
  // than folded into a generic `settings` object because this tab is the
  // only thing in the builder that ever writes to `settings` today; the
  // rest of `existing.settings` (`secret`/`published`, not yet builder-
  // editable) is carried through untouched via `settingsPatch` below.
  const [winner,setWinner]=useState(existing?.settings?.winner||null);
  const [activeRi,setActiveRi]=useState(0);
  const [expandedQ,setExpandedQ]=useState(0);
  const [builderTab,setBuilderTab]=useState("rounds");
  const [showDesc,setShowDesc]=useState(false);
  const [imgUploading,setImgUploading]=useState(null);

  // ── Round helpers ────────────────────────────────────────────────
  const addRound=()=>{
    const ni=rounds.length;
    setRounds(r=>[...r,{id:`r${Date.now()}`,title:`Round ${r.length+1}`,theme:"",icon:"🎯",description:"",bgImage:null,questions:[blankQuestion()]}]);
    setActiveRi(ni);setExpandedQ(0);
  };
  const delRound=ri=>{
    if(rounds.length<=1)return;
    setRounds(r=>r.filter((_,i)=>i!==ri));
    setActiveRi(p=>p>=rounds.length-1?rounds.length-2:p);
    setExpandedQ(null);
  };
  const moveRound=(ri,d)=>{
    const j=ri+d;
    if(j<0||j>=rounds.length)return;
    setRounds(r=>{const rs=[...r];[rs[ri],rs[j]]=[rs[j],rs[ri]];return rs;});
    setActiveRi(j);
  };
  const updRound=(ri,f,v)=>setRounds(r=>r.map((x,i)=>i===ri?{...x,[f]:v}:x));

  // ── Question helpers ─────────────────────────────────────────────
  const addQ=(ri,type="multiple")=>{
    const ni=rounds[ri].questions.length;
    setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:[...round.questions,blankQuestion(type)]}:round));
    setExpandedQ(ni);
  };
  const delQ=(ri,qi)=>setRounds(r=>r.map((round,i)=>i===ri&&round.questions.length>1?{...round,questions:round.questions.filter((_,j)=>j!==qi)}:round));
  const moveQ=(ri,qi,d)=>{
    const j=qi+d;
    setRounds(r=>r.map((round,i)=>{
      if(i!==ri||j<0||j>=round.questions.length)return round;
      const qs=[...round.questions];[qs[qi],qs[j]]=[qs[j],qs[qi]];
      return{...round,questions:qs};
    }));
    setExpandedQ(j);
  };
  const updQ=(ri,qi,f,v)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>j===qi?{...q,[f]:v}:q)}:round));
  const updOpt=(ri,qi,oi,v)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>j===qi?{...q,options:q.options.map((o,k)=>k===oi?v:o)}:q)}:round));
  const addOpt=(ri,qi)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>j===qi&&q.options.length<8?{...q,options:[...q.options,""]}:q)}:round));
  const delOpt=(ri,qi,oi)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>{
    if(j!==qi)return q;
    const opts=q.options.filter((_,k)=>k!==oi);
    const cur=Array.isArray(q.answer)?q.answer:[q.answer??0];
    const ans=cur.filter(a=>a!==oi).map(a=>a>oi?a-1:a).filter(a=>a<opts.length);
    return{...q,options:opts,answer:ans.length>0?ans:[0]};
  })}:round));

  const handleRoundImg=async(ri,e)=>{
    const file=e.target.files[0];if(!file)return;
    const key=`round-${ri}`;
    setImgUploading(key);
    const path=`${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const{data,error}=await supabase.storage.from("Quiz images").upload(path,file);
    if(!error){const{data:{publicUrl}}=supabase.storage.from("Quiz images").getPublicUrl(data.path);updRound(ri,"bgImage",publicUrl);}
    setImgUploading(null);
    e.target.value="";
  };

  // ── Validation ───────────────────────────────────────────────────
  const qValid=q=>{
    if(!q.q.trim())return false;
    if(q.type==="multiple")return q.options.filter(o=>o.trim()).length>=2;
    if(q.type==="music")return q.songUrl.trim().length>0;
    return true;
  };
  const valid=title.trim()&&rounds.every(r=>r.title.trim()&&r.questions.every(qValid));
  const ar=rounds[activeRi]||rounds[0];
  const ri=activeRi;

  // Carries `existing.settings` (today: `secret`/`published`, neither
  // builder-editable yet) through untouched, adding/removing only `winner`
  // -- switching back to Automatisch (`winner===null`) must not leave a
  // stale `winner` key sitting in the saved row.
  const settingsPatch=(()=>{
    const base=existing?.settings&&typeof existing.settings==="object"?{...existing.settings}:{};
    if(winner)base.winner=winner;else delete base.winner;
    return base;
  })();

  // ── Tab button helper ────────────────────────────────────────────
  const TabBtn=({id,label,badge})=>(
    <button onClick={()=>setBuilderTab(id)} style={{background:"none",border:"none",borderBottom:builderTab===id?"2px solid var(--amber)":"2px solid transparent",color:builderTab===id?"var(--amber2)":"var(--muted)",cursor:"pointer",padding:"8px 16px",fontFamily:"var(--font-b)",fontWeight:builderTab===id?600:400,fontSize:".85rem",marginBottom:-1,transition:"color .15s",display:"flex",alignItems:"center",gap:5}}>
      {label}{badge>0&&<span style={{background:"rgba(232,148,58,.2)",borderRadius:10,padding:"0 6px",fontSize:".7rem",color:"var(--amber)"}}>{badge}</span>}
    </button>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div style={{display:"flex",gap:"1rem",alignItems:"center",marginBottom:"1.1rem",flexWrap:"wrap"}}>
        <Inp value={title} onChange={e=>setTitle(e.target.value)} placeholder="Quiz title…" autoFocus
          style={{flex:1,minWidth:160,fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)",padding:"10px 14px"}}/>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          <Lbl style={{margin:0,whiteSpace:"nowrap"}}>Default time</Lbl>
          <select value={defaultTime} onChange={e=>setDefaultTime(+e.target.value)} style={{...SEL_STYLE,padding:"9px 8px",color:"var(--cream)"}}>
            {[10,15,20,30,45,60,90,120].map(t=><option key={t} value={t}>{t}s</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <Btn onClick={onCancel} variant="ghost" size="sm">Cancel</Btn>
          <Btn onClick={()=>onSave({title,defaultTime,rounds,teams,teamSetId,introText,introBg,settings:settingsPatch})} disabled={!valid} variant="gold" size="sm">
            {existing?"Save Changes":"Create Quiz"}
          </Btn>
        </div>
      </div>

      {/* ── Builder tabs ───────────────────────────────────────── */}
      <div style={{display:"flex",borderBottom:"1px solid var(--border)",marginBottom:"1.2rem"}}>
        <TabBtn id="rounds" label="📋 Rounds" badge={0}/>
        <TabBtn id="teams" label="👥 Teams" badge={teams.length}/>
        <TabBtn id="intro" label="🎬 Intro" badge={0}/>
        <TabBtn id="winner" label="🏆 Winner" badge={winner?1:0}/>
      </div>

      {/* ════════════════════════════════════════════════════════ */}
      {/* ROUNDS TAB                                              */}
      {/* ════════════════════════════════════════════════════════ */}
      {builderTab==="rounds"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>

          {/* Round tab strip */}
          <div style={{display:"flex",alignItems:"center",gap:0,overflowX:"auto",borderBottom:"1px solid var(--border)"}}>
            {rounds.map((r,rIdx)=>(
              <div key={r.id} style={{display:"flex",alignItems:"center",borderBottom:rIdx===activeRi?"2px solid var(--amber2)":"2px solid transparent",marginBottom:-1}}>
                <button onClick={()=>{setActiveRi(rIdx);setExpandedQ(null);}}
                  style={{background:"none",border:"none",color:rIdx===activeRi?"var(--amber2)":"var(--muted)",cursor:"pointer",padding:"7px 12px",fontFamily:"var(--font-b)",fontSize:".82rem",fontWeight:rIdx===activeRi?600:400,whiteSpace:"nowrap",transition:"color .12s"}}>
                  {r.icon} {r.title||`Round ${rIdx+1}`}
                </button>
                {rIdx===activeRi&&(
                  <div style={{display:"flex",alignItems:"center",gap:1,paddingRight:6}}>
                    <button onClick={e=>{e.stopPropagation();moveRound(rIdx,-1);}} disabled={rIdx===0}
                      style={{background:"none",border:"none",color:"var(--muted2)",cursor:rIdx===0?"default":"pointer",padding:"0 4px",fontSize:".65rem",lineHeight:1,opacity:rIdx===0?.25:1}}
                      title="Move left">←</button>
                    <button onClick={e=>{e.stopPropagation();moveRound(rIdx,1);}} disabled={rIdx===rounds.length-1}
                      style={{background:"none",border:"none",color:"var(--muted2)",cursor:rIdx===rounds.length-1?"default":"pointer",padding:"0 4px",fontSize:".65rem",lineHeight:1,opacity:rIdx===rounds.length-1?.25:1}}
                      title="Move right">→</button>
                    {rounds.length>1&&<button onClick={()=>delRound(rIdx)}
                      style={{background:"none",border:"none",color:"var(--muted2)",cursor:"pointer",padding:"0 4px",fontSize:".7rem",lineHeight:1}}
                      onMouseEnter={e=>e.target.style.color="var(--red)"}
                      onMouseLeave={e=>e.target.style.color="var(--muted2)"}>✕</button>}
                  </div>
                )}
              </div>
            ))}
            <button onClick={addRound}
              style={{background:"none",border:"none",color:"var(--amber)",cursor:"pointer",padding:"7px 12px",fontFamily:"var(--font-b)",fontSize:".82rem",marginBottom:-1,whiteSpace:"nowrap"}}>
              + Round
            </button>
          </div>

          {/* Active round settings */}
          <div style={{background:"rgba(232,148,58,.05)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".85rem 1rem"}}>
            <div style={{display:"flex",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
              <select value={ar.icon} onChange={e=>updRound(ri,"icon",e.target.value)} style={{...SEL_STYLE,fontSize:"1.1rem",padding:"6px 4px",cursor:"pointer"}}>
                {ROUND_ICONS.map(ic=><option key={ic} value={ic}>{ic}</option>)}
              </select>
              <Inp value={ar.title} onChange={e=>updRound(ri,"title",e.target.value)} placeholder="Round title…" style={{flex:1,minWidth:110,padding:"8px 10px",fontSize:".88rem"}}/>
              <Inp value={ar.theme} onChange={e=>updRound(ri,"theme",e.target.value)} placeholder="Theme (optional)…" style={{flex:1,minWidth:110,padding:"8px 10px",fontSize:".88rem"}}/>
              <button onClick={()=>updRound(ri,"secret",!ar.secret)}
                title={ar.secret?"Secret round — click to reveal on intro":"Visible on intro — click to hide"}
                style={{...ICON_BTN,padding:"7px 10px",whiteSpace:"nowrap",color:ar.secret?"var(--red)":"var(--muted)",background:ar.secret?"rgba(224,85,85,.08)":"transparent",border:`1px solid ${ar.secret?"rgba(224,85,85,.35)":"transparent"}`,borderRadius:6,transition:"all .15s"}}>
                {ar.secret?"🔒 Secret":"👁 Visible"}
              </button>
              <button onClick={()=>setShowDesc(v=>!v)}
                style={{...ICON_BTN,color:"var(--muted)",padding:"7px 10px",whiteSpace:"nowrap"}}>
                {showDesc?"▲":"▼"} Intro text
              </button>
            </div>
            {showDesc&&(
              <div style={{marginTop:".7rem"}}>
                <Inp value={ar.description} onChange={e=>updRound(ri,"description",e.target.value)} placeholder="Shown on screen before this round starts…" style={{fontSize:".82rem"}}/>
              </div>
            )}
            {/* Round background image */}
            <div style={{marginTop:".7rem"}}>
              {ar.bgImage?(
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <img src={ar.bgImage} alt="" style={{height:40,width:64,borderRadius:5,objectFit:"cover",flexShrink:0}} onError={e=>e.target.style.display="none"}/>
                  <span style={{flex:1,fontSize:".74rem",color:"rgba(255,255,255,.35)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ar.bgImage.split("/").pop()}</span>
                  <button onClick={()=>updRound(ri,"bgImage",null)} style={{...ICON_BTN,color:"var(--muted)",fontSize:".72rem"}}>✕ Clear BG</button>
                </div>
              ):(
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <input placeholder="🖼 Background image URL for round slide…"
                    onBlur={e=>{const v=e.target.value.trim();if(v){updRound(ri,"bgImage",v);e.target.value="";}}}
                    onKeyDown={e=>{if(e.key==="Enter"){const v=e.target.value.trim();if(v){updRound(ri,"bgImage",v);e.target.value="";}}} }
                    style={{flex:1,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"6px 9px",color:"var(--cream)",fontSize:".78rem",outline:"none",fontFamily:"var(--font-b)"}}/>
                  <label style={{...ICON_BTN,cursor:"pointer",color:"var(--muted)",whiteSpace:"nowrap"}}>
                    {imgUploading===`round-${ri}`?"⏳":"⬆"}
                    <input type="file" accept="image/*,image/gif" style={{display:"none"}} onChange={e=>handleRoundImg(ri,e)}/>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Questions accordion */}
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {ar.questions.map((q,qi)=>{
              const meta=TYPE_META[q.type]||TYPE_META.multiple;
              const isOpen=expandedQ===qi;
              return(
                <div key={qi} style={{border:`1px solid ${isOpen?meta.border:"var(--border)"}`,borderRadius:"var(--radius-sm)",overflow:"hidden",transition:"border-color .2s"}}>

                  {/* Card header (always visible) */}
                  <div onClick={()=>setExpandedQ(isOpen?null:qi)}
                    style={{display:"flex",alignItems:"center",gap:8,padding:".65rem 1rem",cursor:"pointer",background:isOpen?meta.bg:"var(--bg3)",transition:"background .15s",userSelect:"none"}}>
                    <span style={{fontSize:".78rem",fontWeight:700,color:meta.color,flexShrink:0}}>{meta.icon} Q{qi+1}</span>
                    <span style={{fontSize:".67rem",padding:"1px 7px",borderRadius:4,border:`1px solid ${meta.border}`,color:meta.color,flexShrink:0}}>{meta.label}</span>
                    <span style={{flex:1,fontSize:".82rem",color:q.q?"var(--cream)":"var(--muted2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontStyle:q.q?"normal":"italic"}}>
                      {q.q||"No question text yet…"}
                    </span>
                    <span style={{fontSize:".7rem",color:"var(--amber)",flexShrink:0}}>{q.points}pt</span>
                    {/* Move + delete */}
                    <div style={{display:"flex",gap:2,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                      <button style={{...ICON_BTN,opacity:qi===0?.3:1}} disabled={qi===0} onClick={()=>moveQ(ri,qi,-1)}>↑</button>
                      <button style={{...ICON_BTN,opacity:qi===ar.questions.length-1?.3:1}} disabled={qi===ar.questions.length-1} onClick={()=>moveQ(ri,qi,1)}>↓</button>
                      {ar.questions.length>1&&<button style={{...ICON_BTN,color:"var(--red)"}} onClick={()=>{delQ(ri,qi);if(expandedQ===qi)setExpandedQ(null);}}>✕</button>}
                    </div>
                    <span style={{color:"var(--muted2)",fontSize:".78rem",flexShrink:0}}>{isOpen?"▲":"▼"}</span>
                  </div>

                  {/* Expanded editor */}
                  {isOpen&&(
                    <div style={{padding:"1rem",background:"var(--bg2)",borderTop:`1px solid ${meta.border}`,display:"flex",flexDirection:"column",gap:".9rem"}}>
                      {/* Type / pts / time row */}
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                        <select value={q.type} onChange={e=>updQ(ri,qi,"type",e.target.value)} style={{...SEL_STYLE,color:"var(--cream)",fontWeight:600,padding:"8px 8px"}}>
                          <option value="multiple">🔤 Multiple Choice</option>
                          <option value="open">💬 Open Question</option>
                          <option value="music">🎵 Music</option>
                        </select>
                        <select value={q.points} onChange={e=>updQ(ri,qi,"points",+e.target.value)} style={SEL_STYLE}>
                          {[1,2,3,5,10,20,50].map(p=><option key={p} value={p}>{p} pt{p!==1?"s":""}</option>)}
                        </select>
                        {q.type!=="music"&&(
                          <select value={q.timeLimit??""} onChange={e=>updQ(ri,qi,"timeLimit",e.target.value===""?null:+e.target.value)} style={SEL_STYLE}>
                            <option value="">⏱ {defaultTime}s (default)</option>
                            {[10,15,20,30,45,60,90,120].map(t=><option key={t} value={t}>⏱ {t}s</option>)}
                          </select>
                        )}
                      </div>

                      {/* Question text */}
                      <div>
                        <Lbl>Question</Lbl>
                        <Inp value={q.q} onChange={e=>updQ(ri,qi,"q",e.target.value)}
                          placeholder={q.type==="music"?"Guess: artist and/or song title…":q.type==="open"?"Ask your open question…":"Type your question…"}/>
                      </div>

                      {/* ── Image — available for all question types ── */}
                      <div>
                        {q.image?(
                          <div style={{position:"relative",display:"inline-block",marginBottom:4}}>
                            <img src={q.image} alt="" style={{maxHeight:120,borderRadius:6,objectFit:"contain",display:"block"}}/>
                            <button onClick={()=>updQ(ri,qi,"image",null)} style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,.8)",border:"none",borderRadius:"50%",color:"#fff",width:20,height:20,cursor:"pointer",fontSize:"11px",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                          </div>
                        ):(
                          <input placeholder="🖼 Paste image URL…"
                            onBlur={e=>{const v=e.target.value.trim();if(v)updQ(ri,qi,"image",v);e.target.value="";}}
                            onKeyDown={e=>{if(e.key==="Enter"){const v=e.target.value.trim();if(v)updQ(ri,qi,"image",v);e.target.value="";}}}
                            style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"6px 9px",color:"var(--cream)",fontSize:".78rem",outline:"none",fontFamily:"var(--font-b)",boxSizing:"border-box"}}/>
                        )}
                      </div>

                      {/* ── MULTIPLE CHOICE ── */}
                      {q.type==="multiple"&&(
                        <>
                          <div>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                              <Lbl style={{margin:0}}>Options — tick ✓ to mark correct</Lbl>
                              <span style={{fontSize:".68rem",color:"var(--muted)",fontStyle:"italic"}}>multiple allowed</span>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:5,marginTop:4}}>
                              {q.options.map((opt,oi)=>{
                                const correctArr=Array.isArray(q.answer)?q.answer:[q.answer??0];
                                const isChk=correctArr.includes(oi);
                                const toggle=()=>{const next=isChk?correctArr.filter(x=>x!==oi):[...correctArr,oi].sort((a,b)=>a-b);updQ(ri,qi,"answer",next);};
                                return(
                                  <div key={oi} style={{display:"flex",alignItems:"center",gap:7}}>
                                    <div onClick={toggle}
                                      style={{width:18,height:18,borderRadius:4,border:`2px solid ${isChk?"var(--green)":"var(--border)"}`,background:isChk?"var(--green)":"transparent",cursor:"pointer",flexShrink:0,transition:"all .15s",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                      {isChk&&<span style={{color:"#fff",fontSize:10,fontWeight:900,lineHeight:1}}>✓</span>}
                                    </div>
                                    <span style={{width:"1rem",flexShrink:0,color:"var(--muted)",fontSize:".78rem",fontWeight:700}}>{ALPHA[oi]}</span>
                                    <Inp value={opt} onChange={e=>updOpt(ri,qi,oi,e.target.value)} placeholder={`Option ${ALPHA[oi]}`} style={{padding:"7px 9px",fontSize:".82rem"}}/>
                                    {q.options.length>2&&<button style={{...ICON_BTN,color:"var(--red)"}} onClick={()=>delOpt(ri,qi,oi)}>✕</button>}
                                  </div>
                                );
                              })}
                            </div>
                            {q.options.length<8&&<Btn onClick={()=>addOpt(ri,qi)} variant="ghost" size="sm" style={{marginTop:6,fontSize:".75rem"}}>+ Add option</Btn>}
                          </div>
                        </>
                      )}

                      {/* ── OPEN QUESTION ── */}
                      {q.type==="open"&&(
                        <div>
                          <Lbl>Expected answer (quizmaster reference only)</Lbl>
                          <Inp value={q.openAnswer} onChange={e=>updQ(ri,qi,"openAnswer",e.target.value)} placeholder="Correct answer…"/>
                          <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:3}}>Not shown to players — you award points verbally.</div>
                        </div>
                      )}

                      {/* ── MUSIC QUESTION ── */}
                      {q.type==="music"&&(
                        <div style={{display:"flex",flexDirection:"column",gap:".85rem"}}>
                          <div>
                            <Lbl>Song link (YouTube or Spotify)</Lbl>
                            <Inp value={q.songUrl} onChange={e=>updQ(ri,qi,"songUrl",e.target.value)} placeholder="https://youtu.be/… or https://open.spotify.com/track/…"/>
                            {q.songUrl&&!isYouTubeUrl(q.songUrl)&&!isSpotifyUrl(q.songUrl)&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:3}}>⚠ Use a YouTube or Spotify link</div>}
                            {q.songUrl&&isYouTubeUrl(q.songUrl)&&!getYouTubeId(q.songUrl)&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:3}}>⚠ Couldn&apos;t detect video ID</div>}
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"auto auto 1fr 1fr",gap:"1rem",alignItems:"end"}}>
                            <div>
                              <Lbl>Start at</Lbl>
                              <div style={{display:"flex",alignItems:"center",gap:4}}>
                                <input type="number" min={0} step={1} value={q.songStartSeconds||0}
                                  onChange={e=>updQ(ri,qi,"songStartSeconds",Math.max(0,+e.target.value||0))}
                                  style={{...SEL_STYLE,padding:"9px 8px",color:"var(--cream)",width:64,textAlign:"center"}}/>
                                <span style={{fontSize:".75rem",color:"var(--muted)"}}>s</span>
                              </div>
                            </div>
                            <div>
                              <Lbl>Play for</Lbl>
                              <select value={q.songPlaySeconds} onChange={e=>updQ(ri,qi,"songPlaySeconds",+e.target.value)} style={{...SEL_STYLE,padding:"9px 8px",color:"var(--cream)"}}>
                                {SONG_SECS.map(t=><option key={t} value={t}>{t}s</option>)}
                              </select>
                            </div>
                            <div><Lbl>Artist (reveal)</Lbl><Inp value={q.songArtist} onChange={e=>updQ(ri,qi,"songArtist",e.target.value)} placeholder="Artist name…"/></div>
                            <div><Lbl>Song title (reveal)</Lbl><Inp value={q.songTitle} onChange={e=>updQ(ri,qi,"songTitle",e.target.value)} placeholder="Song title…"/></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add question */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",paddingTop:".2rem"}}>
            <Btn onClick={()=>addQ(ri,"multiple")} variant="subtle" size="sm">+ Multiple Choice</Btn>
            <Btn onClick={()=>addQ(ri,"open")} variant="subtle" size="sm">+ Open</Btn>
            <Btn onClick={()=>addQ(ri,"music")} variant="subtle" size="sm">+ 🎵 Music</Btn>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* INTRO TAB                                               */}
      {/* ════════════════════════════════════════════════════════ */}
      {builderTab==="intro"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"1.1rem",maxWidth:620}}>
          <div>
            <Lbl>Intro Text</Lbl>
            <textarea value={introText} onChange={e=>setIntroText(e.target.value)}
              placeholder="Shown on the starting screen before the quiz begins…"
              style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",color:"var(--cream)",fontFamily:"var(--font-b)",fontSize:".88rem",outline:"none",resize:"vertical",minHeight:80,boxSizing:"border-box"}}/>
          </div>
          <div>
            <Lbl>Background Image URL</Lbl>
            <Inp value={introBg} onChange={e=>setIntroBg(e.target.value)} placeholder="https://… (fullscreen behind the intro slide)"/>
            {introBg&&<img src={introBg} alt="" style={{marginTop:8,maxHeight:100,borderRadius:6,objectFit:"cover",display:"block"}} onError={e=>e.target.style.display="none"}/>}
          </div>
          <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"1rem"}}>
            <div style={{fontSize:".72rem",color:"var(--muted)",marginBottom:".7rem",textTransform:"uppercase",letterSpacing:".08em"}}>Round preview on intro slide</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {rounds.map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,.06)",border:`1px solid ${r.secret?"rgba(224,85,85,.3)":"rgba(255,255,255,.12)"}`,borderRadius:8,padding:"5px 11px",fontSize:".8rem",color:r.secret?"var(--red)":"rgba(255,255,255,.7)"}}>
                  <span>{r.icon||"🎯"}</span>
                  <span>{r.secret?"???":(r.title||`Round ${i+1}`)}</span>
                  {r.secret&&<span style={{fontSize:".65rem",opacity:.7}}>(secret)</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* TEAMS TAB                                               */}
      {/* ════════════════════════════════════════════════════════ */}
      {builderTab==="teams"&&(
        <TeamSetPicker
          teams={teams}
          teamSetId={teamSetId}
          onChange={({teams:nextTeams,teamSetId:nextSetId})=>{setTeams(nextTeams);setTeamSetId(nextSetId);}}
          teamSets={team_sets}
          teamSetsError={teamSetsError}
          onRetryTeamSets={onRetryTeamSets}
          attendees={attendees}
          status={existing?.status||"ready"}
        />
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* WINNER TAB                                              */}
      {/* ════════════════════════════════════════════════════════ */}
      {builderTab==="winner"&&(
        <WinnerTab teams={teams} scores={existing?.scores||{}} title={title} winner={winner} onChange={setWinner}/>
      )}
    </div>
  );
};
