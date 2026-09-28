/**
 * dsh-model-ultra — Host half of the OpenRouter feature.
 *
 * Two responsibilities:
 *
 * 1. **Request shaping.** The `provider` routing parameters have to reach the
 *    wire, but DSH's pi-ai OpenRouter adapter builds its own body and offers no
 *    body hook. Rather than re-implementing the transport (what
 *    `dsh-openrouter-providers` had to do in the pre-0.1.6 dynamic-plugin
 *    sandbox, which had no `fetch`), this plugin wraps `globalThis.fetch` and
 *    rewrites ONLY requests that (a) target a configured OpenRouter host, (b)
 *    are POST/PUT/PATCH, and (c) carry a JSON body with a `model` field. pi-ai
 *    builds its OpenAI client per call through `openai`'s
 *    `options.fetch ?? getDefaultFetch()`, so a client constructed after this
 *    shaper is installed captures it; streaming, tools, images, replay and
 *    retries keep working because the request is still pi-ai's.
 *
 *    The wrapper is transparent by construction: any anomaly (unparseable body,
 *    unexpected init shape, missing state) leaves the call byte-identical, it
 *    never throws into the caller, and `dispose()` restores the original fetch.
 *
 * 2. **Legacy import.** The reference plugin kept its own
 *    `$DSH_HOME/openrouter-providers.json` (and two older homes). Its config is
 *    imported on demand so an existing setup is not retyped.
 */

import type { SettingsService } from './utils'
import { STATE_NS } from '../shared/constants'
import { readSection, writeRoutesRootKey } from './utils'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  OPENROUTER_DEFAULT_HOSTS,
  attributionHeadersOf,
  isOpenRouterUrl,
  normalizeOpenRouterState,
  pickOpenRouterPatch,
  shapeOpenRouterBody,
  type OpenRouterState,
} from '../shared/openrouter'

/** Settings key (inside this plugin's own section) holding the OpenRouter state. */
export const OPENROUTER_KEY = 'openrouter'

/** Read the persisted OpenRouter state (defaults when nothing is stored yet). */
export function readOpenRouterState(st: SettingsService | undefined): OpenRouterState {
  try {
    return normalizeOpenRouterState(readSection(st, STATE_NS)[OPENROUTER_KEY])
  } catch {
    return normalizeOpenRouterState(undefined)
  }
}

/**
 * Apply a partial patch over the stored state and persist it, preserving every
 * other state key of this plugin's settings entry (a `replace()` write resets
 * all volatile fields, so the whole snapshot is rewritten).
 * @throws TypeError when a patched field is invalid.
 */
export async function writeOpenRouterState(
  st: SettingsService | undefined,
  patch: unknown,
): Promise<OpenRouterState> {
  const current = readOpenRouterState(st)
  const merged = { ...current, ...pickOpenRouterPatch(patch) }
  if (st !== undefined) await writeRoutesRootKey(st, OPENROUTER_KEY, merged)
  return merged
}

// --- fetch shaper -----------------------------------------------------------

/** Marker on the wrapper so a second install cannot double-wrap the global. */
const SHAPER_MARK = Symbol.for('dsh-model-ultra.openrouter.shaper')

/** Live counters, exposed for the settings page's 自检 readout. */
export interface ShaperStatus {
  installed: boolean
  /** Why the shaper is not installed (`no-fetch`, `wrapped-by-another-instance`). */
  reason?: string
  calls: number
  shaped: number
  attributed: number
  lastError?: string
}

export interface OpenRouterShaper {
  readonly installed: boolean
  readonly reason?: string
  status(): ShaperStatus
  dispose(): void
}

/**
 * The shaper currently installed by this plugin's fiber. Cordis `apply` can run
 * again after a reload, so the mount path disposes the previous instance first
 * and handlers read the live one through {@link openRouterShaperStatus}.
 */
let activeShaper: OpenRouterShaper | undefined

/** Status of the live shaper (`not-mounted` before apply, or after a failure). */
export function openRouterShaperStatus(): ShaperStatus {
  if (activeShaper === undefined) return { installed: false, reason: 'not-mounted', calls: 0, shaped: 0, attributed: 0 }
  return activeShaper.status()
}

