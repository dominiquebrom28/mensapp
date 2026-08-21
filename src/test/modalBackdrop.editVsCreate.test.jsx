// Regression coverage for the "every edit modal can lose work to a stray
// backdrop click" fix (2026-08-21e): EditScheduleModal was the only Modal
// consumer wired to `onBackdropClose` before this change (see
// EditScheduleModal.wiring.test.js + Modal.test.jsx's REGRESSION GUARD).
// This file covers the four standalone dual/edit-mode consumers wired up in
// the same change -- EditProfileModal (always edits an existing user, so
// backdrop always saves), and WinnerForm/HighlightForm/AnnouncementModal
// (each serves BOTH create and edit, gated on `initial`/`existing`):
//   - editing something that already exists -> backdrop click SAVES the
//     in-progress draft (nothing lost), gated by the same validity check
//     the Save button's `disabled` uses (an invalid draft is left alone,
//     not force-saved broken, and not silently discarded either -- the
//     modal simply stays open, same as a create-mode click).
//   - creating something new -> backdrop click is IGNORED entirely (does
//     NOT fall back to discarding via onClose) -- a half-filled award/
//     highlight/announcement littering the event is worse than the
//     original bug.
// (EditEventModal/NewEventModal's backdrop wiring is covered alongside their
// existing extraction harness in EventModals.typeTouched.test.jsx; the
// PollsTab "New Poll" and FAQTab "Ask a question" create-only modals and
// AdminPanel's "not actually an editing modal" case are covered by
// source-level regex guards in modalBackdrop.wiring.test.js -- both are
// deeply embedded in much larger components, the same reason
// EditScheduleModal.wiring.test.js gives for not fully mounting
// EditScheduleModal either.)
import React, { useState, useRef, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

// EditProfileModal/WinnerForm/HighlightForm/AnnouncementModal are all
// declared as `const NAME=(...)=>{` (no space before `=`) -- same shape
// EventModals.typeTouched.test.jsx documents extractComponentFromAppSource.js
// not recognizing, hence this file's own narrow extractor, column-0 `};`
// closer only (mirrors both that file and EditScheduleModal.wiring.test.js).
function extractNoSpaceComponent(name) {
  const marker = `const ${name}=`
  const start = source.indexOf(marker)
  expect(start, `"${marker}" not found in App.jsx`).toBeGreaterThan(-1)
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

// Real Card/Modal (via the shared, generic extractor -- both use `const NAME = `
// WITH a space) so the actual onBackdropClose/onClose fallback + 350ms grace
// period logic under test is the genuine, current App.jsx source, not a
// reimplementation.
const Modal = extractComponentFromApp({ React, useRef, useEffect }, 'Card', 'Modal')

// Minimal, faithful-enough stand-ins for App.jsx's other shared UI atoms --
// irrelevant to backdrop-click behavior, same stubbing idea
// EventModals.typeTouched.test.jsx uses for Btn/RichTextInput/AttendeeInput.
const H = ({ children }) => <h2>{children}</h2>
const Lbl = ({ children }) => <div>{children}</div>
const Inp = ({ value, onChange, placeholder, type = 'text', multiline, rows, autoFocus, onKeyDown }) =>
  multiline
    ? <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} onKeyDown={onKeyDown} />
    : <input type={type} value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus} onKeyDown={onKeyDown} />
