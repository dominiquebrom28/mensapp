// Quiz round/question editor (docs/quiz-unification-spec.md §8.1, App.jsx
// 2734-3258). Pure move (§8.3, Q3) -- body is byte-identical to the App.jsx
// original; only the imports below are new, replacing what used to be
// same-file `const`s. `SEL_STYLE`/`ICON_BTN`/`SONG_SECS` are quiz-builder-
// only (grep-verified, spec §8.3) and move here as local consts rather than
// into `model.js`, since nothing else needs them. `ALPHA`, `ROUND_ICONS`,
// `TYPE_META`, `blankQuestion`, `TEAM_AVATARS` were already extracted to
// `model.js` in WP-Q2 -- imported from there instead of a third copy.
// The team-creation UI here (§5.1 in the spec) is slated for deletion in
// WP-Q5 once `TeamSetPicker` lands; out of scope for this pure move.
import { useState } from 'react';
import { supabase } from '../../supabase.js';
import { ALPHA, ROUND_ICONS, TYPE_META, blankQuestion, TEAM_AVATARS } from './model.js';
import { getYouTubeId, isSpotifyUrl, isYouTubeUrl } from './urls.js';
import { Btn, Card, Inp, Lbl, TeamSetsErrorNotice } from './ui/Kit.jsx';

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
  const [newTeamName,setNewTeamName]=useState("");
  const [avatarPicker,setAvatarPicker]=useState(null);
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

  // ── Team helpers ─────────────────────────────────────────────────
  const assignedNames=teams.flatMap(t=>t.members);
  const unassigned=(attendees||[]).filter(a=>!assignedNames.includes(a.name));
  const addTeam=()=>{
    if(!newTeamName.trim())return;
    const usedAv=teams.map(t=>t.avatar||"");
    const nextAv=TEAM_AVATARS.find(a=>!usedAv.includes(a))||TEAM_AVATARS[teams.length%TEAM_AVATARS.length];
    setTeams(t=>[...t,{id:`tm${Date.now()}`,name:newTeamName.trim(),members:[],avatar:nextAv}]);
    setNewTeamName("");
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
          <Btn onClick={()=>onSave({title,defaultTime,rounds,teams,introText,introBg})} disabled={!valid} variant="gold" size="sm">
            {existing?"Save Changes":"Create Quiz"}
          </Btn>
        </div>
      </div>

      {/* ── Builder tabs ───────────────────────────────────────── */}
      <div style={{display:"flex",borderBottom:"1px solid var(--border)",marginBottom:"1.2rem"}}>
        <TabBtn id="rounds" label="📋 Rounds" badge={0}/>
        <TabBtn id="teams" label="👥 Teams" badge={teams.length}/>
        <TabBtn id="intro" label="🎬 Intro" badge={0}/>
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
        <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
          {/* Import saved teams */}
          {team_sets.length===0&&teamSetsError&&<TeamSetsErrorNotice onRetry={onRetryTeamSets}/>}
          {team_sets.length>0&&(
            <div style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:".85rem"}}>
              <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".5rem"}}>📥 Laad opgeslagen teams</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {team_sets.map(ts=>(
                  <button key={ts.id}
                    onClick={()=>setTeams(ts.teams.map(t=>({...t,captain:t.captain||null})))}
                    style={{background:"rgba(232,148,58,.1)",border:"1px solid rgba(232,148,58,.3)",borderRadius:6,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".8rem",fontFamily:"var(--font-b)",fontWeight:600,transition:"all .15s"}}
                    onMouseEnter={e=>{e.target.style.background="rgba(232,148,58,.2)";}}
                    onMouseLeave={e=>{e.target.style.background="rgba(232,148,58,.1)";}}>
                    {ts.category&&<span style={{opacity:.7,marginRight:4}}>[{ts.category}]</span>}{ts.name} <span style={{opacity:.65}}>({ts.teams.length})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Create team */}
          <div style={{display:"flex",gap:8}}>
            <Inp value={newTeamName} onChange={e=>setNewTeamName(e.target.value)} placeholder="Team name…"
              onKeyDown={e=>{if(e.key==="Enter")addTeam();}} style={{flex:1}}/>
            <Btn onClick={addTeam} disabled={!newTeamName.trim()} size="sm">+ Create Team</Btn>
          </div>

          {attendees.length===0&&(
            <div style={{textAlign:"center",padding:"2rem",color:"var(--muted)",fontSize:".85rem"}}>
              No attendees on this event yet — add them first via RSVP.
            </div>
          )}

          {/* Team cards */}
          {teams.map((team,ti)=>(
            <Card key={team.id} style={{background:"var(--bg3)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".6rem"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div onClick={()=>setAvatarPicker(avatarPicker===ti?null:ti)}
                    title="Change avatar"
                    style={{fontSize:"1.5rem",cursor:"pointer",lineHeight:1,padding:"3px 5px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg2)",userSelect:"none"}}>
                    {team.avatar||"🎯"}
                  </div>
                  <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"var(--amber2)"}}>{team.name}</div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:".7rem",color:"var(--muted)"}}>{team.members.length} member{team.members.length!==1?"s":""}</span>
                  <Btn onClick={()=>setTeams(t=>t.filter((_,i)=>i!==ti))} variant="danger" size="sm" style={{padding:"3px 8px"}}>✕</Btn>
                </div>
              </div>
              {avatarPicker===ti&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:".6rem",padding:".4rem",background:"var(--bg)",borderRadius:8,border:"1px solid var(--border)"}}>
                  {TEAM_AVATARS.map(e=>(
                    <div key={e} onClick={()=>{setTeams(ts=>ts.map((t,i)=>i===ti?{...t,avatar:e}:t));setAvatarPicker(null);}}
                      style={{fontSize:"1.3rem",cursor:"pointer",padding:"4px 5px",borderRadius:6,border:team.avatar===e?"2px solid var(--amber)":"1px solid transparent",background:team.avatar===e?"rgba(232,148,58,.12)":"transparent",userSelect:"none"}}>
                      {e}
                    </div>
                  ))}
                </div>
              )}
              {/* Current members */}
              {team.members.length>0&&(
                <div style={{fontSize:".65rem",color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>
                  Members · tap 👑 to set captain
                </div>
              )}
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:team.members.length>0?".6rem":0}}>
                {team.members.map(name=>{
                  const isCap=team.captain===name;
                  return(
                    <div key={name} style={{display:"flex",alignItems:"center",gap:4,
                      background:isCap?"rgba(201,146,42,.18)":"rgba(232,148,58,.1)",
                      border:isCap?"1px solid rgba(201,146,42,.5)":"1px solid rgba(232,148,58,.28)",
                      borderRadius:20,padding:"3px 8px 3px 6px",transition:"all .15s"}}>
                      <button
                        onClick={()=>setTeams(ts=>ts.map((t,i)=>i===ti?{...t,captain:t.captain===name?null:name}:t))}
                        title={isCap?"Remove captain":"Make team captain"}
                        style={{background:"none",border:"none",cursor:"pointer",fontSize:".75rem",padding:0,opacity:isCap?1:.3,lineHeight:1,transition:"opacity .15s",userSelect:"none"}}>
                        👑
                      </button>
                      <span style={{fontSize:".82rem",fontWeight:isCap?700:600,color:isCap?"var(--gold)":"var(--cream)"}}>{name}</span>
                      <button onClick={()=>setTeams(ts=>ts.map((t,i)=>i===ti?{...t,members:t.members.filter(m=>m!==name),captain:t.captain===name?null:t.captain}:t))}
                        style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".75rem",padding:"0 0 0 2px",lineHeight:1}}>✕</button>
                    </div>
                  );
                })}
              </div>
              {team.captain&&<div style={{fontSize:".7rem",color:"var(--gold)",marginBottom:".4rem"}}>👑 Captain: <strong>{team.captain}</strong> · answers for the team during live quiz</div>}
              {/* Add member */}
              {unassigned.length>0&&(
                <select defaultValue="" onChange={e=>{if(!e.target.value)return;const n=e.target.value;setTeams(ts=>ts.map((t,i)=>i===ti?{...t,members:[...t.members,n]}:t));e.target.value="";}}>
                  <option value="" disabled>+ Add member…</option>
                  {unassigned.map(a=><option key={a.name} value={a.name}>{a.name}</option>)}
                </select>
              )}
              {unassigned.length===0&&team.members.length===0&&<div style={{fontSize:".78rem",color:"var(--muted2)",fontStyle:"italic"}}>All lads are assigned elsewhere</div>}
            </Card>
          ))}

          {/* Unassigned list */}
          {unassigned.length>0&&teams.length>0&&(
            <div>
              <Lbl>Unassigned lads</Lbl>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:5}}>
                {unassigned.map(a=>(
                  <span key={a.name} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:20,padding:"3px 10px",fontSize:".8rem",color:"var(--muted)"}}>{a.name}</span>
                ))}
              </div>
            </div>
          )}

          {teams.length===0&&attendees.length>0&&(
            <div style={{textAlign:"center",padding:"1.5rem",color:"var(--muted)",fontSize:".85rem"}}>
              Create a team above, then assign lads to it.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
