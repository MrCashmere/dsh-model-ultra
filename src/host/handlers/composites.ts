/** Composite-provider (组合提供商) CRUD handlers.
 * A composite is a virtual route merging several members' model lists
 * (union or intersection), resolved live from the members' advertised models.
 * Stored under llm-pi-ai[COMPOSITES_KEY], consumed by the router adapter
 * on the synthetic `composite` route. */

import type { HostCtx } from '../utils'
import { checkWritable, readProviders, readDisabled } from '../utils'
import { readComposites, writeComposites, resolveCompositeModels } from '../composite'
import type { CompositesMap, CompositeSpec } from '../../shared/types'
import { ROUTE_STRATEGIES, DEFAULT_ROUTE_STRATEGY } from '../../shared/constants'

const COMPOSITE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/

export async function listComposites(ctx: HostCtx) {
  const map = readComposites(ctx)
  const out: CompositesMap = {}
  for (const [name, spec] of Object.entries(map)) out[name] = { ...spec }
  return { ok: true as const, composites: out }
}

export async function setComposite(ctx: HostCtx, args: {
  name?: string
  members?: string[]
  mode?: string
  strategy?: string
}) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const name = typeof args?.name === 'string' ? args.name.trim() : ''
  if (!COMPOSITE_NAME_RE.test(name))
    return { ok: false as const, error: '组合名仅允许字母、数字、下划线、点、横线（≤64 字符）' }

  let members: string[] = []
  if (Array.isArray(args?.members)) {
    members = Array.from(new Set(
      args!.members
        .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
        .map((m) => m.trim()),
    ))
  }
  if (members.length < 2)
    return { ok: false as const, error: '组合提供商至少需要 2 个成员（不足 2 个请直接用路由）' }

  // Validate members exist and are enabled.
  const providers = readProviders(st)
  const disabled = readDisabled(st)
  for (const m of members) {
    if (!Object.prototype.hasOwnProperty.call(providers, m))
      return { ok: false as const, error: `成员提供商「${m}」不存在` }
    if (Object.prototype.hasOwnProperty.call(disabled, m))
      return { ok: false as const, error: `成员提供商「${m}」已禁用，请先启用` }
  }

  const mode = args?.mode === 'intersection' ? 'intersection' : 'union'
  const strategy = (typeof args?.strategy === 'string' && args.strategy.trim() && (ROUTE_STRATEGIES as readonly string[]).includes(args.strategy.trim()))
    ? args.strategy.trim() as CompositeSpec['strategy']
    : DEFAULT_ROUTE_STRATEGY

  try {
    const map: CompositesMap = {
      ...readComposites(ctx),
      [name]: { route: name, members, mode, strategy },
    }
    await writeComposites(ctx, map)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }
  return { ok: true as const, name, composite: { route: name, members, mode, strategy } }
}

export async function deleteComposite(ctx: HostCtx, args: { name?: string }) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }
  const name = typeof args?.name === 'string' ? args.name.trim() : ''
  if (!name) return { ok: false as const, error: '缺少组合名' }

  try {
    const map = readComposites(ctx)
    delete map[name]
    await writeComposites(ctx, map)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }
  return { ok: true as const, name }
}

/** Preview what a composite resolves to (members -> merged model ids). */
export async function previewComposite(ctx: HostCtx, args: { name?: string }) {
  const name = typeof args?.name === 'string' ? args.name.trim() : ''
  if (!name) return { ok: false as const, error: '缺少组合名' }
  const resolved = await resolveCompositeModels(ctx, name)
  return {
    ok: resolved.ok,
    ids: resolved.ids,
    mode: resolved.mode,
    ...(resolved.error ? { error: resolved.error } : {}),
  }
}