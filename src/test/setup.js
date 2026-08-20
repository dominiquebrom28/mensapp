// Vitest global setup. Runs once per test file (per vitest.config.js
// `test.setupFiles`).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// React Testing Library doesn't auto-clean between tests unless the test
// runner's globals are wired up for it; we don't enable `test.globals` in
// vitest.config.js (explicit imports are clearer in a codebase this size),
// so clean up manually.
afterEach(() => {
  cleanup()
})
