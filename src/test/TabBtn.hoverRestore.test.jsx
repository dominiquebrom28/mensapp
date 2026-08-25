// Regression coverage for the tab-strip half-active/half-disabled bug
// (2026-08-26 visible-controls audit) -- the same snapshot-and-replay
// anti-pattern `Btn` was fixed for (see Btn.hoverRestore.test.jsx), but
// hand-rolled a second time in the Admin Panel and EventPage tab bars before
// being extracted into a shared `TabBtn`.
//
// Root cause: the old tab-button markup's `onMouseEnter` stashed the
// pre-hover `color`/`background` onto the element (`el._sc`/`el._sb`) and
// `onMouseLeave` replayed that exact snapshot. Hover an *inactive* tab, then
// click it -- the click flips this same tab to active (bold, amber
// underline, `color: var(--amber2)`) via React state, but the matching
// `mouseleave` doesn't land until later (deferred past the click on touch,
// or just a slow mouse leaving after the click already committed). When it
// finally arrives, replaying the snapshot paints the *stale, pre-click*
// `var(--muted)` text colour back under the *now-active* tab's bold weight
// and amber underline -- the reported "half-active, half-disabled" look.
//
// TabBtn is rendered here via the real, current App.jsx source text (see
// extractComponentFromAppSource.js), not a hand-copied re-implementation, so
// a regression back to snapshot-and-replay fails these tests.
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'

const TabBtn = extractComponentFromApp({ React }, 'TabBtn')

describe('TabBtn hover cleanup', () => {
  it('REGRESSION GUARD: hovering an inactive tab that becomes active on click never leaves the stale inactive text colour behind', () => {
    function Harness() {
      const [active, setActive] = React.useState(false)
      return (
        <TabBtn active={active} onClick={() => setActive(true)}>
          Quiz
        </TabBtn>
      )
    }
    const { getByText } = render(<Harness />)
    const tab = getByText('Quiz')

    // Hover while still inactive -- matches WebKit's touch behaviour of
    // firing a synthetic hover just before the tap's click.
    fireEvent.mouseOver(tab)
    expect(tab.style.color).toBe('var(--amber)') // hover tint applied

    // The tap's click flips this tab to active via React state. On a real
    // touchscreen (or just a normal, slightly-late mouse leave) the matching
    // mouseleave is deferred until after this -- simulate that gap
    // explicitly before delivering it.
    fireEvent.click(tab)
    expect(tab.style.fontWeight).toBe('600') // now active: bold
    expect(tab.style.borderBottom).toBe('2px solid var(--amber)') // now active: amber underline

    fireEvent.mouseOut(tab) // the deferred leave finally arrives

    // Must resolve to the active tab's actual resting colour
    // (var(--amber2)), never the stale, pre-click var(--muted) -- that
    // combination (muted text under a bold amber underline) is exactly the
    // "half-active, half-disabled" look from the report.
    expect(tab.style.color).toBe('var(--amber2)')
    expect(tab.style.background).toBe('none')
  })

  it('a plain inactive hover/leave cycle still returns to the exact resting style (no regression to normal behaviour)', () => {
    const { getByText } = render(<TabBtn active={false} onClick={() => {}}>Polls</TabBtn>)
    const tab = getByText('Polls')
    expect(tab.style.color).toBe('var(--muted)')

    fireEvent.mouseOver(tab)
    expect(tab.style.color).toBe('var(--amber)')

    fireEvent.mouseOut(tab)
    expect(tab.style.color).toBe('var(--muted)')
    expect(tab.style.background).toBe('none')
  })

  it('hovering an already-active tab never applies the hover tint at all', () => {
    const { getByText } = render(<TabBtn active onClick={() => {}}>Overview</TabBtn>)
    const tab = getByText('Overview')
    expect(tab.style.color).toBe('var(--amber2)')

    fireEvent.mouseOver(tab)
    expect(tab.style.color).toBe('var(--amber2)') // untouched, no hover tint on the active tab

    fireEvent.mouseOut(tab)
    expect(tab.style.color).toBe('var(--amber2)')
  })
})
