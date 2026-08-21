/**
 * Host half end-to-end smoke test.
 *
 * Loads the REAL built `dist/host.js` into a vm sandbox (the same way the
 * dsh-cordis-host-runner evaluates it: wrapped in an async function), with
 * realistic mocks for the `settings` service (persist-on-replace), the `llm`
 * service (listConfigurableProviders / discoverModels / listModels /
 * prepareCall+stream), and the sandboxed `ctx` (get / effect). Then exercises
 * every RPC handler and the unload-restore safety net, asserting each step.
 *
 * Run: `npm test`  (build must be current: `npm run build`)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST_BUNDLE = path.join(__dirname, '..', 'dist', 'host.js')

// ---------------------------------------------------------------------------
// mock settings service — mimics dsh-settings: get() returns the resolved
// section, replace() persists it (null-proto objects from makeHostPlain are
// JSON-safe and stored directly).
// ---------------------------------------------------------------------------
function createSettings(initialDocument) {
  let doc = structuredClone(initialDocument)
  return {
    doc: () => doc,
    get: (ns) => (ns === 'llm-pi-ai' ? doc : undefined),
    writable: true,
    replace: async (ns, section) => {
      if (ns !== 'llm-pi-ai') throw new Error('unexpected ns')
      doc = section
    },
  }
}

// ---------------------------------------------------------------------------
// mock llm service — a catalog provider + an open gateway; prepareCall emits a
// tiny stream like the real pi-ai adapter does.
// ---------------------------------------------------------------------------
function createLlm(log = []) {
  const catalog = [
    { settingsNs: 'llm-pi-ai', provider: 'deepseek', displayName: 'DeepSeek', declared: true },
    { settingsNs: 'llm-pi-ai', provider: 'anthropic', displayName: 'Anthropic', declared: true },
  ]
  const registrations = []
  const failProviders = new Set()
  return {
    registrations,
    failProviders,
    listConfigurableProviders: () => catalog,
    discoverModels: async (ns, request) => {
      if (request.api === 'anthropic-messages') return []
      if (!request.baseURL) throw new Error('no baseURL')
      return [{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 }, { id: 'gpt-4o-mini', name: 'GPT-4o mini' }]
    },
    listModels: async (route) => {
      const p = (log.section().providers || {})[route]
      const ids = Array.isArray(p?.models)
        ? p.models.map((m) => m && typeof m === 'object' ? m.id : String(m))
        : route === 'deepseek' ? ['deepseek-chat', 'deepseek-reasoner'] : []
      return ids.map((id) => ({ id, name: id }))
    },
    registerAdapter: (providers, adapter) => {
      registrations.push({ providers: providers.slice(), adapter })
      return () => {
        const i = registrations.findIndex((r) => r.adapter === adapter)
        if (i >= 0) registrations.splice(i, 1)
      }
    },
    resolveModelInfo: async (provider, model) =>
      ({ provider, id: model, name: model, context: { contextWindow: 200000 } }),
    prepareCall: async (config, signal) => {
      if (failProviders.has(config.provider)) throw new Error(`mock provider ${config.provider} is down`)
      log.lastConfig = config
      // Mirror the real llm runtime: prepareCall exposes the RESOLVED config,
      // and stream() must be dispatched with a config that matches it on the
      // compared fields — the handler now echoes prepared.config back.
      return {
        config: { ...config },
        stream: async function* (opts) {
          log.lastStreamOpts = opts
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'pong' }
          yield { type: 'finish', reason: 'stop' }
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// load the bundle like the DSH host runner does
// ---------------------------------------------------------------------------
async function loadHost() {
  const code = readFileSync(HOST_BUNDLE, 'utf8')
  // btoa/atob are injected by the real host sandbox too; deliberately no
  // `crypto` here so the smoke exercises the bundled pure-JS AES fallback
  // (the dynamic sandbox withholds WebCrypto).
  // No `crypto`, and deliberately NO btoa/atob here either — the plugin's base64
  // is implemented by hand and must not depend on either. TextEncoder/Decoder
  // are injected by the real host sandbox too.
  const sandbox = { console, setTimeout, clearTimeout, Date, Promise, AbortController, TextEncoder, TextDecoder }
  sandbox.globalThis = sandbox
  sandbox.harness = { handle: (name, fn) => { sandbox.handles[name] = fn } }
  sandbox.handles = {}
  const result = await vm.runInContext(`(async () => { ${code} })()`, vm.createContext(sandbox), {
    filename: 'cordis-dyn-host.js',
  })
  return { apply: (result.apply ? result : result.default).apply, handles: sandbox.handles }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`)
}

// ---------------------------------------------------------------------------
// mock credentials service — an in-memory secret store keyed by ref name.
// ---------------------------------------------------------------------------
const credStore = new Map()
const creds = {
  resolve: async (ref) => ({ value: credStore.get(ref) }),
  set: async (ref, value) => { credStore.set(ref, value) },
  unset: async (ref) => { credStore.delete(ref) },
}

// ---------------------------------------------------------------------------
const store = createSettings({ providers: {}, disabledProviders: {}, sectionNote: { hello: 1 } })
const log = { section: () => store.doc() }
const llm = createLlm(log)
const cleanups = []
const listeners = {}
const ctx = {
  get: (name) => (
    name === 'settings' ? store
      : name === 'llm' ? llm
        : name === 'credentials' ? creds
          : undefined
  ),
  on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return () => {} },
  effect: (fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c) },
}
const { apply, handles } = await loadHost()
apply(ctx)

const H = handles
const P = async (name, args) => H[name](args || {})
const provs = () => store.doc().providers || {}
const dis = () => store.doc().disabledProviders || {}

// --- list on empty ---
let r = await P('list-providers')
assert(r.ok && r.providers.length === 0, 'list on empty')
assert(Array.isArray(r.protocols) && r.protocols.includes('openai-completions'), 'protocols returned')

// --- create (validates route + baseURL) ---
r = await P('create-provider', { route: 'my-gw', displayName: 'My Gateway', api: 'openai-completions', baseURL: 'https://gw/v1', apiKeyEnv: 'GW_KEY' })
assert(r.ok, 'create ok: ' + JSON.stringify(r))
assert(/^[A-Za-z0-9_.-]+$/.test(provs()['my-gw'] && 'my-gw'), 'route format kept')
assert(Array.isArray(provs()['my-gw'].models) && provs()['my-gw'].models.length === 1, 'placeholder model added')

r = await P('create-provider', { route: 'bad/', baseURL: 'https://x' })
assert(!r.ok && /字母|route/.test(r.error || ''), 'invalid route rejected')

// --- duplicate ---
r = await P('create-provider', { route: 'my-gw', baseURL: 'https://x' })
assert(!r.ok, 'duplicate route rejected')

// --- list shows active ---
r = await P('list-providers')
assert(r.providers.length === 1 && r.providers[0].disabled === false, 'list shows active provider')

// --- update-field ---
r = await P('update-field', { route: 'my-gw', field: 'baseURL', value: 'https://gw/v2' })
assert(r.ok && provs()['my-gw'].baseURL === 'https://gw/v2', 'update-field persisted')
r = await P('update-field', { route: 'my-gw', field: 'nope', value: 'x' })
assert(!r.ok, 'unknown field rejected')

// --- update-headers (auth skipped) ---
r = await P('update-headers', { route: 'my-gw', headers: [{ name: 'X-Trace', value: 'abc' }, { name: 'authorization', value: 'Bearer x' }] })
assert(r.ok && r.headerCount === 1 && provs()['my-gw'].headers['X-Trace'] === 'abc' && !provs()['my-gw'].headers.authorization, 'headers saved, auth skipped')

// --- discover ---
r = await P('discover-models', { route: 'my-gw', baseURL: 'https://gw/v2', api: 'openai-completions' })
assert(r.ok && r.models.length === 2 && r.models[0].id === 'gpt-4o', 'discover returns models')

// --- apply-models replace ---
r = await P('apply-models', { route: 'my-gw', models: r.models, mode: 'replace' })
assert(r.ok && r.count === 2 && provs()['my-gw'].models.length === 2, 'apply-models replace persisted')

// --- get with availableModels ---
r = await P('get-provider', { route: 'my-gw' })
assert(r.ok && r.disabled === false && r.models.length === 2 && r.availableModels.includes('gpt-4o'), 'get returns models + availableModels')

// --- test-provider (enabled) ---
r = await P('test-provider', { route: 'my-gw', model: 'gpt-4o', prompt: 'ping', maxTokens: 32 })
assert(r.ok && r.reply === 'pong' && r.stopReason === 'stop' && r.latencyMs >= 0, 'test-provider runs: ' + JSON.stringify(r))
assert(log.lastConfig && log.lastConfig.provider === 'my-gw' && log.lastConfig.model === 'gpt-4o' && log.lastConfig.maxTokens === 32, 'prepareCall config shape')
// prepareCall config and the dispatched stream() options must agree on the
// compared fields (this drift was the "prepared LLM call config changed" bug).
assert(log.lastStreamOpts && log.lastStreamOpts.maxTokens === log.lastConfig.maxTokens && log.lastStreamOpts.provider === log.lastConfig.provider && log.lastStreamOpts.model === log.lastConfig.model, 'stream() options match prepared config: ' + JSON.stringify(log.lastStreamOpts))

// --- test-provider on unknown provider ---
r = await P('test-provider', { route: 'ghost' })
assert(!r.ok, 'test unknown route rejected')

// --- set-api-key: encrypted at rest + authoritative copy in credentials ---
const KEY_A = 'sk-test-secret-AAAA'
const KEY_B = 'sk-test-secret-BBBB'
r = await P('set-api-key', { route: 'my-gw', apiKey: KEY_A })
assert(r.ok && r.stored === true && r.envRef === 'GW_KEY', 'set-api-key stores: ' + JSON.stringify(r))
assert(provs()['my-gw'].apiKeyEnc && typeof provs()['my-gw'].apiKeyEnc.ct === 'string', 'apiKeyEnc snapshot written')
assert(!JSON.stringify(provs()['my-gw'].apiKeyEnc).includes('secret-AAAA'), 'plaintext never lands in the config')
assert(credStore.get('GW_KEY') === KEY_A, 'authoritative copy stored in credentials service')
const encKey1 = credStore.get('DSH_MODEL_PRO_ENC_KEY')
assert(typeof encKey1 === 'string' && encKey1.length > 32, 'random encryption key seeded in credentials service')

r = await P('get-provider', { route: 'my-gw' })
assert(r.ok && r.hasSecret === true && r.secret === undefined, 'hasSecret reported, secret hidden by default')
r = await P('get-provider', { route: 'my-gw', includeSecret: true })
assert(r.ok && r.secret === KEY_A, 'get includeSecret decrypts: ' + JSON.stringify(r))
r = await P('list-providers')
assert(r.providers.find((x) => x.route === 'my-gw').hasSecret === true, 'list flags hasSecret')

// --- reinstall stability: enc key is NEVER regenerated, old ciphertext still
// decrypts with the same key (simulate reinstall = settings/credentials persist,
// plugin closure gone; restore the OLD snapshot into the profile). ---
const blobA = structuredClone(provs()['my-gw'].apiKeyEnc)
await P('set-api-key', { route: 'my-gw', apiKey: KEY_B })
assert(credStore.get('DSH_MODEL_PRO_ENC_KEY') === encKey1, 'encryption key unchanged across saves (reinstall-stable)')
assert(credStore.get('GW_KEY') === KEY_B, 'credentials updated to new key')
r = await P('get-provider', { route: 'my-gw', includeSecret: true })
assert(r.ok && r.secret === KEY_B, 'new key decrypts after re-save')
// put the old snapshot back, as a reinstall would (config file unchanged)
store.doc().providers['my-gw'].apiKeyEnc = blobA
r = await P('get-provider', { route: 'my-gw', includeSecret: true })
assert(r.ok && r.secret === KEY_A, 'OLD ciphertext decrypted after reinstall-style restore: ' + JSON.stringify(r))

// --- clear key ---
r = await P('set-api-key', { route: 'my-gw', apiKey: '' })
assert(r.ok && r.stored === false, 'clear key ok')
assert(!provs()['my-gw'].apiKeyEnc, 'clear removes encrypted snapshot')
assert(credStore.get('GW_KEY') === undefined, 'clear removes credential copy')

// --- non-ASCII secret: byte-exact base64 round trip (rejects UTF-8 mangling
// regressions like the real sandbox's utf-8-semanics btoa) ---
const KEY_UA = 'sk-密钥-秘密-secret-中文🙂'
r = await P('set-api-key', { route: 'my-gw', apiKey: KEY_UA })
assert(r.ok && r.stored === true, 'set non-ascii key ok')
r = await P('get-provider', { route: 'my-gw', includeSecret: true })
assert(r.ok && r.secret === KEY_UA, 'non-ascii secret round-trips byte-exact: ' + JSON.stringify(r))
await P('set-api-key', { route: 'my-gw', apiKey: '' }) // leave clean for later sections

// --- disable -> list/get/test ---
r = await P('toggle-provider', { route: 'my-gw', enabled: false })
assert(r.ok && Object.hasOwn(dis(), 'my-gw') && !Object.hasOwn(provs(), 'my-gw'), 'disable moved to disabledProviders')
r = await P('list-providers')
const li = r.providers.find((p) => p.route === 'my-gw')
assert(li && li.disabled === true, 'list flags disabled')
r = await P('get-provider', { route: 'my-gw' })
assert(r.ok && r.disabled === true, 'get flags disabled')
r = await P('test-provider', { route: 'my-gw', model: 'gpt-4o' })
assert(!r.ok && /启用/.test(r.error || ''), 'test on disabled rejected: ' + r.error)

// --- headers/field/model edits still work while disabled ---
r = await P('update-headers', { route: 'my-gw', headers: [] })
assert(r.ok && !dis()['my-gw'].headers, 'headers editable while disabled')

// --- re-enable & test again ---
await P('toggle-provider', { route: 'my-gw', enabled: true })
r = await P('test-provider', { route: 'my-gw', model: 'gpt-4o' })
assert(r.ok && r.reply === 'pong', 'test works after re-enable')

// --- unload safety net: disable a provider, then "uninstall the plugin" ---
await P('toggle-provider', { route: 'my-gw', enabled: false })
assert(Object.hasOwn(dis(), 'my-gw'), 'pre-condition: parked in disabledProviders')
// Re-write the custom header (the earlier "headers editable while disabled"
// check cleared it — update-headers with [] deletes the headers key), so the
// restore check below has real data to verify survives intact.
r = await P('update-headers', { route: 'my-gw', headers: [{ name: 'X-Trace', value: 'abc' }] })
assert(r.ok && dis()['my-gw'].headers && dis()['my-gw'].headers['X-Trace'] === 'abc', 're-arm headers before unload test')
const before = { models: dis()['my-gw'].models.length, headers: dis()['my-gw'].headers, key: dis()['my-gw'].apiKeyEnv }
assert(cleanups.length >= 2, 'unload + router effects registered')
const unloadCleanup = cleanups[cleanups.length - 1]
await Promise.resolve(unloadCleanup())
assert(Object.hasOwn(provs(), 'my-gw'), 'unload restored disabled provider to providers')
assert(!Object.hasOwn(dis(), 'my-gw'), 'unload emptied disabledProviders')
const restored = provs()['my-gw']
assert(restored.models.length === before.models && restored.headers && restored.headers['X-Trace'] === 'abc' && restored.apiKeyEnv === before.key, 'restored data fully intact')
const kept = provs()
assert(!Object.hasOwn(kept, 'deepseek'), 'catalog routes untouched by restore')

// --- delete now that it is active ---
r = await P('delete-provider', { route: 'my-gw' })
assert(r.ok && !Object.hasOwn(provs(), 'my-gw') && !Object.hasOwn(dis(), 'my-gw'), 'delete removes from both dicts')
r = await P('delete-provider', { route: 'my-gw' })
assert(!r.ok, 'delete missing route rejected')

// --- section foreign keys are preserved across every write ---
assert(store.doc().sectionNote && store.doc().sectionNote.hello === 1, 'section foreign keys preserved across writes')

// --- disabled marker lives ON THE PROVIDER PROFILE (not only the dict) ---
await P('create-provider', { route: 'flag-gw', baseURL: 'https://flag/v1' })

// disable -> marker set + parked out of providers
r = await P('toggle-provider', { route: 'flag-gw', enabled: false })
assert(r.ok, 'disable ok')
assert(dis()['flag-gw'] && dis()['flag-gw'].disabled === true, 'disable sets the disabled marker on the profile')
assert(!Object.hasOwn(provs(), 'flag-gw'), 'disabled provider parked out of providers (adapter stops seeing it)')
r = await P('list-providers')
assert(r.providers.find((x) => x.route === 'flag-gw').disabled === true, 'list shows disabled from the marker')

// unload: disabledProviders restored to providers, marker INTACT
await Promise.resolve(cleanups[cleanups.length - 1]())
assert(provs()['flag-gw'] && provs()['flag-gw'].disabled === true, 'unload restores to providers keeping the disabled marker')
assert(!Object.hasOwn(dis(), 'flag-gw'), 'unload empties disabledProviders')
r = await P('list-providers')
assert(r.providers.find((x) => x.route === 'flag-gw').disabled === true, 'still shown disabled (marker) after restore')

// reinstall: a fresh apply re-parks marked providers -> same disabled state
apply(ctx)
await new Promise((res) => setTimeout(res, 5))
assert(Object.hasOwn(dis(), 'flag-gw') && dis()['flag-gw'].disabled === true, 'reinstall re-parks the marked provider')
r = await P('list-providers')
assert(r.providers.find((x) => x.route === 'flag-gw').disabled === true, 'reinstall list still disabled')

// enable: clears the marker and returns it to providers
r = await P('toggle-provider', { route: 'flag-gw', enabled: true })
assert(r.ok && provs()['flag-gw'] && !provs()['flag-gw'].disabled, 'enable clears the disabled marker')
await P('delete-provider', { route: 'flag-gw' })

// --- smart routing: named route combos + router adapter forwarding ---
r = await P('set-route', { alias: 'auto', strategy: 'priority', targets: [{ provider: 'opencode-go', model: 'deepseek-v4-flash' }] })
assert(r.ok, 'set-route ok: ' + JSON.stringify(r))
r = await P('set-route', { alias: 'bad route', strategy: 'priority', targets: [{ provider: 'x', model: 'y' }] })
assert(!r.ok, 'invalid route name rejected')
r = await P('set-route', { alias: 'empty', strategy: 'priority', targets: [] })
assert(!r.ok, 'empty targets rejected')
r = await P('list-routes')
assert(r.ok && r.routes.auto && r.routes.auto.strategy === 'priority' && r.routes.auto.targets[0].provider === 'opencode-go' && r.routes.auto.targets[0].model === 'deepseek-v4-flash', 'list-routes returns route combo: ' + JSON.stringify(r.routes))
assert(store.doc().routes && store.doc().routes.auto && store.doc().routes.auto.targets[0].model === 'deepseek-v4-flash', 'routes persisted under the section foreign key')
assert(store.doc().sectionNote && store.doc().sectionNote.hello === 1, 'route write preserves other section keys')

const rreg = llm.registrations.find((x) => x.providers.includes('router'))
assert(rreg && rreg.adapter, 'router adapter registered for route [router]')
const rm = await rreg.adapter.listModels('router')
assert(Array.isArray(rm) && rm.some((m) => m.id === 'auto'), 'router lists named routes as models')
const rinfo = await rreg.adapter.resolveModel('router', 'auto')
assert(rinfo && rinfo.id === 'auto' && rinfo.context && rinfo.context.contextWindow === 200000, 'router resolves route to first target metadata')
let sawPong = false
let guard = 0
for await (const c of rreg.adapter.stream({
  provider: 'router', model: 'auto',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
  temperature: 0, maxTokens: 16, signal: undefined,
})) {
  if (c && c.type === 'text-delta' && c.text === 'pong') sawPong = true
  if (++guard >= 4) break
}
assert(log.lastConfig && log.lastConfig.provider === 'opencode-go' && log.lastConfig.model === 'deepseek-v4-flash', 'router stream forwarded to target: ' + JSON.stringify(log.lastConfig))
assert(sawPong, 'router stream passes through target chunks')

// --- priority + fallback: a dead first target is skipped ---
llm.failProviders.add('brokengw')
await P('set-route', {
  alias: 'auto', strategy: 'priority',
  targets: [
    { provider: 'brokengw', model: 'x' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  ],
})
let sawPong2 = false
let guard2 = 0
for await (const c of rreg.adapter.stream({
  provider: 'router', model: 'auto',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
  temperature: 0, maxTokens: 16,
})) {
  if (c && c.type === 'text-delta' && c.text === 'pong') sawPong2 = true
  if (++guard2 >= 4) break
}
assert(log.lastConfig && log.lastConfig.provider === 'opencode-go' && log.lastConfig.model === 'deepseek-v4-flash', 'router fell back to healthy target: ' + JSON.stringify(log.lastConfig))
assert(sawPong2, 'fallback target streams through')
llm.failProviders.delete('brokengw')

// --- all targets dead -> clean route-level error (no infinite hang) ---
llm.failProviders.add('brokengw')
await P('set-route', { alias: 'dead', strategy: 'priority', targets: [{ provider: 'brokengw', model: 'x' }] })
let deadErr = ''
try {
  const it2 = rreg.adapter.stream({ provider: 'router', model: 'dead', messages: [], signal: undefined })
  const itr = it2[Symbol.asyncIterator]()
  let seen = 0
  while (seen < 3) { const n = await itr.next(); if (n.done) break; seen += 1 }
} catch (e) { deadErr = String((e && e.message) || e) }
assert(/全部目标失败/.test(deadErr), 'all-targets-dead surfaces route error: ' + deadErr)
llm.failProviders.delete('brokengw')

// --- per-provider local mapping: select gpt-4o, forward its requestModel ---
await P('create-provider', { route: 'map-gw', baseURL: 'https://map/v1' })
r = await P('apply-models', { route: 'map-gw', models: [{ id: 'gpt-4o', requestModel: 'wire-4o' }], mode: 'replace' })
assert(r.ok === true, 'requestModel saved on model entry')
const streamListeners = listeners['llm/stream'] || []
assert(streamListeners.length >= 1, 'llm/stream waterfall listener registered')
let forwarded = null
const firstListener = streamListeners[0]
const ret = firstListener(
  { provider: 'map-gw', model: 'gpt-4o', messages: [], temperature: 0 },
  (opts) => { forwarded = opts; return 'NEXTED' },
)
assert(forwarded && forwarded.model === 'wire-4o', 'llm/stream rewrites selectable id to wire id: ' + JSON.stringify(forwarded))
assert(typeof ret === 'string' && ret === 'NEXTED', 'rewrite returns next() result')
// a model without requestModel passes through unchanged
streamListeners[0]({ provider: 'map-gw', model: 'plain', messages: [] }, (opts) => { forwarded = opts })
assert(forwarded.model === 'plain', 'unmapped model passes through unchanged')
// router-provider calls are never rewritten
streamListeners[0]({ provider: 'router', model: 'auto', messages: [] }, (opts) => { forwarded = opts })
assert(forwarded.model === 'auto', 'router calls bypass the rewrite')
await P('delete-provider', { route: 'map-gw' })

// deleting a route must work even when the resolved section object is frozen
// (regression: readRoutes used to return the frozen settings object, so
// `delete routes['0']` threw "Cannot delete property of [object Object]")
Object.freeze(store.doc().routes)
r = await P('delete-route', { alias: 'auto' })
assert(r.ok && !(await P('list-routes')).routes.auto, 'delete-route removes mapping on frozen section')
r = await P('delete-route', { alias: 'dead' })
assert(r.ok, 'delete-route removes dead route on frozen section')

// ---------------------------------------------------------------------------
// NEW: multi-strategy routes + route weights
// ---------------------------------------------------------------------------

// --- weighted route: weights accepted and preserved, strategy validated ---
r = await P('set-route', {
  alias: 'wb', strategy: 'round-robin',
  targets: [
    { provider: 'opencode-go', model: 'deepseek-v4-flash', weight: 3 },
    { provider: 'opencode-go', model: 'deepseek-v4-flash-2', weight: 1, enabled: true },
  ],
})
assert(r.ok, 'set-route accepts weights + round-robin: ' + JSON.stringify(r))
const wb = (await P('list-routes')).routes.wb
assert(wb.strategy === 'round-robin' && wb.targets[0].weight === 3 && wb.targets[1].weight === 1, 'route weights persisted')

r = await P('set-route', { alias: 'badstrat', strategy: 'quantum', targets: [{ provider: 'x', model: 'y' }] })
assert(r.ok && r.route.strategy === 'priority', 'unknown strategy falls back to priority (tolerant): ' + JSON.stringify(r))
await P('delete-route', { alias: 'badstrat' })

// --- round-robin rotates across same-provider targets with weights ---
llm.failProviders.delete('opencode-go')
const wbStream = async () => {
  let got = ''
  for await (const c of rreg.adapter.stream({ provider: 'router', model: 'wb', messages: [], temperature: 0 })) {
    if (c && c.type === 'text-delta' && c.text === 'pong') got = 'pong'
  }
  return got
}
assert((await wbStream()) === 'pong', 'round-robin route streams')
assert(log.lastConfig && log.lastConfig.model === 'deepseek-v4-flash', 'first round-robin pick = highest weight: ' + JSON.stringify(log.lastConfig))

// --- health-aware: a down target is skipped when a healthy one exists ---
llm.failProviders.add('brokengw')
await P('probe-target', { provider: 'brokengw', model: 'x' })
await P('set-route', {
  alias: 'healthz', strategy: 'priority',
  targets: [
    { provider: 'brokengw', model: 'x' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  ],
})
let gotHealth = ''
for await (const c of rreg.adapter.stream({ provider: 'router', model: 'healthz', messages: [], signal: undefined })) {
  if (c && c.type === 'text-delta' && c.text === 'pong') gotHealth = 'pong'
}
assert(log.lastConfig && log.lastConfig.provider === 'opencode-go', 'health-aware skips probe-down target: ' + JSON.stringify(log.lastConfig))
assert(gotHealth === 'pong', 'health-aware streams through healthy target')
llm.failProviders.delete('brokengw')

// --- min-latency strategy: order by recorded latency, lowest first ---
await P('set-route', {
  alias: 'ml', strategy: 'min-latency',
  targets: [
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash-2' },
  ],
})
let gotMl = ''
for await (const c of rreg.adapter.stream({ provider: 'router', model: 'ml', messages: [] })) {
  if (c && c.type === 'text-delta' && c.text === 'pong') gotMl = 'pong'
}
assert(gotMl === 'pong', 'min-latency route streams')
await P('delete-route', { alias: 'wb' })
await P('delete-route', { alias: 'healthz' })
await P('delete-route', { alias: 'ml' })

// ---------------------------------------------------------------------------
// NEW: composite providers (并集/交集)
// ---------------------------------------------------------------------------

// --- union composite of two explicit-model providers ---
await P('create-provider', { route: 'comp-a', baseURL: 'https://a/v1' })
await P('apply-models', { route: 'comp-a', models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }], mode: 'replace' })
await P('create-provider', { route: 'comp-b', baseURL: 'https://b/v1' })
await P('apply-models', { route: 'comp-b', models: [{ id: 'gpt-4o' }, { id: 'claude-3' }], mode: 'replace' })

r = await P('set-composite', { name: 'mixture', members: ['comp-a', 'comp-b'], mode: 'union', strategy: 'priority' })
assert(r.ok, 'set-composite union ok: ' + JSON.stringify(r))
r = await P('set-composite', { name: 'solo', members: ['comp-a'] })
assert(!r.ok, 'composite with 1 member rejected')
r = await P('set-composite', { name: 'ghost', members: ['comp-a', 'nope'] })
assert(!r.ok && /不存在/.test(r.error || ''), 'composite with unknown member rejected')

r = await P('list-composites')
assert(r.ok && r.composites.mixture && r.composites.mixture.mode === 'union', 'list-composites returns mixture')
r = await P('preview-composite', { name: 'mixture' })
assert(r.ok && r.mode === 'union', 'preview union ok')
assert(Array.isArray(r.ids) && r.ids.length === 3 && r.ids.includes('gpt-4o') && r.ids.includes('gpt-4o-mini') && r.ids.includes('claude-3'), 'union resolves all member models: ' + JSON.stringify(r.ids))

// intersection: only ids present in every member
r = await P('set-composite', { name: 'common', members: ['comp-a', 'comp-b'], mode: 'intersection' })
assert(r.ok, 'set-composite intersection ok')
r = await P('preview-composite', { name: 'common' })
assert(r.ok && r.mode === 'intersection' && Array.isArray(r.ids) && r.ids.length === 1 && r.ids[0] === 'gpt-4o', 'intersection resolves shared model only: ' + JSON.stringify(r.ids))

// composite route is registered and streams through a member
const creg = llm.registrations.find((x) => x.providers.includes('composite'))
assert(creg && creg.adapter, 'composite adapter registered for route [composite]')
const cm = await creg.adapter.listModels('composite')
assert(Array.isArray(cm) && cm.some((m) => m.id === 'mixture::gpt-4o') && cm.some((m) => m.id === 'common::gpt-4o'), 'composite lists encoded models: ' + JSON.stringify(cm.map((m) => m.id)))
let gotComp = ''
for await (const c of creg.adapter.stream({ provider: 'composite', model: 'mixture::gpt-4o', messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }], temperature: 0 })) {
  if (c && c.type === 'text-delta' && c.text === 'pong') gotComp = 'pong'
}
assert(gotComp === 'pong', 'composite streams through owning member')
assert(log.lastConfig && (log.lastConfig.provider === 'comp-a' || log.lastConfig.provider === 'comp-b') && log.lastConfig.model === 'gpt-4o', 'composite forwards to owning member: ' + JSON.stringify(log.lastConfig))

// composite stats + request log recorded
r = await P('get-route-stats')
assert(r.ok && r.byTarget, 'get-route-stats ok')
const targetKey = Object.keys(r.byTarget || {}).find((k) => k.includes('gpt-4o'))
assert(targetKey && r.byTarget[targetKey].calls >= 1, 'routed call recorded in stats: ' + JSON.stringify(r.byTarget[targetKey]))
r = await P('list-request-logs')
assert(r.ok && Array.isArray(r.entries) && r.entries.length >= 1, 'request log has routed entries')
const compLog = r.entries.find((e) => e.route === 'mixture::gpt-4o')
assert(compLog && compLog.status === 'ok' && typeof compLog.latencyMs === 'number', 'composite log entry recorded: ' + JSON.stringify(compLog))
r = await P('clear-request-logs')
assert(r.ok && (await P('list-request-logs')).entries.length === 0, 'clear-request-logs empties ring')

// probe-target marks up a healthy target
r = await P('probe-target', { provider: 'comp-a', model: 'gpt-4o' })
assert(r.ok && r.latencyMs >= 0, 'probe-target ok: ' + JSON.stringify(r))
r = await P('probe-target', { provider: 'ghost', model: 'x' })
assert(!r.ok, 'probe unknown provider rejected')
r = await P('get-route-stats')
assert(r.ok && r.health && Object.keys(r.health).length >= 1, 'probe health recorded')

// disabled member is excluded from composite resolution (intersection over the
// remaining ENABLED members = comp-a's own models here)
await P('toggle-provider', { route: 'comp-b', enabled: false })
r = await P('preview-composite', { name: 'common' })
assert(r.ok && r.ids.length === 2 && r.ids.includes('gpt-4o') && r.ids.includes('gpt-4o-mini'), 'disabled member excluded from intersection: ' + JSON.stringify(r.ids))
await P('toggle-provider', { route: 'comp-b', enabled: true })

// cleanup composites + providers
await P('delete-composite', { name: 'mixture' })
await P('delete-composite', { name: 'common' })
await P('delete-provider', { route: 'comp-a' })
await P('delete-provider', { route: 'comp-b' })

console.log('PASS: host end-to-end smoke — all assertions green')
