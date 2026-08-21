/**
 * dsh-model-pro — Host half utilities.
 *
 * makeHostPlain: rebuilds objects with Object.create(null) so they pass
 * the dsh-settings isPlainObject check across the vm sandbox realm boundary.
 *
 * readProviders / readDisabled / readProfile: helpers to read from the
 * llm-pi-ai settings section safely.
 */

import { NS } from '../shared/constants'
import type { ProviderProfile } from '../shared/types'

/** Settings service interface (subset we use) */
interface SettingsService {
  get(ns: string): Record<string, unknown> | undefined
  readonly writable: boolean
  replace(ns: string, section: unknown): Promise<void>
}

/** LLM service interface (subset we use) */
interface LLMService {
  listConfigurableProviders(): Array<{
    settingsNs: string
    provider: string
    displayName?: string
    declared?: boolean
  }>
  discoverModels(ns: string, request: Record<string, unknown>): Promise<
    Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }>
  >
}

/** Cordis context (subset) */
export interface HostCtx {
  get(name: 'settings'): SettingsService | undefined
  get(name: 'llm'): LLMService | undefined
  get(name: string): unknown
}

/**
 * Recursively rebuild an object with Object.create(null) prototype.
 * The dsh-settings isPlainObject check (proto === Object.prototype || proto === null)
 * rejects sandbox-realm object literals because vm contexts have their own
 * Object.prototype. Object.create(null) produces a null-proto object that passes.
 */
export function makeHostPlain(obj: Record<string, unknown>): Record<string, null> {
  const out = Object.create(null) as Record<string, null>
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue
    const v = obj[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = makeHostPlain(v as Record<string, unknown>) as any
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item))
          return makeHostPlain(item as Record<string, unknown>)
        return item
      }) as any
    } else {
      out[k] = v as any
    }
  }
  return out
}

/** Read the `providers` dict from the llm-pi-ai settings section. */
export function readProviders(st: SettingsService | undefined): Record<string, ProviderProfile> {
  if (st === undefined) return {}
  try {
    const section = st.get(NS)
    if (section && typeof section === 'object' && (section as any).providers && typeof (section as any).providers === 'object')
      return (section as any).providers as Record<string, ProviderProfile>
  } catch { /* ignore */ }
  return {}
}

/** Read the `disabledProviders` dict from the llm-pi-ai settings section. */
export function readDisabled(st: SettingsService | undefined): Record<string, ProviderProfile> {
  if (st === undefined) return {}
  try {
    const section = st.get(NS)
    if (section && typeof section === 'object' && (section as any).disabledProviders && typeof (section as any).disabledProviders === 'object')
      return (section as any).disabledProviders as Record<string, ProviderProfile>
  } catch { /* ignore */ }
  return {}
}

/** Read a single provider profile from a dict by route. */
export function readProfile(
  providers: Record<string, ProviderProfile>,
  route: string,
): ProviderProfile | null {
  const p = providers[route]
  if (!p || typeof p !== 'object') return null
  return p
}

/** Check if settings are writable, defaulting to true. */
export function checkWritable(st: SettingsService | undefined): boolean {
  if (st === undefined) return false
  try {
    return st.writable !== false
  } catch {
    return true
  }
}

/**
 * Write both provider dicts to the `llm-pi-ai` settings section.
 * This is the only write path — every handler that modifies state calls this.
 */
export async function writeSection(
  st: SettingsService,
  providers: Record<string, ProviderProfile>,
  disabled: Record<string, ProviderProfile>,
): Promise<void> {
  await st.replace(NS, makeHostPlain({ providers, disabledProviders: disabled }) as any)
}

/**
 * Update a single provider in-place within the correct dict (providers or disabled),
 * then write both dicts.
 */
export async function updateProviderInPlace(
  st: SettingsService,
  route: string,
  mutator: (profile: ProviderProfile) => ProviderProfile,
): Promise<void> {
  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const nextProviders: Record<string, ProviderProfile> = {}
  const nextDisabled: Record<string, ProviderProfile> = {}

  for (const k of Object.keys(providers)) {
    if (k === route) nextProviders[k] = mutator({ ...providers[k] })
    else nextProviders[k] = providers[k]
  }
  for (const k of Object.keys(disabled)) {
    if (k === route) nextDisabled[k] = mutator({ ...disabled[k] })
    else nextDisabled[k] = disabled[k]
  }

  await writeSection(st, nextProviders, nextDisabled)
}
