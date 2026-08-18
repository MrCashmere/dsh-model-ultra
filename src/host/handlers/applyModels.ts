/** apply-models handler — replace/merge/remove models on a provider. */

import { NS } from '../../shared/constants'
import type { HostCtx } from '../utils'
import { readProviders, readDisabled, readProfile, checkWritable, writeSection } from '../utils'
import type { ModelEntry } from '../../shared/types'

type ApplyMode = 'replace' | 'merge' | 'remove'

const toEntry = (m: any): ModelEntry =>
  m && typeof m === 'object' ? { ...m } : { id: String(m) }

export async function applyModels(
  ctx: HostCtx,
  args: { route?: string; models?: any[]; mode?: string },
) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const models = args?.models
  if (!Array.isArray(models)) return { ok: false as const, error: 'models 必须是数组' }

  const mode = (args.mode || 'merge') as ApplyMode
  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const p = readProfile(providers, route) || readProfile(disabled, route)
  if (!p) return { ok: false as const, error: `提供商 "${route}" 不存在` }

  const existing = Array.isArray(p.models) ? p.models.map(toEntry) : []

  let next: ModelEntry[]
  if (mode === 'replace') {
    next = models.map(toEntry)
  } else if (mode === 'merge') {
    next = [...existing]
    for (const m of models) {
      const e = toEntry(m)
      const idx = next.findIndex((x) => x.id === e.id)
      if (idx >= 0) next[idx] = { ...next[idx], ...e }
      else next.push(e)
    }
  } else if (mode === 'remove') {
    const toRemove = new Set(models.map((m) => (m && typeof m === 'object' ? m.id : String(m))))
    next = existing.filter((m) => !toRemove.has(m.id))
  } else {
    return { ok: false as const, error: `未知 mode: ${mode}` }
  }

  // Prevent removing all models from custom providers
  if (next.length === 0) {
    const llm = ctx.get('llm')
    let inCatalog = false
    if (llm !== undefined) {
      try {
        inCatalog = llm
          .listConfigurableProviders()
          .some((e) => e.settingsNs === NS && e.provider === route && e.declared !== true)
      } catch { /* ignore */ }
    }
    if (!inCatalog)
      return { ok: false as const, error: '不能删除全部模型: 自定义提供商必须至少保留一个模型条目' }
  }

  const applyMutation = (src: Record<string, unknown>): Record<string, unknown> => {
    const cur: Record<string, unknown> = {}
    for (const fk of Object.keys(src)) cur[fk] = src[fk]
    if (next.length === 0) delete cur.models
    else cur.models = next
    return cur
  }

  try {
    // Re-read fresh state in case it changed
    const srcP2 = readProviders(st)
    const srcD2 = readDisabled(st)
    const nextProviders: Record<string, unknown> = {}
    for (const k of Object.keys(srcP2)) {
      nextProviders[k] = k === route ? applyMutation(srcP2[k] as any) : (srcP2 as any)[k]
    }
    const nextDisabled: Record<string, unknown> = {}
    for (const k of Object.keys(srcD2)) {
      nextDisabled[k] = k === route ? applyMutation(srcD2[k] as any) : (srcD2 as any)[k]
    }
    await writeSection(st, nextProviders as any, nextDisabled as any)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }

  return { ok: true as const, route, count: next.length }
}
