// Full-screen, second-screen-style quiz presenter (docs/
// quiz-unification-spec.md §4, §8.1 -- WP-Q4). Rewired off publishing
// `evt.quizzes[]._liveState` (a 39 kB event upsert broadcast to every
// connected phone, §2) onto the narrow `quiz_live` row (§3.2, ≈0.5-1 kB)
// and per-team/per-player rows in `quiz_answers` (§3.3) -- the other half
// of the production bug fix in §2. `onUpdate`/`evt`-mutation are gone: this
// component no longer writes to `events` at all.
//
// `answers`/`teams` are deliberately absent from every `quiz_live` payload
// below (unlike the old `_liveState`) -- teams come from the quiz
// *definition* (`quiz.teams`, a library snapshot per §5.3, essentially
// static for the night) and answers come from `quiz_answers`
// (`fetchAnswersForSlide`/`subscribeAnswers`), never broadcast pre-reveal
// (§4.2's closed leak). Some call sites below still pass `answers:{}` in
// their `publishLive(...)` overrides from the pre-Q4 code -- harmless,
// `publishLive` only reads the fields it knows about; left as-is rather
// than touched at every one of those ~10 call sites for a no-op field.
import { useState, useEffect, useRef, useCallback } from 'react';
import { ALPHA, normalizeQuiz, fmtTime, clampAnswerValue } from './model.js';
import { getYouTubeId, getSpotifyTrackId } from './urls.js';
import { Avatar } from './ui/Kit.jsx';
import { getDisplayName } from './users.js';
import { MusicPlayer } from './MusicPlayer.jsx';
import { patchQuiz } from './api.js';
import { upsertQuizLive, deleteQuizLive, subscribeQuizLive } from './live.js';
import { fetchAnswersForSlide, subscribeAnswers, deleteAnswersForQuiz } from './answers.js';

