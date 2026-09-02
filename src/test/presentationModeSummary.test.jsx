// Regression coverage for the presentation-mode summary slide (owner
// request 2026-09-02: "add the summary and to-bring list also at the end of
// the present-mode of an event"). `total` grew from `allStops.length+1` to
// `allStops.length+2` -- one more, final slide, in ALL THREE modes
// (presenter, synced viewer, solo) -- built from the exact same
// `buildScheduleSummary`/`evt.bring` OverviewTab's own "Summary" view
// already uses (see src/test/scheduleSummary.pure.test.js), not a
// reimplementation.
//
// The delicate part, and the reason most of this file exists: the summary
// slide has no stop of its own, so it's a second "no stop" case alongside
// the pre-existing intro (`stopId:null`/`realIdx:null` on the wire). Before
// this feature, resolvePayloadRealIdx's `if(payload.stopId===null)
// return{found:true,realIdx:null}` branch was the ONLY thing "no stop"
// could mean, and it means "the intro" -- so if the summary slide's
// broadcast reused that same shape, every viewer would snap back to the
// intro the instant a presenter reached it. The fix: the summary slide's
// outgoing payload carries an explicit `isSummary:true` marker and omits
// `stopId`/`realIdx` ENTIRELY (not `null` -- `undefined`, which matches
// neither existing branch and falls through to `{found:false}`) alongside
// the plain legacy `idx`. This file drives the actual, current
// PresentationMode component (source-extraction, same technique as
// presentationModeOrder.test.jsx -- not a hand-copied reimplementation) end
// to end: a real presenter instance's own emitted payload feeds a real
// viewer instance.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { isSafeImageUrl } from '../features/trailer/safeUrl.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const ESBUILD_PATH = path.join(__dirname, '..', '..', 'node_modules', 'esbuild')

