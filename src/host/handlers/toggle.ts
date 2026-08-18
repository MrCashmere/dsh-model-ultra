/** toggle-provider handler — moves a provider between providers and disabledProviders dicts. */

import { readProviders, readDisabled, checkWritable, writeSection } from '../utils'
import type { HostCtx } from '../utils'

export async function toggleProvider(ctx: HostCtx, args: { route?: string; enabled?: boolean }) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const enabled = args?.enabled !== false
  const providers = readProviders(st)
  const disabled = readDisabled(st)

  if (
    !Object.prototype.hasOwnProperty.call(providers, route) &&
    !Object.prototype.hasOwnProperty.call(disabled, route)
  ) {
    return { ok: false as const, error: `提供商 "${route}" 不存在` }
  }

  const nextProviders: Record<string, unknown> = {}
  const nextDisabled: Record<string, unknown> = {}

  for (const k of Object.keys(providers)) nextProviders[k] = (providers as any)[k]
  for (const k of Object.keys(disabled)) nextDisabled[k] = (disabled as any)[k]

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

  try {
    await writeSection(st, nextProviders as any, nextDisabled as any)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }

  return { ok: true as const, route, enabled }
}
