/**
 * OpenRouter feature handlers — the settings page's RPC surface.
 *
 *   get-openrouter       read state + whether request shaping is live + a
 *                        deterministic self-test of the body shaping
 *   set-openrouter       partial patch (a true patch: only present fields change)
 *   import-openrouter    import the reference plugin's config, then apply it
 *   openrouter-selftest  re-run the shaping probe against the live state
 */

import type { HostCtx } from '../utils'
import { checkWritable } from '../utils'
import {
  importLegacyOpenRouter,
  openRouterShaperStatus,
  readOpenRouterState,
  writeOpenRouterState,
} from '../openrouter'
import {
  DEFAULT_OPENROUTER_STATE,
  QUANT_LEVELS,
  openRouterActive,
  openRouterProviderParams,
  shapeOpenRouterBody,
  type OpenRouterState,
} from '../../shared/openrouter'

/** A canonical chat-completions body used to prove the shaping path. */
const PROBE_BODY = '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"ping"}],"stream":true}'

/** Deterministic view of what the shaper would do to a probe body. */
function selfTest(state: OpenRouterState) {
  const params = openRouterProviderParams(state)
  const after = shapeOpenRouterBody(state, PROBE_BODY)
  return {
    probe: PROBE_BODY,
    changed: after !== PROBE_BODY,
    params: params ?? null,
    after,
  }
}

export async function getOpenRouter(ctx: HostCtx) {
  const st = ctx.get('settings')
  const state = readOpenRouterState(st)
  return {
    ok: true as const,
    state,
    active: openRouterActive(state),
    writable: checkWritable(st),
    defaults: DEFAULT_OPENROUTER_STATE,
    quantLevels: [...QUANT_LEVELS],
    shaper: openRouterShaperStatus(),
    selfTest: selfTest(state),
  }
}

export async function setOpenRouter(ctx: HostCtx, args: { patch?: unknown }) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }
  try {
    const state = await writeOpenRouterState(st, args?.patch ?? {})
    return {
      ok: true as const,
      state,
      active: openRouterActive(state),
      shaper: openRouterShaperStatus(),
      selfTest: selfTest(state),
    }
  } catch (error) {
    return { ok: false as const, error: String((error as Error)?.message ?? error) }
  }
}

export async function importOpenRouter(ctx: HostCtx) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }
  const result = await importLegacyOpenRouter(ctx)
  if (!result.ok || result.imported === undefined) {
    return { ok: false as const, error: result.error ?? '未找到可导入的旧配置', sources: result.sources }
  }
  try {
    const state = await writeOpenRouterState(st, result.imported)
    return {
      ok: true as const,
      state,
      imported: result.imported,
      sources: result.sources,
      active: openRouterActive(state),
      shaper: openRouterShaperStatus(),
      selfTest: selfTest(state),
    }
  } catch (error) {
    return { ok: false as const, error: String((error as Error)?.message ?? error), sources: result.sources }
  }
}

export async function openRouterSelfTest(ctx: HostCtx) {
  const state = readOpenRouterState(ctx.get('settings'))
  return { ok: true as const, state, active: openRouterActive(state), shaper: openRouterShaperStatus(), selfTest: selfTest(state) }
}
