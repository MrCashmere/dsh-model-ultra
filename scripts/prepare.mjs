/**
 * Cross-platform `prepare` hook.
 *
 * A git install carries `src/`, so the bundle must be built before the package
 * is usable (dist/ is gitignored and shipped only in the npm tarball). A
 * registry tarball already contains `dist/` and carries no `src/`, so there is
 * nothing to do.
 *
 * This replaces the previous POSIX-only `test -f src/host/index.ts && ...`,
 * which cannot run on Windows hosts (no `test`/`true` executables).
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const hostEntry = fileURLToPath(new URL('../src/host/index.ts', import.meta.url))

if (!existsSync(hostEntry)) process.exit(0)

const build = fileURLToPath(new URL('./build.mjs', import.meta.url))
const result = spawnSync(process.execPath, [build], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
