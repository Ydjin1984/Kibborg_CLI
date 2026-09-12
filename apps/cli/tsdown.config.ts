import { defineConfig } from 'tsdown'

/**
 * The kibborg CLI ships one entry: the `bin` referenced by package.json `bin`.
 * The workspace build emits `lib/types/index.js` for ordinary packages, so this
 * override points at `lib/types/bin.js` instead; the mode modules reachable
 * from it bundle with it. Declarations come from `tsc -b` (dts: false).
 */
export default defineConfig({
  entry: ['lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
