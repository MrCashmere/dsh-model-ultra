/**
 * Client half structural smoke test (static-bundle mode).
 *
 * Loads the REAL built `dist/client.js`. In static-bundle mode that file is a
 * `window.__ModuleLoader__.load({ id, factory })` call; the factory receives a
 * synchronous `require` and returns the CJS module (exporting apply). We
 * provide `require` (React + externals), a minimal `document` for CSS
 * adoption, and a `ctx` whose `remote.$mount` + `reflect.get` expose a mocked
 * `modelUltra` remote. The remote's methods return the Gateway envelope
 * `{ ok, value }` wrapping the business `{ ok, ... }` payload — exactly what
 * rpc.ts unwraps. Then renders the registered `settings.section` slot through
 * a tiny React renderer and asserts the redesigned dashboard constructs.
 *
 * Run: `npm test`  (build must be current: `npm run build`)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_BUNDLE = path.join(__dirname, '..', 'dist', 'client.js')

// ---------------------------------------------------------------------------
// tiny React: createElement + function-component renderer with hooks
// (useState persists per instance; useEffect runs once per instance).
// ---------------------------------------------------------------------------
class FakeReact {
  constructor() {
    this.Fragment = Symbol('fragment')
    this.current = null
    this.instances = new Map()
    this.rerender = null
  }

  createElement(type, props, ...children) {
    const flat = []
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue
      if (Array.isArray(c)) flat.push(...c.flat(Infinity).filter(Boolean))
      else flat.push(c)
    }
    return { type, props: props || {}, children: flat }
  }

  useState(init) {
    const inst = this.current
    const i = inst.hookIdx++
    if (i >= inst.hooks.length) inst.hooks.push(typeof init === 'function' ? init() : init)
    const update = (v) => {
      inst.hooks[i] = typeof v === 'function' ? v(inst.hooks[i]) : v
      if (this.rerender) this.rerender()
    }
    return [inst.hooks[i], update]
  }

  useEffect(fn) {
    const inst = this.current
    if (!inst.effectsRun) inst.effects.push(fn)
  }

  useCallback(fn) {
    return fn
  }

  useMemo(fn) {
    return fn()
  }

  useRef(init) {
    const inst = this.current
    const i = inst.hookIdx++
    if (i >= inst.hooks.length) inst.hooks.push({ current: init })
    return inst.hooks[i]
  }

  clone() {
    return Object.create(this)
  }
}

function renderAt(rootVNode, fake, path, out) {
  // Falsy children (&& patterns, ternaries) are legal React — skip them.
  if (!rootVNode || typeof rootVNode !== 'object' || typeof rootVNode.type === 'undefined') return
  const { type, props, children } = rootVNode
  if (type === fake.Fragment) {
    for (let i = 0; i < children.length; i++) renderAt(children[i], fake, `${path}:${i}`, out)
    return
  }
  if (typeof type === 'string') {
    // Keep clickable elements so the test can drive tab switches.
    out.push({ tag: type, className: props?.className || '', text: collectText(children), onClick: props?.onClick })
    for (let i = 0; i < children.length; i++) renderAt(children[i], fake, `${path}:${i}`, out)
    return
  }
  // function component
  const key = `${path}:${type.name || 'anon'}`
  let inst = fake.instances.get(key)
  if (!inst) { inst = { hooks: [], effects: [], effectsRun: false }; fake.instances.set(key, inst) }
  inst.hookIdx = 0
  const prev = fake.current
  fake.current = inst
  let rendered
  try {
    rendered = type(props)
  } finally {
    fake.current = prev
  }
  inst.effectsRun = true
  const pending = inst.effects.splice(0)
  for (const fn of pending) fn()
  if (rendered && typeof rendered === 'object' && 'type' in rendered) {
    renderAt(rendered, fake, `${key}`, out)
  }
}

function collectText(children) {
  let s = ''
  for (const c of children) {
    if (typeof c === 'string' || typeof c === 'number') s += String(c) + ' '
    else if (c && typeof c === 'object' && 'type' in c) {
      if (typeof c.type === 'string') s += collectText(c.children || [])
    }
  }
  return s.trim()
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`)
}

// ---------------------------------------------------------------------------
// injected client globals
// ---------------------------------------------------------------------------
const testProviders = [
  { route: 'deepseek', displayName: 'DeepSeek', declared: true, api: 'openai-completions', baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DS_KEY', disabled: false, hasHeaders: true, headerCount: 1, modelCount: 2, usesCatalog: false },
  { route: 'my-gw', displayName: 'My Gateway', declared: true, api: 'anthropic-messages', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', disabled: true, hasHeaders: false, headerCount: 0, modelCount: 0, usesCatalog: true },
]

// ---------------------------------------------------------------------------
// mocked remote: camelCase methods returning the Gateway envelope
// { ok, value } wrapping the business { ok, ... } payload.
// ---------------------------------------------------------------------------
const uiPrefsState = { showRouteBadge: true }
/** Every RPC the components issued, in order (asserted by the new tabs). */
const rpcCalls = []
/** Mutable OpenRouter state served by the mocked get/set handlers. */
const openRouterState = {
  enabled: true,
  mode: 'only',
  providers: ['DeepInfra', 'Together'],
  quantization: 'int8',
  hosts: ['openrouter.ai'],
  attribution: true,
  attributionTitle: 'DeepSeek Harness OpenRouter',
}
const businessFor = (method, payload) => {
  if (method === 'listProviders') return { ok: true, providers: testProviders, protocols: ['openai-completions', 'openai-responses', 'anthropic-messages'], writable: true }
  if (method === 'listRoutes') return { ok: true, routes: { auto: { strategy: 'priority', targets: [{ provider: 'deepseek', model: 'deepseek-chat' }] } } }
  if (method === 'getProvider') return {
    ok: true,
    route: 'deepseek',
    displayName: 'DeepSeek',
    models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
    availableModels: ['deepseek-v3'],
    usesCatalog: false,
    // Thinking-effort state the panel reads (route level + per-model overrides)
    reasoning: 'high',
    thinkingBudgets: { minimal: 128, low: 512, medium: 2048, high: 8192 },
    compat: { thinkingFormat: 'openrouter', supportsReasoningEffort: true },
    modelOverrides: { 'deepseek-v3': { reasoningEfforts: { high: 'high' } } },
  }
  if (method === 'setThinking') return { ok: true, storage: payload && payload.modelId ? 'models' : 'route' }
  if (method === 'listComposites') return { ok: true, composites: {} }
  if (method === 'getOpenRouter') return {
    ok: true,
    state: { ...openRouterState },
    active: true,
    writable: true,
    defaults: openRouterState,
    quantLevels: ['int8', 'fp8'],
    shaper: { installed: true, calls: 7, shaped: 3, attributed: 3 },
    selfTest: { changed: true, params: { only: [...openRouterState.providers], allow_fallbacks: false }, after: '{"model":"x","provider":{}}' },
  }
  if (method === 'setOpenRouter') {
    Object.assign(openRouterState, (payload && payload.patch) || {})
    return {
      ok: true,
      state: { ...openRouterState },
      active: true,
      shaper: { installed: true, calls: 8, shaped: 4, attributed: 4 },
      selfTest: { changed: true, params: { only: [...openRouterState.providers], allow_fallbacks: false } },
    }
  }
  if (method === 'openRouterSelfTest') return {
    ok: true,
    state: { ...openRouterState },
    active: true,
    shaper: { installed: true, calls: 9, shaped: 5, attributed: 5 },
    selfTest: { changed: true, params: { only: [...openRouterState.providers], allow_fallbacks: false } },
  }
  if (method === 'importOpenRouter') return {
    ok: true,
    state: { ...openRouterState, providers: ['LegacyA'] },
    imported: { providers: ['LegacyA'] },
    sources: [{ path: '/tmp/openrouter-providers.json', status: 'imported' }],
    active: true,
    shaper: { installed: true, calls: 10, shaped: 6, attributed: 6 },
    selfTest: { changed: true, params: { only: ['LegacyA'], allow_fallbacks: false } },
  }
  if (method === 'getRouteStats') return {
    ok: true,
    byRoute: { 'auto': { calls: 12, errors: 1, latencySum: 4800, latencyN: 12, tokensIn: 100, tokensOut: 200 } },
    byTarget: { 'deepseek\u0000deepseek-chat': { calls: 12, errors: 1, latencySum: 4800, latencyN: 12, tokensIn: 100, tokensOut: 200 } },
    health: { 'deepseek\u0000deepseek-chat': { provider: 'deepseek', model: 'deepseek-chat', status: 'up', latencyMs: 400, consecutiveFails: 0, lastProbeAt: 1700000000000 } },
  }
  if (method === 'getUiPrefs') return { ok: true, prefs: { ...uiPrefsState } }
  if (method === 'setUiPrefs') { Object.assign(uiPrefsState, (payload && payload.prefs) || {}); return { ok: true, prefs: { ...uiPrefsState } } }
  if (method === 'listRequestLogs') return { ok: true, entries: [{ ts: 1700000000000, sessionId: 'sess-x', route: 'auto', target: { provider: 'deepseek', model: 'deepseek-chat' }, status: 'ok', tryIndex: 1, latencyMs: 400, tokens: { in: 100, out: 200 } }] }
  return { ok: true }
}

