/** list-providers handler — returns all providers (active + disabled) with metadata. */

import { NS, PROTOS } from '../../shared/constants'
import type { ProviderListItem } from '../../shared/types'
import type { HostCtx } from '../utils'
import { readProviders, readDisabled, readProfile, checkWritable } from '../utils'

export async function listProviders(ctx: HostCtx) {
  const st = ctx.get('settings')
  const llm = ctx.get('llm')
  const providers = readProviders(st)
  const disabled = readDisabled(st)

  let dir: Array<{ settingsNs: string; provider: string; displayName?: string; declared?: boolean }> = []
  if (llm !== undefined) {
    try { dir = llm.listConfigurableProviders() } catch { /* ignore */ }
  }
  const dirMap = new Map(dir.filter((e) => e.settingsNs === NS).map((e) => [e.provider, e]))

  const items: ProviderListItem[] = []
  const allRoutes = new Set([...Object.keys(providers), ...Object.keys(disabled)])

  for (const route of allRoutes) {
    const p = readProfile(providers, route) || readProfile(disabled, route)
    if (!p) continue
    const entry = dirMap.get(route)
    const hasExplicit = Array.isArray(p.models) && p.models.length > 0
    const isDisabled =
      (p as any).disabled === true || Object.prototype.hasOwnProperty.call(disabled, route)

    items.push({
      route,
      displayName: (typeof p.displayName === 'string' && p.displayName) || (entry ? entry.displayName : undefined) || route,
      declared: entry ? entry.declared === true : true,
      api: p.api || '',
      baseURL: p.baseURL || '',
      apiKeyEnv: p.apiKeyEnv || '',
      disabled: isDisabled,
      hasHeaders: !!(p.headers && typeof p.headers === 'object' && Object.keys(p.headers).length > 0),
      headerCount: p.headers && typeof p.headers === 'object' ? Object.keys(p.headers).length : 0,
      modelCount: hasExplicit ? p.models!.length : 0,
      usesCatalog: !hasExplicit,
      hasSecret: !!(p as any).apiKeyEnc,
    })
  }

  items.sort((a, b) => a.route.localeCompare(b.route))

  return {
    ok: true as const,
    providers: items,
    writable: checkWritable(st),
    protocols: [...PROTOS],
  }
}
