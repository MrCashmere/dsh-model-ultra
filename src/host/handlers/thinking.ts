/**
 * set-thinking handler — edit thinking effort on a route and on single models.
 *
 * Three shapes of target, because llm-pi-ai stores them in three places:
 *
 *   - a ROUTE default level / budgets / compat switches → the profile itself
 *     (`reasoning`, `thinkingBudgets`, `compat`);
 *   - a model on a route that declares its own `models` list → that entry;
 *   - a model on a CATALOG route (no explicit `models`) → `modelOverrides[id]`.
 *     Writing a `models` entry there instead would REPLACE the route's whole
 *     installed catalog, so `modelOverrides` is the only non-destructive home —
 *     and llm-pi-ai refuses an override beside a `models` list, which is why the
 *     branch is exclusive rather than a merge.
 *
 * Deletion is explicit: `null` removes a field (and an emptied `compat` /
 * `modelOverrides[id]` container). Absent fields are left untouched, so a patch
 * never disturbs settings this editor does not show.
 */

import type { HostCtx, SettingsService } from '../utils'
import { checkWritable, readDisabled, readProfile, readProviders, writeSection } from '../utils'
import {
  THINKING_LEVELS,
  isThinkingLevel,
  normalizeReasoningEfforts,
  normalizeThinkingBudgets,
  normalizeThinkingCompat,
} from '../../shared/thinking'
import type { ProviderProfile } from '../../shared/types'

interface ThinkingPatch {
  reasoning?: unknown
  thinkingBudgets?: unknown
  reasoningEfforts?: unknown
  compat?: unknown
}

const LEVEL_LIST = THINKING_LEVELS.join('/')

const has = (obj: unknown, key: string): boolean =>
  obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : undefined

/** The compat keys this handler deletes when the patch spells them as null. */
const COMPAT_KEYS = [
  'thinkingFormat',
  'supportsReasoningEffort',
  'supportsThinkingTokenBudget',
  'thinkingTokenBudgetField',
  'requiresThinkingAsText',
  'requiresReasoningContentOnAssistantMessages',
  'forceAdaptiveThinking',
] as const

/**
 * Apply a `compat` patch to a target object: normalize the recognized keys,
 * delete the ones the caller nulled, and drop the container when it empties.
 */
function applyCompat(target: Record<string, unknown>, patchCompat: unknown): void {
  if (patchCompat === undefined) return
  if (patchCompat === null) { delete target.compat; return }
  if (typeof patchCompat !== 'object' || Array.isArray(patchCompat)) throw new TypeError('compat 必须是对象或 null')
  const normalized = normalizeThinkingCompat(patchCompat)
  const current = asRecord(target.compat) ?? {}
  for (const key of Object.keys(patchCompat as Record<string, unknown>)) {
    if (!(COMPAT_KEYS as readonly string[]).includes(key)) continue
    if ((patchCompat as Record<string, unknown>)[key] === null) delete current[key]
  }
  for (const [key, value] of Object.entries(normalized)) current[key] = value
  if (Object.keys(current).length === 0) delete target.compat
  else target.compat = current
}

/** Apply a model-level patch (`reasoningEfforts` + thinking `compat`). */
function applyModelPatch(entry: Record<string, unknown>, patch: ThinkingPatch): void {
  if (patch.reasoningEfforts !== undefined) {
    const efforts = normalizeReasoningEfforts(patch.reasoningEfforts)
    if (efforts === undefined) delete entry.reasoningEfforts
    else entry.reasoningEfforts = efforts
  }
  applyCompat(entry, patch.compat)
}

