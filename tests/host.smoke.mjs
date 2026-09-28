/**
 * Host half end-to-end smoke test.
 *
 * Loads the REAL built `dist/host.js` into a vm sandbox (the same way the
 * dsh-cordis-host-runner evaluates it: wrapped in an async function), with
 * realistic mocks for the `settings` service (dsh 0.2.0-rc.1 shape: no get(),
 * describe() + schema-validated replace(), volatile-only writes), the `llm`
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
// mock settings service — mimics dsh-settings on dsh 0.2.0-rc.1:
//   - there is NO get(ns). describe() exposes each entry with `value` (the
//     RESOLVED, schema-parsed config) and `user` (the raw profile-patch config).
//   - replace(ns, section) is validated against the entry's Config: only
//     VOLATILE paths are writable. `llm-pi-ai` declares exactly one volatile
//     field (`providers`); the plugin's own entry (STATE_NS) declares the five
//     state keys. Writing a foreign key into `llm-pi-ai` throws, exactly like
//     the real service ("Config field \"...\" is not volatile").
//   - keys already present in a section's raw config survive a write (the real
//     service strips only volatile fields before merging).
// `value` for `llm-pi-ai` deliberately DROPS provider-profile fields pi-ai's
// schema does not declare (apiKeyEnc/disabled/...) — reading `value` instead of
// `user` would silently lose them, which is the regression this mock guards.
// ---------------------------------------------------------------------------
const NS = 'llm-pi-ai'
const STATE_NS = 'dsh-model-ultra'
const STATE_KEYS = ['disabledProviders', 'routes', 'composites', 'routeStats', 'uiPrefs', 'openrouter']
/** Fields llm-pi-ai's provider-profile schema declares (see its config.ts). */
const PROFILE_FIELDS = new Set([
  'apiKeyEnv', 'displayName', 'api', 'baseURL', 'models', 'modelOverrides', 'compat',
  'defaultContextWindow', 'defaultMaxTokens', 'defaultInput', 'headers', 'reasoning',
  'thinkingBudgets', 'cacheRetention', 'transport', 'timeoutMs', 'websocketConnectTimeoutMs',
  'streamIdleTimeoutMs', 'maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes',
  'retryPolicy',
])

function parseProviders(providers) {
  return Object.fromEntries(Object.entries(providers || {}).map(([route, profile]) => [
    route,
    Object.fromEntries(Object.entries(profile || {}).filter(([field]) => PROFILE_FIELDS.has(field))),
  ]))
}

function createSettings(initialSection = {}) {
  const holder = { section: structuredClone(initialSection), state: {} }
  return {
    /** Merged view of both sections (llm-pi-ai + this plugin's own state). */
    doc: () => ({ ...holder.section, ...holder.state }),
    /** The llm-pi-ai section alone. */
    section: () => holder.section,
    /** This plugin's own settings section alone. */
    state: () => holder.state,
    get writable() { return true },
    describe: () => [
      {
        ns: NS,
        user: structuredClone(holder.section),
        value: { ...structuredClone(holder.section), providers: parseProviders(holder.section.providers) },
      },
      { ns: STATE_NS, user: structuredClone(holder.state), value: structuredClone(holder.state) },
    ],
    replace: async (ns, section) => {
      const input = JSON.parse(JSON.stringify(section))
      if (ns === NS) {
        for (const key of Object.keys(input)) {
          if (key !== 'providers') throw new Error(`Config field "${key}" is not volatile`)
        }
        holder.section = { ...holder.section, providers: input.providers || {} }
        return
      }
      if (ns === STATE_NS) {
        for (const key of Object.keys(input)) {
          if (!STATE_KEYS.includes(key)) throw new Error(`Config field "${key}" is not volatile`)
        }
        // replace() resets every volatile field of the entry before merging, so
        // the input IS the stored snapshot: omitted keys are dropped.
        holder.state = input
        return
      }
      throw new Error(`No configurable plugin entry "${ns}"`)
    },
  }
}

/**
 * A settings wrapper that models the REAL dsh-settings timing: the `llm-pi-ai`
 * row is absent from describe() until the owning plugin (llm-pi-ai) registers
 * its section, then it appears. This is the reinstall race — model-pro may
 * apply BEFORE pi-ai, read nothing, and (before the fix) silently skip the
 * re-park of disabled-marked providers sitting in `providers`.
 */
