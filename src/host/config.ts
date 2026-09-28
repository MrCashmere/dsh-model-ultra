/**
 * dsh-model-ultra — this plugin's own settings schema.
 *
 * dsh 0.2.0-rc.1 validates every settings write against the owning entry's
 * Config schema and refuses anything that is not a VOLATILE path:
 *
 *   Config field "disabledProviders" is not volatile
 *
 * `llm-pi-ai` declares exactly one volatile field (`providers`), so the state
 * this plugin owns cannot live there. It lives in this plugin's own profile
 * entry instead (`id: dsh-model-ultra`, declared by cordis.patch.yml), which is
 * why this module exports `Config`: the settings service derives each entry's
 * editable form from `entry.fiber.runtime.Config`.
 *
 * Every field is `.volatile()` so a write updates the live instance in place
 * instead of restarting the plugin. The keys are spelled literally because the
 * schema is a typed object; STATE_KEYS mirrors them for snapshot writes.
 */

import z from '@deepseek-ai/schemastery'

/** Provider profiles parked while disabled. Deliberately unvalidated (`z.any`):
 * a parked profile is an opaque copy of a provider profile that must round-trip
 * byte-for-byte, and this plugin — not llm-pi-ai — owns it. */
export const Config = z.object({
  disabledProviders: z.dict(z.any()).default({}).volatile(),
  routes: z.dict(z.any()).default({}).volatile(),
  composites: z.dict(z.any()).default({}).volatile(),
  routeStats: z.any().default({}).volatile(),
  uiPrefs: z.any().default({}).volatile(),
  /** OpenRouter provider-list / quantization routing, plus the attribution
   * switches. Deliberately unvalidated (`z.any`): the shape is owned by
   * `normalizeOpenRouterState` in ../shared/openrouter.ts, and a schema here
   * would freeze the field set for stored state written by an older version. */
  openrouter: z.any().default({}).volatile(),
})

/** Every state key, in a stable order. A `settings.replace()` write resets all
 * volatile fields of the entry, so callers must always send the FULL snapshot
 * (see `writeState` in ./utils.ts). */
export const STATE_KEYS = ['disabledProviders', 'routes', 'composites', 'routeStats', 'uiPrefs', 'openrouter'] as const
