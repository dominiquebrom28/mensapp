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
//
// ── Legacy import (owner brief, 2026-08-26) ─────────────────────────────
// Every quiz built before this file existed has `teams` with no
// `teamSetId`/`sourceTeamId` at all -- the deleted inline builder (§5.1)
// never wrote either. Those teams are real, but they don't exist in the
// library: `finishQuiz.js` can't award a `TeamAward` without a
// `sourceTeamId` (silently skipped, `awards/publishResults.js`'s own
// `buildTeamAwards`), and they can't be reused for a Mens-Games tournament.
//
// **Explicit, not automatic.** Simply opening a quiz never writes anything --
// a background write triggered by opening a record is the "fails without
// erroring" shape this whole project just got burned by (39 kB event rows,
// zero-row updates that report success). The owner sees a callout ("Deze
// teams staan nog niet in de bibliotheek") and a button; nothing is written
// to `team_sets` until they click it, and nothing is written to *this* quiz
// until they separately click the builder's own Save.
//
// **One set per roster, not per quiz.** Before creating anything,
// `buildLegacyImportPlan` (model.js) fingerprints the (deduped) team roster
// and checks it against every ACTIVE library set already there. An identical
// roster -- same names, same members, order-independent -- gets a "link to
// this existing set instead" offer rather than a near-duplicate. Detection
// is roster-shape only (names + members), not history: two teams that
// happen to share exactly that roster by coincidence would also match. Rare
// enough, and reviewable -- the plan is always shown before anything is
// written, and "toch een nieuwe set maken" is one click away.
//
// **Duplicate names never block the import.** `duplicateNameIn` below still
// rejects picking an *existing* broken set from the dropdown, but a legacy
// quiz's own teams have no other editor left to fix a collision in (the only
// UI that ever wrote these names was deleted with the inline builder) -- so
// `dedupeTeamNames` (model.js) auto-renames every collision (" (2)", " (3)"
// ...) before the set is ever created, and the panel says exactly which
// names changed. The library set this produces can therefore never be one
// `duplicateNameIn` would go on to refuse.
//
// **Never silently rewrites a finished (or live) quiz.** `quizzes.scores`
// and a live `settings.winner.teamId` override both key off the team
// objects this quiz already has -- `scores` by `name` (§3.3), the override
// by `teamStableId(team)`, which falls back to `team.id` before ever
// touching `name`. Re-snapshotting `quiz.teams` from the new library set
// (fresh ids included, same as picking a set from the dropdown) is exactly
// what "↻ Ververs" already does, and is exactly as safe -- but ONLY while
// `status==='ready'`, for the identical reason `canRefresh` restricts that
// button. For `status!=='ready'` this import writes `teamSetId` alone
// (a pure provenance link, so the roster is reusable from Mens-Games from
// now on) and leaves `teams` -- ids, names, everything the archive and any
// override key on -- byte-for-byte as they were.
//
// **The second write can fail.** `saveTeamSet` is a real Supabase round
// trip; a failure surfaces as a visible retry, not a silent no-op -- see
// `runImport` below. The quiz object itself is never touched until this
// succeeds (or the owner links to a match, which needs no write at all).
import { useMemo, useState } from 'react';
import { buildLegacyImportPlan, buildLegacyTeamSetDraft, teamsFromTeamSet } from './model.js';
import { saveTeamSet } from '../teamlib/api.js';
import { Btn, Lbl, EmptyState, TeamSetsErrorNotice } from './ui/Kit.jsx';

function duplicateNameIn(set) {
  const names = (Array.isArray(set?.teams) ? set.teams : [])
    .map(t => (t && typeof t.name === 'string' ? t.name.trim().toLowerCase() : ''))
    .filter(Boolean);
  return new Set(names).size !== names.length;
}

