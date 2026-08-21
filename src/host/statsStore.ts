/** Stats + probe-health + bounded request-log store.
 *
 * Sandbox constraint: the dynamic Host half has NO node `fs`/`require`/`fetch`;
 * only settings + cordis services. So aggregation that must survive the session
 * lives in the `llm-pi-ai` settings section under ROUTE_STATS_KEY (a bounded,
 * small object — call counts, latency, tokens, probe health). The high-frequency
 * per-request log is kept as a bounded in-memory ring buffer (last N) and served
 * by a handler; it is not persisted, which keeps `settings.replace` from being
 * hammered by every call. Optional JSONL persistence behind `ctx.get('fs')` is a
 * best-effort future enhancement, not required for correctness.
 */

import type { HostCtx } from './utils'
import { readRoutesRootKey, writeRoutesRootKey } from './utils'
import type { RouteStats, RequestLogEntry, TargetHealth } from '../shared/types'

/** Bounded request-log ring capacity. */
export const LOG_RING_CAPACITY = 500

/** Snapshot shape stored under llm-pi-ai[ROUTE_STATS_KEY]. */
export interface StatsSnapshot {
  /** Aggregate per-route-tuple `provider\u0000model` -> stats (also covers
   * composites addressed by their own route key). */
  byTarget: Record<string, RouteStats>
  /** Per-route-name -> stats. */
  byRoute: Record<string, RouteStats>
  /** Probe health per target. */
  health: Record<string, TargetHealth>
}

export function readStatsSnapshot(ctx: HostCtx): StatsSnapshot {
  const raw = readRoutesRootKey(ctx.get('settings'), 'routeStats')
  const s: StatsSnapshot = { byTarget: {}, byRoute: {}, health: {} }
  if (!raw || typeof raw !== 'object') return s
  const r = raw as Record<string, unknown>
  const byTargetRaw = r.byTarget as Record<string, unknown> | undefined
  if (byTargetRaw && typeof byTargetRaw === 'object') {
    for (const k of Object.keys(byTargetRaw)) {
      const v = byTargetRaw[k] as Record<string, unknown> | undefined
      if (v && typeof v === 'object') s.byTarget[k] = normalizeStats(v as Record<string, number>)
    }
  }
  const byRouteRaw = r.byRoute as Record<string, unknown> | undefined
  if (byRouteRaw && typeof byRouteRaw === 'object') {
    for (const k of Object.keys(byRouteRaw)) {
      const v = byRouteRaw[k] as Record<string, unknown> | undefined
      if (v && typeof v === 'object') s.byRoute[k] = normalizeStats(v as Record<string, number>)
    }
  }
  if (r.health && typeof r.health === 'object') s.health = r.health as Record<string, TargetHealth>
  return s
}

export async function writeStatsSnapshot(ctx: HostCtx, snap: StatsSnapshot): Promise<void> {
  await writeRoutesRootKey(ctx.get('settings'), 'routeStats', snap)
}

function normalizeStats(v: Record<string, number>): RouteStats {
  return {
    calls: typeof v.calls === 'number' ? v.calls : 0,
    errors: typeof v.errors === 'number' ? v.errors : 0,
    latencySum: typeof v.latencySum === 'number' ? v.latencySum : 0,
    latencyN: typeof v.latencyN === 'number' ? v.latencyN : 0,
    tokensIn: typeof v.tokensIn === 'number' ? v.tokensIn : 0,
    tokensOut: typeof v.tokensOut === 'number' ? v.tokensOut : 0,
  }
}

/** Accumulate one completed call into a stats object. */
export function accumulateStats(s: RouteStats, opts: { ok: boolean; latencyMs: number; tokensIn?: number; tokensOut?: number }): RouteStats {
  const next: RouteStats = {
    calls: s.calls + 1,
    errors: s.errors + (opts.ok ? 0 : 1),
    latencySum: s.latencySum + opts.latencyMs,
    latencyN: s.latencyN + 1,
    tokensIn: s.tokensIn + (typeof opts.tokensIn === 'number' ? opts.tokensIn : 0),
    tokensOut: s.tokensOut + (typeof opts.tokensOut === 'number' ? opts.tokensOut : 0),
  }
  return next
}

/** In-memory bounded request log shared across the fiber. */
export interface LogRing {
  push(entry: RequestLogEntry): void
  entries(): RequestLogEntry[]
  clear(): void
}

export function createLogRing(capacity = LOG_RING_CAPACITY): LogRing {
  const buf: RequestLogEntry[] = []
  return {
    push(entry) {
      buf.push(entry)
      if (buf.length > capacity) buf.splice(0, buf.length - capacity)
    },
    entries: () => buf.slice(),
    clear: () => { buf.length = 0 },
  }
}

/** Session-scoped stats accumulator (union of route + target dimensions). */
export interface StatsRecorder {
  record(opts: {
    route: string
    provider: string
    model: string
    ok: boolean
    latencyMs: number
    tokensIn?: number
    tokensOut?: number
    tryIndex: number
    sessionId?: string
    error?: string
  }): void
  byRoute(): Record<string, RouteStats>
  byTarget(): Record<string, RouteStats>
  reset(): void
}

export function createStatsRecorder(): StatsRecorder {
  const byRoute: Record<string, RouteStats> = {}
  const byTarget: Record<string, RouteStats> = {}
  const bump = (m: Record<string, RouteStats>, k: string, opts: { ok: boolean; latencyMs: number; tokensIn?: number; tokensOut?: number }) => {
    const cur: RouteStats = m[k] || { calls: 0, errors: 0, latencySum: 0, latencyN: 0, tokensIn: 0, tokensOut: 0 }
    m[k] = accumulateStats(cur, opts)
  }
  return {
    record({ route, provider, model, ok, latencyMs, tokensIn, tokensOut, tryIndex, sessionId, error }) {
      bump(byRoute, route, { ok, latencyMs, tokensIn, tokensOut })
      bump(byTarget, `${provider}\u0000${model}`, { ok, latencyMs, tokensIn, tokensOut })
      getLogRing().push({
        ts: Date.now(),
        ...(sessionId ? { sessionId } : {}),
        route,
        target: { provider, model },
        status: ok ? 'ok' : 'error',
        tryIndex,
        latencyMs,
        tokens: {
          ...(typeof tokensIn === 'number' ? { in: tokensIn } : {}),
          ...(typeof tokensOut === 'number' ? { out: tokensOut } : {}),
        },
        ...(error ? { error } : {}),
      })
    },
    byRoute: () => ({ ...byRoute }),
    byTarget: () => ({ ...byTarget }),
    reset: () => {
      for (const k of Object.keys(byRoute)) delete byRoute[k]
      for (const k of Object.keys(byTarget)) delete byTarget[k]
      getLogRing().clear()
    },
  }
}

/** Fiber-scoped singletons so the router and the handlers share one recorder. */
let _logRing: LogRing | undefined
export function getLogRing(): LogRing {
  _logRing ||= createLogRing()
  return _logRing
}

let _statsRecorder: StatsRecorder | undefined
export function getStatsRecorder(): StatsRecorder {
  _statsRecorder ||= createStatsRecorder()
  return _statsRecorder
}

/** Rebind the singletons (used by the smoke harness to reset between scenarios). */
export function resetObservabilitySingletons(): void {
  _logRing = undefined
  _statsRecorder = undefined
}
