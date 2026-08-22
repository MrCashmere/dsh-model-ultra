/**
 * Client half structural smoke test (static-bundle mode).
 *
 * Loads the REAL built `dist/client.js`. In static-bundle mode that file is a
 * `window.__ModuleLoader__.load({ id, factory })` call; the factory receives a
 * synchronous `require` and returns the CJS module (exporting apply). We
 * provide `require` (React + externals), a minimal `document` for CSS
 * adoption, and a `ctx` whose `remote.$mount` + `reflect.get` expose a mocked
 * `modelPro` remote. The remote's methods return the Gateway envelope
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
const businessFor = (method, payload) => {
  if (method === 'listProviders') return { ok: true, providers: testProviders, protocols: ['openai-completions', 'openai-responses', 'anthropic-messages'], writable: true }
  if (method === 'listRoutes') return { ok: true, routes: { auto: { strategy: 'priority', targets: [{ provider: 'deepseek', model: 'deepseek-chat' }] } } }
  if (method === 'getProvider') return { ok: true, models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }], availableModels: [] }
  if (method === 'listComposites') return { ok: true, composites: {} }
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
]
const remoteHandle = {}
for (const m of remoteMethods) {
  remoteHandle[m] = async (payload) => ({ ok: true, value: businessFor(m, payload) })
}

const structures = []
const fake = new FakeReact()
const slotsByName = new Map()

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
  // API Gateway remote surface used by the static-bundle client.
  remote: { $mount: async () => () => {} },
  reflect: { get: (key) => (key === 'remote.modelPro' ? remoteHandle : undefined) },
  effect: (fn) => { const c = fn(); if (typeof c === 'function') c(); return c },
}

// document shim for adoptStyles() (the client injects a <style> element).
const documentShim = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) { structures.push(v) }, get textContent() { return '' } }),
  head: { appendChild: () => {} },
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
assert(captured && captured.id === 'dsh-model-pro', 'client bundle registered under its package id')
const moduleExports = captured.factory(requireShim)
const plugin = moduleExports.apply ? moduleExports : moduleExports.default
plugin.apply(ctx)

const settingsSlot = slotsByName.get('settings.section')
const badgeSlot = slotsByName.get('conversation.chat.turnTail')
assert(settingsSlot && typeof settingsSlot.render === 'function', 'settings.section slot rendered')
assert(settingsSlot.label && typeof settingsSlot.label.label === 'function', 'slot label registered')
assert(badgeSlot && typeof badgeSlot.render === 'function' && typeof badgeSlot.label.select === 'function', 'turnTail badge slot registered with a select')

// let the async remote $mount effect resolve so `remote` is wired before the
// dashboard's first refresh() fires (the client mounts the remote in an async
// effect; reflect.get is synchronous but the await yields a microtask).
await new Promise((r) => setTimeout(r, 10))

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

// -- conversation badge (turnTail): select + render pipeline --
{
  const sel = badgeSlot.label.select({ turn: { start: { time: 1700000000000 - 5000 }, end: { time: 1700000000000 } }, seq: 42 })
  assert(sel && typeof sel.from === 'number' && typeof sel.to === 'number' && sel.from < 1700000000000 && sel.to >= 1700000000000, 'badge select derives the turn window: ' + JSON.stringify(sel))
  assert(badgeSlot.label.select({}) === null, 'badge select declines turns without boundaries')
  assert(badgeSlot.label.select(null) === null, 'badge select declines a missing owner')

  // positive render: the mocked log entry (sessionId sess-x) sits inside sel.
  const badgeOut = []
  fake.rerender = () => {}
  let btree = badgeSlot.render({ matched: sel, sessionId: 'sess-x' })
  renderAt(btree, fake, 'badge', badgeOut)
  await new Promise((r) => setTimeout(r, 10))
  btree = badgeSlot.render({ matched: sel, sessionId: 'sess-x' })
  renderAt(btree, fake, 'badge', badgeOut)
  await new Promise((r) => setTimeout(r, 10))
  assert(badgeOut.some((n) => String(n.className).includes('mpro-badgeRow')), 'badge row renders for a routed turn')
  assert(badgeOut.some((n) => (n.text || '') === '路由'), 'badge renders the TRANSLATED label, not the raw dictionary key')
  assert(badgeOut.some((n) => String(n.className).includes('mpro-badgeChip') && /deepseek-chat/.test(n.text || '')), 'badge names the serving target: ' + JSON.stringify(badgeOut.filter((n) => String(n.className).includes('mpro-badge')).map((n) => n.text)))

  // a turn outside the window renders nothing
  const far = { from: sel.to + 60_000, to: sel.to + 120_000 }
  const badgeOut2 = []
  let btree2 = badgeSlot.render({ matched: far, sessionId: 'sess-x' })
  renderAt(btree2, fake, 'badgeFar', badgeOut2)
  await new Promise((r) => setTimeout(r, 10))
  btree2 = badgeSlot.render({ matched: far, sessionId: 'sess-x' })
  renderAt(btree2, fake, 'badgeFar', badgeOut2)
  await new Promise((r) => setTimeout(r, 10))
  assert(!badgeOut2.some((n) => String(n.className).includes('mpro-badgeRow')), 'badge stays hidden for turns the router did not serve')
}

console.log('PASS: client structural smoke — slot registered and redesigned dashboard rendered')
console.log('  nodes:', out.length, '| classes seen:', [...allClassNames].filter((c) => c.includes('mpro-')).slice(0, 8).join(', '))
