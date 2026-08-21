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
