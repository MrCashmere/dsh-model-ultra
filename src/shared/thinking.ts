/**
 * dsh-model-ultra — thinking-effort contract (shared by both halves).
 *
 * DSH 0.2.0-rc.1 `llm-pi-ai` is the authority for these vocabularies. Every
 * list below mirrors a schema/enum exported by `@deepseek-ai/dsh-llm-pi-ai`
 * (`src/catalog.ts` + `src/config.ts`), and a value outside it makes the whole
 * provider profile fail validation on write:
 *
 *   - `reasoning` (route-level default level) ∈ THINKING_LEVELS
 *   - `thinkingBudgets` = ALL FOUR of minimal/low/medium/high numbers
 *   - model `reasoningEfforts` = dict whose KEYS ⊆ THINKING_LEVELS and whose
 *     VALUES are any string (the wire spelling) or null (valueless level)
 *   - model `reasoningEfforts: false` declares a non-reasoning model, and an
 *     ABSENT field means "inherit the installed catalog entry's capability"
 *   - `compat.thinkingFormat` / `thinkingTokenBudgetField` ∈ the lists below
 *
 * The normalizers here are the single place that turns UI state into a
 * schema-legal patch; the host writes what they return and the client renders
 * the same vocabulary, so neither half can drift from the other.
 */

/** Every pi-ai thinking level, in escalation order (llm-pi-ai THINKING_LEVELS). */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** Route/model `compat.thinkingFormat` vocabulary (llm-pi-ai SUPPORTED_THINKING_FORMATS). */
export const THINKING_FORMATS = [
  'openai',
  'deepseek',
  'openrouter',
  'together',
  'baseten',
  'zai',
  'qwen',
  'chat-template',
  'qwen-chat-template',
  'string-thinking',
  'ant-ling',
] as const
export type ThinkingFormat = (typeof THINKING_FORMATS)[number]

/** `compat.thinkingTokenBudgetField` vocabulary (llm-pi-ai THINKING_TOKEN_BUDGET_FIELDS). */
export const THINKING_TOKEN_BUDGET_FIELDS = [
  'thinking_token_budget',
  'thinking_budget',
  'thinking_budget_tokens',
] as const

/** The four required `thinkingBudgets` keys — all of them, or the field is invalid. */
export const THINKING_BUDGET_KEYS = ['minimal', 'low', 'medium', 'high'] as const
export type ThinkingBudgetKey = (typeof THINKING_BUDGET_KEYS)[number]
export type ThinkingBudgets = Record<ThinkingBudgetKey, number>

/** The `reasoningEfforts` value a model may carry: a dict of level→wire spelling
 * (null = valueless), `false` for a non-reasoning model, or absent = inherit. */
export type ReasoningEfforts = Partial<Record<ThinkingLevel, string | null>> | false

/** Compat switches this plugin's thinking editor owns. Other `compat` keys are
 * preserved untouched on every write. */
export interface ThinkingCompat {
  thinkingFormat?: ThinkingFormat
  supportsReasoningEffort?: boolean
  supportsThinkingTokenBudget?: boolean
  thinkingTokenBudgetField?: string
  requiresThinkingAsText?: boolean
  requiresReasoningContentOnAssistantMessages?: boolean
  forceAdaptiveThinking?: boolean
}

/**
 * Preset wire spellings offered next to the free-text field for each level.
 * These are conventions gateways use; the editor always keeps the manual input,
 * so an unlisted spelling is one keystroke away.
 */
export const EFFORT_PRESETS: Record<ThinkingLevel, readonly string[]> = {
  off: ['off', 'none'],
  minimal: ['minimal', 'low'],
  low: ['low', 'minimal'],
  medium: ['medium', 'mid'],
  high: ['high', 'max'],
  xhigh: ['xhigh', 'high'],
  max: ['max', 'ultra'],
}

/** One-click whole-model presets. `null` = remove the field (inherit catalog). */
export interface EffortPreset {
  id: string
  /** Levels this preset offers, in escalation order. */
  efforts: Partial<Record<ThinkingLevel, string | null>> | false | null
}

