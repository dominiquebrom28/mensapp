// Regression coverage for the "backdrop click silently discards edits" bug:
// Modal now supports an optional `onBackdropClose` prop so a specific
// consumer (EditScheduleModal) can persist in-progress edits on backdrop
// click instead of discarding them. Every other Modal consumer doesn't pass
// it, and MUST keep falling back to plain `onClose` exactly as before -- a
// broken fallback here would silently change behavior for every modal in
// the app (EditEventModal, NewEventModal, AnnouncementModal,
// EditProfileModal, WinnerForm, HighlightForm, ...).
//
// Modal is rendered here via the real, current App.jsx source text (see
// extractComponentFromAppSource.js), not a hand-copied re-implementation --
// so a regression to the actual fallback logic (`(onBackdropClose||onClose)()`)
// or the 350ms grace period will fail these tests.
import React, { useRef, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { extractComponentFromApp } from './extractComponentFromAppSource.js'

const Modal = extractComponentFromApp({ React, useRef, useEffect }, 'Card', 'Modal')

// Modal's backdrop-click handler only fires if `ready.current` is true,
// which a `setTimeout(...,350)` flips 350ms after mount. Fake timers let us
// control that deterministically instead of a real 350ms sleep per test.
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function clickBackdrop(container) {
  // The outermost rendered element is the ".ov" backdrop overlay itself.
  fireEvent.click(container.querySelector('.ov'))
}

describe('Modal backdrop click', () => {
  it('does nothing within the 350ms grace period (no onClose, no onBackdropClose)', () => {
    const onClose = vi.fn()
    const onBackdropClose = vi.fn()
    const { container } = render(
      <Modal onClose={onClose} onBackdropClose={onBackdropClose}>
        <div>content</div>
      </Modal>,
    )

    // No time advanced at all -- click immediately after mount.
    clickBackdrop(container)
    expect(onClose).not.toHaveBeenCalled()
    expect(onBackdropClose).not.toHaveBeenCalled()

    // Still within the grace period.
    vi.advanceTimersByTime(349)
    clickBackdrop(container)
    expect(onClose).not.toHaveBeenCalled()
    expect(onBackdropClose).not.toHaveBeenCalled()
  })

  it('calls onBackdropClose (not onClose) after the grace period, when onBackdropClose is provided', () => {
    const onClose = vi.fn()
    const onBackdropClose = vi.fn()
    const { container } = render(
      <Modal onClose={onClose} onBackdropClose={onBackdropClose}>
        <div>content</div>
      </Modal>,
    )

    vi.advanceTimersByTime(350)
    clickBackdrop(container)

    expect(onBackdropClose).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('REGRESSION GUARD: calls plain onClose after the grace period when onBackdropClose is omitted (every other modal in the app)', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal onClose={onClose}>
        <div>content</div>
      </Modal>,
    )

    vi.advanceTimersByTime(350)
    clickBackdrop(container)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('REGRESSION GUARD: falls back to onClose when onBackdropClose is explicitly undefined', () => {
    // Guards against a fallback implemented as e.g. a naive `??` on the prop
    // *existing* rather than `||` on its value -- explicitly passing
    // `onBackdropClose={undefined}` (as opposed to simply omitting the prop)
    // must behave identically to omitting it.
    const onClose = vi.fn()
    const onBackdropClose = undefined
    const { container } = render(
      <Modal onClose={onClose} onBackdropClose={onBackdropClose}>
        <div>content</div>
      </Modal>,
    )

    vi.advanceTimersByTime(350)
    clickBackdrop(container)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never fires onClose or onBackdropClose when clicking modal content, even after the grace period', () => {
    const onClose = vi.fn()
    const onBackdropClose = vi.fn()
    render(
      <Modal onClose={onClose} onBackdropClose={onBackdropClose}>
        <button>Save</button>
      </Modal>,
    )

    vi.advanceTimersByTime(1000)
    fireEvent.click(screen.getByText('Save'))

    expect(onClose).not.toHaveBeenCalled()
    expect(onBackdropClose).not.toHaveBeenCalled()
  })
})

describe('Modal defaults', () => {
  it('renders children inside the Card', () => {
    const { container } = render(
      <Modal onClose={() => {}}>
        <p>hello from inside the modal</p>
      </Modal>,
    )
    expect(container.textContent).toContain('hello from inside the modal')
  })
})