export const QuizPresenter=({quiz:rawQuiz,evt,onClose,onFinish,users=[]})=>{
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
  const [answers,setAnswers]=useState({}); // answer_key→value, fetched/subscribed from quiz_answers for the current slide
  const [timer,setTimer]=useState(0);
  const [fading,setFading]=useState(false);
  const timerRef=useRef(null);
  const timerStartedAtRef=useRef(null);

  // Presenter claim (§4.4): a random per-mount session id, upserted into
  // `quiz_live.presenter_id` on every publish. No locking, no takeover --
  // if a *different* id shows up on the row (another tab/device presenting
  // the same quiz), we just show a non-blocking amber notice.
  const presenterIdRef=useRef(null);
  if(!presenterIdRef.current){
    presenterIdRef.current=(typeof crypto!=="undefined"&&crypto.randomUUID)?crypto.randomUUID():`p${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  const [presenterConflict,setPresenterConflict]=useState(false);

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
  // Publish current presenter state into the narrow `quiz_live` row (§3.2,
  // §4.1: ~120x/night, ≈1 kB) -- one upsert, no `events` involved, and no
  // `answers`/`teams` riding along (see the file-header comment for why).
  const publishLive=(overrides={})=>{
    const newQIdx=overrides.qIdx!==undefined?overrides.qIdx:qIdx;
    const newRoundIdx=overrides.roundIdx!==undefined?overrides.roundIdx:roundIdx;
    const newPhase=overrides.phase!==undefined?overrides.phase:phase;
    // Clear timer whenever we navigate to a different question or phase so
    // participants never inherit a stale timerStartedAt from the previous question.
    const navigating=newQIdx!==qIdx||newRoundIdx!==roundIdx||newPhase!==phase;
    upsertQuizLive({
      quizId:quiz.id,
      quizRev:quiz.rev,
      eventId:evtRef.current?.id??null,
      phase:newPhase,
      roundIdx:newRoundIdx,
      qIdx:newQIdx,
      slidePhase:overrides.slidePhase??slidePhase,
      scores:overrides.scores??scores,
      summaryRevealed:overrides.summaryRevealed??summaryRevealed,
      pauseConfig,
      timerStartedAt:overrides.timerStartedAt!==undefined?overrides.timerStartedAt:(navigating?null:timerStartedAtRef.current),
      timerLimit:overrides.timerLimit!==undefined?overrides.timerLimit:timeLimit,
      isTeamQuiz,
      presenterId:presenterIdRef.current,
    });
  };

  // Ephemeral live-play state must not survive Exit or Finish (§3.2 "exists
  // only while a quiz is live" / §4.1 "End Session / reset"). Deliberately
  // does *not* touch `quizzes.status` -- that's the exit path's job below
  // (revert to `ready`) or the eventual `finishQuiz` adapter's job (WP-Q6,
  // not built yet: set `finished` alongside the archived scores). Setting
  // `finished` from here with no scores persisted would corrupt
  // `fetchQuizResults()`'s `status='finished'` filter.
  const clearLive=()=>{
    deleteQuizLive(quiz.id);
    deleteAnswersForQuiz(quiz.id);
  };

  const handleClose=()=>{clearLive();patchQuiz(quiz.id,{status:"ready"});onClose();};
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
    // currentQ/timeLimit intentionally excluded: `quiz` comes from normalizeQuiz(rawQuiz),
    // which returns a fresh object graph on every render, so currentQ/timeLimit change
    // identity on renders unrelated to navigation (e.g. scores/pauseConfig updates).
    // Keying off phase/slidePhase/roundIdx/qIdx is what makes the timer restart only
    // when we actually move to a different question/phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // currentQ intentionally excluded: same non-memoized `quiz` identity issue as the
    // timer effect above -- only musicPhase transitions should (re)start the music timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Going live (§4.1/§4.5): flip `quizzes.status` so `fetchLiveQuizzes()`/
  // `liveWatch.js` (already built, Q2) can find this quiz, and flip it back
  // on an unfinished exit (`handleClose`, above). A narrow `.update()`
  // (`patchQuiz`), never the full-row `saveQuiz` -- this must never re-send
  // the 33 kB `rounds` blob. A quiz that only exists in the legacy
  // `events.quizzes[]` column (every quiz today, until QuizBuilder/
  // QuizDashboard are rewired -- see this work package's report) has no
  // matching row yet; `.update()` on zero rows is a silent no-op, not a
  // failure.
  useEffect(()=>{
    patchQuiz(quiz.id,{status:"live"});
  },[quiz.id]);

  // Presenter claim (§4.4): realtime-only (best-effort, no safety poll --
  // this is a social nicety, not a correctness boundary; §16 "no locking,
  // no takeover"). A different `presenter_id` arriving means someone else
  // is presenting the same quiz; show a non-blocking amber notice.
  useEffect(()=>{
    const unsubscribe=subscribeQuizLive(quiz.id,live=>{
      if(live&&live.presenterId&&live.presenterId!==presenterIdRef.current)setPresenterConflict(true);
    });
    return unsubscribe;
  },[quiz.id]);

  // Current slide's answers from `quiz_answers` (§4.1/§4.2): reset on
  // navigation, one fetch, then a 3s safety poll while this slide is shown.
  // `currentQ`/`timeLimit` intentionally excluded from deps for the same
  // non-memoized-`quiz`-identity reason as the timer effect above --
  // `currentQ` is read fresh from the closure each time this effect
  // actually (re)runs, which is only on a real navigation.
  useEffect(()=>{
    let cancelled=false;
    const qid=quiz.id,ri=roundIdx,qi=qIdx;
    const optionCount=currentQ?.type==="multiple"?(currentQ.options?.length||0):Infinity;
    const load=()=>{
      fetchAnswersForSlide(qid,ri,qi).then(res=>{
        if(cancelled||!res.ok)return;
        const next={};
        res.answers.forEach(a=>{next[a.answerKey]=clampAnswerValue(a.value,optionCount);});
        setAnswers(next);
      });
    };
    setAnswers({});
    load();
    const poll=setInterval(load,3000);
    return()=>{cancelled=true;clearInterval(poll);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[quiz.id,roundIdx,qIdx]);

  // Realtime top-up for the same slide (§4.2) -- ignores rows for any other
  // (round_idx,q_idx): a participant answering a question that isn't the
  // one currently on screen must never appear here (§12: "answers for a
  // slide that isn't the presenter's current one are ignored, so a client
  // cannot pre-answer"). Kept in a ref (not effect deps) so the
  // subscription itself doesn't tear down/reconnect on every navigation.
  const slideRef=useRef({roundIdx,qIdx,optionCount:0});
  slideRef.current={roundIdx,qIdx,optionCount:currentQ?.type==="multiple"?(currentQ.options?.length||0):Infinity};
  useEffect(()=>{
    const unsubscribe=subscribeAnswers(quiz.id,a=>{
      const s=slideRef.current;
      if(a.roundIdx!==s.roundIdx||a.qIdx!==s.qIdx)return;
      setAnswers(prev=>({...prev,[a.answerKey]:clampAnswerValue(a.value,s.optionCount)}));
    });
    return unsubscribe;
  },[quiz.id]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const fade=cb=>{setFading(true);setTimeout(()=>{cb();setFading(false);},220);};

  // Maps a `quiz_answers.answer_key` (§3.3: `t:<sourceTeamId>` or
  // `p:<username lowercased>`, stable) back to the `scores` object's key
  // (a team *name* or attendee name -- unchanged, mutable, archive format,
  // §3.3 "stable ids live, names archived"). Returns null for an
  // unresolvable key (team since renamed away from its snapshot / removed,
  // attendee no longer listed) so that answer is simply not scored, rather
  // than silently scoring under a synthetic key.
  const resolveScoreKey=useCallback(answerKey=>{
    if(answerKey.startsWith("t:")){
      const sourceId=answerKey.slice(2);
      const team=(quiz.teams||[]).find(t=>t.sourceTeamId===sourceId||t.id===sourceId);
      return team?team.name:null;
    }
    if(answerKey.startsWith("p:")){
      const uname=answerKey.slice(2);
      const attendee=(evt.attendees||[]).find(a=>(a.name||"").toLowerCase()===uname);
      return attendee?attendee.name:uname;
    }
    return null;
  },[quiz.teams,evt.attendees]);

  const doRevealAnswer=useCallback(()=>{
    clearInterval(timerRef.current);
    const correctSet=Array.isArray(currentQ?.answer)?currentQ.answer:[currentQ?.answer??0];
    let newScores={...scores};
    if(currentQ?.type==="multiple"){
      Object.entries(answers).forEach(([answerKey,picked])=>{
        const key=resolveScoreKey(answerKey);
        if(!key)return;
        const pickedArr=Array.isArray(picked)?picked:[picked];
        const isCorrect=correctSet.length===pickedArr.length&&correctSet.every(c=>pickedArr.includes(c));
        if(isCorrect)newScores[key]=(newScores[key]||0)+(currentQ.points||10);
      });
    }
    setScores(newScores);
    setSlidePhase("answer");
    publishLive({slidePhase:"answer",scores:newScores});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currentQ,answers,scores,resolveScoreKey]);

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
          {/* Presenter claim (§4.4): non-blocking, no takeover -- just a heads-up. */}
          {presenterConflict&&<span style={{background:"rgba(232,148,58,.18)",border:"1px solid rgba(232,148,58,.4)",borderRadius:20,padding:"2px 10px",fontSize:".7rem",color:"var(--amber2)",fontWeight:700}}>⚠️ Iemand anders presenteert deze quiz nu.</span>}
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
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(2rem,6vw,3.5rem)",color:"var(--red)",fontWeight:900,marginBottom:".5rem"}}>Time&apos;s up!</div>
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
                    <div style={{fontSize:".68rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Image / GIF URL <span style={{textTransform:"none",fontStyle:"italic",opacity:.6}}>(shown on participants&apos; screens)</span></div>
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
