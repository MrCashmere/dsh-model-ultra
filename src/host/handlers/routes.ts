/** Smart-routing route CRUD. A route is a NAMED bundle of targets
 * (`{ strategy, targets: [{ provider, model, weight?, enabled? }], config? }`)
 * stored under llm-pi-ai[ROUTES_KEY] and consumed live by the router adapter —
 * editing does NOT require re-registering.
 *
 * Strategies: priority (ordered + fallback), weighted (by weight), round-robin
 * (smooth weighted), min-latency (historical latency), sticky (session pin). */

import type { HostCtx } from '../utils'
import { checkWritable, readRoutes, writeRoutes } from '../utils'
import type { RoutesMap, RouteSpec, RouteTarget, RouteStrategy, RouteConfig } from '../../shared/types'
import { ROUTE_STRATEGIES, DEFAULT_ROUTE_STRATEGY } from '../../shared/constants'

const ROUTE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/

/** A route spec from storage; tolerant of the older flat `{provider, model}`
 * shape so a pre-upgrade config keeps working (migrated in memory). */
function normalizeSpec(raw: unknown): RouteSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.targets)) {
    const targets = r.targets
      .filter((t): t is RouteTarget => !!t && typeof t === 'object' && typeof (t as RouteTarget).provider === 'string' && typeof (t as RouteTarget).model === 'string')
      .map((t) => {
        const base: RouteTarget = { provider: t.provider, model: t.model }
        if (typeof t.weight === 'number' && t.weight > 0) base.weight = t.weight
        if (typeof t.enabled === 'boolean') base.enabled = t.enabled
        return base
      })
    if (!targets.length) return null
    const spec: RouteSpec = {
      strategy: (ROUTE_STRATEGIES as readonly string[]).includes(String(r.strategy))
        ? r.strategy as RouteStrategy
        : DEFAULT_ROUTE_STRATEGY,
      targets,
    }
    if (r.config && typeof r.config === 'object') {
      const cfg = r.config as Record<string, unknown>
      const config: RouteConfig = {}
      if (typeof cfg.maxFallbacks === 'number') config.maxFallbacks = cfg.maxFallbacks
      if (typeof cfg.healthAware === 'boolean') config.healthAware = cfg.healthAware
      if (typeof cfg.sticky === 'boolean') config.sticky = cfg.sticky
      if (typeof cfg.timeoutMs === 'number') config.timeoutMs = cfg.timeoutMs
      if (Object.keys(config).length) spec.config = config
    }
    return spec
  }
  // legacy flat alias { provider, model }
  if (typeof r.provider === 'string' && typeof r.model === 'string') {
    return { strategy: DEFAULT_ROUTE_STRATEGY, targets: [{ provider: r.provider, model: r.model }] }
  }
  return null
}

export async function listRoutes(ctx: HostCtx, _args?: unknown) {
  const st = ctx.get('settings')
  const parsed: RoutesMap = {}
  for (const [name, spec] of Object.entries(readRoutes(st))) {
    const n = normalizeSpec(spec)
    if (n) parsed[name] = n
  }
  return { ok: true as const, routes: parsed }
}

export async function setRoute(ctx: HostCtx, args: {
  alias?: string
  strategy?: string
  targets?: Array<{ provider?: string; model?: string; weight?: number; enabled?: boolean }>
  config?: Record<string, unknown>
}) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const alias = typeof args?.alias === 'string' ? args.alias.trim() : ''
  if (!ROUTE_NAME_RE.test(alias))
    return { ok: false as const, error: '路由名仅允许字母、数字、下划线、点、横线（≤64 字符）' }

  const strategy = (typeof args?.strategy === 'string' && args.strategy.trim() && (ROUTE_STRATEGIES as readonly string[]).includes(args.strategy.trim()))
    ? args.strategy.trim() as RouteStrategy
    : DEFAULT_ROUTE_STRATEGY

  const targets: RouteTarget[] = []
  if (!Array.isArray(args?.targets)) return { ok: false as const, error: 'targets 必须是数组' }
  for (const t of args.targets) {
    const provider = typeof t?.provider === 'string' ? t.provider.trim() : ''
    const model = typeof t?.model === 'string' ? t.model.trim() : ''
    if (!provider || !model) return { ok: false as const, error: 'targets 中每条目标都需 provider 与 model' }
    if (targets.some((x) => x.provider === provider && x.model === model)) continue
    const target: RouteTarget = { provider, model }
    if (typeof t?.weight === 'number' && t.weight > 0) target.weight = t.weight
    if (typeof t?.enabled === 'boolean') target.enabled = t.enabled
    targets.push(target)
  }
  if (!targets.length) return { ok: false as const, error: '至少需要一个目标 provider+model' }

  const config: RouteConfig = {}
  if (args?.config && typeof args.config === 'object') {
    const c = args.config as Record<string, unknown>
    if (typeof c.maxFallbacks === 'number' && c.maxFallbacks >= 0) config.maxFallbacks = Math.floor(c.maxFallbacks)
    if (typeof c.healthAware === 'boolean') config.healthAware = c.healthAware
    if (typeof c.sticky === 'boolean') config.sticky = c.sticky
    if (typeof c.timeoutMs === 'number' && c.timeoutMs > 0) config.timeoutMs = c.timeoutMs
  }

  try {
    const spec: RouteSpec = { strategy, targets }
    if (Object.keys(config).length) spec.config = config
    const routes: RoutesMap = { ...readRoutes(st), [alias]: spec }
    await writeRoutes(st, routes)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }
  return { ok: true as const, alias, route: { strategy, targets, config } }
}

export async function deleteRoute(ctx: HostCtx, args: { alias?: string }) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const alias = typeof args?.alias === 'string' ? args.alias.trim() : ''
  if (!alias) return { ok: false as const, error: '缺少路由名' }

  try {
    const routes = readRoutes(st)
    delete routes[alias]
    await writeRoutes(st, routes)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }
  return { ok: true as const, alias }
}
