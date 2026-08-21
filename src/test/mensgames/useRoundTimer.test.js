import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRoundTimer } from '../../features/mensgames/useRoundTimer.js';

// A fully controllable fake clock/interval — no real timers, no
// vi.useFakeTimers — following the injectable-environment approach
// src/test/mocks/mediaEnv.js established for the trailer feature.
function makeFakeClock(startAt = 0) {
  let nextId = 1;
  const callbacks = new Map();
  let currentTime = startAt;
  return {
    setIntervalFn: (fn) => {
      const id = nextId++;
      callbacks.set(id, fn);
      return id;
    },
    clearIntervalFn: (id) => {
      callbacks.delete(id);
    },
    now: () => currentTime,
    /** Fires every registered interval callback `times` times, advancing 1s each. */
    tick(times = 1) {
      for (let i = 0; i < times; i++) {
        currentTime += 1000;
        [...callbacks.values()].forEach((fn) => fn());
      }
    },
    setNow(t) {
      currentTime = t;
    },
    activeCount: () => callbacks.size,
  };
}

describe('useRoundTimer', () => {
  it('starts at the given seconds, not running, not finished', () => {
    const clock = makeFakeClock();
    const { result } = renderHook(() => useRoundTimer(90, clock));
    expect(result.current.totalSeconds).toBe(90);
    expect(result.current.remaining).toBe(90);
    expect(result.current.running).toBe(false);
    expect(result.current.finished).toBe(false);
  });

  it('counts down one second per injected tick while running', () => {
    const clock = makeFakeClock();
    const { result } = renderHook(() => useRoundTimer(5, clock));
    act(() => result.current.start());
    expect(result.current.running).toBe(true);
    act(() => clock.tick());
    expect(result.current.remaining).toBe(4);
    act(() => clock.tick(2));
    expect(result.current.remaining).toBe(2);
  });

  it('stamps startedAt via the injected now() on start, only on the first start', () => {
    const clock = makeFakeClock(1000);
    const { result } = renderHook(() => useRoundTimer(5, clock));
    act(() => result.current.start());
    expect(result.current.startedAt).toBe(1000);
    clock.setNow(5000);
    act(() => result.current.pause());
    act(() => result.current.start());
    expect(result.current.startedAt).toBe(1000); // unchanged — resume, not a new start
  });

  it('reaching 0 stops, marks finished, and stamps endedAt via now()', () => {
    const clock = makeFakeClock(2000);
    const { result } = renderHook(() => useRoundTimer(2, clock));
    act(() => result.current.start());
    act(() => clock.tick(2));
    expect(result.current.remaining).toBe(0);
    expect(result.current.running).toBe(false);
    expect(result.current.finished).toBe(true);
    expect(result.current.endedAt).toBe(4000);
  });

  it('pause stops the countdown without resetting remaining', () => {
    const clock = makeFakeClock();
    const { result } = renderHook(() => useRoundTimer(5, clock));
    act(() => result.current.start());
    act(() => clock.tick());
    act(() => result.current.pause());
    expect(result.current.running).toBe(false);
    expect(result.current.remaining).toBe(4);
    act(() => clock.tick(3)); // no interval left registered — remaining must not move
    expect(result.current.remaining).toBe(4);
  });

  it('reset returns to totalSeconds and clears finished/startedAt/endedAt', () => {
    const clock = makeFakeClock();
    const { result } = renderHook(() => useRoundTimer(3, clock));
    act(() => result.current.start());
    act(() => clock.tick(3));
    expect(result.current.finished).toBe(true);
    act(() => result.current.reset());
    expect(result.current.remaining).toBe(3);
    expect(result.current.finished).toBe(false);
    expect(result.current.startedAt).toBeNull();
    expect(result.current.endedAt).toBeNull();
  });

  it('setSeconds changes the duration and stops any running countdown', () => {
    const clock = makeFakeClock();
    const { result } = renderHook(() => useRoundTimer(60, clock));
    act(() => result.current.start());
    act(() => result.current.setSeconds(120));
    expect(result.current.totalSeconds).toBe(120);
    expect(result.current.remaining).toBe(120);
    expect(result.current.running).toBe(false);
  });

  it('clamps seconds to the [1, 7200] round-timer bounds instead of throwing', () => {
    const clock = makeFakeClock();
    const { result: high } = renderHook(() => useRoundTimer(999999, clock));
    expect(high.current.totalSeconds).toBe(7200);
    const { result: low } = renderHook(() => useRoundTimer(-5, clock));
    expect(low.current.totalSeconds).toBe(1);
    const { result: nan } = renderHook(() => useRoundTimer('not-a-number', clock));
    expect(nan.current.totalSeconds).toBe(1);
  });

  it('progress is remaining / totalSeconds', () => {
    const clock = makeFakeClock();
    const { result } = renderHook(() => useRoundTimer(4, clock));
    act(() => result.current.start());
    act(() => clock.tick());
    expect(result.current.progress).toBe(3 / 4);
  });

  it('unmounting clears the interval — no leaked timers', () => {
    const clock = makeFakeClock();
    const { result, unmount } = renderHook(() => useRoundTimer(10, clock));
    act(() => result.current.start());
    expect(clock.activeCount()).toBe(1);
    unmount();
    expect(clock.activeCount()).toBe(0);
  });

  it('start() is a no-op once remaining has hit 0 without a reset', () => {
    const clock = makeFakeClock();
    const { result } = renderHook(() => useRoundTimer(1, clock));
    act(() => result.current.start());
    act(() => clock.tick());
    expect(result.current.finished).toBe(true);
    act(() => result.current.start());
    expect(result.current.running).toBe(false);
  });
});