// The remote handle: one async method per camelCase RPC name.
const remoteMethods = [
  'listProviders', 'toggleProvider', 'getProvider', 'discoverModels', 'createProvider',
  'deleteProvider', 'updateField', 'updateHeaders', 'applyModels', 'testProvider',
  'setApiKey', 'listRoutes', 'setRoute', 'deleteRoute', 'listComposites', 'setComposite',
  'deleteComposite', 'previewComposite', 'getRouteStats', 'listRequestLogs',
  'clearRequestLogs', 'probeTarget', 'probeAll', 'getUiPrefs', 'setUiPrefs',
  'setThinking', 'getOpenRouter', 'setOpenRouter', 'importOpenRouter', 'openRouterSelfTest',
]
const remoteHandle = {}
for (const m of remoteMethods) {
  remoteHandle[m] = async (payload) => {
    rpcCalls.push({ method: m, payload })
    return { ok: true, value: businessFor(m, payload) }
  }
}

const structures = []
const fake = new FakeReact()
const slotsByName = new Map()

const reflectReads = []
const ctx = {
  get: (name) => {
    if (name === 'locale') return {
      register: () => {},
      // Dictionary lookup for one badge key proves the bound t reaches the
      // badge; everything else stays identity (existing assertions match keys).
      bind: () => (k) => (k === 'badgeRoutePrefix' ? '路由' : k),
    }
    if (name === 'slots') return {
      inject: (slotName, fn) => fn(),
      // Multiple slots coexist (settings page + conversation turnTail badge).
      register: (meta, render) => { slotsByName.set(meta.name, { label: meta, render }); return { id: meta.id } },
    }
    return undefined
  },
  // API Gateway remote surface used by the static-bundle client: the namespace
  // is the traceable property `remote.modelUltra` (cordis forwards `remote.<ns>`
  // through the service tracker) AND readable through reflect, exactly as the
  // real gateway exposes it. resolveRemoteHandle must prefer the property.
  remote: { $mount: async () => () => {}, modelUltra: remoteHandle },
  reflect: { get: (key) => { reflectReads.push(key); return key === 'remote.modelUltra' ? remoteHandle : undefined } },
  effect: (fn) => { const c = fn(); if (typeof c === 'function') c(); return c },
}

