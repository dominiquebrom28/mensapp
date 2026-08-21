// Regression coverage for ticket 0.5 (second half): "no Supabase write in
// this app checks whether it succeeded", applied optimistically first, so a
// failed write was indistinguishable from a successful one until reload.
// `updateEvent` (src/App.jsx, inside the `App` root component) is the write
// path virtually every event mutation funnels through as `onUpdate` --
// event edit, the schedule editor's save (incl. its backdrop-click save),
// kretjes, polls, quizzes, teams, photos, winners, FAQs, presentation-mode
// secret reveals -- so hardening it here covers all of those in one place.
//
// `updateEvent` is a local closure inside `App()`, not a module-scope
// export, so this uses the same "slice the real, current source text, eval
// it" technique as the other extraction-based test files (e.g.
// extractFromAppSource.js, presentationModeOrder.test.jsx) -- not a
// hand-copied reimplementation. Because it closes over `activeId`,
// `setEvents`, `supabase`, `setWriteError` (free variables from its
// enclosing `App()` scope, not props), the extracted text is wrapped in a
// small factory that supplies those as explicit parameters instead --
// exactly what a fresh render of `App()` would close over.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')

function extractUpdateEventSource() {
  const lines = fs.readFileSync(APP_JSX_PATH, 'utf-8').split('\n')
  const startIdx = lines.findIndex((l) => l.trim().startsWith('const updateEvent=async'))
  if (startIdx === -1) {
    throw new Error('updateEvent.writeFailure.test.js: could not find "const updateEvent=async" in App.jsx.')
  }
  // updateEvent's only nested blocks close with `});` (the setEvents
  // updater callbacks), never a lone `};` of their own -- so the first line
  // that trims to exactly `};` is genuinely updateEvent's own closer.
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '};') {
      return lines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error('updateEvent.writeFailure.test.js: no closing "};" found for "const updateEvent=async".')
}

function makeUpdateEvent({ activeId, setEvents, supabase, setWriteError }) {
  const source = extractUpdateEventSource()
  const fn = new Function('activeId', 'setEvents', 'supabase', 'setWriteError', `${source}\nreturn updateEvent;`)
  return fn(activeId, setEvents, supabase, setWriteError)
}

// Minimal setEvents stand-in with the exact subset of React's setState
// behavior updateEvent relies on: accepts either a value or an
// updater-function, and always operates on the CURRENT value (not a stale
// snapshot) -- same as the real hook.
function makeEventsState(initial) {
  let current = initial
  const setEvents = (next) => {
    current = typeof next === 'function' ? next(current) : next
  }
  return { setEvents, get: () => current }
}

