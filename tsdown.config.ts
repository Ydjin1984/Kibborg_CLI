import { defineConfig } from 'tsdown'

/**
 * The kibborg workspace build: the CLI app and its two packages.
 *
 * The root `tsdown.config.ts` builds the harness workspace and runs the Typert
 * generator over it; this config builds only `Kibborg_CLI/`, so a CLI change
 * does not rebuild the whole monorepo. `tsc -b` emits `lib/types/*.js` first,
 * and this pass bundles each package's entries into the `lib/` paths their
 * `exports` maps advertise.
 */
export default defineConfig({
  workspace: {
    include: ['apps/*', 'packages/*'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test?(s)/**',
      '**/tmp/**',
    ],
  },
  entry: ['lib/types/{index,invariant,startup,bin}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
