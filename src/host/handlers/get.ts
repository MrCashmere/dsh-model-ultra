/** get-provider handler — returns full provider details for the editor view. */

import { readProviders, readDisabled, readProfile } from '../utils'
import type { HostCtx } from '../utils'
import type { HeaderPair } from '../../shared/types'

export async function getProvider(ctx: HostCtx, args: { route?: string }) {
  const st = ctx.get('settings')
  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const p = readProfile(providers, route) || readProfile(disabled, route)
  if (!p) return { ok: false as const, error: `提供商 "${route}" 不存在` }

  const isDisabled = Object.prototype.hasOwnProperty.call(disabled, route)
  const headers: HeaderPair[] =
    p.headers && typeof p.headers === 'object'
      ? Object.entries(p.headers).map(([k, v]) => ({ name: k, value: String(v) }))
      : []
  const hasExplicit = Array.isArray(p.models) && p.models.length > 0
  const models = hasExplicit
    ? p.models!.map((m) => (m && typeof m === 'object' ? { ...m } : { id: String(m) }))
    : []

  return {
    ok: true as const,
    route,
    displayName: p.displayName || '',
    api: p.api || '',
    baseURL: p.baseURL || '',
    apiKeyEnv: p.apiKeyEnv || '',
    disabled: isDisabled,
    headers,
    models,
    usesCatalog: !hasExplicit,
  }
}