// document shim for adoptStyles(): the client owns a <style data-plugin> tag,
// and the effect's disposer removes it on unload. `ctx.effect` below runs the
// disposer eagerly, which is exactly the unload path — so `styleEl` must be
// gone again after apply() while the CSS text stays captured in `structures`.
let styleEl = null
const createdStyles = []
const documentShim = {
  getElementById: () => styleEl,
  createElement: () => {
    const el = {
      attributes: {},
      set textContent(v) { structures.push(v) },
      get textContent() { return '' },
      setAttribute(name, value) { el.attributes[name] = value },
      getAttribute(name) { return el.attributes[name] ?? null },
      remove() { if (styleEl === el) styleEl = null },
    }
    createdStyles.push(el)
    return el
  },
  head: { appendChild: (el) => { styleEl = el } },
}

// Synchronous require the __ModuleLoader__ factory expects.
const requireShim = (spec) => {
  if (spec === 'react') return fake
  if (spec === 'react-dom' || spec === 'react/jsx-runtime') return {}
  throw new Error(`client smoke: unexpected require(${spec})`)
}

const sandbox = {
  console,
  Promise,
  setTimeout,
  clearTimeout,
  Date,
  document: documentShim,
  window: {},
}
sandbox.globalThis = sandbox
// The factory registers itself here; capture it.
let captured = null
sandbox.window.__ModuleLoader__ = {
  load: ({ id, factory }) => { captured = { id, factory } },
}

const code = readFileSync(CLIENT_BUNDLE, 'utf8')
vm.runInContext(code, vm.createContext(sandbox), { filename: 'model-pro-client.js' })
assert(captured && captured.id === 'dsh-model-ultra', 'client bundle registered under its package id')
const moduleExports = captured.factory(requireShim)
const plugin = moduleExports.apply ? moduleExports : moduleExports.default
const badgeMod = moduleExports
plugin.apply(ctx)

const settingsSlot = slotsByName.get('settings.section')
const badgeSlot = slotsByName.get('conversation.chat.turnTail')
assert(settingsSlot && typeof settingsSlot.render === 'function', 'settings.section slot rendered')
assert(settingsSlot.label && typeof settingsSlot.label.label === 'function', 'slot label registered')
assert(badgeSlot && typeof badgeSlot.render === 'function' && badgeSlot.label.id === 'dsh-model-ultra-route-badge', 'turnTail list-seat badge entry registered')
assert(!('select' in badgeSlot.label), 'list seats carry no `select` (the component derives the window)')

// let the async remote $mount effect resolve so `remote` is wired before the
// dashboard's first refresh() fires (the client mounts the remote in an async
// effect; the handle read is synchronous but the await yields a microtask).
await new Promise((r) => setTimeout(r, 10))
assert(reflectReads.length === 0, 'the mount resolved through the traceable `remote.modelUltra` property, not reflect')

// -- every Remote-handle projection the host may expose --
const { resolveRemoteHandle, remoteServiceKey } = badgeMod
assert(remoteServiceKey('modelUltra') === 'remote.modelUltra', 'namespace service key is remote.<namespace>')
const propOnly = { remote: { modelUltra: remoteHandle } }
const reflectOnly = { remote: {}, reflect: { get: (k) => (k === 'remote.modelUltra' ? remoteHandle : undefined) } }
const throwing = { remote: { get modelUltra() { throw new Error('inactive context') } }, reflect: { get: () => remoteHandle } }
assert(resolveRemoteHandle(propOnly, 'modelUltra') === remoteHandle, 'resolves the traceable property projection')
assert(resolveRemoteHandle(reflectOnly, 'modelUltra') === remoteHandle, 'falls back to the reflect projection')
assert(resolveRemoteHandle(throwing, 'modelUltra') === remoteHandle, 'a throwing property read falls back to reflect')
assert(resolveRemoteHandle({ remote: {} }, 'modelUltra') === undefined, 'an unmounted namespace resolves to undefined')
assert(resolveRemoteHandle({}, 'modelUltra') === undefined, 'a host without remote/reflect resolves to undefined')

// render the dashboard; allow the async refresh() to settle (the fake remote
// call resolves on a macrotask, not just the microtask queue)
const out = []
fake.rerender = () => {}
let tree = settingsSlot.render()
renderAt(tree, fake, 'root', out)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', out)
await new Promise((r) => setTimeout(r, 10))

const allClassNames = new Set(out.map((n) => n.className).filter(Boolean))
const all = out.map((n) => n.className)

