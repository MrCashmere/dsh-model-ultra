/** update-field handler — updates a single field on a provider (displayName/api/baseURL/apiKeyEnv). */

import { EDITABLE_FIELDS, type EditableField } from '../../shared/constants'
import type { HostCtx } from '../utils'
import { readProviders, readDisabled, readProfile, checkWritable, writeSection } from '../utils'

export async function updateField(
  ctx: HostCtx,
  args: { route?: string; field?: string; value: unknown },
) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const route = args?.route
  const field = args?.field as EditableField
  if (!route) return { ok: false as const, error: '缺少 route' }
  if (EDITABLE_FIELDS.indexOf(field as any) < 0)
    return { ok: false as const, error: `不支持的字段: ${field}` }

  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const srcP = readProfile(providers, route) || readProfile(disabled, route)
  if (!srcP) return { ok: false as const, error: `提供商 "${route}" 不存在` }

  const value = args.value

  const applyMutation = (src: Record<string, unknown>): Record<string, unknown> => {
    const cur: Record<string, unknown> = {}
    for (const fk of Object.keys(src)) cur[fk] = src[fk]
    if (value === null || (typeof value === 'string' && value.trim() === ''))
      delete cur[field]
    else cur[field] = typeof value === 'string' ? value.trim() : value
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
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }

  return { ok: true as const, route, field }
}
