/** test-provider handler — runs a tiny real inference through the provider's
 * configured pipeline (credentials, headers, protocol) via `llm.prepareCall`,
 * so the user can verify a model actually works before relying on it.
 *
 * Runs inside the DSH dynamic-plugin Host sandbox, which withholds the
 * Node/Web globals `setTimeout` / `clearTimeout` / `AbortController` (they
 * are not ECMAScript builtins and the vm realm lacks them). Deadlines are
 * therefore implemented with the cordis `timer` service — read via
 * `ctx.get('timer')`, no `inject` needed — and the whole call is raced
 * against a hard deadline with `Promise.race`. */

import type { HostCtx } from '../utils'
import { readProviders, readDisabled } from '../utils'

const DEFAULT_TIMEOUT_MS = 30000

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : DEFAULT_TIMEOUT_MS))

/**
 * Normalize a `finish` chunk's `reason` into either a stop reason or a hard
 * error. DSH's llm service reports the reason as an OBJECT, not a string:
 *   success → `{ kind: 'stop' }` (kind is the stop-reason string)
 *   failure → `{ kind: 'error', failure: { message, code } }`
 * (strings are accepted too, for backwards-compatible mocks/adapters.)
 */
function finishReason(reason: unknown): { ok: true; stop: string } | { ok: false; error: string } {
  if (reason === null || reason === undefined) return { ok: true as const, stop: '' }
  if (typeof reason === 'string') return { ok: true as const, stop: reason }
  if (typeof reason === 'object') {
    const r = reason as { kind?: unknown; failure?: { message?: unknown }; message?: unknown }
    if (r.kind === 'error') {
      const msg = (r.failure && typeof r.failure.message === 'string' && r.failure.message)
        || (typeof r.message === 'string' && r.message)
        || '模型调用失败'
      return { ok: false as const, error: msg }
    }
    if (typeof r.kind === 'string' && r.kind.length > 0) return { ok: true as const, stop: r.kind }
  }
  return { ok: true as const, stop: '' }
}

export async function testProvider(ctx: HostCtx, args: {
  route?: string
  model?: string
  prompt?: string
  maxTokens?: number
  timeoutMs?: number
}) {
  const llm = ctx.get('llm')
  if (llm === undefined) return { ok: false as const, error: 'llm 服务不可用' }

  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const st = ctx.get('settings')
  const providers = readProviders(st)
  const disabled = readDisabled(st)
  if (Object.prototype.hasOwnProperty.call(disabled, route))
    return { ok: false as const, error: `提供商 "${route}" 已禁用，请先启用后再测试` }
  if (!Object.prototype.hasOwnProperty.call(providers, route))
    return { ok: false as const, error: `提供商 "${route}" 不存在或未启用` }

  // Resolve which model to test. The provider's advertised list is advisory;
  // an explicit id the user typed is still passed through so the adapter's own
  // error (if any) surfaces with a clear message.
  let model = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : ''
  let knownModels: Array<{ id: string }> = []
  try {
    const m = await (llm as any).listModels(route)
    if (Array.isArray(m)) knownModels = m
  } catch { /* advisory only */ }

  if (!model && knownModels.length) model = knownModels[0].id
  if (!model)
    return { ok: false as const, error: '没有可测试的模型：请先在「模型」页添加模型，或指定要测试的模型 ID' }

  const timeoutMs = clamp(args?.timeoutMs || DEFAULT_TIMEOUT_MS, 1000, 120000)
  const timer = ctx.get('timer') as { timeout: (fn: () => void, ms: number) => () => void } | undefined
  const t0 = Date.now()
  let reply = ''
  let stopReason = ''
  let sawFinish = false

  // Hard deadline via the cordis timer service. When no timer is mounted we
  // still proceed — the call simply runs without a wall-clock cap.
  let cancelDeadline: (() => void) | undefined
  const deadline = new Promise<never>((_, reject) => {
    if (timer) cancelDeadline = timer.timeout(() => reject(new Error(`请求超时（${timeoutMs}ms）`)), timeoutMs)
  })

  // Consume the tiny stream. A no-op catch swallows a late failure in case the
  // deadline already won the race, so the process never sees an unhandled
  // rejection while the orphaned call drains in the background.
  const run = (async () => {
    const prepared = await (llm as any).prepareCall(
      { provider: route, model, maxTokens: 16, temperature: 0 },
    )
    const prompt = (typeof args?.prompt === 'string' && args.prompt.trim()) || 'ping：请只回复 pong'
    const stream = prepared.stream({
      provider: route,
      model,
      // DSH's llm pipeline expects content as typed blocks (adapters call
      // content.some(...) on it); a plain string makes them throw.
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 0,
      maxTokens: typeof args?.maxTokens === 'number' ? clamp(args.maxTokens, 1, 1024) : 16,
    })

    for await (const chunk of stream as any) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
      else if (chunk.type === 'finish') {
        const parsed = finishReason(chunk.reason)
        if (!parsed.ok) throw new Error(parsed.error)
        stopReason = parsed.stop
        sawFinish = true
      }
    }

    return {
      ok: true as const,
      model,
      latencyMs: Date.now() - t0,
      stopReason: stopReason || (sawFinish ? 'stop' : 'unknown'),
      reply: reply.trim() || '(空回复)',
      truncated: typeof args?.maxTokens === 'number' && reply.length > (args.maxTokens * 2),
    }
  })()

  run.catch(() => { /* swallow late rejection after a deadline win */ })

  try {
    return await Promise.race([run, deadline])
  } catch (err) {
    const msg = String((err as Error)?.message || err)
    return { ok: false as const, model, error: msg }
  } finally {
    if (typeof cancelDeadline === 'function') cancelDeadline()
  }
}