// -- structure assertions on the REBUILT bundle --
const css = structures.join('\n')
for (const rule of ['.mpro-root', '.mpro-segs', '.mpro-pc', '.mpro-pcActive', '.mpro-pcOff', '.mpro-pill', '.mpro-pillActive', '.mpro-pillOff', '.mpro-verdictOk', '.mpro-discoverBar', '.mpro-step', '.mpro-setupCard', '.mpro-routesTab', '.mpro-statCard', '.mpro-hdotUp', '.mpro-routeRow', '.mpro-targetRow']) {
  assert(css.includes(rule), `styles include ${rule}`)
}

// -- the page CSS is injected as an OWNED <style data-plugin> element and the
// effect disposer removes it again (no stacked rules across reloads) --
assert(createdStyles.length === 1, 'exactly one <style> element created')
assert(createdStyles[0].attributes['data-plugin'] === 'dsh-model-ultra', 'injected <style> is owned (data-plugin)')
assert(styleEl === null, 'the styles effect disposer detached the <style> element on unload')

// -- i18n safety copy present in bundle (esbuild escapes non-ASCII as \uXXXX
// with UPPERCASE hex; match raw and escaped forms case-insensitively) --
assert(code.includes('卸载') || /\\u5378\\u8f7d/i.test(code), 'bundle carries uninstall-safety copy')
assert(code.includes('测试') || /\\u6d4b\\u8bd5/i.test(code), 'bundle carries test-model copy')

const rendered = JSON.stringify(out)
assert(rendered.includes('mpro-root'), 'renders mpro-root')
assert(all.some((c) => c.includes('mpro-segs')), 'renders segment bar')
assert(all.includes('mpro-pc'), 'renders enabled rail card (plain .mpro-pc)')
assert(all.some((c) => c.includes('mpro-pcOff')), 'renders disabled rail card')
assert(all.some((c) => c.includes('mpro-pillOff')), 'renders disabled pill')
assert(out.some((n) => n.tag === 'button' && /test|测试/i.test(n.text)), 'renders a Test action')

// -- smart-routing page: switch to the routes tab and assert the redesigned UI --
const routesTab = out.find((n) => n.tag === 'button' && /tabRoutes/i.test(n.text || ''))
assert(routesTab && typeof routesTab.onClick === 'function', 'smart-routing tab button present')
routesTab.onClick()
const outR = []
renderAt(tree, fake, 'root', outR)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', outR)
assert(outR.some((n) => String(n.className).includes('mpro-routesTabs')), 'renders the 4-tab smart-routing shell')
assert(outR.some((n) => String(n.className).includes('mpro-routesRoot')), 'renders routes root')
assert(outR.some((n) => String(n.className).includes('mpro-routeRow')), 'renders a route row from list-routes')
assert(outR.some((n) => /tabComposites/i.test(n.text || '')), 'renders composite-tab button')
assert(outR.some((n) => /tabObservability/i.test(n.text || '')), 'renders observability-tab button')
assert(outR.some((n) => /tabProbe/i.test(n.text || '')), 'renders probe-tab button')

// -- observability tab renders stat cards + request-log table area --
const obsTab = outR.find((n) => n.tag === 'button' && /tabObservability/i.test(n.text || ''))
assert(obsTab && typeof obsTab.onClick === 'function', 'observability tab clickable')
obsTab.onClick()
const outO = []
renderAt(tree, fake, 'root', outO)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', outO)
assert(outO.some((n) => String(n.className).includes('mpro-statCard')), 'observability renders stat cards')
assert(outO.some((n) => String(n.className).includes('mpro-tblWrap')), 'observability renders tables')
assert(outO.some((n) => String(n.className).includes('mpro-logOk') || String(n.className).includes('mpro-logErr')), 'request-log status styling present')

// -- probe tab renders target health rows with status dots --
const probeTab = outO.find((n) => n.tag === 'button' && /tabProbe/i.test(n.text || ''))
assert(probeTab && typeof probeTab.onClick === 'function', 'probe tab clickable')
probeTab.onClick()
const outP = []
renderAt(tree, fake, 'root', outP)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', outP)
assert(outP.some((n) => String(n.className).includes('mpro-hdotUp')), 'probe tab renders health dots')
assert(outP.some((n) => /probeProbe/i.test(n.text || '')), 'probe tab renders per-target probe buttons')

// -- models tab: search inputs, custom-model add form, current-list bulk ops --
// back to the providers dashboard first
const provTab = outP.find((n) => n.tag === 'button' && /tabProviders/i.test(n.text || ''))
assert(provTab && typeof provTab.onClick === 'function', 'providers tab clickable')
provTab.onClick()
const outD = []
renderAt(tree, fake, 'root', outD)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', outD)
// open the editor for the first provider card
const editBtn = outD.find((n) => n.tag === 'button' && /^edit$/i.test((n.text || '').trim()))
assert(editBtn && typeof editBtn.onClick === 'function', 'provider card Edit button present')
editBtn.onClick()
const outE = []
renderAt(tree, fake, 'root', outE)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', outE)
// switch to the Models tab
const modelsTab = outE.find((n) => n.tag === 'button' && /tabModels/i.test(n.text || ''))
assert(modelsTab && typeof modelsTab.onClick === 'function', 'models tab clickable')
modelsTab.onClick()
const outM = []
renderAt(tree, fake, 'root', outM)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', outM)
const searchInputs = outM.filter((n) => n.tag === 'input' && String(n.className).includes('mpro-searchInput'))
assert(searchInputs.length >= 1, `models tab renders search input(s), got ${searchInputs.length}`)
assert(outM.some((n) => n.tag === 'button' && /^selectAll$/i.test((n.text || '').trim())), 'current list renders select-all')
// open the add-model form and assert its fields + submit button render
const addToggle = outM.find((n) => n.tag === 'button' && /addModelToggle|addModelHide/i.test(n.text || ''))
assert(addToggle && typeof addToggle.onClick === 'function', 'custom-model add toggle present')
addToggle.onClick()
const outA = []
renderAt(tree, fake, 'root', outA)
await new Promise((r) => setTimeout(r, 10))
renderAt(tree, fake, 'root', outA)
assert(outA.some((n) => String(n.className).includes('mpro-addBar')), 'add-model form panel renders')
assert(outA.some((n) => n.tag === 'button' && /addModelBtn/i.test(n.text || '')), 'add-model submit button renders')

