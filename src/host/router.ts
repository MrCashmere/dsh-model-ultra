/** Smart-routing router adapter — the dispatch engine.
 *
 * Registers TWO synthetic provider routes:
 *   - `router`    : models are the NAMED routes from llm-pi-ai[routes]
 *                   (strategy + targets + weights + config)
 *   - `composite` : models are encoded `compositeName::modelId` combos from
 *                   llm-pi-ai[composites] (union / intersection merges)
 *
 * At call time the adapter picks targets by the route's strategy, honours
 * weights, skips probe-down targets when `healthAware`, respects `maxFallbacks`,
 * pins sessions when `sticky`, and records outcome + tokens into the stats
 * recorder / health tracker. Every target is resolved to its wire id
 * (`requestModel` mapping) before forwarding, same as the llm/stream rewrite.
 *
 * Chunks, message blocks, and finish reasons pass through untouched — forwards
 * are a transparent pipe. The table is read LIVE per call — editing a route or
 * composite never requires re-registering.
 */

import type { HostCtx } from './utils'
import { readRoutes, wireModelOf } from './utils'
import { ROUTER_ROUTE, COMPOSITE_ROUTE, COMPOSITE_SEP, DEFAULT_ROUTE_STRATEGY } from '../shared/constants'
import type { RouteSpec, RouteTarget, RouteStrategy, TargetHealth } from '../shared/types'
import { readComposites, decodeCompositeModel, compositeTargetsFor, resolveCompositeModels } from './composite'
import { getHealthTracker } from './health'
import { getStatsRecorder } from './statsStore'

type LlmLike = {
  registerAdapter(providers: string[], adapter: unknown): () => void
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<Record<string, unknown>>
  prepareCall(config: Record<string, unknown>, signal?: AbortSignal): Promise<{
    config?: Record<string, unknown>
    stream: (options: Record<string, unknown>) => AsyncIterable<Record<string, any>>
  }>
}

function llmOf(ctx: HostCtx): LlmLike | undefined {
  return ctx.get('llm') as unknown as LlmLike | undefined
}

function firstErrorFrom(chunk: Record<string, any>): string | undefined {
  if (!chunk || chunk.type !== 'finish') return undefined
  const reason = chunk.reason
  if (reason && typeof reason === 'object') {
    if (reason.kind === 'error') {
      return String((reason.failure && reason.failure.message) || reason.message || '未知错误')
    }
  }
  return undefined
}

function buildCallConfig(target: RouteTarget, wire: string, options: Record<string, any>): Record<string, unknown> {
  const c: Record<string, unknown> = { provider: target.provider, model: wire }
  if (options.reasoningEffort !== undefined) c.reasoningEffort = options.reasoningEffort
  if (options.temperature !== undefined) c.temperature = options.temperature
  if (options.maxTokens !== undefined) c.maxTokens = options.maxTokens
  if (options.stop !== undefined) c.stop = options.stop
  return c
}

function buildTargetOptions(callConfig: Record<string, unknown>, options: Record<string, any>): Record<string, unknown> {
  const o: Record<string, unknown> = { ...callConfig, messages: options.messages }
  if (options.system !== undefined) o.system = options.system
  if (options.tools !== undefined) o.tools = options.tools
  if (options.signal !== undefined) o.signal = options.signal
  if (options.sessionId !== undefined) o.sessionId = options.sessionId
  if (options.purpose !== undefined) o.purpose = options.purpose
  return o
}

/** Usage tokens from a finish chunk (adapter-optional; best effort). */
function tokensFrom(chunk: Record<string, any>): { in?: number; out?: number } {
  const u = chunk && chunk.usage
  if (!u || typeof u !== 'object') return {}
  const out: { in?: number; out?: number } = {}
  if (typeof u.prompt_tokens === 'number') out.in = u.prompt_tokens
  if (typeof u.input_tokens === 'number') out.in = u.input_tokens
  if (typeof u.completion_tokens === 'number') out.out = u.completion_tokens
  if (typeof u.output_tokens === 'number') out.out = u.output_tokens
  return out
}

/* --------------------------------------------------------------------------
 * Strategy ordering
 * ------------------------------------------------------------------------ */

/** Rotated copy of targets starting at `start` so fallbacks walk a stable cycle. */
function rotate<T>(arr: T[], start: number): T[] {
  if (!arr.length) return arr
  const i = ((start % arr.length) + arr.length) % arr.length
  return arr.slice(i).concat(arr.slice(0, i))
}

