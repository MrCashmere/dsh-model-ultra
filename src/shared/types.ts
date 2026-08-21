/** Shared types used by both host and client halves. */

/** AES-256-GCM encrypted secret snapshot stored in a provider profile.
 * `iv`/`ct` are base64; the random AES key lives in the DSH credentials
 * service under ENC_KEY_REF (stable across plugin reinstall). */
export interface EncryptedSecret {
  v: 1
  iv: string
  ct: string
}

/** A provider entry in the providers / disabledProviders dict */
export interface ProviderProfile {
  displayName?: string
  api?: string
  baseURL?: string
  apiKeyEnv?: string
  /** Encrypted-at-rest snapshot of the real API key (see EncryptedSecret). */
  apiKeyEnc?: EncryptedSecret
  headers?: Record<string, string>
  models?: ModelEntry[]
  [key: string]: unknown
}

/** A model entry in a provider's models array */
export interface ModelEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  [key: string]: unknown
}

/** Result from list-providers handler */
export interface ProviderListItem {
  route: string
  displayName: string
  declared: boolean
  api: string
  baseURL: string
  apiKeyEnv: string
  disabled: boolean
  hasHeaders: boolean
  headerCount: number
  modelCount: number
  usesCatalog: boolean
  /** Whether an encrypted API-key snapshot is stored for this provider. */
  hasSecret: boolean
}

/** Result from get-provider handler */
export interface ProviderData {
  ok: true
  route: string
  displayName: string
  api: string
  baseURL: string
  apiKeyEnv: string
  disabled: boolean
  headers: HeaderPair[]
  models: ModelEntry[]
  usesCatalog: boolean
  /** Advertised model ids for the test dropdown (advisory; may be empty). */
  availableModels?: string[]
  /** Whether an encrypted API-key snapshot is stored. */
  hasSecret?: boolean
  /** Decrypted API key — present only when the caller passed `includeSecret`. */
  secret?: string
}

/** Result from test-provider handler */
export interface TestResult {
  ok: boolean
  model?: string
  latencyMs?: number
  stopReason?: string
  reply?: string
  truncated?: boolean
  error?: string
}

/** A header name-value pair as used in the UI */
export interface HeaderPair {
  name: string
  value: string
}

/** A discovered model from the llm.discoverModels API */
export interface DiscoveredModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
}

/** RPC response wrapper */
export interface RPCResult<T = unknown> {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/** The boot state for the ModelProPage component */
export interface BootState {
  providers: ProviderListItem[]
  protocols: string[]
  writable: boolean
  error: string
}

/** Status banner */
export interface StatusMsg {
  kind: 'ok' | 'err'
  text: string
}

/** The create-form state */
export interface CreateFormState {
  route: string
  displayName: string
  api: string
  baseURL: string
  apiKeyEnv: string
  /** Optional real API key to persist (encrypted) on create. */
  apiKey: string
}

/** The info-panel editable state in the editor */
export interface InfoState {
  displayName: string
  api: string
  baseURL: string
  apiKeyEnv: string
}

/** Translation function type */
export type TFunc = (key: string) => string

/** The RPC call function provided to components */
export type CallFn = (method: string, payload?: Record<string, unknown>) => Promise<any>
