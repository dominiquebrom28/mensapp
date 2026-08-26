// Team picker for the quiz builder (docs/quiz-unification-spec.md §5.2, WP-Q5).
// Replaces the inline team builder that used to live in `QuizBuilder.jsx`'s
// Teams tab (§5.1: hand-typed team names, a second captain-toggle write site,
// its own avatar picker) -- teams are now a library concept, same as
// `mensgames/EntrantPicker.jsx`'s `mode="tournament"` team-set list, which
// this is modelled on.
//
// Snapshot, not live reference (§5.3): picking a set copies it into
// `quiz.teams` via `teamsFromTeamSet` (model.js) -- it does NOT keep pointing
// at the library row. `quizzes.scores` is name-keyed (`HallOfFame`/
// `WinnersTab`/`quizRound.js` all match on it), so a rename in the library
// after the snapshot must never orphan a finished quiz's results. The
// tradeoff is a stale name showing on the night if a team gets renamed after
// the quiz was built -- "↻ Ververs uit bibliotheek" re-copies the current
// library state to fix that, but ONLY while `status==='ready'`: once a quiz
// has gone live (or finished), its `scores` keys are the archive and must
// never move. That restriction is what lets `finishQuiz.js` skip
// score-remapping entirely.
//
// Duplicate team names are rejected inline rather than silently snapshotted
// (§3.3): the live answer hot path uses a stable `sourceTeamId`, but the
// ARCHIVE (`quizzes.scores`) is still name-keyed, so two teams named the same
// in one set would collide the instant the quiz finishes.
import { useState } from 'react';
import { teamsFromTeamSet } from './model.js';
import { Btn, Lbl, EmptyState, TeamSetsErrorNotice } from './ui/Kit.jsx';

function duplicateNameIn(set) {
  const names = (Array.isArray(set?.teams) ? set.teams : [])
    .map(t => (t && typeof t.name === 'string' ? t.name.trim().toLowerCase() : ''))
    .filter(Boolean);
  return new Set(names).size !== names.length;
}

export const TeamSetPicker=({teams=[],teamSetId=null,onChange,teamSets=[],teamSetsError=null,onRetryTeamSets,attendees=[],status="ready"})=>{
  const [dupSetName,setDupSetName]=useState(null);
  const activeSets=(Array.isArray(teamSets)?teamSets:[]).filter(s=>s&&s.status==="active");
  const canRefresh=status==="ready";

  const applySet=setId=>{
    const set=activeSets.find(s=>s.id===setId);
    if(!set)return;
    if(duplicateNameIn(set)){setDupSetName(set.name||"Deze teamset");return;}
    setDupSetName(null);
    onChange({teams:teamsFromTeamSet(set),teamSetId:set.id});
  };

  const assignedNames=new Set(teams.flatMap(t=>(t.members||[]).map(m=>String(m).toLowerCase())));
  const unassigned=(attendees||[]).filter(a=>a&&a.name&&!assignedNames.has(a.name.toLowerCase()));

  return(
    <div style={{display:"grid",gap:".9rem"}}>
      <div>
        <Lbl>Teamset uit de bibliotheek</Lbl>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <select aria-label="Teamset uit de bibliotheek" value={teamSetId||""} onChange={e=>{if(e.target.value)applySet(e.target.value);}}
            style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",minHeight:44,flex:"1 1 200px"}}>
            <option value="">Kies een teamset…</option>
            {activeSets.map(s=><option key={s.id} value={s.id}>{s.category?`[${s.category}] `:""}{s.name} ({(s.teams||[]).length} teams)</option>)}
          </select>
          {teamSetId&&(
            <Btn variant="ghost" size="sm" disabled={!canRefresh} onClick={()=>applySet(teamSetId)}
              title={canRefresh?"Haal de actuele namen en leden opnieuw op uit de bibliotheek":"Kan niet meer ververst worden -- deze quiz is al live geweest of afgerond"}>
              ↻ Ververs uit bibliotheek
            </Btn>
          )}
        </div>
        {activeSets.length===0&&(
          teamSetsError
            ? <TeamSetsErrorNotice onRetry={onRetryTeamSets}/>
            : <div style={{fontSize:".78rem",color:"var(--muted)",marginTop:4}}>Nog geen teamsets in de bibliotheek — maak er een via Team Creator.</div>
        )}
        {dupSetName&&(
          <div role="alert" style={{fontSize:".78rem",color:"var(--red)",marginTop:6}}>
            ⚠ &ldquo;{dupSetName}&rdquo; heeft twee teams met dezelfde naam en kan niet gebruikt worden -- scores worden op naam bijgehouden. Hernoem de teams eerst in de Team Creator.
          </div>
        )}
      </div>

      {teams.length===0
        ? <EmptyState icon="👥" title="Nog geen teams gekozen" hint="Kies hierboven een teamset, of laat dit leeg voor een individuele quiz."/>
        : (
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {teams.map(t=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"7px 10px"}}>
                <span aria-hidden="true">{t.avatar||"🎯"}</span>
                <span style={{fontSize:".85rem",color:"var(--cream)",fontWeight:600}}>{t.name}</span>
                {t.captain&&<span title={`Kapitein: ${t.captain}`} style={{fontSize:".72rem",color:"var(--gold)"}}>👑 {t.captain}</span>}
                <span style={{fontSize:".72rem",color:"var(--muted)"}}>{(t.members||[]).length===1?"1 lid":`${(t.members||[]).length} leden`}</span>
              </div>
            ))}
          </div>
        )}

      {teams.length>0&&unassigned.length>0&&(
        <div>
          <Lbl>Niet ingedeeld</Lbl>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {unassigned.map(a=><span key={a.name} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:20,padding:"3px 10px",fontSize:".8rem",color:"var(--muted)"}}>{a.name}</span>)}
          </div>
        </div>
      )}

      {teamSetId&&<div style={{fontSize:".72rem",color:"var(--muted2)"}}>Teams komen uit de bibliotheek — namen en leden beheer je via Team Creator.</div>}
    </div>
  );
};

export default TeamSetPicker;
