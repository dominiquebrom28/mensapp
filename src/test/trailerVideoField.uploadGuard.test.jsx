// Regression coverage for TrailerVideoField's upload guard (security
// review, additive to the fix pass): a pre-upload type/size check so a bad
// pick never reaches the network, and a generic upload-failure message
// (matching the write-error banner's convention: raw Supabase error text
// goes to console.error only, never straight to the screen). `supabase` is
// injected as an explicit function parameter (not a real import) since the
// extracted source only ever reads it as a free variable -- same
// dependency-injection idea extractFromAppSource.js uses elsewhere.
// TrailerVideoField is declared `const TrailerVideoField=(...)=>{` (no
// space before `=`), so extractComponentFromAppSource.js's `const NAME = `
// matcher can't find it -- same situation EventModals.typeTouched.test.jsx
// already documents and works around with its own narrow extraction.
import React, { useState, useRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

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

const Lbl = ({ children }) => <label>{children}</label>
const Inp = ({ value, onChange, placeholder }) => <input value={value} onChange={onChange} placeholder={placeholder} />
const Btn = ({ children, onClick, disabled, style }) => (
  <button onClick={onClick} disabled={disabled} style={style}>{children}</button>
)

function buildTrailerVideoField(supabase) {
  // Grabs both the two new module-scope consts (TRAILER_VIDEO_MAX_BYTES,
  // TRAILER_VIDEO_TYPES) and the component itself in one extraction pass,
  // since they're declared immediately above it and this file's line-scan
  // extraction takes everything between the first match and the first
  // following top-level "\n};".
  const startMarker = 'const TRAILER_VIDEO_MAX_BYTES='
  const start = source.indexOf(startMarker)
  expect(start, `"${startMarker}" not found in App.jsx`).toBeGreaterThan(-1)
  const end = source.indexOf('\n};', start)
  expect(end, 'closing "};" for TrailerVideoField not found').toBeGreaterThan(start)
  const raw = source.slice(start, end + 3)
  const transformed = transformJsxInSubprocess(raw)
  const fn = new Function('React', 'useState', 'useRef', 'Lbl', 'Inp', 'Btn', 'supabase', `${transformed}\nreturn TrailerVideoField;`)
  return fn(React, useState, useRef, Lbl, Inp, Btn, supabase)
}

function makeFile(name, type, sizeBytes) {
  const file = new File(['x'.repeat(Math.min(sizeBytes, 10))], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

describe('TrailerVideoField upload guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a non-video file type before ever calling supabase.storage.upload', () => {
    const upload = vi.fn()
    const supabase = { storage: { from: () => ({ upload, getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } }
    const TrailerVideoField = buildTrailerVideoField(supabase)
    const onChange = vi.fn()
    render(<TrailerVideoField value="" onChange={onChange} />)

    const input = document.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [makeFile('evil.exe', 'application/x-msdownload', 1000)] } })

    expect(upload).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/ongeldig bestandstype/i)).toBeInTheDocument()
  })

  it('rejects an oversized file before ever calling supabase.storage.upload', () => {
    const upload = vi.fn()
    const supabase = { storage: { from: () => ({ upload, getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } }
    const TrailerVideoField = buildTrailerVideoField(supabase)
    const onChange = vi.fn()
    render(<TrailerVideoField value="" onChange={onChange} />)

    const input = document.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [makeFile('huge.mp4', 'video/mp4', 500 * 1024 * 1024)] } })

    expect(upload).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/te groot/i)).toBeInTheDocument()
  })

  it('a valid file within limits proceeds to upload', async () => {
    const upload = vi.fn(async () => ({ data: { path: 'mock-path' }, error: null }))
    const supabase = { storage: { from: () => ({ upload, getPublicUrl: () => ({ data: { publicUrl: 'https://mock.test/mock-path' } }) }) } }
    const TrailerVideoField = buildTrailerVideoField(supabase)
    const onChange = vi.fn()
    render(<TrailerVideoField value="" onChange={onChange} />)

    const input = document.querySelector('input[type="file"]')
    await fireEvent.change(input, { target: { files: [makeFile('trailer.mp4', 'video/mp4', 1000)] } })

    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('on an upload failure: shows a generic message, never the raw Supabase error text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const upload = vi.fn(async () => ({ data: null, error: { message: 'new row violates row-level security policy for table "objects"' } }))
    const supabase = { storage: { from: () => ({ upload, getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } }
    const TrailerVideoField = buildTrailerVideoField(supabase)
    const onChange = vi.fn()
    render(<TrailerVideoField value="" onChange={onChange} />)

    const input = document.querySelector('input[type="file"]')
    await fireEvent.change(input, { target: { files: [makeFile('trailer.mp4', 'video/mp4', 1000)] } })

    expect(await screen.findByText(/upload mislukt/i)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/i)).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