/**
 * Install (or re-install) the shaper for one fiber and remember it, so the
 * settings page can report whether request shaping is live.
 * @returns a disposer that restores the previous global `fetch`.
 */
export function mountOpenRouterShaper(getState: () => OpenRouterState, onError?: (error: unknown) => void): () => void {
  try { activeShaper?.dispose() } catch { /* ignore */ }
  const shaper = installOpenRouterShaper(getState, onError)
  activeShaper = shaper
  return () => {
    try { shaper.dispose() } catch { /* ignore */ }
    if (activeShaper === shaper) activeShaper = undefined
  }
}

const inert = (reason: string): OpenRouterShaper => ({
  installed: false,
  reason,
  status: () => ({ installed: false, reason, calls: 0, shaped: 0, attributed: 0 }),
  dispose: () => {},
})

/** URL of a fetch input, without touching its body. */
function urlOf(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  const url = (input as { url?: unknown } | null | undefined)?.url
  return typeof url === 'string' ? url : ''
}

/** Method of a fetch call (Request input or init override). */
function methodOf(input: unknown, init: unknown): string {
  const fromInit = (init as { method?: unknown } | null | undefined)?.method
  if (typeof fromInit === 'string' && fromInit !== '') return fromInit.toUpperCase()
  const fromRequest = (input as { method?: unknown } | null | undefined)?.method
  if (typeof fromRequest === 'string' && fromRequest !== '') return fromRequest.toUpperCase()
  return 'GET'
}

/** Plain-object view of any fetch header container. */
function headersToObject(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers === undefined || headers === null) return out
  try {
    if (typeof (headers as { forEach?: unknown }).forEach === 'function') {
      ;(headers as { forEach: (cb: (v: string, k: string) => void) => void }).forEach((value, key) => { out[String(key)] = String(value) })
      return out
    }
  } catch { /* fall through to the pair/record shapes */ }
  if (Array.isArray(headers)) {
    for (const pair of headers) if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1])
    return out
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) out[key] = String(value)
  }
  return out
}

/** Body text of a fetch call, or undefined when it is not a plain string body. */
async function bodyTextOf(input: unknown, init: unknown): Promise<string | undefined> {
  const initBody = (init as { body?: unknown } | null | undefined)?.body
  if (typeof initBody === 'string') return initBody
  if (initBody !== undefined && initBody !== null) return undefined
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      // Clone first: reading the original would consume its single-use body.
      return await input.clone().text()
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Install the OpenRouter request shaper.
 *
 * @param getState - reads the CURRENT state per request (never cached, so a
 *   settings change applies to the next call without a restart — parity).
 * @param onError - optional sink for shaping failures (they are swallowed for
 *   the caller; the request still goes out untouched).
 */
export function installOpenRouterShaper(
  getState: () => OpenRouterState,
  onError?: (error: unknown) => void,
): OpenRouterShaper {
  const g = globalThis as { fetch?: unknown }
  const original = g.fetch as ((input: unknown, init?: unknown) => Promise<Response>) | undefined
  if (typeof original !== 'function') return inert('no-fetch')
  if ((original as unknown as Record<symbol, unknown>)[SHAPER_MARK] === true) return inert('wrapped-by-another-instance')

  const counters = { calls: 0, shaped: 0, attributed: 0, lastError: undefined as string | undefined }

  const shaper = async function (input: unknown, init?: unknown): Promise<Response> {
    counters.calls += 1
    let callInput = input
    let callInit = init
    try {
      const state = getState()
      const url = urlOf(input)
      if (url !== '' && isOpenRouterUrl(url, state.hosts.length > 0 ? state.hosts : OPENROUTER_DEFAULT_HOSTS)) {
        const method = methodOf(input, init)
        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          const text = await bodyTextOf(input, init)
          const shaped = text === undefined ? undefined : shapeOpenRouterBody(state, text)
          const bodyChanged = shaped !== undefined && shaped !== text
          const attribution = attributionHeadersOf(state)
          const attributed = Object.keys(attribution).length > 0
          if (bodyChanged || attributed) {
            if (typeof Request !== 'undefined' && input instanceof Request) {
              // Request-shaped call: rebuild it with the new body / headers.
              const headers = new Headers(input.headers)
              for (const [key, value] of Object.entries(attribution)) headers.set(key, value)
              callInput = new Request(input, {
                headers,
                ...(bodyChanged ? { body: shaped } : {}),
              } as RequestInit)
            } else {
              const headers = { ...headersToObject((init as { headers?: unknown } | null | undefined)?.headers), ...attribution }
              callInit = { ...(init as object | undefined), headers, ...(bodyChanged ? { body: shaped } : {}) }
            }
            if (bodyChanged) counters.shaped += 1
            if (attributed) counters.attributed += 1
          }
        }
      }
    } catch (error) {
      counters.lastError = String((error as Error)?.message ?? error)
      onError?.(error)
      callInput = input
      callInit = init
    }
    return original.call(g, callInput, callInit)
  }
  ;(shaper as unknown as Record<symbol, unknown>)[SHAPER_MARK] = true
  g.fetch = shaper

  const status = (): ShaperStatus => ({
    installed: (globalThis as { fetch?: unknown }).fetch === shaper,
    calls: counters.calls,
    shaped: counters.shaped,
    attributed: counters.attributed,
    ...(counters.lastError !== undefined ? { lastError: counters.lastError } : {}),
  })

  return {
    installed: true,
    status,
    dispose: () => {
      // Only restore when we are still the installed wrapper — never clobber a
      // later patch (another plugin, or a test harness).
      if ((globalThis as { fetch?: unknown }).fetch === shaper) g.fetch = original
    },
  }
}