// Same extraction machinery as presentationModeOrder.test.jsx -- see that
// file's docblock for the full rationale of each piece.
function extractNoSpaceDecl(sourceLines, name) {
  const startIdx = sourceLines.findIndex((line) => {
    const t = line.trimStart()
    return t.startsWith(`const ${name}=`) || t.startsWith(`const ${name} =`)
  })
  if (startIdx === -1) {
    throw new Error(`presentationModeSummary.test.jsx: could not find "const ${name}=" (or "const ${name} =") in App.jsx.`)
  }
  const firstLine = sourceLines[startIdx]
  const trimmedFirst = firstLine.trim()
  if (trimmedFirst.endsWith(';')) return firstLine
  const closer = trimmedFirst.endsWith('{') ? '};' : trimmedFirst.endsWith('(') ? ');' : null
  if (!closer) {
    throw new Error(`presentationModeSummary.test.jsx: "const ${name}=" doesn't end in "{" or "(".`)
  }
  for (let i = startIdx + 1; i < sourceLines.length; i++) {
    if (sourceLines[i].trim() === closer) {
      return sourceLines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(`presentationModeSummary.test.jsx: no closing "${closer}" found for "const ${name}=".`)
}

function extractBraceMatchedDecl(fullSource, name) {
  const declRe = new RegExp(`const ${name}=\\(([\\s\\S]*?)\\)=>\\{`)
  const m = declRe.exec(fullSource)
  if (!m) {
    throw new Error(`presentationModeSummary.test.jsx: could not find "const ${name}=(...)=>{" in App.jsx.`)
  }
  let i = m.index + m[0].length - 1
  const end = fullSource.length
  let depth = 0
  const frames = [{ type: 'code' }]
  while (i < end) {
    const top = frames[frames.length - 1]
    if (top.type === 'template') {
      const c = fullSource[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        frames.pop()
        i++
        continue
      }
      if (c === '$' && fullSource[i + 1] === '{') {
        depth++
        frames.push({ type: 'code-from-template', matchDepth: depth })
        i += 2
        continue
      }
      i++
      continue
    }
    const c = fullSource[i]
    const c2 = c + (fullSource[i + 1] || '')
    if (c2 === '//') {
      const nl = fullSource.indexOf('\n', i)
      i = nl === -1 ? end : nl + 1
      continue
    }
    if (c2 === '/*') {
      const close = fullSource.indexOf('*/', i + 2)
      i = close === -1 ? end : close + 2
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      i++
      while (i < end) {
        if (fullSource[i] === '\\') {
          i += 2
          continue
        }
        if (fullSource[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '`') {
      frames.push({ type: 'template' })
      i++
      continue
    }
    if (c === '{') {
      depth++
      i++
      continue
    }
    if (c === '}') {
      depth--
      i++
      const cur = frames[frames.length - 1]
      if (cur.type === 'code-from-template' && depth === cur.matchDepth - 1) {
        frames.pop()
        continue
      }
      if (depth === 0 && frames.length === 1) {
        return fullSource.slice(m.index, i) + ';'
      }
      continue
    }
    i++
  }
  throw new Error(`presentationModeSummary.test.jsx: brace matching for "const ${name}=" never returned to depth 0.`)
}

function transformJsxInSubprocess(source) {
  const script = `
    const esbuild = require(${JSON.stringify(ESBUILD_PATH)});
    const out = esbuild.transformSync(process.argv[1], {
      loader: 'jsx',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    });
    process.stdout.write(out.code);
  `
  return execFileSync(process.execPath, ['-e', script, source], { encoding: 'utf-8' })
}

function extractPresentationMode() {
  const fullSource = fs.readFileSync(APP_JSX_PATH, 'utf-8')
  const lines = fullSource.split('\n')
  const flatNames = [
    'formatEventDateRange',
    'eventDayCount',
    'dateForEventDay',
    'dayHeadingLabel',
    'padTimeForSort',
    'scheduleDayTimeOrder',
    'buildScheduleSummary',
    'useIsMobile',
  ]
  const raw =
    flatNames.map((n) => extractNoSpaceDecl(lines, n)).join('\n') +
    '\n' +
    extractBraceMatchedDecl(fullSource, 'PresentationMode')
  const transformed = transformJsxInSubprocess(raw)
  const fn = new Function(
    'React',
    'useState',
    'useEffect',
    'useRef',
    'useCallback',
    'supabase',
    'isSafeImageUrl',
    `${transformed}\nreturn PresentationMode;`,
  )
  return fn
}

// Fake realtime channel that records its `.on()` handlers (so a test can
// simulate an incoming presence sync or broadcast directly) and exposes
// track/send as spies (so an outgoing payload can be captured and reused).
function makeFakeChannel() {
  const handlers = {}
  const channel = {
    on: (type, opts, cb) => {
      handlers[`${type}:${opts.event}`] = cb
      return channel
    },
    subscribe: (cb) => {
      cb?.('SUBSCRIBED')
      return channel
    },
    track: vi.fn(),
    send: vi.fn(),
    untrack: vi.fn(),
    presenceState: () => ({}),
    _handlers: handlers,
  }
  return channel
}

// Unlike the other PresentationMode test files, this one needs to mount
// TWO instances in the same test (a presenter, to produce a real outgoing
// payload; a viewer, to receive it) -- each `supabase.channel(...)` call
// gets its OWN fake channel, all of them kept (not just the last one) so a
// test can address either side by position.
function makeFakeSupabase() {
  const channels = []
  return {
    channel: () => {
      const ch = makeFakeChannel()
      channels.push(ch)
      return ch
    },
    removeChannel: () => {},
    channels,
  }
}

let PresentationMode
let fakeSupabase

beforeEach(() => {
  vi.useFakeTimers()
  fakeSupabase = makeFakeSupabase()
  PresentationMode = extractPresentationMode()(React, useState, useEffect, useRef, useCallback, fakeSupabase, isSafeImageUrl)
})

afterEach(() => {
  vi.useRealTimers()
})

function advanceFade() {
  act(() => {
    vi.advanceTimersByTime(250)
  })
}

describe('PresentationMode summary slide: presenter mode', () => {
  it('is the true last slide -- reached after every stop, Next hidden there, Prev still present', () => {
    const evt = {
      id: 'evt-sum-presenter-1',
      name: 'Summary Presenter Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Breakfast', day: 0, time: '09:00', secret: false },
        { activity: 'Hike', day: 0, time: '12:00', secret: false },
      ],
      bring: ['Regenjas', 'Goed humeur'],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    // intro -> Breakfast -> Hike -> summary (3 clicks for 2 stops + summary)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText('→'))
      advanceFade()
    }
    expect(screen.getByText('📋 The Full Day')).toBeInTheDocument()
    expect(screen.getByText('Breakfast')).toBeInTheDocument()
    expect(screen.getByText('Hike')).toBeInTheDocument()
    // Bullet-prefixed ("• Regenjas") -- not an exact match against the item
    // text alone.
    expect(screen.getByText('Regenjas', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Goed humeur', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
    expect(screen.getByText('←')).toBeInTheDocument()
    expect(screen.getByText('4 / 4')).toBeInTheDocument() // intro + 2 stops + summary
  })

  it('a stop revealed during the session shows in full on the summary, even though its own live slide still hides it from viewers', () => {
    const evt = {
      id: 'evt-sum-reveal-1',
      name: 'Reveal Test',
      date: '2026-09-11',
      schedule: [
        { id: 'stop-secret', activity: 'Surprise Karting', location: 'Undisclosed track', day: 0, time: '14:00', secret: true },
      ],
    }
    const onUpdate = vi.fn()
    render(<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('→')) // land on the secret stop's own slide
    advanceFade()
    fireEvent.click(screen.getByRole('button', { name: /Reveal to viewers/i }))
    // Presenter's own `evt` prop isn't re-rendered with onUpdate's result in
    // this harness (same as presentationModeOrder.test.jsx's toggleReveal
    // test) -- the summary's masking must still be correct purely from
    // session state (`revealedSecrets`), not from `evt.schedule` catching
    // up, which is exactly the robustness this feature needs against a
    // real viewer's own lagging `evt.schedule` prop (see this file's
    // top-of-file docblock and the summary slide's own comment in
    // App.jsx).
    fireEvent.click(screen.getByText('→')) // -> summary
    advanceFade()
    expect(screen.getByText('Surprise Karting')).toBeInTheDocument()
    expect(screen.getByText('Undisclosed track', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText(/still a secret/i)).not.toBeInTheDocument()
  })

  it('a secret stop never revealed this session stays out of the list, shown only as a count -- never its activity or location', () => {
    const evt = {
      id: 'evt-sum-hidden-1',
      name: 'Hidden Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Public Lunch', location: 'Café X', day: 0, time: '12:00', secret: false },
        { activity: 'TOP SECRET surprise', location: 'Undisclosed bunker', day: 0, time: '20:00', secret: true },
      ],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText('→'))
      advanceFade()
    }
    expect(screen.getByText('Public Lunch')).toBeInTheDocument()
    expect(screen.queryByText('TOP SECRET surprise')).not.toBeInTheDocument()
    expect(screen.queryByText('Undisclosed bunker')).not.toBeInTheDocument()
    expect(screen.getByText(/1 stop still a secret/i)).toBeInTheDocument()
  })
})

// Regression test for a reported (but, after extensive diagnosis during
// this change -- a mathematical proof, a 200k-case fuzz check of the
// order/buildScheduleSummary alignment, and a full real-App +
// harnessSupabaseMock.js reproduction attempt covering the harness's own
// stale 30s poll -- NOT reproducible against the actual shipped code; see
// the PR/handoff notes for the full diagnosis) concern: a stop revealed
// mid-session on a MULTI-DAY event failing to show in full on the closing
// summary. Kept as a permanent regression test regardless, per the
// instruction to prefer id-based matching over a positional walk so the
// two orderings never have to agree -- the summary's own masking now looks
// up each row's real stop id by content (day+time+activity+location) via
// `idByKey` in App.jsx, not via a `cursor` walked in lockstep with
// `order`.
describe('PresentationMode summary slide: reveal correctness on a genuinely multi-day, non-trivial schedule', () => {
  it('a stop revealed mid-session on a multi-day event appears in full among the summary\'s own rows, with no "still a secret" line', () => {
    // `onUpdate` is a deliberate NO-OP (not a stateful harness that applies
    // it) -- mutation-testing this file found that a REAL, applying
    // `onUpdate` flips the persisted `secret` flag to `false` too, which on
    // its own is already enough to unmask the row regardless of whether
    // the id lookup this test exists to guard is even correct. A no-op
    // means `evt.schedule[i].secret` NEVER catches up (exactly a real
    // viewer whose own `evt.schedule` prop hasn't caught up to a
    // presenter's just-written reveal yet, or a presenter's own optimistic
    // local write not having landed for some other reason) -- so the ONLY
    // thing that can correctly show this row in full is
    // `revealedSecrets.includes(id)` resolving `id` to the RIGHT stop.
    const evt = {
      id: 'evt-multiday-reveal-1',
      name: 'Multiday Reveal Test',
      date: '2026-09-11',
      end_date: '2026-09-12',
      // Day 1's stop listed FIRST in the raw array, and day 0's stops are
      // ALSO out of time order in the array -- deliberately not already in
      // display order, the shape most likely to expose any assumption
      // that two independently sorted lists happen to walk in lockstep.
      // Display order (day asc, then time asc): Ontvangst(18:00) ->
      // Pubquiz(20:00) -> sauna(23:00, secret) -> Katerontbijt(day 1).
      schedule: [
        { id: 's4', activity: 'Katerontbijt', day: 1, time: '09:00', secret: false },
        { id: 's3', activity: 'VERRASSING — sauna', location: 'Geheim', day: 0, time: '23:00', secret: true },
        { id: 's2', activity: 'Pubquiz', location: 'Achterzaal', day: 0, time: '20:00', secret: false },
        { id: 's1', activity: 'Ontvangst met bier', location: 'Kroeg De Kater', day: 0, time: '18:00', secret: false },
      ],
      bring: ['Zwembroek', 'Goed humeur'],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    // intro -> Ontvangst -> Pubquiz -> sauna (3 clicks, display order)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText('→'))
      advanceFade()
    }
    expect(screen.getByText('VERRASSING — sauna')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reveal to viewers/i }))
    // -> Katerontbijt -> summary (2 clicks)
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByText('→'))
      advanceFade()
    }
    // Scoped strictly to the summary's own rendered container -- not a
    // document-wide text search -- exactly the distinction the reported
    // bug itself named getting wrong twice before ("it was the previous
    // slide still mounted during the fade, and my ancestor test was too
    // loose"). The summary's own root div is the only element in this
    // component with an `overflow-y` style.
    const heading = screen.getByText('📋 The Full Day')
    const summaryContainer = heading.closest('div[style*="overflow-y"]')
    expect(summaryContainer).toBeTruthy()
    const withinSummary = within(summaryContainer)
    expect(withinSummary.getByText('VERRASSING — sauna')).toBeInTheDocument()
    expect(withinSummary.getByText('Geheim', { exact: false })).toBeInTheDocument()
    expect(withinSummary.queryByText(/still a secret/i)).not.toBeInTheDocument()
    // Every OTHER stop is still there too -- the reveal didn't drop or
    // duplicate anything else in the list.
    expect(withinSummary.getByText('Ontvangst met bier')).toBeInTheDocument()
    expect(withinSummary.getByText('Pubquiz')).toBeInTheDocument()
    expect(withinSummary.getByText('Katerontbijt')).toBeInTheDocument()
  })
})

