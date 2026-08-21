// Solo-mode regression coverage for PresentationMode's third, additive mode
// (`isSolo`, added alongside `isPresenter`/viewer): any user can walk the
// event schedule presentation-style on their own, but MUST NEVER touch the
// live-presentation channel, write to the event, or reveal a secret stop.
// This mounts the actual, current PresentationMode component (source
// extraction, same technique as presentationModeOrder.test.jsx -- not a
// hand-copied reimplementation) and asserts those invariants directly, plus
// that the reveal control never renders in solo mode.
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
  const startIdx = sourceLines.findIndex((line) => {
    const t = line.trimStart()
    return t.startsWith(`const ${name}=`) || t.startsWith(`const ${name} =`)
  })
  if (startIdx === -1) {
    throw new Error(`presentationModeSolo.test.jsx: could not find "const ${name}=" (or "const ${name} =") in App.jsx.`)
  }
  const firstLine = sourceLines[startIdx]
  const trimmedFirst = firstLine.trim()
  if (trimmedFirst.endsWith(';')) return firstLine
  const closer = trimmedFirst.endsWith('{') ? '};' : trimmedFirst.endsWith('(') ? ');' : null
  if (!closer) {
    throw new Error(`presentationModeSolo.test.jsx: "const ${name}=" doesn't end in "{" or "(".`)
  }
  for (let i = startIdx + 1; i < sourceLines.length; i++) {
    if (sourceLines[i].trim() === closer) {
      return sourceLines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(`presentationModeSolo.test.jsx: no closing "${closer}" found for "const ${name}=".`)
}

// Same context-aware brace scanner as presentationModeOrder.test.jsx -- see
// that file for the full rationale (nested arrow closures + template-literal
// `${...}` braces both need real depth counting).
function extractBraceMatchedDecl(fullSource, name) {
  const declRe = new RegExp(`const ${name}=\\(([\\s\\S]*?)\\)=>\\{`)
  const m = declRe.exec(fullSource)
  if (!m) {
    throw new Error(`presentationModeSolo.test.jsx: could not find "const ${name}=(...)=>{" in App.jsx.`)
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
  throw new Error(`presentationModeSolo.test.jsx: brace matching for "const ${name}=" never returned to depth 0.`)
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
    'scheduleDayTimeOrder',
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

// Spy-wrapped fake supabase: `channel` is a vi.fn() so tests can assert it
// was NEVER called at all in solo mode -- not called-and-unused, not called.
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
    channel: vi.fn(() => makeFakeChannel()),
    removeChannel: vi.fn(),
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
  act(() => {
    vi.advanceTimersByTime(250)
  })
}

function makeEvt() {
  return {
    id: 'evt-solo-1',
    name: 'Solo Test Weekend',
    date: '2026-09-11',
    end_date: '2026-09-12',
    schedule: [
      { activity: 'Public Stop One', day: 0, time: '09:00', icon: '📍', secret: false },
      { activity: 'SECRET Stop Two', day: 0, time: '12:00', icon: '📍', secret: true },
      { activity: 'Public Stop Three', day: 0, time: '15:00', icon: '📍', secret: false },
    ],
  }
}

describe('PresentationMode solo mode', () => {
  it('never creates a channel at all — not created-and-unused, not created', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={() => {}} />)
    advanceFade()
    expect(fakeSupabase.channel).not.toHaveBeenCalled()
  })

  it('still never creates a channel after navigating through every slide', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={() => {}} />)
    for (let i = 0; i < 3; i++) {
      const nextBtn = screen.getByText('→')
      fireEvent.click(nextBtn)
      advanceFade()
    }
    expect(fakeSupabase.channel).not.toHaveBeenCalled()
  })

  it('never calls onUpdate, even while navigating past a secret stop', () => {
    const evt = makeEvt()
    const onUpdate = vi.fn()
    render(<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={false} isSolo={true} onClose={() => {}} />)
    for (let i = 0; i < 3; i++) {
      const nextBtn = screen.getByText('→')
      fireEvent.click(nextBtn)
      advanceFade()
    }
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('renders the secret stop as ??? (never the real activity), same as viewer mode', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={() => {}} />)
    // Slide 1 = intro. Slide 2 = display position 1 = the secret stop (day/time sorted, it's first among the two 09:00/12:00/15:00 stops after the public 09:00 one).
    fireEvent.click(screen.getByText('→')) // slide 1 -> Public Stop One
    advanceFade()
    expect(screen.getByText('Public Stop One')).toBeInTheDocument()
    fireEvent.click(screen.getByText('→')) // slide 2 -> SECRET Stop Two, hidden
    advanceFade()
    expect(screen.queryByText('SECRET Stop Two')).not.toBeInTheDocument()
    expect(screen.getByText('???')).toBeInTheDocument()
  })

  it('has no way to reveal the secret — the reveal control never renders', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('→'))
    advanceFade()
    fireEvent.click(screen.getByText('→')) // land on the secret stop's mystery slide
    advanceFade()
    expect(screen.queryByRole('button', { name: /Reveal to viewers/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hide from viewers/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/🔒 Secret/)).not.toBeInTheDocument()
    expect(screen.queryByText(/✓ Revealed/)).not.toBeInTheDocument()
  })

  it('supports free navigation like a presenter (Prev/Next both usable, dot nav clickable)', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('→'))
    advanceFade()
    expect(screen.getByText('Public Stop One')).toBeInTheDocument()
    expect(screen.getByText('←')).toBeInTheDocument() // Prev now visible, unlike a locked viewer
    fireEvent.click(screen.getByText('←'))
    advanceFade()
    // Back on the intro slide (stop text gone).
    expect(screen.queryByText('Public Stop One')).not.toBeInTheDocument()
  })

  it('does not show the LIVE badge (solo is not a synced viewer)', () => {
    const evt = makeEvt()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={() => {}} />)
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
  })

  it('Exit button (not Hide) closes solo mode via onClose', () => {
    const evt = makeEvt()
    const onClose = vi.fn()
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} isSolo={true} onClose={onClose} />)
    const exitBtn = screen.getByText('✕ Exit')
    fireEvent.click(exitBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
