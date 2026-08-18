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