// Regression coverage for a reported (and this time confirmed real in
// substance, though the specific trigger turned out to be a harness
// artefact, not a product bug -- see PR/handoff notes) concern: a reveal
// made mid-session appeared to "decay" while sitting on the summary,
// several tens of seconds later, with no further interaction. The
// harness's own `App.jsx` ~5919 30s events poll resolves to
// harnessSupabaseMock.js's static, never-mutated fixture (its `upsert` is
// a no-op) and overwrites `evt.schedule[i].secret` back to `true` -- that
// part is an acknowledged fixture limitation, not something to fix here.
// What this file exists to pin down and guard, permanently, is the other
// half of the question: does `revealedSecrets` (this component's own
// local session state, the thing `s.secret && !revealedSecrets
// .includes(id)` actually leans on to survive exactly this kind of lag)
// survive an `evt` prop refresh regardless of what that refresh does to
// the persisted `secret` flag underneath -- an RSVP, a photo, the kretjes
// counter, or a stale poll are all, from PresentationMode's point of view,
// just "a new `evt` object arrived." It must, or ANY unrelated write
// during a live presentation could silently re-hide a stop the presenter
// already revealed to the room. It does: `revealedSecrets` is a plain
// `useState` inside this component, set only by `toggleReveal` (and,
// separately, a viewer's own `applySlide` -- never reachable on the
// presenter's own channel branch), and read fresh on every render
// regardless of what triggered it -- no effect in this component
// re-derives or resets it from `evt`.
describe('PresentationMode summary slide: a reveal is durable against an unrelated evt refresh', () => {
  it('revealedSecrets survives an evt prop change that restores secret:true on the stop -- the summary stays correctly revealed', () => {
    const schedule = [
      { id: 's1', day: 0, time: '20:00', activity: 'Ontvangst met bier', location: 'Kroeg De Kater', secret: false },
      { id: 's2', day: 0, time: '21:30', activity: 'Pubquiz', location: 'Achterzaal', secret: false },
      { id: 's3', day: 0, time: '23:00', activity: 'VERRASSING — sauna', location: 'Geheim', secret: true },
      { id: 's4', day: 1, time: '10:00', activity: 'Katerontbijt', location: 'Bakker Jansen', secret: false },
    ]
    const evt = {
      id: 'evt-poll-durability-1',
      name: 'Poll Durability Test',
      date: '2026-09-11',
      end_date: '2026-09-12',
      schedule,
    }
    // Deterministic navigation via the dot buttons, not synthetic key
    // events -- the coordinator's own corrected repro method, after
    // synthetic ArrowRight keydowns turned out to get dropped mid-fade in
    // an earlier investigation of this same feature.
    const dots = () => document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    const { rerender } = render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    fireEvent.click(dots()[3]) // dot 3 = s3, the secret stop
    advanceFade()
    expect(screen.getByText('VERRASSING — sauna')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reveal to viewers/i }))
    fireEvent.click(dots()[5]) // dot 5 = summary
    advanceFade()

    const summaryContainer = () => screen.getByText('📋 The Full Day').closest('div[style*="overflow-y"]')
    expect(within(summaryContainer()).getByText('VERRASSING — sauna')).toBeInTheDocument()
    expect(within(summaryContainer()).queryByText(/still a secret/i)).not.toBeInTheDocument()

    // Simulate the stale poll (or any other unrelated write) landing while
    // sitting on the summary, no further interaction: a BRAND NEW `evt`
    // object, same id, with the ORIGINAL schedule -- `secret:true` on s3,
    // exactly as if `toggleReveal`'s own persisted write never landed.
    rerender(
      <PresentationMode
        evt={{ ...evt, schedule: schedule.map((s) => ({ ...s })) }}
        onUpdate={() => {}}
        isPresenter={true}
        onClose={() => {}}
      />,
    )
    advanceFade()

    expect(within(summaryContainer()).getByText('VERRASSING — sauna')).toBeInTheDocument()
    expect(within(summaryContainer()).queryByText(/still a secret/i)).not.toBeInTheDocument()
  })

  // Narrower, more specific regression than the test above: reproduces the
  // EXACT sequence a real optimistic write + a stale-data revert produces
  // (this is what the coordinator's own harness observation localised, and
  // what the prior fix in this file -- a content-key lookup, `idByKey` --
  // turned out to still get wrong under exactly this sequence, despite
  // passing every test built around a no-op `onUpdate`). At t=0,
  // `toggleReveal`'s own real, applying `onUpdate` has already flipped
  // `secret:false` locally (the normal, optimistic path) -- so this test
  // does NOT rely on `secret` staying `true` throughout to exercise the
  // reveal path. At t=+poll, a fresh `evt` restores `secret:true` (the
  // stale revert), and ONLY `revealedSecrets` stands between the room and
  // a stop re-hiding itself on screen mid-presentation.
  it('a reveal made via a REAL optimistic onUpdate survives the persisted flag reverting back to secret:true afterwards', () => {
    const initialSchedule = [
      { id: 's1', day: 0, time: '20:00', activity: 'Ontvangst met bier', location: 'Kroeg De Kater', secret: false },
      { id: 's2', day: 0, time: '21:30', activity: 'Pubquiz', location: 'Achterzaal', secret: false },
      { id: 's3', day: 0, time: '23:00', activity: 'VERRASSING — sauna', location: 'Geheim', secret: true },
      { id: 's4', day: 1, time: '10:00', activity: 'Katerontbijt', location: 'Bakker Jansen', secret: false },
    ]
    const initialEvt = {
      id: 'evt-real-optimistic-revert-1',
      name: 'Real Optimistic Revert Test',
      date: '2026-09-11',
      end_date: '2026-09-12',
      schedule: initialSchedule,
    }
    function Harness() {
      const [evt, setEvt] = useState(initialEvt)
      // Exposed so the test can simulate the harness's 30s poll landing
      // (App.jsx ~5919): a BRAND NEW `evt` object, same id, with the
      // ORIGINAL schedule -- `secret:true` on s3 again, same real ids.
      window.__simulatePoll = () => setEvt({ ...initialEvt, schedule: initialSchedule.map((s) => ({ ...s })) })
      return <PresentationMode evt={evt} onUpdate={(u) => setEvt(u)} isPresenter={true} onClose={() => {}} />
    }
    const dots = () => document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    render(<Harness />)
    fireEvent.click(dots()[3]) // s3, the secret stop
    advanceFade()
    expect(screen.getByText('VERRASSING — sauna')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Reveal to viewers/i }))
    // The real, applying `onUpdate` has now flipped `secret:false` locally
    // -- confirmed before moving on (the persisted flag flipping to
    // non-secret means the secret/revealed badge and the reveal toggle
    // both stop rendering entirely, exactly like any other plain stop; the
    // activity itself keeps showing throughout) -- so this test starts
    // from the actual state a real reveal produces, not an assumption
    // about it.
    expect(screen.getByText('VERRASSING — sauna')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hide from viewers/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/🔒 Secret/)).not.toBeInTheDocument()

    fireEvent.click(dots()[5]) // summary
    advanceFade()
    const summaryContainer = () => screen.getByText('📋 The Full Day').closest('div[style*="overflow-y"]')
    expect(within(summaryContainer()).getByText('VERRASSING — sauna')).toBeInTheDocument()
    expect(within(summaryContainer()).queryByText(/still a secret/i)).not.toBeInTheDocument()

    // Simulate the poll landing while sitting on the summary: `secret`
    // goes back to `true` underneath, same real ids, `revealedSecrets`
    // (session state) untouched.
    act(() => { window.__simulatePoll() })
    advanceFade()

    expect(within(summaryContainer()).getByText('VERRASSING — sauna')).toBeInTheDocument()
    expect(within(summaryContainer()).queryByText(/still a secret/i)).not.toBeInTheDocument()
  })

  // The actual, confirmed discriminator between the previous version of
  // this slide (a content-key lookup, `idByKey`, keyed on
  // day+time+activity+location) and the current one (each row reads
  // `secret`/`id` straight off its own real stop object, same as the
  // per-stop slide): two DIFFERENT stops with byte-identical
  // day+time+activity+location content. `idByKey` maps both to whichever
  // one it saw LAST, so revealing one silently revealed (or hid) the
  // WRONG one -- confirmed to fail exactly this way against the prior
  // `idByKey` code during this change (0 of 2 shown revealed, "2 stops
  // still a secret", when 1 of the 2 duplicates had been revealed).
  // This is NOT the exact mechanism reported (a single stop's OWN secret
  // flag reverting after a stale write) -- extensive testing (isolated
  // component, full real App + harnessSupabaseMock.js, both fake and real
  // timers, multiple poll cycles, matching the exact reveal-then-poll
  // sequence) could not make `idByKey` fail that way: its key never
  // includes `secret`, so a change to `secret` alone cannot change which
  // id it resolves to. This duplicate-content case is the one mechanism
  // that provably does distinguish the two implementations, and the new
  // one is immune to it by construction (no shared key to collide on).
  it('two stops with identical day+time+activity+location are never confused with each other, even though only one is revealed', () => {
    const evt = {
      id: 'evt-collision-1',
      name: 'Collision Test',
      date: '2026-09-11',
      schedule: [
        { id: 'dup-a', day: 0, time: '20:00', activity: 'Mystery Activity', location: 'TBD', secret: true },
        { id: 'dup-b', day: 0, time: '20:00', activity: 'Mystery Activity', location: 'TBD', secret: true },
      ],
    }
    const dots = () => document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    // Reveal only the FIRST of the two duplicates.
    fireEvent.click(dots()[1])
    advanceFade()
    fireEvent.click(screen.getByRole('button', { name: /Reveal to viewers/i }))
    fireEvent.click(dots()[3]) // summary (intro + 2 stops + summary)
    advanceFade()

    const summaryContainer = () => screen.getByText('📋 The Full Day').closest('div[style*="overflow-y"]')
    expect(within(summaryContainer()).getAllByText('Mystery Activity')).toHaveLength(1)
    expect(within(summaryContainer()).getByText(/1 stop still a secret/i)).toBeInTheDocument()
  })
})

