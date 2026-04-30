import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, hashPin } from "./supabase.js";

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
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes countUp{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
    @keyframes reveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0% 0 0)}}
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
  `}</style>
);

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const Card = ({children,style={},className=""}) => (
  <div className={className} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.4rem",...style}}>{children}</div>
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
  return <button type={type} onClick={onClick} disabled={disabled} style={{borderRadius:"var(--radius-sm)",cursor:disabled?"not-allowed":"pointer",fontFamily:"var(--font-b)",fontWeight:600,transition:"all .18s",opacity:disabled?.5:1,...sz[size],...vr[variant],...style}}>{children}</button>;
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
const Modal = ({children,onClose,maxWidth=500}) => (
  <div className="ov" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
    <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth,maxHeight:"92vh",overflowY:"auto"}}>
      <Card style={{padding:"1.8rem"}}>{children}</Card>
    </div>
  </div>
);
const RoleBadge = ({role}) => {
  const m={admin:{color:"var(--amber)",label:"Admin"},member:{color:"var(--green)",label:"Member"},pending:{color:"var(--muted)",label:"Pending"}};
  const r=m[role]||m.pending;
  return <Tag color={r.color}>{r.label}</Tag>;
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
const can = {
  editEvent:    u=>u?.role==="admin",
  manageUsers:  u=>u?.role==="admin",
  addWinner:    u=>u?.role==="admin",
  editSchedule: u=>u?.role==="admin",
  createPoll:   u=>u?.role==="admin",
  closePoll:    u=>u?.role==="admin",
  deletePoll:   u=>u?.role==="admin",
  deletePhoto:  u=>u?.role==="admin",
  hostQuiz:     u=>u?.role==="admin",
  vote:         u=>["admin","member"].includes(u?.role),
  uploadPhoto:  u=>["admin","member"].includes(u?.role),
  reactPhoto:   u=>["admin","member"].includes(u?.role),
  updateRsvp:   u=>["admin","member"].includes(u?.role),
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
const Nav = ({view,eventName,onBack,currentUser,onLogout,onAdmin,onHof,onHome,onMembers,pendingCount,notifications,notifLastRead,onMarkNotifRead}) => {
  const [menuOpen,setMenuOpen]=useState(false);
  const [notifOpen,setNotifOpen]=useState(false);
  const isMobile=useIsMobile();
  const unread=notifications.filter(n=>n.timestamp>notifLastRead).length;
  const typeIcon={rsvp:"📅",faq:"❓",answer:"💬",photo:"📷"};
  const timeAgo=ts=>{const d=Date.now()-new Date(ts);if(d<60000)return"zojuist";if(d<3600000)return`${Math.floor(d/60000)} min geleden`;if(d<86400000)return`${Math.floor(d/3600000)} uur geleden`;return`${Math.floor(d/86400000)} d geleden`;};
  useEffect(()=>{
    if(!notifOpen&&!menuOpen)return;
    const close=()=>{setNotifOpen(false);setMenuOpen(false);};
    document.addEventListener("click",close);
    return()=>document.removeEventListener("click",close);
  },[notifOpen,menuOpen]);
  const notifList=(
    <div>
      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",fontSize:".75rem",color:"var(--muted)",fontWeight:600,letterSpacing:".08em",textTransform:"uppercase"}}>Activiteit</div>
      {notifications.length===0
        ?<div style={{padding:"2rem",textAlign:"center",color:"var(--muted)",fontSize:".83rem"}}>Nog geen activiteit</div>
        :notifications.map(n=>(
          <div key={n.id} style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",display:"flex",gap:10,alignItems:"flex-start"}}>
            <span style={{fontSize:"1rem",flexShrink:0}}>{typeIcon[n.type]||"•"}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:".83rem",color:"var(--cream)",wordBreak:"break-word"}}>{n.message}</div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{n.event} · {timeAgo(n.timestamp)}</div>
            </div>
          </div>
        ))
      }
    </div>
  );
  return(
    <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:200,background:"rgba(15,11,7,.94)",backdropFilter:"blur(14px)",borderBottom:"1px solid var(--border)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 1.2rem",height:58,gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1}}>
          {view!=="home"&&<button onClick={onBack} style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--muted)",padding:"5px 12px",cursor:"pointer",fontSize:".8rem",fontFamily:"var(--font-b)",flexShrink:0}}>← Terug</button>}
          <div onClick={onHome} style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",cursor:"pointer"}}>
            {view==="home"?"🍺 Mensday":view==="hof"?"🏅 Hall of Fame":view==="members"?"👥 Lads":eventName}
          </div>
        </div>
        {!isMobile&&(
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <button onClick={onMembers} style={{background:(view==="members"||view==="member")?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>👥 Lads</button>
            <button onClick={onHof} style={{background:view==="hof"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>🏅 Hall of Fame</button>
            {can.manageUsers(currentUser)&&<button onClick={onAdmin} style={{position:"relative",background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>⚙ Admin{pendingCount>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingCount}</span>}</button>}
            <div style={{position:"relative"}} onClick={e=>e.stopPropagation()}>
              <button onClick={()=>{const o=!notifOpen;setNotifOpen(o);setMenuOpen(false);if(o&&unread>0)onMarkNotifRead();}} style={{position:"relative",background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>🔔{unread>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{unread}</span>}</button>
              {notifOpen&&<div onClick={e=>e.stopPropagation()} style={{position:"absolute",right:0,top:"calc(100% + 8px)",width:300,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:"var(--radius)",boxShadow:"0 8px 32px rgba(0,0,0,.5)",zIndex:300,maxHeight:360,overflowY:"auto"}}>{notifList}</div>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"5px 12px"}}>
              <Avatar name={currentUser.username} size={22} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
              <span style={{fontSize:".8rem",color:"var(--cream)"}}>{currentUser.username}</span>
              <RoleBadge role={currentUser.role}/>
            </div>
            <button onClick={onLogout} style={{background:"transparent",border:"1px solid rgba(224,85,85,.3)",borderRadius:8,color:"var(--red)",padding:"5px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>Uitloggen</button>
          </div>
        )}
        {isMobile&&(
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <div style={{position:"relative"}} onClick={e=>e.stopPropagation()}>
              <button onClick={()=>{const o=!notifOpen;setNotifOpen(o);setMenuOpen(false);if(o&&unread>0)onMarkNotifRead();}} style={{position:"relative",background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",padding:"6px 10px",cursor:"pointer",fontSize:"1rem"}}>🔔{unread>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{unread}</span>}</button>
            </div>
            <button onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o);setNotifOpen(false);}} style={{position:"relative",background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",padding:"6px 11px",cursor:"pointer",fontSize:"1.1rem",lineHeight:1}}>
              {menuOpen?"✕":"☰"}{!menuOpen&&pendingCount>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingCount}</span>}
            </button>
          </div>
        )}
      </div>
      {isMobile&&menuOpen&&(
        <div onClick={e=>e.stopPropagation()} style={{background:"rgba(15,11,7,.98)",borderBottom:"1px solid var(--border)",padding:".8rem 1.2rem",display:"grid",gap:".5rem"}}>
          <button onClick={()=>{onMembers();setMenuOpen(false);}} style={{background:(view==="members"||view==="member")?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>👥 Lads</button>
          <button onClick={()=>{onHof();setMenuOpen(false);}} style={{background:view==="hof"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>🏅 Hall of Fame</button>
          {can.manageUsers(currentUser)&&<button onClick={()=>{onAdmin();setMenuOpen(false);}} style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:8}}>⚙ Admin{pendingCount>0&&<span style={{background:"var(--red)",color:"#fff",borderRadius:"50%",width:20,height:20,fontSize:".7rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{pendingCount}</span>}</button>}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"8px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Avatar name={currentUser.username} size={26} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/><span style={{fontSize:".88rem",color:"var(--cream)"}}>{currentUser.username}</span><RoleBadge role={currentUser.role}/></div>
            <button onClick={()=>{onLogout();setMenuOpen(false);}} style={{background:"transparent",border:"1px solid rgba(224,85,85,.3)",borderRadius:8,color:"var(--red)",padding:"6px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>Uitloggen</button>
          </div>
        </div>
      )}
      {isMobile&&notifOpen&&(
        <div onClick={e=>e.stopPropagation()} style={{background:"rgba(15,11,7,.98)",borderBottom:"1px solid var(--border)",maxHeight:300,overflowY:"auto"}}>{notifList}</div>
      )}
    </nav>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
const AdminPanel = ({users,onUpdateUsers,onDeleteUser,onClose}) => {
  const [tab,setTab]=useState("pending");
  const pending=users.filter(u=>u.role==="pending");
  const approved=users.filter(u=>u.role!=="pending");
  const approve=(id,role="member")=>onUpdateUsers(users.map(u=>u.id===id?{...u,role}:u));
  const reject=(id)=>onDeleteUser(id);
  const promote=(id)=>onUpdateUsers(users.map(u=>u.id===id?{...u,role:"admin"}:u));
  const demote=(id)=>onUpdateUsers(users.map(u=>u.id===id?{...u,role:"member"}:u));
  const remove=(id)=>{if(window.confirm("Remove this user?"))onDeleteUser(id);};
  return(
    <Modal onClose={onClose} maxWidth={600}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}>
        <H style={{marginBottom:0}}>⚙ Admin Panel</H>
        <Btn onClick={onClose} variant="ghost" size="sm">✕ Close</Btn>
      </div>
      {pending.length>0&&<div style={{background:"rgba(232,148,58,.1)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:"10px 14px",marginBottom:"1.2rem",display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:"1.2rem"}}>⏳</span><span style={{color:"var(--amber2)",fontSize:".88rem",fontWeight:600}}>{pending.length} pending approval{pending.length>1?"s":""}</span></div>}
      <div style={{display:"flex",gap:".3rem",borderBottom:"1px solid var(--border)",marginBottom:"1.2rem"}}>
        {["pending","users"].map(t=><button key={t} onClick={()=>setTab(t)} style={{background:"none",border:"none",borderBottom:tab===t?"2px solid var(--amber)":"2px solid transparent",color:tab===t?"var(--amber2)":"var(--muted)",cursor:"pointer",padding:"7px 16px",fontFamily:"var(--font-b)",fontWeight:tab===t?600:400,fontSize:".85rem",marginBottom:-1,transition:"color .15s"}}>{t==="pending"?"Pending":"All Users"}{t==="pending"&&pending.length>0&&<span style={{background:"var(--red)",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:".68rem",marginLeft:6}}>{pending.length}</span>}</button>)}
      </div>
      {tab==="pending"&&<div style={{display:"grid",gap:".8rem"}}>
        {pending.length===0&&<div style={{color:"var(--muted)",fontSize:".88rem",textAlign:"center",padding:"2rem"}}>No pending requests 🎉</div>}
        {pending.map(u=>(
          <div key={u.id} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:"1rem 1.1rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
            <Avatar name={u.username} size={36} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
            <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".95rem"}}>{u.username}</div><div style={{color:"var(--muted)",fontSize:".75rem"}}>Requested {new Date(u.joined_at).toLocaleDateString("nl-NL")}</div></div>
            <div style={{display:"flex",gap:6}}>
              <Btn onClick={()=>approve(u.id,"member")} variant="success" size="sm">✓ Approve</Btn>
              <Btn onClick={()=>approve(u.id,"admin")} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"var(--border2)"}}>★ Admin</Btn>
              <Btn onClick={()=>reject(u.id)} variant="danger" size="sm">✕</Btn>
            </div>
          </div>
        ))}
      </div>}
      {tab==="users"&&<div style={{display:"grid",gap:".7rem"}}>
        {approved.map(u=>(
          <div key={u.id} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
            <Avatar name={u.username} size={32} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
            <div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontWeight:600,fontSize:".92rem"}}>{u.username}</span><RoleBadge role={u.role}/></div><div style={{color:"var(--muted)",fontSize:".73rem",marginTop:2}}>Joined {new Date(u.joined_at).toLocaleDateString("nl-NL")}</div></div>
            <div style={{display:"flex",gap:6}}>
              {u.role==="member"&&<Btn onClick={()=>promote(u.id)} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"var(--border2)",fontSize:".73rem"}}>★ Admin</Btn>}
              {u.role==="admin"&&<Btn onClick={()=>demote(u.id)} variant="ghost" size="sm" style={{fontSize:".73rem"}}>↓ Member</Btn>}
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
                  <div style={{fontWeight:600,fontSize:".95rem"}}>{p.name}</div>
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
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:"1rem",marginBottom:"1.5rem",height:160}}>
            {[attendance[1],attendance[0],attendance[2]].filter(Boolean).map((p,i)=>{
              const realIdx=i===0?1:i===1?0:2;
              const h=[120,160,90][realIdx];
              return(
                <div key={p.name} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                  <Avatar name={p.name} size={40} {...getUA(p.name,users)}/>
                  <div style={{fontWeight:600,fontSize:".9rem"}}>{p.name}</div>
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
                <div style={{fontWeight:600,fontSize:".9rem"}}>{a.name}</div>
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
                  <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{w.name}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{w.count} award{w.count!==1?"s":""}</div></div>
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
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{p.name}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{p.quizzes} quiz{p.quizzes!==1?"zes":""} played</div></div>
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
    if(a.role==="admin"&&b.role!=="admin")return -1;
    if(b.role==="admin"&&a.role!=="admin")return 1;
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
const Home = ({events,onOpen,onNew,currentUser,users=[]}) => {
  const upcoming=events.filter(e=>!e.archived).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const past=events.filter(e=>e.archived).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const nextEvt=upcoming[0];
  const goingLads=nextEvt?nextEvt.attendees.filter(a=>a.status==="going"):[];
  const totalEditions=events.length;
  const hypers=["No excuses. No mercy. Just lads.","The brotherhood doesn't sleep.","Every year. No matter what.","Legends are made here.","It's that time again."];
  const hype=hypers[(new Date().getMonth()+new Date().getDate())%hypers.length];
  return(
    <div style={{display:"grid",gap:"2.5rem"}}>

      {/* ── HERO ── */}
      <div className="fu" style={{textAlign:"center",padding:"3rem 0 .5rem",position:"relative"}}>
        <div style={{position:"absolute",inset:0,background:"var(--hero-glow)",pointerEvents:"none"}}/>
        <div className="float" style={{fontSize:"4.5rem",marginBottom:".5rem",display:"inline-block"}}>🍺</div>
        <h1 style={{fontFamily:"var(--font-h)",fontStyle:"italic",fontSize:"clamp(3rem,10vw,6rem)",color:"var(--amber2)",lineHeight:.9,letterSpacing:"-.02em",marginBottom:".6rem"}}>MENSDAY</h1>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:12,marginBottom:"1.2rem"}}>
          <div style={{height:1,flex:1,maxWidth:60,background:"linear-gradient(to right,transparent,var(--border2))"}}/>
          <span style={{color:"var(--muted)",fontSize:".72rem",letterSpacing:".25em",textTransform:"uppercase"}}>{hype}</span>
          <div style={{height:1,flex:1,maxWidth:60,background:"linear-gradient(to left,transparent,var(--border2))"}}/>
        </div>
        {totalEditions>0&&(
          <div style={{display:"inline-flex",gap:"2rem",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:50,padding:".6rem 2rem",flexWrap:"wrap",justifyContent:"center"}}>
            {[
              [goingLads.length,"Lads In 🔥"],
              [totalEditions,"Editions 🏆"],
              [past.length,"Legendary 💀"],
            ].map(([v,l])=>(
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.6rem",color:"var(--amber)",lineHeight:1}}>{v}</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",letterSpacing:".12em",textTransform:"uppercase",marginTop:2}}>{l}</div>
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

      {/* ── ARCHIVES ── */}
      {past.length>0&&(
        <div className="fu2">
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
  const isUpcoming=!evt.archived&&!countdown.past;
  const myStatusColor=myStatus?colorOf(myStatus):"var(--muted)";

  if(compact) return(
    <div className="event-card-upcoming" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",cursor:"pointer",position:"relative",overflow:"hidden",display:"flex",alignItems:"center",gap:"1rem"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--border2)"}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=""}}
      onClick={()=>onOpen(evt.id)}>
      <div style={{fontFamily:"var(--font-h)",fontSize:"1.5rem",color:"var(--muted2)",opacity:.4,minWidth:44,textAlign:"center"}}>{new Date(evt.date).getFullYear()}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"var(--amber2)"}}>{evt.name}</div>
        <div style={{color:"var(--muted)",fontSize:".73rem",marginTop:2}}>
          {new Date(evt.date).toLocaleDateString("nl-NL",{day:"numeric",month:"long"})}
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
    <div className={`event-card-upcoming${isUpcoming?" glow-pulse":""}`}
      style={{background:isUpcoming?"linear-gradient(135deg,#1a1008,#221608,#1a1008)":"var(--bg2)",border:`1px solid ${isUpcoming?"rgba(232,148,58,.3)":"var(--border)"}`,borderRadius:"var(--radius)",cursor:"pointer",position:"relative",overflow:"hidden"}}
      onClick={()=>onOpen(evt.id)}>

      {/* Top accent bar */}
      {isUpcoming&&<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber))",backgroundSize:"200% 100%",animation:"goldShimmer 3s linear infinite"}}/>}

      {/* Main content */}
      <div style={{padding:"1.4rem",display:"flex",gap:"1.2rem",alignItems:"flex-start"}}>
        <div style={{flex:1,minWidth:0}}>
          {/* Tags */}
          <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
            <Tag color={evt.type==="weekend"?"var(--purple)":"var(--amber)"}>{evt.type==="weekend"?"🏕️ Weekend":"📅 Day Event"}</Tag>
            {evt.theme&&<Tag color="var(--gold)">✨ {evt.theme}</Tag>}
            {myStatus&&(
              <span style={{background:myStatusColor+"22",color:myStatusColor,border:`1px solid ${myStatusColor}44`,borderRadius:6,padding:"3px 10px",fontSize:".72rem",fontWeight:700}}>
                {myStatus==="going"?"🔒 Locked In":myStatus==="maybe"?"🤔 Maybe":myStatus==="not coming"?"❌ Can't Make It":statusMap[myStatus]?.label}
              </span>
            )}
          </div>

          {/* Event name */}
          <div style={{fontFamily:"var(--font-h)",fontSize:"1.5rem",color:"var(--amber2)",marginBottom:5,lineHeight:1.1}}>{evt.name}</div>

          {/* Date / location */}
          <div style={{color:"var(--muted)",fontSize:".82rem",marginBottom:8}}>
            {new Date(evt.date).toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
            {evt.start_time&&<span style={{color:"var(--amber)",marginLeft:6}}>⏰ {evt.start_time}{evt.end_time&&`–${evt.end_time}`}</span>}
            {evt.location&&evt.location!=="TBD"&&<span style={{marginLeft:6}}>· 📍 {evt.location}</span>}
          </div>

          {evt.description&&<div style={{color:"var(--cream)",opacity:.6,fontSize:".84rem",marginBottom:8,lineHeight:1.5}}>{evt.description}</div>}

          {/* Lads going */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
            <div style={{display:"flex"}}>{evt.attendees.filter(a=>["went","going"].includes(a.status)).slice(0,6).map((a,i)=><div key={i} style={{marginLeft:i===0?0:-8,borderRadius:"50%",border:"2px solid var(--bg2)"}}><Avatar name={a.name} size={24} {...getUA(a.name,users)}/></div>)}</div>
            {going>0&&<span style={{fontSize:".75rem",color:"var(--muted)"}}><strong style={{color:"var(--cream)"}}>{going}</strong> lad{going!==1?"s":""} {evt.archived?"attended":"in"}</span>}
          </div>
        </div>

        {/* Right: countdown or year */}
        <div style={{flexShrink:0,textAlign:"center"}}>
          {isUpcoming?(
            <div style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.2)",borderRadius:12,padding:".8rem .9rem"}}>
              <div style={{fontSize:".6rem",color:"var(--amber)",letterSpacing:".15em",textTransform:"uppercase",marginBottom:6}}>Happening in</div>
              <div style={{display:"flex",gap:4,alignItems:"flex-end"}}>
                {[["d","d"],["h","h"],["m","m"]].map(([k,l])=>(
                  <div key={k} style={{textAlign:"center",minWidth:28}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"1.6rem",color:"var(--amber2)",lineHeight:1,fontWeight:900}}>{String(countdown[k]??0).padStart(2,"0")}</div>
                    <div style={{fontSize:".55rem",color:"var(--muted)",letterSpacing:".1em"}}>{l}</div>
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

      {/* Activity sneak-peek strip */}
      {evt.schedule&&evt.schedule.length>0&&(
        <div style={{padding:"0 1.4rem 1.2rem",borderTop:"1px solid var(--border)"}}>
          <div style={{fontSize:".63rem",color:"var(--muted)",letterSpacing:".15em",textTransform:"uppercase",marginBottom:8,marginTop:10}}>What's on the menu</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {evt.schedule.slice(0,6).map((s,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:5,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:"var(--cream)",opacity:.85}}>
                <span style={{fontSize:"1rem"}}>{s.icon||"📍"}</span>
                <span>{s.activity}</span>
                {s.time&&<span style={{color:"var(--amber)",fontSize:".68rem",marginLeft:2}}>{s.time}</span>}
              </div>
            ))}
            {evt.schedule.length>6&&<div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:"var(--muted)"}}>+{evt.schedule.length-6} more 👀</div>}
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TABS=["Overview","Polls","Quiz","Photos","Winners & Highlights","FAQ"];

const EventPage=({evt,onUpdate,onDelete,currentUser,users=[]})=>{
  const [tab,setTab]=useState("Overview");
  const [editing,setEditing]=useState(false);
  const countdown=useCountdown(evt.date,evt.start_time);
  const isPast=evt.archived;
  const isAdmin=can.editEvent(currentUser);

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

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"1.5rem"}}>
            <div style={{flex:1,minWidth:0}}>
              {/* Big italic event name */}
              <div style={{fontFamily:"var(--font-h)",fontStyle:"italic",fontSize:"clamp(1.8rem,5vw,2.8rem)",color:"var(--amber2)",lineHeight:1.05,marginBottom:".7rem",fontWeight:900,letterSpacing:"-.01em"}}>{evt.name}</div>

              {/* Date + time row */}
              <div style={{display:"flex",flexWrap:"wrap",gap:".5rem",marginBottom:".4rem",alignItems:"center"}}>
                <span style={{color:"var(--cream)",opacity:.75,fontSize:".88rem"}}>📅 {new Date(evt.date).toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</span>
                {evt.start_time&&<span style={{color:"var(--amber)",fontSize:".88rem",fontWeight:700}}>⏰ {evt.start_time}{evt.end_time&&` – ${evt.end_time}`}</span>}
              </div>
              {evt.location&&evt.location!=="TBD"&&<div style={{color:"var(--cream)",opacity:.65,fontSize:".86rem",marginBottom:".5rem"}}>📍 {evt.location}</div>}
              {evt.description&&<div style={{color:"var(--muted)",fontSize:".84rem",maxWidth:500,lineHeight:1.6,marginTop:".5rem"}}>{evt.description}</div>}

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
              <div style={{flexShrink:0}}>
                <div style={{fontSize:".6rem",color:"var(--orange)",letterSpacing:".18em",textTransform:"uppercase",textAlign:"center",marginBottom:12,fontWeight:700}}>⚡ T-MINUS</div>
                <div style={{display:"flex",gap:".4rem",alignItems:"flex-end"}}>
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
        </div>

        {/* Footer bar */}
        <div style={{borderTop:"1px solid var(--border)",padding:".8rem 1.8rem",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,background:"rgba(0,0,0,.25)"}}>
          {isAdmin?(
            <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
              <Btn onClick={()=>setEditing(true)} variant="ghost" size="sm">✎ Edit</Btn>
              {!isPast&&<Btn onClick={()=>onUpdate({...evt,archived:true})} variant="ghost" size="sm" style={{color:"var(--muted)"}}>Archive</Btn>}
              {isPast&&<Btn onClick={()=>onUpdate({...evt,archived:false})} variant="ghost" size="sm">Reopen</Btn>}
              <Btn onClick={onDelete} variant="danger" size="sm">Delete</Btn>
            </div>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <Avatar name={currentUser.username} size={22} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
              <span style={{fontSize:".74rem",color:"var(--muted)"}}>Viewing as <strong style={{color:"var(--cream)"}}>{currentUser.username}</strong></span>
            </div>
          )}
          {evt.schedule&&evt.schedule.length>0&&<span style={{fontSize:".71rem",color:"var(--muted)",letterSpacing:".05em"}}>{evt.schedule.length} activities on the menu 👀</span>}
        </div>
      </div>

      <div className="fu1" style={{display:"flex",gap:".2rem",borderBottom:"1px solid var(--border)",overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{background:"none",border:"none",borderBottom:tab===t?"2px solid var(--amber)":"2px solid transparent",color:tab===t?"var(--amber2)":"var(--muted)",cursor:"pointer",padding:"8px 14px",whiteSpace:"nowrap",fontFamily:"var(--font-b)",fontWeight:tab===t?600:400,fontSize:".83rem",marginBottom:-1,transition:"color .15s"}}>{t}</button>
        ))}
      </div>

      <div className="fu2">
        {tab==="Overview"             &&<OverviewTab evt={evt} onUpdate={onUpdate} isPast={isPast} currentUser={currentUser} users={users}/>}
        {tab==="Polls"                &&<PollsTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast} users={users}/>}
        {tab==="Quiz"                 &&<QuizTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast} users={users}/>}
        {tab==="Photos"               &&<PhotosTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
        {tab==="Winners & Highlights" &&<WinnersTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast}/>}
        {tab==="FAQ"                  &&<FAQTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
      </div>

      {editing&&<EditEventModal evt={evt} users={users} onSave={u=>{onUpdate(u);setEditing(false)}} onClose={()=>setEditing(false)}/>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB — Member RSVP + Schedule
// ─────────────────────────────────────────────────────────────────────────────
const OverviewTab=({evt,onUpdate,isPast,currentUser,users=[]})=>{
  const [editSched,setEditSched]=useState(false);
  const statusOpts=isPast?["went","absent"]:["going","maybe","not coming"];
  const colorOf=s=>statusMap[s]?.color??"var(--muted)";
  const isAdmin=can.editEvent(currentUser);

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
  };

  const totals=statusOpts.reduce((acc,s)=>{acc[s]=evt.attendees.filter(a=>a.status===s).length;return acc;},{});

  return(
    <div style={{display:"grid",gap:"1.4rem"}}>

      {/* ── RSVP card ── */}
      {!isPast&&can.updateRsvp(currentUser)&&(
        <Card style={{background:"linear-gradient(135deg,#1e1508,#291a08)",borderColor:"var(--border2)",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:-40,right:-40,width:140,height:140,background:"radial-gradient(circle,rgba(232,148,58,.1),transparent 70%)",borderRadius:"50%",pointerEvents:"none"}}/>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:"1rem"}}>
            <Avatar name={currentUser.username} size={38} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
            <div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)",fontWeight:700}}>{currentUser.username}</div>
              <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:1}}>
                {myEntry?<>Current status: <strong style={{color:colorOf(myEntry.status)}}>{statusMap[myEntry.status]?.label}</strong></>:"Not on the list yet — lock in your spot"}
              </div>
            </div>
          </div>
          <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--cream)",opacity:.85,marginBottom:".8rem",fontStyle:"italic"}}>Are you coming? Make it official.</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {[{s:"going",emoji:"🔥",label:"I'm In"},{s:"maybe",emoji:"🤔",label:"Maybe"},{s:"not coming",emoji:"❌",label:"Can't Make It"}].map(({s,emoji,label})=>{
              const sel=myEntry?.status===s;
              const c=colorOf(s);
              return(
                <button key={s} className="rsvp-btn" onClick={()=>selfRsvp(s)} style={{
                  background:sel?`${c}22`:"transparent",
                  border:`2px solid ${sel?c:`${c}40`}`,
                  color:sel?c:"var(--muted)",
                  borderRadius:"var(--radius-sm)",padding:"10px 20px",cursor:"pointer",
                  fontFamily:"var(--font-b)",fontWeight:700,fontSize:".88rem",
                  display:"flex",alignItems:"center",gap:7,
                  boxShadow:sel?`0 0 18px ${c}30`:"none",
                }}>
                  <span style={{fontSize:"1.15rem"}}>{emoji}</span>
                  {label}
                  {sel&&<span style={{fontSize:".62rem",letterSpacing:".08em",opacity:.75,marginLeft:2}}>✓</span>}
                </button>
              );
            })}
          </div>
        </Card>
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

        <div style={{display:"grid",gap:".55rem"}}>
          {evt.schedule.map((s,i)=>(
            <div key={i} className="schedule-card" style={{
              display:"flex",alignItems:"center",gap:"1rem",
              background:isPast?"var(--bg3)":"linear-gradient(90deg,rgba(29,20,8,.9),rgba(21,14,4,.7))",
              border:`1px solid ${isPast?"var(--border)":"rgba(232,148,58,.18)"}`,
              borderRadius:"var(--radius-sm)",padding:".8rem 1rem",
              position:"relative",overflow:"hidden",
              animationDelay:`${i*.07}s`,
            }}>
              {/* Left accent */}
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:isPast?"linear-gradient(to bottom,var(--muted2),var(--muted))":"linear-gradient(to bottom,var(--amber),var(--gold))",opacity:isPast?.4:.7}}/>

              {/* Icon bubble */}
              <div style={{
                width:42,height:42,borderRadius:11,flexShrink:0,
                background:isPast?"var(--bg4)":"rgba(232,148,58,.1)",
                border:`1px solid ${isPast?"var(--border)":"rgba(232,148,58,.28)"}`,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.25rem",
              }}>{s.icon||"📍"}</div>

              {/* Time */}
              {s.time&&<div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:isPast?"var(--muted)":"var(--amber)",fontWeight:700,flexShrink:0,minWidth:40,textAlign:"center"}}>{s.time}</div>}

              {/* Content */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:".92rem",color:isPast?"var(--cream)":"var(--amber2)",marginBottom:2}}>{s.activity}</div>
                {s.location&&(
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    {s.locationUrl
                      ?<a href={s.locationUrl} target="_blank" rel="noreferrer" style={{fontSize:".74rem",color:"var(--amber)",textDecoration:"none",opacity:.8}}>📍 {s.location} ↗</a>
                      :<span style={{fontSize:".74rem",color:"var(--muted)"}}>📍 {s.location}</span>
                    }
                  </div>
                )}
                {s.note&&<div style={{fontSize:".72rem",color:"var(--muted)",fontStyle:"italic",marginTop:2}}>💬 {s.note}</div>}
              </div>

              {/* Right badge */}
              {isPast
                ?<div style={{flexShrink:0,fontSize:".62rem",color:"var(--green)",letterSpacing:".1em",textTransform:"uppercase",opacity:.7,fontWeight:700}}>✓ Done</div>
                :<div style={{flexShrink:0,fontSize:".62rem",color:"var(--amber)",letterSpacing:".1em",textTransform:"uppercase",opacity:.65,fontWeight:700}}>Revealed</div>
              }
            </div>
          ))}
        </div>
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
                  <div><span style={{fontWeight:500,fontSize:".86rem"}}>{a.name}</span>{isMe&&<span style={{fontSize:".68rem",color:"var(--amber)",marginLeft:6}}>you</span>}</div>
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

// Backwards-compat: old quizzes had flat `questions`, new ones use `rounds`
const normalizeQuiz=q=>q.rounds?q:{
  ...q,defaultTime:30,
  rounds:[{id:"r0",title:"Round 1",theme:"",questions:q.questions||[]}],
};

const QuizTab=({evt,onUpdate,currentUser,isPast,users=[]})=>{
  const [view,setView]=useState("list");
  const [activeQuiz,setActiveQuiz]=useState(null);
  const [hostState,setHostState]=useState(null);
  const [playerAnswer,setPlayerAnswer]=useState(null);
  const [timer,setTimer]=useState(0);
  const timerRef=useRef(null);

  const isAdmin=can.hostQuiz(currentUser);
  const quizzes=evt.quizzes||[];
  const saveQuizzes=q=>onUpdate({...evt,quizzes:q});

  const startHost=(quiz)=>{
    const nq=normalizeQuiz(quiz);
    setActiveQuiz(nq);
    setHostState({phase:"round-intro",roundIdx:0,qIdx:0,scores:Object.fromEntries(evt.attendees.map(a=>[a.name,0])),answers:{},pausedPhase:null});
    setView("host");
  };

  const currentRound=activeQuiz&&hostState?activeQuiz.rounds[hostState.roundIdx]:null;
  const currentQ=currentRound?currentRound.questions[hostState.qIdx]:null;
  const totalRounds=activeQuiz?.rounds?.length||0;
  const totalQInRound=currentRound?.questions?.length||0;

  // Timer — fires when entering "question" phase
  useEffect(()=>{
    if(view==="host"&&hostState?.phase==="question"&&currentQ){
      const limit=currentQ.timeLimit||activeQuiz.defaultTime||30;
      setTimer(limit);
      timerRef.current=setInterval(()=>{
        setTimer(t=>{if(t<=1){clearInterval(timerRef.current);revealAnswer();return 0;}return t-1;});
      },1000);
    }
    return()=>clearInterval(timerRef.current);
  },[hostState?.phase,hostState?.roundIdx,hostState?.qIdx]);

  const revealAnswer=useCallback(()=>{
    clearInterval(timerRef.current);
    setHostState(s=>{
      if(!activeQuiz||!s)return s;
      const q=activeQuiz.rounds[s.roundIdx].questions[s.qIdx];
      const newScores={...s.scores};
      Object.entries(s.answers||{}).forEach(([name,picked])=>{
        if(picked===q.answer)newScores[name]=(newScores[name]||0)+(q.points||100);
      });
      return{...s,phase:"answer",scores:newScores};
    });
  },[activeQuiz]);

  const nextStep=()=>{
    setPlayerAnswer(null);
    setHostState(s=>{
      if(!s||!activeQuiz)return s;
      const round=activeQuiz.rounds[s.roundIdx];
      const isLastQ=s.qIdx>=round.questions.length-1;
      const isLastRound=s.roundIdx>=activeQuiz.rounds.length-1;
      if(!isLastQ) return{...s,phase:"question",qIdx:s.qIdx+1,answers:{}};
      if(!isLastRound) return{...s,phase:"round-scores",answers:{}};
      const finished={...activeQuiz,status:"finished",scores:s.scores};
      saveQuizzes(quizzes.map(q=>q.id===activeQuiz.id?finished:q));
      setActiveQuiz(finished);
      return{...s,phase:"finished"};
    });
  };

  const startRound=()=>setHostState(s=>({...s,phase:"question"}));
  const startNextRound=()=>setHostState(s=>({...s,phase:"round-intro",roundIdx:s.roundIdx+1,qIdx:0,answers:{}}));
  const pauseQuiz=()=>{clearInterval(timerRef.current);setHostState(s=>({...s,pausedPhase:s.phase,phase:"paused"}));};
  const resumeQuiz=()=>setHostState(s=>({...s,phase:s.pausedPhase,pausedPhase:null}));

  const recordAnswer=(name,idx)=>{
    if(hostState?.phase!=="question")return;
    setHostState(s=>({...s,answers:{...(s.answers||{}),[name]:idx}}));
  };
  const submitPlayerAnswer=(idx)=>{
    if(playerAnswer!==null)return;
    setPlayerAnswer(idx);
    recordAnswer(currentUser.username,idx);
  };

  if(view==="build") return(
    <QuizBuilder onSave={quiz=>{saveQuizzes([...(evt.quizzes||[]),{...quiz,id:`qz${Date.now()}`,status:"ready",scores:{}}]);setView("list");}} onCancel={()=>setView("list")}/>
  );

  if(view==="host"&&activeQuiz&&hostState){
    const sortedScores=Object.entries(hostState.scores).sort((a,b)=>b[1]-a[1]);
    const {phase,roundIdx,qIdx}=hostState;
    const timeLimit=currentQ?(currentQ.timeLimit||activeQuiz.defaultTime||30):30;
    const flatQIdx=activeQuiz.rounds.slice(0,roundIdx).reduce((s,r)=>s+r.questions.length,0)+qIdx;
    const ScoreList=({compact=false})=>(
      <div style={{display:"grid",gap:".5rem"}}>
        {sortedScores.map(([name,score],i)=>(
          <div key={name} style={{display:"flex",alignItems:"center",gap:10,background:"var(--bg3)",borderRadius:8,padding:compact?"7px 12px":"10px 14px",border:!compact&&i===0?"1px solid var(--gold)":"1px solid var(--border)"}}>
            <div style={{fontFamily:"var(--font-h)",fontSize:compact?".9rem":"1.1rem",color:["var(--gold)","var(--muted)","#cd7f32"][i]||"var(--muted2)",minWidth:28,textAlign:"center"}}>{["🥇","🥈","🥉"][i]||`${i+1}.`}</div>
            <Avatar name={name} size={compact?24:28} {...getUA(name,users)}/>
            <div style={{flex:1,fontWeight:600,fontSize:compact?".88rem":".95rem"}}>{name}</div>
            <div style={{fontFamily:"var(--font-h)",color:"var(--amber)",fontSize:compact?"1rem":"1.1rem"}}>{score}</div>
          </div>
        ))}
      </div>
    );
    return(
      <div style={{display:"grid",gap:"1.2rem"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <H size="1.2rem" style={{marginBottom:".2rem"}}>{activeQuiz.title}</H>
            <div style={{fontSize:".78rem",color:"var(--muted)"}}>🎤 Quizmaster · Round {roundIdx+1}/{totalRounds}{currentRound?.title&&<span style={{color:"var(--amber)"}}> · {currentRound.title}</span>}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            {phase==="question"&&<Btn onClick={pauseQuiz} variant="ghost" size="sm">⏸ Pause</Btn>}
            {phase==="paused"&&<Btn onClick={resumeQuiz} variant="gold" size="sm">▶ Resume</Btn>}
            <Btn onClick={()=>{clearInterval(timerRef.current);setView("list");setHostState(null);setActiveQuiz(null);}} variant="ghost" size="sm">✕ End</Btn>
          </div>
        </div>

        {/* Progress bar */}
        {phase!=="finished"&&phase!=="round-intro"&&phase!=="round-scores"&&phase!=="paused"&&(
          <div>
            <div style={{display:"flex",gap:3,marginBottom:3}}>
              {activeQuiz.rounds.map((r,ri)=>r.questions.map((_,qi)=>{
                const flat=activeQuiz.rounds.slice(0,ri).reduce((s,x)=>s+x.questions.length,0)+qi;
                return <div key={`${ri}-${qi}`} style={{flex:1,height:4,borderRadius:2,background:flat<flatQIdx?"var(--amber)":flat===flatQIdx?"var(--amber2)":"var(--bg3)",transition:"background .3s"}}/>;
              }))}
            </div>
            {totalRounds>1&&(
              <div style={{display:"flex",gap:2}}>
                {activeQuiz.rounds.map((r,ri)=>(
                  <div key={ri} style={{flex:r.questions.length,fontSize:".65rem",color:ri===roundIdx?"var(--amber)":"var(--muted2)",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {r.title||`R${ri+1}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FINISHED */}
        {phase==="finished"&&(
          <Card style={{textAlign:"center",padding:"2.5rem"}}>
            <div style={{fontSize:"3rem",marginBottom:"1rem"}}>🏆</div>
            <H size="1.8rem">Quiz Complete!</H>
            <div style={{maxWidth:360,margin:"1.5rem auto"}}><ScoreList/></div>
            <Btn onClick={()=>{setView("list");setHostState(null);setActiveQuiz(null);}}>Back to Quizzes</Btn>
          </Card>
        )}

        {/* PAUSED */}
        {phase==="paused"&&(
          <Card style={{textAlign:"center",padding:"2.5rem"}}>
            <div style={{fontSize:"3rem",marginBottom:"1rem"}}>⏸</div>
            <H size="1.5rem">Quiz Paused</H>
            <div style={{color:"var(--muted)",fontSize:".88rem",marginBottom:"1.5rem"}}>Take a break — resume whenever you're ready.</div>
            <div style={{maxWidth:340,margin:"0 auto 1.5rem"}}><Divider label="scores so far"/><div style={{marginTop:"1rem"}}><ScoreList compact/></div></div>
            <Btn onClick={resumeQuiz} variant="gold" size="lg">▶ Resume Quiz</Btn>
          </Card>
        )}

        {/* ROUND INTRO */}
        {phase==="round-intro"&&(
          <Card style={{textAlign:"center",padding:"3rem",background:"linear-gradient(135deg,#1f1609,#2e1e0a)",borderColor:"var(--border2)"}}>
            <div style={{fontSize:"2rem",marginBottom:".6rem"}}>🎯</div>
            <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".12em",textTransform:"uppercase",marginBottom:".5rem"}}>Round {roundIdx+1} of {totalRounds}</div>
            <H size="1.8rem" style={{marginBottom:".4rem"}}>{currentRound?.title||`Round ${roundIdx+1}`}</H>
            {currentRound?.theme&&<div style={{color:"var(--muted)",fontSize:".88rem",marginBottom:"1rem"}}>{currentRound.theme}</div>}
            <div style={{color:"var(--muted2)",fontSize:".8rem",marginBottom:"1.5rem"}}>{currentRound?.questions?.length||0} questions</div>
            <Btn onClick={startRound} variant="gold" size="lg">Start Round →</Btn>
          </Card>
        )}

        {/* ROUND SCORES */}
        {phase==="round-scores"&&(
          <Card style={{textAlign:"center",padding:"2.5rem"}}>
            <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>📊</div>
            <H size="1.5rem">After Round {roundIdx+1}</H>
            <div style={{color:"var(--muted)",fontSize:".82rem",marginBottom:"1.5rem"}}>
              {totalRounds-roundIdx-1} round{totalRounds-roundIdx-1!==1?"s":""} to go!
            </div>
            <div style={{maxWidth:360,margin:"0 auto 1.5rem"}}><ScoreList/></div>
            <Btn onClick={startNextRound} variant="gold" size="lg">Next Round →</Btn>
          </Card>
        )}

        {/* QUESTION / ANSWER */}
        {(phase==="question"||phase==="answer")&&currentQ&&(
          <>
            <Card style={{padding:"2rem",position:"relative"}}>
              <div style={{fontSize:".75rem",color:"var(--muted)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:"1rem"}}>
                Q {qIdx+1}/{totalQInRound}{totalRounds>1&&<span style={{color:"var(--amber2)",marginLeft:8}}>{currentRound?.title}</span>}
              </div>

              {/* Timer ring */}
              {phase==="question"&&(
                <div style={{position:"absolute",top:"1.2rem",right:"1.2rem",width:52,height:52}}>
                  <svg width="52" height="52" style={{transform:"rotate(-90deg)"}}>
                    <circle cx="26" cy="26" r="22" fill="none" stroke="var(--bg3)" strokeWidth="4"/>
                    <circle cx="26" cy="26" r="22" fill="none" stroke={timer/timeLimit>0.33?"var(--amber)":"var(--red)"} strokeWidth="4"
                      strokeDasharray="138" strokeDashoffset={138*(1-timer/timeLimit)} style={{transition:"stroke-dashoffset 1s linear,stroke .3s"}}/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-h)",fontSize:"1.1rem",color:timer/timeLimit>0.33?"var(--amber)":"var(--red)",fontWeight:900}}>{timer}</div>
                </div>
              )}

              {/* Question image */}
              {currentQ.image&&(
                <div style={{marginBottom:"1.2rem",textAlign:"center"}}>
                  <img src={currentQ.image} alt="" style={{maxWidth:"100%",maxHeight:260,objectFit:"contain",borderRadius:"var(--radius-sm)"}}/>
                </div>
              )}

              <H size="1.4rem" style={{marginBottom:"1.5rem",paddingRight:currentQ.image?0:60}}>{currentQ.q}</H>

              <div style={{display:"grid",gridTemplateColumns:currentQ.options.length<=2?"1fr":"1fr 1fr",gap:"1rem"}}>
                {currentQ.options.map((opt,i)=>{
                  const isCorrect=i===currentQ.answer;
                  const answeredCount=Object.values(hostState.answers||{}).filter(a=>a===i).length;
                  const bg=phase==="answer"?(isCorrect?"rgba(76,175,125,.25)":"rgba(224,85,85,.08)"):"var(--bg3)";
                  const border=phase==="answer"?(isCorrect?"2px solid var(--green)":"1px solid rgba(224,85,85,.15)"):"1px solid var(--border)";
                  return(
                    <div key={i} style={{background:bg,border,borderRadius:"var(--radius-sm)",padding:"1rem",transition:"all .3s",position:"relative"}}>
                      <div style={{fontSize:".88rem",fontWeight:600,color:phase==="answer"&&isCorrect?"var(--green)":"var(--cream)"}}>{ALPHA[i]}. {opt}</div>
                      {phase==="answer"&&isCorrect&&<div style={{fontSize:".72rem",color:"var(--green)",marginTop:4}}>✓ Correct</div>}
                      {answeredCount>0&&<div style={{position:"absolute",top:8,right:8,background:"rgba(232,148,58,.15)",borderRadius:6,padding:"2px 7px",fontSize:".7rem",color:"var(--amber)"}}>{answeredCount}</div>}
                    </div>
                  );
                })}
              </div>

              {phase==="question"&&(
                <div style={{display:"flex",gap:8,marginTop:"1.5rem",flexWrap:"wrap"}}>
                  <Btn onClick={revealAnswer} variant="ghost" size="sm">Reveal Answer Early</Btn>
                  <Btn onClick={pauseQuiz} variant="ghost" size="sm">⏸ Pause</Btn>
                </div>
              )}
              {phase==="answer"&&(
                <Btn onClick={nextStep} style={{marginTop:"1.5rem"}} size="lg">
                  {qIdx<totalQInRound-1?"Next Question →":roundIdx<totalRounds-1?"End Round & See Scores 📊":"See Final Results 🏆"}
                </Btn>
              )}
            </Card>

            {/* Live scores */}
            <Card>
              <H size="1rem" style={{marginBottom:".8rem"}}>Live Scores</H>
              <ScoreList compact/>
            </Card>
          </>
        )}
      </div>
    );
  }

  // Quiz list
  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:".85rem",color:"var(--muted)"}}>Pub quizzes for this event</div>
        {isAdmin&&<Btn onClick={()=>setView("build")} size="sm">+ New Quiz</Btn>}
      </div>
      {!isAdmin&&<div style={{background:"rgba(232,148,58,.07)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"10px 14px",fontSize:".83rem",color:"var(--muted)"}}>🎤 Only admins can host a quiz. Join when the host starts one!</div>}
      {quizzes.length===0&&(
        <Card style={{textAlign:"center",padding:"3rem",color:"var(--muted)"}}>
          <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>🧠</div>
          <div style={{fontFamily:"var(--font-h)",marginBottom:".4rem"}}>No quizzes yet</div>
          {isAdmin&&<div style={{fontSize:".83rem"}}>Create one to battle it out on the day!</div>}
        </Card>
      )}
      {quizzes.map(quiz=>{
        const nq=normalizeQuiz(quiz);
        const totalQ=nq.rounds.reduce((s,r)=>s+r.questions.length,0);
        const totalPts=nq.rounds.reduce((s,r)=>s+r.questions.reduce((ss,q)=>ss+(q.points||100),0),0);
        const topScore=quiz.scores?Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1])[0]:null;
        return(
          <Card key={quiz.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1rem"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                  <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber2)"}}>{quiz.title}</div>
                  <Tag color={quiz.status==="finished"?"var(--green)":quiz.status==="live"?"var(--red)":"var(--muted)"}>{quiz.status==="finished"?"✓ Done":quiz.status==="live"?"🔴 Live":"Ready"}</Tag>
                </div>
                <div style={{fontSize:".78rem",color:"var(--muted)"}}>
                  {nq.rounds.length>1?`${nq.rounds.length} rounds · `:""}{totalQ} questions · {totalPts} pts total
                </div>
                {nq.rounds.length>1&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>{nq.rounds.map((r,i)=><Tag key={i} color="var(--muted2)">{r.title||`Round ${i+1}`}</Tag>)}</div>}
                {topScore&&quiz.status==="finished"&&<div style={{fontSize:".78rem",color:"var(--gold)",marginTop:3}}>🏆 Winner: {topScore[0]} ({topScore[1]} pts)</div>}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                {isAdmin&&quiz.status!=="finished"&&<Btn onClick={()=>startHost(quiz)} variant="gold" size="sm">🎤 Host</Btn>}
                {isAdmin&&<Btn onClick={()=>saveQuizzes(quizzes.filter(q=>q.id!==quiz.id))} variant="danger" size="sm">✕</Btn>}
              </div>
            </div>
            {quiz.status==="finished"&&quiz.scores&&(
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1]).map(([name,score],i)=>(
                  <div key={name} style={{display:"flex",alignItems:"center",gap:6,background:"var(--bg3)",borderRadius:8,padding:"5px 10px"}}>
                    <span style={{fontSize:".72rem",color:["var(--gold)","var(--muted)","#cd7f32"][i]||"var(--muted2)"}}>{["🥇","🥈","🥉"][i]||`${i+1}.`}</span>
                    <span style={{fontSize:".82rem",fontWeight:600}}>{name}</span>
                    <span style={{fontSize:".78rem",color:"var(--amber)"}}>{score}</span>
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
const QuizBuilder=({onSave,onCancel})=>{
  const [title,setTitle]=useState("");
  const [defaultTime,setDefaultTime]=useState(30);
  const [rounds,setRounds]=useState([{id:`r${Date.now()}`,title:"Round 1",theme:"",questions:[{q:"",options:["","","",""],answer:0,points:100,timeLimit:null,image:null}]}]);
  const imgRefs=useRef({});

  const addRound=()=>setRounds(r=>[...r,{id:`r${Date.now()}`,title:`Round ${r.length+1}`,theme:"",questions:[{q:"",options:["","","",""],answer:0,points:100,timeLimit:null,image:null}]}]);
  const delRound=(ri)=>setRounds(r=>r.length>1?r.filter((_,i)=>i!==ri):r);
  const updRound=(ri,f,v)=>setRounds(r=>r.map((x,i)=>i===ri?{...x,[f]:v}:x));

  const addQ=(ri)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:[...round.questions,{q:"",options:["","","",""],answer:0,points:100,timeLimit:null,image:null}]}:round));
  const delQ=(ri,qi)=>setRounds(r=>r.map((round,i)=>i===ri&&round.questions.length>1?{...round,questions:round.questions.filter((_,j)=>j!==qi)}:round));
  const updQ=(ri,qi,f,v)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>j===qi?{...q,[f]:v}:q)}:round));
  const updOpt=(ri,qi,oi,v)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>j===qi?{...q,options:q.options.map((o,k)=>k===oi?v:o)}:q)}:round));

  const addOpt=(ri,qi)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>j===qi&&q.options.length<8?{...q,options:[...q.options,""]}:q)}:round));
  const delOpt=(ri,qi,oi)=>setRounds(r=>r.map((round,i)=>i===ri?{...round,questions:round.questions.map((q,j)=>{
    if(j!==qi)return q;
    const opts=q.options.filter((_,k)=>k!==oi);
    const ans=q.answer===oi?0:q.answer>oi?q.answer-1:q.answer;
    return{...q,options:opts,answer:Math.min(ans,opts.length-1)};
  })}:round));

  const handleImg=async(ri,qi,e)=>{
    const file=e.target.files[0];if(!file)return;
    const path=`quiz-images/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const{data,error}=await supabase.storage.from("event-photos").upload(path,file);
    if(!error){const{data:{publicUrl}}=supabase.storage.from("event-photos").getPublicUrl(data.path);updQ(ri,qi,"image",publicUrl);}
    else console.error("Image upload failed:",error);
    e.target.value="";
  };

  const valid=title.trim()&&rounds.every(r=>r.title.trim()&&r.questions.every(q=>q.q.trim()&&q.options.filter(o=>o.trim()).length>=2));

  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <H style={{marginBottom:0}}>New Quiz</H>
        <Btn onClick={onCancel} variant="ghost" size="sm">Cancel</Btn>
      </div>

      {/* Quiz-level settings */}
      <Card style={{background:"var(--bg3)"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"1rem",alignItems:"end"}}>
          <div><Lbl>Quiz Title</Lbl><Inp value={title} onChange={e=>setTitle(e.target.value)} placeholder="Mensday Pub Quiz" autoFocus/></div>
          <div>
            <Lbl>Default time / question</Lbl>
            <select value={defaultTime} onChange={e=>setDefaultTime(+e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 10px",color:"var(--cream)",fontSize:".88rem",fontFamily:"var(--font-b)"}}>
              {[10,15,20,30,45,60,90,120].map(t=><option key={t} value={t}>{t}s</option>)}
            </select>
          </div>
        </div>
      </Card>

      {/* Rounds */}
      {rounds.map((round,ri)=>(
        <div key={round.id} style={{border:"1px solid var(--border2)",borderRadius:"var(--radius)",overflow:"hidden"}}>
          {/* Round header */}
          <div style={{background:"rgba(232,148,58,.08)",borderBottom:"1px solid var(--border)",padding:"1rem 1.2rem",display:"flex",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
            <div style={{fontFamily:"var(--font-h)",color:"var(--amber)",fontSize:"1rem",flexShrink:0}}>Round {ri+1}</div>
            <div style={{flex:1,minWidth:140}}><Inp value={round.title} onChange={e=>updRound(ri,"title",e.target.value)} placeholder="Round title…" style={{padding:"7px 10px",fontSize:".85rem"}}/></div>
            <div style={{flex:1,minWidth:140}}><Inp value={round.theme} onChange={e=>updRound(ri,"theme",e.target.value)} placeholder="Theme (optional)…" style={{padding:"7px 10px",fontSize:".85rem"}}/></div>
            {rounds.length>1&&<Btn onClick={()=>delRound(ri)} variant="danger" size="sm">✕ Remove</Btn>}
          </div>

          {/* Questions */}
          <div style={{padding:"1rem",display:"grid",gap:"1rem"}}>
            {round.questions.map((q,qi)=>(
              <div key={qi} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:"1.1rem",border:"1px solid var(--border)"}}>
                {/* Question header row */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem",flexWrap:"wrap",gap:6}}>
                  <div style={{fontWeight:600,fontSize:".88rem",color:"var(--amber)"}}>Q{qi+1}</div>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                    <select value={q.points} onChange={e=>updQ(ri,qi,"points",+e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"5px 8px",color:"var(--muted)",fontSize:".75rem",fontFamily:"var(--font-b)"}}>
                      {[50,100,200,300,500].map(p=><option key={p} value={p}>{p} pts</option>)}
                    </select>
                    <select value={q.timeLimit??""} onChange={e=>updQ(ri,qi,"timeLimit",e.target.value===""?null:+e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"5px 8px",color:"var(--muted)",fontSize:".75rem",fontFamily:"var(--font-b)"}}>
                      <option value="">⏱ {defaultTime}s (default)</option>
                      {[10,15,20,30,45,60,90,120].map(t=><option key={t} value={t}>⏱ {t}s</option>)}
                    </select>
                    {round.questions.length>1&&<Btn onClick={()=>delQ(ri,qi)} variant="danger" size="sm" style={{padding:"5px 10px"}}>✕</Btn>}
                  </div>
                </div>

                {/* Question text */}
                <div style={{marginBottom:".8rem"}}>
                  <Lbl>Question</Lbl>
                  <Inp value={q.q} onChange={e=>updQ(ri,qi,"q",e.target.value)} placeholder="Type your question here…"/>
                </div>

                {/* Image */}
                <div style={{marginBottom:"1rem"}}>
                  {q.image?(
                    <div style={{position:"relative",display:"inline-block"}}>
                      <img src={q.image} alt="" style={{maxWidth:"100%",maxHeight:150,borderRadius:"var(--radius-sm)",objectFit:"contain",display:"block"}}/>
                      <button onClick={()=>updQ(ri,qi,"image",null)} style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,.75)",border:"none",borderRadius:"50%",color:"#fff",width:22,height:22,cursor:"pointer",fontSize:"13px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-b)"}}>✕</button>
                    </div>
                  ):(
                    <>
                      <input ref={el=>imgRefs.current[`${ri}-${qi}`]=el} type="file" accept="image/*" onChange={e=>handleImg(ri,qi,e)} style={{display:"none"}}/>
                      <Btn onClick={()=>imgRefs.current[`${ri}-${qi}`]?.click()} variant="ghost" size="sm" style={{fontSize:".75rem"}}>📷 Add image</Btn>
                    </>
                  )}
                </div>

                {/* Answer options */}
                <Lbl>Options — click ○ to mark correct answer</Lbl>
                <div style={{display:"grid",gap:6,marginTop:6}}>
                  {q.options.map((opt,oi)=>(
                    <div key={oi} style={{display:"flex",alignItems:"center",gap:8}}>
                      <div onClick={()=>updQ(ri,qi,"answer",oi)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${q.answer===oi?"var(--green)":"var(--border)"}`,background:q.answer===oi?"var(--green)":"transparent",cursor:"pointer",flexShrink:0,transition:"all .2s"}}/>
                      <div style={{width:"1.2rem",flexShrink:0,color:"var(--muted)",fontSize:".78rem",fontWeight:600}}>{ALPHA[oi]}</div>
                      <Inp value={opt} onChange={e=>updOpt(ri,qi,oi,e.target.value)} placeholder={`Option ${ALPHA[oi]}`} style={{padding:"8px 10px",fontSize:".83rem"}}/>
                      {q.options.length>2&&<Btn onClick={()=>delOpt(ri,qi,oi)} variant="ghost" size="sm" style={{padding:"5px 8px",flexShrink:0,fontSize:".72rem"}}>✕</Btn>}
                    </div>
                  ))}
                </div>
                {q.options.length<8&&<Btn onClick={()=>addOpt(ri,qi)} variant="ghost" size="sm" style={{marginTop:8,fontSize:".75rem"}}>+ Add option</Btn>}
              </div>
            ))}
            <Btn onClick={()=>addQ(ri)} variant="subtle" size="sm">+ Add Question to {round.title||`Round ${ri+1}`}</Btn>
          </div>
        </div>
      ))}

      <Btn onClick={addRound} variant="ghost" size="sm" style={{borderStyle:"dashed"}}>+ Add Round</Btn>
      <Btn onClick={()=>onSave({title,defaultTime,rounds})} disabled={!valid} size="lg">Save Quiz</Btn>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// POLLS TAB
