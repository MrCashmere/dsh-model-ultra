/** Shared constants used by both host and client halves. */

/** llm-pi-ai settings namespace */
export const NS = 'llm-pi-ai'

/** Client locale namespace */
export const CLIENT_NS = 'settings.dsh-model-pro'

/** Supported API protocols */
export const PROTOS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

export type Protocol = (typeof PROTOS)[number]

/** Fields that can be updated via update-field handler */
export const EDITABLE_FIELDS = ['displayName', 'api', 'baseURL', 'apiKeyEnv'] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]

/**
 * Stable credential-ref (in the DSH `credentials` service) that holds the
 * random AES-256 key this plugin uses to encrypt provider API keys at rest.
 * It is created once and NEVER regenerated once stored, so decrypting
 * previously written ciphertext keeps working after a plugin reinstall — the
 * credentials service is host-owned and keyed by this ref, not by the plugin.
 */
export const ENC_KEY_REF = 'DSH_MODEL_PRO_ENC_KEY'

/**
 * Foreign key (inside the llm-pi-ai settings section) holding the smart-routing
 * alias table: `{ alias: { provider, model } }`. Only this plugin reads it.
 */
export const ROUTES_KEY = 'routes'

/** The synthetic provider route this plugin registers its router adapter on. */
export const ROUTER_ROUTE = 'router'

/** The synthetic provider route for composite providers (组合提供商). All
 * composites share this one route; their model ids encode `composite::model`. */
export const COMPOSITE_ROUTE = 'composite'

/** Separator used to encode `composite::model` ids on the composite route. */
export const COMPOSITE_SEP = '::'

/** Every routing strategy the dispatch engine implements. */
export const ROUTE_STRATEGIES = [
  'priority',
  'weighted',
  'round-robin',
  'min-latency',
  'sticky',
] as const
export type RouteStrategy = (typeof ROUTE_STRATEGIES)[number]

/** The default strategy (kept for backward-compatible legacy routes). */
export const DEFAULT_ROUTE_STRATEGY: RouteStrategy = 'priority'

/** Foreign key (inside the llm-pi-ai settings section) holding the composite
 * provider table: `{ alias: CompositeSpec }`. Only this plugin reads it. */
export const COMPOSITES_KEY = 'composites'

/** Foreign key (inside the llm-pi-ai settings section) holding a light snapshot
 * of route/target stats + probe health, so the smart-routing page surfaces them
 * without a separate store. High-frequency logs go to the in-memory ring
 * instead (the Host sandbox withholds node fs), bounded per session. */
export const ROUTE_STATS_KEY = 'routeStats'
