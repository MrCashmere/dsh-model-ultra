/**
 * Post-build script: rename tsup's IIFE output files to match what Cordis expects.
 *
 * tsup outputs `dist/host.global.js` and `dist/client.global.js` (the `.global` suffix
 * is added when globalName is set). Cordis expects `dist/host.js` and `dist/client.js`.
 */
import { renameSync, existsSync } from 'node:fs'

const renames = [
  ['dist/host.global.js', 'dist/host.js'],
  ['dist/client.global.js', 'dist/client.js'],
]

for (const [from, to] of renames) {
  if (existsSync(from)) {
    renameSync(from, to)
    console.log(`Renamed: ${from} → ${to}`)
  }
}