// -- thinking-effort tab: route defaults, budgets, per-model manual spellings --
{
  const thTab = outA.find((n) => n.tag === 'button' && /tabThinking/i.test(n.text || ''))
  assert(thTab && typeof thTab.onClick === 'function', 'thinking tab button present in the editor')
  thTab.onClick()
  const outT = []
  renderAt(tree, fake, 'root', outT)
  await new Promise((r) => setTimeout(r, 10))
  renderAt(tree, fake, 'root', outT)
  // route-level editor: level / format / budget-field selects + four budget inputs
  const selects = outT.filter((n) => String(n.className).includes('mpro-select'))
  assert(selects.length >= 3, `thinking tab renders the route-level selects, got ${selects.length}`)
  assert(outT.some((n) => String(n.className).includes('mpro-inputNum')), 'thinking tab renders budget number inputs')
  // layout regression guard: the four budgets are a wrapping flex row of LABELLED
  // fields — reusing `.mpro-hdrRow` (a fixed 3-track grid) pushed inputs onto
  // implicit grid tracks and let the last one spill outside the panel.
  // NB: two render passes land in `outT`, so count the UNIQUE node signatures.
  const uniqBy = (nodes) => new Set(nodes.map((n) => `${n.tag}|${n.className}|${n.text}`))
  const budgetRows = uniqBy(outT.filter((n) => String(n.className).includes('mpro-budgetRow')))
  const budgetFields = uniqBy(outT.filter((n) => String(n.className).includes('mpro-budgetField')))
  const budgetKeys = uniqBy(outT.filter((n) => String(n.className).includes('mpro-budgetKey')))
  assert(budgetRows.size === 1, `budgets render in one dedicated row, got ${budgetRows.size}`)
  assert(budgetFields.size === 4 && budgetKeys.size === 4,
    `each budget keeps its own labelled field, got ${budgetFields.size} fields / ${budgetKeys.size} labels`)
  assert(!outT.some((n) => String(n.className).includes('mpro-hdrRow')),
    'the thinking tab does not reuse the 3-track header-row grid for the budgets')
  // per-model rows: one card per known model (explicit + catalog + overrides).
  // NB: every `out*` array receives two render passes (before/after the async
  // refresh), so exact counts are asserted on the UNIQUE node set.
  const cards = outT.filter((n) => String(n.className).includes('mpro-thCard'))
  const cardTexts = new Set(cards.map((n) => n.text))
  assert(cardTexts.size === 3, `one thinking card per model (deepseek-chat/-reasoner + deepseek-v3), got ${cardTexts.size}: ${JSON.stringify([...cardTexts])}`)
  // the existing override is shown with its storage home (the test's `t` is the
  // identity function for non-badge keys, so the rendered copy is the KEY)
  assert(outT.some((n) => /thinkingStoreOverrides/.test(n.text || '')), 'override storage is labelled')
  // The page must mirror DSH's own picker, not promise more than it shows: the
  // rule is explained up front and every model previews its Effort rows.
  assert(outT.some((n) => String(n.className).includes('mpro-note') && /thinkingPickerIntro/.test(n.text || '')),
    'the panel explains how these settings surface in the chat picker')
  const warnChips = new Set(outT.filter((n) => String(n.className).includes('mpro-chipWarn')).map((n) => n.text))
  assert(warnChips.has('thinkingPickerWarnShort'),
    'a hand-declared model with no levels is flagged (route default would be refused)')
  // expand the first model and check the custom-level editor: 7 level rows with a
  // free-text wire field each, plus preset chips (manual entry + presets).
  const toggle = outT.find((n) => String(n.className).includes('mpro-thToggle'))
  assert(toggle && typeof toggle.onClick === 'function', 'model row is expandable')
  toggle.onClick()
  const outT2 = []
  renderAt(tree, fake, 'root', outT2)
  // expanded card: the picker preview says what an inherited model shows, and the
  // full warning explains the consequence.
  assert(outT2.some((n) => String(n.className).includes('mpro-pickerRow') && /thinkingPickerInherit/.test(n.text || '')),
    'the picker preview renders for an inherited model: ' + JSON.stringify(outT2.filter((n) => String(n.className).includes('mpro-pickerRow')).map((n) => n.text)))
  assert(outT2.some((n) => /thinkingPickerWarnNoLevels/.test(n.text || '')),
    'the expanded warning explains the UNSUPPORTED_REASONING_EFFORT risk')
  const customBtn = outT2.find((n) => n.tag === 'button' && /thinkingModeCustom/i.test(n.text || ''))
  assert(customBtn && typeof customBtn.onClick === 'function', 'custom-levels mode button present')
  customBtn.onClick()
  const outT3 = []
  renderAt(tree, fake, 'root', outT3)
  assert(outT3.some((n) => String(n.className).includes('mpro-pickerRow') && /thinkingPickerNoRows/.test(n.text || '')),
    'with no level enabled the preview warns that saving deletes the field')
  assert(outT3.some((n) => /thinkingPresetHint/.test(n.text || '')), 'the preset hint explains it writes picker rows')
  const rows = outT3.filter((n) => n.tag === 'tr')
  assert(rows.length >= 8, `custom mode renders the 7-level table (header + rows), got ${rows.length}`)
  assert(outT3.some((n) => String(n.className).includes('mpro-thTable')), 'level table renders')
  const spellingInputs = outT3.filter((n) => n.tag === 'input' && String(n.className).includes('mpro-inputMono'))
  assert(spellingInputs.length >= 7, `a wire-spelling field per level, got ${spellingInputs.length}`)
  assert(outT3.some((n) => n.tag === 'button' && String(n.className).includes('mpro-chip')), 'preset chips render per level')

  // save the ROUTE settings and assert the RPC payload carries the escalation
  // level + all four budgets + the compat switches (a true patch).
  const saveRoute = outT.find((n) => n.tag === 'button' && /thinkingSaveRoute/i.test(n.text || ''))
  assert(saveRoute && typeof saveRoute.onClick === 'function', 'save-route button present')
  rpcCalls.length = 0
  saveRoute.onClick()
  await new Promise((r) => setTimeout(r, 20))
  const routeCall = rpcCalls.find((c) => c.method === 'setThinking')
  assert(routeCall !== undefined, 'save-route issued set-thinking')
  assert(routeCall.payload.route === 'deepseek', 'set-thinking targets the edited route')
  assert(routeCall.payload.patch.reasoning === 'high', 'route patch carries the default level: ' + JSON.stringify(routeCall.payload.patch))
  assert(routeCall.payload.patch.thinkingBudgets.high === 8192, 'route patch carries all four budgets')
  assert(routeCall.payload.patch.compat.thinkingFormat === 'openrouter', 'route patch carries the compat switches')

  // save the MODEL settings: the payload must be the normalized effort map
  const saveModel = outT3.find((n) => n.tag === 'button' && /thinkingSaveModel/i.test(n.text || ''))
  assert(saveModel && typeof saveModel.onClick === 'function', 'save-model button present')
  rpcCalls.length = 0
  saveModel.onClick()
  await new Promise((r) => setTimeout(r, 20))
  const modelCall = rpcCalls.find((c) => c.method === 'setThinking')
  assert(modelCall !== undefined, 'save-model issued set-thinking')
  assert(modelCall.payload.modelId === 'deepseek-chat', 'the edited model id is sent: ' + JSON.stringify(modelCall.payload))
  assert(modelCall.payload.patch.reasoningEfforts !== undefined, 'model patch carries reasoningEfforts')
  assert(!Object.hasOwn(modelCall.payload.patch, 'reasoning'), 'model patch carries no route-level field')
}