/** Deterministic weighted pick -> `start` index (smooth weighted round robin). */
function weightedStart(targets: RouteTarget[], cursor: Record<string, number[]>, route: string): number {
  const weights = targets.map((t) => (typeof t.weight === 'number' && t.weight > 0 ? t.weight : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return Math.floor(Math.random() * targets.length)
  // Smooth weighted round-robin: keep a per-route current-weight vector.
  const cur = cursor[route] || (cursor[route] = weights.slice())
  if (cur.length !== weights.length) cursor[route] = weights.slice()
  let best = 0
  for (let j = 1; j < weights.length; j++) {
    if ((cursor[route] as number[])[j] > (cursor[route] as number[])[best]) best = j
  }
  const current = cursor[route] as number[]
  current[best] -= total
  for (let j = 0; j < weights.length; j++) current[j] += weights[j]
  return best
}

/** Build the ordered candidate list for a strategy, returning `{order, cursorKey}`. */
function orderTargets(
  spec: RouteSpec,
  targets: RouteTarget[],
  health: { entry(p: string, m: string): TargetHealth | undefined },
  cursor: Record<string, number[]>,
  cursorKey: string,
  options: Record<string, any>,
): RouteTarget[] {
  const strategy: RouteStrategy = spec.strategy || DEFAULT_ROUTE_STRATEGY
  const targetsArr = targets.filter((t) => t.enabled !== false)

  switch (strategy) {
    case 'priority':
      return targetsArr
    case 'weighted':
    case 'round-robin': {
      const start = weightedStart(targetsArr, cursor, cursorKey)
      return rotate(targetsArr, start)
    }
    case 'min-latency': {
      const withLat = targetsArr.map((t, i) => {
        const e = health.entry(t.provider, t.model)
        const lat = e && typeof e.latencyMs === 'number' ? e.latencyMs : Number.MAX_SAFE_INTEGER
        return { t, lat, i }
      })
      withLat.sort((a, b) => (a.lat === b.lat ? a.i - b.i : a.lat - b.lat))
      return withLat.map((x) => x.t)
    }
    case 'sticky': {
      // Actual session pinning is applied by the stream loop (which owns the
      // pin map); here sticky behaves as priority-order fallback for previews.
      return targetsArr
    }
    default:
      return targetsArr
  }
}

/** Expose the picker (used by tests / future preview). */
export function computeTargetOrder(
  spec: RouteSpec,
  targets: RouteTarget[],
  health: { entry(p: string, m: string): TargetHealth | undefined },
  options: Record<string, any>,
  cursor: Record<string, number[]> = {},
  cursorKey = spec.strategy,
): RouteTarget[] {
  return orderTargets(spec, targets, health, cursor, cursorKey, options)
}

/* --------------------------------------------------------------------------
 * The adapter
 * ------------------------------------------------------------------------ */

export function makeRouterAdapter(ctx: HostCtx): unknown {
  const llm = llmOf(ctx)
  const st = () => ctx.get('settings')
  const health = () => getHealthTracker(ctx)
  const stats = () => getStatsRecorder()

  /** Resolve a named route spec from storage (routes table). */
  const routeOf = (name: string): RouteSpec | undefined => {
    const spec = readRoutes(st())[name]
    if (!spec || typeof spec !== 'object') return undefined
    const targets = Array.isArray(spec.targets)
      ? spec.targets
          .filter((t): t is RouteTarget => !!t && typeof t === 'object' && typeof t.provider === 'string' && typeof t.model === 'string')
          .map((t) => ({ provider: t.provider, model: t.model, ...(typeof t.weight === 'number' ? { weight: t.weight } : {}), ...(typeof t.enabled === 'boolean' ? { enabled: t.enabled } : {}) }))
      : []
    if (!targets.length) return undefined
    return { strategy: spec.strategy || DEFAULT_ROUTE_STRATEGY, targets, ...(spec.config ? { config: spec.config } : {}) }
  }

  /** Resolve targets + strategy for a composite model id. */
  const compositePlan = (model: string): { spec: RouteSpec; routeName: string } | undefined => {
    const dec = decodeCompositeModel(model)
    if (!dec) return undefined
    const comp = readComposites(ctx)[dec.composite]
    if (!comp) return undefined
    const targets = compositeTargetsFor(ctx, dec.composite, dec.model)
    if (!targets.length) return undefined
    const spec: RouteSpec = { strategy: comp.strategy || DEFAULT_ROUTE_STRATEGY, targets }
    return { spec, routeName: `${dec.composite}::${dec.model}` }
  }

  /** 24h-ish cursor key for round-robin/weighted state (per route identity). */
  const cursor: Record<string, number[]> = {}
  const pin: Record<string, RouteTarget> = {}

  return {
    providerInfo(provider: string) {
      return { id: provider, name: provider === COMPOSITE_ROUTE ? '组合提供商' : '智能路由' }
    },
    providerRetryPolicy() {
      return undefined
    },
    async listModels(provider: string) {
      const out: Array<{ provider: string; id: string; name: string; description?: string }> = []
      if (provider === COMPOSITE_ROUTE) {
        for (const name of Object.keys(readComposites(ctx))) {
          const res = await resolveCompositeModels(ctx, name)
          if (!res.ok) continue
          for (const id of res.ids) {
            out.push({ provider, id: `${name}${COMPOSITE_SEP}${id}`, name: id, description: `${name} · ${res.mode}` })
          }
        }
        return dedupeModels(out)
      }
      // router route
      const routes = readRoutes(st())
      for (const name of Object.keys(routes)) {
        const spec = routeOf(name)
        if (!spec) continue
        out.push({ provider, id: name, name, description: `${spec.strategy} · ${spec.targets.length} 个目标` })
      }
      return out
    },
    async resolveModel(provider: string, model: string, signal?: AbortSignal) {
      const base = { provider, id: model, name: model }
      let spec: RouteSpec | undefined
      if (provider === COMPOSITE_ROUTE) {
        const plan = compositePlan(model)
        if (plan) spec = plan.spec
      } else {
        spec = routeOf(model)
      }
      if (!spec || !llm || !spec.targets.length) return base
      const first = spec.targets[0]
      try {
        const wire = wireModelOf(st(), first.provider, first.model)
        const info = await llm.resolveModelInfo(first.provider, wire, signal)
        return { ...info, provider, id: model, name: model }
      } catch {
        return base
      }
    },
    async *stream(options: Record<string, any>): AsyncIterable<unknown> {
      const provider = options.provider
      const model = options.model

      let spec: RouteSpec | undefined
      let routeName = model
      if (provider === COMPOSITE_ROUTE) {
        const plan = compositePlan(model)
        if (plan) { spec = plan.spec; routeName = plan.routeName }
      } else {
        spec = routeOf(model)
      }
      if (!spec || !llm) throw new Error(`智能路由「${model}」未配置或没有可用目标`)

      const healthAware = spec.config?.healthAware !== false
      const maxFallbacks = typeof spec.config?.maxFallbacks === 'number' && spec.config.maxFallbacks >= 0
        ? Math.floor(spec.config.maxFallbacks)
        : spec.targets.length

      // Healthy + enabled candidate list (skip probe-down unless everything is).
      const candidates = spec.targets.filter((t) => t.enabled !== false)
      const healthFiltered = healthAware
        ? candidates.filter((t) => health().isHealthy(t.provider, t.model))
        : candidates
      const pool = healthFiltered.length ? healthFiltered : candidates
      if (!pool.length) throw new Error(`智能路由「${model}」全部目标失败：无可用目标`)

      const ordered = orderTargets(spec, pool, health(), cursor, routeName, options)
      const attemptList = ordered.slice(0, maxFallbacks)

      const sid = typeof options.sessionId === 'string' && options.sessionId ? options.sessionId : ''
      const pinKey = sid ? `${routeName}\u0000${sid}` : ''
      // Sticky pin: reuse the last successful target of this session when healthy.
      const pinned = pin[pinKey]
      if (pinned && attemptList.some((t) => t.provider === pinned.provider && t.model === pinned.model) && health().isHealthy(pinned.provider, pinned.model)) {
        attemptList.sort((a, b) => {
          const ap = a.provider === pinned.provider && a.model === pinned.model ? 0 : 1
          const bp = b.provider === pinned.provider && b.model === pinned.model ? 0 : 1
          return ap - bp
        })
      }

      const t0 = Date.now()
      let lastErr = ''
      let tryIndex = 0
      let committed = false

      for (const target of attemptList) {
        tryIndex += 1
        const wire = wireModelOf(st(), target.provider, target.model)
        const attemptStart = Date.now()
        try {
          const callConfig = buildCallConfig(target, wire, options)
          const prepared = await llm.prepareCall(callConfig, options.signal)
          // The resolver may clamp/normalize the config (e.g. a model maxTokens
          // cap). DSH compares stream() options against `prepared.config` on
          // provider/model/temperature/maxTokens/reasoningEffort/stop and throws
          // "prepared LLM call config changed before adapter dispatch" on drift,
          // so dispatch with the RESOLVED config, not our requested one.
          const resolvedConfig = (prepared && typeof (prepared as any).config === 'object' && (prepared as any).config)
            ? (prepared as any).config as Record<string, unknown>
            : callConfig
          const iterator = prepared.stream(buildTargetOptions(resolvedConfig, options))[Symbol.asyncIterator]()

          // Pull the first chunk to establish the connection; if the target is
          // dead (throw, or an error finish), fall through to the next one.
          let first
          try {
            first = await iterator.next()
          } catch {
            await tryReturn(iterator)
            health().markDown(target.provider, target.model, '连接失败')
            lastErr = `目标 ${target.provider}/${wire} 连接失败`
            continue
          }
          if (first.done) {
            await tryReturn(iterator)
            health().markUp(target.provider, target.model)
            committed = true
            break
          }
          const firstErr = firstErrorFrom(first.value)
          if (firstErr) {
            await tryReturn(iterator)
            health().markDown(target.provider, target.model, firstErr)
            lastErr = `目标 ${target.provider}/${wire}: ${firstErr}`
            continue
          }

          // Committed to this target — replay the first chunk, then drain.
          health().markUp(target.provider, target.model, Date.now() - attemptStart)
          committed = true
          if (pinKey) pin[pinKey] = target

          let tokens: { in?: number; out?: number } = {}
          yield first.value
          while (true) {
            let item
            try {
              item = await iterator.next()
            } catch (error) {
              health().markDown(target.provider, target.model, String((error as Error)?.message || error))
              stats().record({
                route: routeName, provider: target.provider, model: wire, ok: false,
                latencyMs: Date.now() - t0, tryIndex, sessionId: sid,
                error: `传输中断: ${String((error as Error)?.message || error)}`,
              })
              throw new Error(`目标 ${target.provider}/${wire} 传输中断: ${String((error as Error)?.message || error)}`)
            }
            if (item.done) {
              stats().record({
                route: routeName, provider: target.provider, model: wire, ok: true,
                latencyMs: Date.now() - t0, tokensIn: tokens.in, tokensOut: tokens.out,
                tryIndex, sessionId: sid,
              })
              return
            }
            const tk = tokensFrom(item.value)
            if (tk.in !== undefined) tokens.in = tk.in
            if (tk.out !== undefined) tokens.out = tk.out
            yield item.value
          }
        } catch (error) {
          stats().record({
            route: routeName, provider: target.provider, model: wire, ok: false,
            latencyMs: Date.now() - t0, tryIndex, sessionId: sid,
            error: String((error as Error)?.message || error),
          })
          lastErr = `目标 ${target.provider}/${wire}: ${String((error as Error)?.message || error)}`
        }
      }

      if (!committed) {
        // Final report for the aggregate failure.
        throw new Error(`智能路由「${model}」全部目标失败：${lastErr || '无可用目标'}`)
      }
    },
  }
}

async function tryReturn(iterator: AsyncIterator<unknown>): Promise<void> {
  try {
    if (typeof iterator.return === 'function') await iterator.return()
  } catch { /* best effort */ }
}

function dedupeModels(arr: Array<{ provider: string; id: string; name: string; description?: string }>) {
  const seen = new Set<string>()
  return arr.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
}

/** Register the router adapter on both synthetic routes, tied to the fiber. */
export function registerRouterAdapter(ctx: HostCtx): void {
  const llm = llmOf(ctx)
  if (!llm || typeof llm.registerAdapter !== 'function') return
  const ctxAny = ctx as any
  if (typeof ctxAny.effect !== 'function') return
  ctxAny.effect(() => {
    try {
      return llm.registerAdapter([ROUTER_ROUTE, COMPOSITE_ROUTE], makeRouterAdapter(ctx))
    } catch {
      return () => undefined
    }
  }, 'dsh-model-pro: router adapter')
}