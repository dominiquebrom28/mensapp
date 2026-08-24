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
const teamsTab = componentBody('TeamsTab')

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

describe('TeamCreatorPage wiring (#7 pin + manual assign + random fill)', () => {
  it('generate() seeds generateTeams with the current pins and existing team shells, from either a team count or a team size', () => {
    expect(teamCreator).toMatch(/\{participants,teamCount,existingTeams:prev\|\|\[\],pins\}/)
    expect(teamCreator).toMatch(/\{participants,teamSize,existingTeams:prev\|\|\[\],pins\}/)
  })

  it('has a per-member pin toggle and an assign-to-another-team control', () => {
    expect(teamCreator).toMatch(/onClick=\{\(\)=>togglePin\(name,team\.id\)\}/)
    expect(teamCreator).toMatch(/onChange=\{e=>assignMember\(name,e\.target\.value\)\}/)
  })

  it('removing a participant goes through the shared removeMember (clears captaincy) rather than a bespoke filter', () => {
    expect(teamCreator).toMatch(/nt=removeMember\(nt,n\)/)
  })
})

describe('TeamCreatorPage wiring (#8 captains)', () => {
  it('each member row has a captain toggle wired to the shared setCaptain', () => {
    expect(teamCreator).toMatch(/onClick=\{\(\)=>toggleCaptain\(team\.id,name\)\}/)
    expect(teamCreator).toMatch(/setTeams\(prev=>prev\?prev\.map\(t=>t\.id===teamId\?setCaptain\(t,name\):t\):prev\)/)
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

describe('TeamsTab wiring (§5.2 row 1 — "Verwijder" -> "Loskoppelen")', () => {
  it('no longer destroys the team set outright -- it unlinks via the teamlib api', () => {
    expect(teamsTab).toMatch(/Loskoppelen/)
    expect(teamsTab).not.toMatch(/>Verwijder</)
    expect(teamsTab).toMatch(/const result=await unlinkTeamSetFromEvent\(ts,evt\.id\)/)
  })

  it('only lists sets that are active AND linked to this event', () => {
    expect(teamsTab).toMatch(/ts\.status!=="archived"&&\(ts\.eventIds\|\|\[\]\)\.includes\(evt\.id\)/)
  })

  it('shows a captain badge', () => {
    expect(teamsTab).toMatch(/👑/)
  })
})
