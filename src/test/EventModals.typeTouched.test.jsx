// QA verification: the `typeTouched` auto-suggest wiring in NewEventModal
// (src/App.jsx:5154) and EditEventModal (src/App.jsx:5123). Renders the
// REAL, current EditEventModal/NewEventModal source (via a targeted
// extraction, same idea as extractComponentFromAppSource.js), with only
// the visually-heavy RichTextInput/AttendeeInput children stubbed out --
// they're irrelevant to typeTouched and not extractable by the existing
// helper (Btn/RichTextInput/AttendeeInput bodies contain their own
// top-level-looking "};" lines that would truncate a generic line-based
// extraction early; EditEventModal/NewEventModal themselves are declared
// as `const NAME=(...)=>{` with no space before `=`, which
// extractComponentFromAppSource.js's matcher also doesn't recognize --
// so this file does its own narrow, documented extraction rather than
// stretching the shared utility past what it was built for).
import React, { useState, useRef, useEffect } from 'react'
import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

function extractNoSpaceComponent(name) {
  const marker = `const ${name}=`
  const start = source.indexOf(marker)
  expect(start, `"${marker}" not found in App.jsx`).toBeGreaterThan(-1)
  // Column-0 closer only (mirrors EditScheduleModal.wiring.test.js's
  // approach) -- inner block-scoped consts like `setEndDate` close on an
  // indented "  };" line, which does NOT match "\n};", so this can't
  // truncate early the way a naive per-line `.trim() === '};'` scan could.
  const end = source.indexOf('\n};', start)
  expect(end, `closing "};" for ${name} not found`).toBeGreaterThan(start)
  return source.slice(start, end + 3)
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

// Real Card/Modal/H/Lbl/Inp (all use "const NAME = " with a space, and none
// of their bodies contain a false-positive column-0-equivalent inner
// closer -- verified by reading the source during this QA pass).
const { Card, Modal, H, Lbl, Inp } = (() => {
  const Card = extractComponentFromApp({ React }, 'Card')
  const Modal = extractComponentFromApp({ React, useRef, useEffect }, 'Card', 'Modal')
  const H = extractComponentFromApp({ React }, 'H')
  const Lbl = extractComponentFromApp({ React }, 'Lbl')
  const Inp = extractComponentFromApp({ React }, 'Inp')
  return { Card, Modal, H, Lbl, Inp }
})()

// Stubs: irrelevant to typeTouched, and not worth chaining their real
// (larger, icon-picker-bearing) source into this test.
const RichTextInput = () => null
const AttendeeInput = () => null
const Btn = ({ children, onClick, ...rest }) => (
  <button onClick={onClick} {...rest}>
    {children}
  </button>
)

function buildModal(name) {
  const raw = extractNoSpaceComponent(name)
  const transformed = transformJsxInSubprocess(raw)
  const fn = new Function(
    'React',
    'useState',
    'useRef',
    'Modal',
    'H',
    'Lbl',
    'Inp',
    'Btn',
    'RichTextInput',
    'AttendeeInput',
    `${transformed}\nreturn ${name};`,
  )
  return fn(React, useState, useRef, Modal, H, Lbl, Inp, Btn, RichTextInput, AttendeeInput)
}

const EditEventModal = buildModal('EditEventModal')
const NewEventModal = buildModal('NewEventModal')

function getTypeSelect(container) {
  return container.querySelector('select')
}
function getDateInputs(container) {
  // Order in the JSX: Startdatum, Starttijd, Einddatum, Eindtijd
  const inputs = container.querySelectorAll('input[type="date"], input[type="time"]')
  return { startDate: inputs[0], startTime: inputs[1], endDate: inputs[2], endTime: inputs[3] }
}

describe('NewEventModal typeTouched auto-suggest', () => {
  it('auto-suggests "weekend" when an end_date different from the start date is set, without the admin touching Type', () => {
    const { container } = render(<NewEventModal onSave={() => {}} onClose={() => {}} />)
    const { endDate } = getDateInputs(container)
    expect(getTypeSelect(container).value).toBe('day') // default

    fireEvent.change(endDate, { target: { value: '2026-09-14' } })

    expect(getTypeSelect(container).value).toBe('weekend')
  })

  it('does NOT clobber a deliberate admin choice: Type set to "day" first, then end_date changed, stays "day"', () => {
    const { container } = render(<NewEventModal onSave={() => {}} onClose={() => {}} />)
    const select = getTypeSelect(container)
    const { endDate } = getDateInputs(container)

    // Admin deliberately touches Type first (even setting it to its
    // current value still counts as "touched" -- matches real select
    // onChange semantics: any change event fires typeTouched.current=true).
    fireEvent.change(select, { target: { value: 'day' } })
    fireEvent.change(endDate, { target: { value: '2026-09-14' } })

    expect(select.value).toBe('day')
  })

  it('re-touching Type back to "weekend" manually is respected too (not fighting the admin either direction)', () => {
    const { container } = render(<NewEventModal onSave={() => {}} onClose={() => {}} />)
    const select = getTypeSelect(container)
    const { endDate } = getDateInputs(container)

    fireEvent.change(endDate, { target: { value: '2026-09-14' } }) // auto -> weekend
    fireEvent.change(select, { target: { value: 'day' } }) // admin overrides back to day
    fireEvent.change(endDate, { target: { value: '2026-09-15' } }) // further end_date edit

    expect(select.value).toBe('day') // must stay "day" -- the admin's later choice wins
  })
})

describe('EditEventModal typeTouched auto-suggest: re-open no longer resets the "touched" guard for events that already had a range (fixed in App.jsx:5133)', () => {
  it('REGRESSION GUARD: reopening the modal on an event that already deliberately has type="day" with an existing multi-day range, then editing end_date again, keeps type="day"', () => {
    // Simulates a previously-saved event where an admin had type="day"
    // alongside a real end_date range (e.g. they manually corrected the
    // auto-suggested "weekend" back to "day" in an earlier session, and
    // that was persisted). Fix: `typeTouched` is now seeded from
    // `!!evt.end_date` (App.jsx:5133) -- since this event already arrives
    // with an end_date, its saved `type` is by construction deliberate, so
    // the fresh useRef on this mount starts `true` and re-editing end_date
    // this session must not silently overwrite it.
    const evt = {
      id: 'evt-1',
      name: 'Odd one',
      type: 'day', // deliberately NOT "weekend", despite already spanning days
      date: '2026-09-11',
      end_date: '2026-09-13',
      start_time: '12:00',
      end_time: '18:00',
      attendees: [],
    }
    const { container } = render(<EditEventModal evt={evt} onSave={() => {}} onClose={() => {}} users={[]} />)
    const select = getTypeSelect(container)
    const { endDate } = getDateInputs(container)

    expect(select.value).toBe('day') // starts correctly as the saved value

    // Admin only extends the range by a day -- does not touch Type at all.
    fireEvent.change(endDate, { target: { value: '2026-09-14' } })

    expect(select.value).toBe('day') // must NOT have been clobbered back to "weekend"
  })

  it('does not touch Type at all when end_date is left unchanged on reopen', () => {
    const evt = {
      id: 'evt-2',
      name: 'Normal weekend',
      type: 'weekend',
      date: '2026-09-11',
      end_date: '2026-09-13',
      start_time: '12:00',
      end_time: '18:00',
      attendees: [],
    }
    const { container } = render(<EditEventModal evt={evt} onSave={() => {}} onClose={() => {}} users={[]} />)
    const select = getTypeSelect(container)
    const locationInput = container.querySelector('input[placeholder="Locatie"]')
    expect(locationInput).toBeTruthy()
    fireEvent.change(locationInput, { target: { value: 'Somewhere' } })
    expect(select.value).toBe('weekend')
  })

  // INDEPENDENT VERIFICATION of the "other direction" the coordinator
  // specifically flagged as plausibly broken by the new seeding: an
  // EXISTING event that does NOT yet have an end_date (the common case --
  // any single-day event being edited for the first time to become a
  // range) must still get the auto-suggest the first time one is added.
  // `typeTouched=useRef(!!evt.end_date)` seeds `false` here because
  // `evt.end_date` is falsy, so this must behave exactly like the
  // NewEventModal case.
  it('INDEPENDENT CHECK: an existing single-day event (no end_date yet) still gets the weekend auto-suggestion the first time a range is added', () => {
    const evt = {
      id: 'evt-4',
      name: 'Plain mensday',
      type: 'day',
      date: '2026-09-11',
      end_date: null, // never had a range -- the common, pre-existing-row shape
      start_time: '12:00',
      end_time: '18:00',
      attendees: [],
    }
    const { container } = render(<EditEventModal evt={evt} onSave={() => {}} onClose={() => {}} users={[]} />)
    const select = getTypeSelect(container)
    const { endDate } = getDateInputs(container)
    expect(select.value).toBe('day')

    fireEvent.change(endDate, { target: { value: '2026-09-13' } })

    expect(select.value).toBe('weekend') // auto-suggest still fires -- seeding didn't break this direction
  })

  it('INDEPENDENT CHECK: same as above but end_date is "" (empty string, not null) -- must behave identically', () => {
    const evt = {
      id: 'evt-5',
      name: 'Plain mensday, empty-string end_date',
      type: 'day',
      date: '2026-09-11',
      end_date: '',
      start_time: '12:00',
      end_time: '18:00',
      attendees: [],
    }
    const { container } = render(<EditEventModal evt={evt} onSave={() => {}} onClose={() => {}} users={[]} />)
    const select = getTypeSelect(container)
    const { endDate } = getDateInputs(container)

    fireEvent.change(endDate, { target: { value: '2026-09-13' } })

    expect(select.value).toBe('weekend')
  })

  it('INDEPENDENT CHECK: brand-new event in NewEventModal still gets the weekend suggestion on its first range (unaffected by the EditEventModal-only seeding change)', () => {
    // NewEventModal's typeTouched still seeds `useRef(false)` unconditionally
    // (App.jsx:5165) -- a fresh event has no evt.end_date to seed from.
    // Already covered by the "NewEventModal typeTouched auto-suggest" describe
    // block above; re-asserted here, colocated with the other direction, so
    // both halves of "did the fix regress the opposite case" live together.
    const { container } = render(<NewEventModal onSave={() => {}} onClose={() => {}} />)
    const { endDate } = getDateInputs(container)
    expect(getTypeSelect(container).value).toBe('day')
    fireEvent.change(endDate, { target: { value: '2026-09-14' } })
    expect(getTypeSelect(container).value).toBe('weekend')
  })
})

describe('EditEventModal / NewEventModal inline date validation (dateErr) now blocks Save/Create (fixed in App.jsx:5157/:5189)', () => {
  it('REGRESSION GUARD: the warning renders AND Save/Create are wired to disabled={!!dateErr}, matching the WinnerForm/HighlightForm pattern', () => {
    for (const name of ['EditEventModal', 'NewEventModal']) {
      const raw = extractNoSpaceComponent(name)
      expect(raw).toMatch(/Einddatum ligt vóór de startdatum/)
      expect(raw).toMatch(/disabled=\{!!dateErr\}/)
    }
    // Save (EditEventModal) and Create (NewEventModal) specifically.
    const editRaw = extractNoSpaceComponent('EditEventModal')
    expect(editRaw).toMatch(/<Btn onClick=\{\(\)=>onSave\(d\)\} disabled=\{!!dateErr\}>Save<\/Btn>/)
    const newRaw = extractNoSpaceComponent('NewEventModal')
    expect(newRaw).toMatch(/disabled=\{!!dateErr\}>Create<\/Btn>/)
  })

  it('REGRESSION GUARD: setting end_date before date shows the warning and disables the Save button', () => {
    const evt = {
      id: 'evt-3',
      name: 'Bad range',
      type: 'day',
      date: '2026-09-14',
      end_date: '',
      start_time: '12:00',
      end_time: '18:00',
      attendees: [],
    }
    const { container } = render(
      <EditEventModal evt={evt} onSave={() => {}} onClose={() => {}} users={[]} />,
    )
    const { endDate } = getDateInputs(container)
    fireEvent.change(endDate, { target: { value: '2026-09-12' } }) // before start date

    expect(screen.getByText(/Einddatum ligt vóór de startdatum/)).toBeTruthy()

    const saveBtn = screen.getByText('Save')
    expect(saveBtn.hasAttribute('disabled')).toBe(true)
  })

  it('GUARD: an inverted range can no longer reach onSave at all -- clicking the disabled Save button is a no-op in both EditEventModal and NewEventModal', () => {
    const evt = {
      id: 'evt-3',
      name: 'Bad range',
      type: 'day',
      date: '2026-09-14',
      end_date: '',
      start_time: '12:00',
      end_time: '18:00',
      attendees: [],
    }
    let saved = 'UNCHANGED'
    const { container } = render(
      <EditEventModal evt={evt} onSave={(d) => (saved = d)} onClose={() => {}} users={[]} />,
    )
    const { endDate } = getDateInputs(container)
    fireEvent.change(endDate, { target: { value: '2026-09-12' } }) // before start date -> invalid

    const saveBtn = screen.getByText('Save')
    fireEvent.click(saveBtn)
    // A disabled native <button> does not dispatch a click-triggered
    // onClick handler (jsdom follows the platform behavior here) -- assert
    // the *effect* (onSave never invoked), not just the DOM attribute, so a
    // future change to the disabling mechanism that stops actually
    // preventing the click still gets caught.
    expect(saved).toBe('UNCHANGED')

    // Now fix the range -- disabled must lift and Save must go through.
    fireEvent.change(endDate, { target: { value: '2026-09-16' } })
    expect(screen.getByText('Save').hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByText('Save'))
    expect(saved).not.toBe('UNCHANGED')
    expect(saved.end_date >= saved.date).toBe(true)
  })

  it('GUARD: same no-op-when-invalid behavior for NewEventModal Create', () => {
    let saved = 'UNCHANGED'
    const { container } = render(<NewEventModal onSave={(d) => (saved = d)} onClose={() => {}} />)
    const { startDate, endDate } = getDateInputs(container)
    fireEvent.change(startDate, { target: { value: '2026-09-14' } })
    fireEvent.change(endDate, { target: { value: '2026-09-12' } }) // invalid: before start

    fireEvent.click(screen.getByText('Create'))
    expect(saved).toBe('UNCHANGED')
  })
})