export async function setThinking(
  ctx: HostCtx,
  args: { route?: string; modelId?: string; patch?: ThinkingPatch },
) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }
  const patch = args?.patch
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false as const, error: '缺少 patch' }
  }

  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const stored = readProfile(providers, route) || readProfile(disabled, route)
  if (!stored) return { ok: false as const, error: `提供商 "${route}" 不存在` }
  // A working copy: never mutate the resolved settings object in place.
  const profile = { ...(stored as Record<string, unknown>) }

  const modelId = typeof args.modelId === 'string' && args.modelId !== '' ? args.modelId : undefined

  try {
    if (modelId === undefined) {
      if (patch.reasoningEfforts !== undefined) {
        return { ok: false as const, error: 'reasoningEfforts 是每模型设置：请带上 modelId' }
      }
      if (has(patch, 'reasoning')) {
        const raw = patch.reasoning
        if (raw === null || raw === '') delete profile.reasoning
        else if (isThinkingLevel(raw)) profile.reasoning = raw
        else return { ok: false as const, error: `reasoning 只能是 ${LEVEL_LIST} 之一` }
      }
      if (has(patch, 'thinkingBudgets')) {
        if (patch.thinkingBudgets === null) delete profile.thinkingBudgets
        else profile.thinkingBudgets = normalizeThinkingBudgets(patch.thinkingBudgets)
      }
      applyCompat(profile, patch.compat)
      await upsert(st, providers, disabled, route, profile)
      return {
        ok: true as const,
        route,
        storage: 'route' as const,
        reasoning: profile.reasoning,
        thinkingBudgets: profile.thinkingBudgets,
        compat: profile.compat,
      }
    }

    if (has(patch, 'reasoning') || has(patch, 'thinkingBudgets')) {
      return { ok: false as const, error: 'reasoning / thinkingBudgets 是路由级设置：请去掉 modelId' }
    }

    const explicit = Array.isArray(profile.models) ? (profile.models as Array<Record<string, unknown>>) : undefined
    if (explicit !== undefined && explicit.length > 0) {
      const index = explicit.findIndex((m) => m && typeof m === 'object' && m.id === modelId)
      if (index < 0) {
        return { ok: false as const, error: `提供商 "${route}" 的 models 列表中没有模型 "${modelId}"` }
      }
      const entry = { ...explicit[index] }
      applyModelPatch(entry, patch)
      const nextModels = [...explicit]
      nextModels[index] = entry
      profile.models = nextModels
      await upsert(st, providers, disabled, route, profile)
      return {
        ok: true as const,
        route,
        modelId,
        storage: 'models' as const,
        reasoningEfforts: entry.reasoningEfforts,
        compat: entry.compat,
      }
    }

    // Catalog route: reshape this one model through `modelOverrides`, never by
    // materializing a `models` list (that would drop the installed catalog).
    const llm = ctx.get('llm') as { listModels?: (route: string) => Promise<unknown> } | undefined
    if (llm !== undefined && typeof llm.listModels === 'function') {
      try {
        const models = await llm.listModels(route)
        if (Array.isArray(models) && models.length > 0) {
          const known = models.some((m) => (typeof m === 'string' ? m : (m as { id?: unknown })?.id) === modelId)
          if (!known) return { ok: false as const, error: `模型目录中没有 "${modelId}"，无法为其写 modelOverrides` }
        }
      } catch { /* advisory: let llm-pi-ai's own validation speak */ }
    }

    const overrides = asRecord(profile.modelOverrides) ?? {}
    const entry = asRecord(overrides[modelId]) ?? {}
    applyModelPatch(entry, patch)
    if (Object.keys(entry).length === 0) delete overrides[modelId]
    else overrides[modelId] = entry
    if (Object.keys(overrides).length === 0) delete profile.modelOverrides
    else profile.modelOverrides = overrides
    await upsert(st, providers, disabled, route, profile)
    return {
      ok: true as const,
      route,
      modelId,
      storage: 'modelOverrides' as const,
      reasoningEfforts: entry.reasoningEfforts,
      compat: entry.compat,
    }
  } catch (error) {
    return { ok: false as const, error: String((error as Error)?.message ?? error) }
  }
}

/** Write the mutated profile back into whichever dict it came from. */
async function upsert(
  st: SettingsService,
  providers: Record<string, ProviderProfile>,
  disabled: Record<string, ProviderProfile>,
  route: string,
  profile: Record<string, unknown>,
): Promise<void> {
  const nextProviders: Record<string, ProviderProfile> = {}
  const nextDisabled: Record<string, ProviderProfile> = {}
  for (const key of Object.keys(providers)) nextProviders[key] = key === route ? (profile as unknown as ProviderProfile) : providers[key]
  for (const key of Object.keys(disabled)) nextDisabled[key] = key === route ? (profile as unknown as ProviderProfile) : disabled[key]
  await writeSection(st, nextProviders, nextDisabled)
}
