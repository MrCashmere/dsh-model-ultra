#!/usr/bin/env node
/**
 * Dev bootstrap for the HOST half — the closest thing to `cordis run host`
 * without a live DSH session: loads the REAL built `dist/host.js` into the
 * same kind of vm sandbox the DSH host runner evaluates it in, installs a
 * mock ctx (settings / llm / credentials), then drives a live demo:
 *
 *   1. RPC boot (create providers, set-route with weights)
 *   2. Router adapter stream (weighted strategy, session sticky)
 *   3. Composite providers (union / intersection) + stream
 *   4. Probe target + route stats + request log
 *
 * Run: node scripts/run-host.mjs     (build must be current: npm run build)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST_BUNDLE = path.join(__dirname, '..', 'dist', 'host.js')
const log = (...a) => console.log('[host]', ...a)

// ---------------------------------------------------------------------------
function createSettings(initialDocument) {
  let doc = structuredClone(initialDocument)
  return {
    doc: () => doc,
    get: (ns) => (ns === 'llm-pi-ai' ? doc : undefined),
    writable: true,
    replace: async (ns, section) => { if (ns !== 'llm-pi-ai') throw new Error('unexpected ns'); doc = section },
  }
}

function createLlm(trace) {
  const failProviders = new Set()
  const registrations = []
  return {
    failProviders,
    registrations,
    lastConfig: () => trace.last,
    listConfigurableProviders: () => [
      { settingsNs: 'llm-pi-ai', provider: 'deepseek', displayName: 'DeepSeek', declared: true },
      { settingsNs: 'llm-pi-ai', provider: 'anthropic', displayName: 'Anthropic', declared: true },
    ],
    discoverModels: async (ns, request) => {
      if (request.api === 'anthropic-messages') return []
      return [{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 }, { id: 'gpt-4o-mini', name: 'GPT-4o mini' }]
    },
    listModels: async (route) => {
      const p = (trace.section().providers || {})[route]
      const ids = Array.isArray(p?.models) ? p.models.map((m) => (m && typeof m === 'object' ? m.id : String(m))) : []
      return ids.map((id) => ({ id, name: id }))
    },
    registerAdapter: (providers, adapter) => {
      registrations.push({ providers: providers.slice(), adapter })
      log(`llm.registerAdapter(${JSON.stringify(providers)})`)
      return () => log('adapter unregistered')
    },
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, context: { contextWindow: 200000 } }),
    prepareCall: async (config) => {
      trace.last = config
      return {
        stream: async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: `pong(${config.provider}/${config.model})` }
          yield { type: 'finish', reason: 'stop' }
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const code = readFileSync(HOST_BUNDLE, 'utf8')
  const sandbox = { console, setTimeout, clearTimeout, Date, Promise, AbortController, TextEncoder, TextDecoder }
  sandbox.globalThis = sandbox
  sandbox.harness = { handle: (name, fn) => { sandbox.handles[name] = fn; log(`harness.handle('${name}')`) } }
  sandbox.handles = {}
  const { apply } = await vm.runInContext(`(async () => { ${code} })()`, vm.createContext(sandbox), { filename: 'cordis-dyn-host.js' })

  const store = createSettings({ providers: {}, disabledProviders: {}, sectionNote: { hello: 1 } })
  const trace = { section: () => store.doc(), last: null }
  const llm = createLlm(trace)
  const credStore = new Map()
  const creds = { resolve: async (ref) => ({ value: credStore.get(ref) }), set: async (ref, v) => { credStore.set(ref, v) }, unset: async (ref) => { credStore.delete(ref) } }
  const cleanups = []
  const ctx = {
    get: (name) => (name === 'settings' ? store : name === 'llm' ? llm : name === 'credentials' ? creds : undefined),
    on: () => () => {},
    // Cordis runs effects on stop, not immediately — keep cleanups queued.
    effect: (fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c) },
  }

  log('=== apply(ctx): booting host half ===')
  apply(ctx)
  const P = async (name, args) => sandbox.handles[name](args || {})
  const r = (p) => { log('<-', JSON.stringify(p)); return p }

  log('--- RPC: providers ---')
  await P('create-provider', { route: 'deepseek', baseURL: 'https://api.deepseek.com/v1', api: 'openai-completions', apiKeyEnv: 'DS_KEY' })
  await P('apply-models', { route: 'deepseek', models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }], mode: 'replace' })
  await P('create-provider', { route: 'anthropic', baseURL: 'https://api.anthropic.com/v1', api: 'anthropic-messages' })
  await P('apply-models', { route: 'anthropic', models: [{ id: 'claude-3-5-sonnet' }, { id: 'deepseek-chat', requestModel: 'claude-3-5-sonnet' }], mode: 'replace' })
  r(await P('list-providers'))

  log('--- RPC: set-route (weighted, weights 3:1, sticky) ---')
  r(await P('set-route', {
    alias: 'auto', strategy: 'weighted',
    targets: [
      { provider: 'deepseek', model: 'deepseek-chat', weight: 3 },
      { provider: 'anthropic', model: 'claude-3-5-sonnet', weight: 1 },
    ],
    config: { healthAware: true, sticky: true },
  }))
  r(await P('list-routes'))

  const routerAdapter = llm.registrations.find((x) => x.providers.includes('router'))?.adapter
  const compositeAdapter = llm.registrations.find((x) => x.providers.includes('composite'))?.adapter
  log(`adapter routes registered: router=${!!routerAdapter} composite=${!!compositeAdapter}`)

  log('--- stream via router adapter (weighted · first pick should be deepseek, weight 3) ---')
  for await (const c of routerAdapter.stream({ provider: 'router', model: 'auto', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], sessionId: 's1' })) {
    if (c?.type === 'text-delta') log('  chunk:', c.text)
  }
  log('  forwarded to:', JSON.stringify(llm.lastConfig()))

  log('--- RPC: composites (union + intersection) ---')
  r(await P('set-composite', { name: 'mixture', members: ['deepseek', 'anthropic'], mode: 'union', strategy: 'priority' }))
  r(await P('preview-composite', { name: 'mixture' }))
  r(await P('set-composite', { name: 'common', members: ['deepseek', 'anthropic'], mode: 'intersection', strategy: 'priority' }))
  r(await P('preview-composite', { name: 'common' }))

  log('--- stream via composite adapter (union: mixture::deepseek-chat) ---')
  for await (const c of compositeAdapter.stream({ provider: 'composite', model: 'mixture::deepseek-chat', messages: [] })) {
    if (c?.type === 'text-delta') log('  chunk:', c.text)
  }

  log('--- RPC: probe + stats + request log ---')
  r(await P('probe-target', { provider: 'deepseek', model: 'deepseek-chat' }))
  const stats = await P('get-route-stats')
  log('<- byRoute:', JSON.stringify(stats.byRoute), '| health:', JSON.stringify(stats.health))
  const logs = await P('list-request-logs')
  log('<- request log entries:', logs.entries.length)
  for (const e of logs.entries) log('   ', JSON.stringify(e))

  log('=== done: host half booted and exercised cleanly ===')
}

main().catch((e) => { console.error('RUN FAILED:', e); process.exit(1) })