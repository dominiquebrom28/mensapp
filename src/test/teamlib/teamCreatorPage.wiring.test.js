// Source-level regression guards for the Team Creator upgrade (#6/#7/#8/#9/
// #10). TeamCreatorPage pulls in a large dependency graph (Card/Btn/Inp/
// Avatar/TEAM_AVATARS/TEAM_COLORS/can/formatEventDateRange + several
// teamlib/api.js calls that hit Supabase) -- extracting and mounting it in
// isolation (the extractComponentFromAppSource.js approach) would mean
// re-injecting most of that graph by hand for very little extra confidence,
// since the actual logic it delegates to (setCaptain/removeMember/
// generateTeams/namesFromUsers/mergeNames, and the teamlib/api.js CRUD) is
// already exercised directly and thoroughly in model.test.js / api.test.js.
// What those tests *can't* see is whether TeamCreatorPage's JSX is actually
// wired to the tested functions -- that's what this file checks, the same
// spirit as modalBackdrop.wiring.test.js.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

function componentBody(name) {
  const start = source.indexOf(`const ${name}=`)
  expect(start, `"${name}" declaration not found`).toBeGreaterThan(-1)
  const end = source.indexOf('\n};', start)
  expect(end, `closing "};" for ${name} not found`).toBeGreaterThan(start)
  return source.slice(start, end)
}

const teamCreator = componentBody('TeamCreatorPage')
// `TeamsTab` (and its own §5.2-row-1 "Loskoppelen" wiring, formerly checked
// here) was removed from App.jsx 2026-08-26 -- the owner dropped the event
// page's Teams tab entirely; Team Creator's library is the sole home for
// team sets now. See `libraryActions.writeFailure.test.js`'s header for the
// matching update on the write-failure side.

describe('TeamCreatorPage wiring (#6 select-all)', () => {
  it('the "Uit app" picker has both a select-all and a deselect-all action', () => {
    expect(teamCreator).toMatch(/onClick=\{selectAllAppUsers\}/)
    expect(teamCreator).toMatch(/onClick=\{deselectAllAppUsers\}/)
  })

  it('select-all is backed by namesFromUsers + mergeNames (the tested pure functions), not a re-implementation', () => {
    expect(teamCreator).toMatch(/const allAppNames=namesFromUsers\(appUsers\)/)
    expect(teamCreator).toMatch(/setParticipants\(p=>mergeNames\(p,allAppNames\)\)/)
  })

  it('offers "everyone attending event X" using the event\'s existing attendee list', () => {
    expect(teamCreator).toMatch(/attendeeNames=evt=>/)
    expect(teamCreator).toMatch(/onClick=\{addEventAttendees\}/)
  })
})