export const EFFORT_PRESETS_ALL: readonly EffortPreset[] = [
  { id: 'inherit', efforts: null },
  { id: 'none', efforts: false },
  { id: 'two', efforts: { off: null, high: 'high' } },
  { id: 'four', efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { id: 'five', efforts: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' } },
  { id: 'full', efforts: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
] as const

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** Is `v` one of the pi-ai thinking levels? */
export function isThinkingLevel(v: unknown): v is ThinkingLevel {
  return typeof v === 'string' && (THINKING_LEVELS as readonly string[]).includes(v)
}

/**
 * Normalize a `reasoningEfforts` patch into the exact value the model entry
 * should hold.
 *
 * Beyond the schema, this enforces llm-pi-ai's own resolution rules
 * (`resolveModelReasoning` in the compiled adapter), so the page can never write
 * a profile DSH would refuse to resolve:
 *   - only `off` may be valueless (`off:` → null); a thinking level needs the
 *     wire value dispatch sends, and no level may hold an empty string;
 *   - at least one level beyond `off` must be offered — a non-reasoning model is
 *     declared with `false`, not with `{off: null}`.
 *
 * @param input - `false` (non-reasoning), a level→spelling dict, or null /
 *   undefined to REMOVE the field (inherit the installed catalog capability).
 * @returns `false`, a schema-legal dict, or `undefined` meaning "delete the key".
 * @throws TypeError when a level key is unknown, a value is not a string /
 *   boolean / null, or one of the resolution rules above is violated — the
 *   caller surfaces that as a validation error instead of writing the profile.
 */
export function normalizeReasoningEfforts(input: unknown): ReasoningEfforts | undefined {
  if (input === undefined || input === null) return undefined
  if (input === false) return false
  if (!isPlainObject(input)) throw new TypeError('reasoningEfforts 必须是对象、false 或 null')
  const out: Partial<Record<ThinkingLevel, string | null>> = {}
  for (const key of Object.keys(input)) {
    if (!isThinkingLevel(key)) throw new TypeError(`reasoningEfforts 含未知档位 "${key}"`)
    const raw = input[key]
    if (raw === null || raw === undefined) {
      if (key !== 'off') throw new TypeError(`reasoningEfforts["${key}"] 必须填写线上取值（只有 off 档可以留空）`)
      out[key] = null
      continue
    }
    if (raw === true) { out[key] = key; continue }
    if (raw === false) continue // an unchecked level is simply not offered
    if (typeof raw !== 'string') throw new TypeError(`reasoningEfforts["${key}"] 必须是字符串、null 或布尔`)
    const trimmed = raw.trim()
    // A valueless level is `off:` in YAML — null, not the empty string. Only
    // `off` may leave the value empty (llm-pi-ai rejects an empty wire value).
    if (trimmed === '') {
      if (key !== 'off') throw new TypeError(`reasoningEfforts["${key}"] 不能为空（只有 off 档可以留空）`)
      out[key] = null
      continue
    }
    out[key] = trimmed
  }
  // Canonical order so a re-read config renders identically to what was written.
  const ordered: Partial<Record<ThinkingLevel, string | null>> = {}
  for (const level of THINKING_LEVELS) if (Object.prototype.hasOwnProperty.call(out, level)) ordered[level] = out[level]
  // An empty dict would mean "offers no level at all"; treat it as inherit.
  if (Object.keys(ordered).length === 0) return undefined
  if (!Object.keys(ordered).some((level) => level !== 'off')) {
    throw new TypeError('reasoningEfforts 只有 off 档：请再声明一个思考档位，或把该模型设为非推理 (false)')
  }
  return ordered
}

/**
 * Normalize `thinkingBudgets`. All four keys are required by the schema.
 *
 * @param input - the four numbers, or null / undefined to REMOVE the field.
 * @throws TypeError naming the offending key.
 */
export function normalizeThinkingBudgets(input: unknown): ThinkingBudgets | undefined {
  if (input === undefined || input === null) return undefined
  if (!isPlainObject(input)) throw new TypeError('thinkingBudgets 必须是对象或 null')
  const out = {} as ThinkingBudgets
  for (const key of THINKING_BUDGET_KEYS) {
    const raw = input[key]
    if (raw === undefined || raw === null || raw === '') throw new TypeError(`thinkingBudgets 缺少 "${key}"`)
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      throw new TypeError(`thinkingBudgets["${key}"] 必须是 ≥1 的整数`)
    }
    out[key] = n
  }
  return out
}

/** Iterate the thinking-related `compat` keys, dropping unknown ones. */
export function normalizeThinkingCompat(input: unknown): ThinkingCompat {
  if (!isPlainObject(input)) return {}
  const out: Record<string, unknown> = {}
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

  const fmt = str(input.thinkingFormat)
  if (fmt !== undefined) {
    if (!(THINKING_FORMATS as readonly string[]).includes(fmt)) throw new TypeError(`compat.thinkingFormat 未知取值 "${fmt}"`)
    out.thinkingFormat = fmt
  }
  const field = str(input.thinkingTokenBudgetField)
  if (field !== undefined) {
    if (!(THINKING_TOKEN_BUDGET_FIELDS as readonly string[]).includes(field)) {
      throw new TypeError(`compat.thinkingTokenBudgetField 未知取值 "${field}"`)
    }
    out.thinkingTokenBudgetField = field
  }
  for (const key of [
    'supportsReasoningEffort',
    'supportsThinkingTokenBudget',
    'requiresThinkingAsText',
    'requiresReasoningContentOnAssistantMessages',
    'forceAdaptiveThinking',
  ] as const) {
    const v = bool(input[key])
    if (v !== undefined) out[key] = v
  }
  return out as ThinkingCompat
}