// Fake supabase whose `events.upsert(...)` result is controlled per test via
// `result` (mutable so a single test can flip it between calls), and which
// records every upsert call for assertions.
function makeFakeSupabase(result) {
  const upsertCalls = []
  return {
    upsertCalls,
    from: (table) => ({
      upsert: (rows) => {
        upsertCalls.push({ table, rows })
        return Promise.resolve(result.value)
      },
    }),
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('updateEvent (object form, i.e. onSave={u=>onUpdate(u)} -- EditEventModal, EditScheduleModal, KretjesTab, etc.)', () => {
  it('applies optimistically and clears any previous write error on success', async () => {
    const events = makeEventsState([{ id: 'e1', name: 'Old Name' }])
    const result = { value: { error: null } }
    const supabase = makeFakeSupabase(result)
    const setWriteError = vi.fn()
    const updateEvent = makeUpdateEvent({ activeId: 'e1', setEvents: events.setEvents, supabase, setWriteError })

    await updateEvent({ id: 'e1', name: 'New Name' })

    expect(events.get()).toEqual([{ id: 'e1', name: 'New Name' }])
    expect(supabase.upsertCalls).toEqual([{ table: 'events', rows: [{ id: 'e1', name: 'New Name' }] }])
    expect(setWriteError).toHaveBeenCalledWith(null)
  })

  it('on a Supabase error: rolls the optimistic update back to the pre-write state and surfaces a not-missable error', async () => {
    const original = { id: 'e1', name: 'Old Name' }
    const events = makeEventsState([original])
    const result = { value: { error: { message: 'network down' } } }
    const supabase = makeFakeSupabase(result)
    const setWriteError = vi.fn()
    const updateEvent = makeUpdateEvent({ activeId: 'e1', setEvents: events.setEvents, supabase, setWriteError })

    await updateEvent({ id: 'e1', name: 'New Name (should not stick)' })

    // Rolled back to the exact pre-write object -- not just "some old
    // name", the literal previous reference/value, so nothing about the
    // rest of the event (schedule, polls, etc.) drifts either.
    expect(events.get()).toEqual([original])
    // A real, non-empty message was surfaced (not just `true`/silently
    // swallowed) -- this is what the App-root banner renders.
    expect(setWriteError).toHaveBeenCalledTimes(1)
    const [message] = setWriteError.mock.calls[0]
    expect(typeof message).toBe('string')
    expect(message.length).toBeGreaterThan(0)
    // Never also called with null afterwards (i.e. it doesn't clear its own error).
    expect(setWriteError).not.toHaveBeenCalledWith(null)
  })

  it('a later successful call clears an error surfaced by a previous failed one', async () => {
    const events = makeEventsState([{ id: 'e1', name: 'Old' }])
    const result = { value: { error: { message: 'temporary blip' } } }
    const supabase = makeFakeSupabase(result)
    const setWriteError = vi.fn()
    const updateEvent = makeUpdateEvent({ activeId: 'e1', setEvents: events.setEvents, supabase, setWriteError })

    await updateEvent({ id: 'e1', name: 'Attempt 1' })
    expect(events.get()).toEqual([{ id: 'e1', name: 'Old' }]) // rolled back

    result.value = { error: null } // "the wifi came back"
    await updateEvent({ id: 'e1', name: 'Attempt 2' })
    expect(events.get()).toEqual([{ id: 'e1', name: 'Attempt 2' }])
    expect(setWriteError).toHaveBeenLastCalledWith(null)
  })

  it('leaves OTHER events in the list completely untouched, both on success and on rollback', async () => {
    const untouched = { id: 'e2', name: 'Untouched' }
    const events = makeEventsState([{ id: 'e1', name: 'Old' }, untouched])
    const result = { value: { error: { message: 'fail' } } }
    const supabase = makeFakeSupabase(result)
    const updateEvent = makeUpdateEvent({ activeId: 'e1', setEvents: events.setEvents, supabase, setWriteError: vi.fn() })

    await updateEvent({ id: 'e1', name: 'New' })
    expect(events.get().find((e) => e.id === 'e2')).toBe(untouched)
  })
})

describe('updateEvent (function form, i.e. onUpdate(prev=>({...prev,...})) -- the functional-update call sites)', () => {
  it('applies optimistically and clears any previous write error on success', async () => {
    const events = makeEventsState([{ id: 'e1', kretjes: 3 }])
    const result = { value: { error: null } }
    const supabase = makeFakeSupabase(result)
    const setWriteError = vi.fn()
    const updateEvent = makeUpdateEvent({ activeId: 'e1', setEvents: events.setEvents, supabase, setWriteError })

    await updateEvent((e) => ({ ...e, kretjes: e.kretjes + 1 }))

    expect(events.get()).toEqual([{ id: 'e1', kretjes: 4 }])
    expect(supabase.upsertCalls).toEqual([{ table: 'events', rows: [{ id: 'e1', kretjes: 4 }] }])
    expect(setWriteError).toHaveBeenCalledWith(null)
  })

  it('on a Supabase error: rolls back to the pre-write event, not a half-applied one', async () => {
    const original = { id: 'e1', kretjes: 3 }
    const events = makeEventsState([original])
    const result = { value: { error: { message: 'network down' } } }
    const supabase = makeFakeSupabase(result)
    const setWriteError = vi.fn()
    const updateEvent = makeUpdateEvent({ activeId: 'e1', setEvents: events.setEvents, supabase, setWriteError })

    await updateEvent((e) => ({ ...e, kretjes: e.kretjes + 1 }))

    expect(events.get()).toEqual([original])
    expect(setWriteError).toHaveBeenCalledTimes(1)
    expect(setWriteError).not.toHaveBeenCalledWith(null)
  })

  it('does not call Supabase at all if activeId matches no event (no phantom write, no crash)', async () => {
    const events = makeEventsState([{ id: 'e-somewhere-else' }])
    const supabase = makeFakeSupabase({ value: { error: null } })
    const setWriteError = vi.fn()
    const updateEvent = makeUpdateEvent({ activeId: 'e-not-in-list', setEvents: events.setEvents, supabase, setWriteError })

    await expect(updateEvent((e) => ({ ...e, kretjes: (e.kretjes || 0) + 1 }))).resolves.toBeUndefined()

    expect(supabase.upsertCalls).toEqual([])
    expect(setWriteError).not.toHaveBeenCalled()
  })
})
