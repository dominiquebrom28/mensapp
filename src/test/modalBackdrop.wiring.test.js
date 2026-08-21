// Source-level regression guards for the backdrop-click-discards-edits fix
// (2026-08-21e), for the three Modal consumers that are impractical to fully
// mount: PollsTab's "New Poll" modal and FAQTab's "Ask a question" modal are
// both deeply embedded inside much larger components (closures over dozens
// of sibling handlers/derived values), and AdminPanel's `<Modal>` isn't an
// editing-draft modal at all. Same rationale EditScheduleModal.wiring.test.js
// gives for not fully mounting EditScheduleModal: the payoff of chaining a
// full render together doesn't justify the fragility, so this asserts the
// actual wiring directly against App.jsx's current source text instead.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

describe('PollsTab "New Poll" modal (create-only -- backdrop click must be ignored, not discard)', () => {
  it('wires onBackdropClose to a no-op, not the discard-shaped onClose', () => {
    const start = source.indexOf('{creating&&(')
    expect(start, '"New Poll" modal block not found').toBeGreaterThan(-1)
    const block = source.slice(start, start + 200)
    expect(block).toMatch(/<Modal onClose=\{[\s\S]*?\}\} onBackdropClose=\{\(\)=>\{\}\} maxWidth=\{460\}>/)
  })
})

describe('FAQTab "Ask a question" modal (create-only -- backdrop click must be ignored, not discard)', () => {
  it('wires onBackdropClose to a no-op, not the discard-shaped onClose', () => {
    const start = source.indexOf('{asking&&(')
    expect(start, '"Ask a question" modal block not found').toBeGreaterThan(-1)
    const block = source.slice(start, start + 200)
    expect(block).toMatch(/<Modal onClose=\{\(\)=>setAsking\(false\)\} onBackdropClose=\{\(\)=>\{\}\} maxWidth=\{480\}>/)
  })
})

describe('AdminPanel (not an editing-draft modal -- every action applies immediately via onUpdateUsers/onDeleteUser, nothing buffered to lose)', () => {
  it('REGRESSION GUARD: still has no onBackdropClose wiring -- must keep falling back to plain onClose like every untouched Modal consumer', () => {
    const start = source.indexOf('const AdminPanel = ')
    expect(start, 'AdminPanel declaration not found').toBeGreaterThan(-1)
    const end = source.indexOf('\n};', start)
    expect(end, 'AdminPanel closing "};" not found').toBeGreaterThan(start)
    const body = source.slice(start, end)
    expect(body).toMatch(/<Modal onClose=\{onClose\} maxWidth=\{600\}>/)
    expect(body).not.toMatch(/onBackdropClose/)
  })
})
