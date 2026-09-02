// Regression coverage for the PresentationMode index-indirection introduced
// by per-day scheduling (QA priority area #1 -- the highest-risk change in
// that pass): PresentationMode now computes a display `order` (real
// schedule indices sorted by (day,time)) and maps slide position -> real
// index via `order[idx-1]`, while `revealedSecrets`, `toggleReveal`'s
// mutation, and the broadcast payload are all supposed to keep addressing
// stops by their *real* index in `evt.schedule`. A wrong mapping here would
// reveal the wrong secret to the whole group, or show the wrong stop on a
// given slide -- so this mounts the actual, current PresentationMode
// component (via a source extraction, same technique as
// extractComponentFromAppSource.js, not a hand-copied reimplementation) and
// drives it through real clicks.
//
// PresentationMode's own declaration -- and several of the consts it
// depends on (formatEventDateRange, eventDayCount, dateForEventDay,
// dayHeadingLabel, scheduleDayTimeOrder, useIsMobile) -- are written as
// `const NAME=(...)=>{` with *no* space before `=` in App.jsx's current
// formatting, which is the shape extractFromAppSource.js's matcher expects
// but NOT the shape extractComponentFromAppSource.js's matcher expects (it
// requires `const NAME = `, i.e. Card/Modal's formatting). Rather than
// loosen that shared helper (used by other test files) and risk changing
// its behavior for them, this file has its own small, self-contained
// extractor for exactly this one case.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const ESBUILD_PATH = path.join(__dirname, '..', '..', 'node_modules', 'esbuild')

