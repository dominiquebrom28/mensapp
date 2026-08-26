// Regression coverage for "three write actions fail completely silently":
// `doArchive`, `doUnarchive`, `doDelete` (TeamCreatorPage) used to check
// `result.ok` and, on failure, do nothing at all -- no banner, no state
// change, the button just looked dead. Same bug class
// `updateEvent.writeFailure.test.js` covers for `updateEvent` -- this uses
// the identical "slice the real, current source text, eval it" extraction
// technique (these are local closures inside App.jsx's `TeamCreatorPage`,
// not module-scope exports), wrapped in a small factory that supplies their
// free variables (the teamlib api calls, `onTeamSetsChanged`, the new
// error-state setters) explicitly, exactly what a real render would close
// over.
//
// UPDATE (2026-08-26): this file used to cover a fourth action, `unlink`
// (`TeamsTab`'s own write-failure guard for `unlinkTeamSetFromEvent`).
// `TeamsTab` was removed along with the event page's Teams tab (owner
// decision, same date) -- Team Creator's library is the sole home for team
// sets now, and the "unlink this set from event X" action went with the tab
// it lived in. `unlinkTeamSetFromEvent` itself is untouched and still
// covered directly in `teamlib/api.test.js`; there is simply no more UI
// caller of it to regression-test here.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', '..', 'App.jsx')

function extractConstSource(startsWith) {
  const lines = fs.readFileSync(APP_JSX_PATH, 'utf-8').split('\n')
  const startIdx = lines.findIndex((l) => l.trim().startsWith(startsWith))
  if (startIdx === -1) {
    throw new Error(`libraryActions.writeFailure.test.js: could not find "${startsWith}" in App.jsx.`)
  }
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '};') {
      return lines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(`libraryActions.writeFailure.test.js: no closing "};" found for "${startsWith}".`)
}

function makeDoDelete({ deleteTeamSet, onTeamSetsChanged, editingSetId, setEditingSetId, setLibraryActionError }) {
  const source = extractConstSource('const doDelete=async ts=>{')
  const fn = new Function('deleteTeamSet', 'onTeamSetsChanged', 'editingSetId', 'setEditingSetId', 'setLibraryActionError', `${source}\nreturn doDelete;`)
  return fn(deleteTeamSet, onTeamSetsChanged, editingSetId, setEditingSetId, setLibraryActionError)
}

function makeDoArchive({ archiveTeamSet, onTeamSetsChanged, setLibraryActionError }) {
  const source = extractConstSource('const doArchive=async ts=>{')
  const fn = new Function('archiveTeamSet', 'onTeamSetsChanged', 'setLibraryActionError', `${source}\nreturn doArchive;`)
  return fn(archiveTeamSet, onTeamSetsChanged, setLibraryActionError)
}

function makeDoUnarchive({ unarchiveTeamSet, onTeamSetsChanged, setLibraryActionError }) {
  const source = extractConstSource('const doUnarchive=async ts=>{')
  const fn = new Function('unarchiveTeamSet', 'onTeamSetsChanged', 'setLibraryActionError', `${source}\nreturn doUnarchive;`)
  return fn(unarchiveTeamSet, onTeamSetsChanged, setLibraryActionError)
}

const TS = { id: 'ts_1', name: 'Groep A', teams: [], eventIds: ['evt-1'], status: 'active', awards: [] }

describe('TeamCreatorPage doDelete', () => {
  it('on failure: surfaces libraryActionError and leaves state untouched', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteTeamSet = vi.fn(async () => ({ ok: false, error: { message: 'boom' } }))
    const onTeamSetsChanged = vi.fn()
    const setEditingSetId = vi.fn()
    const setLibraryActionError = vi.fn()
    const doDelete = makeDoDelete({ deleteTeamSet, onTeamSetsChanged, editingSetId: 'ts_1', setEditingSetId, setLibraryActionError })

    await doDelete(TS)

    expect(onTeamSetsChanged).not.toHaveBeenCalled()
    expect(setEditingSetId).not.toHaveBeenCalled()
    expect(setLibraryActionError).toHaveBeenCalledWith(true)
    vi.restoreAllMocks()
  })

  it('on success: updates local state and does not surface an error', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteTeamSet = vi.fn(async () => ({ ok: true }))
    const onTeamSetsChanged = vi.fn()
    const setEditingSetId = vi.fn()
    const setLibraryActionError = vi.fn()
    const doDelete = makeDoDelete({ deleteTeamSet, onTeamSetsChanged, editingSetId: 'ts_1', setEditingSetId, setLibraryActionError })

    await doDelete(TS)

    expect(onTeamSetsChanged).toHaveBeenCalledTimes(1)
    expect(setEditingSetId).toHaveBeenCalledWith(null)
    expect(setLibraryActionError).toHaveBeenCalledWith(false)
    expect(setLibraryActionError).not.toHaveBeenCalledWith(true)
    vi.restoreAllMocks()
  })

  it('cancelling the confirm dialog calls neither the API nor any setter', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deleteTeamSet = vi.fn()
    const setLibraryActionError = vi.fn()
    const doDelete = makeDoDelete({ deleteTeamSet, onTeamSetsChanged: vi.fn(), editingSetId: null, setEditingSetId: vi.fn(), setLibraryActionError })

    await doDelete(TS)

    expect(deleteTeamSet).not.toHaveBeenCalled()
    expect(setLibraryActionError).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('TeamCreatorPage doArchive / doUnarchive', () => {
  it('doArchive on failure: surfaces libraryActionError, does not touch local state', async () => {
    const archiveTeamSet = vi.fn(async () => ({ ok: false, error: { message: 'boom' } }))
    const onTeamSetsChanged = vi.fn()
    const setLibraryActionError = vi.fn()
    const doArchive = makeDoArchive({ archiveTeamSet, onTeamSetsChanged, setLibraryActionError })

    await doArchive(TS)

    expect(onTeamSetsChanged).not.toHaveBeenCalled()
    expect(setLibraryActionError).toHaveBeenCalledWith(true)
  })

  it('doArchive on success: updates local state, clears any previous error', async () => {
    const archiveTeamSet = vi.fn(async () => ({ ok: true, teamSet: { ...TS, status: 'archived' } }))
    const onTeamSetsChanged = vi.fn()
    const setLibraryActionError = vi.fn()
    const doArchive = makeDoArchive({ archiveTeamSet, onTeamSetsChanged, setLibraryActionError })

    await doArchive(TS)

    expect(onTeamSetsChanged).toHaveBeenCalledTimes(1)
    expect(setLibraryActionError).toHaveBeenCalledWith(false)
    expect(setLibraryActionError).not.toHaveBeenCalledWith(true)
  })

  it('doUnarchive on failure: surfaces libraryActionError, does not touch local state', async () => {
    const unarchiveTeamSet = vi.fn(async () => ({ ok: false, error: { message: 'boom' } }))
    const onTeamSetsChanged = vi.fn()
    const setLibraryActionError = vi.fn()
    const doUnarchive = makeDoUnarchive({ unarchiveTeamSet, onTeamSetsChanged, setLibraryActionError })

    await doUnarchive(TS)

    expect(onTeamSetsChanged).not.toHaveBeenCalled()
    expect(setLibraryActionError).toHaveBeenCalledWith(true)
  })
})

// `describe('TeamsTab unlink', ...)` removed 2026-08-26 -- see this file's
// header UPDATE note. `TeamsTab` and its `unlink` closure no longer exist in
// App.jsx; `unlinkTeamSetFromEvent`'s own success/failure contract is still
// covered directly in `teamlib/api.test.js`.
