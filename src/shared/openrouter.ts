/**
 * dsh-model-ultra — OpenRouter provider-routing contract (shared by both halves).
 *
 * Ports the behaviour of `dsh-openrouter-providers` v1.3.0 into this plugin:
 * a provider allow-list / preference order plus a quantization limit, injected
 * into OpenRouter chat-completions request bodies as
 * `provider.only` / `provider.order` / `provider.quantizations`, and the
 * OpenRouter app-attribution headers.
 *
 * Parity notes carried over from that plugin (a naive port loses them):
 *   - `only` mode pairs with `allow_fallbacks: false`, `order` with `true`;
 *   - `provider` is omitted entirely when the list is empty AND quantization is
 *     `off` — `{}` is never sent;
 *   - `quantizations` is a one-element array built from a single choice, and the
 *     `off` sentinel never reaches the wire;
 *   - slugs are trimmed and empty entries dropped, with no charset check, no
 *     dedup and no case folding (OpenRouter matches them, not this plugin).
 *
 * Differences from that plugin, both deliberate:
 *   - the injected `provider` object MERGES with any `provider` already in the
 *     body instead of replacing it, so an unrelated `sort`/`route` setting set
 *     through another path survives;
 *   - injection happens in a `fetch` shaper (see `src/host/openrouter.ts`) keyed
 *     on the endpoint host, so it works on top of DSH's own pi-ai OpenRouter
 *     adapter — streaming, tools, images and replay all keep working — instead
 *     of replacing the transport with a hand-rolled one.
 */

/** The quantization levels OpenRouter accepts (parity with v1.3.0). */
export const QUANT_LEVELS = [
  'int4',
  'int8',
  'fp4',
  'mxfp4',
  'nvfp4',
  'fp6',
  'fp8',
  'mxfp8',
  'fp16',
  'bf16',
  'fp32',
  'unknown',
] as const

/** Sentinel meaning "do not constrain quantization at all". */
export const QUANT_OFF = 'off'

/** Route-mode selection: an allow-list or an ordered preference list. */
export type OpenRouterMode = 'only' | 'order'

/** Endpoint hosts treated as OpenRouter by default. */
export const OPENROUTER_DEFAULT_HOSTS = ['openrouter.ai'] as const

/** The attribution triple the reference plugin sends, kept verbatim. */
export const OPENROUTER_REFERER = 'https://github.com/deepseek-ai/deepseek-harness'
export const OPENROUTER_CATEGORIES = 'cli-agent'
export const OPENROUTER_DEFAULT_TITLE = 'DeepSeek Harness OpenRouter'

/** Everything this plugin persists for the OpenRouter feature. */
export interface OpenRouterState {
  /** Master switch. Even when true, the feature stays inert until the list is
   * non-empty or a quantization is selected (parity). */
  enabled: boolean
  mode: OpenRouterMode
  /** Provider slugs, in the user's order. */
  providers: string[]
  /** One of QUANT_LEVELS, or QUANT_OFF. */
  quantization: string
  /** Extra endpoint hosts to treat as OpenRouter (advanced; default one host). */
  hosts: string[]
  /** Send the OpenRouter app-attribution headers. */
  attribution: boolean
  /** Value of `X-OpenRouter-Title`. */
  attributionTitle: string
}

export const DEFAULT_OPENROUTER_STATE: OpenRouterState = {
  enabled: true,
  mode: 'only',
  providers: [],
  quantization: QUANT_OFF,
  hosts: [...OPENROUTER_DEFAULT_HOSTS],
  attribution: true,
  attributionTitle: OPENROUTER_DEFAULT_TITLE,
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Split a provider-slug textarea into slugs: newlines, ASCII/full-width commas
 * and ASCII/full-width semicolons all separate (parity with the reference
 * client), each entry trimmed, empties dropped, order preserved.
 */
export function parseProviderList(text: string): string[] {
  if (typeof text !== 'string') return []
  return text
    .split(/[\n,，;；]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** Slugs from an unknown value (array of strings or a textarea string). */
function providerSlugs(raw: unknown): string[] {
  if (typeof raw === 'string') return parseProviderList(raw)
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string').map((s) => s.trim()).filter((s) => s !== '')
}

function quantLevel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const v = raw.trim()
  if (v === '' || v === QUANT_OFF) return QUANT_OFF
  return (QUANT_LEVELS as readonly string[]).includes(v) ? v : undefined
}

function hostList(raw: unknown): string[] | undefined {
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : typeof raw === 'string' ? [raw] : undefined
  if (list === undefined) return undefined
  const cleaned = list
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((h) => h !== '')
  return cleaned.length > 0 ? cleaned : [...OPENROUTER_DEFAULT_HOSTS]
}

/**
 * Merge an unknown persisted value over the defaults into a complete state.
 * Malformed fields fall back to their default individually (parity: the
 * reference plugin's `pickState` keeps absent what it cannot recognize).
 */
export function normalizeOpenRouterState(raw: unknown): OpenRouterState {
  const src = isPlainObject(raw) ? raw : {}
  const mode = src.mode === 'order' ? 'order' : src.mode === 'only' ? 'only' : DEFAULT_OPENROUTER_STATE.mode
  const quantization = quantLevel(src.quantization) ?? DEFAULT_OPENROUTER_STATE.quantization
  const title = typeof src.attributionTitle === 'string' && src.attributionTitle.trim() !== ''
    ? src.attributionTitle.trim()
    : DEFAULT_OPENROUTER_STATE.attributionTitle
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_OPENROUTER_STATE.enabled,
    mode,
    providers: src.providers === undefined ? [...DEFAULT_OPENROUTER_STATE.providers] : providerSlugs(src.providers),
    quantization,
    hosts: hostList(src.hosts) ?? [...DEFAULT_OPENROUTER_STATE.hosts],
    attribution: typeof src.attribution === 'boolean' ? src.attribution : DEFAULT_OPENROUTER_STATE.attribution,
    attributionTitle: title,
  }
}

/**
 * Extract only the fields present in a patch, each already normalized, so a
 * partial update can be applied over the stored state (parity: the reference
 * plugin's POST is a true partial patch).
 * @throws TypeError when a present field cannot be validated.
 */
export function pickOpenRouterPatch(raw: unknown): Partial<OpenRouterState> {
  if (!isPlainObject(raw)) throw new TypeError('OpenRouter 状态补丁必须是对象')
  const out: Partial<OpenRouterState> = {}
  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') throw new TypeError('enabled 必须是布尔值')
    out.enabled = raw.enabled
  }
  if ('mode' in raw) {
    if (raw.mode !== 'only' && raw.mode !== 'order') throw new TypeError(`mode 只能是 only 或 order（收到 ${String(raw.mode)}）`)
    out.mode = raw.mode
  }
  if ('providers' in raw) out.providers = providerSlugs(raw.providers)
  if ('quantization' in raw) {
    const q = quantLevel(raw.quantization)
    if (q === undefined) throw new TypeError(`quantization 取值非法：${String(raw.quantization)}`)
    out.quantization = q
  }
  if ('hosts' in raw) {
    const h = hostList(raw.hosts)
    if (h === undefined) throw new TypeError('hosts 必须是字符串或字符串数组')
    out.hosts = h
  }
  if ('attribution' in raw) {
    if (typeof raw.attribution !== 'boolean') throw new TypeError('attribution 必须是布尔值')
    out.attribution = raw.attribution
  }
  if ('attributionTitle' in raw) {
    if (typeof raw.attributionTitle !== 'string') throw new TypeError('attributionTitle 必须是字符串')
    out.attributionTitle = raw.attributionTitle.trim() === '' ? OPENROUTER_DEFAULT_TITLE : raw.attributionTitle.trim()
  }
  return out
}

