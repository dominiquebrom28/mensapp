// Regression coverage for the tap-target fix (docs/ux-plan.md §2.1/§2.9,
// 2026-08-26): `TabBtn` (`padding:"8px 14px"` at `.83rem`, no `minHeight`)
// rendered at roughly 32-34px tall -- under the 44px bar this app already
// applies to member-facing controls elsewhere (Nav's `minHeight:44` uses).
//
// TabBtn is rendered here via the real, current App.jsx source text (see
// extractComponentFromAppSource.js), not a hand-copied re-implementation,
// so a regression to "no minHeight" fails these tests.
//
// No layout assertions: jsdom has no layout engine
// (`getBoundingClientRect` always returns zeros for every element), so this
// asserts on the *declared* inline style value (`el.style.minHeight`),
// which is what actually reaches the browser, rather than anything
// rendered/measured.
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'

const TabBtn = extractComponentFromApp({ React }, 'TabBtn')

describe('TabBtn tap targets (docs/ux-plan.md §2.1/§2.9)', () => {
  it('declares a 44px minHeight when inactive', () => {
    const { getByText } = render(<TabBtn active={false} onClick={() => {}}>Polls</TabBtn>)
    const tab = getByText('Polls')
    expect(tab.style.minHeight).toBe('44px')
  })

  it('declares a 44px minHeight when active', () => {
    const { getByText } = render(<TabBtn active onClick={() => {}}>Overview</TabBtn>)
    const tab = getByText('Overview')
    expect(tab.style.minHeight).toBe('44px')
  })

  it('clears the WCAG 2.2 24px minimum target size', () => {
    const { getByText } = render(<TabBtn active={false} onClick={() => {}}>Photos</TabBtn>)
    const tab = getByText('Photos')
    const px = Number.parseInt(tab.style.minHeight, 10)
    expect(px).toBeGreaterThanOrEqual(24)
  })

  it('a caller-supplied style can still override minHeight explicitly (style is spread last)', () => {
    const { getByText } = render(
      <TabBtn active={false} onClick={() => {}} style={{ minHeight: 30 }}>Photos</TabBtn>,
    )
    const tab = getByText('Photos')
    expect(tab.style.minHeight).toBe('30px')
  })

  it('centers its label via flex, so the taller box from minHeight does not push text to the top', () => {
    const { getByText } = render(<TabBtn active={false} onClick={() => {}}>Photos</TabBtn>)
    const tab = getByText('Photos')
    expect(tab.style.display).toBe('inline-flex')
    expect(tab.style.alignItems).toBe('center')
  })
})
