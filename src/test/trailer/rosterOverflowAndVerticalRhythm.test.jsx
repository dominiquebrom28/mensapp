// Regression coverage for two HIGH visual defects found rendering the
// trailer in a real browser -- both invisible to jsdom-based component tests
// because jsdom has no CSS layout engine at all (no real box sizes, every
// `getBoundingClientRect()` is zeroed). What's testable here instead: (1)
// that the actual DOM structure carries the classes the fix depends on, and
// (2) static assertions against the CSS text `TrailerStyles` emits, so a
// future edit that silently drops `min-width:0`/the `.tr-outro` gap/the
// bounded grid-track minimum fails a test immediately rather than only
// showing up in the next real-browser capture.
//
// 1. HIGH -- `.tr-roster-grid` computed to 684px wide inside a 375px
//    viewport (measured via getBoundingClientRect on a real render): its
//    flex-column parent (`.tr-endcard-inner`) has no `min-width:0` on its
//    children by default, so the grid's wrapping section couldn't shrink
//    below its own max-content width and bled off both edges with no
//    scrollbar. Fixed via `.tr-roster-section`/`.tr-outro { min-width: 0 }`
//    plus a `minmax(min(84px,100%),1fr)` track minimum as a second,
//    independent line of defence.
// 2. HIGH -- the event name and "Kretjes so far" rendered on top of each
//    other: BeatOutro.jsx's wrapper used to be plain block flow with no
//    explicit spacing between its children, relying entirely on the name's
//    own line-height to leave enough room -- which stopped being enough once
//    the kretjes heading was resized. Fixed via `.tr-outro`, a flex column
//    with a real `gap`.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import TrailerStyles from '../../features/trailer/TrailerStyles.jsx';
import BeatRoster, { EmptyRoster, TrailerAvatar } from '../../features/trailer/beats/BeatRoster.jsx';
import BeatOutro from '../../features/trailer/beats/BeatOutro.jsx';

function styleText() {
  const { container } = render(<TrailerStyles />);
  return container.querySelector('style').textContent;
}

// Pulls the declaration block for a given selector out of the emitted CSS
// text so assertions can target one rule rather than substring-matching the
// whole sheet (which could false-positive against an unrelated rule that
// happens to contain the same property name). Anchored so the selector must
// start a fresh rule (preceded by start-of-string, `}`, `;`, or a newline) --
// otherwise, e.g., searching for ".tr-outro" would match inside the middle of
// the unrelated ".tr-roster-section,.tr-outro{...}" rule too.
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[};\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match ? match[1] : null;
}

describe('trailer roster grid: cannot exceed its container (regression for the 684px-in-375px overflow)', () => {
  it('the roster grid track minimum is bounded by min(...,100%), so a column minimum can never force overflow past the container width', () => {
    const css = styleText();
    const grid = ruleBody(css, '.tr-roster-grid');
    expect(grid).toBeTruthy();
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(/);
  });

  it('.tr-roster-section (the actual flex-item ancestor that collapsed) opts out of the flex/grid min-width:auto default', () => {
    const css = styleText();
    const rule = ruleBody(css, '.tr-roster-section,.tr-outro') || ruleBody(css, '.tr-roster-section');
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it('BeatRoster wraps its content in .tr-roster-section', () => {
    const { container } = render(<BeatRoster data={{ going: [{ name: 'Sander' }], goingCount: 1 }} />);
    expect(container.querySelector('.tr-roster-section')).toBeInTheDocument();
    expect(container.querySelector('.tr-roster-grid')).toBeInTheDocument();
  });

  it('EmptyRoster (rendered in BeatRoster’s place with zero RSVPs) also carries .tr-roster-section, staying inside the same fix', () => {
    const { container } = render(<EmptyRoster />);
    expect(container.querySelector('.tr-roster-section')).toBeInTheDocument();
  });

  it('TrailerAvatar (the default, size-less call site BeatRoster actually uses) sets no inline width/height -- sizing is left entirely to the responsive .tr-avatar CSS clamp()', () => {
    const { container } = render(<TrailerAvatar name="Sander" />);
    const avatar = container.querySelector('.tr-avatar');
    expect(avatar.style.width).toBe('');
    expect(avatar.style.height).toBe('');
  });

  it('TrailerAvatar still honours an explicit size prop (backward-compatible opt-in override)', () => {
    const { container } = render(<TrailerAvatar name="Sander" size={40} />);
    const avatar = container.querySelector('.tr-avatar');
    expect(avatar.style.width).toBe('40px');
    expect(avatar.style.height).toBe('40px');
  });

  it('the "+N more" tile (the roster’s one hand-rolled, non-TrailerAvatar avatar) also has no inline width/height any more', () => {
    const { container } = render(<BeatRoster data={{ going: [{ name: 'Sander' }], goingCount: 11, moreCount: 1 }} />);
    const moreTile = container.querySelector('.tr-roster-more .tr-avatar');
    expect(moreTile).toBeInTheDocument();
    expect(moreTile.style.width).toBe('');
    expect(moreTile.style.height).toBe('');
  });
});

describe('trailer end card: event name can never collide with "Kretjes so far" (regression for the overlap bug)', () => {
  it('BeatOutro wraps its content in .tr-outro, a flex column with a real gap between name/kretjes/CTAs', () => {
    const css = styleText();
    const rule = ruleBody(css, '.tr-outro');
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/flex-direction:\s*column/);
    // A real, non-zero gap -- this is what guarantees separation regardless
    // of either heading's font-size/line-height, rather than a value tuned
    // to look right for one specific name/heading combination.
    const gapMatch = rule.match(/gap:\s*([\d.]+)rem/);
    expect(gapMatch).toBeTruthy();
    expect(parseFloat(gapMatch[1])).toBeGreaterThan(0);
  });

  it('renders the name and "Kretjes so far" inside .tr-outro, not as bare siblings relying on line-height for spacing', () => {
    const { container } = render(
      <BeatOutro data={{ name: 'Mensday 2026', kretjes: 48 }} onReplay={() => {}} onRsvp={() => {}} />,
    );
    const outro = container.querySelector('.tr-outro');
    expect(outro).toBeInTheDocument();
    expect(outro).toHaveTextContent('Mensday 2026');
    expect(outro.querySelector('.tr-kretjes-title')).toHaveTextContent('Kretjes so far');
    // Both the name and the kretjes block are direct children of the
    // gap-managed flex column, not nested one inside the other in a way that
    // would let a margin/line-height tweak on one silently stop applying.
    expect(outro.children.length).toBeGreaterThanOrEqual(2);
  });
});