function extractNoSpaceDecl(sourceLines, name) {
  // App.jsx's formatting is inconsistent between declarations (some are
  // `const NAME=`, some `const NAME =`) -- accept either.
  const startIdx = sourceLines.findIndex((line) => {
    const t = line.trimStart()
    return t.startsWith(`const ${name}=`) || t.startsWith(`const ${name} =`)
  })
  if (startIdx === -1) {
    throw new Error(`presentationModeOrder.test.jsx: could not find "const ${name}=" (or "const ${name} =") in App.jsx.`)
  }
  const firstLine = sourceLines[startIdx]
  const trimmedFirst = firstLine.trim()
  if (trimmedFirst.endsWith(';')) return firstLine
  const closer = trimmedFirst.endsWith('{') ? '};' : trimmedFirst.endsWith('(') ? ');' : null
  if (!closer) {
    throw new Error(`presentationModeOrder.test.jsx: "const ${name}=" doesn't end in "{" or "(".`)
  }
  for (let i = startIdx + 1; i < sourceLines.length; i++) {
    if (sourceLines[i].trim() === closer) {
      return sourceLines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(`presentationModeOrder.test.jsx: no closing "${closer}" found for "const ${name}=".`)
}

// PresentationMode's own body contains several *nested* arrow functions
// that themselves close with a lone `};` line (applySlide, the keydown
// handler, etc.), AND several template literals with `${...}` interpolation
// (e.g. `` `1px solid ${isRevealed?...}` ``) whose braces are real code
// braces that DO need counting -- so neither "first line that's exactly
// `};`" (too shallow) nor "count all `{`/`}` chars, skip quoted strings"
// (miscounts: apostrophes inside `//` comments like "viewers don't need..."
// desync naive quote-tracking, and template-literal braces need counting
// only inside `${...}`, not in the surrounding literal text) is enough.
// This is a small context-aware scanner: a stack of 'code' / 'template'
// frames, real brace-depth counting only in 'code' frames, `//` and
// `/* */` comments and `'...'`/`"..."` strings skipped verbatim, and
// `${...}` inside a template pushing a temporary 'code' frame so its
// braces count until the matching `}` (tracked via that frame's own
// captured depth, not the outer one) pops back to raw template text.
function extractBraceMatchedDecl(fullSource, name) {
  const declRe = new RegExp(`const ${name}=\\(([\\s\\S]*?)\\)=>\\{`)
  const m = declRe.exec(fullSource)
  if (!m) {
    throw new Error(`presentationModeOrder.test.jsx: could not find "const ${name}=(...)=>{" in App.jsx.`)
  }
  let i = m.index + m[0].length - 1 // index of the opening `{`
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
    // code context
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
  throw new Error(`presentationModeOrder.test.jsx: brace matching for "const ${name}=" never returned to depth 0.`)
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
    `${transformed}\nreturn PresentationMode;`,
  )
  return fn
}

// Minimal fake realtime channel: just enough of the supabase-js surface for
// PresentationMode's presenter branch (subscribe -> track; later track/send
// on every idx/reveal change). Synchronous so we don't need extra waitFor
// round-trips just to get past channel setup.
function makeFakeChannel() {
  const channel = {
    on: () => channel,
    subscribe: (cb) => {
      cb?.('SUBSCRIBED')
      return channel
    },
    track: vi.fn(),
    send: vi.fn(),
    untrack: vi.fn(),
    presenceState: () => ({}),
  }
  return channel
}

function makeFakeSupabase() {
  return {
    channel: () => makeFakeChannel(),
    removeChannel: () => {},
  }
}

let PresentationMode

beforeEach(() => {
  vi.useFakeTimers()
  PresentationMode = extractPresentationMode()(React, useState, useEffect, useRef, useCallback, makeFakeSupabase())
})

afterEach(() => {
  vi.useRealTimers()
})

// `goTo` fades out, setTimeouts 230ms, then sets idx and fades back in --
// advance past that under fake timers and let React flush.
function advanceFade() {
  act(() => {
    vi.advanceTimersByTime(250)
  })
}

// Four stops deliberately NOT in (day,time) order in the underlying array,
// spanning two days, with a secret stop in the middle of the pack -- this
// is the shape most likely to expose an off-by-one or day/time inversion in
// the order/stopIdx mapping. Each stop carries its own explicit `id` --
// PresentationMode backfills one for a stop that doesn't have one and (as
// presenter) persists it via `onUpdate`, which these tests aren't wired to
// feed back into a re-render, so giving every stop a real id up front keeps
// that backfill a no-op and this file's onUpdate-call-count assertions
// about exactly what a real user action (the reveal click) does.
function makeEvt() {
  return {
    id: 'evt-order-1',
    name: 'Order Test Weekend',
    date: '2026-09-11',
    end_date: '2026-09-12',
    schedule: [
      { id: 'real0', activity: 'A1-real0', day: 1, time: '09:00', icon: '📍', secret: false }, // real idx 0
      { id: 'real1', activity: 'B0late-real1', day: 0, time: '20:00', icon: '📍', secret: false }, // real idx 1
      { id: 'real2', activity: 'C0early-real2-SECRET', day: 0, time: '09:00', icon: '📍', secret: true }, // real idx 2
      { id: 'real3', activity: 'D1early-real3', day: 1, time: '08:00', icon: '📍', secret: false }, // real idx 3
    ],
  }
}
// Expected display order (day asc, then time asc): C0early(2), B0late(1), D1early(3), A1(0)
const EXPECTED_DISPLAY_ORDER = [2, 1, 3, 0]
const EXPECTED_ACTIVITIES = ['C0early-real2-SECRET', 'B0late-real1', 'D1early-real3', 'A1-real0']

describe('PresentationMode index indirection (day/time display order vs real schedule index)', () => {
  it('slide 0 is the intro, unaffected by ordering', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    expect(screen.getAllByText('Order Test Weekend').length).toBeGreaterThan(0)
    // Intro shows a stop-count summary, not a specific stop's activity.
    for (const activity of EXPECTED_ACTIVITIES) {
      expect(screen.queryByText(activity)).not.toBeInTheDocument()
    }
  })

  it('shows each slide\'s stop in real (day,time) order, as presenter, including around a secret stop', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)

    // Dot nav: index 0 = intro, indices 1..4 = the four stops in display
    // order. Click each dot directly (presenter dots are clickable) and
    // assert the exact activity text shown.
    for (let slidePos = 1; slidePos <= 4; slidePos++) {
      const dots = document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
      fireEvent.click(dots[slidePos])
      advanceFade()
      const expectedActivity = EXPECTED_ACTIVITIES[slidePos - 1]
      expect(screen.getByText(expectedActivity)).toBeInTheDocument()
      // "Stop N / 4" badge uses the *slide* position, not the real index.
      expect(screen.getByText(`Stop ${slidePos} / 4`)).toBeInTheDocument()
    }
  })

  it('toggleReveal on the secret stop (shown at slide 1) flips secret on real index 2 ONLY, never a neighbour', () => {
    const evt = makeEvt()
    const onUpdate = vi.fn()
    render(<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={true} onClose={() => {}} />)

    const dots = document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    fireEvent.click(dots[1]) // slide 1 = display order[0] = real index 2, the secret stop
    advanceFade()
    expect(screen.getByText('C0early-real2-SECRET')).toBeInTheDocument()

    const revealBtn = screen.getByRole('button', { name: /Reveal to viewers/i })
    fireEvent.click(revealBtn)

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const updatedSchedule = onUpdate.mock.calls[0][0].schedule
    expect(updatedSchedule[2].secret).toBe(false) // real index 2 flipped
    // every OTHER stop's secret flag is untouched
    expect(updatedSchedule[0].secret).toBe(evt.schedule[0].secret)
    expect(updatedSchedule[1].secret).toBe(evt.schedule[1].secret)
    expect(updatedSchedule[3].secret).toBe(evt.schedule[3].secret)
    // activity/day/time on every stop preserved (no accidental reshuffle)
    updatedSchedule.forEach((s, i) => {
      expect(s.activity).toBe(evt.schedule[i].activity)
      expect(s.day).toBe(evt.schedule[i].day)
      expect(s.time).toBe(evt.schedule[i].time)
    })
  })

  it('dot colours line up with the real stop actually on screen (secret=red until revealed, then green)', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)

    const dots = document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    // Display position 1 (dots[1]) is the secret stop (real idx 2) -- its
    // dot must render as the "secret, not revealed" colour BEFORE reveal,
    // while every other dot is the plain "not secret" colour.
    dots.forEach((dot, i) => {
      if (i === 0) return // intro dot, not part of this assertion
      const isSecretDisplaySlot = i === 1 // display order[0] === real idx 2, the only secret
      if (isSecretDisplaySlot) {
        expect(dot.style.background).toBe('rgba(224, 85, 85, 0.5)')
      } else {
        expect(dot.style.background).not.toBe('rgba(224, 85, 85, 0.5)')
        expect(dot.style.background).not.toBe('rgba(76, 175, 125, 0.6)')
      }
    })
  })

  // Was "last slide (slide 4 of 4) ... Next button is hidden" before the
  // trailing summary slide existed (2026-09-02): the last STOP is no longer
  // the last SLIDE (the summary follows it), so Next must now stay visible
  // here -- reaching the true last slide, and Next disappearing there
  // instead, is covered by the dedicated summary-slide tests below.
  it('the last stop (slide 4 of 4 stops) is followed by the summary -- Next stays visible there, Prev too', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    const dots = document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    fireEvent.click(dots[4])
    advanceFade()
    expect(screen.getByText(EXPECTED_ACTIVITIES[3])).toBeInTheDocument()
    expect(screen.getByText('→')).toBeInTheDocument()
    expect(screen.getByText('←')).toBeInTheDocument()
  })

  it('the summary slide (dot 5, after all 4 stops) is the true last slide: Next hidden, Prev present', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    const dots = document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    expect(dots.length).toBe(6) // intro + 4 stops + summary
    fireEvent.click(dots[5])
    advanceFade()
    expect(screen.getByText('📋 The Full Day')).toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
    expect(screen.getByText('←')).toBeInTheDocument()
  })

  it('sequential Next-clicking from intro visits stops in the same (day,time) order as the dot jumps', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    for (let i = 0; i < 4; i++) {
      const nextBtn = screen.getByText('→')
      fireEvent.click(nextBtn)
      advanceFade()
      expect(screen.getByText(EXPECTED_ACTIVITIES[i])).toBeInTheDocument()
    }
  })
})
