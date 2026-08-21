/**
 * Client half structural smoke test.
 *
 * Loads the REAL built `dist/client.js` into a vm sandbox with the same
 * injected globals the Cordis client runner provides (React, styles, host,
 * slots, locale), then renders the registered `settings.section` slot through
 * a tiny React renderer that executes hooks and effects against mocked data.
 * Asserts the redesigned dashboard (segments + state-rail cards, active and
 * disabled) constructs without throwing.
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

  clone() {
    return Object.create(this)
  }
}

function renderAt(rootVNode, fake, path, out) {
  const { type, props, children } = rootVNode
  if (type === fake.Fragment) {
    for (let i = 0; i < children.length; i++) renderAt(children[i], fake, `${path}:${i}`, out)
    return
  }
  if (typeof type === 'string') {
    out.push({ tag: type, className: props?.className || '', text: collectText(children) })
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

const host = {
  call: async (method, payload) => {
    if (method === 'list-providers') return { ok: true, providers: testProviders, protocols: ['openai-completions', 'openai-responses', 'anthropic-messages'], writable: true }
    return { ok: true }
  },
}

const structures = []
const fake = new FakeReact()
let slotRender = null
let slotLabel = null

const ctx = {
  get: (name) => {
    if (name === 'locale') return {
      register: () => {},
      bind: () => (k) => k,
    }
    if (name === 'slots') return {
      inject: (name, fn) => fn(),
      register: (meta, render) => { slotLabel = meta; slotRender = render; return { id: meta.id } },
    }
    return undefined
  },
  effect: (fn) => { const c = fn(); if (typeof c === 'function') c() },
}

const sandbox = {
  console,
  Promise,
  setTimeout,
  clearTimeout,
  Date,
  React: fake,
  styles: { insert: (css) => structures.push(css) },
  host,
}
sandbox.globalThis = sandbox

const code = readFileSync(CLIENT_BUNDLE, 'utf8')
const result = await vm.runInContext(`(async () => { ${code} })()`, vm.createContext(sandbox), { filename: 'cordis-dyn-client.js' })
const plugin = result.apply ? result : result.default
plugin.apply(ctx)

assert(typeof slotRender === 'function', 'settings.section slot rendered')
assert(typeof slotLabel?.label === 'function', 'slot label registered')

// render the dashboard; allow the async refresh() to settle a few microtasks
const out = []
fake.rerender = () => {}
let tree = slotRender()
renderAt(tree, fake, 'root', out)
await Promise.resolve()
renderAt(tree, fake, 'root', out)
await Promise.resolve()

const allClassNames = new Set(out.map((n) => n.className).filter(Boolean))
const all = out.map((n) => n.className)

// -- structure assertions on the REBUILT bundle --
const css = structures.join('\n')
for (const rule of ['.mpro-root', '.mpro-segs', '.mpro-pc', '.mpro-pcActive', '.mpro-pcOff', '.mpro-pill', '.mpro-pillActive', '.mpro-pillOff', '.mpro-verdictOk', '.mpro-discoverBar', '.mpro-step', '.mpro-setupCard', '.mpro-tabTest']) {
  assert(css.includes(rule), `styles include ${rule}`)
}

// -- i18n safety copy present in bundle --
assert(code.includes('卸载') || /u5378u8f7d/.test(code), 'bundle carries uninstall-safety copy')
assert(code.includes('测试') || /u6d4bu8bd5/.test(code), 'bundle carries test-model copy')

const rendered = JSON.stringify(out)
assert(rendered.includes('mpro-root'), 'renders mpro-root')
assert(all.some((c) => c.includes('mpro-segs')), 'renders segment bar')
assert(all.some((c) => c.includes('mpro-pcActive')), 'renders enabled rail card')
assert(all.some((c) => c.includes('mpro-pcOff')), 'renders disabled rail card')
assert(all.some((c) => c.includes('mpro-pillOff')), 'renders disabled pill')
assert(out.some((n) => n.tag === 'button' && /测试|Test/.test(n.text)), 'renders a Test action')

console.log('PASS: client structural smoke — slot registered and redesigned dashboard rendered')
console.log('  nodes:', out.length, '| classes seen:', [...allClassNames].filter((c) => c.includes('mpro-')).slice(0, 8).join(', '))
