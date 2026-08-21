// QA repro (2026-08-21 event-side re-verification pass), now a regression
// guard: does the slide-identity machinery survive a schedule edit that
// lands WHILE a presentation is live -- the exact composition the owner's
// audit brief called out ("the schedule editor now saves on backdrop
// click, and a schedule change during a live presentation is exactly the
// divergence the realIdx work was meant to survive -- do they actually
// compose?").
//
// Originally: no. `realIdx` identified a stop by its ARRAY INDEX, not by
// any stable identity (schedule stops had no `id` field -- see `blankStop`
// in App.jsx). The "survive a divergent slide" mechanism (order[],
// resolveLiveIdx, applySlide's realIdx resolution) was built to survive a
// schedule that's ADDED TO or SHRUNK -- it clamps out-of-range indices and
// re-resolves an out-of-range realIdx to the nearest valid slide -- but NOT
// a REORDER: same array length, same real indices, but the (day,time) sort
// producing `order[]` changes -- e.g. an editor retiming a stop, or using
// the schedule editor's own up/down "move within day" control (`moveInDay`,
// App.jsx), both real, common, backdrop-click-saved edits. `idx` (a display
// POSITION) stayed put across the re-render, but `order[idx-1]` resolved to
// a DIFFERENT real stop, because the sort order shifted -- the presenter's
// own screen would silently swap to a different stop's content with no
// navigation action, and the next idx-driven broadcast would send that
// wrong stop's realIdx to the room as if the presenter had chosen it.
//
// Fixed: every stop now carries a stable `id` (backfilled for legacy data,
// persisted by the presenter), and PresentationMode pins its displayed
// slide to that id rather than to a raw array position -- when the running
// order reshuffles under it, `idx` (and the outgoing broadcast) are
// silently corrected to keep pointing at the SAME stop instead of drifting
// to whatever now sorts into that slide number. This file now guards that
// fix rather than documenting the bug.
//
// Uses the same source-extraction technique as
// presentationModeRobustness.test.jsx / presentationModeOrder.test.jsx
// (mounts the real, current PresentationMode, not a hand-copied
// reimplementation).
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', '..', 'App.jsx')
const ESBUILD_PATH = path.join(__dirname, '..', '..', '..', 'node_modules', 'esbuild')

function extractNoSpaceDecl(sourceLines, name) {
  const startIdx = sourceLines.findIndex((line) => {
    const t = line.trimStart()
    return t.startsWith(`const ${name}=`) || t.startsWith(`const ${name} =`)
  })
  if (startIdx === -1) throw new Error(`could not find "const ${name}=" in App.jsx.`)
  const firstLine = sourceLines[startIdx]
  const trimmedFirst = firstLine.trim()
  if (trimmedFirst.endsWith(';')) return firstLine
  const closer = trimmedFirst.endsWith('{') ? '};' : trimmedFirst.endsWith('(') ? ');' : null
  if (!closer) throw new Error(`"const ${name}=" doesn't end in "{" or "(".`)
  for (let i = startIdx + 1; i < sourceLines.length; i++) {
    if (sourceLines[i].trim() === closer) return sourceLines.slice(startIdx, i + 1).join('\n')
  }
  throw new Error(`no closing "${closer}" found for "const ${name}=".`)
}