// -- OpenRouter tab: provider list, mode, quantization, attribution, status --
{
  // The editor replaces the whole page while a provider is selected, so leave it
  // first: the top-level tabs only exist on the dashboard.
  const backBtn = outA.find((n) => n.tag === 'button' && /^←\s*back$/i.test((n.text || '').trim()))
  assert(backBtn && typeof backBtn.onClick === 'function', 'editor back button present')
  backBtn.onClick()
  const outDash = []
  renderAt(tree, fake, 'root', outDash)
  await new Promise((r) => setTimeout(r, 10))
  renderAt(tree, fake, 'root', outDash)
  const orTab = outDash.find((n) => n.tag === 'button' && /tabOpenRouter/i.test(n.text || ''))
  assert(orTab && typeof orTab.onClick === 'function', 'OpenRouter tab button present')
  orTab.onClick()
  const outO2 = []
  renderAt(tree, fake, 'root', outO2)
  await new Promise((r) => setTimeout(r, 20))
  renderAt(tree, fake, 'root', outO2)
  assert(outO2.some((n) => String(n.className).includes('mpro-orCard')), 'OpenRouter panel renders its card')
  assert(rpcCalls.some((c) => c.method === 'getOpenRouter'), 'the panel requested get-openrouter on mount')
  assert(outO2.some((n) => n.tag === 'textarea' && String(n.className).includes('mpro-textarea')), 'provider list textarea renders')
  const modeSelect = outO2.find((n) => n.tag === 'select' && (n.text || '').includes('orModeOrder'))
  assert(modeSelect !== undefined, 'mode select renders both options: ' + JSON.stringify(outO2.filter((n) => n.tag === 'select').map((n) => n.text)))
  const quantSelect = outO2.find((n) => n.tag === 'select' && (n.text || '').includes('orQuantUnlimited'))
  assert(quantSelect !== undefined, 'quantization select renders the unlimited + level options')
  assert(outO2.some((n) => (n.text || '').includes('orEnabled')), 'master switch renders')
  assert(outO2.some((n) => n.tag === 'button' && /orImport/i.test(n.text || '')), 'legacy-import button renders')
  assert(outO2.some((n) => n.tag === 'button' && /orSelfTest/i.test(n.text || '')), 'self-test button renders')
  // the status table reports the live shaper + the projection
  assert(outO2.some((n) => /orShaperLive/i.test(n.text || '')), 'shaper status line renders')
  assert(outO2.some((n) => /allow_fallbacks/.test(n.text || '')), 'self-test projection (provider params) renders')

  // saving posts the parsed list + mode + quantization as a patch
  const saveBtn = outO2.find((n) => n.tag === 'button' && /orSave/i.test((n.text || '')))
  assert(saveBtn !== undefined, 'save button renders')
  rpcCalls.length = 0
  saveBtn.onClick()
  await new Promise((r) => setTimeout(r, 20))
  const setCall = rpcCalls.find((c) => c.method === 'setOpenRouter')
  assert(setCall !== undefined, 'save issued set-openrouter')
  assert(Array.isArray(setCall.payload.patch.providers) && setCall.payload.patch.providers[0] === 'DeepInfra',
    'the patch carries the parsed provider list: ' + JSON.stringify(setCall.payload.patch.providers))
  assert(setCall.payload.patch.mode === 'only' && setCall.payload.patch.quantization === 'int8', 'the patch carries mode + quantization')

  // the legacy-import button issues import-openrouter
  const importBtn = outO2.find((n) => n.tag === 'button' && /orImport/i.test(n.text || ''))
  rpcCalls.length = 0
  importBtn.onClick()
  await new Promise((r) => setTimeout(r, 20))
  assert(rpcCalls.some((c) => c.method === 'importOpenRouter'), 'import button issued import-openrouter')

  // back to the providers list for the remaining assertions
  const backTab = outO2.find((n) => n.tag === 'button' && /tabProviders/i.test(n.text || ''))
  assert(backTab && typeof backTab.onClick === 'function', 'providers tab still reachable')
  backTab.onClick()
  const outB = []
  renderAt(tree, fake, 'root', outB)
  await new Promise((r) => setTimeout(r, 10))
  renderAt(tree, fake, 'root', outB)
  assert(outB.some((n) => String(n.className).includes('mpro-pc')), 'the provider rail still renders after visiting the new tabs')
}

