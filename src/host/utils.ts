/**
 * dsh-model-ultra — Host half utilities.
 *
 * makeHostPlain: rebuilds objects with Object.create(null) so they pass the
 * dsh-settings isPlainObject check across a vm sandbox realm boundary (harmless
 * in the static Desktop form, where the Host half runs in the ordinary Node
 * process).
 *
 * Settings access, dsh 0.2.0-rc.1 contract:
 *   - the settings service has NO `get(ns)`. `describe()` is the read surface,
 *     and each row exposes `value` (the RESOLVED config, parsed by the owning
 *     plugin's schema) and `user` (the raw profile-patch config, projected only
 *     through the volatile FORM — dict nodes pass through untouched).
 *     We read `user`: keys only this plugin keeps inside a provider profile
 *     (`apiKeyEnc`, `disabled`, …) are dropped from `value` by llm-pi-ai's
 *     profile schema.
 *   - writes are validated against the entry's Config schema and only VOLATILE
 *     paths are writable. `llm-pi-ai` declares exactly one volatile field
 *     (`providers`), so this plugin's own state (disabledProviders, routes,
 *     composites, routeStats, uiPrefs) lives in this plugin's OWN settings
 *     entry (`dsh-model-ultra`, declared in cordis.patch.yml) under the schema in
 *     ./config.ts.
 */

import { NS, STATE_NS, DISABLED_KEY, ROUTES_KEY } from '../shared/constants'
import { STATE_KEYS } from './config'
import type { ProviderProfile, RoutesMap } from '../shared/types'

/** One settings entry as returned by `settings.describe()`. */
export interface SettingsDescriptorRow {
  ns: string
  /** Resolved config, parsed by the entry's schema. */
  value?: unknown
  /** Raw profile-patch config, projected through the volatile form only. */
  user?: unknown
}

