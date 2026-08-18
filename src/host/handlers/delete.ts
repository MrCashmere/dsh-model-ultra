/** delete-provider handler — removes a provider from both dicts. */

import type { HostCtx } from '../utils'
import { readProviders, readDisabled, checkWritable, writeSection } from '../utils'

export async function deleteProvider(ctx: HostCtx, args: { route?: string }) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const providers = readProviders(st)
  const disabled = readDisabled(st)

  if (
    !Object.prototype.hasOwnProperty.call(providers, route) &&
    !Object.prototype.hasOwnProperty.call(disabled, route)
  ) {
    return { ok: false as const, error: `提供商 "${route}" 不存在` }
  }

  try {
    const nextProviders: Record<string, unknown> = {}
    for (const k of Object.keys(providers)) {
      if (k !== route) nextProviders[k] = (providers as any)[k]
    }
    const nextDisabled: Record<string, unknown> = {}
    for (const k of Object.keys(disabled)) {
      if (k !== route) nextDisabled[k] = (disabled as any)[k]
    }
    await writeSection(st, nextProviders as any, nextDisabled as any)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }

  return { ok: true as const, route }
}
