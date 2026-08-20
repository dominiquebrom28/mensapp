// Unit tests for src/features/trailer/useMediaPreloader.js.
//
// Uses the OPT-IN mock in src/test/mocks/mediaEnv.js -- installed/restored
// per test file, never in the shared setup.js (see that file's docblock).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { installMediaEnv } from '../mocks/mediaEnv.js'
import { useMediaPreloader, PRELOAD_STATUS } from '../../features/trailer/useMediaPreloader.js'

let env
afterEach(() => {
  env?.restore()
  env = null
  vi.useRealTimers()
})

describe('useMediaPreloader', () => {
  it('statusOf is "idle" for a URL that has never been requested', () => {
    env = installMediaEnv()
    const urls = ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg']
    const { result } = renderHook(() => useMediaPreloader(urls))
    expect(result.current.statusOf(urls[0])).toBe(PRELOAD_STATUS.IDLE)
  })

  it('ensureFrom(index) loads index+1 and index+2 (default lookahead), not index itself or index+3', () => {
    env = installMediaEnv()
    const urls = [0, 1, 2, 3, 4].map((i) => `https://cdn.example.com/${i}.jpg`)
    const { result } = renderHook(() => useMediaPreloader(urls))

    act(() => result.current.ensureFrom(1))

    expect(env.getImage(urls[0])).toBeNull()
    expect(env.getImage(urls[2])).not.toBeNull()
    expect(env.getImage(urls[3])).not.toBeNull()
    expect(env.getImage(urls[4])).toBeNull()
  })

  it('a resolved image transitions idle -> loading -> ready', async () => {
    env = installMediaEnv()
    const url = 'https://cdn.example.com/a.jpg'
    const { result } = renderHook(() => useMediaPreloader([url]))

    act(() => result.current.ensureFrom(-1)) // index+1 = 0 -> loads urls[0]
    expect(result.current.statusOf(url)).toBe(PRELOAD_STATUS.LOADING)

    act(() => env.resolveImage(url))
    await waitFor(() => expect(result.current.statusOf(url)).toBe(PRELOAD_STATUS.READY))
  })

  it('a failed image transitions to "failed" and is never retried', async () => {
    env = installMediaEnv()
    const url = 'https://cdn.example.com/a.jpg'
    const { result } = renderHook(() => useMediaPreloader([url]))

    act(() => result.current.ensureFrom(-1))
    act(() => env.rejectImage(url))
    await waitFor(() => expect(result.current.statusOf(url)).toBe(PRELOAD_STATUS.FAILED))

    const imageCountBefore = env.getImage(url) // same registry entry (keyed by src)
    act(() => result.current.ensureFrom(-1)) // ask again
    expect(result.current.statusOf(url)).toBe(PRELOAD_STATUS.FAILED) // still failed, no new load kicked off
    expect(env.getImage(url)).toBe(imageCountBefore)
  })

  it('a decode() rejection falls back to onload once, then still resolves ready', async () => {
    env = installMediaEnv()
    const url = 'https://cdn.example.com/a.jpg'
    const { result } = renderHook(() => useMediaPreloader([url]))

    act(() => result.current.ensureFrom(-1))
    act(() => env.rejectDecodeOnly(url))
    // The image still "loads" over the network even though decode() failed once.
    act(() => env.resolveImage(url))

    await waitFor(() => expect(result.current.statusOf(url)).toBe(PRELOAD_STATUS.READY))
  })

  it('never issues a request for an unsafe URL -- fails immediately, no Image constructed (defence in depth against a secret-stop URL leak)', () => {
    env = installMediaEnv()
    const unsafe = 'javascript:alert(1)'
    const { result } = renderHook(() => useMediaPreloader([unsafe]))

    act(() => result.current.ensureFrom(-1))

    expect(result.current.statusOf(unsafe)).toBe(PRELOAD_STATUS.FAILED)
    expect(env.getImage(unsafe)).toBeNull()
  })

  it('respects the concurrency cap: only `concurrency` URLs load at once, the rest wait in queue', () => {
    env = installMediaEnv()
    const urls = [0, 1, 2, 3, 4].map((i) => `https://cdn.example.com/${i}.jpg`)
    const { result } = renderHook(() => useMediaPreloader(urls, { concurrency: 2, lookahead: 5 }))

    act(() => result.current.ensureFrom(-1)) // wants all 5

    const loading = urls.filter((u) => result.current.statusOf(u) === PRELOAD_STATUS.LOADING)
    const idle = urls.filter((u) => result.current.statusOf(u) === PRELOAD_STATUS.IDLE)
    expect(loading).toHaveLength(2)
    expect(idle).toHaveLength(3)
  })

  it('finishing one load pumps the next queued URL', async () => {
    env = installMediaEnv()
    const urls = [0, 1, 2].map((i) => `https://cdn.example.com/${i}.jpg`)
    const { result } = renderHook(() => useMediaPreloader(urls, { concurrency: 1, lookahead: 3 }))

    act(() => result.current.ensureFrom(-1))
    expect(result.current.statusOf(urls[0])).toBe(PRELOAD_STATUS.LOADING)
    expect(result.current.statusOf(urls[1])).toBe(PRELOAD_STATUS.IDLE)

    act(() => env.resolveImage(urls[0]))
    await waitFor(() => expect(result.current.statusOf(urls[1])).toBe(PRELOAD_STATUS.LOADING))
  })

  it('enabled: false is a total no-op', () => {
    env = installMediaEnv()
    const url = 'https://cdn.example.com/a.jpg'
    const { result } = renderHook(() => useMediaPreloader([url], { enabled: false }))

    act(() => result.current.ensureFrom(-1))
    expect(env.getImage(url)).toBeNull()
    expect(result.current.statusOf(url)).toBe(PRELOAD_STATUS.IDLE)
  })

  it('preflight(count) loads the first `count` URLs and resolves once they settle', async () => {
    env = installMediaEnv()
    const urls = [0, 1, 2].map((i) => `https://cdn.example.com/${i}.jpg`)
    const { result } = renderHook(() => useMediaPreloader(urls))

    let settled = false
    let preflightPromise
    act(() => { preflightPromise = result.current.preflight(2).then(() => { settled = true }) })

    expect(result.current.statusOf(urls[0])).toBe(PRELOAD_STATUS.LOADING)
    expect(result.current.statusOf(urls[1])).toBe(PRELOAD_STATUS.LOADING)
    expect(result.current.statusOf(urls[2])).toBe(PRELOAD_STATUS.IDLE) // outside the preflight count

    act(() => { env.resolveImage(urls[0]); env.resolveImage(urls[1]) })
    await preflightPromise
    expect(settled).toBe(true)
  })

  it('preflight(count) resolves once the overall budget expires even if a URL never settles', async () => {
    vi.useFakeTimers()
    env = installMediaEnv()
    const url = 'https://cdn.example.com/stuck.jpg'
    const { result } = renderHook(() => useMediaPreloader([url], { timeoutMs: 60000 })) // won't time out on its own within the budget

    let settled = false
    act(() => { result.current.preflight(1).then(() => { settled = true }) })

    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(settled).toBe(true)
  })
})