// --- legacy import ----------------------------------------------------------

export interface LegacySourceResult {
  path: string
  /** `imported` — recognized fields found; `empty` — file exists but no
   * recognized fields; `missing`; `error`; `unsupported` — shape not parsed. */
  status: 'imported' | 'empty' | 'missing' | 'error' | 'unsupported'
  detail?: string
}

export interface LegacyImportResult {
  ok: boolean
  /** The winning source's recognized fields, when any. */
  imported?: Partial<OpenRouterState>
  sources: LegacySourceResult[]
  error?: string
}

/** Read a text file through the fs service when present, else node:fs. */
async function readTextFile(ctx: unknown, path: string): Promise<string> {
  const fsSvc = (ctx as { get?: (name: string) => unknown })?.get?.('fs') as
    | { resolve?: (p: string) => unknown; readText?: (t: unknown) => Promise<string> }
    | undefined
  if (fsSvc !== undefined && typeof fsSvc.readText === 'function' && typeof fsSvc.resolve === 'function') {
    try {
      return await fsSvc.readText(await fsSvc.resolve(path))
    } catch { /* fall through to node:fs */ }
  }
  return await readFile(path, 'utf8')
}

/** DSH home: `$DSH_HOME` when set, else `~/.dsh` (parity with the reference). */
export function dshHome(): string {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return join(homedir(), '.dsh')
}

