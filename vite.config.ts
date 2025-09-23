import { defineConfig } from 'vitest/config'
import type { UserConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tsConfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    tsConfigPaths(),
  ] as UserConfig['plugins'],
  test: {
    coverage: {
      provider: 'v8',
    },
  },
})