function createLateSettings(store) {
  let registered = false
  const fire = (ns) => { for (const fn of listeners['settings/document-updated'] || []) try { fn(ns, 1) } catch { /* ignore */ } }
  return {
    get registered() { return registered },
    register: () => {
      registered = true
      // Commit fires the document-updated event for the namespace, like dsh-settings.
      queueMicrotask(() => fire('llm-pi-ai'))
    },
    get writable() { return store.writable },
    doc: () => store.doc(),
    section: () => store.section(),
    state: () => store.state(),
    describe: () => store.describe().filter((row) => registered || row.ns !== NS),
    replace: (ns, section) => store.replace(ns, section),
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
  // Per-provider scripted streams — mimic the REAL pi-ai adapter, which never
  // throws for an unreachable provider: it yields [usage] then finish(error).
  const scriptedStreams = new Map()
  return {
    registrations,
    failProviders,
    scriptedStreams,
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
      const scripted = scriptedStreams.get(config.provider)
      // Mirror the real llm runtime: prepareCall exposes the RESOLVED config,
      // and stream() must be dispatched with a config that matches it on the
      // compared fields — the handler now echoes prepared.config back.
      return {
        config: { ...config },
        stream: scripted
          ? (opts) => scripted(opts)
          : async function* (opts) {
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
// load the bundle like the DSH host loader does
//
// Static-bundle mode: dist/host.js is an ESM module that imports
// TypertRemoteService and exports apply/name/inject. The RPC surface is the
// ModelUltraRuntime service instance created inside apply(). We evaluate the
// bundle in a vm with a stub TypertRemoteService that captures the instance,
// then invoke its camelCase methods (kebab RPC names map to camel via the
// same rule the contract uses).
// ---------------------------------------------------------------------------
const kebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/** Every call the sandbox's `fetch` received (the OpenRouter shaper wraps it). */
const fetchCalls = []

async function loadHost() {
  let code = readFileSync(HOST_BUNDLE, 'utf8')
  // Strip the ESM import (stubbed below) and the trailing `export { ... }`.
  code = code.replace(/^\s*import\s+\{[^}]*\}\s+from\s+["']@deepseek-ai\/dsh-typert-protocol["'];?/m, '')
  // The plugin's own settings schema is the real schemastery (the runtime
  // supplies it); bind it to the sandbox global of the same name.
  code = code.replace(/^\s*import\s+z\s+from\s+["']@deepseek-ai\/schemastery["'];?/m, 'var z = globalThis.__schemastery;')
  // Node builtins (`node:fs/promises`, `node:os`, `node:path` — the legacy
  // import probes) are bound from the sandbox's real module namespace.
  code = code.replace(
    /^\s*import\s+\{([^}]*)\}\s+from\s+["'](node:[^"']+)["'];?$/gm,
    (_m, names, spec) => `const {${names}} = globalThis.__node[${JSON.stringify(spec)}];`,
  )
  code = code.replace(/export\s*\{[\s\S]*?\};?\s*$/m, '')

  const captured = []
  const sandbox = {
    console, setTimeout, clearTimeout, Date, Promise, AbortController,
    TextEncoder, TextDecoder,
    process: { env: process.env },
    URL,
    // stub base: capture each runtime instance so the test can invoke methods
    TypertRemoteService: class {
      constructor(ctx) { this.ctx = ctx; captured.push(this) }
    },
  }
  sandbox.globalThis = sandbox
  sandbox.__schemastery = (await import('@deepseek-ai/schemastery')).default
  sandbox.__node = {
    'node:fs/promises': await import('node:fs/promises'),
    'node:os': await import('node:os'),
    'node:path': await import('node:path'),
  }
  // Recording fetch stub: the plugin's OpenRouter shaper wraps whatever global
  // `fetch` is installed when `apply` runs, so this captures the shaped calls.
  sandbox.fetch = async (input, init) => {
    fetchCalls.push({ input, init })
    return { ok: true, status: 200, headers: { get: () => null }, async text() { return 'ok' } }
  }
  const stubFetch = sandbox.fetch
  const result = await vm.runInContext(
    `(async () => { ${code}\n; return { apply, name, inject, Config }; })()`,
    vm.createContext(sandbox),
    { filename: 'model-pro-host.js' },
  )
  return {
    apply: result.apply,
    runtimes: captured,
    Config: result.Config,
    schemastery: sandbox.__schemastery,
    sandbox,
    stubFetch,
  }
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
const store = createSettings({ providers: {}, sectionNote: { hello: 1 } })
const log = { section: () => store.doc() }
const llm = createLlm(log)
const cleanups = []
const listeners = {}
const timerCallbacks = []
/** Manifests handed to ctx.typert.register, for contract-shape assertions. */
const typertManifests = []
const ctx = {
  get: (name) => (
    name === 'settings' ? store
      : name === 'llm' ? llm
        : name === 'credentials' ? creds
          : name === 'timer' ? {
            interval: (fn, _ms) => { timerCallbacks.push(fn); return () => {} },
            timeout: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) },
          }
            : undefined
  ),
  // Typert registry stub: apply() registers its manifest through this.
  typert: { register: (manifest) => { typertManifests.push(manifest); return () => {} } },
  on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return () => {} },
  effect: (fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c) },
}
/** Fire every registered interval callback once (deterministic flush). */
const tick = async () => { for (const fn of timerCallbacks) { try { await fn() } catch { /* ignore */ } } }
const { apply, runtimes, Config, schemastery, sandbox, stubFetch } = await loadHost()
apply(ctx)

// --- this plugin's own settings schema (dsh 0.2.0-rc.1) --------------------
// dsh validates every settings write against the entry's Config and only
// VOLATILE paths are writable, so the plugin's own state must live in a schema
// that declares it volatile. `llm-pi-ai` declares only `providers`.
{
  assert(Config && Config.type === 'object', 'plugin Config is an object schema')
  for (const key of STATE_KEYS) {
    const field = Config.dict && Config.dict[key]
    assert(field !== undefined, `plugin Config declares ${key}`)
    // dsh's isVolatilePath() walks schema.dict and accepts a path exactly when
    // its node (or an ancestor) carries meta.volatile.
    assert(field.meta && field.meta.volatile === true, `plugin Config field ${key} is volatile (settings write requirement)`)
  }
  assert(typeof schemastery === 'function' || typeof schemastery === 'object', 'real schemastery bound in the sandbox')
}

// --- typert manifest shape (dsh 0.2.0-rc.1) --------------------------------
// The registry validates strict codecs with `typeof codec.create === 'function'`
// and then calls `codec.create().parse(value)`. A `schema:`-only codec (the
// pre-0.2.0 shape) throws "strict codec has no create() factory" during
// registration, so this assertion is the regression guard for the port.
assert(typertManifests.length === 1, 'typert manifest registered exactly once')
{
  const manifest = typertManifests[0]
  assert(manifest.package === 'dsh-model-ultra' && manifest.face === 'host', 'manifest package/face')
  assert(Array.isArray(manifest.invocations) && manifest.invocations.length === 30, 'manifest carries 30 invocations')
  for (const descriptor of manifest.invocations) {
    const codecs = [descriptor.result, ...descriptor.parameters.map((p) => p.codec)]
    for (const codec of codecs) {
      assert(codec.mode === 'strict', `${descriptor.id}: strict codec mode`)
      assert(typeof codec.typeSymbol === 'string' && codec.typeSymbol.length > 0, `${descriptor.id}: typeSymbol`)
      assert(typeof codec.create === 'function', `${descriptor.id}: codec.create() factory (0.2.0-rc.1 requirement)`)
      assert(!Object.hasOwn(codec, 'schema'), `${descriptor.id}: no legacy \`schema\` field`)
      const parsed = codec.create()
      assert(parsed && typeof parsed.parse === 'function', `${descriptor.id}: create() returns a { parse } schema`)
    }
  }
  const service = manifest.model.services[0]
  assert(service.key === 'modelUltra' && service.exportName === 'ModelUltraRuntime', 'model service row')
  assert(service.members.length === 30, 'all 30 methods declared as members')
}

// The RPC surface is the captured ModelUltraRuntime instance. Drive it by the
// same kebab invocation ids the client uses: the manifest declares the exact
// camelCase member each id resolves to, so the test never has to re-derive the
// name transformation (`get-openrouter` → `getOpenRouter`, not `getOpenrouter`).
const runtime = () => runtimes[runtimes.length - 1]
// The manifest carries the camelCase member name each invocation resolves to
// (`dsh-model-ultra#modelUltra/getOpenRouter`). Key it by its separator-free
// lowercase form so a kebab invocation id (`get-openrouter`) finds it — the
// authoritative kebab→camel table lives in the contract the CLIENT imports.
const METHODS_BY_ID = new Map(
  typertManifests[0].invocations.map((d) => [d.method.replace(/-/g, '').toLowerCase(), d.method]),
)
const P = async (name, args) => {
  const method = METHODS_BY_ID.get(name.replace(/-/g, '').toLowerCase())
  assert(typeof method === 'string', `unknown invocation "${name}"`)
  assert(typeof runtime()[method] === 'function', `service exposes ${method}()`)
  return runtime()[method](args || {})
}
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

// --- reinstall with pi-ai loading AFTER model-pro: the section is not
// resolvable at apply time, so the eager park reads nothing. The
// `settings/document-updated` re-park must catch the markers the moment the
// namespace commits — otherwise llm-pi-ai's resolveProfiles (which ignores the
// marker) registers them as ACTIVE routes and disabled models resurface. ---
{
  const lateStore = createSettings({
    providers: { lateGw: { baseURL: 'https://late/v1', disabled: true } },
    noteK: 1,
  })
  const late = createLateSettings(lateStore)
  listeners['settings/document-updated'] = []
  const lateCtx = {
    get: (name) => (name === 'settings' ? late : name === 'llm' ? llm : name === 'credentials' ? creds : undefined),
    typert: { register: () => () => {} },
    on: ctx.on,
    effect: ctx.effect,
  }
  apply(lateCtx)
  // Eager attempt ran against an unregistered section -> must NOT have parked yet.
  const lateDoc = () => lateStore.doc()
  assert(!Object.hasOwn(lateDoc().disabledProviders || {}, 'lateGw'), 'eager park no-ops while the section is unregistered')
  assert(
    Object.hasOwn(lateDoc().providers || {}, 'lateGw') && lateDoc().providers.lateGw.disabled === true,
    'marked provider still sits in providers before pi-ai loads',
  )

  // Now pi-ai registers its namespace and commits -> document-updated fires.
  await Promise.resolve()
  late.register()
  await new Promise((res) => setTimeout(res, 5))

  assert(
    Object.hasOwn(lateDoc().disabledProviders || {}, 'lateGw') && lateDoc().disabledProviders.lateGw.disabled === true,
    'settings/document-updated re-park parks the marked provider once the namespace commits',
  )
  assert(!Object.hasOwn(lateDoc().providers || {}, 'lateGw'), 'parked provider removed from providers after late registration')
  assert(lateDoc().noteK === 1, 'foreign section keys survive the late re-park write')

  // Restore shared harness state: drop the second runtime + the listeners it
  // registered, so the following tests keep driving the ORIGINAL instance.
  runtimes.pop()
  listeners['settings/document-updated'] = []
}

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

// --- REAL pi-ai failure shape: unreachable providers NEVER throw; they emit
// [usage] then finish(error). The old router committed on the first chunk
// (the harmless usage) and passed the error straight through — no failover.
// The pre-commit buffer must treat this exactly like a dead target. ---
llm.scriptedStreams.set('piashape', async function* () {
  yield { type: 'usage', usage: { input_tokens: 1, output_tokens: 0 } }
  yield { type: 'finish', reason: { kind: 'error', failure: { message: 'connect ECONNREFUSED 127.0.0.1:9', code: 'TRANSPORT' } } }
})
await P('create-provider', { route: 'piashape', baseURL: 'https://pia/v1' }).catch(() => {})
await P('set-route', {
  alias: 'auto-piashape', strategy: 'priority',
  targets: [
    { provider: 'piashape', model: 'x' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  ],
})
{
  let sawPong3 = false
  let sawLeak = false
  for await (const c of rreg.adapter.stream({
    provider: 'router', model: 'auto-piashape',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    temperature: 0, maxTokens: 16, sessionId: 'sess-piashape',
  })) {
    if (c && c.type === 'text-delta' && c.text === 'pong') sawPong3 = true
    if (c && c.type === 'finish' && c.reason && typeof c.reason === 'object' && c.reason.kind === 'error') sawLeak = true
  }
  assert(sawPong3, 'pi-ai-shaped failure falls over to the healthy target')
  assert(!sawLeak, 'error finish from a dead first target never reaches the consumer')
}
// the committed (second-attempt) call is logged with fallback status
{
  const lr = await P('list-request-logs', { sessionId: 'sess-piashape' })
  const okEntries = (lr.entries || []).filter((e) => e.status !== 'error')
  assert(okEntries.some((e) => e.status === 'fallback' && e.target.provider === 'opencode-go'), 'fallback outcome recorded in request log: ' + JSON.stringify(okEntries))
}

// --- timeoutMs: a hung first target must not stall the route; the deadline
// abandons it and the second target answers. ---
llm.scriptedStreams.set('hangup', async function* () {
  await new Promise((resolve) => setTimeout(resolve, 500))
  yield { type: 'block-start', index: 0, blockType: 'text' }
})
await P('create-provider', { route: 'hangup', baseURL: 'https://hang/v1' }).catch(() => {})
await P('set-route', {
  alias: 'auto-timeout', strategy: 'priority', config: { timeoutMs: 60 },
  targets: [
    { provider: 'hangup', model: 'x' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  ],
})
{
  const t0 = Date.now()
  let sawPong4 = false
  for await (const c of rreg.adapter.stream({
    provider: 'router', model: 'auto-timeout',
    messages: [], temperature: 0, maxTokens: 16,
  })) {
    if (c && c.type === 'text-delta' && c.text === 'pong') sawPong4 = true
  }
  const took = Date.now() - t0
  assert(sawPong4, 'timeout on a hung target still serves via fallback target')
  assert(took < 400, `timeout budget respected (${took}ms << 500ms hang)`)
}

// --- caller abort mid-negotiation is honored: aborted finish passes through,
// and routing does NOT retry the next target after a caller abort. ---
llm.scriptedStreams.set('abortgw', async function* () {
  yield { type: 'usage', usage: { input_tokens: 1, output_tokens: 0 } }
  yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted by caller', code: 'ABORTED' } } }
})
await P('create-provider', { route: 'abortgw', baseURL: 'https://abort/v1' }).catch(() => {})
await P('set-route', {
  alias: 'auto-abort', strategy: 'priority',
  targets: [
    { provider: 'abortgw', model: 'x' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  ],
})
{
  let sawAborted = false
  let hitSecondTarget = false
  for await (const c of rreg.adapter.stream({
    provider: 'router', model: 'auto-abort',
    messages: [], temperature: 0, maxTokens: 16,
  })) {
    if (c && c.type === 'finish' && c.reason && typeof c.reason === 'object' && c.reason.kind === 'aborted') sawAborted = true
  }
  hitSecondTarget = log.lastConfig && log.lastConfig.provider === 'opencode-go'
  assert(sawAborted, 'caller abort surfaces as an aborted finish')
  assert(!hitSecondTarget, 'no cross-target retry after an abort')
}

// --- empty-success passthrough: finish(stop) with zero content commits and
// passes through rather than spinning every target. ---
llm.scriptedStreams.set('emptygw', async function* () {
  yield { type: 'usage', usage: { input_tokens: 2, output_tokens: 0 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
})
await P('create-provider', { route: 'emptygw', baseURL: 'https://empty/v1' }).catch(() => {})
await P('set-route', {
  alias: 'auto-empty', strategy: 'priority',
  targets: [
    { provider: 'emptygw', model: 'x' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  ],
})
{
  let sawStop = false
  for await (const c of rreg.adapter.stream({
    provider: 'router', model: 'auto-empty',
    messages: [], temperature: 0, maxTokens: 16,
  })) {
    if (c && c.type === 'finish') sawStop = true
  }
  const servedByEmpty = log.lastConfig && log.lastConfig.provider === 'emptygw'
  assert(sawStop, 'clean empty stop passes through to the consumer')
  assert(servedByEmpty, 'empty success commits to its target instead of failing over')
}

// --- MID-STREAM provider death (the new-api 500 shape): the gateway accepts,
// streams a delta, THEN answers "负载已达上限". Content already reached the
// consumer so transparent switching is impossible — but the bookkeeping must
// tell the truth: log entry is an ERROR carrying the message, and the target
// records the failure so the model-level retry can avoid it. ---
llm.scriptedStreams.set('middeath', async function* () {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'partial ' }
  yield { type: 'usage', usage: { input_tokens: 3, output_tokens: 1 } }
  yield { type: 'finish', reason: { kind: 'error', failure: { message: 'OpenAI API error (500): 当前模型 gpt-5.6-sol 负载已经达到上限', code: 'SERVER' } } }
})
await P('create-provider', { route: 'middeath', baseURL: 'https://mid/v1' }).catch(() => {})
await P('set-route', {
  alias: 'auto-middeath', strategy: 'priority',
  targets: [{ provider: 'middeath', model: 'x' }],
})
{
  let lastChunk = null
  for await (const c of rreg.adapter.stream({
    provider: 'router', model: 'auto-middeath',
    messages: [], temperature: 0, maxTokens: 16, sessionId: 'sess-mid',
  })) {
    lastChunk = c
  }
  assert(lastChunk && lastChunk.type === 'finish' && lastChunk.reason && lastChunk.reason.kind === 'error', 'mid-stream error finish reaches the consumer for agent-level handling')
  const lr = await P('list-request-logs', { sessionId: 'sess-mid' })
  const entry = (lr.entries || []).find((e) => e.target && e.target.provider === 'middeath')
  assert(entry && entry.status === 'error' && /负载已经达到上限/.test(String(entry.error || '')), `mid-stream failure logged as ERROR with the message: ${JSON.stringify(entry)}`)
  const gs = await P('get-route-stats')
  const h = (gs.health || {})['middeath\u0000x']
  assert(h && typeof h.lastError === 'string' && /负载/.test(h.lastError), 'mid-stream failure updates target health: ' + JSON.stringify(h))
}

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

// --- token accounting: the router must read the CANONICAL DSH TokenUsage
// chunk shape (camelCase inputTokens/outputTokens, what pi-ai's mapUsage
// emits), not just the raw snake_case names. This is the "输入输出 token 显示
// 为空 / 统计为空" regression. ---
llm.scriptedStreams.set('camelgw', async function* () {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'pong' }
  yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 7 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
})
await P('create-provider', { route: 'camelgw', baseURL: 'https://camel/v1' }).catch(() => {})
await P('set-route', { alias: 'auto-camel', strategy: 'priority', targets: [{ provider: 'camelgw', model: 'x' }] })
{
  for await (const c of rreg.adapter.stream({
    provider: 'router', model: 'auto-camel',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    temperature: 0, maxTokens: 16, sessionId: 'sess-camel',
  })) { /* drain */ }
  const rs = await P('get-route-stats')
  const tk = Object.keys(rs.byTarget || {}).find((k) => k.includes('camelgw'))
  assert(tk && rs.byTarget[tk].tokensIn === 12 && rs.byTarget[tk].tokensOut === 7,
    'camelCase TokenUsage counted into stats: ' + JSON.stringify(tk && rs.byTarget[tk]))
  const lg = await P('list-request-logs', { sessionId: 'sess-camel' })
  const camelLog = (lg.entries || []).find((e) => e.route === 'auto-camel')
  assert(camelLog && camelLog.tokens && camelLog.tokens.in === 12 && camelLog.tokens.out === 7,
    'camelCase tokens land on the request-log entry: ' + JSON.stringify(camelLog && camelLog.tokens))
}

// --- persistence: stats + a capped request-log tail are written to the
// settings snapshot (routeStats) so the 观测台 and the conversation 尾标 survive
// a page refresh / host restart, and a FRESH fiber re-hydrates them. This is
// the "统计为空 / 尾标不会持久化" regression. ---
{
  await tick() // debounced flush fires the persisted snapshot
  const snap = store.doc().routeStats
  assert(snap && typeof snap === 'object', 'routeStats snapshot persisted to settings: ' + JSON.stringify(Object.keys(store.doc())))
  assert(snap.byTarget && Object.keys(snap.byTarget).some((k) => k.includes('camelgw')), 'aggregate stats persisted: ' + JSON.stringify(snap.byTarget && Object.keys(snap.byTarget)))
  assert(Array.isArray(snap.logs) && snap.logs.some((e) => e.route === 'auto-camel'), 'request-log tail persisted: ' + JSON.stringify(snap.logs && snap.logs.length))

  // Simulate a page refresh / host restart: a brand-new fiber (fresh apply)
  // must re-hydrate the recorder + log ring from that snapshot rather than
  // starting blank.
  apply(ctx)
  const rs2 = await P('get-route-stats')
  assert(rs2.byTarget && Object.keys(rs2.byTarget).some((k) => k.includes('camelgw')), 're-applied fiber re-hydrates stats: ' + JSON.stringify(Object.keys(rs2.byTarget || {})))
  const lg2 = await P('list-request-logs', { sessionId: 'sess-camel' })
  assert((lg2.entries || []).some((e) => e.route === 'auto-camel'), 're-applied fiber re-hydrates request-log tail')
}

// --- ui prefs: badge toggle persists in THIS PLUGIN's own settings section
// (never in llm-pi-ai, whose schema only accepts `providers`) and merges ---
r = await P('get-ui-prefs')
assert(r.ok && r.prefs && r.prefs.showRouteBadge === true, 'ui prefs default to showRouteBadge=true: ' + JSON.stringify(r))
r = await P('set-ui-prefs', { prefs: { showRouteBadge: false } })
assert(r.ok && r.prefs.showRouteBadge === false, 'set-ui-prefs flips the badge off')
r = await P('get-ui-prefs')
assert(r.prefs.showRouteBadge === false, 'get-ui-prefs reflects the saved value')
assert(store.state().uiPrefs && typeof store.state().uiPrefs === 'object', 'uiPrefs persisted in the plugin state section: ' + JSON.stringify(Object.keys(store.state())))
assert(store.section().uiPrefs === undefined, 'uiPrefs was NOT written into the llm-pi-ai section')
r = await P('list-routes')
assert(r.ok && r.routes && Object.keys(r.routes).length >= 1, 'uiPrefs write preserved sibling keys (routes intact)')
r = await P('set-ui-prefs', { prefs: { showRouteBadge: true } })
assert(r.ok && r.prefs.showRouteBadge === true, 'set-ui-prefs restores the default')

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

// --- thinking effort: route defaults, per-model entries, catalog overrides ---
{
  // Seed the section directly: one provider with an explicit `models` list, one
  // catalog-style route (no list), and `deepseek` (the mock's llm.listModels
  // serves it a 2-model catalog, which is what guards typo'd overrides).
  const seed = {
    ...provs(),
    'think-gw': { api: 'openai-completions', baseURL: 'https://think/v1', models: [{ id: 'm1' }, { id: 'm2' }] },
    'openrouter': { api: 'openai-completions', baseURL: 'https://openrouter.ai/api/v1' },
    'deepseek': { api: 'openai-responses', baseURL: 'https://api.deepseek.com' },
  }
  await store.replace(NS, { providers: seed })

  r = await P('set-thinking', {
    route: 'think-gw',
    patch: {
      reasoning: 'high',
      thinkingBudgets: { minimal: 128, low: 512, medium: 2048, high: 8192 },
      compat: { thinkingFormat: 'openrouter', supportsThinkingTokenBudget: true },
    },
  })
  assert(r.ok && r.storage === 'route', 'set-thinking route-level ok: ' + JSON.stringify(r))
  const prof0 = provs()['think-gw']
  assert(prof0.reasoning === 'high', 'route default level persisted')
  assert(prof0.thinkingBudgets.high === 8192 && prof0.thinkingBudgets.minimal === 128, 'thinking budgets persisted')
  assert(prof0.compat.thinkingFormat === 'openrouter' && prof0.compat.supportsThinkingTokenBudget === true, 'route compat persisted')

  // A partial budget object is invalid (all four keys are required by the schema)
  r = await P('set-thinking', { route: 'think-gw', patch: { thinkingBudgets: { minimal: 1, low: 2 } } })
  assert(!r.ok && /thinkingBudgets/.test(r.error), 'partial thinkingBudgets rejected: ' + JSON.stringify(r))
  // An unknown level is rejected rather than written (llm-pi-ai would refuse it)
  r = await P('set-thinking', { route: 'think-gw', patch: { reasoning: 'ultra' } })
  assert(!r.ok, 'unknown route reasoning level rejected')
  // Route-level vs model-level mixups are named, not silently accepted
  r = await P('set-thinking', { route: 'think-gw', patch: { reasoningEfforts: { high: 'high' } } })
  assert(!r.ok && /modelId/.test(r.error), 'route-level reasoningEfforts rejected: ' + JSON.stringify(r))
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm1', patch: { reasoning: 'high' } })
  assert(!r.ok, 'model-level reasoning rejected')

  // Per-model efforts on an explicit models list: manual spellings + a valueless level
  r = await P('set-thinking', {
    route: 'think-gw',
    modelId: 'm1',
    patch: { reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'ultra' } },
  })
  assert(r.ok && r.storage === 'models', 'set-thinking model (explicit list) ok: ' + JSON.stringify(r))
  const m1 = provs()['think-gw'].models.find((m) => m.id === 'm1')
  const m2 = provs()['think-gw'].models.find((m) => m.id === 'm2')
  assert(m1.reasoningEfforts.off === null && m1.reasoningEfforts.max === 'ultra', 'model efforts persist manual spellings')
  assert(m2.reasoningEfforts === undefined, 'the sibling model is untouched')
  // Canonical order: the written dict follows the escalation order, not the input order
  assert(JSON.stringify(Object.keys(m1.reasoningEfforts)) === JSON.stringify(['off', 'low', 'high', 'max']),
    'effort keys are written in escalation order: ' + JSON.stringify(Object.keys(m1.reasoningEfforts)))

  // Whitespace-only spelling collapses to a valueless level; false = non-reasoning
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm1', patch: { reasoningEfforts: { off: '   ', high: 'high' } } })
  assert(r.ok && provs()['think-gw'].models.find((m) => m.id === 'm1').reasoningEfforts.off === null,
    'blank spelling normalizes to a valueless level')
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm2', patch: { reasoningEfforts: false } })
  assert(r.ok && provs()['think-gw'].models.find((m) => m.id === 'm2').reasoningEfforts === false,
    'false declares a non-reasoning model')
  // null removes the field entirely (inherit the installed catalog capability)
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm2', patch: { reasoningEfforts: null } })
  assert(r.ok && !Object.hasOwn(provs()['think-gw'].models.find((m) => m.id === 'm2'), 'reasoningEfforts'),
    'null deletes reasoningEfforts')
  // Unknown level keys are rejected
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm1', patch: { reasoningEfforts: { turbo: 'x' } } })
  assert(!r.ok && /未知档位/.test(r.error), 'unknown effort level rejected: ' + JSON.stringify(r))
  // llm-pi-ai's own resolveModelReasoning rules, so a profile it would refuse is
  // never written: a thinking level needs a wire value...
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm1', patch: { reasoningEfforts: { off: null, high: null } } })
  assert(!r.ok && /只有 off 档可以留空/.test(r.error), 'valueless thinking level rejected: ' + JSON.stringify(r))
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm1', patch: { reasoningEfforts: { high: '   ' } } })
  assert(!r.ok, 'blank spelling for a thinking level rejected')
  // ...and `{off: null}` alone is not a non-reasoning model (that is `false`)
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm1', patch: { reasoningEfforts: { off: null } } })
  assert(!r.ok && /非推理/.test(r.error), 'off-only effort map rejected with the false suggestion: ' + JSON.stringify(r))
  // `off` WITH a value is legal (some gateways send off=none)
  r = await P('set-thinking', { route: 'think-gw', modelId: 'm1', patch: { reasoningEfforts: { off: 'none', high: 'high' } } })
  assert(r.ok && provs()['think-gw'].models.find((m) => m.id === 'm1').reasoningEfforts.off === 'none',
    'off may carry an explicit wire value')
  // A model that is not in the explicit list cannot be given an override
  r = await P('set-thinking', { route: 'think-gw', modelId: 'ghost', patch: { reasoningEfforts: { high: 'high' } } })
  assert(!r.ok, 'unknown model on an explicit-models route rejected')

  // Catalog route: writing a model's effort must NOT materialize a `models` list
  r = await P('set-thinking', {
    route: 'openrouter',
    modelId: 'openai/gpt-4o-mini',
    patch: { reasoningEfforts: { off: null, high: 'high' }, compat: { thinkingFormat: 'openrouter' } },
  })
  assert(r.ok && r.storage === 'modelOverrides', 'catalog-route model uses modelOverrides: ' + JSON.stringify(r))
  const orProf = provs()['openrouter']
  assert(orProf.models === undefined, 'catalog route was NOT narrowed to a models list')
  assert(orProf.modelOverrides['openai/gpt-4o-mini'].reasoningEfforts.high === 'high', 'override carries the effort map')
  assert(orProf.modelOverrides['openai/gpt-4o-mini'].compat.thinkingFormat === 'openrouter', 'override carries the compat switch')
  // Deleting every field drops the override container again
  r = await P('set-thinking', {
    route: 'openrouter',
    modelId: 'openai/gpt-4o-mini',
    patch: { reasoningEfforts: null, compat: { thinkingFormat: null } },
  })
  assert(r.ok && provs()['openrouter'].modelOverrides === undefined, 'emptied override container is removed')
  // A typo is refused while the installed catalog is non-empty (deepseek here)
  r = await P('set-thinking', { route: 'deepseek', modelId: 'ghost', patch: { reasoningEfforts: { high: 'high' } } })
  assert(!r.ok && /模型目录/.test(r.error), 'unknown model in a non-empty catalog rejected: ' + JSON.stringify(r))

  // get-provider exposes the route-level thinking state for the editor
  r = await P('get-provider', { route: 'think-gw' })
  assert(r.ok && r.reasoning === 'high' && r.thinkingBudgets.high === 8192 && r.compat.thinkingFormat === 'openrouter',
    'get-provider exposes route thinking state: ' + JSON.stringify({ reasoning: r.reasoning, compat: r.compat }))
  assert(r.models.find((m) => m.id === 'm1').reasoningEfforts.high === 'high', 'get-provider keeps model effort maps')
  assert(r.modelOverrides !== undefined, 'get-provider exposes the overrides map')

  const keep = Object.fromEntries(
    Object.entries(provs()).filter(([route]) => !['think-gw', 'openrouter', 'deepseek'].includes(route)),
  )
  await store.replace(NS, { providers: keep })
}

// --- OpenRouter routing injection (ports dsh-openrouter-providers) ----------
{
  r = await P('get-openrouter')
  assert(r.ok && r.state.enabled === true && r.state.mode === 'only' && r.state.quantization === 'off',
    'openrouter defaults: ' + JSON.stringify(r.state))
  assert(r.active === false, 'inert by default: empty list + no quantization')
  assert(r.shaper.installed === true, 'the fetch shaper is mounted when fetch exists')
  assert(r.selfTest.changed === false, 'self-test reports no injection while inert')

  r = await P('set-openrouter', { patch: { providers: 'DeepInfra\nTogether', mode: 'only' } })
  assert(r.ok && r.active === true, 'setting a provider list activates injection: ' + JSON.stringify(r.state))
  assert(r.state.providers.length === 2 && r.state.providers[0] === 'DeepInfra', 'provider slugs parsed from text')
  assert(JSON.stringify(r.selfTest.params) === JSON.stringify({ only: ['DeepInfra', 'Together'], allow_fallbacks: false }),
    'only mode pairs with allow_fallbacks=false: ' + JSON.stringify(r.selfTest.params))
  assert(r.selfTest.changed === true, 'self-test reports the injection')

  // The live shaper rewrites a real OpenRouter call exactly once.
  fetchCalls.length = 0
  await sandbox.fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek/deepseek-chat', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })
  assert(fetchCalls.length === 1, 'one upstream call recorded')
  const shaped = JSON.parse(fetchCalls[0].init.body)
  assert(JSON.stringify(shaped.provider) === JSON.stringify({ only: ['DeepInfra', 'Together'], allow_fallbacks: false }),
    'upstream body carries provider.only: ' + JSON.stringify(shaped.provider))
  assert(shaped.model === 'deepseek/deepseek-chat' && shaped.stream === true, 'the rest of the body is preserved')
  const sentHeaders = fetchCalls[0].init.headers
  assert(sentHeaders['HTTP-Referer'] === 'https://github.com/deepseek-ai/deepseek-harness', 'HTTP-Referer attribution sent')
  assert(sentHeaders['X-OpenRouter-Title'] === 'DeepSeek Harness OpenRouter', 'X-OpenRouter-Title attribution sent')
  assert(sentHeaders['X-OpenRouter-Categories'] === 'cli-agent', 'X-OpenRouter-Categories attribution sent')
  assert(sentHeaders['content-type'] === 'application/json', 'existing headers survive')

  // order mode flips allow_fallbacks, and quantization is a one-element array
  r = await P('set-openrouter', { patch: { mode: 'order', quantization: 'int8' } })
  assert(JSON.stringify(r.selfTest.params) === JSON.stringify({
    order: ['DeepInfra', 'Together'], allow_fallbacks: true, quantizations: ['int8'],
  }), 'order mode + quantizations shape: ' + JSON.stringify(r.selfTest.params))

  // A foreign host, a GET, and a non-JSON body are never touched
  fetchCalls.length = 0
  const untouched = JSON.stringify({ model: 'x', messages: [] })
  await sandbox.fetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: untouched })
  await sandbox.fetch('https://openrouter.ai/api/v1/models', { method: 'GET' })
  await sandbox.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: 'not json' })
  assert(fetchCalls[0].init.body === untouched, 'a foreign host is left byte-identical')
  assert(fetchCalls[1].init.body === undefined, 'a GET is left alone')
  assert(fetchCalls[2].init.body === 'not json', 'an unparseable body is left byte-identical')

  // Disabling stops both the body shaping and the attribution headers
  r = await P('set-openrouter', { patch: { enabled: false } })
  assert(r.active === false && r.selfTest.changed === false, 'disabled state is inert')
  fetchCalls.length = 0
  const inertBody = JSON.stringify({ model: 'm', messages: [] })
  await sandbox.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: {}, body: inertBody })
  assert(fetchCalls[0].init.body === inertBody, 'disabled: body untouched')
  assert(fetchCalls[0].init.headers['HTTP-Referer'] === undefined, 'disabled: no attribution headers')

  // Invalid patches are rejected, not persisted
  r = await P('set-openrouter', { patch: { mode: 'sideways' } })
  assert(!r.ok, 'invalid mode rejected')
  r = await P('set-openrouter', { patch: { quantization: 'int3' } })
  assert(!r.ok, 'invalid quantization rejected')

  // Legacy import: the reference plugin's own JSON document.
  {
    const fsp = await import('node:fs/promises')
    const tmp = path.join(__dirname, '.tmp-openrouter')
    await fsp.mkdir(tmp, { recursive: true })
    await fsp.writeFile(
      path.join(tmp, 'openrouter-providers.json'),
      JSON.stringify({ enabled: true, mode: 'order', providers: ['LegacyA', 'LegacyB'], quantization: 'fp8' }),
      'utf8',
    )
    const prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = tmp
    try {
      r = await P('import-openrouter')
      assert(r.ok && r.imported.quantization === 'fp8', 'legacy JSON imported: ' + JSON.stringify(r.imported))
      assert(r.state.providers[0] === 'LegacyA' && r.state.mode === 'order' && r.state.quantization === 'fp8',
        'legacy values applied to the live state')
      assert(r.sources.some((s) => s.status === 'imported'), 'the winning source is reported')
    } finally {
      if (prevHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevHome
      await fsp.rm(tmp, { recursive: true, force: true })
    }
  }

  // Legacy import: the retired settings document's YAML section.
  {
    const fsp = await import('node:fs/promises')
    const tmp = path.join(__dirname, '.tmp-openrouter-yaml')
    await fsp.mkdir(tmp, { recursive: true })
    await fsp.writeFile(path.join(tmp, 'settings.yaml.imported'), [
      'other-plugin:',
      '  keep: 1',
      'openrouter-providers:',
      '  enabled: true',
      '  mode: only',
      '  quantization: int4',
      '  providers:',
      '    - DeepInfra',
      '    - Together',
      'later-plugin:',
      '  nope: 1',
      '',
    ].join('\n'), 'utf8')
    const prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = tmp
    try {
      r = await P('import-openrouter')
      assert(r.ok && r.imported.quantization === 'int4', 'YAML section imported: ' + JSON.stringify(r))
      assert(JSON.stringify(r.state.providers) === JSON.stringify(['DeepInfra', 'Together']), 'YAML block list parsed')
      assert(r.state.mode === 'only', 'YAML mode parsed')
    } finally {
      if (prevHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevHome
      await fsp.rm(tmp, { recursive: true, force: true })
    }
  }

  r = await P('openrouter-selftest')
  assert(r.ok && typeof r.active === 'boolean' && r.selfTest.probe.includes('"model"'), 'self-test RPC answers the probe')

  // The state lives in this plugin's own settings entry, next to the others
  assert(store.state().openrouter !== undefined && store.state().openrouter.quantization === 'int4',
    'openrouter state persisted in the plugin entry')
  assert(Object.keys(store.state()).every((k) => STATE_KEYS.includes(k)), 'state keys stay inside the declared schema')
}

// --- FINAL: uninstall while the document-updated re-park listener is live ---
// Restore moves parked providers BACK into providers and its write emits
// settings/document-updated — the unloading flag must keep the listener from
// immediately re-parking them (which would silently break the uninstall
// "no data lost" guarantee). Runs last because it tears down every effect,
// exactly like a real cordis fiber unload.
{
  // Park one provider so restore has real data to move back.
  await P('create-provider', { route: 'unl-gw', baseURL: 'https://unl/v1' })
  r = await P('toggle-provider', { route: 'unl-gw', enabled: false })
  assert(r.ok && Object.hasOwn(dis(), 'unl-gw'), 'pre-condition: unl-gw parked')
  // Simulate the real unload: run every cleanup in LIFO order like cordis.
  const lifo = cleanups.splice(0, cleanups.length)
  for (let i = lifo.length - 1; i >= 0; i--) await Promise.resolve(lifo[i]())
  assert(provs()['unl-gw'] && provs()['unl-gw'].disabled === true, 'unload restored unl-gw to providers (marker intact)')
  // Fire the event after the disposers ran — the way dsh-settings' queued
  // write would commit. The listener is disposed AND the unloading flag set,
  // so nothing may re-park behind the safety net's back.
  for (const fn of listeners['settings/document-updated'] || []) try { fn('llm-pi-ai', 9) } catch { /* ignore */ }
  await new Promise((res) => setTimeout(res, 5))
  assert(provs()['unl-gw'] && !Object.hasOwn(dis(), 'unl-gw'), 'uninstall-restore is NOT undone by a late document-updated re-park')
  // The OpenRouter shaper's disposer ran with the fiber: the original global
  // fetch is back, so an uninstalled plugin cannot keep rewriting requests.
  assert(sandbox.fetch === stubFetch, 'unload restored the original global fetch')
}

console.log('PASS: host end-to-end smoke — all assertions green')