/** Settings service interface (subset we use). */
export interface SettingsService {
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorRow[]
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
  replace(ns: string, section: object, expectedRevision?: number): Promise<void>
  configure?(presentation: { auto?: boolean }): () => void
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
  /** Cordis logger service property (NOT a service name: `ctx.get('logger')` is undefined). */
  logger?: { warn?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void }
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

/** Read one settings entry's RAW operator config by namespace.
 *
 * 0.2.0-rc.1 exposes no `settings.get(ns)`; `describe()` is the read surface.
 * `user` is the profile patch's own config (projected through the volatile form
 * only, so dict values survive verbatim); `value` is the schema-parsed config
 * and therefore drops keys the owning plugin's schema does not declare. */
export function readSection(st: SettingsService | undefined, ns: string): Record<string, unknown> {
  if (st === undefined) return {}
  try {
    const rows = st.describe()
    if (!Array.isArray(rows)) return {}
    const row = rows.find((r) => r && r.ns === ns)
    const user = row?.user
    if (user && typeof user === 'object' && !Array.isArray(user)) return user as Record<string, unknown>
  } catch { /* ignore */ }
  return {}
}

/** Read the `providers` dict from the llm-pi-ai settings section. */
export function readProviders(st: SettingsService | undefined): Record<string, ProviderProfile> {
  try {
    const providers = readSection(st, NS).providers
    if (providers && typeof providers === 'object' && !Array.isArray(providers))
      return providers as Record<string, ProviderProfile>
  } catch { /* ignore */ }
  return {}
}

/** Read the `disabledProviders` dict from this plugin's own settings section. */
export function readDisabled(st: SettingsService | undefined): Record<string, ProviderProfile> {
  try {
    const disabled = readSection(st, STATE_NS)[DISABLED_KEY]
    if (disabled && typeof disabled === 'object' && !Array.isArray(disabled))
      return disabled as Record<string, ProviderProfile>
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

/** Read the smart-routing alias table from this plugin's settings section.
 * Returns a SHALLOW COPY: the resolved settings object is deep-frozen (so
 * `delete`/assigment on it throws in strict mode — "Cannot delete property"),
 * and callers may restructure the map in place before writing it back. */
export function readRoutes(st: SettingsService | undefined): RoutesMap {
  try {
    const r = readSection(st, STATE_NS)[ROUTES_KEY]
    if (r && typeof r === 'object') return { ...(r as RoutesMap) }
  } catch { /* ignore */ }
  return {}
}

/** Write the smart-routing alias table, preserving every other state key. */
export async function writeRoutes(st: SettingsService, routes: RoutesMap): Promise<void> {
  await writeRoutesRootKey(st, ROUTES_KEY, routes)
}

/** Read an arbitrary key from this plugin's settings section (e.g. composites /
 * routeStats / uiPrefs), returning a plain copy. */
export function readRoutesRootKey(st: SettingsService | undefined, key: string): unknown {
  try {
    const v = readSection(st, STATE_NS)[key]
    if (v && typeof v === 'object') return { ...(v as Record<string, unknown>) }
    return v
  } catch { /* ignore */ }
  return undefined
}

/**
 * Write one snapshot key into this plugin's own settings section, preserving
 * the other state keys.
 *
 * `settings.replace()` resets every VOLATILE field of the entry before merging,
 * so the snapshot handed to it must carry ALL of the entry's volatile fields.
 * We therefore read-modify-write the complete state on every update.
 */
export async function writeRoutesRootKey(st: SettingsService | undefined, key: string, value: unknown): Promise<void> {
  if (st === undefined) return
  await writeState(st, { [key]: value })
}

/** Read-modify-write of this plugin's full state snapshot. */
async function writeState(st: SettingsService, patch: Record<string, unknown>): Promise<void> {
  const current = readSection(st, STATE_NS)
  const next: Record<string, unknown> = {}
  for (const key of STATE_KEYS) {
    const value = Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : current[key]
    if (value === undefined) continue
    next[key] = value
  }
  await st.replace(STATE_NS, makeHostPlain(next) as any)
}

/** The wire model id for a provider/model: `requestModel` when the provider's
 * model entry declares one, else the selectable id itself. */
export function wireModelOf(st: SettingsService | undefined, provider: string, model: string): string {
  if (!model) return model
  try {
    const providers = readProviders(st)
    const p = readProfile(providers as Record<string, ProviderProfile>, provider)
    const entry = Array.isArray(p?.models)
      ? (p.models as Array<Record<string, unknown>>).find((m) => m && m.id === model)
      : undefined
    if (entry && typeof entry.requestModel === 'string' && entry.requestModel.trim()) {
      return entry.requestModel.trim()
    }
  } catch { /* fall through */ }
  return model
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
 * Persist the provider dicts: `providers` into the `llm-pi-ai` section (the only
 * volatile field that schema declares) and `disabledProviders` into this
 * plugin's own section.
 *
 * Ordering is add-before-remove: a profile that is moving between the two dicts
 * must land in its new home before it leaves the old one, so a failed write can
 * never lose a profile (it only leaves a stale duplicate).
 *
 * This is the only write path — every handler that modifies provider state
 * calls this.
 */
export async function writeSection(
  st: SettingsService,
  providers: Record<string, ProviderProfile>,
  disabled: Record<string, ProviderProfile>,
): Promise<void> {
  const currentProviders = readProviders(st)
  const currentDisabled = readDisabled(st)

  const writeProviders = async () => {
    await st.replace(NS, makeHostPlain({ providers }) as any)
  }
  const writeDisabled = async () => {
    await writeState(st, { [DISABLED_KEY]: disabled })
  }

  const gainsProvider = Object.keys(providers).some((k) => !Object.prototype.hasOwnProperty.call(currentProviders, k))
  const gainsDisabled = Object.keys(disabled).some((k) => !Object.prototype.hasOwnProperty.call(currentDisabled, k))

  if (gainsDisabled && !gainsProvider) {
    await writeDisabled()
    await writeProviders()
  } else {
    await writeProviders()
    await writeDisabled()
  }
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