// -- conversation badge (turnTail): DSH 0.2.0-rc.1 declares this seat as a LIST
// slot, so the entry carries no `select`; the component derives the turn window
// from the owner Turn itself (selectTurnSelection) and reads turn timings from
// the chat snapshot hook (`useChat`) --
{
  const T = 1700000000000
  const ownerTurn = { turn: 7, start: { time: T - 5_000 }, end: { time: T } }
  const sel = badgeMod.selectTurnSelection({ turn: ownerTurn, seq: 42 })
  assert(sel && typeof sel.from === 'number' && typeof sel.to === 'number' && sel.from < T && sel.to >= T, 'selectTurnSelection derives the turn window: ' + JSON.stringify(sel))
  assert(sel.turn === 7, 'selectTurnSelection carries the turn number for precise correlation')
  assert(badgeMod.selectTurnSelection({}) === null, 'selectTurnSelection declines turns without boundaries')
  assert(badgeMod.selectTurnSelection(null) === null, 'selectTurnSelection declines a missing owner')

  // positive render: OWNER props only — a list seat never supplies `matched`.
  // The mocked log entry (sessionId sess-x, ts T) sits inside the derived window.
  const badgeOut = []
  fake.rerender = () => {}
  let btree = badgeSlot.render({ turn: ownerTurn, seq: 42, sessionId: 'sess-x' })
  renderAt(btree, fake, 'badge', badgeOut)
  await new Promise((r) => setTimeout(r, 10))
  btree = badgeSlot.render({ turn: ownerTurn, seq: 42, sessionId: 'sess-x' })
  renderAt(btree, fake, 'badge', badgeOut)
  await new Promise((r) => setTimeout(r, 10))
  assert(badgeOut.some((n) => String(n.className).includes('mpro-badgeRow')), 'badge row renders for a routed turn')
  assert(badgeOut.some((n) => (n.text || '') === '路由'), 'badge renders the TRANSLATED label, not the raw dictionary key')
  assert(badgeOut.some((n) => String(n.className).includes('mpro-badgeChip') && /deepseek-chat/.test(n.text || '')), 'badge names the serving target: ' + JSON.stringify(badgeOut.filter((n) => String(n.className).includes('mpro-badge')).map((n) => n.text)))

  // a turn outside the window renders nothing
  const farTurn = { turn: 9, start: { time: T + 60_000 }, end: { time: T + 120_000 } }
  const badgeOut2 = []
  let btree2 = badgeSlot.render({ turn: farTurn, seq: 42, sessionId: 'sess-x' })
  renderAt(btree2, fake, 'badgeFar', badgeOut2)
  await new Promise((r) => setTimeout(r, 10))
  btree2 = badgeSlot.render({ turn: farTurn, seq: 42, sessionId: 'sess-x' })
  renderAt(btree2, fake, 'badgeFar', badgeOut2)
  await new Promise((r) => setTimeout(r, 10))
  assert(!badgeOut2.some((n) => String(n.className).includes('mpro-badgeRow')), 'badge stays hidden for turns the router did not serve')

  // -- precise per-turn attribution: the window must end at the NEXT turn's
  // start, never overlap it. Overlapping ±slack windows were the cause of
  // "有时候有有时候没有" (adjacent turns stealing/dropping each others' logs). --

  // turnTimings: turn 1 starts at T, turn 2 starts at T+30s.
  const timings = new Map([
    [1, { startTime: T, endTime: T + 20_000 }],
    [2, { startTime: T + 30_000, endTime: T + 50_000 }],
  ])
  const snap = { legacy: { turnTimings: timings } }

  const k1 = badgeMod.preciseWindowKey(snap, 1)
  const [f1, t1] = k1.split('|').map(Number)
  assert(t1 === T + 30_000, `turn 1 window ends exactly at turn 2 start, got ${t1 - T}ms offset`)
  assert(f1 === T - 1_000, `turn 1 window starts at its own start (small lead-in), got ${f1 - T}`)

  const k2 = badgeMod.preciseWindowKey(snap, 2)
  const [f2, t2b] = k2.split('|').map(Number)
  assert(f2 === T + 29_000, 'turn 2 window starts at its own start')
  assert(t2b > T + 50_000, 'latest turn keeps an open-ended window so late logs still land')
  assert(f2 >= t1 - 1_000, 'adjacent turn windows do not overlap materially')

  // The REAL 0.2.0-rc.1 source is the CHAT VIEW snapshot the `useChat` seat
  // hands us: `snapshot.timeline.turns` (turn objects with start:{time}).
  // Reading only the legacy paths was why the precise window silently fell back
  // to the coarse ±slack window on the live build.
  const turnsMap = new Map([
    [1, { turn: 1, start: { time: T }, end: { time: T + 20_000 }, status: 'closed' }],
    [2, { turn: 2, start: { time: T + 30_000 }, status: 'open' }],
  ])
  const snapTimeline = { timeline: { turns: turnsMap } }
  const kt1 = badgeMod.preciseWindowKey(snapTimeline, 1)
  const [ft1, tt1] = kt1.split('|').map(Number)
  assert(tt1 === T + 30_000 && ft1 === T - 1_000, 'timeline.turns path yields the same precise window as turnTimings: ' + kt1)
  // Older builds nested the same data under `snapshot.chat`; still accepted.
  assert(badgeMod.preciseWindowKey({ chat: { timeline: { turns: turnsMap } } }, 1) === k1, 'legacy snapshot.chat.timeline.turns path still works')
  assert(badgeMod.preciseWindowKey({ chat: { legacy: { turnTimings: timings } } }, 1) === k1, 'legacy snapshot.chat.legacy.turnTimings path still works')
  assert(badgeMod.preciseWindowKey({ chat: { turnTimings: timings } }, 1) === k1, 'legacy snapshot.chat.turnTimings path still works')

  assert(badgeMod.preciseWindowKey({}, 1) === '', 'precise window declines a snapshot without any timing source (falls back)')
  assert(badgeMod.preciseWindowKey(snap, 99) === '', 'precise window declines an unknown turn')
  assert(badgeMod.preciseWindowKey(null, 1) === '', 'precise window is throw-free on a missing snapshot')

  // The component must PREFER the precise window over the coarse derived one:
  // the mocked log entry sits inside the coarse window, but we hand the seat a
  // chat snapshot placing this turn far away — the badge must then stay hidden.
  const badgeOut3 = []
  const farTurns = new Map([[sel.turn, { turn: sel.turn, start: { time: T + 600_000 } }], [sel.turn + 1, { turn: sel.turn + 1, start: { time: T + 700_000 } }]])
  const farUseChat = (fn) => fn({ timeline: { turns: farTurns } })
  let btree3 = badgeSlot.render({ turn: ownerTurn, seq: 42, sessionId: 'sess-x', useChat: farUseChat })
  renderAt(btree3, fake, 'badgePrecise', badgeOut3)
  await new Promise((r) => setTimeout(r, 10))
  btree3 = badgeSlot.render({ turn: ownerTurn, seq: 42, sessionId: 'sess-x', useChat: farUseChat })
  renderAt(btree3, fake, 'badgePrecise', badgeOut3)
  await new Promise((r) => setTimeout(r, 10))
  assert(!badgeOut3.some((n) => String(n.className).includes('mpro-badgeRow')),
    'precise timeline window overrides the coarse window (no cross-turn attribution)')

  // ...and with a precise window that DOES contain the entry, it renders again.
  const badgeOut4 = []
  const nearTurns = new Map([[sel.turn, { turn: sel.turn, start: { time: T - 1_000 } }]])
  const nearUseChat = (fn) => fn({ timeline: { turns: nearTurns } })
  let btree4 = badgeSlot.render({ turn: ownerTurn, seq: 42, sessionId: 'sess-x', useChat: nearUseChat })
  renderAt(btree4, fake, 'badgeNear', badgeOut4)
  await new Promise((r) => setTimeout(r, 10))
  btree4 = badgeSlot.render({ turn: ownerTurn, seq: 42, sessionId: 'sess-x', useChat: nearUseChat })
  renderAt(btree4, fake, 'badgeNear', badgeOut4)
  await new Promise((r) => setTimeout(r, 10))
  assert(badgeOut4.some((n) => String(n.className).includes('mpro-badgeRow')),
    'badge renders when the precise window contains the routed call')
}

console.log('PASS: client structural smoke — slot registered and redesigned dashboard rendered')
console.log('  nodes:', out.length, '| classes seen:', [...allClassNames].filter((c) => c.includes('mpro-')).slice(0, 8).join(', '))
