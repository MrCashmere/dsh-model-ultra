// dsh-model-pro — Host half
// Provides RPC handlers for llm-pi-ai provider lifecycle management.
// All handlers are registered via harness.handle() and called by the Client half.
//
// Key design: disabled providers are moved to a separate `disabledProviders` dict
// so the llm-pi-ai adapter (which only reads `providers`) stops registering them.

const NS = 'llm-pi-ai'
const PROTOS = ['openai-completions', 'openai-responses', 'anthropic-messages']

// The dsh-settings isPlainObject check (proto === Object.prototype || proto === null)
// rejects sandbox-realm object literals because vm contexts have their own
// Object.prototype. Object.create(null) produces a null-proto object that
// passes isPlainObject, so we recursively rebuild every object with it.
function makeHostPlain(obj) {
  var out = Object.create(null)
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue
    var v = obj[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = makeHostPlain(v)
    } else if (Array.isArray(v)) {
      out[k] = v.map(function (item) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) return makeHostPlain(item)
        return item
      })
    } else {
      out[k] = v
    }
  }
  return out
}

function readProviders(st) {
  if (st === undefined) return {}
  try {
    const section = st.get(NS)
    if (section && typeof section === 'object' && section.providers && typeof section.providers === 'object') return section.providers
  } catch {}
  return {}
}

function readDisabled(st) {
  if (st === undefined) return {}
  try {
    const section = st.get(NS)
    if (section && typeof section === 'object' && section.disabledProviders && typeof section.disabledProviders === 'object') return section.disabledProviders
  } catch {}
  return {}
}

function readProfile(providers, route) {
  const p = providers[route]
  if (!p || typeof p !== 'object') return null
  return p
}