describe('TeamCreatorPage wiring (2026-08-25 rebuild — brackets first, then fill)', () => {
  it('the pin concept is gone: no pin state, no pin toggle, no cross-team "assign" dropdown', () => {
    expect(teamCreator).not.toMatch(/pins/i)
    expect(teamCreator).not.toMatch(/togglePin/)
    expect(teamCreator).not.toMatch(/assignMember/)
    expect(teamCreator).not.toMatch(/📌/)
  })

  it('brackets exist before Generate is ever pressed -- `teams` starts populated via resizeTeams, not null', () => {
    expect(teamCreator).toMatch(/const \[teams,setTeams\]=useState\(\(\)=>resizeTeams\(\[\],4,TEAM_AVATARS\)\)/)
  })

  it('the count/size stepper keeps the live bracket count in sync via resizeTeams, not just on Generate', () => {
    expect(teamCreator).toMatch(/setTeams\(prev=>resizeTeams\(prev,effectiveTeamCount,TEAM_AVATARS\)\)/)
    expect(teamCreator).toMatch(/},\[effectiveTeamCount\]\)/)
  })

  it('generate() seeds generateTeams with the current roster and existing team shells, from either a team count or a team size', () => {
    expect(teamCreator).toMatch(/\{participants,teamCount,existingTeams:prev\}/)
    expect(teamCreator).toMatch(/\{participants,teamSize,existingTeams:prev\}/)
  })

  it('generate() is a no-op while nobody is unassigned', () => {
    expect(teamCreator).toMatch(/if\(unassignedNames\.length===0\)return;/)
  })

  it('each bracket gets an explicit "add member" control fed from the unassigned pool -- the obvious way to place someone', () => {
    expect(teamCreator).toMatch(/onChange=\{e=>\{if\(!e\.target\.value\)return;addToTeam\(team\.id,e\.target\.value\);e\.target\.value="";\}\}/)
    expect(teamCreator).toMatch(/const addToTeam=\(teamId,name\)=>\{/)
  })

  it('removing someone from a bracket returns them to the pool via the shared removeMember, without dropping them from the roster', () => {
    expect(teamCreator).toMatch(/onClick=\{\(\)=>removeFromTeam\(team\.id,name\)\}/)
    expect(teamCreator).toMatch(/const removeFromTeam=\(teamId,name\)=>\{/)
    expect(teamCreator).toMatch(/setTeams\(prev=>prev\.map\(t=>t\.id===teamId\?removeMember\(t,name\):t\)\)/)
  })

  it('removing a participant entirely goes through the shared removeMember (clears captaincy) rather than a bespoke filter', () => {
    expect(teamCreator).toMatch(/nt=removeMember\(nt,n\)/)
  })

  it('unassigned is derived from the roster minus who is actually seated on a bracket, not tracked as separate state', () => {
    expect(teamCreator).toMatch(/const seatedNames=new Set\(teams\.flatMap\(t=>t\.members\|\|\[\]\)\)/)
    expect(teamCreator).toMatch(/const unassignedNames=participants\.filter\(p=>!seatedNames\.has\(p\)\)/)
  })
})

describe('TeamCreatorPage wiring (#8 captains)', () => {
  it('each member row has a captain toggle wired to the shared setCaptain', () => {
    expect(teamCreator).toMatch(/onClick=\{\(\)=>toggleCaptain\(team\.id,name\)\}/)
    expect(teamCreator).toMatch(/setTeams\(prev=>prev\.map\(t=>t\.id===teamId\?setCaptain\(t,name\):t\)\)/)
  })

  it('renders a 👑 badge for the team captain', () => {
    expect(teamCreator).toMatch(/👑 Aanvoerder/)
  })
})

describe('TeamCreatorPage wiring (#9 library)', () => {
  it('"save to event" has been replaced by "save to library" (saveTeamSet), with the event link optional', () => {
    expect(teamCreator).toMatch(/onClick=\{saveToLibrary\}/)
    expect(teamCreator).toMatch(/const result=await saveTeamSet\(payload\)/)
    expect(teamCreator).toMatch(/Koppel aan event \(optioneel\)/)
    expect(teamCreator).not.toMatch(/saveToEvent/)
  })

  it('a saved set can be loaded back in for editing', () => {
    expect(teamCreator).toMatch(/onClick=\{\(\)=>loadForEdit\(ts\)\}/)
  })

  it('delete goes through a confirm before calling deleteTeamSet', () => {
    expect(teamCreator).toMatch(/window\.confirm\(/)
    expect(teamCreator).toMatch(/const result=await deleteTeamSet\(ts\.id\)/)
  })
})

describe('TeamCreatorPage wiring (#10 archive/restore)', () => {
  it('has an Active/Archived filter over the library', () => {
    expect(teamCreator).toMatch(/setLibFilter\("active"\)/)
    expect(teamCreator).toMatch(/setLibFilter\("archived"\)/)
    expect(teamCreator).toMatch(/libFilter==="archived"\?ts\.status==="archived":ts\.status!=="archived"/)
  })

  it('wires Archive/Restore to the teamlib api', () => {
    expect(teamCreator).toMatch(/onClick=\{\(\)=>doArchive\(ts\)\}/)
    expect(teamCreator).toMatch(/onClick=\{\(\)=>doUnarchive\(ts\)\}/)
    expect(teamCreator).toMatch(/const result=await archiveTeamSet\(ts\)/)
    expect(teamCreator).toMatch(/const result=await unarchiveTeamSet\(ts\)/)
  })

  it('renders awards as trophy chips', () => {
    expect(teamCreator).toMatch(/\(ts\.awards\|\|\[\]\)\.length>0/)
  })
})
