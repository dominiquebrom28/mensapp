// A control is not styled just because it has a className.
//
// QuizShell's status filter reached for `mg-subtab` and `mg-fu` — CSS
// classes defined in `features/mensgames/ui/styles.jsx` and injected only by
// `MensGamesShell`. Inside the quiz feature they matched nothing, so every
// filter tab fell back to the user-agent button default: a #efefef grey
// background under cream text at 0.68 alpha (measured in a real browser:
// unreadable), roughly 24px tall against the app's own 44px bar, and no
// pointer cursor.
//
// This is the third instance of the same failure the owner has reported:
// "the labels/colors are not readable because of certain default/hover
// states". Every time, the cause was a control whose appearance depended on
// styling that wasn't actually applied.
//
// jsdom has no layout engine and applies no stylesheet cascade, so it cannot
// see the visual result. What it CAN check is the cause: that no component
// in this feature depends on another feature's injected CSS, and that the
// tab carries its own values.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { SubTab } from '../../features/quiz/ui/Kit.jsx'

const QUIZ_DIR = path.join(process.cwd(), 'src', 'features', 'quiz')

function jsxFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? jsxFilesUnder(path.join(dir, e.name))
      : e.name.endsWith('.jsx') ? [path.join(dir, e.name)] : [],
  )
}

describe('the quiz feature styles itself', () => {
  it('never borrows a mens-games CSS class', () => {
    const offenders = jsxFilesUnder(QUIZ_DIR)
      .map(f => [path.relative(process.cwd(), f), readFileSync(f, 'utf-8')])
      .filter(([, src]) => /className\s*=\s*[{"'`][^}]*\bmg-/.test(src))
      .map(([rel]) => rel)

    expect(offenders, `these depend on CSS only MensGamesShell injects: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('SubTab carries its own appearance', () => {
  // Each call gets its own render + unmount: RTL only cleans up between
  // tests, and two SubTabs with the same label in one test collide.
  const styleOf = active => {
    const { unmount } = render(<SubTab active={active} onClick={() => {}}>Klaar</SubTab>)
    const el = screen.getByText('Klaar')
    // CSSStyleDeclaration keeps its named properties on the prototype, so a
    // spread copies nothing useful -- read the values out explicitly.
    const style = {
      background: el.style.background,
      minHeight: el.style.minHeight,
      color: el.style.color,
      borderBottom: el.style.borderBottom,
      cursor: el.style.cursor,
    }
    unmount()
    return style
  }

  it('sets a background rather than inheriting the UA default', () => {
    // The bug: no background at all, so the browser paints #efefef.
    expect(styleOf(false).background).toBe('none')
  })

  it('meets the 44px tap target the app applies to member-facing controls', () => {
    expect(styleOf(false).minHeight).toBe('44px')
  })

  it('is visibly different when active, and readable when not', () => {
    expect(styleOf(true).color).toBe('var(--amber2)')
    expect(styleOf(false).color).toBe('var(--muted)')
    expect(styleOf(true).borderBottom).toContain('var(--amber)')
  })

  it('looks clickable', () => {
    expect(styleOf(false).cursor).toBe('pointer')
  })
})