function extractBraceMatchedDecl(fullSource, name) {
  const declRe = new RegExp(`const ${name}=\\(([\\s\\S]*?)\\)=>\\{`)
  const m = declRe.exec(fullSource)
  if (!m) throw new Error(`could not find "const ${name}=(...)=>{" in App.jsx.`)
  let i = m.index + m[0].length - 1
  const end = fullSource.length
  let depth = 0
  const frames = [{ type: 'code' }]
  while (i < end) {
    const top = frames[frames.length - 1]
    if (top.type === 'template') {
      const c = fullSource[i]
      if (c === '\\') { i += 2; continue }
      if (c === '`') { frames.pop(); i++; continue }
      if (c === '$' && fullSource[i + 1] === '{') { depth++; frames.push({ type: 'code-from-template', matchDepth: depth }); i += 2; continue }
      i++
      continue
    }
    const c = fullSource[i]
    const c2 = c + (fullSource[i + 1] || '')
    if (c2 === '//') { const nl = fullSource.indexOf('\n', i); i = nl === -1 ? end : nl + 1; continue }
    if (c2 === '/*') { const close = fullSource.indexOf('*/', i + 2); i = close === -1 ? end : close + 2; continue }
    if (c === "'" || c === '"') {
      const quote = c
      i++
      while (i < end) {
        if (fullSource[i] === '\\') { i += 2; continue }
        if (fullSource[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (c === '`') { frames.push({ type: 'template' }); i++; continue }
    if (c === '{') { depth++; i++; continue }
    if (c === '}') {
      depth--
      i++
      const cur = frames[frames.length - 1]
      if (cur.type === 'code-from-template' && depth === cur.matchDepth - 1) { frames.pop(); continue }
      if (depth === 0 && frames.length === 1) return fullSource.slice(m.index, i) + ';'
      continue
    }
    i++
  }
  throw new Error(`brace matching for "const ${name}=" never returned to depth 0.`)
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
    'useIsMobile',
  ]
  const raw =
    flatNames.map((n) => extractNoSpaceDecl(lines, n)).join('\n') +
    '\n' +
    extractBraceMatchedDecl(fullSource, 'PresentationMode')
  const transformed = transformJsxInSubprocess(raw)
  const fn = new Function(
    'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'supabase',
    `${transformed}\nreturn PresentationMode;`,
  )
  return fn
}

function makeFakeChannel() {
  const handlers = {}
  const channel = {
    on: (type, opts, cb) => { handlers[`${type}:${opts.event}`] = cb; return channel },
    subscribe: (cb) => { cb?.('SUBSCRIBED'); return channel },
    track: vi.fn(),
    send: vi.fn(),
    untrack: vi.fn(),
    presenceState: () => ({}),
    _handlers: handlers,
  }
  return channel
}

function makeFakeSupabase() {
  let lastChannel = null
  return {
    channel: () => { lastChannel = makeFakeChannel(); return lastChannel },
    removeChannel: () => {},
    get lastChannel() { return lastChannel },
  }
}

let PresentationMode
let fakeSupabase

beforeEach(() => {
  vi.useFakeTimers()
  fakeSupabase = makeFakeSupabase()
  PresentationMode = extractPresentationMode()(React, useState, useEffect, useRef, useCallback, fakeSupabase)
})

afterEach(() => {
  vi.useRealTimers()
})

function advanceFade() {
  act(() => { vi.advanceTimersByTime(250) })
}

describe('PresentationMode live composition: schedule edit landing mid-presentation (reorder, not add/remove)', () => {
  it('PRESENTER: retiming a same-day stop (moveInDay-equivalent) while parked on a slide keeps showing the SAME stop (self-heals `idx`) and re-broadcasts the correction, with no navigation needed', () => {
    const evt = {
      id: 'evt-reorder-1',
      name: 'Reorder Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'StopA', day: 0, time: '09:00', secret: false },
        { activity: 'StopB', day: 0, time: '10:00', secret: false },
      ],
    }
    const { rerender } = render(
      <PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />
    )
    // Presenter navigates to slide 2 -- display order is [A,B], so slide 1
    // (first click from the intro) is StopA, slide 2 (second click) is StopB.
    fireEvent.click(screen.getByText('→'))
    advanceFade()
    fireEvent.click(screen.getByText('→'))
    advanceFade()
    expect(screen.getByText('StopB')).toBeInTheDocument()

    // Confirm what got broadcast for that navigation: realIdx should point at StopB (array index 1).
    const sendCallsBefore = fakeSupabase.lastChannel.send.mock.calls.length
    const lastPayloadBefore = fakeSupabase.lastChannel.send.mock.calls[sendCallsBefore - 1][0].payload
    expect(lastPayloadBefore.realIdx).toBe(1) // StopB

    // Now: an admin (could be this same presenter, in the schedule editor,
    // or a different device) retimes StopB to be EARLIER than StopA and
    // backdrop-click-saves -- a schedule change landing mid-presentation,
    // propagated to this component purely via a fresh `evt` prop (exactly
    // how EventPage's own postgres_changes subscription feeds a live
    // update into `evt`). Array order/length is UNCHANGED -- only `time`.
    const retimed = {
      ...evt,
      schedule: [
        { activity: 'StopA', day: 0, time: '09:00', secret: false },
        { activity: 'StopB', day: 0, time: '08:00', secret: false }, // now sorts BEFORE StopA
      ],
    }
    rerender(<PresentationMode evt={retimed} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)

    // The presenter did not click anything, and the running order flipped
    // to [B,A] under them -- but content stays pinned to the SAME stop
    // (StopB) they were actually looking at, not whatever now sorts into
    // slide position 2.
    expect(screen.getByText('StopB')).toBeInTheDocument()
    expect(screen.queryByText('StopA')).not.toBeInTheDocument()
    // The slide *number* is allowed to (and does) change -- StopB is now
    // display position 1, not 2 -- since it honestly reflects where the
    // pinned stop actually sits in the new running order.
    expect(screen.getByText('Stop 1 / 2')).toBeInTheDocument()

    // The self-heal re-fires the idx-driven broadcast effect, so the room
    // converges without the presenter needing to click anything: a NEW
    // broadcast goes out, still correctly identifying StopB (real index 1)
    // -- the room is never left holding stale content.
    const sendCallsAfter = fakeSupabase.lastChannel.send.mock.calls.length
    expect(sendCallsAfter).toBeGreaterThan(sendCallsBefore)
    const lastPayloadAfter = fakeSupabase.lastChannel.send.mock.calls.at(-1)[0].payload
    expect(lastPayloadAfter.realIdx).toBe(1) // still StopB, by real array index
    expect(lastPayloadAfter.idx).toBe(1) // its corrected slide position
  })
})