function apply(ctx) {
  harness.handle('list-providers', async function () {
    const st = ctx.get('settings')
    const llm = ctx.get('llm')
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    let dir = []
    if (llm !== undefined) { try { dir = llm.listConfigurableProviders() } catch {} }
    const dirMap = new Map(dir.filter((e) => e.settingsNs === NS).map((e) => [e.provider, e]))
    const items = []
    const allRoutes = new Set([...Object.keys(providers), ...Object.keys(disabled)])
    for (const route of allRoutes) {
      const p = readProfile(providers, route) || readProfile(disabled, route)
      if (!p) continue
      const entry = dirMap.get(route)
      const hasExplicit = Array.isArray(p.models) && p.models.length > 0
      const isDisabled = Object.prototype.hasOwnProperty.call(disabled, route)
      items.push({
        route,
        displayName: (typeof p.displayName === 'string' && p.displayName) || (entry ? entry.displayName : undefined) || route,
        declared: entry ? entry.declared === true : true,
        api: p.api || '',
        baseURL: p.baseURL || '',
        apiKeyEnv: p.apiKeyEnv || '',
        disabled: isDisabled,
        hasHeaders: p.headers && typeof p.headers === 'object' && Object.keys(p.headers).length > 0,
        headerCount: p.headers && typeof p.headers === 'object' ? Object.keys(p.headers).length : 0,
        modelCount: hasExplicit ? p.models.length : 0,
        usesCatalog: !hasExplicit,
      })
    }
    items.sort((a, b) => a.route.localeCompare(b.route))
    let writable = true
    try { if (st !== undefined) writable = st.writable !== false } catch {}
    return { ok: true, providers: items, writable, protocols: PROTOS }
  })

  harness.handle('toggle-provider', async function (args) {
    const st = ctx.get('settings')
    if (st === undefined) return { ok: false, error: 'settings 服务不可用' }
    let writable = true
    try { writable = st.writable !== false } catch {}
    if (!writable) return { ok: false, error: '设置只读' }
    const route = args && args.route
    if (!route) return { ok: false, error: '缺少 route' }
    const enabled = args.enabled !== false
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    if (!Object.prototype.hasOwnProperty.call(providers, route) && !Object.prototype.hasOwnProperty.call(disabled, route)) return { ok: false, error: '提供商 "' + route + '" 不存在' }
    try {
      const nextProviders = {}
      const nextDisabled = {}
      for (const k of Object.keys(providers)) nextProviders[k] = providers[k]
      for (const k of Object.keys(disabled)) nextDisabled[k] = disabled[k]
      if (enabled) {
        if (Object.prototype.hasOwnProperty.call(nextDisabled, route)) {
          nextProviders[route] = nextDisabled[route]
          delete nextDisabled[route]
        }
      } else {
        if (Object.prototype.hasOwnProperty.call(nextProviders, route)) {
          nextDisabled[route] = nextProviders[route]
          delete nextProviders[route]
        }
      }
      const section = { providers: nextProviders, disabledProviders: nextDisabled }
      await st.replace(NS, makeHostPlain(section))
    } catch (err) { return { ok: false, error: String((err && err.message) || err) } }
    return { ok: true, route, enabled }
  })

  harness.handle('get-provider', async function (args) {
    const st = ctx.get('settings')
    const route = args && args.route
    if (!route) return { ok: false, error: '缺少 route' }
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    const p = readProfile(providers, route) || readProfile(disabled, route)
    if (!p) return { ok: false, error: '提供商 "' + route + '" 不存在' }
    const isDisabled = Object.prototype.hasOwnProperty.call(disabled, route)
    const headers = p.headers && typeof p.headers === 'object' ? Object.entries(p.headers).map(([k, v]) => ({ name: k, value: String(v) })) : []
    const hasExplicit = Array.isArray(p.models) && p.models.length > 0
    const models = hasExplicit ? p.models.map((m) => m && typeof m === 'object' ? { ...m } : { id: String(m) }) : []
    return { ok: true, route, displayName: p.displayName || '', api: p.api || '', baseURL: p.baseURL || '', apiKeyEnv: p.apiKeyEnv || '', disabled: isDisabled, headers, models, usesCatalog: !hasExplicit }
  })

  harness.handle('discover-models', async function (args) {
    const llm = ctx.get('llm')
    if (llm === undefined) return { ok: false, error: 'llm 服务不可用' }
    const route = args && args.route
    if (!route) return { ok: false, error: '缺少 route' }
    const st = ctx.get('settings')
    const providers = readProviders(st)
    const p = readProfile(providers, route)
    const request = { provider: route, baseURL: (args.baseURL) || (p && p.baseURL) || undefined, api: (args.api) || (p && p.api) || undefined }
    if (args.apiKey && typeof args.apiKey === 'string' && args.apiKey.length > 0) request.apiKey = args.apiKey
    try {
      const disc = await llm.discoverModels(NS, request)
      const models = disc.map((m) => ({ id: m.id, name: m.name || m.id, ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}), ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}) }))
      return { ok: true, models }
    } catch (err) { return { ok: false, error: String((err && err.message) || err) } }
  })

  harness.handle('create-provider', async function (args) {
    const st = ctx.get('settings')
    if (st === undefined) return { ok: false, error: 'settings 服务不可用' }
    let writable = true
    try { writable = st.writable !== false } catch {}
    if (!writable) return { ok: false, error: '设置只读' }
    const route = args && args.route
    if (!route || typeof route !== 'string' || !route.trim()) return { ok: false, error: '缺少 route' }
    const id = route.trim()
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) return { ok: false, error: 'route 仅允许字母数字、下划线、点、横线' }
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    if (Object.prototype.hasOwnProperty.call(providers, id)) return { ok: false, error: '提供商 "' + id + '" 已存在' }
    if (Object.prototype.hasOwnProperty.call(disabled, id)) return { ok: false, error: '提供商 "' + id + '" 已存在(已禁用)' }
    const profile = {}
    if (args.displayName && args.displayName.trim()) profile.displayName = args.displayName.trim()
    if (args.api && PROTOS.indexOf(args.api) >= 0) profile.api = args.api
    if (args.baseURL && args.baseURL.trim()) profile.baseURL = args.baseURL.trim()
    else return { ok: false, error: '新建提供商必须填写 baseURL' }
    if (args.apiKeyEnv && args.apiKeyEnv.trim()) profile.apiKeyEnv = args.apiKeyEnv.trim()
    profile.models = [{ id: 'placeholder', name: 'placeholder' }]
    try {
      const next = {}
      for (const k of Object.keys(providers)) next[k] = providers[k]
      next[id] = makeHostPlain(profile)
      const existingDisabled = {}
      for (const k of Object.keys(disabled)) existingDisabled[k] = disabled[k]
      await st.replace(NS, makeHostPlain({ providers: next, disabledProviders: existingDisabled }))
    } catch (err) { return { ok: false, error: String((err && err.message) || err) } }
    return { ok: true, route: id }
  })

  harness.handle('delete-provider', async function (args) {
    const st = ctx.get('settings')
    if (st === undefined) return { ok: false, error: 'settings 服务不可用' }
    let writable = true
    try { writable = st.writable !== false } catch {}
    if (!writable) return { ok: false, error: '设置只读' }
    const route = args && args.route
    if (!route) return { ok: false, error: '缺少 route' }
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    if (!Object.prototype.hasOwnProperty.call(providers, route) && !Object.prototype.hasOwnProperty.call(disabled, route)) return { ok: false, error: '提供商 "' + route + '" 不存在' }
    try {
      const nextProviders = {}
      for (const k of Object.keys(providers)) { if (k !== route) nextProviders[k] = providers[k] }
      const nextDisabled = {}
      for (const k of Object.keys(disabled)) { if (k !== route) nextDisabled[k] = disabled[k] }
      await st.replace(NS, makeHostPlain({ providers: nextProviders, disabledProviders: nextDisabled }))
    } catch (err) { return { ok: false, error: String((err && err.message) || err) } }
    return { ok: true, route }
  })

  harness.handle('update-field', async function (args) {
    const st = ctx.get('settings')
    if (st === undefined) return { ok: false, error: 'settings 服务不可用' }
    let writable = true
    try { writable = st.writable !== false } catch {}
    if (!writable) return { ok: false, error: '设置只读' }
    const route = args && args.route
    const field = args && args.field
    if (!route) return { ok: false, error: '缺少 route' }
    const allowed = ['displayName', 'api', 'baseURL', 'apiKeyEnv']
    if (allowed.indexOf(field) < 0) return { ok: false, error: '不支持的字段: ' + field }
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    const srcP = readProfile(providers, route) || readProfile(disabled, route)
    if (!srcP) return { ok: false, error: '提供商 "' + route + '" 不存在' }
    const value = args.value
    try {
      const nextProviders = {}
      for (const k of Object.keys(providers)) {
        const src = providers[k]
        if (k === route) {
          const cur = {}
          for (const fk of Object.keys(src)) cur[fk] = src[fk]
          if (value === null || (typeof value === 'string' && value.trim() === '')) delete cur[field]
          else cur[field] = typeof value === 'string' ? value.trim() : value
          nextProviders[k] = cur
        } else {
          nextProviders[k] = src
        }
      }
      const nextDisabled = {}
      for (const k of Object.keys(disabled)) {
        const src = disabled[k]
        if (k === route) {
          const cur = {}
          for (const fk of Object.keys(src)) cur[fk] = src[fk]
          if (value === null || (typeof value === 'string' && value.trim() === '')) delete cur[field]
          else cur[field] = typeof value === 'string' ? value.trim() : value
          nextDisabled[k] = cur
        } else {
          nextDisabled[k] = src
        }
      }
      await st.replace(NS, makeHostPlain({ providers: nextProviders, disabledProviders: nextDisabled }))
    } catch (err) { return { ok: false, error: String((err && err.message) || err) } }
    return { ok: true, route, field }
  })

  harness.handle('update-headers', async function (args) {
    const st = ctx.get('settings')
    if (st === undefined) return { ok: false, error: 'settings 服务不可用' }
    let writable = true
    try { writable = st.writable !== false } catch {}
    if (!writable) return { ok: false, error: '设置只读' }
    const route = args && args.route
    if (!route) return { ok: false, error: '缺少 route' }
    const headers = args && args.headers
    if (!Array.isArray(headers)) return { ok: false, error: 'headers 必须是数组' }
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    const srcP = readProfile(providers, route) || readProfile(disabled, route)
    if (!srcP) return { ok: false, error: '提供商 "' + route + '" 不存在' }
    const dict = {}
    for (const h of headers) {
      if (!h || typeof h !== 'object') continue
      const name = typeof h.name === 'string' ? h.name.trim() : ''
      const value = typeof h.value === 'string' ? h.value : ''
      if (!name) continue
      if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'api-key') continue
      dict[name] = value
    }
    try {
      const nextProviders = {}
      for (const k of Object.keys(providers)) {
        const src = providers[k]
        if (k === route) {
          const cur = {}
          for (const fk of Object.keys(src)) cur[fk] = src[fk]
          if (Object.keys(dict).length === 0) delete cur.headers
          else cur.headers = dict
          nextProviders[k] = cur
        } else {
          nextProviders[k] = src
        }
      }
      const nextDisabled = {}
      for (const k of Object.keys(disabled)) {
        const src = disabled[k]
        if (k === route) {
          const cur = {}
          for (const fk of Object.keys(src)) cur[fk] = src[fk]
          if (Object.keys(dict).length === 0) delete cur.headers
          else cur.headers = dict
          nextDisabled[k] = cur
        } else {
          nextDisabled[k] = src
        }
      }
      await st.replace(NS, makeHostPlain({ providers: nextProviders, disabledProviders: nextDisabled }))
      return { ok: true, route, headerCount: Object.keys(dict).length }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })

  harness.handle('apply-models', async function (args) {
    const st = ctx.get('settings')
    if (st === undefined) return { ok: false, error: 'settings 服务不可用' }
    let writable = true
    try { writable = st.writable !== false } catch {}
    if (!writable) return { ok: false, error: '设置只读' }
    const route = args && args.route
    if (!route) return { ok: false, error: '缺少 route' }
    const models = args && args.models
    if (!Array.isArray(models)) return { ok: false, error: 'models 必须是数组' }
    const mode = args.mode || 'merge'
    const providers = readProviders(st)
    const disabled = readDisabled(st)
    const p = readProfile(providers, route) || readProfile(disabled, route)
    if (!p) return { ok: false, error: '提供商 "' + route + '" 不存在' }
    const toEntry = (m) => m && typeof m === 'object' ? { ...m } : { id: String(m) }
    const existing = Array.isArray(p.models) ? p.models.map(toEntry) : []
    let next
    if (mode === 'replace') { next = models.map(toEntry) }
    else if (mode === 'merge') { next = [...existing]; for (const m of models) { const e = toEntry(m); const idx = next.findIndex((x) => x.id === e.id); if (idx >= 0) next[idx] = { ...next[idx], ...e }; else next.push(e) } }
    else if (mode === 'remove') { const toRemove = new Set(models.map((m) => m && typeof m === 'object' ? m.id : String(m))); next = existing.filter((m) => !toRemove.has(m.id)) }
    else { return { ok: false, error: '未知 mode: ' + mode } }
    if (next.length === 0) {
      const llm = ctx.get('llm')
      let inCatalog = false
      if (llm !== undefined) { try { inCatalog = llm.listConfigurableProviders().some((e) => e.settingsNs === NS && e.provider === route && e.declared !== true) } catch {} }
      if (!inCatalog) return { ok: false, error: '不能删除全部模型: 自定义提供商必须至少保留一个模型条目' }
    }
    try {
      const srcP2 = readProviders(st)
      const srcD2 = readDisabled(st)
      const nextProviders = {}
      for (const k of Object.keys(srcP2)) {
        const src = srcP2[k]
        if (k === route) {
          const cur = {}
          for (const fk of Object.keys(src)) cur[fk] = src[fk]
          if (next.length === 0) delete cur.models
          else cur.models = next
          nextProviders[k] = cur
        } else {
          nextProviders[k] = src
        }
      }
      const nextDisabled = {}
      for (const k of Object.keys(srcD2)) {
        const src = srcD2[k]
        if (k === route) {
          const cur = {}
          for (const fk of Object.keys(src)) cur[fk] = src[fk]
          if (next.length === 0) delete cur.models
          else cur.models = next
          nextDisabled[k] = cur
        } else {
          nextDisabled[k] = src
        }
      }
      await st.replace(NS, makeHostPlain({ providers: nextProviders, disabledProviders: nextDisabled }))
    } catch (err) { return { ok: false, error: String((err && err.message) || err) } }
    return { ok: true, route, count: next.length }
  })
}

return { apply }
