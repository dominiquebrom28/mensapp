// QA repro (2026-08-21 event-side re-verification pass): does the
// `realIdx`/`order` machinery actually survive a schedule edit that lands
// WHILE a presentation is live -- the exact composition the owner's audit
// brief called out ("the schedule editor now saves on backdrop click, and
// a schedule change during a live presentation is exactly the divergence
// the realIdx work was meant to survive -- do they actually compose?").
//
// Finding: `realIdx` identifies a stop by its ARRAY INDEX, not by any
// stable identity (schedule stops have no `id` field -- see `blankStop` in
// App.jsx). The whole "survive a divergent slide" mechanism (order[],
// resolveLiveIdx, applySlide's realIdx resolution) is built to survive a
// schedule that's ADDED TO or SHRUNK -- it clamps out-of-range indices and
// re-resolves an out-of-range realIdx to the nearest valid slide. It is
// NOT built to survive a REORDER: same array length, same real indices,
// but the (day,time) sort producing `order[]` changes -- e.g. an editor
// retiming a stop, or using the schedule editor's own up/down
// "move within day" control (`moveInDay`, App.jsx), both real, common,
// backdrop-click-saved edits.
//
// When that happens mid-presentation, `idx` (a display POSITION, e.g.
// "slide 2") stays put across the re-render, but `order[idx-1]` now
// resolves to a DIFFERENT real stop, because the sort order shifted. The
// presenter's own screen silently swaps to a different stop's content --
// with no navigation action, no error, no "catching up" indicator (that
// only covers still-out-of-range indices, not a same-range remap) -- and
// the very next idx-driven effect broadcasts THAT wrong stop's realIdx to
// every viewer as if the presenter had chosen it.
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
  it('PRESENTER: retiming a same-day stop (moveInDay-equivalent) while parked on a slide silently swaps the displayed AND broadcast stop, with no navigation and no indicator', () => {
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

    // The presenter did not click anything. `idx` (slide position 2) is
    // unchanged. But display order is now [B,A], so slide 2 now resolves
    // to StopA -- a silent content swap the presenter never asked for.
    expect(screen.getByText('StopA')).toBeInTheDocument()
    expect(screen.queryByText('StopB')).not.toBeInTheDocument()

    // Sharper finding: the outgoing-broadcast effect's deps are
    // `[idx,isPresenter]`, NOT `evt` -- so it does NOT re-fire just because
    // the schedule (and therefore what realIdx=1 under the old order vs.
    // the new order means) changed. No new broadcast is sent at all. Every
    // viewer currently following this presenter is now looking at STALE
    // content (StopB, from the last broadcast) while the presenter's own
    // screen has already silently moved to StopA -- room and presenter
    // disagree on what's on screen, with no error and no indicator either
    // side, until the presenter's NEXT navigation (which re-fires the
    // effect and would broadcast whatever the reorder happens to resolve
    // `idx` to at that point -- see the sibling reorder test for that half).
    const sendCallsAfter = fakeSupabase.lastChannel.send.mock.calls.length
    expect(sendCallsAfter).toBe(sendCallsBefore) // no re-broadcast on the reorder itself
    expect(lastPayloadBefore.realIdx).toBe(1) // viewers are still holding StopB's realIdx
  })
})