// ─────────────────────────────────────────────────────────────────────────────
const PollsTab=({evt,onUpdate,currentUser,isPast,users=[]})=>{
  const [creating,setCreating]=useState(false);
  const [newPoll,setNewPoll]=useState({title:"",emoji:"📊",options:["",""]});
  const savePolls=p=>onUpdate({...evt,polls:p});
  const vote=(pollId,optIdx)=>{
    if(!can.vote(currentUser))return;
    savePolls(evt.polls.map(p=>{
      if(p.id!==pollId||p.closed)return p;
      return{...p,options:p.options.map((o,i)=>{
        if(i===optIdx)return o.votes.includes(currentUser.username)?{...o,votes:o.votes.filter(v=>v!==currentUser.username)}:{...o,votes:[...o.votes,currentUser.username]};
        return{...o,votes:o.votes.filter(v=>v!==currentUser.username)};
      })};
    }));
  };
  const addPoll=()=>{
    const opts=newPoll.options.filter(o=>o.trim());
    if(!newPoll.title.trim()||opts.length<2)return;
    savePolls([...evt.polls,{id:`p${Date.now()}`,title:newPoll.title,emoji:newPoll.emoji,closed:false,options:opts.map(o=>({label:o,votes:[]}))}]);
    setNewPoll({title:"",emoji:"📊",options:["",""]});setCreating(false);
  };
  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".8rem"}}>
        <div style={{fontSize:".82rem",color:"var(--muted)"}}>Voting as <strong style={{color:"var(--cream)"}}>{currentUser.username}</strong></div>
        {can.createPoll(currentUser)&&!isPast&&<Btn onClick={()=>setCreating(true)} size="sm">+ New Poll</Btn>}
      </div>
      {!can.vote(currentUser)&&<div style={{background:"rgba(232,148,58,.07)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"10px 14px",fontSize:".83rem",color:"var(--muted)"}}>🔒 Member access required to vote.</div>}
      {evt.polls.length===0&&<Card style={{textAlign:"center",padding:"3rem",color:"var(--muted)"}}>No polls yet{!can.createPoll(currentUser)?" — admin will add one soon.":""}.</Card>}
      {evt.polls.map(poll=>{
        const total=poll.options.reduce((s,o)=>s+o.votes.length,0);
        const maxV=Math.max(...poll.options.map(o=>o.votes.length));
        return(
          <Card key={poll.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1rem"}}>
              <div>
                <div style={{fontSize:"1.3rem",marginBottom:3}}>{poll.emoji}</div>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)"}}>{poll.title}</div>
                <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{total} vote{total!==1?"s":""} · {poll.closed?"🔒 Closed":"🟢 Open"}</div>
              </div>
              {can.closePoll(currentUser)&&!isPast&&(
                <div style={{display:"flex",gap:6}}>
                  <Btn onClick={()=>savePolls(evt.polls.map(p=>p.id===poll.id?{...p,closed:!p.closed}:p))} variant="ghost" size="sm">{poll.closed?"Reopen":"Close"}</Btn>
                  <Btn onClick={()=>savePolls(evt.polls.filter(p=>p.id!==poll.id))} variant="danger" size="sm">✕</Btn>
                </div>
              )}
            </div>
            <div style={{display:"grid",gap:6}}>
              {poll.options.map((opt,i)=>{
                const pct=total?Math.round(opt.votes.length/total*100):0;
                const myVote=opt.votes.includes(currentUser.username);
                const isWinner=opt.votes.length===maxV&&opt.votes.length>0;
                const clickable=can.vote(currentUser)&&!isPast&&!poll.closed;
                return(
                  <div key={i} onClick={()=>clickable&&vote(poll.id,i)} style={{borderRadius:10,overflow:"hidden",position:"relative",border:myVote?"1px solid var(--amber)":"1px solid var(--border)",cursor:clickable?"pointer":"default",transition:"border-color .15s"}}>
                    <div style={{position:"absolute",inset:0,background:myVote?"rgba(232,148,58,.12)":"rgba(255,255,255,.02)",width:pct+"%",transition:"width .35s ease"}}/>
                    <div style={{position:"relative",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 13px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        {isWinner&&<span style={{fontSize:"13px"}}>👑</span>}
                        <span style={{fontWeight:myVote?600:400,color:myVote?"var(--amber2)":"var(--cream)",fontSize:".87rem"}}>{opt.label}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:9}}>
                        <div style={{display:"flex"}}>{opt.votes.slice(0,5).map((v,vi)=><div key={vi} style={{marginLeft:vi===0?0:-6}}><Avatar name={v} size={20} {...getUA(v,users)}/></div>)}{opt.votes.length>5&&<span style={{fontSize:".68rem",color:"var(--muted)",marginLeft:4,alignSelf:"center"}}>+{opt.votes.length-5}</span>}</div>
                        <span style={{color:"var(--amber)",fontWeight:700,fontSize:".86rem",minWidth:32,textAlign:"right"}}>{pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      {creating&&(
        <Modal onClose={()=>setCreating(false)} maxWidth={440}>
          <H>New Poll</H>
          <div style={{display:"grid",gap:".85rem"}}>
            <div style={{display:"flex",gap:8}}><Inp value={newPoll.emoji} onChange={e=>setNewPoll({...newPoll,emoji:e.target.value})} style={{width:52,textAlign:"center",fontSize:"1.1rem",flexShrink:0}}/><Inp value={newPoll.title} onChange={e=>setNewPoll({...newPoll,title:e.target.value})} placeholder="Poll question…"/></div>
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
            <div style={{display:"flex",gap:8}}><Btn onClick={addPoll}>Create</Btn><Btn onClick={()=>setCreating(false)} variant="ghost">Cancel</Btn></div>
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
          <div key={photo.id} style={{background:"var(--bg2)",borderRadius:"var(--radius)",border:"1px solid var(--border)",overflow:"hidden",cursor:"pointer",transition:"transform .2s"}} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-3px)"} onMouseLeave={e=>e.currentTarget.style.transform=""} onClick={()=>setLightbox(photo)}>
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
  return(
    <div style={{display:"grid",gap:"1.8rem"}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>🏆 Awards & Winners</H>
          {isAdmin&&<Btn onClick={()=>setAddingW(true)} size="sm">+ Add Award</Btn>}
        </div>
        {winners.length===0&&<Card style={{textAlign:"center",padding:"2.5rem",color:"var(--muted)"}}><div style={{fontSize:"2.5rem",marginBottom:".8rem"}}>🏆</div><div style={{fontFamily:"var(--font-h)",marginBottom:".4rem"}}>No awards yet</div></Card>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:"1rem"}}>
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

      {isAdmin&&unanswered.length>0&&(
        <div>
          <div style={{fontSize:".72rem",color:"var(--amber)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".6rem",fontWeight:600}}>Needs answer ({unanswered.length})</div>
          <div style={{display:"grid",gap:".8rem"}}>
            {unanswered.map(f=>(
              <Card key={f.id} style={{borderColor:"rgba(232,148,58,.25)",background:"rgba(232,148,58,.04)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"1rem"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:".92rem",color:"var(--cream)",marginBottom:4}}>{f.question}</div>
                    <div style={{fontSize:".72rem",color:"var(--muted)"}}>Asked by <strong style={{color:"var(--cream)"}}>{f.askedBy}</strong> · {new Date(f.askedAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}</div>
                  </div>
                  <Btn onClick={()=>deleteQuestion(f.id)} variant="danger" size="sm" style={{flexShrink:0}}>✕</Btn>
                </div>
                {answeringId===f.id?(
                  <div style={{marginTop:"1rem",display:"grid",gap:".6rem"}}>
                    <Inp value={answerText} onChange={e=>setAnswerText(e.target.value)} placeholder="Type your answer…" multiline rows={3} autoFocus/>
                    <div style={{display:"flex",gap:6}}>
                      <Btn onClick={()=>submitAnswer(f.id)} disabled={!answerText.trim()} size="sm">Post Answer</Btn>
                      <Btn onClick={()=>{setAnsweringId(null);setAnswerText("")}} variant="ghost" size="sm">Cancel</Btn>
                    </div>
                  </div>
                ):(
                  <Btn onClick={()=>{setAnsweringId(f.id);setAnswerText("")}} variant="subtle" size="sm" style={{marginTop:"1rem"}}>Answer</Btn>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {answered.length>0&&(
        <div>
          {isAdmin&&unanswered.length>0&&<Divider label="answered"/>}
          <div style={{display:"grid",gap:".8rem"}}>
            {answered.map(f=>(
              <Card key={f.id}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"1rem"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:".92rem",color:"var(--amber2)",marginBottom:".7rem"}}>{f.question}</div>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{width:3,borderRadius:2,background:"var(--amber)",flexShrink:0,alignSelf:"stretch",minHeight:20}}/>
                      <div>
                        <div style={{fontSize:".88rem",color:"var(--cream)",lineHeight:1.65}}>{f.answer}</div>
                        <div style={{fontSize:".71rem",color:"var(--muted)",marginTop:5}}>
                          Answered by <strong style={{color:"var(--amber)"}}>{f.answeredBy}</strong>
                          {" · "}{new Date(f.answeredAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}
                          {"  ·  Asked by "}{f.askedBy}
                        </div>
                      </div>
                    </div>
                  </div>
                  {isAdmin&&<Btn onClick={()=>deleteQuestion(f.id)} variant="danger" size="sm" style={{flexShrink:0}}>✕</Btn>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!isAdmin&&unanswered.filter(f=>f.askedBy===currentUser.username).length>0&&(
        <div>
          <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".6rem"}}>Your pending questions</div>
          <div style={{display:"grid",gap:".7rem"}}>
            {unanswered.filter(f=>f.askedBy===currentUser.username).map(f=>(
              <Card key={f.id} style={{borderColor:"rgba(90,155,213,.2)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".9rem",color:"var(--cream)"}}>{f.question}</div>
                    <div style={{fontSize:".71rem",color:"var(--muted)",marginTop:4}}>Waiting for an answer…</div>
                  </div>
                  <Tag color="var(--blue)">Pending</Tag>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

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
// EDIT MODALS
// ─────────────────────────────────────────────────────────────────────────────
const blankStop={time:"",activity:"",location:"",locationUrl:"",icon:"📍",note:""};
const EditScheduleModal=({evt,onSave,onClose})=>{
  const [sched,setSched]=useState(evt.schedule.map(s=>({...blankStop,...s})));
  const [iconPicker,setIconPicker]=useState(null);
  const upd=(i,f,v)=>setSched(s=>s.map((r,j)=>j===i?{...r,[f]:v}:r));
  const move=(i,d)=>{const s=[...sched];const j=i+d;if(j<0||j>=s.length)return;[s[i],s[j]]=[s[j],s[i]];setSched(s);};
  return(<Modal onClose={onClose} maxWidth={640}><H>Edit Schedule</H><div style={{display:"grid",gap:".9rem"}}>{sched.map((s,i)=>(
    <div key={i} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:"1rem",border:"1px solid var(--border)"}}>
      <div style={{display:"flex",gap:7,marginBottom:".7rem",alignItems:"center"}}>
        <div style={{position:"relative"}}><button onClick={()=>setIconPicker(iconPicker===i?null:i)} style={{width:38,height:38,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:"17px"}}>{s.icon||"📍"}</button>{iconPicker===i&&<div style={{position:"absolute",top:42,left:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:8,display:"flex",flexWrap:"wrap",gap:4,width:214,zIndex:10}}>{ICONS.map(ic=><button key={ic} onClick={()=>{upd(i,"icon",ic);setIconPicker(null)}} style={{background:s.icon===ic?"rgba(232,148,58,.2)":"transparent",border:"none",borderRadius:6,cursor:"pointer",fontSize:"17px",width:30,height:30}}>{ic}</button>)}</div>}</div>
        <Inp value={s.time} onChange={e=>upd(i,"time",e.target.value)} placeholder="12:00" style={{width:70,flexShrink:0}}/>
        <Inp value={s.activity} onChange={e=>upd(i,"activity",e.target.value)} placeholder="Activity"/>
        <div style={{display:"flex",gap:4,flexShrink:0}}><Btn onClick={()=>move(i,-1)} variant="ghost" size="sm" disabled={i===0} style={{padding:"6px 9px"}}>↑</Btn><Btn onClick={()=>move(i,1)} variant="ghost" size="sm" disabled={i===sched.length-1} style={{padding:"6px 9px"}}>↓</Btn><Btn onClick={()=>setSched(s=>s.filter((_,j)=>j!==i))} variant="danger" size="sm" style={{padding:"6px 9px"}}>✕</Btn></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}><div><Lbl>Location</Lbl><Inp value={s.location} onChange={e=>upd(i,"location",e.target.value)} placeholder="Café de Kroeg"/></div><div><Lbl>Maps URL</Lbl><Inp value={s.locationUrl} onChange={e=>upd(i,"locationUrl",e.target.value)} placeholder="https://maps.google.com/…"/></div></div>
      <Lbl>Note</Lbl><Inp value={s.note} onChange={e=>upd(i,"note",e.target.value)} placeholder="e.g. reservation under Joris"/>
    </div>
  ))}<Btn onClick={()=>setSched(s=>[...s,{...blankStop}])} variant="subtle" size="sm">+ Add Stop</Btn><div style={{display:"flex",gap:8}}><Btn onClick={()=>onSave(sched)}>Save</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div></div></Modal>);
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

const EditEventModal=({evt,onSave,onClose,users=[]})=>{
  const [d,setD]=useState({...evt});
  return(
    <Modal onClose={onClose} maxWidth={500}><H>Edit Event</H>
    <div style={{display:"grid",gap:".9rem"}}>
      {[["name","Event Name"],["date","Datum (JJJJ-MM-DD)"],["location","Locatie"],["theme","Thema"]].map(([k,l])=><div key={k}><Lbl>{l}</Lbl><Inp value={d[k]||""} onChange={e=>setD({...d,[k]:e.target.value})} placeholder={l}/></div>)}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Starttijd (HH:MM)</Lbl><Inp value={d.start_time||""} onChange={e=>setD({...d,start_time:e.target.value})} placeholder="12:00"/></div>
        <div><Lbl>Eindtijd (HH:MM)</Lbl><Inp value={d.end_time||""} onChange={e=>setD({...d,end_time:e.target.value})} placeholder="23:00"/></div>
      </div>
      <div><Lbl>Type</Lbl><select value={d.type} onChange={e=>setD({...d,type:e.target.value})} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%"}}><option value="day">Day Event</option><option value="weekend">Weekend</option></select></div>
      <div><Lbl>Description</Lbl><Inp value={d.description||""} onChange={e=>setD({...d,description:e.target.value})} placeholder="Short description…" multiline/></div>
      <div><Lbl>Attendees</Lbl><AttendeeInput attendees={d.attendees} setAttendees={v=>setD({...d,attendees:v})} users={users}/></div>
      <div style={{display:"flex",gap:8,marginTop:4}}><Btn onClick={()=>onSave(d)}>Save</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div>
    </div></Modal>
  );
};

const NewEventModal=({onSave,onClose,users=[]})=>{
  const yr=new Date().getFullYear();
  const [d,setD]=useState({name:`Mensday ${yr}`,type:"day",date:`${yr}-09-13`,start_time:"12:00",end_time:"",location:"TBD",description:"",theme:"",attendees:[],schedule:[],polls:[],photos:[],quizzes:[],winners:[],highlights:[],faqs:[],archived:false});
  return(
    <Modal onClose={onClose} maxWidth={500}><H>New Event</H>
    <div style={{display:"grid",gap:".85rem"}}>
      {[["name","Event Name"],["date","Datum (JJJJ-MM-DD)"],["location","Locatie"],["theme","Thema"]].map(([k,l])=><div key={k}><Lbl>{l}</Lbl><Inp value={d[k]||""} onChange={e=>setD({...d,[k]:e.target.value})} placeholder={l}/></div>)}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Starttijd (HH:MM)</Lbl><Inp value={d.start_time||""} onChange={e=>setD({...d,start_time:e.target.value})} placeholder="12:00"/></div>
        <div><Lbl>Eindtijd (HH:MM)</Lbl><Inp value={d.end_time||""} onChange={e=>setD({...d,end_time:e.target.value})} placeholder="23:00"/></div>
      </div>
      <div><Lbl>Type</Lbl><select value={d.type} onChange={e=>setD({...d,type:e.target.value})} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%"}}><option value="day">Day Event</option><option value="weekend">Weekend</option></select></div>
      <div><Lbl>Description</Lbl><Inp value={d.description||""} onChange={e=>setD({...d,description:e.target.value})} placeholder="Short description…" multiline/></div>
      <div><Lbl>Attendees</Lbl><AttendeeInput attendees={d.attendees} setAttendees={v=>setD({...d,attendees:v})} users={users}/></div>
      <div style={{display:"flex",gap:8,marginTop:4}}><Btn onClick={()=>onSave({...d,id:`evt-${Date.now()}`})}>Create</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div>
    </div></Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY DIFF
// ─────────────────────────────────────────────────────────────────────────────
const diffEvents=(prev,next)=>{
  const acts=[];
  next.forEach(evt=>{
    const old=prev.find(e=>e.id===evt.id);
    if(!old)return;
    (evt.faqs||[]).forEach(faq=>{
      if(!(old.faqs||[]).find(f=>f.id===faq.id))
        acts.push({id:faq.id,type:"faq",message:`${faq.askedBy} stelde een vraag`,event:evt.name,timestamp:faq.askedAt});
    });
    (evt.faqs||[]).forEach(faq=>{
      const oldFaq=(old.faqs||[]).find(f=>f.id===faq.id);
      if(oldFaq&&!oldFaq.answer&&faq.answer)
        acts.push({id:`ans-${faq.id}`,type:"answer",message:`${faq.answeredBy} beantwoordde een vraag`,event:evt.name,timestamp:faq.answeredAt});
    });
    (evt.attendees||[]).forEach(att=>{
      const oldAtt=(old.attendees||[]).find(a=>a.name===att.name);
      if(oldAtt&&oldAtt.status!==att.status)
        acts.push({id:`rsvp-${att.name}-${evt.id}-${att.status}`,type:"rsvp",message:`${att.name}: ${statusMap[att.status]?.label||att.status}`,event:evt.name,timestamp:new Date().toISOString()});
    });
    const oldPhotoIds=new Set((old.photos||[]).map(p=>p.id));
    (evt.photos||[]).forEach(photo=>{
      if(!oldPhotoIds.has(photo.id))
        acts.push({id:photo.id,type:"photo",message:`${photo.uploader} uploadde een foto`,event:evt.name,timestamp:photo.uploadedAt});
    });
  });
  return acts;
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
  const [pageView,setPageView]=useState("home"); // home | event | hof
  const [showAdmin,setShowAdmin]=useState(false);
  const [newEvent,setNewEvent]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [activeMemberId,setActiveMemberId]=useState(null);
  const [editingProfile,setEditingProfile]=useState(false);
  const [notifications,setNotifications]=useState([]);
  const [notifLastRead,setNotifLastRead]=useState(()=>localStorage.getItem("notif-read")||"");
  const eventsRef=useRef([]);
  useEffect(()=>{eventsRef.current=events;},[events]);

  useEffect(()=>{
    Promise.all([
      supabase.from("events").select("*").order("date"),
      supabase.from("users").select("*"),
    ]).then(async([{data:evts},{data:usrs}])=>{
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
      setEvents(allEvents);
      setUsers(allUsers);
      const sessId=localStorage.getItem("md-session");
      if(sessId){const u=allUsers.find(u=>u.id===sessId);if(u)setCurrentUser(u);}
      setLoaded(true);
    });

    const poll=setInterval(()=>{
      supabase.from("users").select("*").then(({data})=>{if(data)setUsers(data);});
      supabase.from("events").select("*").order("date").then(({data})=>{
        if(data){
          const newActs=diffEvents(eventsRef.current,data);
          if(newActs.length)setNotifications(prev=>[...newActs,...prev].slice(0,50));
          setEvents(data);
        }
      });
    },30000);
    return()=>clearInterval(poll);
  },[]);

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
        supabase.from("events").upsert(next);
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
  const openEvent=id=>{setActiveId(id);setPageView("event");};
  const goHome=()=>{setPageView("home");setActiveId(null);setActiveMemberId(null);};
  const goBack=()=>{
    if(pageView==="member")setPageView("members");
    else goHome();
  };
  const openMember=id=>{setActiveMemberId(id);setPageView("member");};
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
      <Nav view={pageView} eventName={pageView==="member"?(activeMember?.display_name||activeMember?.username||"Lid"):activeEvent?.name} onBack={goBack} currentUser={currentUser} onLogout={logout} onAdmin={()=>setShowAdmin(true)} onHof={()=>setPageView("hof")} onHome={goHome} onMembers={()=>setPageView("members")} pendingCount={users.filter(u=>u.role==="pending").length} notifications={notifications} notifLastRead={notifLastRead} onMarkNotifRead={()=>{const t=new Date().toISOString();setNotifLastRead(t);localStorage.setItem("notif-read",t);}}/>
      <main style={{maxWidth:880,margin:"0 auto",padding:"78px 1.2rem 4rem"}}>
        {pageView==="home"&&<Home events={events} onOpen={openEvent} onNew={()=>setNewEvent(true)} currentUser={currentUser} users={users}/>}
        {pageView==="hof"&&<HallOfFame events={events} users={users}/>}
        {pageView==="members"&&<MembersPage users={users} events={events} onOpenMember={openMember} currentUser={currentUser}/>}
        {pageView==="member"&&activeMember&&<MemberProfile user={activeMember} events={events} currentUser={currentUser} onEdit={()=>setEditingProfile(true)}/>}
        {pageView==="event"&&activeEvent&&<EventPage evt={activeEvent} onUpdate={updateEvent} onDelete={()=>deleteEvent(activeId)} currentUser={currentUser} users={users}/>}
      </main>
      <div style={{textAlign:"center",padding:"1.5rem",color:"var(--muted2)",fontSize:".72rem",borderTop:"1px solid var(--border)",letterSpacing:".1em"}}>🍺 MensApp · Built for the lads</div>
      {showAdmin&&<AdminPanel users={users} onUpdateUsers={updateUsers} onDeleteUser={deleteUser} onClose={()=>setShowAdmin(false)}/>}
      {newEvent&&can.editEvent(currentUser)&&<NewEventModal users={users} onSave={async evt=>{await saveEvents([...events,evt]);setNewEvent(false);openEvent(evt.id)}} onClose={()=>setNewEvent(false)}/>}
      {editingProfile&&<EditProfileModal user={currentUser} onSave={async u=>{await saveProfile(u);setEditingProfile(false);}} onClose={()=>setEditingProfile(false)}/>}
    </div>
  );
}
