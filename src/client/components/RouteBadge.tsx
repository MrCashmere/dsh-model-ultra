/** RouteBadge — 对话下方「本回合实际由哪个提供商服务」的角标。
 *
 * Registers a `conversation.chat.turnTail` CHAIN slot entry (the same seam the
 * deliverables plugin uses): the chat view renders the chain under each
 * completed turn, before its action row. The host half already records one
 * request-log entry per routed call (`ts`, `sessionId`, route, target,
 * tryIndex, status); this component correlates those entries with the turn's
 * time window via `list-request-logs` and renders one chip per target that
 * served the turn — including 无感切换 evidence (`切换 ×N`) when routing had
 * to fall back.
 *
 * Everything degrades silently: unknown slot, RPC failure, empty matches, or
 * a disabled preference all render nothing.
 */

import React from '../react'
import type { CallFn } from '../../shared/types'
import { COMPOSITE_SEP, CLIENT_NS } from '../../shared/constants'

/** One aggregated serving target for a turn. */
interface ServingTarget {
  provider: string
  model: string
  /** True when any log entry shows this target was NOT the first attempt. */
  fellBack: boolean
}

interface SelectionLogEntry {
  ts: number
  sessionId?: string
  route: string
  target: { provider: string; model: string }
  status: string
  tryIndex?: number
}

// --- tiny caches so a page of historical turns costs at most one RPC --------

const PREF_TTL_MS = 30_000
let prefCache: { value: boolean; at: number } | null = null

const LOG_TTL_MS = 2_000
let logCache: { bySession: Map<string, SelectionLogEntry[]>; at: number } | null = null

async function fetchBadgeData(call: CallFn, sessionId: string): Promise<{ show: boolean; entries: SelectionLogEntry[] }> {
  const now = Date.now()
  let show = true
  if (prefCache === null || now - prefCache.at > PREF_TTL_MS) {
    try {
      const r = await call('get-ui-prefs')
      show = r?.prefs?.showRouteBadge !== false
      prefCache = { value: show, at: now }
    } catch { /* keep default show */ }
  } else {
    show = prefCache.value
  }
  if (!show) return { show: false, entries: [] }

  if (logCache === null || now - logCache.at > LOG_TTL_MS) {
    const bySession = new Map<string, SelectionLogEntry[]>()
    try {
      const r = await call('list-request-logs', { limit: 200 })
      for (const e of (r?.entries || []) as SelectionLogEntry[]) {
        if (!e || typeof e.ts !== 'number' || !e.target || typeof e.sessionId !== 'string') continue
        const list = bySession.get(e.sessionId) || []
        list.push(e)
        bySession.set(e.sessionId, list)
      }
    } catch { /* empty */ }
    logCache = { bySession, at: now }
  }
  return { show: true, entries: logCache.bySession.get(sessionId) || [] }
}

/** Test hook — drop all caches. */
export function resetRouteBadgeCaches(): void {
  prefCache = null
  logCache = null
}

// --- slot wiring ------------------------------------------------------------

export interface TurnTailOwnerLike {
  turn?: { turn?: number; start?: { time?: number }; end?: { time?: number } }
  seq?: number
}

/** Window (epoch ms) of the LLM calls that can belong to this turn, or null
 * when the turn carries no usable boundary. Pure + throw-free: runs during
 * render for EVERY completed turn of every conversation. */
export function selectTurnSelection(owner: TurnTailOwnerLike): { from: number; to: number } | null {
  try {
    const t = owner && owner.turn
    if (!t || typeof t !== 'object') return null
    const start = t.start && typeof t.start.time === 'number' ? t.start.time : undefined
    const end = t.end && typeof t.end.time === 'number' ? t.end.time : undefined
    // Tails publish on turn/end, so `end` should exist; fall back sensibly.
    const SLACK = 5_000
    const from = (start !== undefined ? start : end !== undefined ? end - 10 * 60_000 : 0) - SLACK
    const to = (end !== undefined ? end : Date.now()) + SLACK
    if (!(to > from)) return null
    return { from, to }
  } catch {
    return null
  }
}