describe('PresentationMode summary slide: solo mode', () => {
  it('is also the last slide in solo mode, never creates a channel, and applies the same secret masking', () => {
    const evt = {
      id: 'evt-sum-solo-1',
      name: 'Solo Summary Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Public One', day: 0, time: '09:00', secret: false },
        { activity: 'Secret Two', day: 0, time: '12:00', secret: true },
      ],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={() => {}} />)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText('→'))
      advanceFade()
    }
    expect(screen.getByText('📋 The Full Day')).toBeInTheDocument()
    expect(screen.getByText('Public One')).toBeInTheDocument()
    expect(screen.queryByText('Secret Two')).not.toBeInTheDocument()
    expect(screen.getByText(/1 stop still a secret/i)).toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
    expect(fakeSupabase.channels.length).toBe(0)
  })
})

describe('PresentationMode summary slide: viewer follows the presenter onto it, live', () => {
  it('a real presenter\'s own broadcast for the summary slide drives a viewer onto ITS OWN summary -- not a snap back to the intro', () => {
    // Presenter side: mount a real presenter, walk it onto the summary, and
    // capture the EXACT payload it actually sends -- not a hand-built
    // stand-in for it.
    const presenterEvt = {
      id: 'evt-sum-follow-1',
      name: 'Follow Test',
      date: '2026-09-11',
      schedule: [
        { id: 'p-a', activity: 'Presenter Alpha', day: 0, time: '09:00', secret: false },
        { id: 'p-b', activity: 'Presenter Bravo', day: 0, time: '12:00', secret: false },
      ],
    }
    render(<PresentationMode evt={presenterEvt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText('→'))
      advanceFade()
    }
    const presenterChannel = fakeSupabase.channels[0]
    const summaryPayload = presenterChannel.send.mock.calls.at(-1)[0].payload
    expect(summaryPayload.isSummary).toBe(true)
    // Wire contract that keeps an OLDER viewer safe (see the direction-2
    // test below for why each of these matters) -- asserted here too so a
    // regression in the sender is caught right where the payload is built.
    expect(summaryPayload.stopId).toBeUndefined()
    expect(summaryPayload.realIdx).toBeUndefined()
    expect(typeof summaryPayload.idx).toBe('number')

    cleanup() // unmount the presenter -- this test is about the VIEWER now

    // Viewer side: a DIFFERENT schedule than the presenter's (the
    // divergence 3.5b already guards against) -- deliberately with MORE
    // stops (4) than the presenter (2), so the presenter's raw numeric
    // `idx` (3) is NOT out of range for this viewer's own schedule (total
    // 6: intro + 4 stops + summary) -- naively applying it as a plain
    // display position would land this viewer on ITS OWN 3rd stop ("Viewer
    // Stop C"), a real, wrong, non-crashing slide, not a dead screen and
    // not the intro either. That's exactly why the summary needs its own
    // `isSummary` marker rather than leaning on the pre-existing
    // out-of-range clamp: here there's nothing out of range to clamp.
    const viewerEvt = {
      id: 'evt-sum-follow-1',
      name: 'Follow Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Viewer Stop A', day: 0, time: '08:00', secret: false },
        { activity: 'Viewer Stop B', day: 0, time: '09:00', secret: false },
        { activity: 'Viewer Stop C', day: 0, time: '10:00', secret: false },
        { activity: 'Viewer Stop D', day: 0, time: '11:00', secret: false },
      ],
    }
    render(<PresentationMode evt={viewerEvt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    const viewerChannel = fakeSupabase.channels[1]
    act(() => {
      viewerChannel._handlers['broadcast:slide']({ payload: summaryPayload })
    })
    advanceFade()

    expect(screen.getByText('📋 The Full Day')).toBeInTheDocument()
    expect(screen.getByText('Viewer Stop C', { exact: false })).toBeInTheDocument() // still appears -- it's one line in the summary's own list
    // The wrong, pre-fix outcome this test exists to catch: landing on
    // "Viewer Stop C"'s own dedicated slide (its per-stop badge) instead of
    // the summary.
    expect(screen.queryByText('4 / 6')).not.toBeInTheDocument()
    expect(screen.getByText('6 / 6')).toBeInTheDocument() // this viewer's OWN total: intro + 4 stops + summary
  })
})

