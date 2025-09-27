/// <reference types="vite/client" />
import { defineConfig } from 'vitest/config'
import type { UserConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    tsconfigPaths(),
  ] as UserConfig['plugins'],
  test: {
    coverage: {
      provider: 'v8',
    },
    alias: {
      // @ts-ignore
      '#': new URL('./jslib/', import.meta.url).pathname,
    },
  },
})