/** Recognize the four fields from a parsed JSON document. */
function pickRecognized(raw: unknown): Partial<OpenRouterState> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  try {
    const patch = pickOpenRouterPatch(raw)
    // Only count fields the reference plugin actually stored.
    const out: Partial<OpenRouterState> = {}
    for (const key of ['enabled', 'mode', 'providers', 'quantization'] as const) {
      if (patch[key] !== undefined) (out as Record<string, unknown>)[key] = patch[key]
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Best-effort reader for the retired `settings.yaml.imported` document: only
 * the reference plugin's own section, only its four keys, scalars plus flow or
 * block lists. Returns null when the section or key shapes are not recognized —
 * the caller then reports the path so the values can be copied by hand.
 */
export function sectionOfImportedSettings(text: string): Partial<OpenRouterState> | null {
  if (typeof text !== 'string' || text === '') return null
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^openrouter-providers:\s*(#.*)?$/.test(line))
  if (start < 0) return null
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    if (/^\S/.test(line)) break // next top-level key ends the section
    body.push(line)
  }
  const strip = (v: string): string => v.trim().replace(/^['"]|['"]$/g, '')
  const out: Partial<OpenRouterState> = {}
  let sawField = false
  for (let i = 0; i < body.length; i += 1) {
    const line = body[i]
    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (m === null) continue
    const [, key, rest] = m
    if (key === 'enabled' && /^(true|false)$/.test(rest.trim())) { out.enabled = rest.trim() === 'true'; sawField = true }
    else if (key === 'mode' && /^(only|order)$/.test(strip(rest))) { out.mode = strip(rest) as 'only' | 'order'; sawField = true }
    else if (key === 'quantization' && rest.trim() !== '') { out.quantization = strip(rest); sawField = true }
    else if (key === 'providers') {
      const flow = /^\[(.*)\]\s*$/.exec(rest.trim())
      if (flow !== null) {
        out.providers = flow[1].split(',').map(strip).filter((s) => s !== '')
        sawField = true
      } else if (rest.trim() === '') {
        const list: string[] = []
        for (let j = i + 1; j < body.length; j += 1) {
          const item = /^\s*-\s*(.*)$/.exec(body[j])
          if (item === null) break
          const value = strip(item[1])
          if (value !== '') list.push(value)
        }
        out.providers = list
        sawField = true
      }
    }
  }
  return sawField ? out : null
}

/**
 * Import the reference plugin's configuration on demand.
 *
 * Sources are probed in this order and the FIRST one carrying recognized fields
 * wins: the reference plugin's own document, its pre-1.0.5 workspace file, then
 * the retired settings document.
 */
export async function importLegacyOpenRouter(ctx: unknown): Promise<LegacyImportResult> {
  let workspaceRoot = ''
  try {
    const policy = (ctx as { get?: (name: string) => unknown })?.get?.('sandboxPolicy') as { workspaceRoot?: unknown } | undefined
    if (policy !== undefined && typeof policy.workspaceRoot === 'string') workspaceRoot = policy.workspaceRoot
  } catch { /* optional */ }

  const home = dshHome()
  const candidates: Array<{ path: string; kind: 'json' | 'yaml' }> = [
    { path: join(home, 'openrouter-providers.json'), kind: 'json' },
    ...(workspaceRoot !== '' ? [{ path: join(workspaceRoot, '.dsh-plugins', 'openrouter-providers.json'), kind: 'json' as const }] : []),
    { path: join(home, 'settings.yaml.imported'), kind: 'yaml' },
  ]

  const sources: LegacySourceResult[] = []
  for (const candidate of candidates) {
    let text: string
    try {
      text = await readTextFile(ctx, candidate.path)
    } catch (error) {
      const code = (error as { code?: string })?.code
      sources.push({ path: candidate.path, status: code === 'ENOENT' ? 'missing' : 'error', ...(code === 'ENOENT' ? {} : { detail: String((error as Error)?.message ?? error) }) })
      continue
    }
    if (candidate.kind === 'json') {
      let imported: Partial<OpenRouterState> = {}
      try {
        // Strip a UTF-8 BOM (Windows editors add one) before parsing.
        imported = pickRecognized(JSON.parse(text.replace(/^\uFEFF/, '')))
      } catch (error) {
        sources.push({ path: candidate.path, status: 'error', detail: `JSON 解析失败: ${String((error as Error)?.message ?? error)}` })
        continue
      }
      if (Object.keys(imported).length === 0) {
        sources.push({ path: candidate.path, status: 'empty' })
        continue
      }
      sources.push({ path: candidate.path, status: 'imported', detail: `识别到 ${Object.keys(imported).join(', ')}` })
      return { ok: true, imported, sources }
    }
    const section = sectionOfImportedSettings(text)
    if (section === null) {
      sources.push({ path: candidate.path, status: 'unsupported', detail: '未找到 openrouter-providers 段或其字段形状不可识别' })
      continue
    }
    sources.push({ path: candidate.path, status: 'imported', detail: `识别到 ${Object.keys(section).join(', ')}` })
    return { ok: true, imported: section, sources }
  }
  return { ok: false, sources, error: '未找到可导入的旧配置' }
}
