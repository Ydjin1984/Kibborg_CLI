import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * `@kibborg` workspace test config.
 *
 * The repository's own vitest config globs `packages/*​/*` and does not reach
 * `Kibborg_CLI/`, so the CLI carries its own: same runner, same node
 * environment, scoped to this workspace's tests. The explicit `root` keeps the
 * include globs relative to this directory no matter where the command runs.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: [
      'packages/*/tests/**/*.spec.ts',
      'apps/*/tests/**/*.spec.ts',
      'tests/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