function targetsInWindow(entries: SelectionLogEntry[], win: { from: number; to: number }): { targets: ServingTarget[]; routes: Set<string>; fallbacks: number } {
  const order: string[] = []
  const byKey = new Map<string, ServingTarget>()
  const routes = new Set<string>()
  let fallbacks = 0
  for (const e of entries) {
    if (e.ts < win.from || e.ts > win.to) continue
    if (e.status === 'error') continue // failed attempts are noise here
    routes.add(e.route || '')
    const key = `${e.target.provider}\u0000${e.target.model}`
    let t = byKey.get(key)
    if (!t) {
      t = { provider: e.target.provider, model: e.target.model, fellBack: false }
      byKey.set(key, t)
      order.push(key)
    }
    if (e.status === 'fallback' || (typeof e.tryIndex === 'number' && e.tryIndex > 1)) {
      t.fellBack = true
      fallbacks += 1
    }
  }
  return { targets: order.map((k) => byKey.get(k) as ServingTarget), routes, fallbacks }
}

function routeLabel(route: string): string {
  // composite ids encode `name::model` — keep the readable head.
  const i = route.indexOf(COMPOSITE_SEP)
  return i > 0 ? `${route.slice(0, i)}::…` : route
}

/** The badge view. Renders nothing unless the pref is on AND this turn was
 * served through the smart router / a composite. */
export function RouteBadgeView(props: any & { matched: { from: number; to: number } | null; call: CallFn }) {
  const { matched, call } = props
  const sessionId = props.sessionId as string | undefined
  const fallbackT = (k: string) => k
  const t = (props.t || fallbackT) as (k: string) => string
  const [state, setState] = React.useState<{ show: boolean; targets: ServingTarget[]; routes: Set<string> } | null>(null)

  React.useEffect(() => {
    if (!matched || !sessionId) return
    let alive = true
    void (async () => {
      try {
        const { show, entries } = await fetchBadgeData(call, sessionId)
        const agg = targetsInWindow(entries, matched)
        if (alive) setState({ show, targets: agg.targets, routes: agg.routes })
      } catch {
        if (alive) setState({ show: false, targets: [], routes: new Set() })
      }
    })()
    return () => { alive = false }
  }, [matched && matched.from, matched && matched.to, sessionId])

  if (!matched || !state || !state.show || state.targets.length === 0) return null

  const anyFallback = state.targets.some((x) => x.fellBack)
  return (
    <div className="mpro-badgeRow" data-mpro-route-badge="">
      <span className="mpro-badgeIcon">⇄</span>
      <span className="mpro-badgeLabel">{t('badgeRoutePrefix')}</span>
      {state.routes.size > 0 ? (
        Array.from(state.routes).map((r) => (
          <span key={r} className="mpro-badgeChip mpro-badgeChipRoute">{routeLabel(r)}</span>
        ))
      ) : null}
      {state.targets.map((x) => (
        <span key={`${x.provider}\u0000${x.model}`} className="mpro-badgeChip mpro-badgeChipMono">
          {x.provider}/{x.model}
          {anyFallback && x.fellBack ? <span className="mpro-badgeFb" title={t('badgeFallbackTitle')}> ⟲</span> : null}
        </span>
      ))}
      {anyFallback ? <span className="mpro-badgeFbText">{t('badgeFallback')}</span> : null}
    </div>
  )
}

/** Register the turnTail chain entry on the client slot registry. Fully
 * defensive: a DSH build without this slot simply skips the feature.
 * `locale: CLIENT_NS` lets the framework inject a bound `t`; the caller ALSO
 * passes its own bound `t` via `explicitT`, which wins — either way the badge
 * never renders raw dictionary keys. */
export function registerRouteBadge(slots: any, call: CallFn, explicitT?: (k: string) => string): void {
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
  slots.inject('conversation.chat.turnTail', () => {
    try {
      return slots.register(
        {
          name: 'conversation.chat.turnTail',
          id: 'dsh-model-pro-route-badge',
          select: (owner: TurnTailOwnerLike) => selectTurnSelection(owner),
          locale: CLIENT_NS,
        },
        (componentProps: any) =>
          React.createElement(RouteBadgeView, { ...componentProps, ...(explicitT ? { t: explicitT } : {}), call }),
      )
    } catch {
      return () => undefined
    }
  })
}
