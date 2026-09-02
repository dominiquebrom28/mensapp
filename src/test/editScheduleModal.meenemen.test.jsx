// Integration coverage for EditScheduleModal's "meenemen" (packing list)
// editor -- the owner was explicit this must be ONE event-level list, never
// attached to individual stops:
//   "No just let me make a list for them to bring to the whole thing."
// This mounts the REAL EditScheduleModal (extracted from App.jsx's current
// source text, same "no space before =" + esbuild-subprocess technique
// modalBackdrop.editVsCreate.test.jsx uses for EditProfileModal/WinnerForm/
// HighlightForm/AnnouncementModal -- EditScheduleModal.wiring.test.js
// explains why a full mount, rather than source-regex assertions, is worth
// it specifically for the meenemen editor's round-trip behaviour), wired to
// the real Card/Modal/H/Lbl/Inp/Btn via extractComponentFromAppSource.js and
// the real blankStop/makeStopId/ICONS/eventDayCount/dayHeadingLabel via
// extractFromAppSource.js -- so a regression to the actual save shape fails
// this test, not a hand-copied reimplementation.
import React, { useState, useRef, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'
import { extractFromApp } from './extractFromAppSource.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

// Same narrow extractor EditScheduleModal.wiring.test.js and
// modalBackdrop.editVsCreate.test.jsx both use for `const NAME=` (no space)
// declarations that close with a column-0 `\n};`.
function extractNoSpaceComponent(name) {
  const marker = `const ${name}=`
  const start = source.indexOf(marker)
  expect(start, `"${marker}" not found in App.jsx`).toBeGreaterThan(-1)
  const end = source.indexOf('\n};', start)
  expect(end, `closing "};" for ${name} not found`).toBeGreaterThan(start)
  return source.slice(start, end + 3)
}

// Single-line `const NAME=...;` module-scope declarations (blankStop,
// makeStopId, ICONS) -- simpler than the block extractors since the whole
// thing is on one line.
function extractOneLiner(name) {
  const marker = `const ${name}=`
  const lines = source.split('\n')
  const line = lines.find((l) => l.trim().startsWith(marker))
  expect(line, `"${marker}" not found as a one-line declaration in App.jsx`).toBeTruthy()
  return line.trim()
}

function transformJsxInSubprocess(src) {
  const script = `
    const esbuild = require(${JSON.stringify(path.join(__dirname, '..', '..', 'node_modules', 'esbuild'))});
    const out = esbuild.transformSync(process.argv[1], {
      loader: 'jsx', jsx: 'transform',
      jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
    });
    process.stdout.write(out.code);
  `
  return execFileSync(process.execPath, ['-e', script, src], { encoding: 'utf-8' })
}

// Real Card/Modal/H/Lbl/Inp/Btn -- the actual design-system primitives, not
// stand-ins, since this file's whole point is the real save wiring.
const Modal = extractComponentFromApp({ React, useRef, useEffect }, 'Card', 'Modal')
const H = extractComponentFromApp({ React }, 'H')
const Lbl = extractComponentFromApp({ React }, 'Lbl')
const Inp = extractComponentFromApp({ React }, 'Inp')
const Btn = extractComponentFromApp({ React, useRef, useEffect }, 'Btn')

// Real module-scope helpers EditScheduleModal closes over.
const ICONS = extractFromApp('ICONS')
const eventDayCount = extractFromApp('eventDayCount')
const dayHeadingLabel = extractFromApp('dateForEventDay', 'dayHeadingLabel')
const blankStopLine = extractOneLiner('blankStop')
const makeStopIdLine = extractOneLiner('makeStopId')
const { blankStop, makeStopId } = new Function(`${blankStopLine}\n${makeStopIdLine}\nreturn {blankStop,makeStopId};`)()

const EditScheduleModalRaw = extractNoSpaceComponent('EditScheduleModal')
const editScheduleModalTransformed = transformJsxInSubprocess(EditScheduleModalRaw)
const EditScheduleModal = new Function(
  'React', 'useState', 'Modal', 'H', 'Lbl', 'Inp', 'Btn', 'ICONS', 'blankStop', 'makeStopId', 'eventDayCount', 'dayHeadingLabel',
  `${editScheduleModalTransformed}\nreturn EditScheduleModal;`,
)(React, useState, Modal, H, Lbl, Inp, Btn, ICONS, blankStop, makeStopId, eventDayCount, dayHeadingLabel)

const baseEvt = { date: '2026-09-12', end_date: '', schedule: [] }

describe('EditScheduleModal -- meenemen (packing list) editor', () => {
  it('renders an existing event-level bring list, pre-populated (not derived from any stop)', () => {
    render(<EditScheduleModal evt={{ ...baseEvt, bring: ['Regenjas', 'Zonnebrand'] }} onSave={() => {}} onClose={() => {}} />)
    expect(screen.getByDisplayValue('Regenjas')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Zonnebrand')).toBeInTheDocument()
  })

  it('an event with no bring list yet starts empty, with an "add item" affordance', () => {
    render(<EditScheduleModal evt={baseEvt} onSave={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Nog niets op de lijst.')).toBeInTheDocument()
    expect(screen.getByText('+ Item toevoegen')).toBeInTheDocument()
  })

  it('adding an item and saving round-trips it through onSave as {schedule, bring}, independent of the schedule stops', () => {
    const onSave = vi.fn()
    render(<EditScheduleModal evt={{ ...baseEvt, bring: ['Regenjas'] }} onSave={onSave} onClose={() => {}} />)

    fireEvent.click(screen.getByText('+ Item toevoegen'))
    const newField = screen.getAllByRole('textbox').find((el) => el.value === '')
    fireEvent.change(newField, { target: { value: 'Zonnebrand' } })

    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledTimes(1)
    const arg = onSave.mock.calls[0][0]
    expect(arg.bring).toEqual(['Regenjas', 'Zonnebrand'])
    // Never attached to a stop -- schedule is untouched, still [].
    expect(arg.schedule).toEqual([])
  })

  it('removing an item drops it from the saved list', () => {
    const onSave = vi.fn()
    render(<EditScheduleModal evt={{ ...baseEvt, bring: ['Regenjas', 'Zonnebrand'] }} onSave={onSave} onClose={() => {}} />)

    // Each bring row's ✕ button -- find the one next to "Zonnebrand".
    const zonnebrandField = screen.getByDisplayValue('Zonnebrand')
    const row = zonnebrandField.closest('div')
    fireEvent.click(within(row).getByText('✕'))

    fireEvent.click(screen.getByText('Save'))

    expect(onSave.mock.calls[0][0].bring).toEqual(['Regenjas'])
  })

  it('a blank item left empty is dropped on save, not persisted as an empty string', () => {
    const onSave = vi.fn()
    render(<EditScheduleModal evt={{ ...baseEvt, bring: ['Regenjas'] }} onSave={onSave} onClose={() => {}} />)

    fireEvent.click(screen.getByText('+ Item toevoegen'))
    // Never typed into -- left blank.

    fireEvent.click(screen.getByText('Save'))

    expect(onSave.mock.calls[0][0].bring).toEqual(['Regenjas'])
  })

  describe('backdrop click', () => {
    // Modal has a 350ms grace period before it honours a backdrop click
    // (suppresses accidental closes right after opening) -- same pattern
    // modalBackdrop.editVsCreate.test.jsx uses to get past it.
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('saves both the in-progress schedule AND the meenemen list together (same save, not two)', () => {
      const onSave = vi.fn()
      const { container } = render(<EditScheduleModal evt={{ ...baseEvt, bring: ['Regenjas'] }} onSave={onSave} onClose={() => {}} />)

      fireEvent.click(screen.getByText('+ Add Stop'))
      fireEvent.change(screen.getByPlaceholderText('Activity'), { target: { value: 'Lunch' } })

      vi.advanceTimersByTime(350)
      fireEvent.click(container.querySelector('.ov'))

      expect(onSave).toHaveBeenCalledTimes(1)
      const arg = onSave.mock.calls[0][0]
      expect(arg.bring).toEqual(['Regenjas'])
      expect(arg.schedule).toHaveLength(1)
      expect(arg.schedule[0].activity).toBe('Lunch')
    })
  })
})
