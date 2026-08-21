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
  return {
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
    prepareCall: async (config, signal) => {
      log.lastConfig = config
      return {
        stream: async function* () {
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
  const sandbox = { console, setTimeout, clearTimeout, Date, Promise, AbortController, btoa, atob, TextEncoder, TextDecoder }
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
const store = createSettings({ providers: {}, disabledProviders: {} })
const log = { section: () => store.doc() }
const llm = createLlm(log)
const cleanups = []
const ctx = {
  get: (name) => (
    name === 'settings' ? store
      : name === 'llm' ? llm
        : name === 'credentials' ? creds
          : undefined
  ),
  on: () => {},
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
assert(log.lastConfig && log.lastConfig.provider === 'my-gw' && log.lastConfig.model === 'gpt-4o' && log.lastConfig.maxTokens === 16, 'prepareCall config shape')

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
assert(cleanups.length === 1, 'one unload cleanup registered')
await Promise.resolve(cleanups[0]())
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

console.log('PASS: host end-to-end smoke — all assertions green')