describe('PresentationMode summary slide: backwards compatibility', () => {
  it('direction 1 -- an older presenter (no `isSummary` field ever sent) still drives a new-build viewer exactly as before, landing on the correct STOP', () => {
    const viewerEvt = {
      id: 'evt-sum-compat-1',
      name: 'Old Presenter Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Alpha', day: 0, time: '09:00', secret: false },
        { activity: 'Bravo', day: 0, time: '12:00', secret: false },
      ],
    }
    render(<PresentationMode evt={viewerEvt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    // Shape an old build (which has never heard of a summary slide) sends:
    // plain `idx`/`realIdx`, no `isSummary` key at all.
    act(() => {
      fakeSupabase.channels[0]._handlers['broadcast:slide']({ payload: { idx: 2, realIdx: 1, revealedSecrets: [] } })
    })
    advanceFade()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.queryByText('📋 The Full Day')).not.toBeInTheDocument()
  })

  it('direction 2 -- a new presenter\'s summary payload does not strand an older viewer on a dead screen or snap it to the intro', () => {
    // The exact payload shape the new sender produces for the summary (see
    // the outgoing-broadcast effect in App.jsx): `isSummary:true`,
    // `stopId`/`realIdx` both OMITTED (not `null` -- `null` is what the
    // intro sends, and an unmodified/older resolvePayloadRealIdx treats
    // `stopId===null` as "found, the intro" BEFORE it would ever look at
    // `idx`). `idx` is the new presenter's own total-1 (a real number).
    const newPresenterSummaryPayload = { idx: 3, isSummary: true, revealedSecrets: [], revealedStopIds: [] }

    // This is resolvePayloadRealIdx, byte-for-byte as it stands unmodified
    // in src/App.jsx today (this feature adds no changes to it at all --
    // the summary is special-cased BEFORE it's ever called). Reproduced
    // here, not imported, because it's a helper nested inside
    // PresentationMode's own closure, not a top-level export -- if you
    // touch the real one in App.jsx, update this copy or this test stops
    // proving what it says it proves.
    function resolvePayloadRealIdx(payload, stops, ord) {
      if (!payload) return { found: false }
      if (payload.stopId !== undefined && payload.stopId !== null) {
        const ri = stops.findIndex((s) => s.id === payload.stopId)
        if (ri !== -1) return { found: true, realIdx: ri }
      }
      if (payload.stopId === null) return { found: true, realIdx: null }
      if (payload.realIdx !== undefined) {
        if (payload.realIdx === null) return { found: true, realIdx: null }
        if (ord.includes(payload.realIdx)) return { found: true, realIdx: payload.realIdx }
      }
      return { found: false }
    }

    // An older viewer's own 1-stop schedule (old build: total = length+1).
    const oldStops = [{ id: 'only', activity: 'Only Stop' }]
    const oldOrder = [0]
    const oldTotal = oldStops.length + 1

    const r = resolvePayloadRealIdx(newPresenterSummaryPayload, oldStops, oldOrder)
    // The crux: NOT resolved as "found, realIdx:null" (which is what would
    // snap an older viewer to the intro) -- falls through to the legacy
    // idx fallback instead.
    expect(r.found).toBe(false)

    // Old build's own (also unmodified) resolveLiveIdx logic from here:
    // `ni = live.idx ?? 0`, then clamp into ITS OWN range.
    const ni = Math.max(0, Math.min(oldTotal - 1, newPresenterSummaryPayload.idx))
    expect(ni).toBe(oldTotal - 1) // lands on its own last valid slide (index 1: "Only Stop")
    expect(ni).not.toBe(0) // specifically, NOT the intro
  })
})
