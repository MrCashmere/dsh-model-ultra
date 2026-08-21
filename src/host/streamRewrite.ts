/** Per-provider local model mapping ("select gpt-5.6-sol, forward
 * deepseek-v4-flash"). A provider model entry may carry `requestModel`; we
 * hook the `llm/stream` waterfall so every call whose selectable model id has a
 * `requestModel` forwards the WIRE id instead.
 *
 * The waterfall's `next` accepts a replaced request: `stream()` re-resolves the
 * call config from the given options (non-prepared path — how the agent loop
 * dispatches). We never mutate the (possibly deep-frozen) original; we build a
 * shallow copy with `model` swapped and call `next(mapped)`, else `next(options)`.
 */

import type { HostCtx } from './utils'
import { wireModelOf } from './utils'
import { ROUTER_ROUTE } from '../shared/constants'

export function registerStreamRewrite(ctx: HostCtx): void {
  const ctxAny = ctx as any
  if (typeof ctxAny.on !== 'function') return
  ctxAny.on('llm/stream', (options: Record<string, any>, next: (opts: Record<string, any>) => any) => {
    try {
      if (!options || typeof options !== 'object' || options.provider === ROUTER_ROUTE) return next(options)
      const wire = wireModelOf(ctx.get('settings'), options.provider, options.model)
      if (!wire || wire === options.model) return next(options)
      return next({ ...options, model: wire })
    } catch {
      return next(options)
    }
  })
}
