/** Per-target probe / health tracking.
 *
 * Keeps an in-memory health table (`provider`+`model` -> TargetHealth) updated
 * by real call outcomes and by explicit probes. The router consults it for
 * `healthAware` dispatch (skip `down` targets, with a hard-fail cooldown). A
 * lightweight snapshot is mirrored into the settings section under
 * llm-pi-ai[ROUTE_STATS_KEY] so the smart-routing page can surface the last
 * known status across sessions without a separate store.
 */

import type { HostCtx } from './utils'
import { readStatsSnapshot, writeStatsSnapshot } from './statsStore'
import type { TargetHealth } from '../shared/types'

/** How long a target stays "down" before routing retries it (ms). */
const DOWN_COOLDOWN_MS = 60_000

function initTable(ctx: HostCtx): Record<string, TargetHealth> {
  const snap = readStatsSnapshot(ctx)
  const out: Record<string, TargetHealth> = {}
  if (snap && typeof snap.health === 'object' && snap.health) {
    const h = snap.health as Record<string, unknown>
    for (const k of Object.keys(h)) {
      const v = h[k] as Record<string, unknown> | undefined
      if (v && typeof v === 'object') {
        // Build without ever assigning `undefined`: the host->client RPC
        // boundary rejects undefined values, so optional fields are OMITTED
        // rather than set to undefined.
        const entry: TargetHealth = {
          provider: String(v.provider || ''),
          model: String(v.model || ''),
          status: (v.status as TargetHealth['status']) || 'unknown',
          consecutiveFails: typeof v.consecutiveFails === 'number' ? v.consecutiveFails : 0,
        }
        if (typeof v.lastProbeAt === 'number') entry.lastProbeAt = v.lastProbeAt
        if (typeof v.latencyMs === 'number') entry.latencyMs = v.latencyMs
        if (typeof v.lastError === 'string') entry.lastError = v.lastError
        out[k] = entry
      }
    }
  }
  return out
}

/** The health tracker bound to a fiber. Persists lazily on mutation. */
export interface HealthTracker {
  table(): Record<string, TargetHealth>
  markUp(provider: string, model: string, latencyMs?: number): void
  markDown(provider: string, model: string, error?: string): void
  markProbing(provider: string, model: string): void
  /** Is this target currently considered healthy for dispatch? */
  isHealthy(provider: string, model: string): boolean
  /** Snapshot one entry for the UI without the timing fields. */
  entry(provider: string, model: string): TargetHealth | undefined
}

export function createHealthTracker(ctx: HostCtx): HealthTracker {
  let table = initTable(ctx)
  let dirty = false
  const key = (p: string, m: string) => `${p}\u0000${m}`

  const flush = async () => {
    if (!dirty) return
    dirty = false
    try {
      const snap = readStatsSnapshot(ctx)
      await writeStatsSnapshot(ctx, { ...snap, health: table })
    } catch { /* best effort */ }
  }
  // Flush on a timer so burst call outcomes don't hammer settings.replace.
  // (Cordis timer-service intervals are fiber effects, auto-cleaned on stop.)
  const timer = ctx.get('timer') as { interval?: (fn: () => void, ms: number) => () => void } | undefined
  if (timer && typeof timer.interval === 'function') {
    timer.interval(() => { void flush() }, 5000)
  }

  const api: HealthTracker = {
    table: () => table,
    isHealthy: (p, m) => {
      const h = table[key(p, m)]
      if (!h || h.status !== 'down') return true
      // Cooldown: retry down targets occasionally instead of blacklisting forever.
      if (typeof h.lastProbeAt === 'number' && Date.now() - h.lastProbeAt > DOWN_COOLDOWN_MS) return true
      return false
    },
    markProbing: (p, m) => {
      const cur: TargetHealth = table[key(p, m)] || { provider: p, model: m, status: 'unknown', consecutiveFails: 0 }
      table[key(p, m)] = { ...cur, status: 'probing' }
      dirty = true
    },
    markUp: (p, m, latencyMs) => {
      const cur: TargetHealth = table[key(p, m)] || { provider: p, model: m, status: 'unknown', consecutiveFails: 0 }
      // Rebuild clean: never carry `lastError` (or any undefined) forward — a
      // healthy target has no error, and the host->client RPC boundary rejects
      // undefined values. Drop the key entirely rather than set it undefined.
      const next: TargetHealth = {
        provider: cur.provider,
        model: cur.model,
        status: 'up',
        lastProbeAt: Date.now(),
        consecutiveFails: 0,
      }
      if (typeof latencyMs === 'number') next.latencyMs = latencyMs
      table[key(p, m)] = next
      dirty = true
    },
    markDown: (p, m, error) => {
      const cur: TargetHealth = table[key(p, m)] || { provider: p, model: m, status: 'unknown', consecutiveFails: 0 }
      const fails = cur.consecutiveFails + 1
      let status: TargetHealth['status'] = 'down'
      // A single cold probe failing shouldn't hard-park a never-seen target.
      if (cur.status === 'unknown' && fails < 2) status = 'up'
      const next: TargetHealth = {
        provider: cur.provider,
        model: cur.model,
        status,
        lastProbeAt: Date.now(),
        consecutiveFails: fails,
      }
      // Only set lastError when there is a real string — never undefined.
      if (typeof error === 'string' && error) next.lastError = error
      else if (typeof cur.lastError === 'string' && cur.lastError) next.lastError = cur.lastError
      // Preserve last known latency if present.
      if (typeof cur.latencyMs === 'number') next.latencyMs = cur.latencyMs
      table[key(p, m)] = next
      dirty = true
    },
    entry: (p, m) => table[key(p, m)],
  }

  const ctxAny = ctx as any
  if (typeof ctxAny.effect === 'function') {
    ctxAny.effect(() => () => { void flush() }, 'dsh-model-pro: health flush')
  }
  ;(api as any).flush = flush
  return api
}

/** Fiber-scoped singleton so the router and the observability handlers share
 * ONE health table. Created lazily with a bare ctx (settings + timer). */
let _tracker: HealthTracker | undefined
export function getHealthTracker(ctx?: HostCtx): HealthTracker {
  if (!_tracker) {
    // Lazily bind on first use; a fresh ctx primes the initial snapshot.
    _tracker = createHealthTracker((ctx || (globalThis as any).__dshModelProCtx) as HostCtx)
  }
  return _tracker
}

/** Prime the fiber singleton (called once at apply with the real ctx). */
export function initHealthTracker(ctx: HostCtx): HealthTracker {
  if (_tracker) return _tracker
  _tracker = createHealthTracker(ctx)
  ;(globalThis as any).__dshModelProCtx = ctx
  return _tracker
}

/** Rebind the singleton (smoke harness resets between scenarios). */
export function resetHealthSingleton(): void {
  _tracker = undefined
}
