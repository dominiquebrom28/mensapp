import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.js on purpose: keeps the production Vite config
// (used by `vite build` / `vite dev`) completely untouched by test-only
// concerns (jsdom env, setup files, test globals).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    restoreMocks: true,
    // src/supabase.js reads these at module load time. Tests should never
    // touch a real Supabase project, so these are dummy, non-functional
    // values -- most tests also `vi.mock('../supabase.js')` outright and
    // never construct a real client, but this is a safety net for any test
    // that imports the real module (directly or transitively) without
    // mocking it.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-dummy-anon-key-not-a-real-secret',
    },
  },
})
