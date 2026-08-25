// Quiz tab entry point -- opens QuizDashboard for admins, read-only
// overview for everyone else (docs/quiz-unification-spec.md §8.1, App.jsx
// 2652-2721). Pure move (§8.3, Q3) -- body is byte-identical to the App.jsx
// original; only the imports below are new. `can` (App.jsx's un-exported
// permissions helper, docs/mensgames-spec.md §5.4) can't be imported, so
// it's threaded in as a prop from `EventPage` instead -- the one
// signature-line change this move requires; the `can.hostQuiz(currentUser)`
// call site inside stays untouched. Lazy-mounted by App.jsx (`lazy(() =>
// import("./features/quiz/QuizTab.jsx"))`), same pattern as
// `MensGamesTab` -- hence the default export.
import { normalizeQuiz } from './model.js';
import { getDisplayName } from './users.js';
import { Avatar, Card, Tag } from './ui/Kit.jsx';

const QuizTab=({evt,currentUser,users=[],onOpenQuizDash,can})=>{
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

export default QuizTab;
