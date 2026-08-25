// Regression coverage for the "controls invisible/near-invisible in certain
// states, only appearing on hover" bug (2026-08-25 visible-controls audit).
//
// Root cause: Btn's hover cleanup (`onMouseLeave`) used to replay a snapshot
// of the button's inline style taken once, on `onMouseEnter`. Two ways that
// went wrong, both reproduced against a real browser before this fix (see
// the qa-harness notes for the full writeup):
//
//  1. `onMouseEnter` bails out early (`if(disabled)return`) without ever
//     taking a snapshot. A browser that still dispatches hover events to
//     *disabled* controls (Chromium suppresses these; WebKit/Firefox are
//     documented not to) then delivers `onMouseLeave` with no snapshot to
//     replay, and the old code fell back to `{}`, wiping every inline
//     override to `""` -- background, border, shadow, transform, filter --
//     while leaving `color` untouched. Net result: a bare, near-invisible
//     button (no fill/border) with light text still on it.
//  2. Even with a real snapshot, it goes stale the instant this exact
//     button's own click changes its `variant` (e.g. Team Creator's
//     library filter pair swapping primary<->ghost on every click) before
//     the matching `onMouseLeave` arrives -- which is exactly what happens
//     on touch, where WebKit defers a tapped element's synthetic
//     `mouseleave` until the *next* tap lands elsewhere. Replaying the old
//     snapshot then paints the *previous* variant's background under the
//     *current* variant's text colour -- e.g. a "transparent" background
//     (ghost's resting value) under `var(--bg)` text (primary's dark text),
//     both close to the page background: invisible.
//
// Btn is rendered here via the real, current App.jsx source text (see
// extractComponentFromAppSource.js), not a hand-copied re-implementation,
// so a regression to the actual fix (recomputing the resting style fresh
// off `variant`/`style` instead of replaying a snapshot) fails these tests.
import React, { useRef, useEffect } from 'react'
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'

const Btn = extractComponentFromApp({ React, useRef, useEffect }, 'Btn')

describe('Btn hover cleanup', () => {
  it('REGRESSION GUARD: hovering (and leaving) a disabled ghost button never wipes its resting background', () => {
    const { getByText } = render(
      <Btn variant="ghost" disabled onClick={() => {}}>Deselecteer alles</Btn>,
    )
    const btn = getByText('Deselecteer alles')
    expect(btn.style.background).toBe('transparent')

    // Some engines (WebKit/Firefox, unlike Chromium) still dispatch
    // mouseover/mouseout to disabled controls -- simulate that directly
    // rather than relying on whichever behaviour this test's jsdom/browser
    // happens to have.
    fireEvent.mouseOver(btn)
    fireEvent.mouseOut(btn)

    expect(btn.style.background).toBe('transparent')
    expect(btn.style.border).toBe('1px solid var(--border)')
  })

  it('REGRESSION GUARD: a button that disables itself mid-hover (e.g. "Deselecteer alles" after emptying the selection) is not left stuck at its hover tint', () => {
    function Harness() {
      const [disabled, setDisabled] = React.useState(false)
      return (
        <Btn variant="ghost" disabled={disabled} onClick={() => setDisabled(true)}>
          Deselecteer alles
        </Btn>
      )
    }
    const { getByText } = render(<Harness />)
    const btn = getByText('Deselecteer alles')

    fireEvent.mouseOver(btn)
    expect(btn.style.background).toBe('rgba(232, 148, 58, 0.09)') // hover tint applied

    // The click flips `disabled` true via React state -- in a real browser,
    // a now-disabled control stops dispatching mouseleave entirely, so
    // nothing would ever clean this up without the disabled-transition
    // effect this guards.
    fireEvent.click(btn)

    expect(btn.disabled).toBe(true)
    expect(btn.style.background).toBe('transparent')
    expect(btn.style.transform).toBe('')
    expect(btn.style.boxShadow).toBe('')
  })

  it('REGRESSION GUARD: hovering a button that changes variant on click (e.g. Actief/Gearchiveerd) never leaves a stale background under the new variant\'s text colour', () => {
    function Harness() {
      const [active, setActive] = React.useState(false)
      return (
        <Btn variant={active ? 'primary' : 'ghost'} onClick={() => setActive(true)}>
          Gearchiveerd
        </Btn>
      )
    }
    const { getByText } = render(<Harness />)
    const btn = getByText('Gearchiveerd')

    // Hover while still ghost (unselected) -- matches WebKit's touch
    // behaviour of firing a synthetic hover just before the tap's click.
    fireEvent.mouseOver(btn)
    expect(btn.style.background).toBe('rgba(232, 148, 58, 0.09)')

    // The tap's click flips it to the primary/selected variant. On a real
    // touchscreen the matching mouseleave is deferred until the *next* tap
    // lands elsewhere -- simulate that gap explicitly before delivering it.
    fireEvent.click(btn)
    expect(btn.style.color).toBe('var(--bg)') // now primary's dark text

    fireEvent.mouseOut(btn) // the deferred leave finally arrives

    // Must resolve to primary's actual resting background (var(--amber)),
    // never ghost's stale "transparent" -- transparent + var(--bg) text is
    // the exact invisible combination from the original bug report.
    expect(btn.style.background).toBe('var(--amber)')
    expect(btn.style.color).toBe('var(--bg)')
  })

  it('a plain enabled hover/leave cycle still returns to the exact resting style (no regression to normal behaviour)', () => {
    const { getByText } = render(<Btn variant="subtle">+ Voeg toe</Btn>)
    const btn = getByText('+ Voeg toe')
    const restingBg = btn.style.background
    const restingBorder = btn.style.border

    fireEvent.mouseOver(btn)
    expect(btn.style.background).not.toBe(restingBg)

    fireEvent.mouseOut(btn)
    expect(btn.style.background).toBe(restingBg)
    expect(btn.style.border).toBe(restingBorder)
  })

  it('REGRESSION GUARD: a caller-supplied borderColor override (e.g. Admin\'s role-change buttons) survives a hover/leave cycle', () => {
    const { getByText } = render(
      <Btn variant="ghost" style={{ color: 'var(--purple)', borderColor: 'rgba(155,127,232,.4)' }}>
        ★ Org
      </Btn>,
    )
    const btn = getByText('★ Org')
    expect(btn.style.borderColor).toBe('rgba(155, 127, 232, 0.4)')

    fireEvent.mouseOver(btn)
    fireEvent.mouseOut(btn)

    expect(btn.style.borderColor).toBe('rgba(155, 127, 232, 0.4)')
  })
})
