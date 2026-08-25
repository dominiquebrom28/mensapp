// Regression coverage for the tap-target fix (docs/ux-plan.md §2.1/§2.9/§9,
// 2026-08-26): App.jsx's `Btn` used to have no `minHeight` at any size --
// `sm` (97 of the app's 133 `<Btn>` uses) rendered at roughly 27px tall,
// well under both the WCAG 2.2 24px floor and the app's own stated 44px
// bar. Values now match `features/mensgames/ui/Kit.jsx`'s `BTN_SIZES`
// (36/44/48) exactly -- see the comment above `const Btn` in App.jsx for
// why the two components aren't simply merged.
//
// Btn is rendered here via the real, current App.jsx source text (see
// extractComponentFromAppSource.js), not a hand-copied re-implementation,
// so a regression to "no minHeight" fails these tests.
//
// No layout assertions: jsdom has no layout engine
// (`getBoundingClientRect` always returns zeros for every element), so this
// asserts on the *declared* inline style value (`el.style.minHeight`),
// which is what actually reaches the browser, rather than anything
// rendered/measured.
import React, { useRef, useEffect } from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'

const Btn = extractComponentFromApp({ React, useRef, useEffect }, 'Btn')

describe('Btn tap targets (docs/ux-plan.md §2.1/§2.9)', () => {
  it.each([
    ['sm', '36px'],
    ['md', '44px'],
    ['lg', '48px'],
  ])('size="%s" declares minHeight %s', (size, expected) => {
    const { getByText } = render(<Btn size={size}>Label</Btn>)
    const btn = getByText('Label')
    expect(btn.style.minHeight).toBe(expected)
  })

  it('defaults to the md (44px) minHeight when no size prop is given', () => {
    const { getByText } = render(<Btn>Label</Btn>)
    const btn = getByText('Label')
    expect(btn.style.minHeight).toBe('44px')
  })

  it('every declared size clears the WCAG 2.2 24px minimum target size', () => {
    for (const size of ['sm', 'md', 'lg']) {
      const { getByText, unmount } = render(<Btn size={size}>Label {size}</Btn>)
      const btn = getByText(`Label ${size}`)
      const px = Number.parseInt(btn.style.minHeight, 10)
      expect(px).toBeGreaterThanOrEqual(24)
      unmount()
    }
  })

  it('a caller-supplied style can still override minHeight explicitly (style is spread last)', () => {
    const { getByText } = render(<Btn size="sm" style={{ minHeight: 60 }}>Label</Btn>)
    const btn = getByText('Label')
    expect(btn.style.minHeight).toBe('60px')
  })

  it('centers its label via flex, so the taller box from minHeight does not push text to the top', () => {
    const { getByText } = render(<Btn size="md">Label</Btn>)
    const btn = getByText('Label')
    expect(btn.style.display).toBe('inline-flex')
    expect(btn.style.alignItems).toBe('center')
    expect(btn.style.justifyContent).toBe('center')
  })
})