/** Is there anything to inject at all? (parity with the reference gate) */
export function openRouterActive(state: OpenRouterState): boolean {
  return state.enabled === true && (state.providers.length > 0 || state.quantization !== QUANT_OFF)
}

/**
 * The `provider` object to merge into a request body, or `undefined` when the
 * feature must not touch the request at all.
 */
export function openRouterProviderParams(state: OpenRouterState): Record<string, unknown> | undefined {
  if (!openRouterActive(state)) return undefined
  const params: Record<string, unknown> = {}
  if (state.providers.length > 0) {
    if (state.mode === 'order') {
      params.order = [...state.providers]
      params.allow_fallbacks = true
    } else {
      params.only = [...state.providers]
      params.allow_fallbacks = false
    }
  }
  if (state.quantization !== QUANT_OFF) params.quantizations = [state.quantization]
  return params
}

/**
 * The app-attribution headers for OpenRouter.
 *
 * Empty unless BOTH the master switch and the attribution switch are on: the
 * master switch means "this plugin does not touch OpenRouter traffic", so it
 * must also silence the headers. (The reference bundle gated attribution on its
 * own toggle only; a master-off request should be byte-identical.)
 */
export function attributionHeadersOf(state: OpenRouterState): Record<string, string> {
  if (state.enabled !== true || !state.attribution) return {}
  return {
    'HTTP-Referer': OPENROUTER_REFERER,
    'X-OpenRouter-Title': state.attributionTitle || OPENROUTER_DEFAULT_TITLE,
    'X-OpenRouter-Categories': OPENROUTER_CATEGORIES,
  }
}

/** Does `host` match one of the OpenRouter hosts (exact or subdomain)? */
export function hostMatches(host: string, hosts: readonly string[]): boolean {
  const h = (host || '').toLowerCase().replace(/:\d+$/, '')
  if (h === '') return false
  return hosts.some((candidate) => {
    const c = candidate.toLowerCase().replace(/:\d+$/, '')
    return c !== '' && (h === c || h.endsWith(`.${c}`))
  })
}

/** Does this request URL target an OpenRouter endpoint? */
export function isOpenRouterUrl(url: string, hosts: readonly string[] = OPENROUTER_DEFAULT_HOSTS): boolean {
  if (typeof url !== 'string' || url === '') return false
  try {
    return hostMatches(new URL(url).host, hosts)
  } catch {
    return false
  }
}

/**
 * Rewrite one JSON request body so it carries the configured `provider`
 * routing parameters.
 *
 * Guards, in order: the body must parse to an object, it must look like a chat
 * completion (`model` is a string) and the feature must be active. Anything else
 * — including malformed JSON — returns the input text untouched, so a shaper
 * bug can never corrupt a request.
 *
 * @returns the new body text, or the original text when nothing changed.
 */
export function shapeOpenRouterBody(state: OpenRouterState, bodyText: string): string {
  const params = openRouterProviderParams(state)
  if (params === undefined || typeof bodyText !== 'string' || bodyText === '') return bodyText
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return bodyText
  }
  if (!isPlainObject(parsed) || typeof parsed.model !== 'string') return bodyText
  const existing = isPlainObject(parsed.provider) ? parsed.provider : {}
  parsed.provider = { ...existing, ...params }
  try {
    return JSON.stringify(parsed)
  } catch {
    return bodyText
  }
}
