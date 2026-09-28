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
 */
import { build } from 'esbuild'
import { writeFileSync, readFileSync } from 'node:fs'

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

async function buildHost() {
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
}

async function buildClient() {
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
  const body = result.outputFiles[0].text
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