const Btn = ({ children, onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled}>{children}</button>
)
// Only ANIMALS[0] is ever reached in these tests (animal_avatar stays 0) --
// `%10` in EditProfileModal's real source means the index is always 0..9
// regardless of this stub array's own length.
const ANIMALS = [{ name: 'Beer', emoji: '🐻', bg: '#000' }]
const TROPHY_ICONS = ['🏆', '🥇']
const HIGHLIGHT_EMOJIS = ['✨', '😂']
const RichTextInput = ({ value, onChange, placeholder }) => (
  <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
)
const renderMd = (text) => text
const supabase = {
  storage: { from: () => ({ upload: async () => ({ data: { path: 'x' }, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
}

function buildComponent(name, extraDeps) {
  const raw = extractNoSpaceComponent(name)
  const transformed = transformJsxInSubprocess(raw)
  const depNames = Object.keys(extraDeps)
  const fn = new Function(...depNames, `${transformed}\nreturn ${name};`)
  return fn(...depNames.map((k) => extraDeps[k]))
}

const commonDeps = { React, useState, Modal, H, Lbl, Inp, Btn }

const EditProfileModal = buildComponent('EditProfileModal', { ...commonDeps, useRef, ANIMALS, supabase })
const WinnerForm = buildComponent('WinnerForm', { ...commonDeps, TROPHY_ICONS })
const HighlightForm = buildComponent('HighlightForm', { ...commonDeps, HIGHLIGHT_EMOJIS })
const AnnouncementModal = buildComponent('AnnouncementModal', { ...commonDeps, RichTextInput, renderMd })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function clickBackdrop(container) {
  fireEvent.click(container.querySelector('.ov'))
}

async function pastGracePeriod() {
  vi.advanceTimersByTime(350)
}

describe('EditProfileModal (always edits an existing user -- backdrop always saves)', () => {
  const user = { id: 'u1', username: 'Doom', display_name: '', age: '', bio: '', animal_avatar: 0, photo_url: '' }

  it('backdrop click saves the current draft instead of discarding it', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<EditProfileModal user={user} onSave={onSave} onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('Doom'), { target: { value: 'New Name' } })

    await pastGracePeriod()
    clickBackdrop(container)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ display_name: 'New Name' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the explicit Discard button still discards (calls onClose, not onSave)', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<EditProfileModal user={user} onSave={onSave} onClose={onClose} />)

    fireEvent.click(screen.getByText('Discard changes'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe.each([
  ['WinnerForm', () => WinnerForm, { attendees: ['Doom'] }],
  ['HighlightForm', () => HighlightForm, {}],
])('%s (dual create/edit mode)', (name, getComponent, extraProps) => {
  it('create mode (no `initial`): backdrop click is ignored entirely -- no onSave, no onClose', async () => {
    const Component = getComponent()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<Component initial={null} onSave={onSave} onClose={onClose} {...extraProps} />)

    await pastGracePeriod()
    clickBackdrop(container)

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('edit mode (`initial` set) with a valid draft: backdrop click saves the current draft', async () => {
    const Component = getComponent()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const initial = name === 'WinnerForm'
      ? { category: 'Original', winner: 'Doom', detail: '', icon: '🏆' }
      : { text: 'Original story', emoji: '✨' }
    const { container } = render(<Component initial={initial} onSave={onSave} onClose={onClose} {...extraProps} />)

    await pastGracePeriod()
    clickBackdrop(container)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject(initial)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('edit mode with an invalid draft (a required field cleared): backdrop click does nothing -- never force-saves broken data, never silently discards either', async () => {
    const Component = getComponent()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const initial = name === 'WinnerForm'
      ? { category: 'Original', winner: 'Doom', detail: '', icon: '🏆' }
      : { text: 'Original story', emoji: '✨' }
    const { container } = render(<Component initial={initial} onSave={onSave} onClose={onClose} {...extraProps} />)

    const field = name === 'WinnerForm' ? screen.getByDisplayValue('Original') : screen.getByDisplayValue('Original story')
    fireEvent.change(field, { target: { value: '' } })

    await pastGracePeriod()
    clickBackdrop(container)

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the Discard button in edit mode still discards (calls onClose, not onSave)', () => {
    const Component = getComponent()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const initial = name === 'WinnerForm'
      ? { category: 'Original', winner: 'Doom', detail: '', icon: '🏆' }
      : { text: 'Original story', emoji: '✨' }
    render(<Component initial={initial} onSave={onSave} onClose={onClose} {...extraProps} />)

    fireEvent.click(screen.getByText('Discard changes'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('AnnouncementModal (dual create/edit mode, selected by `existing`)', () => {
  const currentUser = { username: 'Doom' }

  it('create mode (`existing` omitted): backdrop click is ignored entirely -- no onSave, no onClose', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<AnnouncementModal onSave={onSave} onClose={onClose} currentUser={currentUser} />)

    fireEvent.change(screen.getByPlaceholderText("What's the news?"), { target: { value: 'Draft title' } })

    await pastGracePeriod()
    clickBackdrop(container)

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('edit mode (`existing` set) with a valid title: backdrop click saves the current draft', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const existing = { id: 'ann-1', title: 'Original title', body: '', createdAt: '2026-01-01T00:00:00.000Z' }
    const { container } = render(<AnnouncementModal onSave={onSave} onClose={onClose} existing={existing} currentUser={currentUser} />)

    fireEvent.change(screen.getByDisplayValue('Original title'), { target: { value: 'Updated title' } })

    await pastGracePeriod()
    clickBackdrop(container)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'ann-1', title: 'Updated title' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('edit mode with the title cleared (invalid): backdrop click does nothing', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const existing = { id: 'ann-1', title: 'Original title', body: '', createdAt: '2026-01-01T00:00:00.000Z' }
    const { container } = render(<AnnouncementModal onSave={onSave} onClose={onClose} existing={existing} currentUser={currentUser} />)

    fireEvent.change(screen.getByDisplayValue('Original title'), { target: { value: '' } })

    await pastGracePeriod()
    clickBackdrop(container)

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the Discard button in edit mode still discards (calls onClose, not onSave)', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const existing = { id: 'ann-1', title: 'Original title', body: '', createdAt: '2026-01-01T00:00:00.000Z' }
    render(<AnnouncementModal onSave={onSave} onClose={onClose} existing={existing} currentUser={currentUser} />)

    fireEvent.click(screen.getByText('Discard changes'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