export const TeamSetPicker=({teams=[],teamSetId=null,onChange,teamSets=[],teamSetsError=null,onRetryTeamSets,attendees=[],status="ready",title="",createdBy="",now}) =>{
  const [dupSetName,setDupSetName]=useState(null);
  // Any set created (or matched-and-reused) via the import flow below, kept
  // here so it's selectable/refreshable immediately -- the app-level
  // `teamSets` prop only catches up on its own next fetch, and this
  // component has no way to trigger that (App.jsx owns that state; see this
  // file's own header / the report on what App.jsx would need for it to be
  // instant everywhere rather than just in this open builder).
  const [extraSets,setExtraSets]=useState([]);
  const activeSets=useMemo(()=>{
    const base=(Array.isArray(teamSets)?teamSets:[]).filter(s=>s&&s.status==="active");
    const known=new Set(base.map(s=>s.id));
    return [...base,...extraSets.filter(s=>!known.has(s.id))];
  },[teamSets,extraSets]);
  const canRefresh=status==="ready";

  const applySet=setId=>{
    const set=activeSets.find(s=>s.id===setId);
    if(!set)return;
    if(duplicateNameIn(set)){setDupSetName(set.name||"Deze teamset");return;}
    setDupSetName(null);
    onChange({teams:teamsFromTeamSet(set),teamSetId:set.id});
  };

  // ── Legacy import (see this file's own header) ──────────────────────
  const [importNow]=useState(()=>Number.isFinite(now)?now:Date.now());
  const [reviewing,setReviewing]=useState(false);
  const [forceCreate,setForceCreate]=useState(false);
  const [saveState,setSaveState]=useState("idle"); // idle | saving | error
  const [saveErr,setSaveErr]=useState(null);
  const [draft,setDraft]=useState(null);

  const isLegacy=teams.length>0&&!teamSetId;
  const plan=useMemo(
    ()=>isLegacy?buildLegacyImportPlan({title,teams},activeSets,{now:importNow}):null,
    [isLegacy,teams,activeSets,title,importNow],
  );

  const closeImport=()=>{setReviewing(false);setForceCreate(false);setSaveState("idle");setSaveErr(null);setDraft(null);};

  const linkToMatch=set=>{
    onChange({teamSetId:set.id,teams:canRefresh?teamsFromTeamSet(set):teams});
    closeImport();
  };

  const runCreate=()=>{
    if(!plan)return;
    const toSave=draft||buildLegacyTeamSetDraft(plan,{now:importNow,createdBy});
    setDraft(toSave);
    setSaveState("saving");
    setSaveErr(null);
    saveTeamSet(toSave).then(res=>{
      if(!res.ok){setSaveState("error");setSaveErr(res.error);return;}
      setExtraSets(prev=>[...prev,res.teamSet]);
      onChange({teamSetId:res.teamSet.id,teams:canRefresh?teamsFromTeamSet(res.teamSet):teams});
      closeImport();
    });
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

      {isLegacy&&(
        <div role="region" aria-label="Teams toevoegen aan de bibliotheek" style={{background:"rgba(232,148,58,.06)",border:"1px solid rgba(232,148,58,.3)",borderRadius:10,padding:"1rem",display:"grid",gap:".7rem"}}>
          {!reviewing?(
            <>
              <div style={{fontSize:".82rem",color:"var(--cream)",lineHeight:1.5}}>
                <strong>Deze teams staan nog niet in de bibliotheek.</strong> Ze kunnen zo niet hergebruikt worden voor Mens-Games, en een winnend team krijgt geen prijs op de trofeeënkast.
              </div>
              <Btn size="md" variant="subtle" onClick={()=>setReviewing(true)}>Voeg toe aan de bibliotheek</Btn>
            </>
          ):(
            <>
              {teamSetsError&&(
                <div role="alert" style={{fontSize:".78rem",color:"var(--red)"}}>
                  ⚠ Kon de bibliotheek niet volledig laden — we konden niet controleren of deze teams daar al bestaan.
                </div>
              )}
              {plan?.renamed?.length>0&&(
                <div role="alert" style={{fontSize:".78rem",color:"var(--amber)"}}>
                  ⚠ Deze namen kwamen dubbel voor en zijn hernoemd in de bibliotheek — scores worden op naam bijgehouden, dus dubbele namen kunnen niet:{" "}
                  {plan.renamed.map((r,i)=>(
                    <span key={i}>{i>0?", ":""}&ldquo;{r.from||"(naamloos)"}&rdquo; → &ldquo;{r.to}&rdquo;</span>
                  ))}
                </div>
              )}

              {plan?.match&&!forceCreate?(
                <>
                  <div style={{fontSize:".82rem",color:"var(--cream)",lineHeight:1.5}}>
                    Er bestaat al een teamset met precies deze teams: <strong>{plan.match.name}</strong>. Deze quiz koppelen in plaats van een nieuwe set te maken?
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <Btn size="md" onClick={()=>linkToMatch(plan.match)}>Koppel aan &ldquo;{plan.match.name}&rdquo;</Btn>
                    <Btn size="md" variant="ghost" onClick={()=>setForceCreate(true)}>Toch een nieuwe set maken</Btn>
                    <Btn size="md" variant="ghost" onClick={closeImport}>Annuleren</Btn>
                  </div>
                </>
              ):(
                <>
                  <div style={{fontSize:".82rem",color:"var(--cream)",lineHeight:1.5}}>
                    Nieuwe teamset <strong>&ldquo;{plan?.setName}&rdquo;</strong> wordt aangemaakt met {plan?.candidateTeams?.length||0} team{plan?.candidateTeams?.length===1?"":"s"}:
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {plan?.candidateTeams?.map(t=>(
                      <span key={t.id} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"3px 9px",fontSize:".78rem",color:"var(--cream)"}}>{t.avatar} {t.name}</span>
                    ))}
                  </div>
                  {saveState==="error"&&(
                    <div role="alert" style={{fontSize:".78rem",color:"var(--red)"}}>
                      ⚠ Opslaan in de bibliotheek is mislukt{saveErr?.message?` (${saveErr.message})`:""}. Deze quiz is niet gewijzigd — probeer het opnieuw.
                    </div>
                  )}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <Btn size="md" variant="gold" disabled={saveState==="saving"} onClick={runCreate}>
                      {saveState==="saving"?"Bezig…":saveState==="error"?"Probeer opnieuw":"Aanmaken en koppelen"}
                    </Btn>
                    {plan?.match&&<Btn size="md" variant="ghost" disabled={saveState==="saving"} onClick={()=>setForceCreate(false)}>Toch koppelen aan &ldquo;{plan.match.name}&rdquo;</Btn>}
                    <Btn size="md" variant="ghost" disabled={saveState==="saving"} onClick={closeImport}>Annuleren</Btn>
                  </div>
                </>
              )}
            </>
          )}
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
