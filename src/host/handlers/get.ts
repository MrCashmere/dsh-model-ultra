/** get-provider handler — returns full provider details for the editor view. */

import { readProviders, readDisabled, readProfile } from '../utils'
import type { HostCtx } from '../utils'
import type { HeaderPair } from '../../shared/types'
import { decryptSecret } from '../crypto'

export async function getProvider(ctx: HostCtx, args: { route?: string; includeSecret?: boolean }) {
  const st = ctx.get('settings')
  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const p = readProfile(providers, route) || readProfile(disabled, route)
  if (!p) return { ok: false as const, error: `提供商 "${route}" 不存在` }

  const isDisabled =
    (p as any).disabled === true || Object.prototype.hasOwnProperty.call(disabled, route)
  const headers: HeaderPair[] =
    p.headers && typeof p.headers === 'object'
      ? Object.entries(p.headers).map(([k, v]) => ({ name: k, value: String(v) }))
      : []
  const hasExplicit = Array.isArray(p.models) && p.models.length > 0
  const models = hasExplicit
    ? p.models!.map((m) => (m && typeof m === 'object' ? { ...m } : { id: String(m) }))
    : []

  // Advertised model ids for the test dropdown (advisory; may be empty). For a
  // catalog-route (or enabled custom) provider this is the real list the
  // adapter knows, which the explicit `models` array may not carry.
  let availableModels: string[] = []
  if (!isDisabled) {
    const llm = ctx.get('llm')
    if (llm !== undefined) {
      try {
        const m = await (llm as any).listModels(route)
        if (Array.isArray(m)) availableModels = m.map((x: any) => (x && typeof x.id === 'string' ? x.id : '')).filter(Boolean)
      } catch { /* advisory only */ }
    }
  }

  // Encrypted-at-rest marker + optional on-demand reveal. Reveal decrypts the
  // snapshot first, then falls back to the credentials-service copy (in case
  // the snapshot is missing or its key changed mid-flight).
  const hasSecret = !!(p as any).apiKeyEnc
  let secret: string | undefined
  if (args.includeSecret) {
    try {
      const d = await decryptSecret(ctx, (p as any).apiKeyEnc)
      if (d !== null) secret = d
    } catch { /* fall through */ }
    if (secret === undefined && p.apiKeyEnv && typeof p.apiKeyEnv === 'string') {
      const creds = ctx.get('credentials')
      if (creds !== undefined) {
        try {
          const r = await (creds as any).resolve(p.apiKeyEnv)
          if (r && typeof r.value === 'string' && r.value) secret = r.value
        } catch { /* ignore */ }
      }
    }
  }

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
    availableModels,
    hasSecret,
    // Thinking-effort state: the route's own defaults plus the per-model
    // overrides a catalog route uses (see handlers/thinking.ts). `models`
    // entries already carry their own `reasoningEfforts`/`compat` verbatim.
    reasoning: (p as Record<string, unknown>).reasoning,
    thinkingBudgets: (p as Record<string, unknown>).thinkingBudgets,
    compat: (p as Record<string, unknown>).compat,
    modelOverrides:
      (p as Record<string, unknown>).modelOverrides !== null
      && typeof (p as Record<string, unknown>).modelOverrides === 'object'
        ? { ...((p as Record<string, unknown>).modelOverrides as Record<string, unknown>) }
        : {},
    ...(secret !== undefined ? { secret } : {}),
  }
}
