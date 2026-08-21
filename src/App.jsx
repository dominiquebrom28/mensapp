import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { supabase, hashPin } from "./supabase.js";
import { isSafeImageUrl, isSafeVideoUrl } from "./features/trailer/safeUrl.js";

// The app's first code split (technical spec `docs/trailer-technical-spec.md`
// §3): keeps the trailer's weight out of the main chunk, loaded only when an
// event page's "🎬 Watch the trailer" button is actually clicked.
const EventTrailer = lazy(() => import("./features/trailer/EventTrailer.jsx"));

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STYLES
// ─────────────────────────────────────────────────────────────────────────────
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&family=DM+Sans:wght@300;400;500;600;700&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0c0901;--bg2:#150e04;--bg3:#1d1408;--bg4:#27190c;
      --amber:#e8943a;--amber2:#f5b866;--gold:#c9922a;
      --cream:#f0e6d3;--muted:#8a7460;--muted2:#6a5848;
      --border:rgba(232,148,58,.12);--border2:rgba(232,148,58,.35);
      --green:#4caf7d;--red:#e05555;--blue:#5b9bd5;--purple:#9b7fe8;--orange:#ff6b35;
      --font-h:'Playfair Display',serif;--font-b:'DM Sans',sans-serif;
      --radius:14px;--radius-sm:9px;
      --hero-glow:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(232,148,58,.18),transparent 70%);
    }
    body{background:var(--bg);color:var(--cream);font-family:var(--font-b);min-height:100vh}
    ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:linear-gradient(var(--amber),var(--gold));border-radius:3px}
    input,select,textarea{font-family:var(--font-b)}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes pop{0%{transform:scale(.8);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
    @keyframes countdown{from{stroke-dashoffset:0}to{stroke-dashoffset:251}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
    @keyframes goldShimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    @keyframes glowPulse{0%,100%{box-shadow:0 0 20px rgba(232,148,58,.1),0 0 60px rgba(232,148,58,.05)}50%{box-shadow:0 0 40px rgba(232,148,58,.35),0 0 120px rgba(232,148,58,.15)}}
    @keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}
    @keyframes borderFire{0%,100%{border-color:rgba(232,148,58,.25)}50%{border-color:rgba(232,148,58,.85)}}
    @keyframes annPulse{0%,100%{box-shadow:0 0 0 0 rgba(232,148,58,.0),0 4px 24px rgba(0,0,0,.4)}50%{box-shadow:0 0 0 4px rgba(232,148,58,.12),0 4px 32px rgba(0,0,0,.5)}}
    .ann-banner{animation:annPulse 3.5s ease-in-out infinite}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes countUp{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
    @keyframes reveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0% 0 0)}}
    @keyframes scoreReveal{0%{transform:translateX(-20px);opacity:0}100%{transform:translateX(0);opacity:1}}
    @keyframes timerPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
    @keyframes musicWave{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.6)}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes teamReveal{0%{opacity:0;transform:scale(.85) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes timerFinish{0%,100%{background:rgba(224,85,85,.07)}50%{background:rgba(224,85,85,.18)}}
    .qp-score-row{animation:scoreReveal .4s ease both}
    .qp-timer-warn{animation:timerPulse .6s ease-in-out infinite}
    .fu{animation:fadeUp .45s ease both}
    .fu1{animation:fadeUp .45s .08s ease both}
    .fu2{animation:fadeUp .45s .16s ease both}
    .fu3{animation:fadeUp .45s .24s ease both}
    .fu4{animation:fadeUp .45s .32s ease both}
    .ov{animation:fadeIn .2s ease both}
    .pop{animation:pop .35s ease both}
    .float{animation:float 3.5s ease-in-out infinite}
    .glow-pulse{animation:glowPulse 3s ease-in-out infinite}
    .fire-border{animation:borderFire 2s ease-in-out infinite}
    .skeleton{background:linear-gradient(90deg,var(--bg3) 25%,var(--bg4) 50%,var(--bg3) 75%);background-size:600px 100%;animation:shimmer 1.5s infinite;border-radius:8px}
    .event-card-upcoming:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(232,148,58,.15)!important}
    .event-card-upcoming{transition:all .25s cubic-bezier(.4,0,.2,1)}
    .schedule-card{transition:all .22s ease;animation:slideUp .32s ease both}
    .schedule-card:hover{transform:translateX(5px);border-color:var(--border2)!important;background:var(--bg4)!important}
    .rsvp-btn{transition:all .2s cubic-bezier(.4,0,.2,1)!important}
    .rsvp-btn:hover{transform:translateY(-1px);filter:brightness(1.1)}
    .rsvp-btn:active{transform:scale(.97)}
    input:hover,textarea:hover{border-color:rgba(232,148,58,.38)!important}
    select:hover{border-color:rgba(232,148,58,.38)!important}
    input:focus,textarea:focus,select:focus{border-color:var(--amber)!important;box-shadow:0 0 0 3px rgba(232,148,58,.13)!important;outline:none!important}
    .nav-btn{transition:all .18s ease!important}
    .nav-btn:hover{background:rgba(232,148,58,.12)!important;border-color:rgba(232,148,58,.5)!important;color:var(--amber2)!important}
    .nav-btn:active{transform:scale(.95)!important}
    .nav-logout:hover{background:rgba(224,85,85,.12)!important;border-color:rgba(224,85,85,.55)!important}
    .nav-logout:active{transform:scale(.95)!important}
    .notif-item{transition:background .15s ease}
    .notif-item:hover{background:var(--bg4)!important}
    @keyframes sj-reveal{0%{transform:scale(.93);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes sj-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
    @keyframes sj-correct{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
    .sj-img{animation:sj-reveal .35s cubic-bezier(.4,0,.2,1) both}
    .sj-wrong{animation:sj-shake .4s ease both}
    .sj-correct{animation:sj-correct .35s ease both}
    .sj-btn{transition:all .18s cubic-bezier(.4,0,.2,1)!important;user-select:none}
    .sj-btn:hover:not(:disabled){transform:translateY(-3px) scale(1.03)!important}
    .sj-btn:active:not(:disabled){transform:scale(.95)!important}
  `}</style>
);

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const Card = ({children,style={},className="",id}) => (
  <div id={id} className={className} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.4rem",...style}}>{children}</div>
);
const H = ({children,size="1.35rem",style={}}) => (
  <h2 style={{fontFamily:"var(--font-h)",fontSize:size,color:"var(--amber2)",marginBottom:".9rem",lineHeight:1.2,...style}}>{children}</h2>
);
const Btn = ({children,onClick,variant="primary",size="md",style={},disabled=false,type="button"}) => {
  const sz={sm:{padding:"6px 14px",fontSize:".78rem"},md:{padding:"10px 22px",fontSize:".88rem"},lg:{padding:"13px 30px",fontSize:"1rem"}};
  const vr={
    primary:{background:"var(--amber)",color:"var(--bg)",border:"none"},
    ghost:{background:"transparent",color:"var(--cream)",border:"1px solid var(--border)"},
    danger:{background:"transparent",color:"var(--red)",border:"1px solid rgba(224,85,85,.3)"},
    subtle:{background:"var(--bg3)",color:"var(--cream)",border:"1px solid var(--border)"},
    success:{background:"transparent",color:"var(--green)",border:"1px solid rgba(76,175,125,.3)"},
    gold:{background:"linear-gradient(135deg,var(--gold),var(--amber))",color:"var(--bg)",border:"none"},
  };
  const onEnter=e=>{if(disabled)return;const el=e.currentTarget;
    // Save current inline values so onLeave can restore them exactly
    el._saved={bg:el.style.background,tr:el.style.transform,sh:el.style.boxShadow,bc:el.style.borderColor,fi:el.style.filter};
    if(variant==="primary"){el.style.background="var(--amber2)";el.style.transform="translateY(-1px)";el.style.boxShadow="0 4px 16px rgba(232,148,58,.35)";}
    else if(variant==="ghost"){el.style.background="rgba(232,148,58,.09)";el.style.borderColor="var(--border2)";}
    else if(variant==="danger"){el.style.background="rgba(224,85,85,.12)";el.style.borderColor="rgba(224,85,85,.55)";}
    else if(variant==="subtle"){el.style.background="var(--bg4)";el.style.borderColor="var(--border2)";}
    else if(variant==="success"){el.style.background="rgba(76,175,125,.12)";el.style.borderColor="rgba(76,175,125,.55)";}
    else if(variant==="gold"){el.style.filter="brightness(1.12)";el.style.transform="translateY(-1px)";el.style.boxShadow="0 4px 18px rgba(201,146,42,.35)";}
  };
  const onLeave=e=>{const el=e.currentTarget;const s=el._saved||{};
    el.style.background=s.bg??"";el.style.transform=s.tr??"";el.style.boxShadow=s.sh??"";el.style.borderColor=s.bc??"";el.style.filter=s.fi??"";
  };
  // Save the pre-press transform (may be a hover transform) so onUp restores to it
  const onDown=e=>{if(!disabled){const el=e.currentTarget;el._preTr=el.style.transform;el.style.transform="scale(.96)";}};
  const onUp=e=>{if(!disabled){const el=e.currentTarget;el.style.transform=el._preTr??"";}}
  return <button type={type} onClick={onClick} disabled={disabled} onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseDown={onDown} onMouseUp={onUp} style={{borderRadius:"var(--radius-sm)",cursor:disabled?"not-allowed":"pointer",fontFamily:"var(--font-b)",fontWeight:600,transition:"all .18s",opacity:disabled?.5:1,...sz[size],...vr[variant],...style}}>{children}</button>;
};
const Inp = ({value,onChange,placeholder,style={},type="text",multiline=false,onKeyDown,autoFocus=false,rows=3}) => {
  const base={background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%",outline:"none"};
  return multiline
    ? <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{...base,resize:"vertical",...style}}/>
    : <input type={type} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} autoFocus={autoFocus} style={{...base,...style}}/>;
};
const Lbl = ({children}) => <div style={{fontSize:".75rem",color:"var(--muted)",letterSpacing:".06em",textTransform:"uppercase",marginBottom:5}}>{children}</div>;
const Tag = ({children,color="var(--amber)"}) => (
  <span style={{background:color+"22",color,border:`1px solid ${color}33`,borderRadius:6,padding:"3px 10px",fontSize:".73rem",fontWeight:600}}>{children}</span>
);
const Avatar = ({name,size=32,index=0,photoUrl="",style={}}) => {
  if(photoUrl) return <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,overflow:"hidden",border:"2px solid var(--bg2)",...style}}><img src={photoUrl} alt={name} style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>;
  const animal=ANIMALS[index%ANIMALS.length];
  return <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,background:animal.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.5,border:"2px solid var(--bg2)",...style}}>{animal.emoji}</div>;
};
const getUA=(name,users=[])=>{const u=users.find(x=>x.username?.toLowerCase()===name?.toLowerCase());return{index:u?.animal_avatar??u?.avatar??0,photoUrl:u?.photo_url||""};};
const getDisplayName=(name,users=[])=>{const u=users.find(x=>x.username?.toLowerCase()===name?.toLowerCase());return u?.display_name||name;};
const Tooltip=({label,children})=>{
  const [show,setShow]=useState(false);
  return(
    <div style={{position:"relative",display:"inline-flex"}} onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      {children}
      {show&&label&&<div style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",background:"rgba(15,15,20,.97)",border:"1px solid var(--border2)",borderRadius:6,padding:"3px 8px",fontSize:".7rem",color:"#fff",whiteSpace:"nowrap",pointerEvents:"none",zIndex:200,boxShadow:"0 2px 8px rgba(0,0,0,.4)"}}>
        {label}
        <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",width:0,height:0,border:"5px solid transparent",borderTopColor:"rgba(15,15,20,.97)"}}/>
      </div>}
    </div>
  );
};
const Modal = ({children,onClose,maxWidth=500,onBackdropClose}) => {
  const ready=useRef(false);
  useEffect(()=>{const t=setTimeout(()=>{ready.current=true;},350);return()=>clearTimeout(t);},[]);
  return (
  <div className="ov" onClick={()=>{if(ready.current)(onBackdropClose||onClose)();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
    <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth,maxHeight:"92vh",overflowY:"auto"}}>
      <Card style={{padding:"1.8rem"}}>{children}</Card>
    </div>
  </div>
  );
};
const RoleBadge = ({role}) => {
  const badges=[];
  if(hasAdmin({role}))badges.push({color:"var(--amber)",label:"Admin"});
  if(hasOrg({role}))badges.push({color:"var(--purple)",label:"Org"});
  if(!badges.length){
    if(role==="lad"||role==="member")badges.push({color:"var(--green)",label:"Lad"});
    else badges.push({color:"var(--muted)",label:"Pending"});
  }
  return <>{badges.map(b=><Tag key={b.label} color={b.color}>{b.label}</Tag>)}</>;
};
const Divider = ({label}) => (
  <div style={{display:"flex",alignItems:"center",gap:12,margin:".5rem 0"}}>
    <div style={{flex:1,height:1,background:"var(--border)"}}/>
    {label&&<span style={{color:"var(--muted)",fontSize:".72rem",letterSpacing:".08em",textTransform:"uppercase"}}>{label}</span>}
    <div style={{flex:1,height:1,background:"var(--border)"}}/>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────
const ACTIVE_ROLES=["admin","admin+org","org","organisation","lad","member"];
const hasAdmin=u=>["admin","admin+org"].includes(u?.role);
const hasOrg=u=>["org","admin+org","organisation"].includes(u?.role);
const can = {
  editEvent:    u=>hasAdmin(u),
  manageUsers:  u=>hasAdmin(u),
  addWinner:    u=>hasAdmin(u)||hasOrg(u),
  editSchedule: u=>hasOrg(u),
  createPoll:   u=>hasOrg(u),
  closePoll:    u=>hasOrg(u),
  deletePoll:   u=>hasOrg(u),
  deletePhoto:  u=>hasAdmin(u),
  hostQuiz:     u=>hasOrg(u),
  announce:     u=>hasAdmin(u)||hasOrg(u),
  vote:         u=>ACTIVE_ROLES.includes(u?.role),
  uploadPhoto:  u=>ACTIVE_ROLES.includes(u?.role),
  reactPhoto:   u=>ACTIVE_ROLES.includes(u?.role),
  updateRsvp:   u=>ACTIVE_ROLES.includes(u?.role),
};

// ─────────────────────────────────────────────────────────────────────────────
// COUNTDOWN HOOK
// ─────────────────────────────────────────────────────────────────────────────
const useIsMobile = () => {
  const [mobile,setMobile]=useState(typeof window!=="undefined"&&window.innerWidth<640);
  useEffect(()=>{const h=()=>setMobile(window.innerWidth<640);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  return mobile;
};

const useCountdown = (dateStr,startTime="12:00") => {
  const [t,setT]=useState({});
  useEffect(()=>{
    const tick=()=>{
      const diff=new Date(`${dateStr}T${startTime}:00`)-Date.now();
      if(diff<=0)return setT({past:true});
      setT({d:Math.floor(diff/86400000),h:Math.floor((diff%86400000)/3600000),m:Math.floor((diff%3600000)/60000),s:Math.floor((diff%60000)/1000)});
    };
    tick();const id=setInterval(tick,1000);return()=>clearInterval(id);
  },[dateStr]);
  return t;
};
const CU = ({v,l}) => (
  <div style={{textAlign:"center",minWidth:50}}>
    <div style={{fontFamily:"var(--font-h)",fontSize:"2.1rem",fontWeight:900,color:"var(--amber)",lineHeight:1}}>{String(v??0).padStart(2,"0")}</div>
    <div style={{color:"var(--muted)",fontSize:".62rem",letterSpacing:".12em",textTransform:"uppercase",marginTop:3}}>{l}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────────────────
const statusMap={
  going:{color:"var(--green)",label:"Going"},maybe:{color:"var(--amber)",label:"Maybe"},
  "not coming":{color:"var(--red)",label:"Out"},went:{color:"var(--blue)",label:"Attended"},absent:{color:"var(--muted2)",label:"Absent"},
};
const ANIMALS=[
  {name:"Beer",   emoji:"🐻",bg:"linear-gradient(135deg,#8B4513,#D2691E)"},
  {name:"Vos",    emoji:"🦊",bg:"linear-gradient(135deg,#c0392b,#e8943a)"},
  {name:"Kikker", emoji:"🐸",bg:"linear-gradient(135deg,#27ae60,#52c41a)"},
  {name:"Pinguïn",emoji:"🐧",bg:"linear-gradient(135deg,#2c3e50,#4a6278)"},
  {name:"Uil",    emoji:"🦉",bg:"linear-gradient(135deg,#6B3FA0,#9B59B6)"},
  {name:"Leeuw",  emoji:"🦁",bg:"linear-gradient(135deg,#c9922a,#f5b866)"},
  {name:"Wolf",   emoji:"🐺",bg:"linear-gradient(135deg,#485460,#808e9b)"},
  {name:"Konijn", emoji:"🐰",bg:"linear-gradient(135deg,#a55eea,#d980fa)"},
  {name:"Koala",  emoji:"🐨",bg:"linear-gradient(135deg,#0984e3,#74b9ff)"},
  {name:"Panda",  emoji:"🐼",bg:"linear-gradient(135deg,#2d3436,#636e72)"},
];
const computeMemberStats=(username,events)=>{
  const n=username.toLowerCase();
  const attended=events.filter(e=>e.archived&&(e.attendees||[]).some(a=>a.name.toLowerCase()===n&&a.status==="went"));
  const mensdays=attended.filter(e=>e.type!=="weekend").length;
  const weekends=attended.filter(e=>e.type==="weekend").length;
  let quizWins=0;
  events.forEach(e=>{(e.quizzes||[]).forEach(q=>{
    if(!q.scores||!Object.keys(q.scores).length)return;
    const max=Math.max(...Object.values(q.scores));
    if(max>0&&q.scores[username]===max)quizWins++;
  });});
  const mentions=[];
  events.forEach(e=>{(e.winners||[]).forEach(w=>{if(w.winner.toLowerCase()===n)mentions.push({...w,eventName:e.name});});});
  return{mensdays,weekends,quizWins,mentions,total:mensdays+weekends};
};
// Formats a single date, or a start–end range when endDateStr is a different
// day, in nl-NL. Falls back to the plain single-day format (unchanged from
// pre-multi-day behaviour) whenever there's no end date or it equals the
// start date. opts.weekday/opts.year toggle those parts (both default true),
// opts.month picks "long"|"short" (default "long"). Defensive against a
// reversed range (endDateStr before dateStr, e.g. bad/legacy data) -- the
// earlier date always renders first rather than producing garbled output.
const formatEventDateRange=(dateStr,endDateStr,opts={})=>{
  if(!dateStr)return"";
  const{weekday=true,year=true,month="long"}=opts;
  const start=new Date(dateStr+"T12:00:00");
  const hasRange=!!endDateStr&&endDateStr!==dateStr;
  if(!hasRange){
    const o={day:"numeric",month};
    if(weekday)o.weekday="long";
    if(year)o.year="numeric";
    return start.toLocaleDateString("nl-NL",o);
  }
  const endRaw=new Date(endDateStr+"T12:00:00");
  const[from,to]=endRaw<start?[endRaw,start]:[start,endRaw];
  const sameYear=from.getFullYear()===to.getFullYear();
  const sameMonth=sameYear&&from.getMonth()===to.getMonth();
  const wd=dt=>weekday?`${dt.toLocaleDateString("nl-NL",{weekday:"short"})} `:"";
  const showYear=year||!sameYear;
  const endStr=`${wd(to)}${to.getDate()} ${to.toLocaleDateString("nl-NL",{month})}${showYear?` ${to.getFullYear()}`:""}`;
  const startStr=sameMonth
    ?`${wd(from)}${from.getDate()}`
    :`${wd(from)}${from.getDate()} ${from.toLocaleDateString("nl-NL",{month})}${!sameYear?` ${from.getFullYear()}`:""}`;
  return`${startStr} – ${endStr}`;
};
// Number of calendar days an event spans (inclusive), `date` as day 0 and
// `end_date` (if any) as the last day. No end_date, blank, or equal-to-date
// all mean a single-day event (returns 1). Defensive against a reversed
// range the same way formatEventDateRange is.
const eventDayCount=(dateStr,endDateStr)=>{
  if(!dateStr||!endDateStr||endDateStr===dateStr)return 1;
  const start=new Date(dateStr+"T12:00:00");
  const end=new Date(endDateStr+"T12:00:00");
  const days=Math.round(Math.abs(end-start)/86400000);
  return days+1;
};
// Maps a schedule stop's 0-based `day` index to its actual calendar date,
// offset from the event's start `date` (day:0 = the start date itself).
// Deliberately date-derived rather than stored, so moving the whole event
// (editing `date`) keeps every stop correctly attached instead of orphaning
// them -- see the `day` field on schedule stops.
const dateForEventDay=(dateStr,dayIndex)=>{
  if(!dateStr)return"";
  const d=new Date(dateStr+"T12:00:00");
  d.setDate(d.getDate()+(dayIndex||0));
  return d.toISOString().slice(0,10);
};
// Human label for a schedule day group/heading, e.g. "Dag 1 · vrijdag 12 september".
const dayHeadingLabel=(dateStr,dayIndex)=>{
  const iso=dateForEventDay(dateStr,dayIndex);
  const suffix=iso?` · ${new Date(iso+"T12:00:00").toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long"})}`:"";
  return`Dag ${(dayIndex||0)+1}${suffix}`;
};
// Sort comparator for schedule stops: day first (missing/undefined treated
// as 0, i.e. pre-multi-day stops), then time-of-day within the day. Stable
// (ties keep their existing relative order) so manual reordering via the
// editor's ↑/↓ still shows through whenever times are equal or blank.
const scheduleDayTimeOrder=(a,b)=>((a.day??0)-(b.day??0))||(a.time||"").localeCompare(b.time||"");
// Boundary adapter for the trailer feature (src/features/trailer/). The
// trailer now plays the event's real, owner-produced video and ends on a
// single end-card view -- direction change from the owner, 2026-08-21. The
// beat-engine this used to feed (schedule montage, secret tease, "reigning
// champion" legacy nod scanning every archived edition) has no consumer any
// more and was deleted outright, not just unwired -- see `findChampion`'s
// removal in the same change. Produces a plain, serialisable view model with
// exactly what the end card needs: roster, kretjes, event identity, the
// video URL. Keep the `const NAME=(...)=>{ ... };` shape: the
// source-extraction test helpers in src/test/ match on it.
const toTrailerInput=(evt,users=[])=>{
  const going=(evt.attendees||[]).filter(a=>a.status==="going")
    .slice(0,12).map(a=>({name:getDisplayName(a.name,users),...getUA(a.name,users)}));
  return{
    eventId:evt.id,name:evt.name||"",
    videoUrl:isSafeVideoUrl(evt.trailer_video_url)?evt.trailer_video_url:"",
    kretjes:Number.isFinite(evt.kretjes)?evt.kretjes:0,
    goingCount:(evt.attendees||[]).filter(a=>a.status==="going").length,
    going:going.map(g=>({name:g.name,photoUrl:isSafeImageUrl(g.photoUrl)?g.photoUrl:"",avatarIndex:g.index??0})),
  };
};
const ICONS=["📍","🍺","🏎️","🎯","🧠","🍽️","🍝","🍹","🎳","🔐","🎤","🎲","🏆","🚗","🎉","🍻","🎸","🏄","⚽","🎾","🎨","🎭"];
const TROPHY_ICONS=["🏆","🥇","🥈","🥉","🎯","🧠","🍺","😴","😅","📸","🎤","🏎️","🔐","🎳","🎲","👑","💀","🤡","🎖️","⚡","🦆","🐐"];
const REACTIONS=["🍺","😂","❤️","🔥","👑"];
const HIGHLIGHT_EMOJIS=["✨","😂","😬","🎷","🍰","🚗","🎯","🏆","🍺","🤦","👀","💀","🐐","🔥","❤️","🎉"];

const SEED_EVENTS=[
  {
    id:"evt-2023",name:"Mensday 2023",type:"day",date:"2023-09-09",start_time:"12:00",end_time:"23:00",
    location:"Amsterdam",description:"The sixth edition. Legendary go-karting afternoon.",theme:"Racing Edition",archived:true,
    attendees:[{name:"Doom",status:"went"},{name:"Bram",status:"went"},{name:"Sander",status:"went"},{name:"Tim",status:"went"},{name:"Ruben",status:"absent"},{name:"Daan",status:"went"}],
    schedule:[
      {time:"12:00",activity:"Arrival & welcome beers",location:"Café de Kroeg, Leidseplein",locationUrl:"",icon:"🍺",note:""},
      {time:"14:00",activity:"Go-karting",location:"Karting Amsterdam Noord",locationUrl:"",icon:"🏎️",note:"Teams of 2"},
      {time:"17:30",activity:"Pub quiz",location:"The Minds, Spui",locationUrl:"",icon:"🧠",note:""},
      {time:"19:30",activity:"Dinner",location:"Trattoria Roma, Jordaan",locationUrl:"",icon:"🍝",note:"3-course set menu"},
      {time:"22:00",activity:"Bar crawl",location:"Leidseplein area",locationUrl:"",icon:"🍻",note:""},
    ],
    faqs:[],polls:[],photos:[],quizzes:[
      {id:"q1",title:"General Knowledge 2023",status:"finished",questions:[
        {q:"What year was the first Mensday?",options:["2017","2018","2016","2019"],answer:2,points:100},
        {q:"How many countries are in the EU?",options:["25","27","30","28"],answer:1,points:100},
        {q:"Who won the 2022 World Cup?",options:["France","Brazil","Argentina","Germany"],answer:2,points:100},
      ],scores:{"Doom":200,"Bram":300,"Tim":100,"Sander":300,"Daan":200}},
    ],
    winners:[
      {id:"w1",category:"🏆 Overall Champion",winner:"Doom",detail:"Dominated go-karting AND won the pub quiz.",icon:"🏆"},
      {id:"w2",category:"😴 First to Bed",winner:"Sander",detail:"Gone by 11pm. Classic.",icon:"😴"},
      {id:"w3",category:"🍺 Last Man Standing",winner:"Bram",detail:"Still going at 2am.",icon:"🍺"},
    ],
    highlights:[
      {id:"h1",text:"Doom claimed his kart had a technical disadvantage but still finished first.",emoji:"🏎️"},
      {id:"h2",text:"The waiter brought out free tiramisu after we sang happy birthday to nobody.",emoji:"🍰"},
    ],
  },
  {
    id:"evt-2024",name:"Mensday 2024",type:"day",date:"2024-09-14",start_time:"13:00",end_time:"23:30",
    location:"Rotterdam",description:"The seventh edition. Escape room & rooftop dinner.",theme:"",archived:true,
    attendees:[{name:"Doom",status:"went"},{name:"Bram",status:"went"},{name:"Sander",status:"absent"},{name:"Tim",status:"went"},{name:"Ruben",status:"went"},{name:"Daan",status:"went"}],
    schedule:[
      {time:"13:00",activity:"Lunch",location:"De Markthal",locationUrl:"",icon:"🥗",note:""},
      {time:"15:00",activity:"Escape room",location:"Sherlocked Rotterdam",locationUrl:"",icon:"🔐",note:"We failed with 4 min left"},
      {time:"17:30",activity:"Rooftop drinks",location:"Hotel New York",locationUrl:"",icon:"🍹",note:""},
      {time:"20:00",activity:"Dinner",location:"FG Restaurant",locationUrl:"",icon:"🍷",note:"Michelin star"},
    ],
    faqs:[],polls:[],photos:[],quizzes:[],
    winners:[
      {id:"w1",category:"🔐 Escape Room MVP",winner:"Tim",detail:"Cracked 3 of the 5 puzzles.",icon:"🔐"},
      {id:"w2",category:"😅 Most Useless",winner:"Ruben",detail:"Stood reading the same clue for 20 minutes.",icon:"😅"},
    ],
    highlights:[
      {id:"h1",text:"We failed the escape room but convinced ourselves we 'almost' had it. Staff said everyone says that.",emoji:"🔐"},
      {id:"h2",text:"The rooftop bar had a live jazz trio. Nobody planned this. Perfect.",emoji:"🎷"},
    ],
  },
  {
    id:"evt-2025",name:"Mensday 2025",type:"day",date:"2025-09-13",start_time:"12:00",end_time:"",
    location:"TBD",description:"The eighth edition. Planning in progress!",theme:"",archived:false,
    attendees:[{name:"Doom",status:"going"},{name:"Bram",status:"going"},{name:"Sander",status:"maybe"},{name:"Tim",status:"going"},{name:"Ruben",status:"not coming"},{name:"Daan",status:"going"}],
    schedule:[
      {time:"12:00",activity:"Arrival",location:"TBD",locationUrl:"",icon:"📍",note:""},
      {time:"14:00",activity:"Activity (vote!)",location:"TBD",locationUrl:"",icon:"🎯",note:""},
      {time:"19:00",activity:"Dinner (vote!)",location:"TBD",locationUrl:"",icon:"🍽️",note:""},
      {time:"21:00",activity:"Bar crawl",location:"TBD",locationUrl:"",icon:"🍻",note:""},
    ],
    faqs:[
      {id:"faq1",question:"What time does it kick off?",askedBy:"Bram",askedAt:"2025-06-01T10:00:00Z",answer:"We're aiming for 12:00. Keep an eye on the schedule tab for updates.",answeredBy:"Doom",answeredAt:"2025-06-01T11:30:00Z"},
      {id:"faq2",question:"Do we need to bring cash?",askedBy:"Tim",askedAt:"2025-06-03T09:00:00Z",answer:null,answeredBy:null,answeredAt:null},
    ],polls:[
      {id:"p1",title:"What should we eat?",emoji:"🍽️",closed:false,options:[{label:"BBQ at the park",votes:["Doom","Tim","Daan"]},{label:"Indonesian Rijsttafel",votes:[]},{label:"Italian — pasta & wine",votes:["Bram"]},{label:"Steakhouse",votes:["Sander"]}]},
      {id:"p2",title:"Which activity?",emoji:"🎯",closed:false,options:[{label:"Laser tag",votes:["Doom","Tim"]},{label:"Bowling",votes:["Sander"]},{label:"Padel tennis",votes:["Daan"]},{label:"Axe throwing",votes:["Bram"]}]},
    ],
    photos:[],quizzes:[],winners:[],highlights:[],
  },
];

const SEED_USERS=[
  {id:"u-admin",username:"Doom",pin:"1234",role:"admin",joined_at:"2023-01-01",avatar:0},
];

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SCREENS
// ─────────────────────────────────────────────────────────────────────────────
const AuthShell = ({children}) => (
  <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem",background:"var(--bg)"}}>
    <GS/><div style={{width:"100%",maxWidth:420}}>
      <div style={{textAlign:"center",marginBottom:"2rem"}}>
        <div style={{fontSize:"3.2rem",marginBottom:".4rem"}}>🍺</div>
        <div style={{fontFamily:"var(--font-h)",fontSize:"2.2rem",color:"var(--amber2)"}}>MensDay</div>
        <div style={{color:"var(--muted)",fontSize:".8rem",letterSpacing:".08em",marginTop:4}}>THE ANNUAL GATHERING</div>
      </div>
      {children}
    </div>
  </div>
);

const LoginScreen = ({users,onLogin,onGoRegister}) => {
  const [username,setUsername]=useState("");
  const [pin,setPin]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const submit=async()=>{
    setErr("");setLoading(true);
    const pinH=await hashPin(pin);
    const u=users.find(u=>u.username.toLowerCase()===username.trim().toLowerCase()&&u.pin_hash===pinH);
    if(!u){setErr("Wrong username or PIN.");setLoading(false);return;}
    if(u.role==="pending"){setErr("Your account is awaiting admin approval. Hang tight!");setLoading(false);return;}
    onLogin(u);setLoading(false);
  };
  return (
    <AuthShell>
      <Card className="fu" style={{padding:"2rem"}}>
        <H size="1.5rem" style={{textAlign:"center"}}>Welcome back</H>
        <div style={{display:"grid",gap:".9rem"}}>
          <div><Lbl>Username</Lbl><Inp value={username} onChange={e=>setUsername(e.target.value)} placeholder="Your name" autoFocus/></div>
          <div><Lbl>PIN</Lbl><Inp value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••" type="password" onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
          {err&&<div style={{background:"rgba(224,85,85,.1)",border:"1px solid rgba(224,85,85,.3)",borderRadius:"var(--radius-sm)",padding:"9px 13px",color:"var(--red)",fontSize:".83rem"}}>{err}</div>}
          <Btn onClick={submit} disabled={loading||!username||!pin} style={{marginTop:4}}>{loading?"Logging in…":"Log In"}</Btn>
        </div>
      </Card>
      <div style={{textAlign:"center",marginTop:"1.2rem",color:"var(--muted)",fontSize:".83rem"}}>
        New here?{" "}<span onClick={onGoRegister} style={{color:"var(--amber)",cursor:"pointer",textDecoration:"underline"}}>Request access</span>
      </div>
    </AuthShell>
  );
};

const RegisterScreen = ({users,onRegister,onGoLogin}) => {
  const [username,setUsername]=useState("");
  const [pin,setPin]=useState("");
  const [pin2,setPin2]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const submit=async()=>{
    setErr("");
    if(username.trim().length<2){setErr("Gebruikersnaam moet minimaal 2 tekens zijn.");return;}
    if(users.find(u=>u.username.toLowerCase()===username.trim().toLowerCase())){setErr("Deze naam is al bezet.");return;}
    if(pin.length<4){setErr("PIN moet minimaal 4 cijfers zijn.");return;}
    if(pin!==pin2){setErr("PINs komen niet overeen.");return;}
    setLoading(true);
    const pinH=await hashPin(pin);
    const errMsg=await onRegister({id:`u-${Date.now()}`,username:username.trim(),pin_hash:pinH,role:"pending",joined_at:new Date().toISOString(),avatar:Math.floor(Math.random()*8)});
    setLoading(false);
    if(!errMsg)setDone(true);
    else setErr("Fout: "+errMsg);
  };
  if(done)return(
    <AuthShell>
      <Card className="fu" style={{padding:"2rem",textAlign:"center"}}>
        <div style={{fontSize:"3rem",marginBottom:"1rem"}}>⏳</div>
        <H size="1.4rem">Aanvraag verstuurd!</H>
        <p style={{color:"var(--muted)",fontSize:".88rem",lineHeight:1.7,marginBottom:"1.5rem"}}>Je account wacht op goedkeuring van de admin. Log daarna in met je gebruikersnaam en PIN.</p>
        <Btn onClick={onGoLogin} variant="ghost">Terug naar inloggen</Btn>
      </Card>
    </AuthShell>
  );
  return(
    <AuthShell>
      <Card className="fu" style={{padding:"2rem"}}>
        <H size="1.5rem" style={{textAlign:"center"}}>Toegang aanvragen</H>
        <p style={{color:"var(--muted)",fontSize:".83rem",textAlign:"center",marginBottom:"1.4rem",marginTop:"-.4rem"}}>Kies een gebruikersnaam & PIN. Een admin keurt je account goed.</p>
        <div style={{display:"grid",gap:".9rem"}}>
          <div><Lbl>Gebruikersnaam</Lbl><Inp value={username} onChange={e=>setUsername(e.target.value)} placeholder="Je voornaam of bijnaam" autoFocus/></div>
          <div><Lbl>PIN (4–6 cijfers)</Lbl><Inp value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••" type="password"/></div>
          <div><Lbl>PIN bevestigen</Lbl><Inp value={pin2} onChange={e=>setPin2(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••" type="password" onKeyDown={e=>e.key==="Enter"&&!loading&&submit()}/></div>
          {err&&<div style={{background:"rgba(224,85,85,.1)",border:"1px solid rgba(224,85,85,.3)",borderRadius:"var(--radius-sm)",padding:"9px 13px",color:"var(--red)",fontSize:".83rem"}}>{err}</div>}
          <Btn onClick={submit} disabled={!username||!pin||!pin2||loading} style={{marginTop:4}}>{loading?"Bezig…":"Toegang aanvragen"}</Btn>
        </div>
      </Card>
      <div style={{textAlign:"center",marginTop:"1.2rem",color:"var(--muted)",fontSize:".83rem"}}>
        Al goedgekeurd?{" "}<span onClick={onGoLogin} style={{color:"var(--amber)",cursor:"pointer",textDecoration:"underline"}}>Inloggen</span>
      </div>
    </AuthShell>
  );
};

const PendingScreen = ({user,onLogout}) => (
  <AuthShell>
    <Card className="fu" style={{padding:"2rem",textAlign:"center"}}>
      <div style={{fontSize:"3rem",marginBottom:"1rem"}}>⏳</div>
      <H size="1.4rem">Pending Approval</H>
      <p style={{color:"var(--muted)",fontSize:".88rem",lineHeight:1.7,marginBottom:"1.5rem"}}>Hey <strong style={{color:"var(--cream)"}}>{user.username}</strong> — your account is waiting for admin approval. Nag the group chat.</p>
      <Btn onClick={onLogout} variant="ghost">Log Out</Btn>
    </Card>
  </AuthShell>
);

// ─────────────────────────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────────────────────────
const Nav = ({view,eventName,onBack,currentUser,onLogout,onAdmin,onHof,onHome,onMembers,onAnnounce,pendingCount,notifications,notifLastRead,onUpdates,onProfile,onTeams,onTimer,onSaraJay,saraJayUnlocked}) => {
  const [menuOpen,setMenuOpen]=useState(false);
  const isMobile=useIsMobile();
  const unread=notifications.filter(n=>n.timestamp>notifLastRead).length;
  useEffect(()=>{
    if(!menuOpen)return;
    const close=()=>setMenuOpen(false);
    document.addEventListener("click",close);
    return()=>document.removeEventListener("click",close);
  },[menuOpen]);
  const bellBtn=(mobile=false)=>(
    <button onClick={onUpdates} className="nav-btn" style={{position:"relative",background:view==="updates"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",padding:mobile?"6px 10px":"5px 12px",cursor:"pointer",fontSize:mobile?"1rem":".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>
      📬{unread>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{unread}</span>}
    </button>
  );
  return(
    <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:200,background:"rgba(15,11,7,.94)",backdropFilter:"blur(14px)",borderBottom:"1px solid var(--border)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 1.2rem",height:58,gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1}}>
          {view!=="home"&&<button onClick={onBack} className="nav-btn" style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--muted)",padding:"5px 12px",cursor:"pointer",fontSize:".8rem",fontFamily:"var(--font-b)",flexShrink:0}}>← Terug</button>}
          <div onClick={onHome} onMouseEnter={e=>e.currentTarget.style.opacity=".72"} onMouseLeave={e=>e.currentTarget.style.opacity=""} style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",cursor:"pointer",transition:"opacity .15s"}}>
            {view==="home"?"🍺 Mensday":view==="hof"?"🏅 Hall of Fame":view==="members"?"👥 Lads":view==="updates"?"📬 Updates":view==="teams"?"🎲 Team Creator":view==="timer"?"⏱ Timer":view==="sarajay"?"🤖 Sara Jay":eventName}
          </div>
        </div>
        {!isMobile&&(
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <button onClick={onMembers} className="nav-btn" style={{background:(view==="members"||view==="member")?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>👥 Lads</button>
            <button onClick={onHof} className="nav-btn" style={{background:view==="hof"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>🏅 Hall of Fame</button>
            <button onClick={onTeams} className="nav-btn" style={{background:view==="teams"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>🎲 Teams</button>
            <button onClick={onTimer} className="nav-btn" style={{background:view==="timer"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>⏱ Timer</button>
            <button onClick={saraJayUnlocked?onSaraJay:undefined} className="nav-btn" style={{background:view==="sarajay"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:saraJayUnlocked?"var(--amber2)":"var(--muted)",padding:"5px 12px",cursor:saraJayUnlocked?"pointer":"not-allowed",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600,opacity:saraJayUnlocked?1:.55}}>{saraJayUnlocked?"🤖 Sara Jay":"🔒 ???"}</button>
            {can.announce(currentUser)&&<button onClick={onAnnounce} className="nav-btn" style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>📢 Announce</button>}
            {can.manageUsers(currentUser)&&<button onClick={onAdmin} className="nav-btn" style={{position:"relative",background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>⚙ Admin{pendingCount>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingCount}</span>}</button>}
            {bellBtn()}
            <div onClick={onProfile} onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.background="rgba(232,148,58,.08)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.background="var(--bg3)";}} style={{display:"flex",alignItems:"center",gap:7,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"5px 12px",cursor:"pointer",transition:"border-color .15s,background .15s"}}>
              <Avatar name={currentUser.username} size={22} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
              <span style={{fontSize:".8rem",color:"var(--cream)"}}>{currentUser.display_name||currentUser.username}</span>
              <RoleBadge role={currentUser.role}/>
            </div>
            <button onClick={onLogout} className="nav-logout" style={{background:"transparent",border:"1px solid rgba(224,85,85,.3)",borderRadius:8,color:"var(--red)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600,transition:"all .18s ease"}}>Uitloggen</button>
          </div>
        )}
        {isMobile&&(
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {bellBtn(true)}
            <button onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o);}} className="nav-btn" style={{position:"relative",background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",padding:"6px 11px",cursor:"pointer",fontSize:"1.1rem",lineHeight:1}}>
              {menuOpen?"✕":"☰"}{!menuOpen&&pendingCount>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingCount}</span>}
            </button>
          </div>
        )}
      </div>
      {isMobile&&menuOpen&&(
        <div onClick={e=>e.stopPropagation()} style={{background:"rgba(15,11,7,.98)",borderBottom:"1px solid var(--border)",padding:".8rem 1.2rem",display:"grid",gap:".5rem"}}>
          <button onClick={()=>{onMembers();setMenuOpen(false);}} className="nav-btn" style={{background:(view==="members"||view==="member")?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>👥 Lads</button>
          <button onClick={()=>{onHof();setMenuOpen(false);}} className="nav-btn" style={{background:view==="hof"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>🏅 Hall of Fame</button>
          <button onClick={()=>{onTeams();setMenuOpen(false);}} className="nav-btn" style={{background:view==="teams"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>🎲 Team Creator</button>
          <button onClick={()=>{onTimer();setMenuOpen(false);}} className="nav-btn" style={{background:view==="timer"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>⏱ Timer</button>
          <button onClick={saraJayUnlocked?()=>{onSaraJay();setMenuOpen(false);}:undefined} className="nav-btn" style={{background:view==="sarajay"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:saraJayUnlocked?"var(--amber2)":"var(--muted)",padding:"10px 14px",cursor:saraJayUnlocked?"pointer":"not-allowed",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left",opacity:saraJayUnlocked?1:.55}}>{saraJayUnlocked?"🤖 Sara Jay or JAI":"🔒 ???"}</button>
          {can.announce(currentUser)&&<button onClick={()=>{onAnnounce();setMenuOpen(false);}} className="nav-btn" style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>📢 Announce</button>}
          {can.manageUsers(currentUser)&&<button onClick={()=>{onAdmin();setMenuOpen(false);}} className="nav-btn" style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:8}}>⚙ Admin{pendingCount>0&&<span style={{background:"var(--red)",color:"#fff",borderRadius:"50%",width:20,height:20,fontSize:".7rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{pendingCount}</span>}</button>}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"8px 14px"}}>
            <div onClick={()=>{onProfile();setMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",flex:1,minWidth:0}}><Avatar name={currentUser.username} size={26} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/><span style={{fontSize:".88rem",color:"var(--cream)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser.display_name||currentUser.username}</span><RoleBadge role={currentUser.role}/></div>
            <button onClick={()=>{onLogout();setMenuOpen(false);}} className="nav-logout" style={{background:"transparent",border:"1px solid rgba(224,85,85,.3)",borderRadius:8,color:"var(--red)",padding:"6px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600,transition:"all .18s ease",flexShrink:0,marginLeft:8}}>Uitloggen</button>
          </div>
        </div>
      )}
    </nav>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
const AdminPanel = ({users,onUpdateUsers,onDeleteUser,onClose,saraJayUnlocked,onToggleSaraJay}) => {
  const [tab,setTab]=useState("pending");
  const pending=users.filter(u=>u.role==="pending");
  const approved=users.filter(u=>u.role!=="pending");
  const setRole=(id,newBaseRole)=>onUpdateUsers(users.map(u=>{
    if(u.id!==id)return u;
    const keepOrg=hasOrg(u);
    let role=newBaseRole;
    if(keepOrg&&newBaseRole==="admin")role="admin+org";
    if(keepOrg&&(newBaseRole==="lad"||newBaseRole==="member"))role="org";
    return{...u,role};
  }));
  const toggleOrg=id=>onUpdateUsers(users.map(u=>{
    if(u.id!==id)return u;
    const wasOrg=hasOrg(u);const isAdm=hasAdmin(u);
    const role=wasOrg?(isAdm?"admin":"lad"):(isAdm?"admin+org":"org");
    return{...u,role};
  }));
  const reject=id=>onDeleteUser(id);
  const remove=id=>{if(window.confirm("Remove this user?"))onDeleteUser(id);};
  const tabBtn=(t,label)=>(
    <button key={t} onClick={()=>setTab(t)}
      onMouseEnter={e=>{if(tab!==t){const el=e.currentTarget;el._sc=el.style.color;el._sb=el.style.background;el.style.color="var(--amber)";el.style.background="rgba(232,148,58,.06)";}}}
      onMouseLeave={e=>{const el=e.currentTarget;el.style.color=el._sc??"";el.style.background=el._sb??"";}}
      style={{background:"none",border:"none",borderBottom:tab===t?"2px solid var(--amber)":"2px solid transparent",color:tab===t?"var(--amber2)":"var(--muted)",cursor:"pointer",padding:"7px 16px",fontFamily:"var(--font-b)",fontWeight:tab===t?600:400,fontSize:".85rem",marginBottom:-1,transition:"color .15s,background .15s",borderRadius:"6px 6px 0 0"}}>
      {label}{t==="pending"&&pending.length>0&&<span style={{background:"var(--red)",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:".68rem",marginLeft:6}}>{pending.length}</span>}
    </button>
  );
  return(
    <Modal onClose={onClose} maxWidth={600}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}>
        <H style={{marginBottom:0}}>⚙ Admin Panel</H>
        <Btn onClick={onClose} variant="ghost" size="sm">✕ Close</Btn>
      </div>
      {pending.length>0&&<div style={{background:"rgba(232,148,58,.1)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:"10px 14px",marginBottom:"1.2rem",display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:"1.2rem"}}>⏳</span><span style={{color:"var(--amber2)",fontSize:".88rem",fontWeight:600}}>{pending.length} pending approval{pending.length>1?"s":""}</span></div>}
      <div style={{display:"flex",gap:".3rem",borderBottom:"1px solid var(--border)",marginBottom:"1.2rem"}}>
        {tabBtn("pending","Pending")}{tabBtn("users","All Users")}{tabBtn("features","🎮 Features")}
      </div>
      {tab==="pending"&&<div style={{display:"grid",gap:".8rem"}}>
        {pending.length===0&&<div style={{color:"var(--muted)",fontSize:".88rem",textAlign:"center",padding:"2rem"}}>No pending requests 🎉</div>}
        {pending.map(u=>(
          <div key={u.id} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:"1rem 1.1rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
            <Avatar name={u.username} size={36} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
            <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".95rem"}}>{u.username}</div><div style={{color:"var(--muted)",fontSize:".75rem"}}>Requested {new Date(u.joined_at).toLocaleDateString("nl-NL")}</div></div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <Btn onClick={()=>setRole(u.id,"lad")} variant="success" size="sm">✓ Lad</Btn>
              <Btn onClick={()=>onUpdateUsers(users.map(u2=>u2.id===u.id?{...u2,role:"org"}:u2))} variant="ghost" size="sm" style={{color:"var(--purple)",borderColor:"rgba(155,127,232,.4)",fontSize:".73rem"}}>★ Org</Btn>
              <Btn onClick={()=>setRole(u.id,"admin")} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"var(--border2)",fontSize:".73rem"}}>★ Admin</Btn>
              <Btn onClick={()=>reject(u.id)} variant="danger" size="sm">✕</Btn>
            </div>
          </div>
        ))}
      </div>}
      {tab==="features"&&<div style={{display:"grid",gap:"1rem"}}>
        <div style={{fontSize:".75rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".2rem"}}>Mini Games</div>
        <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"1rem 1.2rem",display:"flex",alignItems:"center",gap:"1rem"}}>
          <div style={{fontSize:"2rem"}}>🤖</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600,fontSize:".95rem",color:"var(--cream)"}}>Sara Jay or Sara JAI</div>
            <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:2}}>Real vs AI guessing game · Streak-based arcade</div>
          </div>
          <button onClick={onToggleSaraJay}
            style={{padding:"8px 18px",borderRadius:50,border:"none",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:700,fontSize:".82rem",transition:"all .18s ease",
              background:saraJayUnlocked?"rgba(76,175,125,.18)":"rgba(232,148,58,.12)",
              color:saraJayUnlocked?"var(--green)":"var(--amber)",
              boxShadow:saraJayUnlocked?"0 0 0 1.5px rgba(76,175,125,.4)":"0 0 0 1.5px rgba(232,148,58,.3)"}}>
            {saraJayUnlocked?"🔓 Live":"🔒 Locked"}
          </button>
        </div>
      </div>}
      {tab==="users"&&<div style={{display:"grid",gap:".7rem"}}>
        {approved.map(u=>(
          <div key={u.id} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
            <Avatar name={u.username} size={32} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontWeight:600,fontSize:".92rem"}}>{u.username}</span><RoleBadge role={u.role}/></div>
              <div style={{color:"var(--muted)",fontSize:".73rem",marginTop:2}}>Joined {new Date(u.joined_at).toLocaleDateString("nl-NL")}</div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {hasAdmin(u)
                ?<Btn onClick={()=>setRole(u.id,"lad")} variant="ghost" size="sm" style={{fontSize:".73rem"}}>↓ Lad</Btn>
                :<Btn onClick={()=>setRole(u.id,"admin")} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"rgba(232,148,58,.4)",fontSize:".73rem"}}>→ Admin</Btn>}
              <Btn onClick={()=>toggleOrg(u.id)} variant="ghost" size="sm" style={{color:hasOrg(u)?"var(--purple)":"var(--muted2)",borderColor:hasOrg(u)?"rgba(155,127,232,.45)":"var(--border)",fontSize:".73rem"}}>
                {hasOrg(u)?"★ Org":"☆ Org"}
              </Btn>
              <Btn onClick={()=>remove(u.id)} variant="danger" size="sm" style={{fontSize:".73rem"}}>✕</Btn>
            </div>
          </div>
        ))}
      </div>}
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// HALL OF FAME
// ─────────────────────────────────────────────────────────────────────────────
const HallOfFame = ({events,users=[]}) => {
  const allAttendees = {};
  const allWins = {};
  let totalEvents = events.length;

  events.forEach(evt=>{
    evt.attendees.forEach(a=>{
      if(!allAttendees[a.name]) allAttendees[a.name]={name:a.name,attended:0,missed:0,events:[]};
      if(["went","going"].includes(a.status)){allAttendees[a.name].attended++;allAttendees[a.name].events.push(evt.id);}
      else if(["absent","not coming"].includes(a.status)) allAttendees[a.name].missed++;
    });
    (evt.winners||[]).forEach(w=>{
      if(!allWins[w.winner]) allWins[w.winner]={name:w.winner,count:0,awards:[]};
      allWins[w.winner].count++;
      allWins[w.winner].awards.push({...w,eventName:evt.name,eventDate:evt.date});
    });
  });

  const attendance = Object.values(allAttendees).sort((a,b)=>b.attended-a.attended);
  const winners = Object.values(allWins).sort((a,b)=>b.count-a.count);
  const perfect = attendance.filter(a=>a.attended===totalEvents&&totalEvents>0);

  // Quiz leaderboard across all events
  const quizScores = {};
  events.forEach(evt=>{
    (evt.quizzes||[]).filter(q=>q.status==="finished").forEach(quiz=>{
      Object.entries(quiz.scores||{}).forEach(([name,score])=>{
        if(!quizScores[name]) quizScores[name]={name,total:0,quizzes:0};
        quizScores[name].total+=score;
        quizScores[name].quizzes++;
      });
    });
  });
  const quizBoard = Object.values(quizScores).sort((a,b)=>b.total-a.total);

  const podiumColors = ["var(--gold)","var(--muted)","#cd7f32"];
  const podiumEmojis = ["🥇","🥈","🥉"];

  return(
    <div style={{display:"grid",gap:"2rem"}}>
      <div className="fu" style={{textAlign:"center",padding:"1.5rem 0 0"}}>
        <div style={{fontSize:"3rem",marginBottom:".4rem"}}>🏅</div>
        <H size="2.5rem" style={{marginBottom:".3rem"}}>Hall of Fame</H>
        <p style={{color:"var(--muted)",fontSize:".88rem"}}>{totalEvents} editions · The legends live here</p>
      </div>

      {/* Perfect attendance */}
      {perfect.length>0&&(
        <Card className="fu1" style={{background:"linear-gradient(135deg,#1f1609,#2e1e0a)",borderColor:"var(--border2)",textAlign:"center",padding:"2rem"}}>
          <div style={{fontSize:"2rem",marginBottom:".5rem"}}>🐐</div>
          <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber2)",marginBottom:".8rem"}}>Perfect Attendance</div>
          <div style={{display:"flex",justifyContent:"center",gap:"1rem",flexWrap:"wrap"}}>
            {perfect.map((p,i)=>(
              <div key={p.name} style={{display:"flex",alignItems:"center",gap:8}}>
                <Avatar name={p.name} size={38} {...getUA(p.name,users)}/>
                <div>
                  <div style={{fontWeight:600,fontSize:".95rem"}}>{getDisplayName(p.name,users)}</div>
                  <div style={{fontSize:".72rem",color:"var(--amber)"}}>All {totalEvents} events</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Attendance podium */}
      <div className="fu2">
        <H>📅 Attendance Record</H>
        {attendance.slice(0,3).length>0&&(
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:"1rem",marginBottom:"1.5rem"}}>
            {[attendance[1],attendance[0],attendance[2]].filter(Boolean).map((p,i)=>{
              const realIdx=i===0?1:i===1?0:2;
              const h=[120,160,90][realIdx];
              return(
                <div key={p.name} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                  <Avatar name={p.name} size={40} {...getUA(p.name,users)}/>
                  <div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(p.name,users)}</div>
                  <div style={{fontSize:"1.2rem"}}>{podiumEmojis[realIdx]}</div>
                  <div style={{width:80,height:h,background:podiumColors[realIdx]+"33",border:`2px solid ${podiumColors[realIdx]}`,borderRadius:"8px 8px 0 0",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"1.4rem",color:podiumColors[realIdx],fontWeight:900}}>{p.attended}</div>
                    <div style={{fontSize:".65rem",color:"var(--muted)"}}>events</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{display:"grid",gap:".6rem"}}>
          {attendance.map((a,i)=>(
            <div key={a.name} style={{display:"flex",alignItems:"center",gap:"1rem",background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",border:"1px solid var(--border)"}}>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
              <Avatar name={a.name} size={32} {...getUA(a.name,users)}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(a.name,users)}</div>
                <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>
                  {a.attended} attended · {a.missed} missed
                  {a.attended===totalEvents&&totalEvents>0&&<span style={{color:"var(--amber)",marginLeft:6}}>🐐 Perfect</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:3}}>
                {events.map(evt=>{
                  const att=evt.attendees.find(x=>x.name===a.name);
                  const s=att?.status;
                  const color=["went","going"].includes(s)?"var(--green)":["absent","not coming"].includes(s)?"var(--red)":"var(--muted2)";
                  return<div key={evt.id} title={`${evt.name}: ${s||"?"}`} style={{width:8,height:8,borderRadius:"50%",background:color}}/>;
                })}
              </div>
              <div style={{background:"var(--bg3)",borderRadius:8,padding:"4px 10px",textAlign:"center",minWidth:44}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber)",lineHeight:1}}>{Math.round(a.attended/Math.max(totalEvents,1)*100)}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Awards leaderboard */}
      {winners.length>0&&(
        <div className="fu3">
          <H>🏆 Most Awards Won</H>
          <div style={{display:"grid",gap:".6rem"}}>
            {winners.map((w,i)=>(
              <div key={w.name} style={{background:"var(--bg2)",borderRadius:"var(--radius-sm)",border:"1px solid var(--border)",overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:"1rem",padding:".9rem 1.1rem",cursor:"pointer"}} onClick={e=>{const d=e.currentTarget.nextSibling;d.style.display=d.style.display==="none"?"block":"none";}}>
                  <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
                  <Avatar name={w.name} size={32} {...getUA(w.name,users)}/>
                  <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(w.name,users)}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{w.count} award{w.count!==1?"s":""}</div></div>
                  <div style={{background:"var(--gold)22",border:"1px solid var(--gold)44",borderRadius:8,padding:"4px 12px",fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--gold)"}}>{w.count}</div>
                </div>
                <div style={{display:"none",padding:"0 1.1rem 1rem",borderTop:"1px solid var(--border)"}}>
                  <div style={{paddingTop:".8rem",display:"grid",gap:".5rem"}}>
                    {w.awards.map((a,ai)=>(
                      <div key={ai} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                        <span style={{fontSize:"1rem"}}>{a.icon||"🏆"}</span>
                        <div><div style={{fontSize:".83rem",color:"var(--cream)",fontWeight:500}}>{a.category}</div><div style={{fontSize:".73rem",color:"var(--muted)"}}>{a.eventName} · {a.detail}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quiz leaderboard */}
      {quizBoard.length>0&&(
        <div className="fu3">
          <H>🧠 Quiz All-Time Scores</H>
          <div style={{display:"grid",gap:".6rem"}}>
            {quizBoard.map((p,i)=>(
              <div key={p.name} style={{display:"flex",alignItems:"center",gap:"1rem",background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",border:"1px solid var(--border)"}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
                <Avatar name={p.name} size={32} {...getUA(p.name,users)}/>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(p.name,users)}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{p.quizzes} quiz{p.quizzes!==1?"zes":""} played</div></div>
                <div style={{background:"rgba(91,155,213,.15)",border:"1px solid rgba(91,155,213,.3)",borderRadius:8,padding:"4px 12px",fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--blue)"}}>{p.total}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {events.length===0&&<Card style={{textAlign:"center",padding:"4rem",color:"var(--muted)"}}>No events yet — the Hall of Fame will fill up as you play!</Card>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────────────────────────────────────────
const MemberCard=({user,events,onClick,isMe})=>{
  const stats=computeMemberStats(user.username,events);
  const hasPhoto=!!user.photo_url;
  const animal=ANIMALS[(user.animal_avatar??user.avatar??0)%ANIMALS.length];
  return(
    <div onClick={onClick} style={{position:"relative",aspectRatio:"1/1",borderRadius:"var(--radius)",overflow:"hidden",cursor:"pointer",border:"1px solid var(--border)",background:hasPhoto?"var(--bg2)":animal.bg,transition:"transform .2s,border-color .2s",flexShrink:0}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.borderColor="var(--border2)"}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.borderColor=""}}>
      {hasPhoto
        ?<img src={user.photo_url} alt={user.username} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
        :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"clamp(3rem,10vw,5rem)"}}>{animal.emoji}</div>
      }
      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent,rgba(0,0,0,.88) 60%)",padding:"2rem .75rem .75rem"}}>
        <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"#fff",lineHeight:1.2,marginBottom:5}}>{user.display_name||user.username}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <RoleBadge role={user.role}/>
          {stats.total>0&&<span style={{fontSize:".67rem",color:"rgba(255,255,255,.7)"}}>🍺 {stats.total}×</span>}
          {stats.quizWins>0&&<span style={{fontSize:".67rem",color:"rgba(255,255,255,.7)"}}>🧠 {stats.quizWins}×</span>}
          {stats.mentions.length>0&&<span style={{fontSize:".67rem",color:"rgba(255,255,255,.7)"}}>🏆 {stats.mentions.length}</span>}
        </div>
      </div>
      {isMe&&<div style={{position:"absolute",top:8,right:8,background:"var(--amber)",borderRadius:6,padding:"2px 8px",fontSize:".62rem",fontWeight:700,color:"#0f0b07",letterSpacing:".04em"}}>JIJ</div>}
    </div>
  );
};

const MembersPage=({users,events,onOpenMember,currentUser})=>{
  const members=users.filter(u=>u.role!=="pending").sort((a,b)=>{
    if(hasAdmin(a)&&!hasAdmin(b))return -1;
    if(hasAdmin(b)&&!hasAdmin(a))return 1;
    return new Date(a.joined_at)-new Date(b.joined_at);
  });
  return(
    <div>
      <H style={{marginBottom:"1.5rem"}}>👥 Lads</H>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:"1rem"}}>
        {members.map(u=><MemberCard key={u.id} user={u} events={events} onClick={()=>onOpenMember(u.id)} isMe={u.id===currentUser.id}/>)}
      </div>
    </div>
  );
};

const MemberProfile=({user,events,currentUser,onEdit})=>{
  const stats=computeMemberStats(user.username,events);
  const hasPhoto=!!user.photo_url;
  const animal=ANIMALS[(user.animal_avatar??user.avatar??0)%ANIMALS.length];
  const isMe=user.id===currentUser.id;
  return(
    <div style={{display:"grid",gap:"1.5rem"}}>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{height:240,position:"relative",background:hasPhoto?"var(--bg2)":animal.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {hasPhoto
            ?<img src={user.photo_url} alt={user.username} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            :<div style={{fontSize:"7rem",lineHeight:1}}>{animal.emoji}</div>
          }
          <div style={{position:"absolute",inset:0,background:"linear-gradient(transparent 35%,rgba(0,0,0,.75))"}}/>
          <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"1.2rem 1.5rem"}}>
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div>
                <H size="1.7rem" style={{marginBottom:3,color:"#fff"}}>{user.display_name||user.username}</H>
                {user.display_name&&<div style={{color:"rgba(255,255,255,.55)",fontSize:".82rem"}}>@{user.username}</div>}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <RoleBadge role={user.role}/>
                {user.age&&<Tag color="var(--muted)">{user.age} jaar</Tag>}
                {isMe&&<Btn onClick={onEdit} size="sm" variant="ghost">✎ Bewerken</Btn>}
              </div>
            </div>
          </div>
        </div>
        {user.bio&&<div style={{padding:"1rem 1.5rem",color:"var(--muted)",fontSize:".88rem",fontStyle:"italic",borderTop:"1px solid var(--border)"}}>&ldquo;{user.bio}&rdquo;</div>}
      </Card>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:"1rem"}}>
        {[["🍺",stats.mensdays,"Mensdagen"],["🏕️",stats.weekends,"Weekenden"],["🧠",stats.quizWins,"Quiz gewonnen"],["🏆",stats.mentions.length,"Awards"]].map(([icon,val,label])=>(
          <Card key={label} style={{textAlign:"center",padding:"1.2rem"}}>
            <div style={{fontSize:"1.5rem",marginBottom:4}}>{icon}</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"2rem",color:"var(--amber)",lineHeight:1}}>{val}</div>
            <div style={{fontSize:".73rem",color:"var(--muted)",marginTop:5}}>{label}</div>
          </Card>
        ))}
      </div>

      {stats.mentions.length>0&&(
        <Card>
          <H size="1rem" style={{marginBottom:"1rem"}}>🏆 Awards</H>
          <div style={{display:"grid",gap:".75rem"}}>
            {stats.mentions.map((m,i)=>(
              <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <span style={{fontSize:"1.4rem"}}>{m.icon||"🏆"}</span>
                <div>
                  <div style={{fontWeight:600,fontSize:".9rem",color:"var(--cream)"}}>{m.category}</div>
                  <div style={{fontSize:".78rem",color:"var(--muted)",marginTop:2}}>{m.eventName}{m.detail&&` · ${m.detail}`}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{fontSize:".75rem",color:"var(--muted2)",textAlign:"center"}}>
        Lid sinds {user.joined_at?new Date(user.joined_at).toLocaleDateString("nl-NL",{day:"numeric",month:"long",year:"numeric"}):"onbekend"}
      </div>
    </div>
  );
};

const EditProfileModal=({user,onSave,onClose})=>{
  const [displayName,setDisplayName]=useState(user.display_name||"");
  const [age,setAge]=useState(user.age||"");
  const [bio,setBio]=useState(user.bio||"");
  const [animalAvatar,setAnimalAvatar]=useState(user.animal_avatar??user.avatar??0);
  const [photoUrl,setPhotoUrl]=useState(user.photo_url||"");
  const [uploading,setUploading]=useState(false);
  const [err,setErr]=useState("");
  const fileRef=useRef();
  const handleUpload=async e=>{
    const file=e.target.files[0];if(!file)return;
    setUploading(true);setErr("");
    const path=`profiles/${user.id}/${Date.now()}`;
    const{data,error}=await supabase.storage.from("profile-photos").upload(path,file,{upsert:true});
    if(error){setErr("Upload mislukt: "+error.message);setUploading(false);return;}
    const{data:{publicUrl}}=supabase.storage.from("profile-photos").getPublicUrl(data.path);
    setPhotoUrl(publicUrl);setUploading(false);
  };
  const save=()=>onSave({display_name:displayName.trim()||null,age:age?parseInt(age):null,bio:bio.trim()||null,animal_avatar:animalAvatar,photo_url:photoUrl||null});
  return(
    <Modal onClose={onClose} maxWidth={460}>
      <H>Profiel bewerken</H>
      <div style={{display:"grid",gap:"1.1rem"}}>
        <div style={{textAlign:"center"}}>
          <div style={{width:100,height:100,borderRadius:"50%",margin:"0 auto .8rem",background:photoUrl?"var(--bg3)":ANIMALS[animalAvatar%10].bg,overflow:"hidden",border:"3px solid var(--border2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"3rem",cursor:"pointer"}} onClick={()=>fileRef.current.click()}>
            {photoUrl?<img src={photoUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:ANIMALS[animalAvatar%10].emoji}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleUpload}/>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            <Btn onClick={()=>fileRef.current.click()} variant="ghost" size="sm" disabled={uploading}>{uploading?"Uploaden…":"📷 Foto uploaden"}</Btn>
            {photoUrl&&<Btn onClick={()=>setPhotoUrl("")} variant="ghost" size="sm" style={{color:"var(--red)"}}>Verwijderen</Btn>}
          </div>
          {err&&<div style={{color:"var(--red)",fontSize:".78rem",marginTop:6}}>{err}</div>}
        </div>
        {!photoUrl&&(
          <div>
            <Lbl>Kies je dier</Lbl>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
              {ANIMALS.map((a,i)=>(
                <div key={i} onClick={()=>setAnimalAvatar(i)} title={a.name} style={{aspectRatio:"1",borderRadius:10,background:a.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",border:animalAvatar===i?"2px solid var(--amber)":"2px solid transparent",fontSize:"1.8rem",transition:"border-color .15s"}}>
                  {a.emoji}
                </div>
              ))}
            </div>
          </div>
        )}
        <div><Lbl>Weergavenaam</Lbl><Inp value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder={user.username}/></div>
        <div><Lbl>Leeftijd</Lbl><Inp value={age} onChange={e=>setAge(e.target.value.replace(/\D/g,""))} placeholder="bijv. 28"/></div>
        <div><Lbl>Bio / tagline</Lbl><Inp value={bio} onChange={e=>setBio(e.target.value)} placeholder="Korte beschrijving…" multiline rows={2}/></div>
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <Btn onClick={save}>Opslaan</Btn>
          <Btn onClick={onClose} variant="ghost">Annuleren</Btn>
        </div>
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────────────────────
const Home = ({events,onOpen,onNew,currentUser,users=[],onTeams,onTimer,onSaraJay,saraJayUnlocked}) => {
  const isMobile=useIsMobile();
  const isOver=e=>e.archived||new Date(`${e.end_date||e.date}T${e.end_time||"23:59"}:00`)<new Date();
  const upcoming=events.filter(e=>!isOver(e)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const past=events.filter(e=>isOver(e)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const nextEvt=upcoming[0];
  const goingLads=nextEvt?nextEvt.attendees.filter(a=>a.status==="going"):[];
  const totalEditions=events.length;
  const kretjes=events.reduce((s,e)=>s+(e.kretjes||0),0);
  const hypers=["No excuses. No mercy. Just lads.","The brotherhood doesn't sleep.","Every year. No matter what.","Legends are made here.","It's that time again."];
  const hype=hypers[(new Date().getMonth()+new Date().getDate())%hypers.length];
  return(
    <div style={{display:"grid",gap:"2.5rem"}}>

      {/* ── HERO ── */}
      <div className="fu" style={{textAlign:"center",padding:isMobile?"1.2rem 0 .3rem":"3rem 0 .5rem",position:"relative"}}>
        <div style={{position:"absolute",inset:0,background:"var(--hero-glow)",pointerEvents:"none"}}/>
        <div className="float" style={{fontSize:isMobile?"2.8rem":"4.5rem",marginBottom:isMobile?".2rem":".5rem",display:"inline-block"}}>🍺</div>
        <h1 style={{fontFamily:"var(--font-h)",fontStyle:"italic",fontSize:isMobile?"2.6rem":"clamp(3rem,10vw,6rem)",color:"var(--amber2)",lineHeight:.9,letterSpacing:"-.02em",marginBottom:isMobile?".4rem":".6rem"}}>MENSDAY</h1>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:12,marginBottom:isMobile?".8rem":"1.2rem"}}>
          <div style={{height:1,flex:1,maxWidth:60,background:"linear-gradient(to right,transparent,var(--border2))"}}/>
          <span style={{color:"var(--muted)",fontSize:".72rem",letterSpacing:".25em",textTransform:"uppercase"}}>{hype}</span>
          <div style={{height:1,flex:1,maxWidth:60,background:"linear-gradient(to left,transparent,var(--border2))"}}/>
        </div>
        {totalEditions>0&&(
          <div style={{display:"inline-flex",gap:isMobile?".8rem":"2rem",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:50,padding:isMobile?".45rem 1.2rem":".6rem 2rem",flexWrap:"nowrap",justifyContent:"center"}}>
            {[
              [goingLads.length,"Lads In 🔥"],
              [totalEditions,"Editions 🏆"],
              [past.length,"Legendary 💀"],
              [kretjes,"Kretjes 🍺"],
            ].map(([v,l])=>(
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:isMobile?"1.15rem":"1.6rem",color:"var(--amber)",lineHeight:1}}>{v}</div>
                <div style={{fontSize:isMobile?".55rem":".62rem",color:"var(--muted)",letterSpacing:".1em",textTransform:"uppercase",marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        )}
        {goingLads.length>0&&(
          <div style={{marginTop:"1.2rem",display:"flex",justifyContent:"center",alignItems:"center",gap:8}}>
            <div style={{display:"flex"}}>{goingLads.slice(0,7).map((a,i)=><div key={i} style={{marginLeft:i===0?0:-10,borderRadius:"50%",border:"2px solid var(--bg)"}}><Avatar name={a.name} size={30} {...getUA(a.name,users)}/></div>)}</div>
            <span style={{fontSize:".8rem",color:"var(--muted)"}}>
              {goingLads.slice(0,3).map(a=>a.name).join(", ")}{goingLads.length>3?` +${goingLads.length-3} more`:""} confirmed
            </span>
          </div>
        )}
      </div>

      {/* ── UPCOMING ── */}
      <div className="fu1">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>🔥 Next Mission</H>
          {can.editEvent(currentUser)&&<Btn onClick={onNew} size="sm">+ New Event</Btn>}
        </div>
        {upcoming.length===0&&(
          <Card style={{textAlign:"center",padding:"3.5rem 2rem",background:"linear-gradient(135deg,var(--bg2),var(--bg3))"}}>
            <div style={{fontSize:"3rem",marginBottom:".8rem"}}>👀</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1.3rem",color:"var(--amber2)",marginBottom:".5rem"}}>The next edition is being planned...</div>
            <div style={{color:"var(--muted)",fontSize:".88rem"}}>Admin is cooking something up. Stay on standby, lad.</div>
          </Card>
        )}
        <div style={{display:"grid",gap:"1rem"}}>{upcoming.map(e=><EventCard key={e.id} evt={e} onOpen={onOpen} currentUser={currentUser} users={users}/>)}</div>
      </div>

      {/* ── TOOLS ── */}
      <div className="fu2">
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>🛠 Tools</H>
          <div style={{height:1,flex:1,background:"var(--border)"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"1rem"}}>
          {[
            {icon:"🎲",title:"Team Creator",desc:"Schud willekeurige teams voor je activiteiten",onClick:onTeams,color:"var(--amber)"},
            {icon:"⏱",title:"Timer",desc:"Afteltimer voor spelletjes en activiteiten",onClick:onTimer,color:"var(--blue)"},
            {icon:saraJayUnlocked?"🤖":"🔒",title:"Sara Jay or JAI",desc:saraJayUnlocked?"Echt of AI? Één fout = game over. Bouw je streak.":"Binnenkort beschikbaar... 👀",onClick:saraJayUnlocked?onSaraJay:undefined,color:saraJayUnlocked?"var(--purple)":"var(--muted)",isLocked:!saraJayUnlocked},
          ].map(({icon,title,desc,onClick,color,isLocked})=>(
            <div key={title} onClick={onClick}
              onMouseEnter={e=>{if(!isLocked){e.currentTarget.style.borderColor=color;e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 8px 28px ${color}22`;}}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}
              style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.5rem 1.4rem",cursor:isLocked?"not-allowed":"pointer",transition:"all .2s cubic-bezier(.4,0,.2,1)",display:"flex",flexDirection:"column",gap:".65rem",opacity:isLocked?.65:1}}>
              <div style={{fontSize:"2.2rem",lineHeight:1}}>{icon}</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:color,lineHeight:1.2}}>{isLocked?"???" : title}</div>
              <div style={{fontSize:".82rem",color:"var(--muted)",lineHeight:1.5}}>{desc}</div>
              <div style={{marginTop:"auto",paddingTop:".5rem",fontSize:".75rem",color:color,opacity:.7,fontWeight:600,letterSpacing:".04em"}}>{isLocked?"Binnenkort beschikbaar":"Openen →"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ARCHIVES ── */}
      {past.length>0&&(
        <div className="fu3">
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1rem"}}>
            <H style={{marginBottom:0}}>📚 The Archives</H>
            <div style={{height:1,flex:1,background:"var(--border)"}}/>
            <span style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".1em"}}>{past.length} editions</span>
          </div>
          <div style={{display:"grid",gap:".7rem"}}>{past.map(e=><EventCard key={e.id} evt={e} onOpen={onOpen} compact currentUser={currentUser} users={users}/>)}</div>
        </div>
      )}
    </div>
  );
};

const EventCard = ({evt,onOpen,compact=false,currentUser,users=[]}) => {
  const going=evt.attendees.filter(a=>["went","going"].includes(a.status)).length;
  const countdown=useCountdown(evt.date,evt.start_time);
  const myStatus=evt.attendees.find(a=>a.name.toLowerCase()===currentUser?.username.toLowerCase())?.status;
  const colorOf=s=>statusMap[s]?.color??"var(--muted)";
  const isMobile=useIsMobile();
  const myStatusColor=myStatus?colorOf(myStatus):"var(--muted)";
  const _now=new Date();
  const _start=new Date(`${evt.date}T${evt.start_time||"00:00"}:00`);
  const _end=new Date(`${evt.end_date||evt.date}T${evt.end_time||"23:59"}:00`);
  const isLive=!evt.archived&&_now>=_start&&_now<=_end;
  const isUpcoming=!evt.archived&&!countdown.past&&!isLive;

  if(compact) return(
    <div className="event-card-upcoming" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",cursor:"pointer",position:"relative",overflow:"hidden",display:"flex",alignItems:"center",gap:"1rem"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--border2)"}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=""}}
      onClick={()=>onOpen(evt.id)}>
      <div style={{fontFamily:"var(--font-h)",fontSize:"1.5rem",color:"var(--muted2)",opacity:.4,minWidth:44,textAlign:"center"}}>{new Date(evt.date).getFullYear()}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"var(--amber2)"}}>{evt.name}</div>
        <div style={{color:"var(--muted)",fontSize:".73rem",marginTop:2}}>
          {formatEventDateRange(evt.date,evt.end_date,{weekday:false,year:false})}
          {evt.location&&evt.location!=="TBD"&&` · ${evt.location}`}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        {evt.winners?.length>0&&<span style={{fontSize:".72rem",color:"var(--gold)"}}>🏆 {evt.winners.length}</span>}
        <span style={{fontSize:".73rem",color:"var(--muted)"}}>{going} attended</span>
        <div style={{color:"var(--muted)",fontSize:".8rem",opacity:.4}}>›</div>
      </div>
    </div>
  );

  return(
    <div className={`event-card-upcoming${isLive?" live-pulse":isUpcoming?" glow-pulse":""}`}
      style={{background:isLive?"linear-gradient(135deg,#081a0e,#0f2214,#081a0e)":isUpcoming?"linear-gradient(135deg,#1a1008,#221608,#1a1008)":"var(--bg2)",border:`1px solid ${isLive?"rgba(76,175,125,.45)":isUpcoming?"rgba(232,148,58,.3)":"var(--border)"}`,borderRadius:"var(--radius)",cursor:"pointer",position:"relative",overflow:"hidden"}}
      onClick={()=>onOpen(evt.id)}>

      {/* Top accent bar */}
      {(isUpcoming||isLive)&&<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:isLive?"linear-gradient(90deg,var(--green),#52c41a,var(--green),#52c41a)":"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber))",backgroundSize:"200% 100%",animation:"goldShimmer 3s linear infinite"}}/>}

      {/* Main content */}
      <div style={{padding:"1.4rem"}}>
        <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:"1.2rem",alignItems:"flex-start"}}>
          <div style={{flex:1,minWidth:0,width:"100%"}}>
            {/* Tags */}
            <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
              <Tag color={evt.type==="weekend"?"var(--purple)":"var(--amber)"}>{evt.type==="weekend"?"🏕️ Weekend":"📅 Day Event"}</Tag>
              {evt.theme&&<Tag color="var(--gold)">✨ {evt.theme}</Tag>}
              {isLive&&(
                <span style={{background:"rgba(76,175,125,.18)",color:"var(--green)",border:"1px solid rgba(76,175,125,.45)",borderRadius:6,padding:"3px 10px",fontSize:".72rem",fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 1.1s ease-in-out infinite"}}/>
                  HAPPENING NOW
                </span>
              )}
              {myStatus&&(
                <span style={{background:myStatusColor+"22",color:myStatusColor,border:`1px solid ${myStatusColor}44`,borderRadius:6,padding:"3px 10px",fontSize:".72rem",fontWeight:700}}>
                  {myStatus==="going"?"🔒 Locked In":myStatus==="maybe"?"🤔 Maybe":myStatus==="not coming"?"❌ Can't Make It":statusMap[myStatus]?.label}
                </span>
              )}
            </div>

            {/* Event name */}
            <div style={{fontFamily:"var(--font-h)",fontSize:"1.5rem",color:"var(--amber2)",marginBottom:5,lineHeight:1.1}}>{evt.name}</div>

            {/* Date / location */}
            <div style={{color:"var(--muted)",fontSize:".82rem",marginBottom:4}}>
              {formatEventDateRange(evt.date,evt.end_date)}
              {evt.start_time&&<span style={{color:"var(--amber)",marginLeft:6}}>⏰ {evt.start_time}{evt.end_time&&`–${evt.end_time}`}</span>}
              {evt.location&&evt.location!=="TBD"&&<span style={{marginLeft:6}}>· 📍 {evt.location}</span>}
            </div>

            {/* Lads going */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
              <div style={{display:"flex"}}>{evt.attendees.filter(a=>["went","going"].includes(a.status)).slice(0,6).map((a,i)=><div key={i} style={{marginLeft:i===0?0:-8,borderRadius:"50%",border:"2px solid var(--bg2)"}}><Avatar name={a.name} size={24} {...getUA(a.name,users)}/></div>)}</div>
              {going>0&&<span style={{fontSize:".75rem",color:"var(--muted)"}}><strong style={{color:"var(--cream)"}}>{going}</strong> lad{going!==1?"s":""} {evt.archived?"attended":"in"}</span>}
            </div>
          </div>

          {/* Right: live / countdown / year */}
          <div style={{flexShrink:0,textAlign:"center",width:isMobile?"100%":"auto"}}>
          {isLive?(
            <div style={{background:"rgba(76,175,125,.08)",border:"1px solid rgba(76,175,125,.3)",borderRadius:12,padding:isMobile?"1rem 1.4rem":".9rem 1.2rem",display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 1.1s ease-in-out infinite"}}/>
                <span style={{fontSize:".6rem",color:"var(--green)",letterSpacing:".18em",textTransform:"uppercase",fontWeight:700}}>Live nu</span>
              </div>
              <div style={{fontFamily:"var(--font-h)",fontSize:isMobile?"3rem":"2.2rem",lineHeight:1,color:"var(--green)"}}>⚡</div>
              {evt.end_time&&<div style={{fontSize:".65rem",color:"rgba(76,175,125,.65)",letterSpacing:".08em"}}>tot {evt.end_time}</div>}
            </div>
          ):isUpcoming?(
            <div style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.2)",borderRadius:12,padding:isMobile?"1rem 1.2rem":".8rem .9rem"}}>
              <div style={{fontSize:".6rem",color:"var(--amber)",letterSpacing:".15em",textTransform:"uppercase",marginBottom:8}}>Happening in</div>
              <div style={{display:"flex",gap:isMobile?0:4,alignItems:"flex-end",justifyContent:isMobile?"space-around":"flex-start"}}>
                {[["d","days"],["h","hrs"],["m","min"]].map(([k,l])=>(
                  <div key={k} style={{textAlign:"center",flex:isMobile?1:undefined,minWidth:isMobile?0:28}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:isMobile?"2.4rem":"1.6rem",color:"var(--amber2)",lineHeight:1,fontWeight:900}}>{String(countdown[k]??0).padStart(2,"0")}</div>
                    <div style={{fontSize:isMobile?".7rem":".55rem",color:"var(--muted)",letterSpacing:".08em",marginTop:4}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          ):(
            <div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"2rem",color:"var(--muted2)",opacity:.35,lineHeight:1}}>{new Date(evt.date).getFullYear()}</div>
              {evt.winners?.length>0&&<div style={{fontSize:".7rem",color:"var(--gold)",marginTop:4}}>🏆 {evt.winners.length} awards</div>}
            </div>
          )}
          </div>
        </div>
        {evt.description&&(()=>{const plain=(evt.description).replace(/[*_`#>~]/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/\n+/g," ").trim();const truncated=plain.length>110?plain.slice(0,110).replace(/\s+\S*$/,"")+"…":plain;return(<div style={{color:"var(--cream)",opacity:.6,fontSize:".84rem",lineHeight:1.5,marginTop:".75rem",borderTop:"1px solid rgba(232,148,58,.08)",paddingTop:".7rem"}}>{truncated}<span style={{color:"var(--amber)",fontSize:".79rem",marginLeft:5,fontWeight:600,opacity:.85,whiteSpace:"nowrap"}}>Lees meer →</span></div>);})()}
      </div>

      {/* Activity sneak-peek strip */}
      {evt.schedule&&evt.schedule.length>0&&(()=>{
        const isEditor=can.editSchedule(currentUser);
        const sortedSchedule=[...evt.schedule].sort(scheduleDayTimeOrder);
        const visible=isEditor?sortedSchedule:sortedSchedule.filter(s=>!s.secret);
        const hiddenCount=evt.schedule.filter(s=>s.secret).length;
        if(!isEditor&&visible.length===0)return null;
        return(
          <div style={{padding:"0 1.4rem 1.2rem",borderTop:"1px solid var(--border)"}}>
            <div style={{fontSize:".63rem",color:"var(--muted)",letterSpacing:".15em",textTransform:"uppercase",marginBottom:8,marginTop:10}}>What's on the menu</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {visible.slice(0,6).map((s,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:5,background:s.secret?"rgba(224,85,85,.08)":"var(--bg3)",border:`1px solid ${s.secret?"rgba(224,85,85,.2)":"var(--border)"}`,borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:s.secret?"rgba(224,85,85,.6)":"var(--cream)",opacity:.85}}>
                  <span style={{fontSize:"1rem"}}>{s.secret?"🔒":s.icon||"📍"}</span>
                  <span>{s.secret?"Geheim":s.activity}</span>
                  {!s.secret&&s.time&&<span style={{color:"var(--amber)",fontSize:".68rem",marginLeft:2}}>{s.time}</span>}
                </div>
              ))}
              {visible.length>6&&<div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:"var(--muted)"}}>+{visible.length-6} more 👀</div>}
              {!isEditor&&hiddenCount>0&&<div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:"var(--muted)"}}>🔒 +{hiddenCount} geheim</div>}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TABS=["Overview","Polls","Quiz","Teams","Photos","Winners & Highlights","FAQ","Kretjes 🍺"];

// ─────────────────────────────────────────────────────────────────────────────
// TEAMS TAB
// ─────────────────────────────────────────────────────────────────────────────
const TeamsTab=({evt,onUpdate,currentUser,users=[]})=>{
  const team_sets=evt.team_sets||[];
  const isAdmin=can.editEvent(currentUser);
  const deleteSet=id=>onUpdate({...evt,team_sets:team_sets.filter(ts=>ts.id!==id)});
  if(team_sets.length===0)return(
    <div style={{textAlign:"center",padding:"3rem 1rem",color:"var(--muted)"}}>
      <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>🎲</div>
      <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",marginBottom:".5rem",color:"var(--cream)"}}>Geen teams opgeslagen</div>
      <div style={{fontSize:".85rem"}}>Genereer teams via de Team Creator en sla ze op bij dit event.</div>
    </div>
  );
  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      {team_sets.map(ts=>(
        <Card key={ts.id}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)"}}>{ts.name}</span>
                {ts.category&&<span style={{background:"rgba(232,148,58,.15)",border:"1px solid rgba(232,148,58,.3)",borderRadius:20,padding:"2px 9px",fontSize:".7rem",fontFamily:"var(--font-b)",fontWeight:600,color:"var(--amber2)",letterSpacing:".04em"}}>{ts.category}</span>}
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{ts.teams.length} teams · {ts.teams.reduce((s,t)=>s+t.members.length,0)} deelnemers</div>
            </div>
            {isAdmin&&<Btn onClick={()=>deleteSet(ts.id)} variant="danger" size="sm">Verwijder</Btn>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:".75rem"}}>
            {ts.teams.map((team,i)=>{
              const col=TEAM_COLORS[i%TEAM_COLORS.length];
              return(
                <div key={team.id} style={{background:"var(--bg3)",border:`1px solid ${col}44`,borderRadius:"var(--radius-sm)",padding:".85rem"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:".5rem"}}>
                    <span style={{fontSize:"1.2rem",lineHeight:1}}>{team.avatar||"🎯"}</span>
                    <span style={{fontFamily:"var(--font-h)",fontSize:".9rem",color:col}}>{team.name}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:0}}>
                    {team.members.map((name,j)=>{
                      const u=users.find(x=>(x.display_name||x.username)===name);
                      return(
                        <div key={j} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",borderTop:j>0?"1px solid var(--border)":"none"}}>
                          {u?<Avatar name={u.username} size={18} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>:<div style={{width:18,height:18,borderRadius:"50%",background:"var(--bg4)",border:"1px solid var(--border)",flexShrink:0}}/>}
                          <span style={{fontSize:".82rem",color:"var(--cream)"}}>{name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
};

const EventPage=({evt,onUpdate,onSyncEvt,onDelete,currentUser,users=[],initialTab,scrollToId,onSendNotif})=>{
  const [tab,setTab]=useState(initialTab||"Overview");
  useEffect(()=>{
    if(!scrollToId)return;
    const t=setTimeout(()=>{
      const el=document.getElementById(scrollToId);
      if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.style.outline="2px solid var(--amber)";setTimeout(()=>{el.style.outline="";},1800);}
    },250);
    return()=>clearTimeout(t);
  },[scrollToId]);
  const [editing,setEditing]=useState(false);
  const [presenting,setPresenting]=useState(false);
  const [soloOpen,setSoloOpen]=useState(false);
  const [quizDash,setQuizDash]=useState(false);
  const [presenterDetected,setPresenterDetected]=useState(false);
  const [viewerDismissed,setViewerDismissed]=useState(false);
  const [schedLive,setSchedLive]=useState(null);
  const countdown=useCountdown(evt.date,evt.start_time);
  const isPast=evt.archived;
  const isAdmin=can.editEvent(currentUser);
  const isMobile=useIsMobile();
  const [trailerOpen,setTrailerOpen]=useState(false);
  // Gates on the event actually having a real trailer video now (owner
  // direction change, 2026-08-21) -- not on schedule length. Visible to
  // everyone, not just admins.
  const canTrailer=isSafeVideoUrl(evt.trailer_video_url);
  // Gated on `trailerOpen`, not just memoized on identity: cheap as
  // `toTrailerInput` now is, there's no reason to rebuild the view model on
  // every EventPage render regardless of whether anyone ever opens the
  // trailer. `null` while closed; the `<EventTrailer>` mount below is gated
  // on the same flag, so it never sees the `null`. Still memoized on
  // evt/users identity so an unrelated realtime sync elsewhere doesn't
  // rebuild the view model while the trailer IS open.
  const trailerInput=useMemo(()=>(trailerOpen?toTrailerInput(evt,users):null),[trailerOpen,evt,users]);

  const resetPresenter=useCallback(()=>{setPresenterDetected(false);setViewerDismissed(false);setSchedLive(null);},[]);

  // Realtime: push any DB write on this event to all clients immediately
  const onSyncEvtRef=useRef(onSyncEvt);
  useEffect(()=>{onSyncEvtRef.current=onSyncEvt;},[onSyncEvt]);
  useEffect(()=>{
    const ch=supabase.channel(`event-data-${evt.id}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'events',filter:`id=eq.${evt.id}`},
        ({new:updated})=>{if(updated)onSyncEvtRef.current(updated);}
      )
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[evt.id]);

  // Subscribe when: no active viewer PresentationMode (not detected, or detected but dismissed).
  // While dismissed, keeps schedLive current so Rejoin lands on the right slide.
  useEffect(()=>{
    if(presenting||(presenterDetected&&!viewerDismissed))return;
    const ch=supabase.channel(`sched-${evt.id}`);
    let seenPresenter=false; // guard: don't reset on empty initial sync
    ch.on('presence',{event:'sync'},()=>{
        const st=ch.presenceState();
        const p=Object.values(st).flat().find(x=>x.presenting);
        if(p){
          seenPresenter=true;
          setSchedLive({idx:p.idx??0,revealedSecrets:p.revealedSecrets??[]});
          setPresenterDetected(true);
        } else if(seenPresenter){
          resetPresenter(); // presenter actually ended (we had confirmed they were there)
        }
      })
      .on('broadcast',{event:'slide'},({payload})=>{
        // Keep schedLive current while dismissed so Rejoin shows the right slide
        seenPresenter=true;
        setSchedLive({idx:payload.idx??0,revealedSecrets:payload.revealedSecrets??[]});
      })
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[presenting,presenterDetected,viewerDismissed,evt.id,resetPresenter]);

  return(
    <div style={{display:"grid",gap:"1.5rem"}}>
      {/* ── Epic event header ── */}
      <div className="fu" style={{position:"relative",overflow:"hidden",borderRadius:"var(--radius)",border:"1px solid var(--border2)",background:"linear-gradient(135deg,#1a1008 0%,#2c1c00 45%,#1a1008 100%)"}}>
        {/* Background glows */}
        <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 70% 90% at 85% 40%,rgba(232,148,58,.13),transparent 65%)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 50% 60% at 10% 70%,rgba(201,146,42,.07),transparent 60%)",pointerEvents:"none"}}/>
        {/* Shimmer top bar */}
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange))",backgroundSize:"300% 100%",animation:"goldShimmer 3s linear infinite"}}/>

        <div style={{padding:"2rem 1.8rem 1.5rem"}}>
          {/* Tags */}
          <div style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap",alignItems:"center"}}>
            <Tag color={evt.type==="weekend"?"var(--purple)":"var(--amber)"}>{evt.type==="weekend"?"🏕️ Weekend":"📅 Day Event"}</Tag>
            {isPast&&<Tag color="var(--muted2)">📦 Archived</Tag>}
            {evt.theme&&<Tag color="var(--gold)">✨ {evt.theme}</Tag>}
            {!isPast&&!countdown.past&&<span style={{background:"rgba(255,107,53,.15)",color:"var(--orange)",border:"1px solid rgba(255,107,53,.4)",borderRadius:6,padding:"3px 10px",fontSize:".72rem",fontWeight:700,letterSpacing:".06em",animation:"borderFire 2s ease-in-out infinite"}}>🔥 INCOMING</span>}
          </div>

          <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:"flex-start",gap:"1.2rem"}}>
            <div style={{flex:1,minWidth:0,width:"100%"}}>
              {/* Big italic event name */}
              <div style={{fontFamily:"var(--font-h)",fontStyle:"italic",fontSize:"clamp(1.8rem,5vw,2.8rem)",color:"var(--amber2)",lineHeight:1.05,marginBottom:".7rem",fontWeight:900,letterSpacing:"-.01em"}}>{evt.name}</div>

              {/* Date + time row */}
              <div style={{display:"flex",flexWrap:"wrap",gap:".5rem",marginBottom:".4rem",alignItems:"center"}}>
                <span style={{color:"var(--cream)",opacity:.75,fontSize:".88rem"}}>📅 {formatEventDateRange(evt.date,evt.end_date)}</span>
                {evt.start_time&&<span style={{color:"var(--amber)",fontSize:".88rem",fontWeight:700}}>⏰ {evt.start_time}{evt.end_time&&` – ${evt.end_time}`}</span>}
              </div>
              {evt.location&&evt.location!=="TBD"&&<div style={{color:"var(--cream)",opacity:.65,fontSize:".86rem",marginBottom:".5rem"}}>📍 {evt.location}</div>}

              {/* Attending lads */}
              {evt.attendees.filter(a=>["went","going"].includes(a.status)).length>0&&(
                <div style={{display:"flex",alignItems:"center",gap:10,marginTop:"1.1rem"}}>
                  <div style={{display:"flex"}}>{evt.attendees.filter(a=>["went","going"].includes(a.status)).slice(0,8).map((a,i)=><div key={i} style={{marginLeft:i===0?0:-10,borderRadius:"50%",border:"2px solid #1a1008"}}><Avatar name={a.name} size={28} {...getUA(a.name,users)}/></div>)}</div>
                  <span style={{fontSize:".82rem",color:"var(--muted)"}}>
                    <strong style={{color:"var(--amber2)"}}>{evt.attendees.filter(a=>["went","going"].includes(a.status)).length}</strong> lad{evt.attendees.filter(a=>["went","going"].includes(a.status)).length!==1?"s":""} {isPast?"attended":"confirmed"}
                  </span>
                </div>
              )}
            </div>

            {/* Right: countdown */}
            {!isPast&&!countdown.past&&(
              <div style={{flexShrink:0,width:isMobile?"100%":"auto"}}>
                <div style={{fontSize:".6rem",color:"var(--orange)",letterSpacing:".18em",textTransform:"uppercase",textAlign:"center",marginBottom:12,fontWeight:700}}>⚡ T-MINUS</div>
                <div style={{display:"flex",gap:".4rem",alignItems:"flex-end",justifyContent:isMobile?"center":"flex-start"}}>
                  {[["d","days"],["h","hrs"],["m","min"],["s","sec"]].map(([k,l],i)=>(
                    <div key={k} style={{display:"flex",alignItems:"flex-end",gap:".4rem"}}>
                      <CU v={countdown[k]} l={l}/>
                      {i<3&&<div style={{color:"var(--gold)",fontSize:"1.4rem",fontWeight:100,marginBottom:8}}>:</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {evt.description&&<div style={{color:"var(--muted)",fontSize:".86rem",lineHeight:1.7,marginTop:"1rem",borderTop:"1px solid rgba(232,148,58,.1)",paddingTop:".9rem"}} dangerouslySetInnerHTML={{__html:renderMd(evt.description)}}/>}
        </div>

        {/* Footer bar */}
        <div style={{borderTop:"1px solid var(--border)",padding:".8rem 1.8rem",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,background:"rgba(0,0,0,.25)"}}>
          {isAdmin?(
            <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
              {evt.schedule.length>0&&<Btn onClick={()=>setPresenting(true)} variant="gold" size="sm">▶ Present</Btn>}
              {/* Own-pace browsing, distinct from ▶ Present: admins can plausibly want either.
                  Hidden while a presentation is actually live — that wins, per the owner's call. */}
              {evt.schedule.length>0&&!presenterDetected&&<Btn onClick={()=>setSoloOpen(true)} variant="ghost" size="sm">🧭 Browse solo</Btn>}
              <Btn onClick={()=>setEditing(true)} variant="ghost" size="sm">✎ Edit</Btn>
              {!isPast&&<Btn onClick={()=>onUpdate({...evt,archived:true})} variant="ghost" size="sm" style={{color:"var(--muted)"}}>Archive</Btn>}
              {isPast&&<Btn onClick={()=>onUpdate({...evt,archived:false})} variant="ghost" size="sm">Reopen</Btn>}
              <Btn onClick={onDelete} variant="danger" size="sm">Delete</Btn>
            </div>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <Avatar name={currentUser.username} size={22} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
              <span style={{fontSize:".74rem",color:"var(--muted)"}}>Viewing as <strong style={{color:"var(--cream)"}}>{currentUser.username}</strong></span>
              {/* Members get their own affordance to walk the schedule at their own pace — never broadcasts.
                  Hidden while a presentation is actually live — that wins, per the owner's call. */}
              {evt.schedule.length>0&&!presenterDetected&&<Btn onClick={()=>setSoloOpen(true)} variant="ghost" size="sm">🧭 Browse solo</Btn>}
            </div>
          )}
          {canTrailer&&<Btn onClick={()=>setTrailerOpen(true)} variant="gold" size="sm">🎬 Watch the trailer</Btn>}
          {evt.schedule&&evt.schedule.length>0&&<span style={{fontSize:".71rem",color:"var(--muted)",letterSpacing:".05em"}}>{evt.schedule.length} activities on the menu 👀</span>}
        </div>
      </div>

      <div className="fu1" style={{display:"flex",gap:".2rem",borderBottom:"1px solid var(--border)",overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            onMouseEnter={e=>{if(tab!==t){const el=e.currentTarget;el._sc=el.style.color;el._sb=el.style.background;el.style.color="var(--amber)";el.style.background="rgba(232,148,58,.06)";}}}
            onMouseLeave={e=>{const el=e.currentTarget;el.style.color=el._sc??"";el.style.background=el._sb??"";}}
            style={{background:"none",border:"none",borderBottom:tab===t?"2px solid var(--amber)":"2px solid transparent",color:tab===t?"var(--amber2)":"var(--muted)",cursor:"pointer",padding:"8px 14px",whiteSpace:"nowrap",fontFamily:"var(--font-b)",fontWeight:tab===t?600:400,fontSize:".83rem",marginBottom:-1,transition:"color .15s,background .15s",borderRadius:"6px 6px 0 0"}}>{t}</button>
        ))}
      </div>

      <div className="fu2">
        {tab==="Overview"             &&<OverviewTab evt={evt} onUpdate={onUpdate} isPast={isPast} currentUser={currentUser} users={users} onSendNotif={onSendNotif}/>}
        {tab==="Polls"                &&<PollsTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast} users={users} onSendNotif={onSendNotif}/>}
        {tab==="Quiz"                 &&<QuizTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast} users={users} onOpenQuizDash={()=>setQuizDash(true)}/>}
        {tab==="Teams"                &&<TeamsTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} users={users}/>}
        {tab==="Photos"               &&<PhotosTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
        {tab==="Winners & Highlights" &&<WinnersTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast}/>}
        {tab==="FAQ"                  &&<FAQTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
        {tab==="Kretjes 🍺"           &&<KretjesTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
      </div>

      {/* Live presentation banner — fixed at top of screen */}
      {!presenting&&presenterDetected&&viewerDismissed&&(
        <div className="ann-banner" style={{position:"fixed",top:0,left:0,right:0,zIndex:999,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"linear-gradient(90deg,rgba(15,10,2,.97),rgba(30,18,4,.97))",borderBottom:"1px solid rgba(232,148,58,.45)",padding:".7rem 1.4rem",backdropFilter:"blur(12px)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"var(--red)",flexShrink:0,animation:"pulse 1s ease-in-out infinite",display:"inline-block"}}/>
            <div>
              <div style={{fontWeight:700,color:"var(--amber2)",fontSize:".88rem"}}>🎬 Presentation is live</div>
              <div style={{fontSize:".73rem",color:"var(--muted)"}}>The event schedule is being presented right now</div>
            </div>
          </div>
          <Btn onClick={()=>setViewerDismissed(false)} variant="primary" size="sm">▶ Rejoin</Btn>
        </div>
      )}

      {editing&&<EditEventModal evt={evt} users={users} onSave={u=>{onUpdate(u);setEditing(false)}} onClose={()=>setEditing(false)}/>}
      {presenting&&<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={true} onClose={()=>setPresenting(false)}/>}
      {!presenting&&presenterDetected&&!viewerDismissed&&<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={false} currentLive={schedLive} onHide={()=>setViewerDismissed(true)} onPresenterLeft={resetPresenter} onClose={()=>{}}/>}
      {/* Solo browsing: a live admin presentation still wins -- if one starts
          mid-session (presenterDetected flips true) this unmounts and the
          synced viewer above takes over instead, no rejoin banner or
          join/browse chooser involved, per the owner's explicit call. */}
      {soloOpen&&!presenterDetected&&<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={false} isSolo={true} onClose={()=>setSoloOpen(false)}/>}
      {trailerOpen&&<Suspense fallback={null}>
        <EventTrailer input={trailerInput} onClose={()=>setTrailerOpen(false)}/>
      </Suspense>}
      {quizDash&&<QuizDashboard evt={evt} onUpdate={onUpdate} users={users} onClose={()=>setQuizDash(false)}/>}
      {/* Live quiz participant view — shown to everyone when a quiz is being presented */}
      {(()=>{const liveQ=(evt.quizzes||[]).find(q=>q._liveState);return liveQ&&!quizDash&&<QuizParticipantView evt={evt} liveQ={liveQ} currentUser={currentUser} onUpdate={onUpdate} users={users}/>;})()}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB — Member RSVP + Schedule
// ─────────────────────────────────────────────────────────────────────────────
const OverviewTab=({evt,onUpdate,isPast,currentUser,users=[],onSendNotif})=>{
  const [editSched,setEditSched]=useState(false);
  const [notifyPending,setNotifyPending]=useState(null);
  const isMobile=useIsMobile();
  const statusOpts=isPast?["went","absent"]:["going","maybe","not coming"];
  const colorOf=s=>statusMap[s]?.color??"var(--muted)";
  const isAdmin=can.editEvent(currentUser);
  const isScheduleEditor=can.editSchedule(currentUser);
  const statusEmoji={going:"🔥",maybe:"🤔","not coming":"❌",went:"✅",absent:"😴"};
  const _hasStatus=evt.attendees.find(a=>a.name.toLowerCase()===currentUser.username.toLowerCase())?.status;
  const [rsvpOpen,setRsvpOpen]=useState(!_hasStatus);

  const toggleSecretStop=(i,secret)=>{
    onUpdate({...evt,schedule:evt.schedule.map((s,j)=>j===i?{...s,secret}:s)});
    if(!secret&&onSendNotif){
      const stop=evt.schedule[i];
      setNotifyPending({message:`📍 Stop onthuld: "${stop.activity}"`,type:"schedule",tab:"Overview",targetId:null,eventId:evt.id,event:evt.name});
    }
  };

  const updateStatus=(idx,val)=>{
    if(!can.updateRsvp(currentUser))return;
    onUpdate({...evt,attendees:evt.attendees.map((a,i)=>i===idx?{...a,status:val}:a)});
  };

  // Member self-RSVP — find if current user is in attendees
  const myIdx=evt.attendees.findIndex(a=>a.name.toLowerCase()===currentUser.username.toLowerCase());
  const myEntry=myIdx>=0?evt.attendees[myIdx]:null;

  const selfRsvp=(val)=>{
    if(!can.updateRsvp(currentUser))return;
    let updated;
    if(myIdx>=0){
      updated={...evt,attendees:evt.attendees.map((a,i)=>i===myIdx?{...a,status:val}:a)};
    } else {
      // Not in list yet — add them
      updated={...evt,attendees:[...evt.attendees,{name:currentUser.username,status:val}]};
    }
    onUpdate(updated);
    setRsvpOpen(false);
  };

  const totals=statusOpts.reduce((acc,s)=>{acc[s]=evt.attendees.filter(a=>a.status===s).length;return acc;},{});

  return(
    <div style={{display:"grid",gap:"1.4rem"}}>

      {/* ── RSVP card ── */}
      {!isPast&&can.updateRsvp(currentUser)&&(
        <Card style={{background:"linear-gradient(135deg,#1e1508,#291a08)",borderColor:myEntry?.status?`${colorOf(myEntry.status)}44`:"var(--border2)",position:"relative",overflow:"hidden",transition:"border-color .3s"}}>
          <div style={{position:"absolute",top:-40,right:-40,width:140,height:140,background:"radial-gradient(circle,rgba(232,148,58,.08),transparent 70%)",borderRadius:"50%",pointerEvents:"none"}}/>
          {/* Always-visible compact header */}
          <div onClick={()=>setRsvpOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none"}}>
            <Avatar name={currentUser.username} size={34} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",fontWeight:700,lineHeight:1}}>{currentUser.username}</div>
              <div style={{fontSize:".73rem",color:"var(--muted)",marginTop:3}}>
                {myEntry?.status
                  ? <><span style={{color:colorOf(myEntry.status)}}>{statusEmoji[myEntry.status]} {statusMap[myEntry.status]?.label}</span> · tap to change</>
                  : "Not locked in yet — tap to set status"}
              </div>
            </div>
            {myEntry?.status&&!rsvpOpen&&(
              <div style={{background:`${colorOf(myEntry.status)}18`,border:`1px solid ${colorOf(myEntry.status)}55`,borderRadius:8,padding:"5px 12px",fontSize:".8rem",color:colorOf(myEntry.status),fontWeight:700,flexShrink:0,whiteSpace:"nowrap"}}>
                {statusEmoji[myEntry.status]} {statusMap[myEntry.status]?.label}
              </div>
            )}
            <span style={{color:"var(--muted)",fontSize:"1.1rem",flexShrink:0,transition:"transform .22s cubic-bezier(.4,0,.2,1)",transform:rsvpOpen?"rotate(90deg)":"none",display:"inline-block"}}>›</span>
          </div>
          {/* Animated expandable buttons */}
          <div style={{maxHeight:rsvpOpen?"160px":"0",overflow:"hidden",transition:"max-height .3s cubic-bezier(.4,0,.2,1)"}}>
            <div style={{paddingTop:"1rem",opacity:rsvpOpen?1:0,transform:rsvpOpen?"translateY(0)":"translateY(-6px)",transition:"opacity .22s ease .06s,transform .22s ease .06s"}}>
              <div style={{fontFamily:"var(--font-h)",fontSize:".9rem",color:"var(--cream)",opacity:.7,marginBottom:".7rem",fontStyle:"italic"}}>Are you coming? Make it official.</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {[{s:"going",emoji:"🔥",label:"I'm In"},{s:"maybe",emoji:"🤔",label:"Maybe"},{s:"not coming",emoji:"❌",label:"Can't Make It"}].map(({s,emoji,label})=>{
                  const sel=myEntry?.status===s;
                  const c=colorOf(s);
                  return(
                    <button key={s} className="rsvp-btn" onClick={e=>{e.stopPropagation();selfRsvp(s);}} style={{
                      background:sel?`${c}22`:"transparent",
                      border:`2px solid ${sel?c:`${c}40`}`,
                      color:sel?c:"var(--muted)",
                      borderRadius:"var(--radius-sm)",padding:"9px 18px",cursor:"pointer",
                      fontFamily:"var(--font-b)",fontWeight:700,fontSize:".85rem",
                      display:"flex",alignItems:"center",gap:7,
                      boxShadow:sel?`0 0 18px ${c}30`:"none",
                    }}>
                      <span style={{fontSize:"1.1rem"}}>{emoji}</span>
                      {label}
                      {sel&&<span style={{fontSize:".62rem",letterSpacing:".08em",opacity:.75,marginLeft:2}}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {notifyPending&&(
        <div style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.3)",borderRadius:"var(--radius-sm)",padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:".83rem",color:"var(--amber2)"}}>📣 Leden inlichten over deze reveal?</div>
          <div style={{display:"flex",gap:6}}>
            <Btn size="sm" onClick={()=>{onSendNotif(notifyPending);setNotifyPending(null);}}>Verstuur</Btn>
            <Btn size="sm" variant="ghost" onClick={()=>setNotifyPending(null)}>Niet nu</Btn>
          </div>
        </div>
      )}

      {/* ── Schedule — Sneak Peek ── */}
      <Card style={{background:"linear-gradient(135deg,var(--bg2),#1c1408)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.2rem"}}>
          <div>
            <H style={{marginBottom:3}}>{isPast?"📋 What Went Down":"👀 What's on the Menu"}</H>
            {!isPast&&evt.schedule.length>0&&<div style={{fontSize:".75rem",color:"var(--muted)"}}>The agenda is locked. Here's a taste of what's coming.</div>}
          </div>
          {isAdmin&&<Btn onClick={()=>setEditSched(true)} variant="ghost" size="sm">✎ Edit</Btn>}
        </div>

        {evt.schedule.length===0&&(
          <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"var(--muted)"}}>
            <div style={{fontSize:"2.5rem",marginBottom:".6rem"}}>🔒</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",marginBottom:".3rem"}}>Schedule under wraps</div>
            <div style={{fontSize:".8rem"}}>The lads don't need to know yet.</div>
            {isAdmin&&<div style={{marginTop:".6rem",fontSize:".75rem",color:"var(--amber)"}}>Add activities with Edit ↑</div>}
          </div>
        )}

        {(()=>{
          const sortedSchedule=[...evt.schedule].sort(scheduleDayTimeOrder);
          const visibleStops=isScheduleEditor?sortedSchedule:sortedSchedule.filter(s=>!s.secret);
          const hiddenCount=evt.schedule.filter(s=>s.secret).length;
          // Day separators only appear when the visible stops actually span
          // more than one distinct day -- a true single-day event (or one
          // where every visible stop still sits on day 0) renders identically
          // to before, no separators at all.
          const showDaySeparators=new Set(visibleStops.map(s=>s.day??0)).size>1;
          const stopEls=[];
          visibleStops.forEach((s,i)=>{
                  const globalIdx=evt.schedule.indexOf(s);
                  const isSecret=!!s.secret;
                  const stopDay=s.day??0;
                  if(showDaySeparators&&(i===0||stopDay!==(visibleStops[i-1].day??0))){
                    stopEls.push(
                      <div key={`day-${stopDay}-${i}`} style={{fontSize:".68rem",color:"var(--amber)",letterSpacing:".08em",fontWeight:700,marginTop:i===0?0:".2rem",paddingBottom:5,borderBottom:"1px solid var(--border)"}}>{dayHeadingLabel(evt.date,stopDay)}</div>
                    );
                  }
                  stopEls.push(
                    <div key={i} className="schedule-card" style={{
                      background:isSecret?"rgba(30,10,10,.9)":isPast?"var(--bg3)":"linear-gradient(90deg,rgba(29,20,8,.9),rgba(21,14,4,.7))",
                      border:`1px solid ${isSecret?"rgba(224,85,85,.28)":isPast?"var(--border)":"rgba(232,148,58,.18)"}`,
                      borderRadius:"var(--radius-sm)",padding:".75rem 1rem",
                      position:"relative",overflow:"hidden",
                      animationDelay:`${i*.07}s`,
                    }}>
                      {/* Left accent */}
                      <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:isSecret?"linear-gradient(to bottom,var(--red),rgba(224,85,85,.4))":isPast?"linear-gradient(to bottom,var(--muted2),var(--muted))":"linear-gradient(to bottom,var(--amber),var(--gold))",opacity:isSecret?.7:isPast?.4:.7}}/>

                      {/* Top row: icon + time + activity */}
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                        <div style={{width:28,height:28,borderRadius:7,flexShrink:0,background:isSecret?"rgba(224,85,85,.08)":isPast?"var(--bg4)":"rgba(232,148,58,.1)",border:`1px solid ${isSecret?"rgba(224,85,85,.2)":isPast?"var(--border)":"rgba(232,148,58,.28)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:".95rem"}}>{isSecret?"🔒":s.icon||"📍"}</div>
                        {s.time&&<span style={{fontFamily:"var(--font-h)",fontSize:".82rem",color:isSecret?"rgba(224,85,85,.7)":isPast?"var(--muted)":"var(--amber)",fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>{s.time}</span>}
                        <span style={{fontWeight:600,fontSize:".9rem",color:isSecret?"rgba(224,85,85,.6)":isPast?"var(--cream)":"var(--amber2)",lineHeight:1.3,flex:1,minWidth:0}}>{s.activity}</span>
                        {isPast&&!isSecret&&<span style={{fontSize:".6rem",color:"var(--green)",letterSpacing:".1em",textTransform:"uppercase",opacity:.7,fontWeight:700,flexShrink:0}}>✓ Done</span>}
                        {isScheduleEditor&&(
                          <button onClick={()=>toggleSecretStop(globalIdx,!isSecret)}
                            onMouseEnter={e=>{e.currentTarget.style.opacity="1";}}
                            onMouseLeave={e=>{e.currentTarget.style.opacity=".75";}}
                            style={{background:isSecret?"rgba(76,175,125,.12)":"rgba(224,85,85,.1)",border:`1px solid ${isSecret?"rgba(76,175,125,.3)":"rgba(224,85,85,.3)"}`,borderRadius:6,cursor:"pointer",padding:"2px 8px",fontSize:".66rem",fontWeight:700,color:isSecret?"var(--green)":"var(--red)",opacity:.75,transition:"opacity .15s",flexShrink:0}}>
                            {isSecret?"👁 Reveal":"🔒 Hide"}
                          </button>
                        )}
                      </div>

                      {/* Location / note */}
                      {!isSecret&&(s.location||s.note)&&(
                        <div style={{marginTop:5,display:"flex",flexDirection:"column",gap:2}}>
                          {s.location&&(
                            s.locationUrl
                              ?<a href={s.locationUrl} target="_blank" rel="noreferrer" style={{fontSize:".74rem",color:"var(--amber)",textDecoration:"none",opacity:.8}}>📍 {s.location} ↗</a>
                              :<span style={{fontSize:".74rem",color:"var(--muted)"}}>📍 {s.location}</span>
                          )}
                          {s.note&&<span style={{fontSize:".72rem",color:"var(--muted)",fontStyle:"italic"}}>💬 {s.note}</span>}
                        </div>
                      )}
                    </div>
                  );
          });
          return(
            <>
              <div style={{display:"grid",gap:".55rem"}}>{stopEls}</div>
              {!isScheduleEditor&&hiddenCount>0&&(
                <div style={{textAlign:"center",padding:".7rem",marginTop:".3rem",background:"var(--bg3)",borderRadius:"var(--radius-sm)",border:"1px solid var(--border)"}}>
                  <span style={{fontSize:".78rem",color:"var(--muted)"}}>🔒 {hiddenCount} stop{hiddenCount!==1?"s":""} nog geheim — wordt later onthuld</span>
                </div>
              )}
            </>
          );
        })()}
        {editSched&&<EditScheduleModal evt={evt} onSave={sched=>{onUpdate({...evt,schedule:sched});setEditSched(false)}} onClose={()=>setEditSched(false)}/>}
      </Card>

      {/* Attendees full list */}
      <Card>
        <H>Who's {isPast?"Attended":"Coming"}</H>
        <div style={{display:"flex",gap:6,marginBottom:"1rem",flexWrap:"wrap"}}>
          {statusOpts.map(s=><div key={s} style={{background:colorOf(s)+"22",border:`1px solid ${colorOf(s)}44`,borderRadius:7,padding:"3px 10px",fontSize:".72rem",color:colorOf(s),fontWeight:600}}>{totals[s]||0} {statusMap[s]?.label}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:6}}>
          {evt.attendees.map((a,i)=>{
            const isMe=a.name.toLowerCase()===currentUser.username.toLowerCase();
            const canChange=isAdmin;
            return(
              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--bg3)",borderRadius:10,padding:"9px 12px",border:isMe?"1px solid var(--border2)":"1px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:9}}>
                  <Avatar name={a.name} size={28} {...getUA(a.name,users)}/>
                  <div><span style={{fontWeight:500,fontSize:".86rem"}}>{getDisplayName(a.name,users)}</span>{isMe&&<span style={{fontSize:".68rem",color:"var(--amber)",marginLeft:6}}>you</span>}</div>
                </div>
                {canChange?(
                  <select value={a.status} onChange={e=>updateStatus(i,e.target.value)} style={{background:colorOf(a.status)+"22",color:colorOf(a.status),border:`1px solid ${colorOf(a.status)}44`,borderRadius:7,padding:"3px 7px",fontSize:".73rem",cursor:"pointer",fontFamily:"var(--font-b)"}}>
                    {statusOpts.map(s=><option key={s} value={s}>{statusMap[s]?.label}</option>)}
                  </select>
                ):<Tag color={colorOf(a.status)}>{statusMap[a.status]?.label||a.status}</Tag>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ TAB
// ─────────────────────────────────────────────────────────────────────────────

const ALPHA=["A","B","C","D","E","F","G","H"];

const getYouTubeId=url=>{const m=url?.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})/);return m?m[1]:null;};
const getSpotifyTrackId=url=>{const m=url?.match(/spotify\.com\/(?:intl-[a-z-]+\/)?track\/([\w]+)/);return m?m[1]:null;};
const isSpotifyUrl=url=>/spotify\.com\//.test(url||"");
const isYouTubeUrl=url=>/youtu(be\.com|\.be)\//.test(url||"");

const blankQuestion=(type="multiple")=>({
  type,
  q:"",
  // multiple choice
  options:["","","",""],
  answer:[0],
  // open
  openAnswer:"",
  // music
  songUrl:"",
  songStartSeconds:0,
  songPlaySeconds:30,
  songArtist:"",
  songTitle:"",
  // common
  points:10,
  timeLimit:null,
  image:null,
});

const TEAM_AVATARS=["🦁","🐻","🦊","🐺","🦅","🐉","🦄","🐯","🦈","🦜","🐸","🦀","🐙","🦋","🐊","🦏","🦖","🎭","⚡","🔥","💎","👑","🎸","🏆","🎪","🦝","🐬","🦓"];

// Backwards-compat: old quizzes had flat `questions`, new ones use `rounds`
const normalizeQuiz=q=>{
  const normAnswer=a=>Array.isArray(a)?a:(a!=null?[a]:[0]);
  const withType=qs=>(qs||[]).map(q=>({...q,type:q.type||"multiple",answer:normAnswer(q.answer),openAnswer:q.openAnswer||"",songUrl:q.songUrl||"",songStartSeconds:q.songStartSeconds||0,songPlaySeconds:q.songPlaySeconds||30,songArtist:q.songArtist||"",songTitle:q.songTitle||""}));
  const normTeams=(ts=[])=>ts.map((t,i)=>({avatar:TEAM_AVATARS[i%TEAM_AVATARS.length],...t}));
  if(q.rounds)return{...q,teams:normTeams(q.teams),rounds:q.rounds.map(r=>({icon:"🎯",description:"",bgImage:null,secret:false,...r,questions:withType(r.questions)}))};
  return{...q,teams:normTeams(q.teams),defaultTime:30,rounds:[{id:"r0",title:"Round 1",theme:"",icon:"🎯",description:"",bgImage:null,secret:false,questions:withType(q.questions)}]};
};

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ DASHBOARD  (fullscreen modal — list + editor in one place)
// ─────────────────────────────────────────────────────────────────────────────
const QuizDashboard=({evt,onUpdate,onClose,users=[]})=>{
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
                team_sets={evt.team_sets||[]}
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

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ TAB  (entry point — opens QuizDashboard for admins, read-only for others)
// ─────────────────────────────────────────────────────────────────────────────
const QuizTab=({evt,onUpdate,currentUser,isPast,users=[],onOpenQuizDash})=>{
  const isAdmin=can.hostQuiz(currentUser);
  const quizzes=evt.quizzes||[];

  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
        {isAdmin&&(
          <button onClick={onOpenQuizDash}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",background:"rgba(232,148,58,.1)",border:"1px solid rgba(232,148,58,.35)",borderRadius:"var(--radius)",padding:"1.1rem 1.4rem",cursor:"pointer",fontFamily:"var(--font-b)",color:"var(--amber2)",fontSize:".95rem",fontWeight:700,transition:"all .18s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(232,148,58,.18)";e.currentTarget.style.borderColor="rgba(232,148,58,.6)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(232,148,58,.1)";e.currentTarget.style.borderColor="rgba(232,148,58,.35)";}}>
            <span style={{fontSize:"1.3rem"}}>🧠</span>
            <div style={{textAlign:"left"}}>
              <div>Open Quiz Dashboard</div>
              <div style={{fontSize:".72rem",fontWeight:400,color:"var(--muted)",marginTop:1}}>Create, edit and present quizzes</div>
            </div>
            <span style={{marginLeft:"auto",fontSize:"1rem",opacity:.5}}>→</span>
          </button>
        )}

        {!isAdmin&&quizzes.length===0&&(
          <Card style={{textAlign:"center",padding:"3rem",color:"var(--muted)"}}>
            <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>🧠</div>
            <div style={{fontFamily:"var(--font-h)",marginBottom:".4rem"}}>No quiz yet</div>
            <div style={{fontSize:".83rem"}}>The quizmaster will set one up — stay tuned!</div>
          </Card>
        )}

        {/* Read-only quiz overview for all users */}
        {quizzes.map(quiz=>{
          const nq=normalizeQuiz(quiz);
          const totalQ=nq.rounds.reduce((s,r)=>s+r.questions.length,0);
          const topScore=quiz.scores?Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1])[0]:null;
          const typeBreakdown=nq.rounds.flatMap(r=>r.questions).reduce((acc,q)=>{acc[q.type||"multiple"]=(acc[q.type||"multiple"]||0)+1;return acc;},{});
          return(
            <Card key={quiz.id}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
                    <span style={{fontSize:"1.1rem"}}>{nq.rounds[0]?.icon||"🎯"}</span>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)"}}>{quiz.title}</div>
                    <Tag color={quiz.status==="finished"?"var(--green)":quiz.status==="live"?"var(--red)":"var(--muted)"}>{quiz.status==="finished"?"✓ Done":quiz.status==="live"?"🔴 Live":"Ready"}</Tag>
                  </div>
                  <div style={{fontSize:".78rem",color:"var(--muted)",marginBottom:4}}>{nq.rounds.length>1?`${nq.rounds.length} rounds · `:""}{totalQ} question{totalQ!==1?"s":""}</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {typeBreakdown.multiple&&<span style={{background:"rgba(91,155,213,.1)",border:"1px solid rgba(91,155,213,.25)",borderRadius:6,padding:"1px 7px",fontSize:".67rem",color:"var(--blue)"}}>{typeBreakdown.multiple} MC</span>}
                    {typeBreakdown.open&&<span style={{background:"rgba(76,175,125,.1)",border:"1px solid rgba(76,175,125,.25)",borderRadius:6,padding:"1px 7px",fontSize:".67rem",color:"var(--green)"}}>{typeBreakdown.open} Open</span>}
                    {typeBreakdown.music&&<span style={{background:"rgba(155,127,232,.1)",border:"1px solid rgba(155,127,232,.25)",borderRadius:6,padding:"1px 7px",fontSize:".67rem",color:"var(--purple)"}}>{typeBreakdown.music} 🎵 Music</span>}
                  </div>
                  {topScore&&quiz.status==="finished"&&<div style={{fontSize:".78rem",color:"var(--gold)",marginTop:5}}>🏆 {topScore[0]} · {topScore[1]} pts</div>}
                </div>
              </div>
              {quiz.status==="finished"&&quiz.scores&&(
                <div style={{display:"flex",gap:5,flexWrap:"wrap",borderTop:"1px solid var(--border)",paddingTop:".8rem",marginTop:".8rem"}}>
                  {Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1]).map(([name,score],i)=>(
                    <div key={name} style={{display:"flex",alignItems:"center",gap:5,background:"var(--bg3)",borderRadius:8,padding:"5px 10px"}}>
                      <span style={{fontSize:".7rem",color:["var(--gold)","rgba(192,192,192,.8)","#cd7f32"][i]||"var(--muted2)"}}>{["🥇","🥈","🥉"][i]||`${i+1}.`}</span>
                      <Avatar name={name} size={20} {...(users.find(u=>u.username===name)||{})}/>
                      <span style={{fontSize:".8rem",fontWeight:600}}>{getDisplayName(name,users)}</span>
                      <span style={{fontSize:".76rem",color:"var(--amber)"}}>{score}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
    </div>
  );
};

// Quiz Builder
const SEL_STYLE={background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"5px 8px",color:"var(--muted)",fontSize:".75rem",fontFamily:"var(--font-b)"};
const ICON_BTN={background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:5,color:"var(--muted)",padding:"3px 8px",cursor:"pointer",fontSize:".75rem",fontFamily:"var(--font-b)",lineHeight:1.2,transition:"all .12s"};
const ROUND_ICONS=["🎯","🎵","🧠","🌍","🎬","🍺","⚽","🔬","🎨","🏆","🎭","🌟","🍕","🚀","🦁","🎸","🏎️","💡","🎲","🌈"];
const SONG_SECS=[3,5,7,10,15,20,25,30,45,60,90,120];
const TYPE_META={
  multiple:{label:"Multiple Choice",icon:"🔤",color:"var(--blue)",bg:"rgba(91,155,213,.1)",border:"rgba(91,155,213,.28)"},
  open:    {label:"Open",          icon:"💬",color:"var(--green)",bg:"rgba(76,175,125,.1)",border:"rgba(76,175,125,.28)"},
  music:   {label:"Music",         icon:"🎵",color:"var(--purple)",bg:"rgba(155,127,232,.12)",border:"rgba(155,127,232,.28)"},
};

const QuizBuilder=({onSave,onCancel,existing=null,attendees=[],team_sets=[]})=>{
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
  const imgRefs=useRef({});
  const [imgUploading,setImgUploading]=useState(null);
  const [imgPickerKey,setImgPickerKey]=useState(null);
  const [bucketFiles,setBucketFiles]=useState([]);
  const [bucketLoading,setBucketLoading]=useState(false);

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

  const handleImg=async(ri,qi,e)=>{
    const file=e.target.files[0];if(!file)return;
    const key=`${ri}-${qi}`;
    setImgUploading(key);
    const path=`${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const{data,error}=await supabase.storage.from("Quiz images").upload(path,file);
    if(!error){const{data:{publicUrl}}=supabase.storage.from("Quiz images").getPublicUrl(data.path);updQ(ri,qi,"image",publicUrl);}
    setImgUploading(null);
    e.target.value="";
  };
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
  const loadBucketImages=async()=>{
    setBucketLoading(true);
    const{data,error}=await supabase.storage.from("Quiz images").list("",{limit:200,sortBy:{column:"created_at",order:"desc"}});
    if(!error&&data)setBucketFiles(data.filter(f=>f.name!==".emptyFolderPlaceholder"&&!f.name.endsWith("/")));
    setBucketLoading(false);
  };
  const openBucketPicker=(ri,qi)=>{
    const key=`${ri}-${qi}`;
    if(imgPickerKey===key){setImgPickerKey(null);return;}
    setImgPickerKey(key);
    loadBucketImages();
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
                            {q.songUrl&&isYouTubeUrl(q.songUrl)&&!getYouTubeId(q.songUrl)&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:3}}>⚠ Couldn't detect video ID</div>}
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

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ PRESENTER (full-screen, second-screen style)
// ─────────────────────────────────────────────────────────────────────────────
const fmtTime=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

const MusicPlayer=({q,onPlayStart,onPlayEnd,musicPhase,musicTimer})=>{
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

const QuizPresenter=({quiz:rawQuiz,evt,onUpdate,onClose,onFinish,users=[]})=>{
  const quiz=normalizeQuiz(rawQuiz);
  const totalRounds=quiz.rounds.length;
  const isTeamQuiz=(quiz.teams||[]).length>0;
  const evtRef=useRef(evt);
  evtRef.current=evt;

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase,setPhase]=useState("intro");
  // phases: intro | round-intro | question | pause | round-summary | round-scores | final
  const [roundIdx,setRoundIdx]=useState(0);
  const [qIdx,setQIdx]=useState(0);
  const [slidePhase,setSlidePhase]=useState("question"); // question | answer
  const [scores,setScores]=useState(()=>isTeamQuiz
    ?Object.fromEntries((quiz.teams||[]).map(t=>[t.name,0]))
    :Object.fromEntries((evt.attendees||[]).map(a=>[a.name,0]))
  );
  const [answers,setAnswers]=useState({}); // participant answers: key→optionIdx (synced from liveState)
  const [timer,setTimer]=useState(0);
  const [fading,setFading]=useState(false);
  const timerRef=useRef(null);
  const timerStartedAtRef=useRef(null);

  // Pause timer
  const [prevPhase,setPrevPhase]=useState(null);
  const [pauseMins,setPauseMins]=useState(5);
  const [pauseSecs,setPauseSecs]=useState(0);
  const [pauseTotal,setPauseTotal]=useState(300);
  const [pauseRunning,setPauseRunning]=useState(false);
  const [editingPause,setEditingPause]=useState(false);
  const [pauseInput,setPauseInput]=useState("5:00");
  const pauseRef=useRef(null);

  // Round summary
  const [summaryRevealed,setSummaryRevealed]=useState([]); // question indices revealed in round-summary

  // Pause break-screen config (shown to participants)
  const [pauseConfig,setPauseConfig]=useState({title:"Break Time",text:"The quizmaster will be right back!",image:null,musicUrl:""});
  const [editPauseConfig,setEditPauseConfig]=useState(false);

  // Music
  const [musicPhase,setMusicPhase]=useState("ready"); // ready | playing | done
  const [musicTimer,setMusicTimer]=useState(0);
  const musicRef=useRef(null);

  const currentRound=quiz.rounds[roundIdx];

  // ── Live publishing helpers ───────────────────────────────────────────────
  // Publish current presenter state into quiz._liveState so participants can follow
  const publishLive=(overrides={})=>{
    const e=evtRef.current;
    const newQIdx=overrides.qIdx!==undefined?overrides.qIdx:qIdx;
    const newRoundIdx=overrides.roundIdx!==undefined?overrides.roundIdx:roundIdx;
    const newPhase=overrides.phase!==undefined?overrides.phase:phase;
    // Clear timer whenever we navigate to a different question or phase so
    // participants never inherit a stale timerStartedAt from the previous question.
    const navigating=newQIdx!==qIdx||newRoundIdx!==roundIdx||newPhase!==phase;
    const liveState={
      phase:newPhase,
      roundIdx:newRoundIdx,
      qIdx:newQIdx,
      slidePhase:overrides.slidePhase??slidePhase,
      scores:overrides.scores??scores,
      answers:overrides.answers!==undefined?overrides.answers:answers,
      teams:quiz.teams||[],
      isTeamQuiz,
      summaryRevealed:overrides.summaryRevealed??summaryRevealed,
      pauseConfig,
      timerStartedAt:overrides.timerStartedAt!==undefined?overrides.timerStartedAt:(navigating?null:timerStartedAtRef.current),
      timerLimit:overrides.timerLimit!==undefined?overrides.timerLimit:timeLimit,
    };
    const updatedQuizzes=(e.quizzes||[]).map(q=>q.id===quiz.id?{...q,_liveState:liveState}:q);
    onUpdate({...e,quizzes:updatedQuizzes});
  };

  const clearLive=()=>{
    const e=evtRef.current;
    const updatedQuizzes=(e.quizzes||[]).map(q=>q.id===quiz.id?{...q,_liveState:null}:q);
    onUpdate({...e,quizzes:updatedQuizzes});
  };

  const handleClose=()=>{clearLive();onClose();};
  const currentQ=currentRound?.questions[qIdx];
  const totalQInRound=currentRound?.questions?.length||0;
  const timeLimit=currentQ?(currentQ.timeLimit||quiz.defaultTime||30):30;
  const hostTimedOut=timer===0&&phase==="question"&&slidePhase==="question"&&currentQ?.type==="multiple";

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(()=>{
    const el=document.documentElement;
    if(el.requestFullscreen)el.requestFullscreen().catch(()=>{});
    return()=>{if(document.exitFullscreen&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});};
  },[]);

  useEffect(()=>{
    const h=e=>{
      if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT")return;
      const k=kbRef.current;
      if(e.key==="Escape"){k.handleClose();return;}
      if((e.key==="r"||e.key==="R")&&k.phase==="question"&&k.slidePhase==="question"){
        k.doRevealAnswer();return;
      }
      if((e.key==="p"||e.key==="P")&&k.phase==="question"&&k.slidePhase==="question"&&k.currentQ?.type==="music"){
        if(k.musicPhase==="ready"||k.musicPhase==="done"){k.doPlayMusic();}
        else if(k.musicPhase==="playing"){k.doStopMusic();}
        return;
      }
      if((e.key==="a"||e.key==="A")&&k.phase==="round-summary"){
        k.revealAllSummary();return;
      }
      if(e.key==="ArrowRight"||e.key==="ArrowDown"||e.key===" "){
        e.preventDefault();
        if(k.fading)return;
        if(k.phase==="intro"){k.fade(()=>setPhase("round-intro"));return;}
        if(k.phase==="round-intro"){k.fade(()=>{setPhase("question");setSlidePhase("question");setMusicPhase("ready");setAnswers({});k.publishLive({phase:"question",slidePhase:"question",qIdx:0,answers:{},roundIdx:k.roundIdx});});return;}
        if(k.phase==="question"){k.doNextStep();return;}
        if(k.phase==="round-summary"){k.doAfterSummary();return;}
        if(k.phase==="round-scores"){
          const nr=k.roundIdx+1;
          k.fade(()=>{setRoundIdx(nr);setQIdx(0);setPhase("round-intro");setAnswers({});setMusicPhase("ready");k.publishLive({phase:"round-intro",roundIdx:nr,qIdx:0,answers:{},slidePhase:"question"});});
          return;
        }
      }
      if(e.key==="ArrowLeft"||e.key==="ArrowUp"){
        e.preventDefault();
        if(k.fading)return;
        clearInterval(timerRef.current);
        if(k.phase==="question"){
          if(k.qIdx>0){
            const pq=k.qIdx-1;
            k.fade(()=>{setQIdx(pq);setSlidePhase("question");setAnswers({});setMusicPhase("ready");k.publishLive({qIdx:pq,slidePhase:"question",answers:{},roundIdx:k.roundIdx});});
          } else {
            k.fade(()=>{setPhase("round-intro");k.publishLive({phase:"round-intro",roundIdx:k.roundIdx,qIdx:0});});
          }
          return;
        }
        if(k.phase==="round-summary"){
          const lq=k.currentRound.questions.length-1;
          k.fade(()=>{setPhase("question");setQIdx(lq);setSlidePhase("question");setAnswers({});k.publishLive({phase:"question",qIdx:lq,slidePhase:"question",answers:{},roundIdx:k.roundIdx});});
          return;
        }
        if(k.phase==="round-scores"){
          k.fade(()=>{setPhase("round-summary");setSummaryRevealed([]);k.publishLive({phase:"round-summary",summaryRevealed:[]});});
          return;
        }
        if(k.phase==="round-intro"){
          if(k.roundIdx>0){const pr=k.roundIdx-1;k.fade(()=>{setRoundIdx(pr);setPhase("round-scores");k.publishLive({phase:"round-scores",roundIdx:pr});});}
          else{k.fade(()=>{setPhase("intro");k.publishLive({phase:"intro"});});}
          return;
        }
        if(k.phase==="final"){
          const lr=k.totalRounds-1;
          k.fade(()=>{setRoundIdx(lr);setPhase("round-summary");setSummaryRevealed([]);k.publishLive({phase:"round-summary",roundIdx:lr,summaryRevealed:[]});});
          return;
        }
      }
    };
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    timerStartedAtRef.current=null;
    if(phase==="question"&&slidePhase==="question"&&currentQ&&currentQ.type!=="music"&&currentQ.type!=="open"){
      timerStartedAtRef.current=Date.now();
      setTimer(timeLimit);
      timerRef.current=setInterval(()=>{
        setTimer(t=>{if(t<=1){clearInterval(timerRef.current);return 0;}return t-1;});
      },1000);
    }
    return()=>clearInterval(timerRef.current);
  },[phase,slidePhase,roundIdx,qIdx]);

  useEffect(()=>{
    if(musicPhase==="playing"&&currentQ?.type==="music"){
      const secs=currentQ.songPlaySeconds||30;
      setMusicTimer(secs);
      musicRef.current=setInterval(()=>{
        setMusicTimer(t=>{if(t<=1){clearInterval(musicRef.current);setMusicPhase("done");return 0;}return t-1;});
      },1000);
    }
    return()=>clearInterval(musicRef.current);
  },[musicPhase]);

  useEffect(()=>{
    if(pauseRunning){
      pauseRef.current=setInterval(()=>{
        setPauseTotal(t=>{
          if(t<=1){clearInterval(pauseRef.current);setPauseRunning(false);return 0;}
          return t-1;
        });
      },1000);
    }
    return()=>clearInterval(pauseRef.current);
  },[pauseRunning]);

  // Publish state whenever slide changes (except during fade transitions)
  useEffect(()=>{
    if(fading)return;
    publishLive({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[phase,roundIdx,qIdx,slidePhase,scores,summaryRevealed,fading]);

  // Poll for fresh participant answers every 2s (fast sync)
  useEffect(()=>{
    const evtId=evtRef.current.id;
    const qid=quiz.id;
    const poll=setInterval(async()=>{
      const {data}=await supabase.from("events").select("quizzes").eq("id",evtId).single();
      if(!data)return;
      const ls=data.quizzes?.find(q=>q.id===qid)?._liveState;
      if(ls?.qIdx===qIdx&&ls?.roundIdx===roundIdx)setAnswers(ls.answers||{});
    },2000);
    return()=>clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[quiz.id,qIdx,roundIdx]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const fade=cb=>{setFading(true);setTimeout(()=>{cb();setFading(false);},220);};

  const doRevealAnswer=useCallback(()=>{
    clearInterval(timerRef.current);
    const correctSet=Array.isArray(currentQ?.answer)?currentQ.answer:[currentQ?.answer??0];
    let newScores={...scores};
    if(currentQ?.type==="multiple"){
      Object.entries(answers).forEach(([key,picked])=>{
        const pickedArr=Array.isArray(picked)?picked:[picked];
        const isCorrect=correctSet.length===pickedArr.length&&correctSet.every(c=>pickedArr.includes(c));
        if(isCorrect)newScores[key]=(newScores[key]||0)+(currentQ.points||10);
      });
    }
    setScores(newScores);
    setSlidePhase("answer");
    publishLive({slidePhase:"answer",scores:newScores,answers});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currentQ,answers,scores]);

  const awardPoints=(key,delta)=>{
    const newScores={...scores,[key]:Math.max(0,(scores[key]||0)+delta)};
    setScores(newScores);
    publishLive({scores:newScores});
  };

  const doNextStep=()=>{
    clearInterval(timerRef.current);
    clearInterval(musicRef.current);
    const isLastQ=qIdx>=totalQInRound-1;
    fade(()=>{
      if(!isLastQ){
        const nextQ=qIdx+1;
        setQIdx(nextQ);setSlidePhase("question");setAnswers({});setMusicPhase("ready");
        // No explicit publishLive here — the publishLive useEffect fires after
        // this render and writes the correct timerStartedAt in a single write.
        // A second write here would race against it and could overwrite the timer.
      } else {
        setSummaryRevealed([]);
        setPhase("round-summary");
      }
    });
  };

  const revealSummaryQ=qi=>{
    const next=[...summaryRevealed,qi].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
    setSummaryRevealed(next);
    publishLive({summaryRevealed:next});
  };

  const revealAllSummary=()=>{
    const all=currentRound.questions.map((_,i)=>i);
    setSummaryRevealed(all);
    publishLive({summaryRevealed:all});
  };

  const doAfterSummary=()=>{
    const isLastRound=roundIdx>=totalRounds-1;
    fade(()=>{
      if(!isLastRound){setPhase("round-scores");publishLive({phase:"round-scores"});}
      else{setPhase("final");publishLive({phase:"final"});}
    });
  };

  const enterPause=()=>{
    clearInterval(timerRef.current);
    setPrevPhase({phase,slidePhase});
    setPauseTotal(pauseMins*60+pauseSecs);
    setPauseRunning(false);
    fade(()=>setPhase("pause"));
  };
  const resumeFromPause=()=>{
    clearInterval(pauseRef.current);setPauseRunning(false);
    if(prevPhase)fade(()=>{setPhase(prevPhase.phase);setSlidePhase(prevPhase.slidePhase);setPrevPhase(null);});
    else fade(()=>setPhase("round-intro"));
  };

  const parsePauseInput=v=>{
    const parts=v.split(":");
    const m=parseInt(parts[0])||0,s=parseInt(parts[1])||0;
    const total=Math.max(10,Math.min(3600,m*60+s));
    setPauseMins(Math.floor(total/60));setPauseSecs(total%60);
    setPauseTotal(total);
  };

  const sortedScores=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  // Stable order for award panels — follows attendees/teams list, not score rank
  const scorePairs=isTeamQuiz
    ?(quiz.teams||[]).map(t=>[t.name,scores[t.name]??0])
    :(evt.attendees||[]).map(a=>[a.name,scores[a.name]??0]);
  const medal=["🥇","🥈","🥉"];

  // ── Shared styles ────────────────────────────────────────────────────────────
  const presenterBtn=(label,onClick,accent=false,shortcut=null)=>(
    <button onClick={onClick} style={{background:accent?"rgba(232,148,58,.22)":"rgba(255,255,255,.07)",border:`1px solid ${accent?"rgba(232,148,58,.55)":"rgba(255,255,255,.15)"}`,borderRadius:10,color:accent?"var(--amber2)":"rgba(255,255,255,.85)",padding:"10px 22px",fontSize:".88rem",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:accent?700:500,backdropFilter:"blur(8px)",transition:"background .15s",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}
      onMouseEnter={e=>{e.currentTarget.style.background=accent?"rgba(232,148,58,.35)":"rgba(255,255,255,.14)";}}
      onMouseLeave={e=>{e.currentTarget.style.background=accent?"rgba(232,148,58,.22)":"rgba(255,255,255,.07)";}}>
      {label}
      {shortcut&&<span style={{fontSize:".6rem",opacity:.45,fontWeight:400,letterSpacing:".03em"}}>[{shortcut}]</span>}
    </button>
  );

  // ── Keyboard ref (must be after all actions are defined) ────────────────────
  const kbRef=useRef({});
  kbRef.current={phase,slidePhase,qIdx,roundIdx,fading,totalQInRound,totalRounds,currentRound,currentQ,
    musicPhase,summaryRevealed,
    doRevealAnswer,doNextStep,doAfterSummary,fade,publishLive,handleClose,revealAllSummary,
    doPlayMusic:()=>setMusicPhase("playing"),
    doStopMusic:()=>{clearInterval(musicRef.current);setMusicPhase("done");}};

  // ── Render ───────────────────────────────────────────────────────────────────
  return(
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"#070501",overflow:"hidden",fontFamily:"var(--font-b)"}}>
      {/* Gold top bar */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange))",backgroundSize:"300% 100%",animation:"goldShimmer 3s linear infinite",zIndex:30}}/>

      {/* Background glow */}
      <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 70% 50% at 50% 40%,rgba(232,148,58,.07),transparent 70%)",pointerEvents:"none"}}/>

      {/* Top HUD */}
      <div style={{position:"absolute",top:0,left:0,right:0,padding:"1.2rem 2rem",display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontFamily:"var(--font-h)",fontSize:".9rem",color:"rgba(255,255,255,.4)",letterSpacing:".06em"}}>{quiz.title}</div>
          {phase==="question"&&<span style={{background:"rgba(232,148,58,.15)",border:"1px solid rgba(232,148,58,.3)",borderRadius:20,padding:"2px 10px",fontSize:".7rem",color:"var(--amber)",fontWeight:700}}>Q{qIdx+1}/{totalQInRound}</span>}
          {phase==="round-intro"&&<span style={{background:"rgba(255,255,255,.06)",borderRadius:20,padding:"2px 10px",fontSize:".7rem",color:"rgba(255,255,255,.45)"}}>Round {roundIdx+1}/{totalRounds}</span>}
          {phase==="round-summary"&&<span style={{background:"rgba(91,155,213,.15)",border:"1px solid rgba(91,155,213,.3)",borderRadius:20,padding:"2px 10px",fontSize:".7rem",color:"var(--blue)",fontWeight:700}}>Round {roundIdx+1} Summary</span>}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {phase!=="pause"&&phase!=="intro"&&<button onClick={enterPause} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:"rgba(255,255,255,.55)",padding:"6px 14px",cursor:"pointer",fontSize:".75rem",fontFamily:"var(--font-b)",backdropFilter:"blur(6px)"}}>⏸ Pause</button>}
          <button onClick={handleClose} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",borderRadius:8,color:"rgba(255,255,255,.65)",padding:"6px 14px",cursor:"pointer",fontSize:".75rem",fontFamily:"var(--font-b)",backdropFilter:"blur(6px)"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(224,85,85,.2)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.06)"}>
            ✕ Exit
          </button>
        </div>
      </div>

      {/* Slide content */}
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"5rem 2rem 6rem",opacity:fading?0:1,transition:"opacity .2s ease",zIndex:10,overflow:"auto"}}>

        {/* ── INTRO ─────────────────────────────────────────────────────── */}
        {phase==="intro"&&(
          <div style={{textAlign:"center",maxWidth:760}}>
            <div style={{fontSize:"3rem",marginBottom:"1.2rem",filter:"drop-shadow(0 0 30px rgba(232,148,58,.4))"}}>🧠</div>
            <div style={{fontSize:".75rem",color:"var(--amber)",letterSpacing:".2em",textTransform:"uppercase",fontWeight:700,marginBottom:"1rem",opacity:.8}}>{evt.name}</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(2.4rem,7vw,5rem)",color:"#fff",lineHeight:1.08,marginBottom:"1.2rem",textShadow:"0 0 60px rgba(232,148,58,.2)"}}>{quiz.title}</div>
            {quiz.introText&&<div style={{color:"rgba(255,255,255,.55)",fontSize:"1rem",lineHeight:1.65,marginBottom:"1.4rem",maxWidth:560,margin:"0 auto 1.4rem"}}>{quiz.introText}</div>}
            <div style={{color:"rgba(255,255,255,.4)",fontSize:"1rem",marginBottom:totalRounds>1?"1.4rem":"3rem"}}>{totalRounds} round{totalRounds!==1?"s":""} · {quiz.rounds.reduce((s,r)=>s+r.questions.length,0)} questions</div>
            {totalRounds>1&&(
              <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginBottom:"2.6rem"}}>
                {quiz.rounds.map((r,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.07)",border:`1px solid ${r.secret?"rgba(255,255,255,.1)":"rgba(255,255,255,.14)"}`,borderRadius:10,padding:"7px 15px",fontSize:".82rem",color:r.secret?"rgba(255,255,255,.3)":"rgba(255,255,255,.75)"}}>
                    <span style={{fontSize:"1rem"}}>{r.icon||"🎯"}</span>
                    <span>{r.secret?"???":(r.title||`Round ${i+1}`)}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={()=>fade(()=>setPhase("round-intro"))} style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.5)",borderRadius:14,color:"var(--amber2)",padding:"14px 40px",fontSize:"1.05rem",cursor:"pointer",fontFamily:"var(--font-h)",fontWeight:700,backdropFilter:"blur(8px)",letterSpacing:".04em",display:"inline-flex",alignItems:"center",gap:10}}>
              Start Quiz →
              <span style={{fontSize:".6rem",opacity:.35,fontWeight:400,letterSpacing:".03em"}}>[→]</span>
            </button>
          </div>
        )}
        {/* Intro background image */}
        {phase==="intro"&&quiz.introBg&&(
          <div style={{position:"absolute",inset:0,zIndex:-1,pointerEvents:"none"}}>
            <div style={{position:"absolute",inset:0,backgroundImage:`url(${quiz.introBg})`,backgroundSize:"cover",backgroundPosition:"center"}}/>
            <div style={{position:"absolute",inset:0,background:"rgba(7,5,1,.68)"}}/>
          </div>
        )}

        {/* ── ROUND INTRO ───────────────────────────────────────────────── */}
        {phase==="round-intro"&&currentRound&&(()=>{
          const hasBg=!!currentRound.bgImage;
          return(
          <div style={{textAlign:"center",maxWidth:680,
            ...(hasBg?{background:"rgba(0,0,0,.52)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderRadius:24,padding:"2.5rem 3.5rem",border:"1px solid rgba(255,255,255,.1)",boxShadow:"0 12px 80px rgba(0,0,0,.6)"}:{})}}>
            <div style={{fontSize:"4rem",marginBottom:"1.2rem",filter:"drop-shadow(0 0 30px rgba(232,148,58,.3))",animation:"float 3.5s ease-in-out infinite"}}>{currentRound.icon||"🎯"}</div>
            <div style={{fontSize:".72rem",color:hasBg?"rgba(255,255,255,.7)":"var(--muted)",letterSpacing:".18em",textTransform:"uppercase",marginBottom:".8rem"}}>Round {roundIdx+1} of {totalRounds}</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(2rem,6vw,4rem)",color:"#fff",lineHeight:1.1,marginBottom:".6rem",textShadow:hasBg?"0 2px 12px rgba(0,0,0,.9),0 0 60px rgba(0,0,0,.6)":"0 2px 30px rgba(0,0,0,.5)"}}>{currentRound.title}</div>
            {currentRound.theme&&<div style={{color:"var(--amber2)",fontSize:"1.05rem",marginBottom:".8rem",opacity:hasBg?1:.8,textShadow:hasBg?"0 1px 8px rgba(0,0,0,.8)":"none"}}>{currentRound.theme}</div>}
            {currentRound.description&&<div style={{color:hasBg?"rgba(255,255,255,.85)":"rgba(255,255,255,.42)",fontSize:".95rem",lineHeight:1.6,marginBottom:"1.2rem",maxWidth:480,margin:"0 auto 1.2rem"}}>{currentRound.description}</div>}
            <div style={{color:hasBg?"rgba(255,255,255,.6)":"rgba(255,255,255,.3)",fontSize:".82rem",marginBottom:"2.5rem"}}>{currentRound.questions.length} question{currentRound.questions.length!==1?"s":""}</div>
            <button onClick={()=>fade(()=>{setPhase("question");setSlidePhase("question");setMusicPhase("ready");setAnswers({});publishLive({phase:"question",slidePhase:"question",qIdx:0,answers:{},roundIdx});})} style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.5)",borderRadius:14,color:"var(--amber2)",padding:"14px 40px",fontSize:"1.05rem",cursor:"pointer",fontFamily:"var(--font-h)",fontWeight:700,backdropFilter:"blur(8px)",display:"inline-flex",alignItems:"center",gap:10}}>
              Start Round →
              <span style={{fontSize:".6rem",opacity:.35,fontWeight:400,letterSpacing:".03em"}}>[→]</span>
            </button>
          </div>
          );
        })()}
        {/* Round intro full-screen background image */}
        {phase==="round-intro"&&currentRound?.bgImage&&(
          <div style={{position:"absolute",inset:0,zIndex:-1,pointerEvents:"none"}}>
            <div style={{position:"absolute",inset:0,backgroundImage:`url(${currentRound.bgImage})`,backgroundSize:"cover",backgroundPosition:"center"}}/>
            <div style={{position:"absolute",inset:0,background:"rgba(7,5,1,.55)"}}/>
          </div>
        )}

        {/* ── QUESTION ──────────────────────────────────────────────────── */}
        {phase==="question"&&currentQ&&(
          <div style={{width:"100%",maxWidth:860}}>
            {/* Question header */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.6rem",flexWrap:"wrap"}}>
              <span style={{background:"rgba(232,148,58,.18)",border:"1px solid rgba(232,148,58,.4)",borderRadius:20,padding:"4px 14px",fontSize:".72rem",color:"var(--amber)",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase"}}>
                {currentQ.type==="music"?"🎵 Music":currentQ.type==="open"?"💬 Open":null} Q{qIdx+1} / {totalQInRound}
              </span>
              {totalRounds>1&&<span style={{color:"rgba(255,255,255,.35)",fontSize:".85rem"}}>{currentRound.title}</span>}
              <span style={{marginLeft:"auto",color:"rgba(255,255,255,.3)",fontSize:".78rem"}}>{currentQ.points} pts</span>
              {/* Compact timer in header — multiple choice only */}
              {currentQ.type==="multiple"&&slidePhase==="question"&&!hostTimedOut&&(
                <div style={{position:"relative",width:64,height:64,flexShrink:0,
                  ...(timer<=5?{animation:"timerPulse .6s ease-in-out infinite"}:{})}}>
                  <svg width="64" height="64" style={{transform:"rotate(-90deg)"}}>
                    <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="5"/>
                    <circle cx="32" cy="32" r="27" fill="none"
                      stroke={timer/timeLimit>0.33?"var(--amber)":"var(--red)"} strokeWidth="5"
                      strokeDasharray="170" strokeDashoffset={170*(1-timer/timeLimit)}
                      style={{transition:"stroke-dashoffset 1s linear,stroke .5s"}}/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:0}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"1.35rem",fontWeight:900,lineHeight:1,
                      color:timer/timeLimit>0.33?"var(--amber)":"var(--red)"}}>{timer}</div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Time's up screen (host) ── */}
            {hostTimedOut&&(
              <div style={{textAlign:"center",padding:"2rem 1rem",marginBottom:"1.5rem"}}>
                <div style={{fontSize:"3.5rem",marginBottom:"1rem",animation:"timerPulse .6s ease-in-out infinite"}}>⏰</div>
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(2rem,6vw,3.5rem)",color:"var(--red)",fontWeight:900,marginBottom:".5rem"}}>Time's up!</div>
                <div style={{color:"rgba(255,255,255,.45)",fontSize:".95rem"}}>Reveal the answer or move to the next question</div>
              </div>
            )}

            {/* Question image */}
            {currentQ.image&&slidePhase==="question"&&!hostTimedOut&&(
              <div style={{textAlign:"center",marginBottom:"1.4rem"}}>
                <img src={currentQ.image} alt="" style={{maxWidth:"100%",maxHeight:"55vh",objectFit:"contain",borderRadius:12,boxShadow:"0 8px 40px rgba(0,0,0,.5)"}}/>
              </div>
            )}
            {!hostTimedOut&&<div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.5rem,4vw,2.8rem)",color:"#fff",lineHeight:1.2,marginBottom:"1.8rem",textShadow:"0 2px 20px rgba(0,0,0,.4)"}}>
              {currentQ.q}
            </div>}

            {/* "meerdere antwoorden" hint */}
            {currentQ.type==="multiple"&&slidePhase==="question"&&!hostTimedOut&&(Array.isArray(currentQ.answer)?currentQ.answer:[currentQ.answer]).length>1&&(
              <div style={{textAlign:"center",color:"rgba(255,255,255,.5)",fontSize:".82rem",fontStyle:"italic",marginBottom:"1rem",letterSpacing:".02em"}}>
                meerdere antwoorden zijn mogelijk
              </div>
            )}

            {/* MULTIPLE CHOICE options */}
            {currentQ.type==="multiple"&&!hostTimedOut&&(()=>{
              const correctSet=Array.isArray(currentQ.answer)?currentQ.answer:[currentQ.answer??0];
              return(
                <div style={{display:"grid",gridTemplateColumns:currentQ.options.length<=2?"1fr":"1fr 1fr",gap:"1rem"}}>
                  {currentQ.options.map((opt,i)=>{
                    const isCorrect=correctSet.includes(i);
                    const aCount=Object.values(answers).filter(a=>(Array.isArray(a)?a:[a]).includes(i)).length;
                    const bg=slidePhase==="answer"?(isCorrect?"rgba(76,175,125,.22)":"rgba(224,85,85,.07)"):"rgba(255,255,255,.05)";
                    const border=slidePhase==="answer"?(isCorrect?"2px solid var(--green)":"1px solid rgba(255,255,255,.08)"):"1px solid rgba(255,255,255,.12)";
                    return(
                      <div key={i} style={{background:bg,border,borderRadius:12,padding:"1.1rem 1.4rem",transition:"all .35s",position:"relative",backdropFilter:"blur(6px)"}}>
                        <div style={{fontSize:"clamp(.9rem,2.5vw,1.15rem)",fontWeight:600,color:slidePhase==="answer"&&isCorrect?"var(--green)":"#fff"}}>{ALPHA[i]}. {opt}</div>
                        {slidePhase==="answer"&&isCorrect&&<div style={{fontSize:".75rem",color:"var(--green)",marginTop:5,fontWeight:700}}>✓ Correct</div>}
                        {aCount>0&&<div style={{position:"absolute",top:8,right:10,background:"rgba(232,148,58,.15)",borderRadius:8,padding:"2px 8px",fontSize:".72rem",color:"var(--amber)",fontWeight:700}}>{aCount}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* OPEN QUESTION */}
            {currentQ.type==="open"&&(
              <div>
                {slidePhase==="question"&&<div style={{textAlign:"center",color:"rgba(255,255,255,.35)",fontSize:"1rem",marginBottom:"1.2rem"}}>Open your answer books…</div>}
                {slidePhase==="answer"&&currentQ.openAnswer&&(
                  <div style={{textAlign:"center",marginBottom:"1.4rem"}}>
                    <div style={{background:"rgba(76,175,125,.12)",border:"2px solid var(--green)",borderRadius:14,padding:"1.4rem 2rem",display:"inline-block",marginTop:".5rem"}}>
                      <div style={{fontSize:".75rem",color:"var(--green)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:".5rem",fontWeight:700}}>✓ Answer</div>
                      <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.3rem,4vw,2.2rem)",color:"#fff"}}>{currentQ.openAnswer}</div>
                    </div>
                  </div>
                )}
                {/* Award-points panel — quizmaster manually scores open answers */}
                <div style={{background:"rgba(0,0,0,.38)",border:"1px solid rgba(232,148,58,.22)",borderRadius:14,padding:"1rem 1.2rem",marginTop:".4rem"}}>
                  <div style={{fontSize:".68rem",color:"var(--amber)",textTransform:"uppercase",letterSpacing:".12em",fontWeight:700,marginBottom:".75rem"}}>
                    Award Points — {currentQ.points} pt{currentQ.points!==1?"s":""} each
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:".5rem"}}>
                    {scorePairs.map(([key,score])=>{
                      const team=isTeamQuiz?(quiz.teams||[]).find(t=>t.name===key):null;
                      const pts=currentQ.points||10;
                      return(
                        <div key={key} style={{display:"flex",alignItems:"center",gap:7,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"7px 10px"}}>
                          {isTeamQuiz
                            ?<span style={{fontSize:"1.15rem",flexShrink:0}}>{team?.avatar||"🎯"}</span>
                            :<Avatar name={key} size={24} {...(users.find(u=>u.username===key)||{})}/>}
                          <span style={{flex:1,fontSize:".8rem",color:"rgba(255,255,255,.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{isTeamQuiz?key:getDisplayName(key,users)}</span>
                          <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                            <button onClick={()=>awardPoints(key,-pts)}
                              style={{width:26,height:26,borderRadius:6,background:"rgba(224,85,85,.15)",border:"1px solid rgba(224,85,85,.3)",color:"var(--red)",cursor:"pointer",fontSize:".9rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-b)"}}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(224,85,85,.3)"}
                              onMouseLeave={e=>e.currentTarget.style.background="rgba(224,85,85,.15)"}>−</button>
                            <span style={{fontSize:".82rem",color:"var(--amber)",fontWeight:700,minWidth:28,textAlign:"center"}}>{score}</span>
                            <button onClick={()=>awardPoints(key,pts)}
                              style={{width:26,height:26,borderRadius:6,background:"rgba(76,175,125,.15)",border:"1px solid rgba(76,175,125,.3)",color:"var(--green)",cursor:"pointer",fontSize:".9rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-b)"}}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(76,175,125,.3)"}
                              onMouseLeave={e=>e.currentTarget.style.background="rgba(76,175,125,.15)"}>+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* MUSIC QUESTION */}
            {currentQ.type==="music"&&(
              <div>
                {slidePhase==="question"&&(
                  <MusicPlayer q={currentQ} musicPhase={musicPhase} musicTimer={musicTimer}
                    onPlayStart={()=>setMusicPhase("playing")}
                    onPlayEnd={()=>{clearInterval(musicRef.current);setMusicPhase("done");}}/>
                )}
                {slidePhase==="answer"&&(
                  <div style={{textAlign:"center",marginBottom:"1.2rem"}}>
                    <div style={{fontSize:".72rem",color:"var(--green)",letterSpacing:".14em",textTransform:"uppercase",fontWeight:700,marginBottom:".6rem"}}>🎵 The song was…</div>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.6rem,4.5vw,2.8rem)",color:"var(--amber2)",marginBottom:".25rem",lineHeight:1.15}}>{currentQ.songTitle||"?"}</div>
                    {currentQ.songArtist&&<div style={{color:"rgba(255,255,255,.5)",fontSize:"1.1rem",marginBottom:"1.6rem"}}>{currentQ.songArtist}</div>}
                    {getYouTubeId(currentQ.songUrl)&&(
                      <div style={{display:"inline-block",borderRadius:14,overflow:"hidden",boxShadow:"0 16px 60px rgba(0,0,0,.6)",border:"1px solid rgba(255,255,255,.12)"}}>
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${getYouTubeId(currentQ.songUrl)}?autoplay=1&controls=1&modestbranding=1&rel=0`}
                          allow="autoplay; accelerometer; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          style={{width:480,height:270,maxWidth:"80vw",display:"block",border:"none"}}
                          title="reveal"/>
                      </div>
                    )}
                    {getSpotifyTrackId(currentQ.songUrl)&&!getYouTubeId(currentQ.songUrl)&&(
                      <iframe
                        src={`https://open.spotify.com/embed/track/${getSpotifyTrackId(currentQ.songUrl)}?utm_source=generator&theme=0`}
                        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                        style={{width:320,height:80,borderRadius:12,border:"none",marginTop:".5rem"}}
                        title="spotify-reveal"/>
                    )}
                  </div>
                )}
                {/* Award-points panel — quizmaster manually scores music answers */}
                <div style={{background:"rgba(0,0,0,.38)",border:"1px solid rgba(232,148,58,.22)",borderRadius:14,padding:"1rem 1.2rem",marginTop:".4rem"}}>
                  <div style={{fontSize:".68rem",color:"var(--amber)",textTransform:"uppercase",letterSpacing:".12em",fontWeight:700,marginBottom:".75rem"}}>
                    Award Points — {currentQ.points} pt{currentQ.points!==1?"s":""} each
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:".5rem"}}>
                    {scorePairs.map(([key,score])=>{
                      const team=isTeamQuiz?(quiz.teams||[]).find(t=>t.name===key):null;
                      const pts=currentQ.points||10;
                      return(
                        <div key={key} style={{display:"flex",alignItems:"center",gap:7,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"7px 10px"}}>
                          {isTeamQuiz
                            ?<span style={{fontSize:"1.15rem",flexShrink:0}}>{team?.avatar||"🎯"}</span>
                            :<Avatar name={key} size={24} {...(users.find(u=>u.username===key)||{})}/>}
                          <span style={{flex:1,fontSize:".8rem",color:"rgba(255,255,255,.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{isTeamQuiz?key:getDisplayName(key,users)}</span>
                          <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                            <button onClick={()=>awardPoints(key,-pts)}
                              style={{width:26,height:26,borderRadius:6,background:"rgba(224,85,85,.15)",border:"1px solid rgba(224,85,85,.3)",color:"var(--red)",cursor:"pointer",fontSize:".9rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-b)"}}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(224,85,85,.3)"}
                              onMouseLeave={e=>e.currentTarget.style.background="rgba(224,85,85,.15)"}>−</button>
                            <span style={{fontSize:".82rem",color:"var(--amber)",fontWeight:700,minWidth:28,textAlign:"center"}}>{score}</span>
                            <button onClick={()=>awardPoints(key,pts)}
                              style={{width:26,height:26,borderRadius:6,background:"rgba(76,175,125,.15)",border:"1px solid rgba(76,175,125,.3)",color:"var(--green)",cursor:"pointer",fontSize:".9rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-b)"}}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(76,175,125,.3)"}
                              onMouseLeave={e=>e.currentTarget.style.background="rgba(76,175,125,.15)"}>+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ROUND SUMMARY ─────────────────────────────────────────────── */}
        {phase==="round-summary"&&currentRound&&(
          <div style={{width:"100%",maxWidth:860,overflowY:"auto"}}>
            <div style={{textAlign:"center",marginBottom:"1.8rem"}}>
              <div style={{fontSize:"2rem",marginBottom:".5rem"}}>📋</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.5rem,4vw,2.5rem)",color:"#fff",marginBottom:".3rem"}}>Round {roundIdx+1} Summary</div>
              <div style={{color:"rgba(255,255,255,.35)",fontSize:".85rem"}}>{currentRound.title} · {totalQInRound} questions</div>
            </div>
            <div style={{display:"grid",gap:".75rem",marginBottom:"2rem"}}>
              {currentRound.questions.map((q,qi)=>{
                const revealed=summaryRevealed.includes(qi);
                const correctSet=Array.isArray(q.answer)?q.answer:[q.answer??0];
                return(
                  <div key={qi} style={{background:revealed?"rgba(76,175,125,.07)":"rgba(255,255,255,.04)",border:revealed?"1px solid rgba(76,175,125,.28)":"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"1rem 1.3rem",transition:"all .35s"}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10,justifyContent:"space-between"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:".65rem",color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:".08em"}}>
                          Q{qi+1} · {q.type==="music"?"🎵":q.type==="open"?"💬":"🔤"} · {q.points}pts
                        </div>
                        <div style={{color:"#fff",fontSize:".95rem",fontWeight:600,lineHeight:1.35,marginBottom:revealed?".65rem":0}}>{q.q}</div>
                        {revealed&&q.type==="multiple"&&(
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {q.options.map((opt,oi)=>(
                              <span key={oi} style={{borderRadius:8,padding:"3px 11px",fontSize:".78rem",fontWeight:correctSet.includes(oi)?700:400,
                                background:correctSet.includes(oi)?"rgba(76,175,125,.2)":"rgba(255,255,255,.05)",
                                border:correctSet.includes(oi)?"1px solid rgba(76,175,125,.5)":"1px solid rgba(255,255,255,.1)",
                                color:correctSet.includes(oi)?"var(--green)":"rgba(255,255,255,.4)"}}>
                                {correctSet.includes(oi)&&"✓ "}{ALPHA[oi]}. {opt}
                              </span>
                            ))}
                          </div>
                        )}
                        {revealed&&q.type==="open"&&q.openAnswer&&(
                          <div style={{color:"var(--green)",fontSize:".85rem",fontWeight:600}}>✓ {q.openAnswer}</div>
                        )}
                        {revealed&&q.type==="music"&&(
                          <div style={{color:"var(--amber2)",fontSize:".85rem"}}>{q.songTitle||"?"}{q.songArtist&&` — ${q.songArtist}`}</div>
                        )}
                      </div>
                      {!revealed
                        ?<button onClick={()=>revealSummaryQ(qi)} style={{background:"rgba(232,148,58,.15)",border:"1px solid rgba(232,148,58,.35)",borderRadius:8,color:"var(--amber2)",padding:"6px 14px",fontSize:".75rem",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>Reveal</button>
                        :<span style={{color:"var(--green)",fontSize:"1rem",flexShrink:0}}>✓</span>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
              {summaryRevealed.length<totalQInRound&&(
                <button onClick={revealAllSummary} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",borderRadius:12,color:"rgba(255,255,255,.65)",padding:"10px 22px",fontSize:".85rem",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:500,display:"inline-flex",alignItems:"center",gap:8}}>
                  Reveal All
                  <span style={{fontSize:".6rem",opacity:.35,fontWeight:400,letterSpacing:".03em"}}>[A]</span>
                </button>
              )}
              <button onClick={doAfterSummary} style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.5)",borderRadius:14,color:"var(--amber2)",padding:"12px 36px",fontSize:"1rem",cursor:"pointer",fontFamily:"var(--font-h)",fontWeight:700,backdropFilter:"blur(8px)",display:"inline-flex",alignItems:"center",gap:10}}>
                {roundIdx>=totalRounds-1?"Final Results →":"View Scores →"}
                <span style={{fontSize:".6rem",opacity:.35,fontWeight:400,letterSpacing:".03em"}}>[→]</span>
              </button>
            </div>
          </div>
        )}

        {/* ── ROUND SCORES ──────────────────────────────────────────────── */}
        {phase==="round-scores"&&(
          <div style={{textAlign:"center",maxWidth:520,width:"100%"}}>
            <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>📊</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.5rem,4vw,2.5rem)",color:"#fff",marginBottom:".4rem"}}>After Round {roundIdx+1}</div>
            <div style={{color:"rgba(255,255,255,.35)",fontSize:".85rem",marginBottom:"2rem"}}>{totalRounds-roundIdx-1} round{totalRounds-roundIdx-1!==1?"s":""} to go</div>
            <div style={{display:"grid",gap:".6rem",textAlign:"left",marginBottom:"2.5rem"}}>
              {sortedScores.map(([name,score],i)=>{
                const team=isTeamQuiz?(quiz.teams||[]).find(t=>t.name===name):null;
                const teamMembers=team?.members||[];
                return(
                  <div key={name} className="qp-score-row" style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,.05)",border:i===0?"1px solid rgba(232,148,58,.35)":"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"10px 16px",animationDelay:`${i*.06}s`}}>
                    <div style={{fontSize:"1.1rem",minWidth:28,textAlign:"center"}}>{medal[i]||`${i+1}.`}</div>
                    {isTeamQuiz?<span style={{fontSize:"1.4rem"}}>{team?.avatar||"🎯"}</span>:<Avatar name={name} size={28} {...(users.find(u=>u.username===name)||{})}/>}
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,color:"#fff",fontSize:".95rem"}}>{isTeamQuiz?name:getDisplayName(name,users)}</div>
                      {isTeamQuiz&&teamMembers.length>0&&(
                        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                          {teamMembers.map(m=><span key={m} style={{background:"rgba(255,255,255,.08)",borderRadius:20,padding:"2px 8px",fontSize:".65rem",color:"rgba(255,255,255,.55)"}}>{getDisplayName(m,users)}</span>)}
                        </div>
                      )}
                    </div>
                    <div style={{fontFamily:"var(--font-h)",color:"var(--amber2)",fontSize:"1.1rem",fontWeight:700}}>{score}</div>
                  </div>
                );
              })}
            </div>
            <button onClick={()=>{const nr=roundIdx+1;fade(()=>{setRoundIdx(nr);setQIdx(0);setPhase("round-intro");setAnswers({});setMusicPhase("ready");publishLive({phase:"round-intro",roundIdx:nr,qIdx:0,answers:{},slidePhase:"question"});});}} style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.5)",borderRadius:14,color:"var(--amber2)",padding:"14px 40px",fontSize:"1.05rem",cursor:"pointer",fontFamily:"var(--font-h)",fontWeight:700,backdropFilter:"blur(8px)",display:"inline-flex",alignItems:"center",gap:10}}>
              Next Round →
              <span style={{fontSize:".6rem",opacity:.35,fontWeight:400,letterSpacing:".03em"}}>[→]</span>
            </button>
          </div>
        )}

        {/* ── FINAL ─────────────────────────────────────────────────────── */}
        {phase==="final"&&(
          <div style={{textAlign:"center",maxWidth:540,width:"100%"}}>
            <div style={{fontSize:"3rem",marginBottom:"1rem",animation:"float 3.5s ease-in-out infinite"}}>🏆</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(2rem,5vw,3.5rem)",color:"var(--amber2)",marginBottom:".4rem"}}>Quiz Complete!</div>
            <div style={{color:"rgba(255,255,255,.35)",fontSize:".85rem",marginBottom:"2rem"}}>{quiz.title}</div>
            <div style={{display:"grid",gap:".6rem",textAlign:"left",marginBottom:"2.5rem"}}>
              {sortedScores.map(([name,score],i)=>{
                const team=isTeamQuiz?(quiz.teams||[]).find(t=>t.name===name):null;
                const teamMembers=team?.members||[];
                return(
                  <div key={name} className="qp-score-row" style={{display:"flex",alignItems:"center",gap:12,background:i===0?"rgba(232,148,58,.12)":"rgba(255,255,255,.05)",border:i===0?"1px solid rgba(232,148,58,.45)":"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:i===0?"13px 18px":"10px 16px",animationDelay:`${i*.08}s`}}>
                    <div style={{fontSize:i===0?"1.5rem":"1.1rem",minWidth:32,textAlign:"center"}}>{medal[i]||`${i+1}.`}</div>
                    {isTeamQuiz?<span style={{fontSize:i===0?"1.8rem":"1.4rem"}}>{team?.avatar||"🎯"}</span>:<Avatar name={name} size={i===0?34:28} {...(users.find(u=>u.username===name)||{})}/>}
                    <div style={{flex:1}}>
                      <div style={{fontWeight:i===0?700:600,color:i===0?"var(--amber2)":"#fff",fontSize:i===0?"1.05rem":".95rem"}}>{isTeamQuiz?name:getDisplayName(name,users)}</div>
                      {isTeamQuiz&&teamMembers.length>0&&(
                        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                          {teamMembers.map(m=><span key={m} style={{background:"rgba(255,255,255,.08)",borderRadius:20,padding:"2px 8px",fontSize:".65rem",color:"rgba(255,255,255,.55)"}}>{getDisplayName(m,users)}</span>)}
                        </div>
                      )}
                    </div>
                    <div style={{fontFamily:"var(--font-h)",color:i===0?"var(--amber2)":"rgba(255,255,255,.65)",fontSize:i===0?"1.3rem":"1.1rem",fontWeight:700}}>{score}</div>
                  </div>
                );
              })}
            </div>
            <button onClick={()=>{clearLive();onFinish(scores);}} style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.5)",borderRadius:14,color:"var(--amber2)",padding:"14px 40px",fontSize:"1.05rem",cursor:"pointer",fontFamily:"var(--font-h)",fontWeight:700,backdropFilter:"blur(8px)",display:"inline-flex",alignItems:"center",gap:10}}>
              Close Presenter
              <span style={{fontSize:".6rem",opacity:.35,fontWeight:400,letterSpacing:".03em"}}>[Esc]</span>
            </button>
          </div>
        )}

        {/* ── PAUSE ─────────────────────────────────────────────────────── */}
        {phase==="pause"&&(
          <div style={{width:"100%",maxWidth:700,display:"flex",flexDirection:"column",gap:"1.4rem",alignItems:"center"}}>

            {/* Break-screen preview / editor */}
            {editPauseConfig?(
              /* ── Editor ── */
              <div style={{width:"100%",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.12)",borderRadius:14,padding:"1.4rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
                  <div style={{fontFamily:"var(--font-h)",color:"var(--amber2)",fontSize:".95rem"}}>✏️ Edit Break Screen</div>
                  <button onClick={()=>{setEditPauseConfig(false);publishLive({});}}
                    style={{background:"rgba(76,175,125,.18)",border:"1px solid rgba(76,175,125,.4)",borderRadius:8,color:"var(--green)",padding:"6px 16px",fontSize:".8rem",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:700}}>
                    ✓ Done
                  </button>
                </div>
                <div style={{display:"grid",gap:".85rem"}}>
                  <div>
                    <div style={{fontSize:".68rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Title</div>
                    <input value={pauseConfig.title} onChange={e=>setPauseConfig(p=>({...p,title:e.target.value}))} placeholder="Break Time"
                      style={{width:"100%",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 12px",color:"var(--cream)",fontFamily:"var(--font-b)",fontSize:".9rem",outline:"none"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:".68rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Message</div>
                    <input value={pauseConfig.text} onChange={e=>setPauseConfig(p=>({...p,text:e.target.value}))} placeholder="Back in 5 minutes!"
                      style={{width:"100%",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 12px",color:"var(--cream)",fontFamily:"var(--font-b)",fontSize:".9rem",outline:"none"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:".68rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Image / GIF URL <span style={{textTransform:"none",fontStyle:"italic",opacity:.6}}>(shown on participants' screens)</span></div>
                    <input value={pauseConfig.image||""} onChange={e=>setPauseConfig(p=>({...p,image:e.target.value||null}))} placeholder="https://media.giphy.com/…"
                      style={{width:"100%",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 12px",color:"var(--cream)",fontFamily:"var(--font-b)",fontSize:".9rem",outline:"none"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:".68rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Background Music (YouTube URL)</div>
                    <input value={pauseConfig.musicUrl||""} onChange={e=>setPauseConfig(p=>({...p,musicUrl:e.target.value||""}))} placeholder="https://youtu.be/…"
                      style={{width:"100%",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 12px",color:"var(--cream)",fontFamily:"var(--font-b)",fontSize:".9rem",outline:"none"}}/>
                    <div style={{fontSize:".65rem",color:"var(--muted)",marginTop:4}}>Plays silently for participants during the break · YouTube links only</div>
                  </div>
                </div>
              </div>
            ):(
              /* ── Preview (what participants see) ── */
              <div style={{width:"100%",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"1.4rem",textAlign:"center",position:"relative"}}>
                <button onClick={()=>setEditPauseConfig(true)}
                  style={{position:"absolute",top:10,right:10,background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.13)",borderRadius:8,color:"rgba(255,255,255,.55)",padding:"5px 12px",fontSize:".72rem",cursor:"pointer",fontFamily:"var(--font-b)"}}>
                  ✏️ Edit
                </button>
                {pauseConfig.image
                  ?<img src={pauseConfig.image} alt="" style={{maxHeight:140,maxWidth:"90%",borderRadius:10,marginBottom:"1rem",objectFit:"contain"}} onError={e=>{e.target.style.display="none";}}/>
                  :<div style={{fontSize:"2.5rem",marginBottom:".8rem"}}>⏸</div>
                }
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.3rem,4vw,2rem)",color:"#fff",marginBottom:".3rem"}}>{pauseConfig.title||"Break Time"}</div>
                <div style={{color:"rgba(255,255,255,.4)",fontSize:".85rem"}}>{pauseConfig.text||"Back shortly!"}</div>
                {pauseConfig.musicUrl&&getYouTubeId(pauseConfig.musicUrl)&&(
                  <div style={{marginTop:".8rem",display:"inline-flex",alignItems:"center",gap:5,background:"rgba(76,175,125,.1)",border:"1px solid rgba(76,175,125,.25)",borderRadius:8,padding:"4px 12px",fontSize:".7rem",color:"var(--green)"}}>
                    🎵 Background music active
                  </div>
                )}
                <div style={{marginTop:"1rem",fontSize:".65rem",color:"rgba(255,255,255,.2)"}}>Preview — what participants see</div>
              </div>
            )}

            {/* Quizmaster timer controls */}
            <div style={{textAlign:"center"}}>
              <div style={{marginBottom:"1.5rem"}}>
                {editingPause?(
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"1rem"}}>
                    <input value={pauseInput} onChange={e=>setPauseInput(e.target.value)} onBlur={()=>{parsePauseInput(pauseInput);setEditingPause(false);}} onKeyDown={e=>{if(e.key==="Enter"){parsePauseInput(pauseInput);setEditingPause(false);}}} autoFocus
                      style={{fontFamily:"var(--font-h)",fontSize:"3.5rem",background:"transparent",border:"none",borderBottom:"2px solid var(--amber)",color:"var(--amber2)",textAlign:"center",width:180,outline:"none"}}/>
                    <div style={{fontSize:".75rem",color:"rgba(255,255,255,.3)"}}>Format: M:SS or MM:SS · press Enter</div>
                  </div>
                ):(
                  <div onClick={()=>{setPauseInput(fmtTime(pauseTotal));setEditingPause(true);setPauseRunning(false);clearInterval(pauseRef.current);}} style={{cursor:"pointer",display:"inline-block"}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(3.5rem,10vw,6rem)",color:pauseRunning&&pauseTotal<30?"var(--red)":"var(--amber2)",lineHeight:1,textShadow:"0 0 60px rgba(232,148,58,.3)",transition:"color .5s"}}>
                      {fmtTime(pauseTotal)}
                    </div>
                    <div style={{fontSize:".7rem",color:"rgba(255,255,255,.25)",marginTop:".3rem"}}>click to edit timer</div>
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap",marginBottom:"1.5rem"}}>
                {!pauseRunning
                  ?<button onClick={()=>{if(pauseTotal>0)setPauseRunning(true);}} style={{background:"rgba(76,175,125,.2)",border:"1px solid rgba(76,175,125,.4)",borderRadius:12,color:"var(--green)",padding:"10px 28px",fontSize:".9rem",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:700}}>▶ Start Timer</button>
                  :<button onClick={()=>{clearInterval(pauseRef.current);setPauseRunning(false);}} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.15)",borderRadius:12,color:"rgba(255,255,255,.7)",padding:"10px 24px",fontSize:".9rem",cursor:"pointer",fontFamily:"var(--font-b)"}}>⏹ Stop</button>
                }
                <button onClick={()=>{clearInterval(pauseRef.current);setPauseRunning(false);setPauseTotal(pauseMins*60+pauseSecs);}} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,color:"rgba(255,255,255,.5)",padding:"10px 18px",fontSize:".85rem",cursor:"pointer",fontFamily:"var(--font-b)"}}>↺ Reset</button>
              </div>
              <button onClick={resumeFromPause} style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.5)",borderRadius:14,color:"var(--amber2)",padding:"12px 36px",fontSize:".95rem",cursor:"pointer",fontFamily:"var(--font-h)",fontWeight:700,backdropFilter:"blur(8px)"}}>
                ▶ Resume Quiz
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom control bar (quizmaster) ───────────────────────────── */}
      {phase==="question"&&(
        <div style={{position:"absolute",bottom:0,left:0,right:0,padding:".9rem 2rem",background:"linear-gradient(to top,rgba(7,5,1,.95),rgba(7,5,1,.6))",backdropFilter:"blur(12px)",zIndex:20,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".6rem"}}>
          {/* Answer count */}
          <div style={{fontSize:".78rem",color:"rgba(255,255,255,.35)",minWidth:80}}>
            {slidePhase==="question"&&currentQ?.type==="multiple"&&`${Object.keys(answers).length} answered`}
          </div>

          {/* Action buttons */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {slidePhase==="question"&&presenterBtn("Reveal Answer",doRevealAnswer,!hostTimedOut,"R")}
            {presenterBtn(
              qIdx<totalQInRound-1?"Next Question →":roundIdx<totalRounds-1?"End Round →":"Final Results →",
              doNextStep,slidePhase==="answer"||hostTimedOut,"→"
            )}
          </div>

          {/* Score mini-board */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {sortedScores.slice(0,4).map(([name,score],i)=>(
              <div key={name} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,.04)",borderRadius:8,padding:"4px 9px"}}>
                <span style={{fontSize:".68rem",color:["var(--gold)","rgba(192,192,192,.8)","#cd7f32"][i]||"rgba(255,255,255,.3)"}}>{medal[i]||`${i+1}`}</span>
                <span style={{fontSize:".75rem",color:"rgba(255,255,255,.55)",fontWeight:600}}>{getDisplayName(name,users)}</span>
                <span style={{fontSize:".72rem",color:"var(--amber)",fontWeight:700}}>{score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ PARTICIPANT VIEW  (live — shown to all non-presenter users during a quiz)
// ─────────────────────────────────────────────────────────────────────────────
const ALPHA_P=["A","B","C","D","E","F"];
const QuizParticipantView=({evt,liveQ,currentUser,onUpdate,users=[]})=>{
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
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.4rem,5vw,2rem)",color:"var(--red)",marginBottom:".5rem",fontWeight:900}}>Time's up!</div>
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

// ─────────────────────────────────────────────────────────────────────────────
// POLLS TAB
// ─────────────────────────────────────────────────────────────────────────────
const PollsTab=({evt,onUpdate,currentUser,isPast,users=[],onSendNotif})=>{
  const [creating,setCreating]=useState(false);
  const blankPoll={title:"",emoji:"📊",options:["",""],secret:false,locked:false,allowUserOptions:false,linkUrl:"",linkLabel:""};
  const [newPoll,setNewPoll]=useState(blankPoll);
  const [showLink,setShowLink]=useState(false);
  const [userOptInputs,setUserOptInputs]=useState({});
  const [expanded,setExpanded]=useState({});
  const [editingOpt,setEditingOpt]=useState(null);
  const [notifyPending,setNotifyPending]=useState(null);
  const isOrg=can.closePoll(currentUser);

  const savePolls=p=>onUpdate({...evt,polls:p});

  const saveEditOpt=()=>{
    if(!editingOpt)return;
    const{pollId,idx,value}=editingOpt;
    if(!value.trim())return;
    savePolls((evt.polls||[]).map(p=>p.id!==pollId?p:{...p,options:p.options.map((o,i)=>i===idx?{...o,label:value.trim()}:o)}));
    setEditingOpt(null);
  };

  const movePoll=(pollId,d)=>{
    const arr=[...(evt.polls||[])];
    const p=arr.find(x=>x.id===pollId);
    if(!p)return;
    const grp=arr.filter(x=>!!x.closed===!!p.closed);
    const gi=grp.findIndex(x=>x.id===pollId);
    const ni=gi+d;
    if(ni<0||ni>=grp.length)return;
    const ia=arr.findIndex(x=>x.id===pollId);
    const ja=arr.findIndex(x=>x.id===grp[ni].id);
    [arr[ia],arr[ja]]=[arr[ja],arr[ia]];
    savePolls(arr);
  };

  const vote=(pollId,optIdx)=>{
    if(!can.vote(currentUser))return;
    savePolls((evt.polls||[]).map(p=>{
      if(p.id!==pollId||p.closed)return p;
      return{...p,options:p.options.map((o,i)=>{
        if(i===optIdx)return o.votes.includes(currentUser.username)?{...o,votes:o.votes.filter(v=>v!==currentUser.username)}:{...o,votes:[...o.votes,currentUser.username]};
        return{...o,votes:o.votes.filter(v=>v!==currentUser.username)};
      })};
    }));
  };

  const addUserOption=(pollId)=>{
    const label=(userOptInputs[pollId]||"").trim();
    if(!label)return;
    savePolls((evt.polls||[]).map(p=>{
      if(p.id!==pollId)return p;
      // Remove user's existing vote, add new option with their vote
      const cleared=p.options.map(o=>({...o,votes:o.votes.filter(v=>v!==currentUser.username)}));
      return{...p,options:[...cleared,{label,votes:[currentUser.username],addedBy:currentUser.username}]};
    }));
    setUserOptInputs(s=>({...s,[pollId]:""}));
  };

  const addPoll=()=>{
    const opts=newPoll.options.filter(o=>o.trim());
    if(!newPoll.title.trim())return;
    if(!newPoll.allowUserOptions&&opts.length<2)return;
    const link=(newPoll.linkUrl.trim())?{url:newPoll.linkUrl.trim(),label:newPoll.linkLabel.trim()||newPoll.linkUrl.trim()}:null;
    savePolls([...(evt.polls||[]),{
      id:`p${Date.now()}`,title:newPoll.title,emoji:newPoll.emoji,
      closed:false,secret:!!newPoll.secret,locked:!!newPoll.locked,allowUserOptions:!!newPoll.allowUserOptions,
      link,options:opts.map(o=>({label:o,votes:[]}))
    }]);
    setNewPoll(blankPoll);setShowLink(false);setCreating(false);
  };

  const Toggle=({value,onChange,label})=>(
    <div onClick={onChange} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none"}}>
      <div style={{width:36,height:20,borderRadius:10,background:value?"var(--amber)":"var(--bg3)",border:`1px solid ${value?"var(--amber)":"var(--border)"}`,position:"relative",transition:"background .15s,border-color .15s",flexShrink:0}}>
        <div style={{position:"absolute",top:2,left:value?18:2,width:14,height:14,borderRadius:"50%",background:value?"#1a1008":"var(--muted2)",transition:"left .15s"}}/>
      </div>
      <span style={{fontSize:".83rem",color:"var(--cream)"}}>{label}</span>
    </div>
  );

  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".8rem"}}>
        <div style={{fontSize:".82rem",color:"var(--muted)"}}>Voting as <strong style={{color:"var(--cream)"}}>{currentUser.username}</strong></div>
        {can.createPoll(currentUser)&&!isPast&&<Btn onClick={()=>setCreating(true)} size="sm">+ New Poll</Btn>}
      </div>
      {notifyPending&&(
        <div style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.3)",borderRadius:"var(--radius-sm)",padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:".83rem",color:"var(--amber2)"}}>📣 Leden inlichten over deze reveal?</div>
          <div style={{display:"flex",gap:6}}>
            <Btn size="sm" onClick={()=>{onSendNotif(notifyPending);setNotifyPending(null);}}>Verstuur</Btn>
            <Btn size="sm" variant="ghost" onClick={()=>setNotifyPending(null)}>Niet nu</Btn>
          </div>
        </div>
      )}
      {!can.vote(currentUser)&&<div style={{background:"rgba(232,148,58,.07)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"10px 14px",fontSize:".83rem",color:"var(--muted)"}}>🔒 Member access required to vote.</div>}
      {(evt.polls||[]).length===0&&<Card style={{textAlign:"center",padding:"3rem",color:"var(--muted)"}}>No polls yet{!can.createPoll(currentUser)?" — admin will add one soon.":""}.</Card>}
      {(()=>{
        const renderPoll=(poll,grp,gi)=>{
          const isExp=expanded[poll.id]!==false;
          const resultsHidden=!!poll.locked&&!isOrg;
          if(!!poll.secret&&!isOrg){
            return(
              <Card key={poll.id} style={{opacity:.75}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{fontSize:"2rem",opacity:.4}}>🔒</div>
                  <div>
                    <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"var(--muted)"}}>Hidden poll</div>
                    <div style={{fontSize:".75rem",color:"var(--muted2)",marginTop:2}}>The organisation will reveal this at the right moment</div>
                  </div>
                </div>
              </Card>
            );
          }
          const total=poll.options.reduce((s,o)=>s+o.votes.length,0);
          const maxV=Math.max(...poll.options.map(o=>o.votes.length));
          return(
            <Card key={poll.id} id={`poll-${poll.id}`} style={{...(poll.closed?{opacity:.8}:{}),padding:0,overflow:"hidden"}}>
              {/* Header — click anywhere to expand/collapse */}
              <div onClick={()=>setExpanded(s=>({...s,[poll.id]:!isExp}))}
                style={{cursor:"pointer",padding:"1rem 1.2rem",display:"flex",alignItems:"center",gap:12,userSelect:"none"}}>
                <div style={{fontSize:"1.6rem",lineHeight:1,flexShrink:0}}>{poll.emoji}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",marginBottom:3}}>{poll.title}</div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:".7rem",fontWeight:600,letterSpacing:".05em",padding:"2px 7px",borderRadius:20,background:poll.closed?"rgba(255,255,255,.06)":"rgba(80,200,120,.12)",color:poll.closed?"var(--muted)":"#5dc87a",border:poll.closed?"1px solid rgba(255,255,255,.08)":"1px solid rgba(80,200,120,.2)"}}>{poll.closed?"Closed":"Open"}</span>
                    {!resultsHidden&&<span style={{fontSize:".72rem",color:"var(--muted)"}}>{total} vote{total!==1?"s":""}</span>}
                    {resultsHidden&&<span style={{fontSize:".7rem",color:"var(--orange)",fontWeight:600}}>🔒 Results locked</span>}
                    {isOrg&&!!poll.secret&&<span style={{fontSize:".7rem",color:"rgba(220,80,80,.85)",fontWeight:600}}>🤫 Secret</span>}
                    {poll.link?.url&&<span style={{fontSize:".7rem",color:"var(--amber)",opacity:.7}}>🔗</span>}
                  </div>
                </div>
                <div style={{fontSize:".7rem",color:"var(--muted)",transition:"transform .2s",transform:isExp?"rotate(0deg)":"rotate(-90deg)",flexShrink:0}}>▼</div>
              </div>

              {/* Collapsible body */}
              <div style={{overflow:"hidden",maxHeight:isExp?"800px":"0",transition:"max-height .28s ease"}}>
                <div style={{padding:"0 1.2rem 1.2rem",display:"grid",gap:8}}>

                  {/* Locked results banner */}
                  {resultsHidden&&(
                    <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,140,0,.08)",border:"1px solid rgba(255,140,0,.25)",borderRadius:8,padding:"8px 12px"}}>
                      <span>👁</span>
                      <div>
                        <div style={{fontSize:".8rem",fontWeight:600,color:"var(--orange)"}}>Results are locked</div>
                        <div style={{fontSize:".7rem",color:"var(--muted)"}}>The organisation will reveal results later</div>
                      </div>
                    </div>
                  )}

                  {/* External link */}
                  {poll.link?.url&&(
                    <a href={poll.link.url} target="_blank" rel="noreferrer"
                      style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:10,background:"rgba(232,148,58,.07)",border:"1px solid rgba(232,148,58,.2)",color:"var(--amber2)",textDecoration:"none",fontSize:".85rem",fontWeight:500}}>
                      <span style={{fontSize:"1rem"}}>🔗</span>
                      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{poll.link.label||poll.link.url}</span>
                      <span style={{opacity:.5,fontSize:".7rem"}}>↗</span>
                    </a>
                  )}

                  {/* Vote options */}
                  {poll.options.map((opt,i)=>{
                    const pct=total?Math.round(opt.votes.length/total*100):0;
                    const myVote=opt.votes.includes(currentUser.username);
                    const isWinner=!resultsHidden&&opt.votes.length===maxV&&opt.votes.length>0;
                    const clickable=can.vote(currentUser)&&!isPast&&!poll.closed;
                    const isMyOpt=opt.addedBy===currentUser.username;
                    const onlyMyVote=opt.votes.length===1&&opt.votes[0]===currentUser.username;
                    const canEditOpt=isMyOpt&&onlyMyVote&&!poll.closed&&!isPast;
                    const canDelOpt=(isOrg||(isMyOpt&&onlyMyVote))&&!poll.closed&&!isPast;
                    const isEditing=editingOpt?.pollId===poll.id&&editingOpt?.idx===i;
                    return(
                      <div key={i} style={{position:"relative",borderRadius:12,overflow:"hidden",border:myVote?"1px solid var(--amber)":"1px solid var(--border)",transition:"border-color .15s"}}>
                        {/* progress bar bg */}
                        {!isEditing&&!resultsHidden&&(
                          <div style={{position:"absolute",inset:0,background:myVote?"rgba(232,148,58,.1)":"rgba(255,255,255,.02)",width:pct+"%",transition:"width .4s ease",pointerEvents:"none"}}/>
                        )}
                        {isEditing?(
                          <div style={{display:"flex",gap:8,padding:"10px 12px",alignItems:"center"}}>
                            <Inp value={editingOpt.value} autoFocus
                              onChange={e=>setEditingOpt(s=>({...s,value:e.target.value}))}
                              onKeyDown={e=>{if(e.key==="Enter")saveEditOpt();if(e.key==="Escape")setEditingOpt(null);}}
                              style={{flex:1,fontSize:".88rem",padding:"6px 10px"}}/>
                            <Btn onClick={saveEditOpt} size="sm" variant="ghost">✓</Btn>
                            <Btn onClick={()=>setEditingOpt(null)} size="sm" variant="ghost">✕</Btn>
                          </div>
                        ):(
                          <div onClick={()=>clickable&&vote(poll.id,i)}
                            style={{position:"relative",display:"flex",alignItems:"center",gap:10,padding:"13px 14px",cursor:clickable?"pointer":"default",minHeight:48}}>
                            {/* Vote indicator */}
                            <div style={{width:20,height:20,borderRadius:"50%",border:myVote?"2px solid var(--amber)":"2px solid var(--border)",background:myVote?"var(--amber)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
                              {myVote&&<div style={{width:8,height:8,borderRadius:"50%",background:"#1a1008"}}/>}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                {isWinner&&<span style={{fontSize:"13px"}}>👑</span>}
                                <span style={{fontWeight:myVote?600:400,color:myVote?"var(--amber2)":"var(--cream)",fontSize:".9rem"}}>{opt.label}</span>
                                {opt.addedBy&&<span style={{fontSize:".68rem",color:"var(--muted)",fontStyle:"italic"}}>by {getDisplayName(opt.addedBy,users)||opt.addedBy}</span>}
                              </div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                              {resultsHidden?(
                                myVote&&<span style={{fontSize:".78rem",color:"var(--amber)",fontWeight:600}}>✓</span>
                              ):(
                                <>
                                  <div style={{display:"flex",alignItems:"center"}}>{opt.votes.slice(0,4).map((v,vi)=><div key={vi} style={{marginLeft:vi===0?0:-6}}><Avatar name={v} size={18} {...getUA(v,users)}/></div>)}{opt.votes.length>4&&<span style={{fontSize:".65rem",color:"var(--muted)",marginLeft:4}}>+{opt.votes.length-4}</span>}</div>
                                  <span style={{color:"var(--amber)",fontWeight:700,fontSize:".82rem",minWidth:28,textAlign:"right"}}>{pct}%</span>
                                </>
                              )}
                              {(canEditOpt||canDelOpt)&&(
                                <div style={{display:"flex",gap:2}} onClick={e=>e.stopPropagation()}>
                                  {canEditOpt&&<button onClick={()=>setEditingOpt({pollId:poll.id,idx:i,value:opt.label})}
                                    style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".8rem",padding:"2px 4px",opacity:.55}}>✎</button>}
                                  {canDelOpt&&<button onClick={()=>savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,options:p.options.filter((_,j)=>j!==i)}:p))}
                                    style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".75rem",padding:"2px 4px",opacity:.55}}>✕</button>}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add own option */}
                  {poll.allowUserOptions&&!poll.closed&&can.vote(currentUser)&&!isPast&&(
                    <div style={{display:"flex",gap:8}}>
                      <Inp value={userOptInputs[poll.id]||""} onChange={e=>setUserOptInputs(s=>({...s,[poll.id]:e.target.value}))}
                        onKeyDown={e=>e.key==="Enter"&&addUserOption(poll.id)}
                        placeholder="Voeg je eigen optie toe…" style={{flex:1,fontSize:".85rem",padding:"9px 12px"}}/>
                      <Btn onClick={()=>addUserOption(poll.id)} size="sm" variant="ghost">+</Btn>
                    </div>
                  )}

                  {/* Admin toolbar — always at bottom, never in header */}
                  {isOrg&&!isPast&&(
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",paddingTop:4,borderTop:"1px solid var(--border)",marginTop:4}}>
                      <Btn onClick={()=>movePoll(poll.id,-1)} variant="ghost" size="sm" style={{opacity:gi===0?.3:1,minWidth:32}}>↑</Btn>
                      <Btn onClick={()=>movePoll(poll.id,1)} variant="ghost" size="sm" style={{opacity:gi===grp.length-1?.3:1,minWidth:32}}>↓</Btn>
                      <div style={{width:1,height:16,background:"var(--border)",margin:"0 2px"}}/>
                      <Btn onClick={()=>{savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,secret:!p.secret}:p));if(poll.secret&&onSendNotif)setNotifyPending({message:`📊 Poll beschikbaar: "${poll.title}"`,type:"poll",tab:"Polls",targetId:`poll-${poll.id}`,eventId:evt.id,event:evt.name});}} variant="ghost" size="sm">{poll.secret?"👁 Toon":"🤫 Geheim"}</Btn>
                      <Btn onClick={()=>savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,locked:!p.locked}:p))} variant="ghost" size="sm">{poll.locked?"🔓 Onthul":"🔒 Vergrendel"}</Btn>
                      <Btn onClick={()=>savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,closed:!p.closed}:p))} variant="ghost" size="sm">{poll.closed?"Heropenen":"Sluiten"}</Btn>
                      <Btn onClick={()=>savePolls((evt.polls||[]).filter(p=>p.id!==poll.id))} variant="danger" size="sm">Verwijder</Btn>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        };
        const open=(evt.polls||[]).filter(p=>!p.closed);
        const closed=(evt.polls||[]).filter(p=>p.closed);
        return(<>
          {open.map((p,i)=>renderPoll(p,open,i))}
          {closed.length>0&&<>
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:".4rem"}}>
              <div style={{flex:1,height:1,background:"var(--border)"}}/>
              <span style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>🔒 Closed Polls</span>
              <div style={{flex:1,height:1,background:"var(--border)"}}/>
            </div>
            {closed.map((p,i)=>renderPoll(p,closed,i))}
          </>}
        </>);
      })()}

      {creating&&(
        <Modal onClose={()=>{setCreating(false);setNewPoll(blankPoll);setShowLink(false);}} maxWidth={460}>
          <H>New Poll</H>
          <div style={{display:"grid",gap:"1rem"}}>
            {/* Title + emoji */}
            <div style={{display:"flex",gap:8}}>
              <Inp value={newPoll.emoji} onChange={e=>setNewPoll({...newPoll,emoji:e.target.value})} style={{width:52,textAlign:"center",fontSize:"1.1rem",flexShrink:0}}/>
              <Inp value={newPoll.title} onChange={e=>setNewPoll({...newPoll,title:e.target.value})} placeholder="Poll question…" autoFocus/>
            </div>

            {/* Options */}
            <div>
              <Lbl>Options</Lbl>
              {newPoll.options.map((o,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:6}}>
                  <Inp value={o} onChange={e=>{const opts=[...newPoll.options];opts[i]=e.target.value;setNewPoll({...newPoll,options:opts})}} placeholder={`Option ${i+1}`}/>
                  {newPoll.options.length>2&&<Btn onClick={()=>setNewPoll({...newPoll,options:newPoll.options.filter((_,j)=>j!==i)})} variant="ghost" size="sm">✕</Btn>}
                </div>
              ))}
              <Btn onClick={()=>setNewPoll({...newPoll,options:[...newPoll.options,""]})} variant="ghost" size="sm">+ Option</Btn>
            </div>

            {/* Toggles */}
            <div style={{display:"grid",gap:".6rem",background:"var(--bg3)",borderRadius:10,padding:".8rem 1rem",border:"1px solid var(--border)"}}>
              <Toggle value={newPoll.secret} onChange={()=>setNewPoll({...newPoll,secret:!newPoll.secret})} label="🤫 Secret poll — hidden from members until you reveal it"/>
              <Toggle value={newPoll.locked} onChange={()=>setNewPoll({...newPoll,locked:!newPoll.locked})} label="🔒 Lock results — members can vote but not see results"/>
              <Toggle value={newPoll.allowUserOptions} onChange={()=>setNewPoll({...newPoll,allowUserOptions:!newPoll.allowUserOptions})} label="✏️ Let members add their own options"/>
            </div>

            {/* External link */}
            {!showLink?(
              <button onClick={()=>setShowLink(true)} style={{background:"none",border:"none",color:"var(--amber)",cursor:"pointer",fontSize:".8rem",textAlign:"left",padding:0,fontFamily:"var(--font-b)"}}>🔗 Add external link (optional)</button>
            ):(
              <div style={{display:"grid",gap:6}}>
                <Lbl>Link</Lbl>
                <Inp value={newPoll.linkUrl} onChange={e=>setNewPoll({...newPoll,linkUrl:e.target.value})} placeholder="https://…"/>
                <Inp value={newPoll.linkLabel} onChange={e=>setNewPoll({...newPoll,linkLabel:e.target.value})} placeholder="Link label (e.g. Food order form)"/>
              </div>
            )}

            <div style={{display:"flex",gap:8}}>
              <Btn onClick={addPoll} disabled={!newPoll.title.trim()||(!newPoll.allowUserOptions&&newPoll.options.filter(o=>o.trim()).length<2)}>Create</Btn>
              <Btn onClick={()=>{setCreating(false);setNewPoll(blankPoll);setShowLink(false);}} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PHOTOS TAB
// ─────────────────────────────────────────────────────────────────────────────
const PhotosTab=({evt,onUpdate,currentUser})=>{
  const [lightbox,setLightbox]=useState(null);
  const fileRef=useRef();
  const savePhotos=p=>onUpdate({...evt,photos:p});
  const handleUpload=async e=>{
    if(!can.uploadPhoto(currentUser))return;
    const files=Array.from(e.target.files);
    for(const file of files){
      const path=`${evt.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const{data,error}=await supabase.storage.from("event-photos").upload(path,file);
      if(error){console.error("Upload failed:",error);continue;}
      const{data:{publicUrl}}=supabase.storage.from("event-photos").getPublicUrl(data.path);
      const photo={id:`ph${Date.now()}${Math.random()}`,src:publicUrl,uploader:currentUser.username,caption:"",reactions:{},uploadedAt:new Date().toISOString()};
      onUpdate(prev=>({...prev,photos:[photo,...(prev.photos||[])]}));
    }
    e.target.value="";
  };
  const react=(photoId,emoji)=>{
    if(!can.reactPhoto(currentUser))return;
    const photos=(evt.photos||[]).map(p=>{if(p.id!==photoId)return p;const r={...p.reactions};const list=r[emoji]||[];r[emoji]=list.includes(currentUser.username)?list.filter(u=>u!==currentUser.username):[...list,currentUser.username];return{...p,reactions:r};});
    savePhotos(photos);if(lightbox?.id===photoId)setLightbox(photos.find(p=>p.id===photoId));
  };
  const updateCaption=(photoId,caption)=>{const photos=(evt.photos||[]).map(p=>p.id===photoId?{...p,caption}:p);savePhotos(photos);if(lightbox?.id===photoId)setLightbox({...lightbox,caption});};
  const deletePhoto=(photoId)=>{if(!can.deletePhoto(currentUser))return;savePhotos((evt.photos||[]).filter(p=>p.id!==photoId));setLightbox(null);};
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}>
        <div style={{color:"var(--muted)",fontSize:".84rem"}}>{evt.photos?.length||0} photo{evt.photos?.length!==1?"s":""}</div>
        {can.uploadPhoto(currentUser)&&<Btn onClick={()=>fileRef.current?.click()} size="sm">📷 Upload</Btn>}
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleUpload} style={{display:"none"}}/>
      </div>
      {(!evt.photos||evt.photos.length===0)&&<Card style={{textAlign:"center",padding:"3.5rem 2rem"}}><div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>📷</div><div style={{color:"var(--muted)",fontFamily:"var(--font-h)"}}>No photos yet</div>{can.uploadPhoto(currentUser)&&<Btn onClick={()=>fileRef.current?.click()} style={{marginTop:"1.2rem"}} size="sm">Upload first photo</Btn>}</Card>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))",gap:"1rem"}}>
        {(evt.photos||[]).map(photo=>(
          <div key={photo.id} id={`photo-${photo.id}`} style={{background:"var(--bg2)",borderRadius:"var(--radius)",border:"1px solid var(--border)",overflow:"hidden",cursor:"pointer",transition:"transform .2s"}} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-3px)"} onMouseLeave={e=>e.currentTarget.style.transform=""} onClick={()=>setLightbox(photo)}>
            <div style={{aspectRatio:"4/3",overflow:"hidden"}}><img src={photo.src} alt="" style={{width:"100%",height:"100%",objectFit:"cover",transition:"transform .3s"}} onMouseEnter={e=>e.target.style.transform="scale(1.05)"} onMouseLeave={e=>e.target.style.transform=""}/></div>
            <div style={{padding:"8px 10px"}}>
              {photo.caption&&<div style={{fontSize:".77rem",color:"var(--cream)",opacity:.75,marginBottom:4}}>{photo.caption}</div>}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:".69rem",color:"var(--muted)"}}>{photo.uploader}</div><div style={{display:"flex",gap:3}}>{REACTIONS.map(e=>{const c=(photo.reactions?.[e]||[]).length;return c?<span key={e} style={{fontSize:".7rem",background:"var(--bg3)",borderRadius:5,padding:"2px 5px"}}>{e}{c}</span>:null})}</div></div>
            </div>
          </div>
        ))}
      </div>
      {lightbox&&(
        <div className="ov" onClick={()=>setLightbox(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg2)",borderRadius:"var(--radius)",overflow:"hidden",maxWidth:680,width:"100%",border:"1px solid var(--border2)"}}>
            <img src={lightbox.src} alt="" style={{width:"100%",maxHeight:"58vh",objectFit:"contain",display:"block",background:"#000"}}/>
            <div style={{padding:"1.1rem"}}>
              <input value={lightbox.caption||""} onChange={e=>updateCaption(lightbox.id,e.target.value)} placeholder="Add a caption…" style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"9px 13px",color:"var(--cream)",fontFamily:"var(--font-b)",fontSize:".87rem",width:"100%",outline:"none",marginBottom:"1rem"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{REACTIONS.map(emoji=>{const count=(lightbox.reactions?.[emoji]||[]).length;const mine=(lightbox.reactions?.[emoji]||[]).includes(currentUser.username);return<div key={emoji} onClick={()=>react(lightbox.id,emoji)} style={{background:mine?"rgba(232,148,58,.18)":"var(--bg3)",border:mine?"1px solid var(--amber)":"1px solid var(--border)",borderRadius:8,padding:"6px 11px",cursor:can.reactPhoto(currentUser)?"pointer":"default",fontSize:".87rem",display:"flex",alignItems:"center",gap:4}}>{emoji}{count>0&&<span style={{fontSize:".73rem",color:"var(--muted)"}}>{count}</span>}</div>;})}</div>
                <div style={{display:"flex",gap:6}}>{can.deletePhoto(currentUser)&&<Btn onClick={()=>deletePhoto(lightbox.id)} variant="danger" size="sm">🗑 Delete</Btn>}<Btn onClick={()=>setLightbox(null)} variant="ghost" size="sm">Close</Btn></div>
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:"1rem"}}>Uploaded by {lightbox.uploader} · {new Date(lightbox.uploadedAt).toLocaleDateString("nl-NL")}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// WINNERS TAB
// ─────────────────────────────────────────────────────────────────────────────
const WinnersTab=({evt,onUpdate,currentUser,isPast})=>{
  const [addingW,setAddingW]=useState(false);const [addingH,setAddingH]=useState(false);
  const [editW,setEditW]=useState(null);const [editH,setEditH]=useState(null);
  const winners=evt.winners||[];const highlights=evt.highlights||[];
  const saveW=w=>onUpdate({...evt,winners:w});const saveH=h=>onUpdate({...evt,highlights:h});
  const isAdmin=can.addWinner(currentUser);
  const quizWinners=(evt.quizzes||[]).filter(q=>q.status==="finished"&&q.scores&&Object.keys(q.scores).length>0).map(quiz=>{
    const isTeam=(quiz.teams||[]).length>0;
    const sorted=Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1]);
    if(!sorted.length)return null;
    const [topName,topScore]=sorted[0];
    const team=isTeam?(quiz.teams||[]).find(t=>t.name===topName):null;
    const detail=isTeam&&team?.members?.length?`${topScore} pts · ${team.members.join(", ")}`:`${topScore} pts`;
    return{id:`quiz-winner-${quiz.id}`,icon:isTeam?(team?.avatar||"🎯"):"🧠",category:`🧠 ${quiz.title}`,winner:topName,detail,topScore};
  }).filter(Boolean);
  return(
    <div style={{display:"grid",gap:"1.8rem"}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>🏆 Awards & Winners</H>
          {isAdmin&&<Btn onClick={()=>setAddingW(true)} size="sm">+ Add Award</Btn>}
        </div>
        {winners.length===0&&quizWinners.length===0&&<Card style={{textAlign:"center",padding:"2.5rem",color:"var(--muted)"}}><div style={{fontSize:"2.5rem",marginBottom:".8rem"}}>🏆</div><div style={{fontFamily:"var(--font-h)",marginBottom:".4rem"}}>No awards yet</div></Card>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:"1rem"}}>
          {quizWinners.map(w=>(
            <div key={w.id} style={{background:"var(--bg2)",border:"1px solid rgba(139,92,246,.35)",borderRadius:"var(--radius)",padding:"1.2rem",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#6c63ff,#a78bfa,#6c63ff)"}}/>
              <div style={{position:"absolute",top:8,right:10,fontSize:".6rem",background:"rgba(139,92,246,.18)",color:"#a78bfa",borderRadius:4,padding:"1px 7px",letterSpacing:".07em",fontWeight:700}}>AUTO</div>
              <div style={{fontSize:"1.8rem",marginBottom:".5rem"}}>{w.icon}</div>
              <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:3}}>{w.category}</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.25rem",color:"#a78bfa",marginBottom:5}}>{w.winner}</div>
              {w.detail&&<div style={{fontSize:".81rem",color:"var(--cream)",opacity:.7,lineHeight:1.5}}>{w.detail}</div>}
            </div>
          ))}
          {winners.map(w=>(
            <div key={w.id} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.2rem",position:"relative",overflow:"hidden",transition:"border-color .2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,var(--gold),var(--amber2),var(--gold))"}}/>
              <div style={{fontSize:"1.8rem",marginBottom:".5rem"}}>{w.icon||"🏆"}</div>
              <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:3}}>{w.category}</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.25rem",color:"var(--amber2)",marginBottom:5}}>{w.winner}</div>
              {w.detail&&<div style={{fontSize:".81rem",color:"var(--cream)",opacity:.7,lineHeight:1.5}}>{w.detail}</div>}
              {isAdmin&&<div style={{display:"flex",gap:6,marginTop:"1rem"}}><Btn onClick={()=>setEditW(w)} variant="ghost" size="sm" style={{padding:"5px 11px",fontSize:".72rem"}}>✎</Btn><Btn onClick={()=>saveW(winners.filter(x=>x.id!==w.id))} variant="danger" size="sm" style={{padding:"5px 11px",fontSize:".72rem"}}>✕</Btn></div>}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>✨ Highlights & Stories</H>
          {isAdmin&&<Btn onClick={()=>setAddingH(true)} size="sm">+ Add</Btn>}
        </div>
        {highlights.length===0&&<Card style={{textAlign:"center",padding:"2.5rem",color:"var(--muted)"}}><div style={{fontSize:"2.5rem",marginBottom:".8rem"}}>✨</div><div style={{fontFamily:"var(--font-h)"}}>No highlights yet</div></Card>}
        <div style={{display:"grid",gap:".8rem"}}>
          {highlights.map(h=>(
            <div key={h.id} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.1rem 1.3rem",display:"flex",gap:"1rem",alignItems:"flex-start",transition:"border-color .2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <div style={{fontSize:"1.5rem",flexShrink:0,marginTop:2}}>{h.emoji||"✨"}</div>
              <div style={{flex:1,fontSize:".89rem",color:"var(--cream)",lineHeight:1.6}}>{h.text}</div>
              {isAdmin&&<div style={{display:"flex",gap:5,flexShrink:0}}><Btn onClick={()=>setEditH(h)} variant="ghost" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>✎</Btn><Btn onClick={()=>saveH(highlights.filter(x=>x.id!==h.id))} variant="danger" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>✕</Btn></div>}
            </div>
          ))}
        </div>
      </div>
      {(addingW||editW)&&<Modal onClose={()=>{setAddingW(false);setEditW(null)}} maxWidth={440}><WinnerForm initial={editW} attendees={evt.attendees.map(a=>a.name)} onSave={w=>{editW?saveW(winners.map(x=>x.id===w.id?w:x)):saveW([...winners,{...w,id:`w${Date.now()}`}]);setAddingW(false);setEditW(null)}} onClose={()=>{setAddingW(false);setEditW(null)}}/></Modal>}
      {(addingH||editH)&&<Modal onClose={()=>{setAddingH(false);setEditH(null)}} maxWidth={440}><HighlightForm initial={editH} onSave={h=>{editH?saveH(highlights.map(x=>x.id===h.id?h:x)):saveH([...highlights,{...h,id:`h${Date.now()}`}]);setAddingH(false);setEditH(null)}} onClose={()=>{setAddingH(false);setEditH(null)}}/></Modal>}
    </div>
  );
};

const WinnerForm=({initial,attendees,onSave,onClose})=>{
  const [d,setD]=useState(initial||{category:"",winner:"",detail:"",icon:"🏆"});
  const [ip,setIp]=useState(false);
  return(<><H>{initial?"Edit Award":"New Award"}</H><div style={{display:"grid",gap:".85rem"}}><div><Lbl>Icon</Lbl><div style={{position:"relative",display:"inline-block"}}><button onClick={()=>setIp(!ip)} style={{width:44,height:44,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",cursor:"pointer",fontSize:"22px"}}>{d.icon}</button>{ip&&<div style={{position:"absolute",top:48,left:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:8,display:"flex",flexWrap:"wrap",gap:4,width:228,zIndex:10}}>{TROPHY_ICONS.map(ic=><button key={ic} onClick={()=>{setD({...d,icon:ic});setIp(false)}} style={{background:d.icon===ic?"rgba(232,148,58,.2)":"transparent",border:"none",borderRadius:6,cursor:"pointer",fontSize:"19px",width:34,height:34}}>{ic}</button>)}</div>}</div></div><div><Lbl>Category</Lbl><Inp value={d.category} onChange={e=>setD({...d,category:e.target.value})} placeholder="🏎️ Go-Kart Winner"/></div><div><Lbl>Winner</Lbl><select value={d.winner} onChange={e=>setD({...d,winner:e.target.value})} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:d.winner?"var(--cream)":"var(--muted)",fontSize:".88rem",width:"100%"}}><option value="">Select…</option>{attendees.map(n=><option key={n} value={n}>{n}</option>)}<option value="Everyone">Everyone 🎉</option><option value="Nobody">Nobody 💀</option></select></div><div><Lbl>Story</Lbl><Inp value={d.detail} onChange={e=>setD({...d,detail:e.target.value})} placeholder="What happened?" multiline/></div><div style={{display:"flex",gap:8}}><Btn onClick={()=>onSave(d)} disabled={!d.category.trim()||!d.winner}>Save</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div></div></>);
};

const HighlightForm=({initial,onSave,onClose})=>{
  const [d,setD]=useState(initial||{text:"",emoji:"✨"});
  return(<><H>{initial?"Edit":"New Highlight"}</H><div style={{display:"grid",gap:".85rem"}}><div><Lbl>Emoji</Lbl><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{HIGHLIGHT_EMOJIS.map(e=><button key={e} onClick={()=>setD({...d,emoji:e})} style={{width:36,height:36,background:d.emoji===e?"rgba(232,148,58,.25)":"var(--bg3)",border:d.emoji===e?"1px solid var(--amber)":"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:"18px"}}>{e}</button>)}</div></div><div><Lbl>The story</Lbl><Inp value={d.text} onChange={e=>setD({...d,text:e.target.value})} placeholder="What happened?" multiline style={{minHeight:90}}/></div><div style={{display:"flex",gap:8}}><Btn onClick={()=>onSave(d)} disabled={!d.text.trim()}>Save</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div></div></>);
};

// ─────────────────────────────────────────────────────────────────────────────
// FAQ TAB
// ─────────────────────────────────────────────────────────────────────────────
const FAQTab=({evt,onUpdate,currentUser})=>{
  const isAdmin=can.editEvent(currentUser);
  const faqs=evt.faqs||[];
  const saveFaqs=f=>onUpdate({...evt,faqs:f});

  const [asking,setAsking]=useState(false);
  const [question,setQuestion]=useState("");
  const [answeringId,setAnsweringId]=useState(null);
  const [answerText,setAnswerText]=useState("");
  const [expanded,setExpanded]=useState(()=>new Set());
  const [hoveredFaq,setHoveredFaq]=useState(null);
  const toggle=id=>setExpanded(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});

  const submitQuestion=()=>{
    const q=question.trim();
    if(!q)return;
    saveFaqs([...faqs,{id:`faq-${Date.now()}`,question:q,askedBy:currentUser.username,askedAt:new Date().toISOString(),answer:null,answeredBy:null,answeredAt:null}]);
    setQuestion("");setAsking(false);
  };

  const submitAnswer=(id)=>{
    const a=answerText.trim();
    if(!a)return;
    saveFaqs(faqs.map(f=>f.id===id?{...f,answer:a,answeredBy:currentUser.username,answeredAt:new Date().toISOString()}:f));
    setAnsweringId(null);setAnswerText("");
  };

  const deleteQuestion=(id)=>saveFaqs(faqs.filter(f=>f.id!==id));

  const unanswered=faqs.filter(f=>!f.answer);
  const answered=faqs.filter(f=>f.answer);
  const myPending=unanswered.filter(f=>f.askedBy===currentUser.username);
  const visible=isAdmin?[...unanswered,...answered]:[...myPending,...answered];

  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".8rem"}}>
        <div style={{fontSize:".82rem",color:"var(--muted)"}}>{faqs.length} question{faqs.length!==1?"s":""} · {answered.length} answered</div>
        <Btn onClick={()=>setAsking(true)} size="sm">+ Ask a question</Btn>
      </div>

      {faqs.length===0&&(
        <Card style={{textAlign:"center",padding:"3rem",color:"var(--muted)"}}>
          <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>❓</div>
          <div style={{fontFamily:"var(--font-h)",marginBottom:".4rem"}}>No questions yet</div>
          <div style={{fontSize:".83rem"}}>Be the first to ask something about this event.</div>
        </Card>
      )}

      <div style={{display:"grid",gap:".45rem"}}>
        {visible.map(f=>{
          const isOpen=expanded.has(f.id);
          const hasAnswer=!!f.answer;
          const isOwn=f.askedBy===currentUser.username;
          const isAnswering=answeringId===f.id;
          const borderColor=!hasAnswer&&isAdmin?"rgba(232,148,58,.3)":!hasAnswer&&isOwn?"rgba(90,155,213,.25)":"var(--border)";
          return(
            <div key={f.id} id={`faq-${f.id}`} style={{background:"var(--bg2)",border:`1px solid ${isOpen?( !hasAnswer&&isAdmin?"rgba(232,148,58,.5)":!hasAnswer&&isOwn?"rgba(90,155,213,.45)":"var(--border2)"):borderColor}`,borderRadius:"var(--radius)",overflow:"hidden",transition:"border-color .2s"}}>
              <div
                onClick={()=>toggle(f.id)}
                onMouseEnter={()=>setHoveredFaq(f.id)}
                onMouseLeave={()=>setHoveredFaq(null)}
                style={{display:"flex",alignItems:"center",gap:"1rem",padding:".8rem 1.1rem",cursor:"pointer",userSelect:"none",background:hoveredFaq===f.id&&!isOpen?"rgba(255,255,255,.03)":"transparent",transition:"background .15s"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:".9rem",color:hasAnswer?"var(--amber2)":"var(--cream)"}}>{f.question}</div>
                  <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:2}}>
                    {hasAnswer?`✓ ${f.answeredBy}`:isOwn?"⏳ Waiting for an answer…":`Asked by ${f.askedBy}`}
                  </div>
                </div>
                {!hasAnswer&&isAdmin&&<Tag color="var(--amber)" style={{flexShrink:0,fontSize:".65rem"}}>Unanswered</Tag>}
                {!hasAnswer&&!isAdmin&&isOwn&&<Tag color="var(--blue)" style={{flexShrink:0,fontSize:".65rem"}}>Pending</Tag>}
                <span style={{color:"var(--muted)",fontSize:"1.1rem",flexShrink:0,transition:"transform .22s cubic-bezier(.4,0,.2,1)",transform:isOpen?"rotate(90deg)":"none",display:"inline-block"}}>›</span>
              </div>
              <div style={{maxHeight:isOpen?"600px":"0",overflow:"hidden",transition:"max-height .3s cubic-bezier(.4,0,.2,1)"}}>
                <div style={{borderTop:"1px solid var(--border)",padding:".8rem 1.1rem",opacity:isOpen?1:0,transform:isOpen?"translateY(0)":"translateY(-6px)",transition:"opacity .22s ease .05s, transform .22s ease .05s"}}>
                  {hasAnswer?(
                    <div>
                      <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{width:3,borderRadius:2,background:"var(--amber)",flexShrink:0,alignSelf:"stretch",minHeight:16}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:".88rem",color:"var(--cream)",lineHeight:1.65}}>{f.answer}</div>
                          <div style={{fontSize:".71rem",color:"var(--muted)",marginTop:5}}>
                            Answered by <strong style={{color:"var(--amber)"}}>{f.answeredBy}</strong>
                            {" · "}{new Date(f.answeredAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}
                            {" · Asked by "}{f.askedBy}
                          </div>
                        </div>
                      </div>
                      {isAdmin&&<div style={{marginTop:".7rem"}}><Btn onClick={()=>deleteQuestion(f.id)} variant="danger" size="sm">✕ Delete</Btn></div>}
                    </div>
                  ):isAdmin?(
                    <div style={{display:"grid",gap:".6rem"}}>
                      <div style={{fontSize:".72rem",color:"var(--muted)"}}>Asked by <strong style={{color:"var(--cream)"}}>{f.askedBy}</strong> · {new Date(f.askedAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}</div>
                      {isAnswering?(
                        <>
                          <Inp value={answerText} onChange={e=>setAnswerText(e.target.value)} placeholder="Type your answer…" multiline rows={3} autoFocus/>
                          <div style={{display:"flex",gap:6}}>
                            <Btn onClick={()=>submitAnswer(f.id)} disabled={!answerText.trim()} size="sm">Post Answer</Btn>
                            <Btn onClick={()=>{setAnsweringId(null);setAnswerText("");}} variant="ghost" size="sm">Cancel</Btn>
                          </div>
                        </>
                      ):(
                        <div style={{display:"flex",gap:6}}>
                          <Btn onClick={()=>{setAnsweringId(f.id);setAnswerText("");}} variant="subtle" size="sm">Answer</Btn>
                          <Btn onClick={()=>deleteQuestion(f.id)} variant="danger" size="sm">✕</Btn>
                        </div>
                      )}
                    </div>
                  ):(
                    <div style={{fontSize:".83rem",color:"var(--muted)"}}>The admin will answer this soon.</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {asking&&(
        <Modal onClose={()=>setAsking(false)} maxWidth={480}>
          <H>Ask a question</H>
          <div style={{display:"grid",gap:".9rem"}}>
            <div>
              <Lbl>Your question</Lbl>
              <Inp value={question} onChange={e=>setQuestion(e.target.value)} placeholder="e.g. Do we need to bring cash?" multiline rows={3} autoFocus onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&submitQuestion()}/>
            </div>
            <div style={{fontSize:".78rem",color:"var(--muted)"}}>The admin/host will answer your question and it'll show up here for everyone to see.</div>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={submitQuestion} disabled={!question.trim()}>Submit</Btn>
              <Btn onClick={()=>{setAsking(false);setQuestion("")}} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ANNOUNCEMENTS
// ─────────────────────────────────────────────────────────────────────────────
const KretjesTab=({evt,onUpdate,currentUser})=>{
  const count=evt.kretjes||0;
  const canEdit=ACTIVE_ROLES.includes(currentUser?.role);
  const change=delta=>{
    if(!canEdit)return;
    const next=Math.max(0,count+delta);
    onUpdate({...evt,kretjes:next});
  };
  const btnStyle=(disabled)=>({
    width:64,height:64,borderRadius:"50%",border:"2px solid rgba(232,148,58,.4)",
    background:disabled?"var(--bg3)":"rgba(232,148,58,.1)",
    color:disabled?"var(--muted)":"var(--amber2)",cursor:disabled?"default":"pointer",
    fontSize:"2rem",fontWeight:300,lineHeight:1,
    display:"flex",alignItems:"center",justifyContent:"center",
    transition:"all .15s",fontFamily:"var(--font-b)",flexShrink:0,
  });
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"3rem 1rem",gap:"2rem"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:"3rem",marginBottom:".4rem"}}>🍺</div>
        <div style={{fontFamily:"var(--font-h)",fontSize:".75rem",color:"var(--muted)",letterSpacing:".18em",textTransform:"uppercase"}}>Kretjes deze editie</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"2rem"}}>
        <button
          style={btnStyle(!canEdit||count===0)}
          disabled={!canEdit||count===0}
          onMouseEnter={e=>{if(canEdit&&count>0){e.currentTarget.style.background="rgba(232,148,58,.2)";e.currentTarget.style.borderColor="var(--amber)";}}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(232,148,58,.1)";e.currentTarget.style.borderColor="rgba(232,148,58,.4)";}}
          onClick={()=>change(-1)}>−</button>
        <div style={{textAlign:"center",minWidth:120}}>
          <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(4rem,12vw,7rem)",color:"var(--amber2)",lineHeight:1,fontWeight:900,letterSpacing:"-.02em"}}>{count}</div>
        </div>
        <button
          style={btnStyle(!canEdit)}
          disabled={!canEdit}
          onMouseEnter={e=>{if(canEdit){e.currentTarget.style.background="rgba(232,148,58,.2)";e.currentTarget.style.borderColor="var(--amber)";}}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(232,148,58,.1)";e.currentTarget.style.borderColor="rgba(232,148,58,.4)";}}
          onClick={()=>change(1)}>+</button>
      </div>
      <div style={{fontSize:".78rem",color:"var(--muted)",textAlign:"center",maxWidth:260,lineHeight:1.6}}>
        {canEdit?"Tap + of − om het aantal bij te werken. Telt mee in de totaaltelling op de homepage.":"Alleen actieve lads kunnen het aantal aanpassen."}
      </div>
    </div>
  );
};

const renderMd=text=>{
  if(!text)return"";
  const inline=s=>s
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,"<em>$1</em>")
    .replace(/~~(.+?)~~/g,"<del>$1</del>")
    .replace(/`(.+?)`/g,"<code style='background:rgba(255,255,255,.1);padding:1px 6px;border-radius:4px;font-family:monospace;font-size:.9em'>$1</code>");
  const safe=text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const lines=safe.split("\n");
  let html="",listItems=[],lastWasList=false;
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^[-*]\s+(.*)/);
    if(m){listItems.push(`<li>${inline(m[1])}</li>`);}
    else{
      if(listItems.length){html+=`<ul style='margin:.25em 0 .35em 1.3em;padding:0'>${listItems.join("")}</ul>`;listItems=[];lastWasList=true;}
      else lastWasList=false;
      if(html&&!lastWasList)html+="<br/>";
      html+=inline(lines[i]);lastWasList=false;
    }
  }
  if(listItems.length)html+=`<ul style='margin:.25em 0 .35em 1.3em;padding:0'>${listItems.join("")}</ul>`;
  return html;
};

const RichTextInput=({value,onChange,placeholder,rows=4})=>{
  const ta=useRef();
  const wrap=(a,b)=>{
    const el=ta.current;if(!el)return;
    const s=el.selectionStart,e=el.selectionEnd;
    const sel=value.slice(s,e)||"tekst";
    onChange(value.slice(0,s)+a+sel+b+value.slice(e));
    setTimeout(()=>{el.selectionStart=s+a.length;el.selectionEnd=s+a.length+sel.length;el.focus();},0);
  };
  const insertList=()=>{
    const el=ta.current;if(!el)return;
    const pos=el.selectionStart,before=value.slice(0,pos);
    const atLineStart=pos===0||before.endsWith("\n");
    const prefix=atLineStart?"- ":"\n- ";
    const next=before+prefix+value.slice(pos);
    onChange(next);
    setTimeout(()=>{el.selectionStart=el.selectionEnd=pos+prefix.length;el.focus();},0);
  };
  const btnStyle={background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:6,color:"var(--cream)",padding:"4px 10px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",transition:"all .15s"};
  const hover={onMouseEnter:e=>{e.currentTarget.style.background="var(--bg4)";e.currentTarget.style.borderColor="var(--border2)";},onMouseLeave:e=>{e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.borderColor="var(--border)";}};
  const tools=[["B","**","**",{fontWeight:700}],["I","*","*",{fontStyle:"italic"}],["S̶","~~","~~",{textDecoration:"line-through"}],["</>","`","`",{fontFamily:"monospace",fontSize:".82rem"}]];
  return(
    <div>
      <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap"}}>
        {tools.map(([icon,a,b,s])=>(
          <button key={icon} type="button" onClick={()=>wrap(a,b)} {...hover} style={{...btnStyle,...s}}>{icon}</button>
        ))}
        <button type="button" onClick={insertList} {...hover} style={btnStyle}>• Lijst</button>
        <span style={{fontSize:".7rem",color:"var(--muted)",alignSelf:"center",marginLeft:4}}>Selecteer + stijl</span>
      </div>
      <textarea ref={ta} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%",outline:"none",resize:"vertical",fontFamily:"var(--font-b)",lineHeight:1.6}}/>
    </div>
  );
};

const AnnouncementModal=({onSave,onClose,existing=null,currentUser})=>{
  const [title,setTitle]=useState(existing?.title||"");
  const [body,setBody]=useState(existing?.body||"");
  const save=()=>{
    if(!title.trim())return;
    onSave({
      id:existing?.id||`ann-${Date.now()}`,
      title:title.trim(),body,
      createdBy:currentUser.username,
      createdAt:existing?.createdAt||new Date().toISOString(),
    });
  };
  return(
    <Modal onClose={onClose} maxWidth={560}>
      <H>📢 {existing?"Edit":"New"} Announcement</H>
      <div style={{display:"grid",gap:".9rem"}}>
        <div><Lbl>Title</Lbl><Inp value={title} onChange={e=>setTitle(e.target.value)} placeholder="What's the news?" autoFocus/></div>
        <div>
          <Lbl>Message</Lbl>
          <RichTextInput value={body} onChange={setBody} placeholder={"Schrijf je bericht… Gebruik **bold**, *italic*, ~~doorhalen~~, `code`"}/>
        </div>
        {body&&(
          <div>
            <Lbl>Preview</Lbl>
            <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"12px 14px",fontSize:".88rem",color:"var(--cream)",lineHeight:1.65}} dangerouslySetInnerHTML={{__html:renderMd(body)}}/>
          </div>
        )}
        <div style={{display:"flex",gap:8}}><Btn onClick={save} disabled={!title.trim()}>📢 Publiceren</Btn><Btn onClick={onClose} variant="ghost">Annuleren</Btn></div>
      </div>
    </Modal>
  );
};

const AnnouncementBanner=({announcements,currentUser,onArchive,onHardDelete,onReactivate,onEdit,onNew})=>{
  const canAnnounce=can.announce(currentUser);
  const [dismissed,setDismissed]=useState(()=>{try{return JSON.parse(localStorage.getItem("ann-dismissed")||"[]");}catch{return[];}});
  const [showArchive,setShowArchive]=useState(false);
  const dismiss=id=>{const n=[...dismissed,id];setDismissed(n);localStorage.setItem("ann-dismissed",JSON.stringify(n));};
  const active=announcements.filter(a=>a.active!==false);
  const archived=announcements.filter(a=>a.active===false);
  const visible=active.filter(a=>!dismissed.includes(a.id));
  if(visible.length===0&&!canAnnounce)return null;
  return(
    <div style={{marginBottom:"1.4rem"}}>
      {canAnnounce&&<div style={{display:"flex",justifyContent:"flex-end",gap:6,marginBottom:visible.length>0?".6rem":"0"}}>
        {archived.length>0&&<Btn onClick={()=>setShowArchive(v=>!v)} variant="ghost" size="sm" style={{color:"var(--muted)",borderColor:"var(--border)",fontSize:".78rem"}}>📁 Archief ({archived.length})</Btn>}
        <Btn onClick={onNew} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"var(--border2)",fontSize:".78rem"}}>📢 Aankondiging</Btn>
      </div>}
      {visible.map(ann=>(
        <div key={ann.id} className="ann-banner" style={{
          position:"relative",overflow:"hidden",marginBottom:".75rem",
          background:"linear-gradient(135deg,#1c1100 0%,#2e1900 50%,#1c1100 100%)",
          border:"1px solid rgba(232,148,58,.45)",borderLeft:"4px solid var(--amber)",
          borderRadius:"var(--radius)",padding:"1.1rem 1.4rem",
        }}>
          <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 55% 90% at 5% 50%,rgba(232,148,58,.1),transparent 55%)",pointerEvents:"none"}}/>
          <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,var(--amber),var(--gold),var(--amber2),transparent 70%)",opacity:.65,pointerEvents:"none"}}/>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:".45rem",flexWrap:"wrap"}}>
                <span style={{fontSize:"1.05rem",filter:"drop-shadow(0 0 6px rgba(232,148,58,.6))"}}>📢</span>
                <span style={{fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)",fontWeight:700,lineHeight:1.2}}>{ann.title}</span>
              </div>
              {ann.body&&<div style={{fontSize:".88rem",color:"var(--cream)",lineHeight:1.68,opacity:.92}} dangerouslySetInnerHTML={{__html:renderMd(ann.body)}}/>}
              <div style={{fontSize:".68rem",color:"var(--muted)",marginTop:".55rem",letterSpacing:".04em"}}>
                {ann.createdBy} · {new Date(ann.createdAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}
              </div>
            </div>
            <div style={{display:"flex",gap:5,flexShrink:0}}>
              {canAnnounce&&<Btn onClick={()=>onEdit(ann)} variant="ghost" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>✎</Btn>}
              {canAnnounce&&<Btn onClick={()=>onArchive(ann.id)} variant="danger" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>↓</Btn>}
              {!canAnnounce&&<button onClick={()=>dismiss(ann.id)} onMouseEnter={e=>{e.currentTarget.style.color="var(--cream)";}} onMouseLeave={e=>{e.currentTarget.style.color="var(--muted)";}} style={{background:"transparent",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:"1rem",padding:"2px 6px",lineHeight:1,transition:"color .15s"}}>✕</button>}
            </div>
          </div>
        </div>
      ))}
      {canAnnounce&&showArchive&&archived.length>0&&(
        <div style={{border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",overflow:"hidden",marginTop:".4rem"}}>
          <div style={{padding:".6rem 1rem",background:"var(--bg2)",fontSize:".72rem",color:"var(--muted)",letterSpacing:".1em",textTransform:"uppercase"}}>Gearchiveerde aankondigingen</div>
          {archived.map(ann=>(
            <div key={ann.id} style={{display:"flex",alignItems:"center",gap:10,padding:".65rem 1rem",borderTop:"1px solid var(--border)",background:"var(--bg)"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:".84rem",color:"var(--cream)",opacity:.7,fontWeight:600}}>{ann.title}</div>
                <div style={{fontSize:".68rem",color:"var(--muted)",marginTop:2}}>{ann.createdBy} · {new Date(ann.createdAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}</div>
              </div>
              <Btn onClick={()=>onReactivate(ann.id)} variant="ghost" size="sm" style={{fontSize:".72rem",color:"var(--amber)",borderColor:"rgba(232,148,58,.3)"}}>↑ Activeren</Btn>
              <Btn onClick={()=>onHardDelete(ann.id)} variant="danger" size="sm" style={{fontSize:".72rem",padding:"4px 8px"}}>✕</Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PRESENTATION MODE
// ─────────────────────────────────────────────────────────────────────────────
// `isSolo` is a third, additive mode (not folded into `isPresenter`, to avoid
// touching the ~15 existing isPresenter checks below that presenter/viewer
// already depend on): a solo browser navigates freely like a presenter, but
// never creates/joins/broadcasts on the sched-<id> channel and never reveals
// secrets or writes to the event, like a viewer. Every render/behaviour
// branch below that needs to change for solo says so explicitly with
// `||isSolo`; anything unlisted (secret ??? treatment, no reveal button, no
// "X secret" counts, no LIVE badge wording) already falls out of isPresenter
// being false, same as it does for a real viewer.
const PresentationMode=({evt,onUpdate,isPresenter=true,onClose,currentLive=null,onPresenterLeft,onHide,isSolo=false})=>{
  const allStops=evt.schedule||[];
  const total=allStops.length+1;
  // Display order only, by (day,time) -- everything below that addresses a
  // stop by index (revealedSecrets, toggleReveal's mutation, the broadcast
  // payload) still uses its real index in `allStops`/evt.schedule via
  // `order[n]`, so sync/secret-reveal/keyboard/fullscreen behaviour is
  // unchanged; only which index is shown at slide position n+1 changes.
  const order=allStops.map((_,i)=>i).sort((a,b)=>scheduleDayTimeOrder(allStops[a],allStops[b]));
  const isMultiDay=eventDayCount(evt.date,evt.end_date)>1;
  const isMobile=useIsMobile();
  const [idx,setIdx]=useState(isPresenter?0:(currentLive?.idx||0));
  const [revealedSecrets,setRevealedSecrets]=useState(()=>currentLive?.revealedSecrets||[]);
  const [fading,setFading]=useState(false);
  const [locallyDismissed,setLocallyDismissed]=useState(false);
  const idxRef=useRef(isPresenter?0:(currentLive?.idx||0));
  const revealedRef=useRef(currentLive?.revealedSecrets||[]);
  const evtRef=useRef(evt);
  const chRef=useRef(null);
  const onPresenterLeftRef=useRef(onPresenterLeft);
  useEffect(()=>{onPresenterLeftRef.current=onPresenterLeft;},[onPresenterLeft]);
  useEffect(()=>{evtRef.current=evt;},[evt]);
  useEffect(()=>{idxRef.current=idx;},[idx]);
  useEffect(()=>{revealedRef.current=revealedSecrets;},[revealedSecrets]);

  // Channel setup: Presence for detection/initial-state, Broadcast for real-time slide sync.
  // Solo never runs any of this -- no channel is created at all (not
  // created-and-unused: the `supabase.channel(...)` call itself is skipped),
  // so a solo browser can never join, subscribe to, or broadcast on the live
  // presentation channel.
  useEffect(()=>{
    if(isSolo)return;
    const ch=supabase.channel(`sched-${evtRef.current.id}`);
    chRef.current=ch;
    if(isPresenter){
      // Presence lets late-joining viewers get the current slide on subscribe
      ch.subscribe(async status=>{
        if(status==='SUBSCRIBED'){
          ch.track({presenting:true,idx:idxRef.current,revealedSecrets:revealedRef.current});
        }
      });
    } else {
      let seenPresenter=false;
      const applySlide=(ni,rs)=>{
        seenPresenter=true;
        if(ni!==idxRef.current){setFading(true);setTimeout(()=>{setIdx(ni);setFading(false);},230);}
        setRevealedSecrets(rs??[]);
      };
      ch
        // Presence: initial state for late joiners + detect presenter left
        .on('presence',{event:'sync'},()=>{
          const st=ch.presenceState();
          const p=Object.values(st).flat().find(x=>x.presenting);
          if(!p){
            if(seenPresenter){onPresenterLeftRef.current?.();setLocallyDismissed(true);}
            return;
          }
          if(!seenPresenter) applySlide(p.idx??0,p.revealedSecrets);
        })
        // Broadcast: real-time slide changes (fires reliably for every track update)
        .on('broadcast',{event:'slide'},({payload})=>{
          applySlide(payload.idx??0,payload.revealedSecrets);
        })
        .subscribe();
    }
    return()=>{if(chRef.current){supabase.removeChannel(chRef.current);chRef.current=null;}};
  },[isPresenter,isSolo]);

  // Presenter: broadcast slide change + update presence for late joiners
  useEffect(()=>{
    if(!isPresenter||!chRef.current)return;
    chRef.current.track({presenting:true,idx,revealedSecrets:revealedRef.current});
    chRef.current.send({type:'broadcast',event:'slide',payload:{idx,revealedSecrets:revealedRef.current}});
  },[idx,isPresenter]);

  const toggleReveal=useCallback(stopIdx=>{
    const cur=revealedRef.current;
    const revealing=!cur.includes(stopIdx);
    const next=revealing?[...cur,stopIdx]:cur.filter(i=>i!==stopIdx);
    setRevealedSecrets(next);
    if(chRef.current){
      chRef.current.track({presenting:true,idx:idxRef.current,revealedSecrets:next});
      chRef.current.send({type:'broadcast',event:'slide',payload:{idx:idxRef.current,revealedSecrets:next}});
    }
    const e=evtRef.current;
    const updatedSchedule=(e.schedule||[]).map((s,i)=>i===stopIdx?{...s,secret:!revealing}:s);
    onUpdate({...e,schedule:updatedSchedule});
  },[onUpdate]);

  const handleClose=useCallback(()=>{
    if(isPresenter||isSolo){
      if(chRef.current)chRef.current.untrack();
      onClose();
    } else {
      onHide?.(); // tell EventPage to set viewerDismissed — it unmounts us and shows the banner
    }
  },[isPresenter,isSolo,onClose,onHide]);

  const goTo=useCallback(n=>{
    if(!isPresenter&&!isSolo)return;
    if(n<0||n>=total)return;
    setFading(true);
    setTimeout(()=>{setIdx(n);setFading(false);},230);
  },[total,isPresenter,isSolo]);

  useEffect(()=>{
    if(!isPresenter&&!isSolo)return;
    const h=e=>{
      if(e.key==="ArrowRight"||e.key==="ArrowDown")goTo(idxRef.current+1);
      else if(e.key==="ArrowLeft"||e.key==="ArrowUp")goTo(idxRef.current-1);
      else if(e.key==="Escape")handleClose();
    };
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[goTo,handleClose,isPresenter,isSolo]);

  useEffect(()=>{
    if(!isPresenter&&!isSolo)return; // viewers don't need fullscreen API — position:fixed already covers screen
    const el=document.documentElement;
    if(el.requestFullscreen)el.requestFullscreen().catch(()=>{});
    return()=>{if(document.exitFullscreen&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});};
  },[isPresenter,isSolo]);

  if(locallyDismissed)return null;

  const isIntro=idx===0;
  const stopIdx=isIntro?-1:order[idx-1];
  const stop=isIntro?null:allStops[stopIdx];
  const isSecret=!!stop?.secret;
  const isRevealed=revealedSecrets.includes(stopIdx);
  const isHidden=isSecret&&!isRevealed; // secret and not yet revealed
  // Only show background media when stop is visible (not hidden to viewers)
  const media=stop&&(!isHidden||isPresenter)?(stop.image||""):"";
  const isVideo=media&&/\.(mp4|webm|mov|ogg)(\?|$)/i.test(media);
  const publicCount=allStops.filter(s=>!s.secret).length;

  return(
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"#1a1408",overflow:"hidden",fontFamily:"var(--font-b)"}}>
      {/* Gold shimmer top bar */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange))",backgroundSize:"300% 100%",animation:"goldShimmer 3s linear infinite",zIndex:20}}/>
      {/* Background media */}
      {media&&(
        <div style={{position:"absolute",inset:0}}>
          {isVideo
            ?<video src={media} autoPlay muted loop playsInline style={{width:"100%",height:"100%",objectFit:"cover",opacity:.75}}/>
            :<img src={media} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.78}}/>
          }
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(6,4,0,.82) 0%,rgba(6,4,0,.42) 45%,rgba(6,4,0,.22) 100%)"}}/>
        </div>
      )}
      {!media&&!isIntro&&<div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 70% 60% at 25% 60%,rgba(201,146,42,.18),transparent 65%)"}}/>}
      {isIntro&&<div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 80% 70% at 50% 45%,rgba(232,148,58,.22),transparent 65%)"}}/>}

      {/* Top bar */}
      <div style={{position:"absolute",top:0,left:0,right:0,padding:"1.4rem 2rem",display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:15}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.75)",letterSpacing:".14em",textTransform:"uppercase",fontWeight:600}}>{evt.name}</div>
          {!isPresenter&&!isSolo&&<div style={{background:"rgba(232,148,58,.18)",border:"1px solid rgba(232,148,58,.45)",borderRadius:20,padding:"3px 10px",fontSize:".65rem",color:"var(--amber)",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",display:"flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:"var(--amber)",display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>LIVE</div>}
          {isPresenter&&isSecret&&!isIntro&&<div style={{background:isRevealed?"rgba(76,175,125,.18)":"rgba(224,85,85,.18)",border:`1px solid ${isRevealed?"rgba(76,175,125,.4)":"rgba(224,85,85,.4)"}`,borderRadius:20,padding:"3px 10px",fontSize:".65rem",color:isRevealed?"var(--green)":"var(--red)",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase"}}>{isRevealed?"✓ Revealed":"🔒 Secret"}</div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.75)",padding:"4px 11px",border:"1px solid rgba(255,255,255,.25)",borderRadius:20,backdropFilter:"blur(6px)"}}>{idx+1} / {total}</div>
          <button onClick={handleClose} onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.18)";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.09)";}} style={{background:"rgba(255,255,255,.09)",border:"1px solid rgba(255,255,255,.18)",borderRadius:8,color:"rgba(255,255,255,.8)",padding:"7px 15px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600,backdropFilter:"blur(8px)",transition:"background .15s"}}>{(isPresenter||isSolo)?"✕ Exit":"✕ Hide"}</button>
        </div>
      </div>

      {/* Main content */}
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:isIntro?"center":"flex-end",justifyContent:"center",padding:isIntro?"2rem":isMobile?"3rem 1.2rem 5.5rem":"3rem 5rem 5.5rem",opacity:fading?0:1,transition:"opacity .2s ease",zIndex:10}}>
        {isIntro?(
          <div style={{textAlign:"center",maxWidth:780}}>
            {(evt.type||evt.theme)&&<div style={{fontSize:".82rem",color:"var(--amber)",letterSpacing:".22em",textTransform:"uppercase",fontWeight:700,marginBottom:"1.4rem",opacity:.9}}>
              {evt.type==="weekend"?"🏕️ Weekend":"📅 Mensday"}{evt.theme&&` · ${evt.theme}`}
            </div>}
            <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(2.8rem,8vw,6rem)",color:"#fff",lineHeight:1.05,marginBottom:"1.4rem",textShadow:"0 0 60px rgba(232,148,58,.22)"}}>{evt.name}</div>
            {evt.date&&<div style={{fontSize:"1.05rem",color:"rgba(255,255,255,.8)",marginBottom:"1.1rem",letterSpacing:".02em"}}>{formatEventDateRange(evt.date,evt.end_date)}</div>}
            {evt.location&&<div style={{fontSize:"1rem",color:"var(--amber2)",opacity:.8,marginBottom:"2.8rem"}}>📍 {evt.location}</div>}
            {allStops.length>0&&<div style={{display:"flex",alignItems:"center",gap:"1rem",justifyContent:"center",color:"rgba(255,255,255,.26)",fontSize:".78rem",letterSpacing:".09em"}}>
              <div style={{height:1,width:36,background:"rgba(255,255,255,.14)"}}/>
              {publicCount} stop{publicCount!==1?"s":""} on the menu{allStops.length>publicCount&&isPresenter?` · ${allStops.length-publicCount} secret`:""}
              <div style={{height:1,width:36,background:"rgba(255,255,255,.14)"}}/>
            </div>}
          </div>
        ):(
          /* ── Viewer sees a mystery slide for unrevealed secret stops ── */
          (isHidden&&!isPresenter)?(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"clamp(3rem,8vw,6rem)",marginBottom:"1.2rem",filter:"blur(2px)"}}>🔒</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.6rem,5vw,3rem)",color:"rgba(255,255,255,.25)",lineHeight:1.1}}>???</div>
              <div style={{color:"rgba(255,255,255,.2)",fontSize:".88rem",marginTop:".8rem"}}>The organisation is keeping this one a surprise…</div>
            </div>
          ):(
            /* ── Normal stop content (visible or presenter-only view of secret) ── */
            <div style={{width:"100%",maxWidth:900}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.1rem",flexWrap:"wrap"}}>
                <span style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.4)",borderRadius:20,padding:"4px 14px",fontSize:".7rem",color:"var(--amber)",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase"}}>Stop {idx} / {allStops.length}</span>
                {isMultiDay&&<span style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.22)",borderRadius:20,padding:"4px 14px",fontSize:".7rem",color:"rgba(255,255,255,.85)",fontWeight:700,letterSpacing:".08em",textTransform:"uppercase"}}>{dayHeadingLabel(evt.date,stop.day??0)}</span>}
                {stop.time&&<span style={{fontSize:".95rem",color:"rgba(255,255,255,.8)",fontWeight:600,letterSpacing:".04em"}}>{stop.time}</span>}
                {/* Reveal/hide toggle — presenter only, for secret stops */}
                {isPresenter&&isSecret&&(
                  <button onClick={()=>toggleReveal(stopIdx)}
                    style={{marginLeft:"auto",background:isRevealed?"rgba(224,85,85,.18)":"rgba(76,175,125,.18)",border:`1px solid ${isRevealed?"rgba(224,85,85,.45)":"rgba(76,175,125,.45)"}`,borderRadius:10,color:isRevealed?"var(--red)":"var(--green)",padding:"7px 18px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:700,backdropFilter:"blur(8px)",display:"flex",alignItems:"center",gap:6,transition:"all .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.opacity=".8"}
                    onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                    {isRevealed?"🔒 Hide from viewers":"👁 Reveal to viewers"}
                  </button>
                )}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"1.3rem",marginBottom:"1rem",flexWrap:"wrap"}}>
                {stop.icon&&<span style={{fontSize:"clamp(2rem,5vw,3.5rem)",lineHeight:1,filter:"drop-shadow(0 4px 24px rgba(232,148,58,.35))"}}>{stop.icon}</span>}
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.9rem,5.5vw,4rem)",color:"#fff",lineHeight:1.08,textShadow:"0 2px 30px rgba(0,0,0,.55)"}}>{stop.activity}</div>
              </div>
              {stop.location&&<div style={{fontSize:"1rem",color:"rgba(255,255,255,.82)",marginBottom:".5rem",display:"flex",alignItems:"center",gap:7}}>
                <span>📍</span>
                {stop.locationUrl?<a href={stop.locationUrl} target="_blank" rel="noreferrer" style={{color:"var(--amber2)",textDecoration:"none"}}>{stop.location}</a>:<span>{stop.location}</span>}
              </div>}
              {stop.note&&<div style={{fontSize:".95rem",color:"rgba(255,255,255,.72)",fontStyle:"italic",lineHeight:1.6,maxWidth:640,marginTop:4}}>{stop.note}</div>}
            </div>
          )
        )}
      </div>

      {/* Prev button — presenter and solo (free navigation) */}
      {(isPresenter||isSolo)&&idx>0&&<button onClick={()=>goTo(idx-1)}
        onMouseEnter={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.1)":"rgba(255,255,255,.15)";}}
        onMouseLeave={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)";}}
        style={{position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",background:isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)",border:isMobile?"none":"1px solid rgba(255,255,255,.14)",borderRadius:isMobile?"0 10px 10px 0":12,color:isMobile?"rgba(255,255,255,.5)":"#fff",width:isMobile?36:52,height:isMobile?72:52,cursor:"pointer",fontSize:isMobile?"1rem":"1.3rem",display:"flex",alignItems:"center",justifyContent:"center",zIndex:15,transition:"background .15s",backdropFilter:"blur(8px)"}}>←</button>}
      {/* Next button — presenter and solo (free navigation) */}
      {(isPresenter||isSolo)&&idx<total-1&&<button onClick={()=>goTo(idx+1)}
        onMouseEnter={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.1)":"rgba(255,255,255,.15)";}}
        onMouseLeave={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)";}}
        style={{position:"absolute",right:0,top:"50%",transform:"translateY(-50%)",background:isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)",border:isMobile?"none":"1px solid rgba(255,255,255,.14)",borderRadius:isMobile?"10px 0 0 10px":12,color:isMobile?"rgba(255,255,255,.5)":"#fff",width:isMobile?36:52,height:isMobile?72:52,cursor:"pointer",fontSize:isMobile?"1rem":"1.3rem",display:"flex",alignItems:"center",justifyContent:"center",zIndex:15,transition:"background .15s",backdropFilter:"blur(8px)"}}>→</button>}

      {/* Dot navigation — clickable for presenter; secret=red dot, revealed=green dot */}
      <div style={{position:"absolute",bottom:"1.2rem",left:0,right:0,display:"flex",justifyContent:"center",gap:7,zIndex:15}}>
        {Array.from({length:total}).map((_,i)=>{
          const si=i>0?order[i-1]:null;
          const dotStop=i>0?allStops[si]:null;
          const dotSecret=dotStop?.secret;
          const dotRevealed=dotSecret&&revealedSecrets.includes(si);
          const dotColor=i===idx?"var(--amber)":dotSecret?(dotRevealed?"rgba(76,175,125,.6)":"rgba(224,85,85,.5)"):"rgba(255,255,255,.2)";
          return(
            <button key={i} onClick={()=>(isPresenter||isSolo)&&goTo(i)}
              style={{width:i===idx?22:7,height:7,borderRadius:4,background:dotColor,border:"none",cursor:(isPresenter||isSolo)?"pointer":"default",padding:0,transition:"all .25s cubic-bezier(.4,0,.2,1)"}}/>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EDIT MODALS
// ─────────────────────────────────────────────────────────────────────────────
const blankStop={time:"",activity:"",location:"",locationUrl:"",icon:"📍",note:"",image:"",secret:false,day:0};
const EditScheduleModal=({evt,onSave,onClose})=>{
  const [sched,setSched]=useState(evt.schedule.map(s=>({...blankStop,...s})));
  const [iconPicker,setIconPicker]=useState(null);
  const upd=(i,f,v)=>setSched(s=>s.map((r,j)=>j===i?{...r,[f]:v}:r));
  const stopDay=s=>s.day??0;
  const dayCount=Math.max(1,eventDayCount(evt.date,evt.end_date));
  const inRange=d=>d>=0&&d<dayCount;
  // Move a stop up/down *within its own day group* -- find its same-day
  // neighbour in `sched` (stops from other days may be interleaved in the
  // flat array) and swap with that, rather than with the flat neighbour.
  const moveInDay=(i,d)=>{
    const day=stopDay(sched[i]);
    const groupIdxs=sched.reduce((acc,r,j)=>{if(stopDay(r)===day)acc.push(j);return acc;},[]);
    const pos=groupIdxs.indexOf(i);
    const j=groupIdxs[pos+d];
    if(j===undefined)return;
    setSched(s=>{const next=[...s];[next[i],next[j]]=[next[j],next[i]];return next;});
  };
  const addStopOnDay=day=>setSched(s=>[...s,{...blankStop,day}]);
  // Group stops by day for headings; anything outside the event's current
  // [0,dayCount) range (e.g. the event's date range shrank after stops were
  // scheduled further out) is surfaced in its own group instead of being
  // silently dropped -- see `overflowIdxs` below.
  const groups=Array.from({length:dayCount},(_,day)=>({day,idxs:sched.reduce((acc,r,j)=>{if(stopDay(r)===day)acc.push(j);return acc;},[])}));
  const overflowIdxs=sched.reduce((acc,r,j)=>{if(!inRange(stopDay(r)))acc.push(j);return acc;},[]);
  const isMultiDay=dayCount>1;
  const showDayPicker=isMultiDay||overflowIdxs.length>0;
  const renderStop=i=>{
    const s=sched[i];
    const group=inRange(stopDay(s))?groups[stopDay(s)].idxs:overflowIdxs;
    const pos=group.indexOf(i);
    return(
    <div key={i} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:"1rem",border:`1px solid ${s.secret?"rgba(224,85,85,.35)":"var(--border)"}`,position:"relative",overflow:"hidden"}}>
      {s.secret&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,var(--red),rgba(224,85,85,.4))"}}/>}
      <div style={{display:"flex",gap:7,marginBottom:".7rem",alignItems:"center"}}>
        <div style={{position:"relative"}}><button onClick={()=>setIconPicker(iconPicker===i?null:i)} style={{width:38,height:38,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:"17px"}}>{s.icon||"📍"}</button>{iconPicker===i&&<div style={{position:"absolute",top:42,left:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:8,display:"flex",flexWrap:"wrap",gap:4,width:214,zIndex:10}}>{ICONS.map(ic=><button key={ic} onClick={()=>{upd(i,"icon",ic);setIconPicker(null)}} style={{background:s.icon===ic?"rgba(232,148,58,.2)":"transparent",border:"none",borderRadius:6,cursor:"pointer",fontSize:"17px",width:30,height:30}}>{ic}</button>)}</div>}</div>
        <Inp value={s.time} onChange={e=>upd(i,"time",e.target.value)} placeholder="12:00" style={{width:70,flexShrink:0}}/>
        <Inp value={s.activity} onChange={e=>upd(i,"activity",e.target.value)} placeholder="Activity"/>
        <div style={{display:"flex",gap:4,flexShrink:0}}>
          <button onClick={()=>upd(i,"secret",!s.secret)} title={s.secret?"Secret — klik om te openbaren":"Publiek — klik om te verbergen"} style={{width:32,height:32,background:s.secret?"rgba(224,85,85,.12)":"rgba(76,175,125,.1)",border:`1px solid ${s.secret?"rgba(224,85,85,.4)":"rgba(76,175,125,.3)"}`,borderRadius:7,cursor:"pointer",fontSize:"15px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}>{s.secret?"🔒":"👁"}</button>
          <Btn onClick={()=>moveInDay(i,-1)} variant="ghost" size="sm" disabled={pos===0} style={{padding:"6px 9px"}}>↑</Btn>
          <Btn onClick={()=>moveInDay(i,1)} variant="ghost" size="sm" disabled={pos===group.length-1} style={{padding:"6px 9px"}}>↓</Btn>
          <Btn onClick={()=>setSched(s=>s.filter((_,j)=>j!==i))} variant="danger" size="sm" style={{padding:"6px 9px"}}>✕</Btn>
        </div>
      </div>
      {s.secret&&<div style={{fontSize:".72rem",color:"var(--red)",marginBottom:".6rem",display:"flex",alignItems:"center",gap:5,opacity:.85}}><span>🔒</span>Geheim — verborgen voor gewone leden</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}><div><Lbl>Location</Lbl><Inp value={s.location} onChange={e=>upd(i,"location",e.target.value)} placeholder="Café de Kroeg"/></div><div><Lbl>Maps URL</Lbl><Inp value={s.locationUrl} onChange={e=>upd(i,"locationUrl",e.target.value)} placeholder="https://maps.google.com/…"/></div></div>
      <Lbl>Note</Lbl><Inp value={s.note} onChange={e=>upd(i,"note",e.target.value)} placeholder="e.g. reservation under Joris"/>
      <div style={{marginTop:7}}><Lbl>Slide Image / Video URL</Lbl><Inp value={s.image||""} onChange={e=>upd(i,"image",e.target.value)} placeholder="https://… (background in presentation mode)"/></div>
      {showDayPicker&&<div style={{marginTop:7}}><Lbl>Dag</Lbl><select value={stopDay(s)} onChange={e=>upd(i,"day",Number(e.target.value))} style={{width:"100%",background:"var(--bg2)",color:"var(--cream)",border:"1px solid var(--border)",borderRadius:7,padding:"7px 9px",fontSize:".8rem",cursor:"pointer",fontFamily:"var(--font-b)"}}>
        {groups.map(g=><option key={g.day} value={g.day}>{dayHeadingLabel(evt.date,g.day)}</option>)}
        {!inRange(stopDay(s))&&<option value={stopDay(s)}>Dag {stopDay(s)+1} (buiten bereik)</option>}
      </select></div>}
    </div>
    );
  };
  return(<Modal onClose={onClose} onBackdropClose={()=>onSave(sched)} maxWidth={640}><H>Edit Schedule</H><div style={{display:"grid",gap:".9rem"}}>
    {!isMultiDay&&overflowIdxs.length===0
      ? <>{sched.map((s,i)=>renderStop(i))}<Btn onClick={()=>setSched(s=>[...s,{...blankStop}])} variant="subtle" size="sm">+ Add Stop</Btn></>
      : <>
        {groups.map(g=>(
          <div key={g.day} style={{display:"grid",gap:".9rem",paddingBottom:6,borderBottom:"1px solid var(--border)"}}>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",fontWeight:700}}>{dayHeadingLabel(evt.date,g.day)}</div>
            {g.idxs.map(i=>renderStop(i))}
            <Btn onClick={()=>addStopOnDay(g.day)} variant="subtle" size="sm">+ Add Stop — Dag {g.day+1}</Btn>
          </div>
        ))}
        {overflowIdxs.length>0&&(
          <div style={{display:"grid",gap:".9rem"}}>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--red)",fontWeight:700}}>⚠️ Overige / niet ingepland</div>
            <div style={{fontSize:".76rem",color:"var(--muted)",marginTop:-6}}>Deze stops vallen buiten de huidige datums van dit event. Kies bij een stop een dag om ‘m weer in te plannen — ze worden nooit automatisch verwijderd.</div>
            {overflowIdxs.map(i=>renderStop(i))}
          </div>
        )}
      </>
    }
    <div style={{display:"flex",gap:8,alignItems:"center"}}><Btn onClick={()=>onSave(sched)}>Save</Btn><Btn onClick={onClose} variant="ghost">Discard changes</Btn><span style={{color:"var(--muted)",fontSize:".7rem"}}>Clicking outside saves automatically</span></div>
  </div></Modal>);
};

const AttendeeInput=({attendees,setAttendees,users=[]})=>{
  const [an,setAn]=useState("");
  const suggestions=an.length>0?users.filter(u=>u.role!=="pending"&&u.username.toLowerCase().includes(an.toLowerCase())&&!attendees.some(a=>a.name.toLowerCase()===u.username.toLowerCase())):[];
  const add=name=>{if(!name.trim())return;setAttendees([...attendees,{name:name.trim(),status:"going"}]);setAn("");};
  return(
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
        {attendees.map((a,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"var(--bg3)",borderRadius:8,padding:"5px 10px",fontSize:".8rem"}}>
            {a.name}<span onClick={()=>setAttendees(attendees.filter((_,j)=>j!==i))} style={{cursor:"pointer",color:"var(--muted)",marginLeft:2}}>✕</span>
          </div>
        ))}
      </div>
      <div style={{position:"relative"}}>
        <div style={{display:"flex",gap:6}}>
          <Inp value={an} onChange={e=>setAn(e.target.value)} placeholder="Naam toevoegen…" onKeyDown={e=>{if(e.key==="Enter"&&an.trim())add(an);}}/>
          <Btn onClick={()=>add(an)} variant="subtle" size="sm" style={{flexShrink:0}}>Add</Btn>
        </div>
        {suggestions.length>0&&(
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:50,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",zIndex:10,overflow:"hidden"}}>
            {suggestions.map(u=>(
              <div key={u.id} onMouseDown={e=>{e.preventDefault();add(u.username);}} style={{padding:"8px 12px",cursor:"pointer",fontSize:".85rem",display:"flex",alignItems:"center",gap:8}} onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                <Avatar name={u.username} size={22} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
                {u.username}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Trailer video field, shared by EditEventModal/NewEventModal: a pasted
// link OR an upload, either populating `trailer_video_url`. Follows the
// existing upload pattern (profile-photos at EditProfileModal, "Quiz
// images", event-photos at PhotosTab) -- storage bucket "event-videos".
// URL validation reuses `isSafeVideoUrl` (safeUrl.js): http(s) only, and
// must look like a video file (.mp4/.webm/.mov/.ogg) -- the same extension
// set `PresentationMode` already treats as a video at its own
// video-vs-image branch.
const TrailerVideoField=({value,onChange,error})=>{
  const [uploading,setUploading]=useState(false);
  const [uploadErr,setUploadErr]=useState("");
  const fileRef=useRef();
  const handleUpload=async e=>{
    const file=e.target.files[0];if(!file)return;
    setUploading(true);setUploadErr("");
    const path=`${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const{data,error:upErr}=await supabase.storage.from("event-videos").upload(path,file);
    if(upErr){setUploadErr("Upload mislukt: "+upErr.message);setUploading(false);e.target.value="";return;}
    const{data:{publicUrl}}=supabase.storage.from("event-videos").getPublicUrl(data.path);
    onChange(publicUrl);setUploading(false);e.target.value="";
  };
  return(
    <div>
      <Lbl>Trailer video</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Inp value={value||""} onChange={e=>onChange(e.target.value)} placeholder="https://…video.mp4 (of upload)" style={{flex:1,minWidth:180}}/>
        <Btn onClick={()=>fileRef.current.click()} variant="ghost" size="sm" disabled={uploading}>{uploading?"Uploaden…":"📹 Upload"}</Btn>
        {value&&<Btn onClick={()=>onChange("")} variant="ghost" size="sm" style={{color:"var(--red)"}}>Verwijderen</Btn>}
      </div>
      <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/ogg" style={{display:"none"}} onChange={handleUpload}/>
      {error&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:4}}>⚠ {error}</div>}
      {uploadErr&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:4}}>{uploadErr}</div>}
      <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:4}}>Plak een link of upload een bestand (.mp4, .webm, .mov, .ogg).</div>
    </div>
  );
};

const EditEventModal=({evt,onSave,onClose,users=[]})=>{
  const [d,setD]=useState({...evt});
  // If this event already arrives with an end_date, its saved `type` is by
  // definition a deliberate decision (possibly correcting an earlier
  // auto-suggestion) -- start "touched" so re-editing end_date this session
  // never silently overwrites it. A fresh event (no end_date yet) still
  // gets the auto-suggest on its first range.
  const typeTouched=useRef(!!evt.end_date);
  const dateErr=d.end_date&&d.date&&d.end_date<d.date?"Einddatum ligt vóór de startdatum":"";
  const videoUrlErr=d.trailer_video_url&&!isSafeVideoUrl(d.trailer_video_url)?"Ongeldige video-link (moet http(s) zijn en eindigen op .mp4, .webm, .mov of .ogg)":"";
  const setEndDate=v=>{
    const next={...d,end_date:v};
    if(v&&v!==d.date&&!typeTouched.current)next.type="weekend";
    setD(next);
  };
  return(
    <Modal onClose={onClose} maxWidth={500}><H>Edit Event</H>
    <div style={{display:"grid",gap:".9rem"}}>
      <div><Lbl>Event Name</Lbl><Inp value={d.name||""} onChange={e=>setD({...d,name:e.target.value})} placeholder="Event Name"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Startdatum</Lbl><Inp type="date" value={d.date||""} onChange={e=>setD({...d,date:e.target.value})}/></div>
        <div><Lbl>Starttijd</Lbl><Inp type="time" value={d.start_time||""} onChange={e=>setD({...d,start_time:e.target.value})}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Einddatum (optioneel)</Lbl><Inp type="date" value={d.end_date||""} onChange={e=>setEndDate(e.target.value)}/></div>
        <div><Lbl>Eindtijd</Lbl><Inp type="time" value={d.end_time||""} onChange={e=>setD({...d,end_time:e.target.value})}/></div>
      </div>
      {dateErr&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:-6}}>⚠ {dateErr}</div>}
      {[["location","Locatie"],["theme","Thema"]].map(([k,l])=><div key={k}><Lbl>{l}</Lbl><Inp value={d[k]||""} onChange={e=>setD({...d,[k]:e.target.value})} placeholder={l}/></div>)}
      <div><Lbl>Type</Lbl><select value={d.type} onChange={e=>{typeTouched.current=true;setD({...d,type:e.target.value});}} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%"}}><option value="day">Day Event</option><option value="weekend">Weekend</option></select></div>
      <TrailerVideoField value={d.trailer_video_url} onChange={v=>setD({...d,trailer_video_url:v})} error={videoUrlErr}/>
      <div><Lbl>Description</Lbl><RichTextInput value={d.description||""} onChange={v=>setD({...d,description:v})} placeholder="Beschrijving… **bold**, *italic*, - lijstje" rows={3}/></div>
      <div><Lbl>Attendees</Lbl><AttendeeInput attendees={d.attendees} setAttendees={v=>setD({...d,attendees:v})} users={users}/></div>
      <div style={{display:"flex",gap:8,marginTop:4}}><Btn onClick={()=>onSave(d)} disabled={!!dateErr||!!videoUrlErr}>Save</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div>
    </div></Modal>
  );
};

const NewEventModal=({onSave,onClose,users=[]})=>{
  const yr=new Date().getFullYear();
  const [d,setD]=useState({name:`Mensday ${yr}`,type:"day",date:`${yr}-09-13`,end_date:"",start_time:"12:00",end_time:"",location:"TBD",description:"",theme:"",trailer_video_url:"",attendees:[],schedule:[],polls:[],photos:[],quizzes:[],winners:[],highlights:[],faqs:[],archived:false,kretjes:0});
  const typeTouched=useRef(false);
  const dateErr=d.end_date&&d.date&&d.end_date<d.date?"Einddatum ligt vóór de startdatum":"";
  const videoUrlErr=d.trailer_video_url&&!isSafeVideoUrl(d.trailer_video_url)?"Ongeldige video-link (moet http(s) zijn en eindigen op .mp4, .webm, .mov of .ogg)":"";
  const setEndDate=v=>{
    const next={...d,end_date:v};
    if(v&&v!==d.date&&!typeTouched.current)next.type="weekend";
    setD(next);
  };
  return(
    <Modal onClose={onClose} maxWidth={500}><H>New Event</H>
    <div style={{display:"grid",gap:".85rem"}}>
      <div><Lbl>Event Name</Lbl><Inp value={d.name||""} onChange={e=>setD({...d,name:e.target.value})} placeholder="Event Name"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Startdatum</Lbl><Inp type="date" value={d.date||""} onChange={e=>setD({...d,date:e.target.value})}/></div>
        <div><Lbl>Starttijd</Lbl><Inp type="time" value={d.start_time||""} onChange={e=>setD({...d,start_time:e.target.value})}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Einddatum (optioneel)</Lbl><Inp type="date" value={d.end_date||""} onChange={e=>setEndDate(e.target.value)}/></div>
        <div><Lbl>Eindtijd</Lbl><Inp type="time" value={d.end_time||""} onChange={e=>setD({...d,end_time:e.target.value})}/></div>
      </div>
      {dateErr&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:-6}}>⚠ {dateErr}</div>}
      {[["location","Locatie"],["theme","Thema"]].map(([k,l])=><div key={k}><Lbl>{l}</Lbl><Inp value={d[k]||""} onChange={e=>setD({...d,[k]:e.target.value})} placeholder={l}/></div>)}
      <div><Lbl>Type</Lbl><select value={d.type} onChange={e=>{typeTouched.current=true;setD({...d,type:e.target.value});}} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%"}}><option value="day">Day Event</option><option value="weekend">Weekend</option></select></div>
      <TrailerVideoField value={d.trailer_video_url} onChange={v=>setD({...d,trailer_video_url:v})} error={videoUrlErr}/>
      <div><Lbl>Description</Lbl><RichTextInput value={d.description||""} onChange={v=>setD({...d,description:v})} placeholder="Beschrijving… **bold**, *italic*, - lijstje" rows={3}/></div>
      <div><Lbl>Attendees</Lbl><AttendeeInput attendees={d.attendees} setAttendees={v=>setD({...d,attendees:v})} users={users}/></div>
      <div style={{display:"flex",gap:8,marginTop:4}}><Btn onClick={()=>onSave({...d,id:`evt-${Date.now()}`})} disabled={!!dateErr||!!videoUrlErr}>Create</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div>
    </div></Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY DIFF
// ─────────────────────────────────────────────────────────────────────────────
const diffEvents=(prev,next)=>{
  const acts=[];
  const now=new Date().toISOString();
  next.forEach(evt=>{
    const old=prev.find(e=>e.id===evt.id);
    if(!old)return;
    const eid=evt.id,en=evt.name;
    // FAQs
    (evt.faqs||[]).forEach(faq=>{
      if(!(old.faqs||[]).find(f=>f.id===faq.id))
        acts.push({id:faq.id,type:"faq",message:`${faq.askedBy} stelde een vraag`,event:en,eventId:eid,timestamp:faq.askedAt,tab:"FAQ",targetId:`faq-${faq.id}`});
    });
    (evt.faqs||[]).forEach(faq=>{
      const of=(old.faqs||[]).find(f=>f.id===faq.id);
      if(of&&!of.answer&&faq.answer)
        acts.push({id:`ans-${faq.id}`,type:"answer",message:`Vraag beantwoord door ${faq.answeredBy}`,event:en,eventId:eid,timestamp:faq.answeredAt,tab:"FAQ",targetId:`faq-${faq.id}`});
    });
    // RSVP
    (evt.attendees||[]).forEach(att=>{
      const oa=(old.attendees||[]).find(a=>a.name===att.name);
      if(oa&&oa.status!==att.status)
        acts.push({id:`rsvp-${att.name}-${eid}-${att.status}`,type:"rsvp",message:`${att.name}: ${statusMap[att.status]?.label||att.status}`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    });
    // Photos
    const oldPhotoIds=new Set((old.photos||[]).map(p=>p.id));
    (evt.photos||[]).forEach(photo=>{
      if(!oldPhotoIds.has(photo.id))
        acts.push({id:photo.id,type:"photo",message:`${photo.uploader} uploadde een foto`,event:en,eventId:eid,timestamp:photo.uploadedAt,tab:"Photos",targetId:`photo-${photo.id}`});
    });
    // Polls — new poll (skip secret ones)
    (evt.polls||[]).forEach(poll=>{
      if(!poll.secret&&!(old.polls||[]).find(p=>p.id===poll.id))
        acts.push({id:`poll-new-${poll.id}`,type:"poll",message:`Nieuwe poll: "${poll.title}"`,event:en,eventId:eid,timestamp:now,tab:"Polls",targetId:`poll-${poll.id}`});
    });
    // Polls — poll closed (skip secret ones)
    (evt.polls||[]).forEach(poll=>{
      const op=(old.polls||[]).find(p=>p.id===poll.id);
      if(op&&!op.closed&&poll.closed&&!poll.secret)
        acts.push({id:`poll-close-${poll.id}`,type:"poll",message:`Poll resultaten: "${poll.title}"`,event:en,eventId:eid,timestamp:now,tab:"Polls",targetId:`poll-${poll.id}`});
    });
    // Schedule — only notify for genuinely new stops, not reveals of existing secret stops
    const oldActivities=new Set((old.schedule||[]).map(s=>s.activity));
    const trulyNew=(evt.schedule||[]).filter(s=>!s.secret&&!oldActivities.has(s.activity));
    if(trulyNew.length>0)
      acts.push({id:`sched-${eid}-${trulyNew.map(s=>s.activity).join("")}`,type:"schedule",message:`${trulyNew.length} activiteit${trulyNew.length>1?"en":""} toegevoegd aan het programma`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    // Location changed
    if(old.location&&evt.location&&old.location!==evt.location)
      acts.push({id:`loc-${eid}-${evt.location}`,type:"schedule",message:`Locatie gewijzigd: ${evt.location}`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    // Start time changed
    if(old.start_time&&evt.start_time&&old.start_time!==evt.start_time)
      acts.push({id:`time-${eid}-${evt.start_time}`,type:"schedule",message:`Starttijd gewijzigd: ${evt.start_time}`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    // Quizzes
    (evt.quizzes||[]).forEach(quiz=>{
      if(!(old.quizzes||[]).find(q=>q.id===quiz.id))
        acts.push({id:`quiz-new-${quiz.id}`,type:"quiz",message:`Nieuwe quiz beschikbaar: "${quiz.title}"`,event:en,eventId:eid,timestamp:now,tab:"Quiz"});
    });
    // Winners announced
    const ow=(old.winners||[]).length,nw=(evt.winners||[]).length;
    if(nw>ow)
      acts.push({id:`win-${eid}-${nw}`,type:"winners",message:`Winnaars bekendgemaakt!`,event:en,eventId:eid,timestamp:now,tab:"Winners & Highlights"});
  });
  return acts;
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATES PAGE
// ─────────────────────────────────────────────────────────────────────────────
const UpdatesPage=({notifications,notifLastRead,onMarkAllRead,onOpenEvent,currentUser,onClearUpdates,onClearSelf,onDeleteNotif,onDeleteSelf})=>{
  const typeIcon={rsvp:"📅",faq:"❓",answer:"💬",photo:"📷",poll:"📊",schedule:"🗓",quiz:"🧠",winners:"🏆"};
  const typeLabel={rsvp:"RSVP",faq:"Nieuwe vraag",answer:"Vraag beantwoord",photo:"Foto",poll:"Poll",schedule:"Programma",quiz:"Quiz",winners:"Winnaars"};
  const typeColor={rsvp:"var(--amber)",faq:"#7c6cfc",answer:"#56b4a0",photo:"#e08050",poll:"var(--amber2)",schedule:"var(--gold)",quiz:"#c46eff",winners:"var(--gold)"};
  const timeAgo=ts=>{const d=Date.now()-new Date(ts);if(d<60000)return"zojuist";if(d<3600000)return`${Math.floor(d/60000)}m geleden`;if(d<86400000)return`${Math.floor(d/3600000)}u geleden`;return`${Math.floor(d/86400000)}d geleden`;};
  const unread=notifications.filter(n=>n.timestamp>notifLastRead);
  const read=notifications.filter(n=>n.timestamp<=notifLastRead);
  const isAdmin=can.closePoll(currentUser);
  const Item=({n,isNew})=>(
    <div style={{display:"flex",gap:"1rem",alignItems:"flex-start",padding:".9rem 1.1rem",borderRadius:"var(--radius-sm)",border:`1px solid ${isNew?"rgba(232,148,58,.2)":"var(--border)"}`,background:isNew?"rgba(232,148,58,.04)":"var(--bg2)",transition:"background .15s,border-color .15s",marginBottom:".5rem",position:"relative"}}
      onMouseEnter={e=>{e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.borderColor="var(--border2)";}}
      onMouseLeave={e=>{e.currentTarget.style.background=isNew?"rgba(232,148,58,.04)":"var(--bg2)";e.currentTarget.style.borderColor=isNew?"rgba(232,148,58,.2)":"var(--border)";}}>
      <div onClick={()=>n.eventId&&onOpenEvent(n.eventId,n.tab,n.targetId)} style={{display:"flex",gap:"1rem",alignItems:"flex-start",flex:1,minWidth:0,cursor:n.eventId?"pointer":"default"}}>
        <div style={{flexShrink:0,width:36,height:36,borderRadius:"50%",background:`${typeColor[n.type]||"var(--muted)"}22`,border:`1px solid ${typeColor[n.type]||"var(--muted)"}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem",marginTop:1}}>
          {typeIcon[n.type]||"•"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
            <span style={{fontSize:".68rem",fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:typeColor[n.type]||"var(--muted)"}}>{typeLabel[n.type]||n.type}</span>
            {isNew&&<span style={{width:6,height:6,borderRadius:"50%",background:"var(--amber)",display:"inline-block",flexShrink:0}}/>}
          </div>
          <div style={{fontSize:".88rem",color:"var(--cream)",lineHeight:1.4}}>{n.message}</div>
          <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:3}}>{n.event} · {timeAgo(n.timestamp)}</div>
        </div>
        {n.eventId&&<div style={{color:"var(--muted)",fontSize:".8rem",alignSelf:"center",flexShrink:0,opacity:.5}}>›</div>}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0,alignSelf:"flex-start",marginTop:1}} onClick={e=>e.stopPropagation()}>
        <button onClick={()=>onDeleteSelf(n.id)}
          style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".72rem",padding:"2px 5px",opacity:.45,lineHeight:1,transition:"opacity .15s",whiteSpace:"nowrap"}}
          onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=".45"}
          title="Delete for me">✕</button>
        {isAdmin&&<button onClick={()=>onDeleteNotif(n.id)}
          style={{background:"none",border:"1px solid rgba(255,100,100,.25)",borderRadius:4,color:"rgba(255,120,120,.7)",cursor:"pointer",fontSize:".62rem",padding:"2px 5px",opacity:.6,lineHeight:1,transition:"opacity .15s",whiteSpace:"nowrap"}}
          onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=".6"}
          title="Delete for everyone">✕ all</button>}
      </div>
    </div>
  );
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:8}}>
        <div>
          <H style={{marginBottom:2}}>📬 Updates</H>
          <div style={{fontSize:".78rem",color:"var(--muted)"}}>{unread.length>0?`${unread.length} nieuw`:"Alles bijgewerkt"}</div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          {unread.length>0&&<Btn onClick={onMarkAllRead} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"rgba(232,148,58,.3)"}}>✓ Alles gelezen</Btn>}
          {notifications.length>0&&<Btn onClick={onClearSelf} variant="ghost" size="sm" style={{color:"var(--muted)",borderColor:"var(--border)"}}>🗑 Wis voor mij</Btn>}
        </div>
      </div>
      {isAdmin&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(255,100,100,.06)",border:"1px solid rgba(255,100,100,.18)",borderRadius:10,padding:"10px 14px",marginBottom:"1.2rem"}}>
          <div>
            <div style={{fontSize:".78rem",fontWeight:600,color:"rgba(255,120,120,.9)"}}>Admin</div>
            <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:1}}>Wis alle meldingen voor iedereen</div>
          </div>
          <Btn onClick={onClearUpdates} variant="ghost" size="sm" style={{color:"rgba(255,120,120,.85)",borderColor:"rgba(255,100,100,.3)"}}>🗑 Wis voor iedereen</Btn>
        </div>
      )}
      {notifications.length===0&&(
        <div style={{textAlign:"center",padding:"4rem 1rem",color:"var(--muted)"}}>
          <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>📭</div>
          <div style={{fontSize:".9rem"}}>Nog geen updates</div>
          <div style={{fontSize:".78rem",marginTop:6,opacity:.6}}>Nieuwe polls, schema-wijzigingen, vragen — alles verschijnt hier</div>
        </div>
      )}
      {unread.length>0&&(
        <div style={{marginBottom:"1.5rem"}}>
          <div style={{fontSize:".68rem",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"var(--amber)",marginBottom:".65rem"}}>Nieuw · {unread.length}</div>
          {unread.map(n=><Item key={n.id} n={n} isNew={true}/>)}
        </div>
      )}
      {read.length>0&&(
        <div>
          {unread.length>0&&<div style={{fontSize:".68rem",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"var(--muted)",marginBottom:".65rem",marginTop:"1.2rem"}}>Eerder</div>}
          {read.map(n=><Item key={n.id} n={n} isNew={false}/>)}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SARA JAY OR JAI — MINI GAME
// ─────────────────────────────────────────────────────────────────────────────
const SARA_JAY_IMAGES = [
  // Replace each url with a real image URL. isReal=true → real Sara Jay photo.
  { id:"sj1",  url:"https://tinyurl.com/23sk3frt",  isReal:true,  difficulty:"easy"   },
  { id:"sj2",  url:"https://tinyurl.com/23sk3frt",  isReal:false, difficulty:"hard"   },
  { id:"sj3",  url:"https://tinyurl.com/23sk3frt",  isReal:true,  difficulty:"medium" },
];
const SJ_CORRECT = [
  "Goed zo lad! 🔥","Je hebt een scherp oog 👁","Boom! Raak! 💥","Ken je haar al? 👀","Too easy 😎","Je bent een pro","Niemand fokt met jou 🎯",
];
const SJ_WRONG = [
  "AI had je te pakken 💀","Nope, helemaal fout 😂","JAI got you 🤖","Game over, lad 👋","Zonde van de streak 🍿","Volgende keer beter joh","Ouch 😬",
];

const SaraJayOrJAI = () => {
  const [phase, setPhase] = useState("idle");
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [imgKey, setImgKey] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lastCorrect, setLastCorrect] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [newRecord, setNewRecord] = useState(false);
  const timerRef = useRef(null);

  const [bestStreak, setBestStreak] = useState(() => {
    try { return JSON.parse(localStorage.getItem("md-sarajay") || "{}").bestStreak ?? 0; } catch { return 0; }
  });
  const [totalScore, setTotalScore] = useState(() => {
    try { return JSON.parse(localStorage.getItem("md-sarajay") || "{}").totalScore ?? 0; } catch { return 0; }
  });

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const startGame = () => {
    clearTimeout(timerRef.current);
    setQueue(shuffle(SARA_JAY_IMAGES));
    setIdx(0);
    setImgKey(k => k + 1);
    setScore(0);
    setStreak(0);
    setLastCorrect(null);
    setNewRecord(false);
    setPhase("playing");
  };

  const saveStats = (finalStreak, finalScore) => {
    const nb = Math.max(bestStreak, finalStreak);
    const nt = totalScore + finalScore;
    setBestStreak(nb);
    setTotalScore(nt);
    localStorage.setItem("md-sarajay", JSON.stringify({ bestStreak: nb, totalScore: nt }));
    return nb > bestStreak;
  };

  const handleGuess = guessedReal => {
    if (phase !== "playing") return;
    const img = queue[idx];
    const correct = guessedReal === img.isReal;
    const msg = correct
      ? SJ_CORRECT[Math.floor(Math.random() * SJ_CORRECT.length)]
      : SJ_WRONG[Math.floor(Math.random() * SJ_WRONG.length)];
    setLastCorrect(correct);
    setFeedbackMsg(msg);
    setPhase("feedback");

    timerRef.current = setTimeout(() => {
      if (correct) {
        const ns = score + 1;
        const nk = streak + 1;
        setScore(ns);
        setStreak(nk);
        const nextIdx = (idx + 1) % queue.length;
        if (nextIdx === 0) setQueue(q => shuffle(q));
        setIdx(nextIdx);
        setImgKey(k => k + 1);
        setPhase("playing");
      } else {
        const isNew = saveStats(streak, score);
        setNewRecord(isNew);
        setPhase("dead");
      }
    }, 1500);
  };

  const img = queue[idx];
  const diffColor = { easy: "var(--green)", medium: "var(--amber)", hard: "var(--red)" };

  if (phase === "idle") {
    return (
      <div className="fu" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", paddingTop: "1.5rem" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "3.5rem", marginBottom: ".4rem" }}>🤖</div>
          <H style={{ fontStyle: "italic", fontSize: "clamp(1.6rem,6vw,2.4rem)", lineHeight: 1.1 }}>Sara Jay or Sara JAI?</H>
          <p style={{ color: "var(--muted)", marginTop: ".6rem", fontSize: ".9rem" }}>Echt persoon of AI? Één fout = game over.</p>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".5rem 1.2rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{bestStreak}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Best streak</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".5rem 1.2rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{totalScore}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Total score</div>
          </div>
        </div>
        <Btn variant="gold" size="lg" onClick={startGame} style={{ fontSize: "1.1rem", padding: "14px 40px" }}>Spelen 🎮</Btn>
        <div style={{ color: "var(--muted2)", fontSize: ".75rem", textAlign: "center", maxWidth: 280 }}>
          Raad of elke foto echt of AI is. Streak = opeenvolgende goede antwoorden. Één fout en je bent klaar.
        </div>
      </div>
    );
  }

  if (phase === "dead") {
    return (
      <div className="fu" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", paddingTop: "1.5rem" }}>
        <div className="sj-wrong" style={{ fontSize: "4rem" }}>💀</div>
        <div style={{ textAlign: "center" }}>
          <H style={{ fontSize: "2rem" }}>Game Over</H>
          <p style={{ color: "var(--muted)", marginTop: ".3rem" }}>{feedbackMsg}</p>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".6rem 1.4rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{score}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Score</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".6rem 1.4rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{streak}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Streak</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".6rem 1.4rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--gold)", fontFamily: "var(--font-h)" }}>{bestStreak}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Best</div>
          </div>
        </div>
        {newRecord && (
          <div className="pop" style={{ background: "linear-gradient(135deg,var(--gold),var(--amber))", color: "var(--bg)", borderRadius: 50, padding: ".4rem 1.4rem", fontSize: ".9rem", fontWeight: 700 }}>
            🏆 Nieuw record!
          </div>
        )}
        <Btn variant="gold" size="lg" onClick={startGame}>🔄 Opnieuw</Btn>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", paddingTop: ".5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 420, padding: "0 .2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "1.3rem" }}>🔥</span>
          <span style={{ fontFamily: "var(--font-h)", fontSize: "1.8rem", color: "var(--amber)", lineHeight: 1 }}>{streak}</span>
          <span style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>streak</span>
        </div>
        <div style={{ fontSize: ".75rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
          <span>🏆 Best:</span>
          <span style={{ color: "var(--gold)", fontWeight: 700 }}>{bestStreak}</span>
        </div>
        <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Score: <span style={{ color: "var(--cream)", fontWeight: 600 }}>{score}</span></div>
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: 420, aspectRatio: "3/4", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--bg2)", border: "1px solid var(--border)" }}>
        {img && (
          <img
            key={imgKey}
            src={img.url}
            alt="Guess this"
            className="sj-img"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
        {img && (
          <div style={{ position: "absolute", bottom: 10, left: 10, background: diffColor[img.difficulty] || "var(--muted)", color: "var(--bg)", borderRadius: 50, padding: "2px 10px", fontSize: ".68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>
            {img.difficulty}
          </div>
        )}
        {phase === "feedback" && (
          <div className="pop" style={{ position: "absolute", inset: 0, background: lastCorrect ? "rgba(34,197,94,.88)" : "rgba(239,68,68,.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".6rem", padding: "1rem" }}>
            <div style={{ fontSize: "4rem", lineHeight: 1 }}>{lastCorrect ? "✓" : "✗"}</div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "1.1rem", textAlign: "center" }}>{feedbackMsg}</div>
            <div style={{ color: "rgba(255,255,255,.8)", fontSize: ".8rem" }}>
              Correct: <strong>{img?.isReal ? "Echt 👤" : "AI 🤖"}</strong>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: ".8rem", width: "100%", maxWidth: 420 }}>
        <button
          className="sj-btn"
          disabled={phase === "feedback"}
          onClick={() => handleGuess(true)}
          style={{ flex: 1, padding: "16px 0", fontSize: "1.05rem", fontWeight: 700, fontFamily: "var(--font-b)", borderRadius: "var(--radius-sm)", border: "2px solid rgba(76,175,125,.5)", background: "rgba(76,175,125,.12)", color: "var(--green)", cursor: "pointer", opacity: phase === "feedback" ? .5 : 1 }}
        >
          👤 Echt
        </button>
        <button
          className="sj-btn"
          disabled={phase === "feedback"}
          onClick={() => handleGuess(false)}
          style={{ flex: 1, padding: "16px 0", fontSize: "1.05rem", fontWeight: 700, fontFamily: "var(--font-b)", borderRadius: "var(--radius-sm)", border: "2px solid rgba(224,85,85,.5)", background: "rgba(224,85,85,.12)", color: "var(--red)", cursor: "pointer", opacity: phase === "feedback" ? .5 : 1 }}
        >
          🤖 JAI
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TEAM CREATOR PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TEAM_COLORS=["var(--amber)","var(--blue)","var(--green)","var(--purple)","var(--orange)","var(--red)","#56b4a0","#e08050","#9b7fe8","#5b9bd5"];
const TeamCreatorPage=({users,events=[],onUpdateEvent})=>{
  const [teamSize,setTeamSize]=useState(3);
  const [participants,setParticipants]=useState([]);
  const [input,setInput]=useState("");
  const [teams,setTeams]=useState(null);
  const [generating,setGenerating]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [avatarPicker,setAvatarPicker]=useState(null);
  const [setName,setSetName]=useState("");
  const [setCategory,setSetCategory]=useState("");
  const [selectedEvtId,setSelectedEvtId]=useState("");
  const [saved,setSaved]=useState(false);
  const appUsers=users.filter(u=>ACTIVE_ROLES.includes(u.role));
  const activeEvents=events.filter(e=>!e.archived).sort((a,b)=>new Date(a.date)-new Date(b.date));

  const add=name=>{const t=name.trim();if(!t||participants.includes(t))return;setParticipants(p=>[...p,t]);setTeams(null);};
  const addInput=()=>{input.split(",").map(s=>s.trim()).filter(Boolean).forEach(add);setInput("");};
  const remove=name=>{setParticipants(p=>p.filter(x=>x!==name));setTeams(null);};
  const generate=()=>{
    if(participants.length<2)return;
    setGenerating(true);setTeams(null);setSaved(false);
    setTimeout(()=>{
      const shuffled=[...participants].sort(()=>Math.random()-.5);
      const result=[];
      for(let i=0;i<shuffled.length;i+=teamSize){
        const members=shuffled.slice(i,i+teamSize);
        result.push({id:`tm_${Date.now()}_${i}`,name:`Team ${result.length+1}`,members,avatar:TEAM_AVATARS[result.length%TEAM_AVATARS.length]});
      }
      setTeams(result);setGenerating(false);
    },1800);
  };
  const renameTeam=(idx,name)=>setTeams(ts=>ts.map((t,i)=>i===idx?{...t,name}:t));
  const setAvatar=(idx,av)=>{setTeams(ts=>ts.map((t,i)=>i===idx?{...t,avatar:av}:t));setAvatarPicker(null);};
  const saveToEvent=async()=>{
    if(!selectedEvtId||!setName.trim())return;
    const evt=events.find(e=>e.id===selectedEvtId);if(!evt)return;
    const newSet={id:`ts_${Date.now()}`,name:setName.trim(),category:setCategory.trim(),createdAt:new Date().toISOString(),teams};
    await onUpdateEvent({...evt,team_sets:[...(evt.team_sets||[]),newSet]});
    setSaved(true);
  };
  const pickedNames=new Set(participants);
  const teamCount=participants.length>0?Math.ceil(participants.length/teamSize):0;

  return(
    <div className="fu">
      <H size="1.7rem" style={{marginBottom:"1.5rem"}}>🎲 Team Creator</H>

      <Card style={{marginBottom:"1.2rem"}}>
        <H size="1rem" style={{marginBottom:".8rem"}}>Personen per team</H>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <button onClick={()=>setTeamSize(t=>Math.max(1,t-1))} style={{width:38,height:38,borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--cream)",fontSize:"1.3rem",cursor:"pointer",fontFamily:"var(--font-b)",lineHeight:1}}>−</button>
          <span style={{fontFamily:"var(--font-h)",fontSize:"2.2rem",color:"var(--amber)",minWidth:44,textAlign:"center",lineHeight:1}}>{teamSize}</span>
          <button onClick={()=>setTeamSize(t=>Math.min(20,t+1))} style={{width:38,height:38,borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--cream)",fontSize:"1.3rem",cursor:"pointer",fontFamily:"var(--font-b)",lineHeight:1}}>+</button>
          {participants.length>0&&<div style={{color:"var(--muted)",fontSize:".83rem",marginLeft:6}}>
            → <strong style={{color:"var(--cream)"}}>{teamCount}</strong> {teamCount===1?"team":"teams"}
            {participants.length%teamSize!==0&&<span style={{marginLeft:4,opacity:.7}}>(1 team met {participants.length%teamSize})</span>}
          </div>}
        </div>
      </Card>

      <Card style={{marginBottom:"1.2rem"}}>
        <H size="1rem" style={{marginBottom:".8rem"}}>
          Deelnemers{participants.length>0&&<span style={{color:"var(--muted)",fontFamily:"var(--font-b)",fontSize:".78rem",fontWeight:400,marginLeft:6}}>({participants.length})</span>}
        </H>
        <div style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:180,display:"flex",gap:8}}>
            <Inp value={input} onChange={e=>setInput(e.target.value)} placeholder="Naam (komma voor meerdere)" onKeyDown={e=>{if(e.key==="Enter")addInput();}} style={{flex:1}}/>
            <Btn onClick={addInput} variant="subtle" size="sm" style={{flexShrink:0}}>+ Voeg toe</Btn>
          </div>
          <Btn onClick={()=>setShowPicker(p=>!p)} variant={showPicker?"primary":"ghost"} size="sm">👥 Uit app</Btn>
        </div>

        {showPicker&&(
          <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".75rem",marginBottom:"1rem",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:6}}>
            {appUsers.map(u=>{
              const name=u.display_name||u.username;
              const picked=pickedNames.has(name);
              return(
                <div key={u.id} onClick={()=>picked?remove(name):add(name)}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber2)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=picked?"var(--amber)":"var(--border)";}}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,border:`1px solid ${picked?"var(--amber)":"var(--border)"}`,background:picked?"rgba(232,148,58,.12)":"var(--bg2)",cursor:"pointer",transition:"border-color .15s"}}>
                  <Avatar name={u.username} size={24} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
                  <span style={{fontSize:".82rem",color:picked?"var(--amber2)":"var(--cream)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{name}</span>
                  {picked&&<span style={{color:"var(--amber)",fontSize:".75rem",flexShrink:0}}>✓</span>}
                </div>
              );
            })}
          </div>
        )}

        {participants.length>0?(
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {participants.map(name=>(
              <span key={name} style={{display:"flex",alignItems:"center",gap:5,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:20,padding:"4px 10px 4px 13px",fontSize:".83rem",color:"var(--cream)"}}>
                {name}
                <button onClick={()=>remove(name)} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".95rem",lineHeight:1,padding:"0 0 0 4px",display:"flex",alignItems:"center"}}>×</button>
              </span>
            ))}
          </div>
        ):(
          <div style={{color:"var(--muted)",fontSize:".83rem"}}>Voeg deelnemers toe via de app of typ ze handmatig.</div>
        )}
      </Card>

      <div style={{textAlign:"center",marginBottom:"1.5rem"}}>
        <Btn onClick={generate} variant="gold" size="lg" disabled={participants.length<2||generating} style={{minWidth:220}}>
          {generating?"🎲 Loten...":"🎲 Genereer Teams"}
        </Btn>
        {participants.length<2&&<div style={{color:"var(--muted)",fontSize:".78rem",marginTop:6}}>Voeg minimaal 2 deelnemers toe</div>}
      </div>

      {generating&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"1.2rem",padding:"3rem 1rem"}}>
          <div style={{width:56,height:56,border:"4px solid var(--bg3)",borderTopColor:"var(--amber)",borderRadius:"50%",animation:"spin .75s linear infinite"}}/>
          <div style={{fontFamily:"var(--font-h)",fontSize:"1.15rem",color:"var(--amber2)"}}>Teams worden geloot…</div>
          <div style={{color:"var(--muted)",fontSize:".83rem"}}>Schud… schud… schud…</div>
        </div>
      )}

      {teams&&!generating&&(
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
            <H size="1.1rem" style={{marginBottom:0}}>🏁 Teams ({teams.length})</H>
            <Btn onClick={generate} variant="ghost" size="sm">🔀 Opnieuw loten</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:"1rem",marginBottom:"1.5rem"}}>
            {teams.map((team,i)=>{
              const col=TEAM_COLORS[i%TEAM_COLORS.length];
              return(
                <div key={team.id} style={{background:"var(--bg2)",border:`1px solid ${col}44`,borderRadius:"var(--radius)",padding:"1.1rem",animation:"teamReveal .4s ease both",animationDelay:`${i*70}ms`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:".75rem"}}>
                    <div onClick={()=>setAvatarPicker(avatarPicker===i?null:i)}
                      style={{fontSize:"1.4rem",cursor:"pointer",lineHeight:1,padding:"2px 4px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg3)",userSelect:"none",flexShrink:0}}>
                      {team.avatar}
                    </div>
                    <input value={team.name} onChange={e=>renameTeam(i,e.target.value)}
                      style={{flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${col}66`,color:col,fontFamily:"var(--font-h)",fontSize:".95rem",outline:"none",padding:"2px 0",minWidth:0}}/>
                  </div>
                  {avatarPicker===i&&(
                    <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:".6rem",padding:".4rem",background:"var(--bg)",borderRadius:8,border:"1px solid var(--border)"}}>
                      {TEAM_AVATARS.map(av=>(
                        <div key={av} onClick={()=>setAvatar(i,av)}
                          style={{fontSize:"1.2rem",cursor:"pointer",padding:"3px 4px",borderRadius:5,border:team.avatar===av?"2px solid var(--amber)":"1px solid transparent",userSelect:"none"}}>
                          {av}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:0}}>
                    {team.members.map((name,j)=>{
                      const u=users.find(x=>(x.display_name||x.username)===name);
                      return(
                        <div key={j} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderTop:j>0?"1px solid var(--border)":"none"}}>
                          {u?<Avatar name={u.username} size={22} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>:<div style={{width:22,height:22,borderRadius:"50%",background:"var(--bg4)",border:"1px solid var(--border)",flexShrink:0}}/>}
                          <span style={{fontSize:".88rem",color:"var(--cream)"}}>{name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Save to event ── */}
          <Card style={{border:"1px solid var(--border2)"}}>
            <H size=".95rem" style={{marginBottom:".8rem"}}>💾 Opslaan bij event</H>
            <div style={{display:"grid",gap:".75rem"}}>
              <Inp value={setName} onChange={e=>{setSetName(e.target.value);setSaved(false);}} placeholder="Naam voor deze teaminvulling… (bv. Groep A)"/>
              <Inp value={setCategory} onChange={e=>{setSetCategory(e.target.value);setSaved(false);}} placeholder="Categorie / doel… (bv. Quiz ronde 1, Go-kart, Bowlen)"/>
              <select value={selectedEvtId} onChange={e=>{setSelectedEvtId(e.target.value);setSaved(false);}}
                style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"9px 10px",color:selectedEvtId?"var(--cream)":"var(--muted)",fontFamily:"var(--font-b)",fontSize:".88rem",outline:"none",width:"100%"}}>
                <option value="">— Kies een event —</option>
                {activeEvents.map(e=>(
                  <option key={e.id} value={e.id}>{e.name} · {formatEventDateRange(e.date,e.end_date,{weekday:false,month:"short"})}</option>
                ))}
              </select>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <Btn onClick={saveToEvent} variant="gold" disabled={!setName.trim()||!selectedEvtId}>
                  💾 Opslaan
                </Btn>
                {saved&&<span className="pop" style={{color:"var(--green)",fontSize:".85rem",fontWeight:600}}>✓ Opgeslagen!</span>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Saved team sets across events ── */}
      {events.some(e=>(e.team_sets||[]).length>0)&&(
        <div style={{marginTop:"2rem"}}>
          <H size="1.1rem" style={{marginBottom:"1rem"}}>📂 Opgeslagen teams</H>
          {events.filter(e=>(e.team_sets||[]).length>0).map(evt=>(
            <div key={evt.id} style={{marginBottom:"1.2rem"}}>
              <div style={{fontSize:".8rem",fontFamily:"var(--font-b)",fontWeight:700,color:"var(--amber2)",textTransform:"uppercase",letterSpacing:".05em",marginBottom:".5rem",opacity:.8}}>
                {evt.name}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:".5rem"}}>
                {(evt.team_sets||[]).map(ts=>(
                  <div key={ts.id} style={{display:"flex",alignItems:"center",gap:10,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".65rem 1rem"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginBottom:2}}>
                        <span style={{fontFamily:"var(--font-b)",fontWeight:600,color:"var(--cream)",fontSize:".9rem"}}>{ts.name}</span>
                        {ts.category&&<span style={{background:"rgba(232,148,58,.15)",border:"1px solid rgba(232,148,58,.3)",borderRadius:20,padding:"1px 8px",fontSize:".68rem",fontFamily:"var(--font-b)",fontWeight:600,color:"var(--amber2)",letterSpacing:".04em"}}>{ts.category}</span>}
                      </div>
                      <div style={{color:"var(--muted)",fontSize:".78rem"}}>
                        {ts.teams.length} teams · {ts.teams.reduce((s,t)=>s+t.members.length,0)} personen
                        <span style={{marginLeft:8,opacity:.7}}>{new Date(ts.createdAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}</span>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {ts.teams.slice(0,4).map(t=>(
                        <span key={t.id} style={{fontSize:".95rem"}} title={t.name}>{t.avatar}</span>
                      ))}
                      {ts.teams.length>4&&<span style={{fontSize:".75rem",color:"var(--muted)"}}>+{ts.teams.length-4}</span>}
                    </div>
                    <Btn onClick={()=>onUpdateEvent({...evt,team_sets:(evt.team_sets||[]).filter(x=>x.id!==ts.id)})}
                      variant="ghost" size="sm" style={{color:"var(--red)",borderColor:"transparent",flexShrink:0,padding:"4px 8px"}}>
                      🗑
                    </Btn>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TIMER PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TIMER_PRESETS=[[30,"30s"],[60,"1m"],[120,"2m"],[300,"5m"],[600,"10m"],[900,"15m"],[1800,"30m"],[3600,"1u"]];
const TimerPage=()=>{
  const [totalSec,setTotalSec]=useState(60);
  const [remaining,setRemaining]=useState(60);
  const [running,setRunning]=useState(false);
  const [finished,setFinished]=useState(false);
  const [cMin,setCMin]=useState("1");
  const [cSec,setCsec]=useState("00");
  const intervalRef=useRef(null);

  useEffect(()=>{
    if(running){
      intervalRef.current=setInterval(()=>{
        setRemaining(r=>{
          if(r<=1){clearInterval(intervalRef.current);setRunning(false);setFinished(true);return 0;}
          return r-1;
        });
      },1000);
    } else clearInterval(intervalRef.current);
    return()=>clearInterval(intervalRef.current);
  },[running]);

  const applyPreset=s=>{
    clearInterval(intervalRef.current);setRunning(false);setFinished(false);
    setTotalSec(s);setRemaining(s);
    setCMin(String(Math.floor(s/60)));setCsec(String(s%60).padStart(2,"0"));
  };
  const applyCustom=()=>{
    const t=(parseInt(cMin)||0)*60+(parseInt(cSec)||0);
    if(t>0)applyPreset(t);
  };
  const start=()=>{if(remaining>0){setFinished(false);setRunning(true);}};
  const pause=()=>setRunning(false);
  const reset=()=>{clearInterval(intervalRef.current);setRunning(false);setFinished(false);setRemaining(totalSec);};

  const m=Math.floor(remaining/60);
  const s=remaining%60;
  const progress=totalSec>0?remaining/totalSec:0;
  const R=80;const circ=2*Math.PI*R;const dashOff=circ*(1-progress);
  const atStart=remaining===totalSec&&!running&&!finished;

  return(
    <div className="fu">
      <H size="1.7rem" style={{marginBottom:"1.5rem"}}>⏱ Timer</H>

      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:"2rem"}}>
        <div style={{position:"relative",width:200,height:200}}>
          <svg width="200" height="200" style={{transform:"rotate(-90deg)"}}>
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--bg3)" strokeWidth="9"/>
            <circle cx="100" cy="100" r={R} fill="none"
              stroke={finished?"var(--red)":running?"var(--amber)":"var(--muted2)"}
              strokeWidth="9" strokeDasharray={circ} strokeDashoffset={dashOff} strokeLinecap="round"
              style={{transition:running?"stroke-dashoffset 1s linear":"stroke-dashoffset .35s ease",filter:(running||finished)?`drop-shadow(0 0 8px ${finished?"var(--red)":"rgba(232,148,58,.7)"})`:"none"}}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <div className={finished?"qp-timer-warn":""} style={{fontFamily:"var(--font-h)",fontSize:finished?"2.8rem":"2.5rem",color:finished?"var(--red)":running?"var(--amber2)":"var(--cream)",lineHeight:1,letterSpacing:"-.02em"}}>
              {finished?"TIJD!": `${m}:${String(s).padStart(2,"0")}`}
            </div>
            {!finished&&<div style={{color:"var(--muted)",fontSize:".75rem",marginTop:5}}>
              {!atStart?`${Math.round((1-progress)*100)}% voorbij`:"klaar om te starten"}
            </div>}
          </div>
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:"1.8rem",flexWrap:"wrap"}}>
        {!running&&!finished&&remaining===totalSec&&<Btn onClick={start} variant="primary" size="lg" disabled={totalSec===0}>▶ Start</Btn>}
        {!running&&!finished&&remaining<totalSec&&<Btn onClick={start} variant="primary" size="lg">▶ Hervat</Btn>}
        {running&&<Btn onClick={pause} variant="subtle" size="lg">⏸ Pauze</Btn>}
        {finished&&<Btn onClick={applyPreset.bind(null,totalSec)} variant="primary" size="lg">▶ Opnieuw</Btn>}
        {(!atStart||finished)&&<Btn onClick={reset} variant="ghost" size="lg">↺ Reset</Btn>}
      </div>

      <Card style={{marginBottom:"1.2rem"}}>
        <H size="1rem" style={{marginBottom:".75rem"}}>Snelle instellingen</H>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {TIMER_PRESETS.map(([sec,label])=>{
            const active=totalSec===sec;
            return(
              <button key={sec} onClick={()=>applyPreset(sec)}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.color="var(--amber2)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=active?"var(--amber)":"var(--border)";e.currentTarget.style.color=active?"var(--amber2)":"var(--cream)";}}
                style={{background:active?"rgba(232,148,58,.12)":"var(--bg3)",border:`1px solid ${active?"var(--amber)":"var(--border)"}`,borderRadius:8,color:active?"var(--amber2)":"var(--cream)",padding:"8px 16px",cursor:"pointer",fontSize:".87rem",fontFamily:"var(--font-b)",fontWeight:active?600:400,transition:"all .15s"}}>
                {label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <H size="1rem" style={{marginBottom:".75rem"}}>Eigen tijd</H>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <Inp value={cMin} onChange={e=>setCMin(e.target.value.replace(/\D/g,""))} style={{width:72,textAlign:"center"}} placeholder="min" onKeyDown={e=>{if(e.key==="Enter")applyCustom();}}/>
            <span style={{color:"var(--muted)",fontWeight:700}}>:</span>
            <Inp value={cSec} onChange={e=>setCsec(e.target.value.replace(/\D/g,""))} style={{width:72,textAlign:"center"}} placeholder="sec" onKeyDown={e=>{if(e.key==="Enter")applyCustom();}}/>
          </div>
          <Btn onClick={applyCustom} variant="subtle">Instellen</Btn>
        </div>
        <div style={{color:"var(--muted)",fontSize:".75rem",marginTop:6}}>Minuten : Seconden</div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [events,setEvents]=useState(SEED_EVENTS);
  const [users,setUsers]=useState(SEED_USERS);
  const [currentUser,setCurrentUser]=useState(null);
  const [authView,setAuthView]=useState("login");
  const [activeId,setActiveId]=useState(null);
  const [pageView,setPageView]=useState("home"); // home | event | hof | members | member | updates | teams | timer
  const [showAdmin,setShowAdmin]=useState(false);
  const [newEvent,setNewEvent]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [activeMemberId,setActiveMemberId]=useState(null);
  const [editingProfile,setEditingProfile]=useState(false);
  const [notifications,setNotifications]=useState([]);
  const [notifLastRead,setNotifLastRead]=useState(()=>localStorage.getItem("notif-read")||"");
  const [deletedNotifIds,setDeletedNotifIds]=useState(new Set());
  const [clearedBefore,setClearedBefore]=useState("");
  useEffect(()=>{
    if(!currentUser)return;
    try{const s=JSON.parse(localStorage.getItem(`md-notifs-${currentUser.id}`)||"[]");setNotifications(s);}catch{}
  },[currentUser?.id]);
  const [announcements,setAnnouncements]=useState(()=>{try{return JSON.parse(localStorage.getItem("md-announcements")||"[]");}catch{return[];}});
  const [saraJayUnlocked,setSaraJayUnlocked]=useState(()=>{try{return JSON.parse(localStorage.getItem("md-sj-unlocked")||"false");}catch{return false;}});
  const [showAnnounce,setShowAnnounce]=useState(false);
  const [editingAnn,setEditingAnn]=useState(null);
  const eventsRef=useRef([]);
  useEffect(()=>{eventsRef.current=events;},[events]);
  const diffBaseRef=useRef([]);
  const currentUserRef=useRef(null);
  useEffect(()=>{currentUserRef.current=currentUser;},[currentUser]);

  useEffect(()=>{
    Promise.all([
      supabase.from("events").select("*").order("date"),
      supabase.from("users").select("*"),
      supabase.from("announcements").select("*").order("created_at",{ascending:false}),
    ]).then(async([{data:evts},{data:usrs},{data:anns}])=>{
      const fromDbAnn=r=>({id:r.id,title:r.title,body:r.body||"",createdBy:r.created_by||r.createdBy||"",createdAt:r.created_at||r.createdAt||"",active:r.active!==false});
      if(anns&&anns.length){
        const sjRow=anns.find(r=>r.id==="__sara_jay__");
        if(sjRow){const v=sjRow.active!==false;setSaraJayUnlocked(v);localStorage.setItem("md-sj-unlocked",JSON.stringify(v));}
        const delRow=anns.find(r=>r.id==="__deleted_notifs__");
        if(delRow){try{const raw=JSON.parse(delRow.body||"null");if(raw){const ids=Array.isArray(raw)?raw:(raw.ids||[]);const cb=Array.isArray(raw)?"":( raw.cleared_before||"");setDeletedNotifIds(new Set(ids));if(cb)setClearedBefore(cb);}}catch{}}
        const SYSTEM_IDS=new Set(["__sara_jay__","__deleted_notifs__"]);
        const mapped=anns.filter(r=>!SYSTEM_IDS.has(r.id)).map(fromDbAnn);
        setAnnouncements(mapped);localStorage.setItem("md-announcements",JSON.stringify(mapped));
      }
      // Seed DB on first run if empty
      let allEvents=evts?.length?evts:SEED_EVENTS;
      let allUsers=usrs?.length?usrs:[];
      if(!evts?.length){
        await supabase.from("events").insert(SEED_EVENTS);
      }
      if(!usrs?.length){
        const seeded=await Promise.all(SEED_USERS.map(async u=>({id:u.id,username:u.username,pin_hash:await hashPin(u.pin),role:u.role,joined_at:u.joined_at,avatar:u.avatar||0})));
        await supabase.from("users").insert(seeded);
        allUsers=seeded;
      }
      diffBaseRef.current=allEvents;
      setEvents(allEvents);
      setUsers(allUsers);
      const sessId=localStorage.getItem("md-session");
      if(sessId){const u=allUsers.find(u=>u.id===sessId);if(u)setCurrentUser(u);}
      setLoaded(true);
    });

    const poll=setInterval(()=>{
      supabase.from("announcements").select("*").order("created_at",{ascending:false}).then(({data})=>{if(data&&data.length){const fromDbAnn=r=>({id:r.id,title:r.title,body:r.body||"",createdBy:r.created_by||r.createdBy||"",createdAt:r.created_at||r.createdAt||"",active:r.active!==false});const sjRow=data.find(r=>r.id==="__sara_jay__");if(sjRow){const v=sjRow.active!==false;setSaraJayUnlocked(v);localStorage.setItem("md-sj-unlocked",JSON.stringify(v));}const delRow=data.find(r=>r.id==="__deleted_notifs__");if(delRow){try{const raw=JSON.parse(delRow.body||"null");if(raw){const ids=new Set(Array.isArray(raw)?raw:(raw.ids||[]));const cb=Array.isArray(raw)?"": (raw.cleared_before||"");setDeletedNotifIds(ids);if(cb)setClearedBefore(cb);setNotifications(prev=>{const next=prev.filter(n=>!ids.has(n.id)&&(!cb||n.timestamp>cb));const cu=currentUserRef.current;if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));return next;});}}catch{}}const SYSTEM_IDS=new Set(["__sara_jay__","__deleted_notifs__"]);const mapped=data.filter(r=>!SYSTEM_IDS.has(r.id)).map(fromDbAnn);setAnnouncements(mapped);localStorage.setItem("md-announcements",JSON.stringify(mapped));}});
      supabase.from("users").select("*").then(({data})=>{
        if(data){
          setUsers(data);
          const cu=currentUserRef.current;
          if(cu){
            const fresh=data.find(u=>u.id===cu.id);
            if(fresh){
              const changed=["role","display_name","photo_url","animal_avatar","bio","age"].some(k=>fresh[k]!==cu[k]);
              if(changed)setCurrentUser(fresh);
            }
          }
        }
      });
      supabase.from("events").select("*").order("date").then(({data})=>{
        if(data){
          const newActs=diffEvents(diffBaseRef.current,data);
          diffBaseRef.current=data;
          if(newActs.length){
            setNotifications(prev=>{
              const ids=new Set(prev.map(n=>n.id));
              const fresh=newActs.filter(n=>!ids.has(n.id));
              if(!fresh.length)return prev;
              const next=[...fresh,...prev].slice(0,100);
              const cu=currentUserRef.current;
              if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
              return next;
            });
          }
          setEvents(prev=>{
              const byId=new Map(data.map(e=>[e.id,e]));
              prev.forEach(e=>{if(!byId.has(e.id))byId.set(e.id,e);});
              return [...byId.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
            });
        }
      });
    },30000);

    // Real-time notification deletion broadcast
    const notifCtrl=supabase.channel("notif-ctrl")
      .on("broadcast",{event:"del-notif"},({payload})=>{
        if(!payload?.id)return;
        setDeletedNotifIds(s=>new Set([...s,payload.id]));
        setNotifications(prev=>{
          const next=prev.filter(n=>n.id!==payload.id);
          const cu=currentUserRef.current;
          if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
          return next;
        });
      })
      .on("broadcast",{event:"clear-notifs"},({payload})=>{
        const ids=new Set(payload?.ids||[]);
        const cb=payload?.cleared_before||"";
        setDeletedNotifIds(s=>new Set([...s,...ids]));
        if(cb)setClearedBefore(cb);
        setNotifications(prev=>{
          const next=prev.filter(n=>!ids.has(n.id)&&(!cb||n.timestamp>cb));
          const cu=currentUserRef.current;
          if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
          return next;
        });
      })
      .on("broadcast",{event:"push-notif"},({payload})=>{
        if(!payload?.notif)return;
        const n=payload.notif;
        setNotifications(prev=>{
          const ids=new Set(prev.map(x=>x.id));
          if(ids.has(n.id))return prev;
          const next=[n,...prev].slice(0,100);
          const cu=currentUserRef.current;
          if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
          return next;
        });
      })
      .subscribe();

    // Realtime notification generation for all event changes
    const evtNotifCh=supabase.channel("evt-notif-realtime")
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"events"},({new:updated})=>{
        if(!updated)return;
        const old=diffBaseRef.current.find(e=>e.id===updated.id);
        if(old){
          const acts=diffEvents([old],[updated]);
          if(acts.length){
            setNotifications(prev=>{
              const ids=new Set(prev.map(n=>n.id));
              const fresh=acts.filter(a=>!ids.has(a.id));
              if(!fresh.length)return prev;
              const next=[...fresh,...prev].slice(0,100);
              const cu=currentUserRef.current;
              if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
              return next;
            });
          }
        }
        diffBaseRef.current=diffBaseRef.current.map(e=>e.id===updated.id?updated:e);
      })
      .subscribe();

    return()=>{clearInterval(poll);supabase.removeChannel(notifCtrl);supabase.removeChannel(evtNotifCh);};
  },[]);

  const deleteNotifForAll=async(notifId)=>{
    const newSet=new Set([...deletedNotifIds,notifId]);
    setDeletedNotifIds(newSet);
    setNotifications(prev=>{
      const next=prev.filter(n=>n.id!==notifId);
      if(currentUser)localStorage.setItem(`md-notifs-${currentUser.id}`,JSON.stringify(next));
      return next;
    });
    const body=JSON.stringify({ids:[...newSet],cleared_before:clearedBefore});
    await supabase.from("announcements").upsert({id:"__deleted_notifs__",title:"__deleted_notifs__",body,created_by:"system",created_at:new Date().toISOString(),active:false});
    supabase.channel("notif-ctrl").send({type:"broadcast",event:"del-notif",payload:{id:notifId}});
  };

  const sendNotifToAll=(notif)=>{
    const n={id:`manual-${Date.now()}`,timestamp:new Date().toISOString(),...notif};
    setNotifications(prev=>{
      const ids=new Set(prev.map(x=>x.id));
      if(ids.has(n.id))return prev;
      const next=[n,...prev].slice(0,100);
      if(currentUser)localStorage.setItem(`md-notifs-${currentUser.id}`,JSON.stringify(next));
      return next;
    });
    supabase.channel("notif-ctrl").send({type:"broadcast",event:"push-notif",payload:{notif:n}});
  };

  const saveUsers=async u=>{
    setUsers(u);
    await supabase.from("users").upsert(u);
  };
  const login=u=>{setCurrentUser(u);localStorage.setItem("md-session",u.id);};
  const logout=()=>{setCurrentUser(null);localStorage.removeItem("md-session");setActiveId(null);setPageView("home");};
  const register=async u=>{
    const {error}=await supabase.from("users").insert([u]);
    if(error){console.error("Register error:",error);return error.message||"Onbekende fout";}
    setUsers(prev=>[...prev,u]);
    return null;
  };
  const updateUsers=async u=>{await saveUsers(u);if(currentUser){const r=u.find(x=>x.id===currentUser.id);if(r)setCurrentUser(r);}};
  const deleteUser=async id=>{
    setUsers(u=>u.filter(x=>x.id!==id));
    await supabase.from("users").delete().eq("id",id);
  };
  const updateEvent=async updated=>{
    if(typeof updated==="function"){
      setEvents(prev=>{
        const next=prev.map(e=>e.id===activeId?updated(e):e);
        const changed=next.find(e=>e.id===activeId);
        if(changed)supabase.from("events").upsert([changed]);
        return next;
      });
    } else {
      setEvents(prev=>prev.map(e=>e.id===updated.id?updated:e));
      await supabase.from("events").upsert([updated]);
    }
  };
  const saveEvents=async e=>{
    setEvents(e);
    await supabase.from("events").upsert(e);
  };
  const deleteEvent=async id=>{
    setEvents(prev=>prev.filter(e=>e.id!==id));
    await supabase.from("events").delete().eq("id",id);
    goHome();
  };
  const saveAnnouncement=async ann=>{
    const full={...ann,active:ann.active!==false};
    setAnnouncements(prev=>{
      const next=prev.findIndex(a=>a.id===full.id)>=0?prev.map(a=>a.id===full.id?full:a):[full,...prev];
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    // Use snake_case for Supabase; omit 'active' so old schemas without the column still work
    const dbRow={id:full.id,title:full.title,body:full.body||"",created_by:full.createdBy,created_at:full.createdAt};
    await supabase.from("announcements").upsert([dbRow]);
    setShowAnnounce(false);setEditingAnn(null);
  };
  const archiveAnnouncement=async id=>{
    setAnnouncements(prev=>{
      const next=prev.map(a=>a.id===id?{...a,active:false}:a);
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    await supabase.from("announcements").update({active:false}).eq("id",id);
  };
  const reactivateAnnouncement=async id=>{
    setAnnouncements(prev=>{
      const next=prev.map(a=>a.id===id?{...a,active:true}:a);
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    await supabase.from("announcements").update({active:true}).eq("id",id);
  };
  const hardDeleteAnnouncement=async id=>{
    setAnnouncements(prev=>{
      const next=prev.filter(a=>a.id!==id);
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    await supabase.from("announcements").delete().eq("id",id);
  };
  const [notifNav,setNotifNav]=useState(null);
  const openEvent=(id,tab,targetId)=>{setActiveId(id);setNotifNav(tab?{tab,targetId:targetId||null}:null);setPageView("event");};
  const goHome=()=>{setPageView("home");setActiveId(null);setActiveMemberId(null);};
  const goBack=()=>{
    if(pageView==="member")setPageView("members");
    else goHome();
  };
  const openMember=id=>{setActiveMemberId(id);setPageView("member");};
  const openTeams=()=>setPageView("teams");
  const openTimer=()=>setPageView("timer");
  const openSaraJay=()=>setPageView("sarajay");
  const toggleSaraJay=async()=>{
    const newVal=!saraJayUnlocked;
    setSaraJayUnlocked(newVal);
    localStorage.setItem("md-sj-unlocked",JSON.stringify(newVal));
    await supabase.from("announcements").upsert({id:"__sara_jay__",title:"__sara_jay__",body:"",created_by:"system",created_at:new Date().toISOString(),active:newVal});
  };
  const saveProfile=async updates=>{
    const{error}=await supabase.from("users").update(updates).eq("id",currentUser.id);
    if(!error){
      const updated={...currentUser,...updates};
      setCurrentUser(updated);
      setUsers(prev=>prev.map(u=>u.id===currentUser.id?updated:u));
    }
  };
  const activeEvent=events.find(e=>e.id===activeId);
  const activeMember=users.find(u=>u.id===activeMemberId);

  if(!loaded)return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif",background:"var(--bg)"}}><GS/>Loading…</div>;
  if(!currentUser){
    if(authView==="register")return<RegisterScreen users={users} onRegister={register} onGoLogin={()=>setAuthView("login")}/>;
    return<LoginScreen users={users} onLogin={login} onGoRegister={()=>setAuthView("register")}/>;
  }
  if(currentUser.role==="pending")return<PendingScreen user={currentUser} onLogout={logout}/>;

  return(
    <div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <GS/>
      <Nav view={pageView} eventName={pageView==="member"?(activeMember?.display_name||activeMember?.username||"Lid"):activeEvent?.name} onBack={goBack} currentUser={currentUser} onLogout={logout} onAdmin={()=>setShowAdmin(true)} onAnnounce={()=>setShowAnnounce(true)} onHof={()=>setPageView("hof")} onHome={goHome} onMembers={()=>setPageView("members")} pendingCount={users.filter(u=>u.role==="pending").length} notifications={notifications} notifLastRead={notifLastRead} onUpdates={()=>setPageView("updates")} onProfile={()=>openMember(currentUser.id)} onTeams={openTeams} onTimer={openTimer} onSaraJay={openSaraJay} saraJayUnlocked={saraJayUnlocked}/>
      <main style={{maxWidth:880,margin:"0 auto",padding:"78px 1.2rem 4rem"}}>
        <AnnouncementBanner announcements={announcements} currentUser={currentUser} onArchive={archiveAnnouncement} onHardDelete={hardDeleteAnnouncement} onReactivate={reactivateAnnouncement} onEdit={ann=>{setEditingAnn(ann);setShowAnnounce(true);}} onNew={()=>{setEditingAnn(null);setShowAnnounce(true);}}/>
        {pageView==="home"&&<Home events={events} onOpen={openEvent} onNew={()=>setNewEvent(true)} currentUser={currentUser} users={users} onTeams={openTeams} onTimer={openTimer} onSaraJay={openSaraJay} saraJayUnlocked={saraJayUnlocked}/>}
        {pageView==="hof"&&<HallOfFame events={events} users={users}/>}
        {pageView==="members"&&<MembersPage users={users} events={events} onOpenMember={openMember} currentUser={currentUser}/>}
        {pageView==="member"&&activeMember&&<MemberProfile user={activeMember} events={events} currentUser={currentUser} onEdit={()=>setEditingProfile(true)}/>}
        {pageView==="event"&&activeEvent&&<EventPage key={activeId+(notifNav?.tab||"")} evt={activeEvent} onUpdate={updateEvent} onSyncEvt={data=>setEvents(prev=>prev.map(e=>e.id===data.id?data:e))} onDelete={()=>deleteEvent(activeId)} currentUser={currentUser} users={users} events={events} initialTab={notifNav?.tab} scrollToId={notifNav?.targetId} onSendNotif={sendNotifToAll}/>}
        {pageView==="updates"&&<UpdatesPage notifications={notifications.filter(n=>!deletedNotifIds.has(n.id)&&(!clearedBefore||n.timestamp>clearedBefore))} notifLastRead={notifLastRead} currentUser={currentUser} onMarkAllRead={()=>{const t=new Date().toISOString();setNotifLastRead(t);localStorage.setItem("notif-read",t);}} onOpenEvent={openEvent} onClearSelf={()=>{setNotifications([]);if(currentUser)localStorage.removeItem(`md-notifs-${currentUser.id}`);}} onDeleteSelf={id=>{setNotifications(prev=>{const next=prev.filter(n=>n.id!==id);if(currentUser)localStorage.setItem(`md-notifs-${currentUser.id}`,JSON.stringify(next));return next;});}} onClearUpdates={async()=>{const cb=new Date().toISOString();const allIds=[...new Set([...deletedNotifIds,...notifications.map(n=>n.id)])];const newSet=new Set(allIds);setDeletedNotifIds(newSet);setClearedBefore(cb);setNotifications([]);if(currentUser)localStorage.removeItem(`md-notifs-${currentUser.id}`);const body=JSON.stringify({ids:allIds,cleared_before:cb});await supabase.from("announcements").upsert({id:"__deleted_notifs__",title:"__deleted_notifs__",body,created_by:"system",created_at:new Date().toISOString(),active:false});supabase.channel("notif-ctrl").send({type:"broadcast",event:"clear-notifs",payload:{ids:allIds,cleared_before:cb}});}} onDeleteNotif={deleteNotifForAll}/>}
        {pageView==="teams"&&<TeamCreatorPage users={users} events={events} onUpdateEvent={updateEvent}/>}
        {pageView==="timer"&&<TimerPage/>}
        {pageView==="sarajay"&&<SaraJayOrJAI/>}
      </main>
      <div style={{textAlign:"center",padding:"1.5rem",color:"var(--muted2)",fontSize:".72rem",borderTop:"1px solid var(--border)",letterSpacing:".1em"}}>🍺 MensApp · Built for the lads</div>
      {showAdmin&&<AdminPanel users={users} onUpdateUsers={updateUsers} onDeleteUser={deleteUser} onClose={()=>setShowAdmin(false)} saraJayUnlocked={saraJayUnlocked} onToggleSaraJay={toggleSaraJay}/>}
      {showAnnounce&&can.announce(currentUser)&&<AnnouncementModal onSave={saveAnnouncement} onClose={()=>{setShowAnnounce(false);setEditingAnn(null);}} existing={editingAnn} currentUser={currentUser}/>}
      {newEvent&&can.editEvent(currentUser)&&<NewEventModal users={users} onSave={async evt=>{setEvents(prev=>[...prev,evt]);setNewEvent(false);openEvent(evt.id);await supabase.from("events").upsert([evt]);}} onClose={()=>setNewEvent(false)}/>}
      {editingProfile&&<EditProfileModal user={currentUser} onSave={async u=>{await saveProfile(u);setEditingProfile(false);}} onClose={()=>setEditingProfile(false)}/>}
    </div>
  );
}
