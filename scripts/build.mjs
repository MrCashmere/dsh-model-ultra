/**
 * Build script (esbuild) for static-bundle mode.
 *
 * Emits two artifacts matching the DSH static-plugin loader contract:
 *
 *   dist/host.js   — ESM. Imported by the plugin loader, which calls the
 *                    exported apply(ctx). Framework packages (@deepseek-ai/*,
 *                    cordis) are left EXTERNAL (resolved from the profile at
 *                    runtime); @noble/ciphers is bundled in.
 *
 *   dist/client.js — CJS body wrapped in the browser module-loader factory
 *                    `window.__ModuleLoader__.load({ id, factory })`. The
 *                    factory receives a synchronous `require`; `react` and the
 *                    DSH client-runtime packages are left external so they
 *                    resolve to the page's seeded modules.
 *
 * The esbuild JS API spawns a long-lived service child process over pipes. In
 * hardened/confined environments that spawn can be denied (`spawn EPERM`), so
 * every build first tries the API and then falls back to invoking the platform
 * binary directly — same options, same output, no service process.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs'

// The ModuleLoader bundle id must equal the package name, so read it instead of
// duplicating the literal (a rename then cannot drift).
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name

// Framework packages the runtime provides — never bundle these.
const HOST_EXTERNAL = [
  '@deepseek-ai/*',
  'cordis',
]
const CLIENT_EXTERNAL = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/*',
  'cordis',
]

/** Sharable CLI form of one build (kept in sync with the API options below). */
const HOST_CLI = [
  'src/host/index.ts',
  '--bundle', '--format=esm', '--platform=node', '--target=es2022',
  '--outfile=dist/host.js',
  ...HOST_EXTERNAL.flatMap((specifier) => ['--external:' + specifier]),
  '--log-level=warning',
]
const CLIENT_CLI = [
  'src/client/index.tsx',
  '--bundle', '--format=cjs', '--platform=browser', '--target=es2022',
  '--jsx=transform', '--jsx-factory=React.createElement', '--jsx-fragment=React.Fragment',
  '--outfile=dist/client.raw.js',
  ...CLIENT_EXTERNAL.flatMap((specifier) => ['--external:' + specifier]),
  '--log-level=warning',
]

/** True when esbuild could not start its service process (environment, not code). */
const isSpawnDenied = (error) =>
  error !== null && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES')

/** The installed platform binary, or undefined when only the JS API is present. */
function platformBinary() {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const name = `@esbuild/${process.platform}-${process.arch}/esbuild${suffix}`
  try {
    return import.meta.resolve(name).replace(/^file:\/\/\//, '')
  } catch {
    return undefined
  }
}

/**
 * Build through the platform binary. `stdio: 'inherit'` is deliberate: piping the
 * child is exactly what a confined environment denies, so the binary writes to
 * this process's own streams.
 */
function buildViaCli(args) {
  const binary = platformBinary()
  if (binary === undefined || !existsSync(binary)) {
    throw new Error(`esbuild could not start its service and no platform binary was found for ${process.platform}-${process.arch}`)
  }
  console.log(`build: esbuild service unavailable — using ${binary} directly`)
  execFileSync(binary, args, { stdio: 'inherit' })
}

async function buildHost() {
  try {
    await build({
      entryPoints: ['src/host/index.ts'],
      outfile: 'dist/host.js',
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      external: HOST_EXTERNAL,
      logLevel: 'info',
    })
  } catch (error) {
    if (!isSpawnDenied(error)) throw error
    buildViaCli(HOST_CLI)
  }
}

async function buildClient() {
  let body
  try {
    const result = await build({
      entryPoints: ['src/client/index.tsx'],
      write: false,
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      external: CLIENT_EXTERNAL,
      logLevel: 'info',
    })
    body = result.outputFiles[0].text
  } catch (error) {
    if (!isSpawnDenied(error)) throw error
    buildViaCli(CLIENT_CLI)
    body = readFileSync('dist/client.raw.js', 'utf8')
    // The intermediate is inside `files: ["dist"]`, so never leave it behind.
    rmSync('dist/client.raw.js', { force: true })
  }
  // Wrap the CJS body in the module-loader factory. `require` and a top-level
  // `React` binding are provided by the factory head, mirroring how other
  // static client bundles are shaped.
  const head =
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG)}, factory: (require) => { ` +
    `var module = { exports: {} }; var exports = module.exports; var React = require('react');\n`
  const tail = `\nreturn module.exports; } });\n`
  writeFileSync('dist/client.js', head + body + tail)
}

await buildHost()
await buildClient()

// Sanity: the client bundle must reference React so JSX renders.
const client = readFileSync('dist/client.js', 'utf8')
if (!client.includes("require('react')")) {
  throw new Error('client bundle missing react require')
}
console.log('build ok: dist/host.js (esm) + dist/client.js (__ModuleLoader__ factory)')
