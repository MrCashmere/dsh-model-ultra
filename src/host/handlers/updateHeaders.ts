/** update-headers handler — sets custom HTTP headers on a provider. */

import type { HostCtx } from '../utils'
import { readProviders, readDisabled, readProfile, checkWritable, writeSection } from '../utils'
import type { HeaderPair } from '../../shared/types'

export async function updateHeaders(
  ctx: HostCtx,
  args: { route?: string; headers?: HeaderPair[] },
) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const headers = args?.headers
  if (!Array.isArray(headers)) return { ok: false as const, error: 'headers 必须是数组' }

  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const srcP = readProfile(providers, route) || readProfile(disabled, route)
  if (!srcP) return { ok: false as const, error: `提供商 "${route}" 不存在` }

  // Build the headers dict, skipping auth headers
  const dict: Record<string, string> = {}
  for (const h of headers) {
    if (!h || typeof h !== 'object') continue
    const name = typeof h.name === 'string' ? h.name.trim() : ''
    const value = typeof h.value === 'string' ? h.value : ''
    if (!name) continue
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'api-key') continue
    dict[name] = value
  }

  const applyMutation = (src: Record<string, unknown>): Record<string, unknown> => {
    const cur: Record<string, unknown> = {}
    for (const fk of Object.keys(src)) cur[fk] = src[fk]
    if (Object.keys(dict).length === 0) delete cur.headers
    else cur.headers = dict
    return cur
  }

  try {
    const nextProviders: Record<string, unknown> = {}
    for (const k of Object.keys(providers)) {
      nextProviders[k] = k === route ? applyMutation(providers[k] as any) : (providers as any)[k]
    }
    const nextDisabled: Record<string, unknown> = {}
    for (const k of Object.keys(disabled)) {
      nextDisabled[k] = k === route ? applyMutation(disabled[k] as any) : (disabled as any)[k]
    }
    await writeSection(st, nextProviders as any, nextDisabled as any)
    return { ok: true as const, route, headerCount: Object.keys(dict).length }
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }
}
