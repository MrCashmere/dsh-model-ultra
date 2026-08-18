/** RPC call wrapper — wraps host.call with error handling and type narrowing. */

import type { TFunc } from '../shared/types'

export function createCall(t: TFunc) {
  return async function call(method: string, payload?: Record<string, unknown>): Promise<any> {
    // `host` is injected as a closure parameter by the Cordis client runner.
    const r = await host.call(method, payload || {})
    if (r === null || typeof r !== 'object' || r.ok !== true) {
      const msg = (e: unknown): string =>
        typeof e === 'string'
          ? e
          : e && typeof e === 'object' && typeof (e as any).message === 'string'
            ? (e as any).message
            : ''
      throw new Error(msg(r && (r as any).error) || t('callFailed'))
    }
    return r
  }
}
