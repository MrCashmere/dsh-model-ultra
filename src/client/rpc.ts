/** RPC call facade — routes kebab method names to the mounted `modelPro`
 * Typert Remote service. Static-bundle mode has no `host.call`; instead the
 * client mounts INVOCATIONS through the API Gateway and invokes
 * `remote.modelPro.<camelMethod>(args)`. The Gateway wraps the result in its
 * own `{ ok, value }` envelope; the business handlers wrap theirs in
 * `{ ok, ... }`. This facade unwraps both and preserves the previous
 * `call(method, payload) -> businessEnvelope` contract every component expects.
 */

import type { TFunc } from '../shared/types'
import { METHOD_MAP } from '../shared/contract'

type RemoteLike = Record<string, (args: unknown) => Promise<any>>

const msgOf = (e: unknown): string =>
  typeof e === 'string'
    ? e
    : e && typeof e === 'object' && typeof (e as any).message === 'string'
      ? (e as any).message
      : ''

export function createCall(t: TFunc, getRemote: () => RemoteLike | null) {
  return async function call(method: string, payload?: Record<string, unknown>): Promise<any> {
    const remote = getRemote()
    if (remote === null) throw new Error(t('callFailed'))
    const remoteMethod = METHOD_MAP[method]
    if (remoteMethod === undefined) throw new Error(`unknown method: ${method}`)

    // Gateway transport envelope: { ok, value } | { ok: false, error }.
    const r = await remote[remoteMethod](payload || {})
    if (r === null || typeof r !== 'object' || (r as any).ok !== true) {
      throw new Error(msgOf(r && (r as any).error) || t('callFailed'))
    }
    // Business envelope (what the handlers returned).
    const value = (r as any).value
    if (value === null || typeof value !== 'object' || value.ok !== true) {
      throw new Error(msgOf(value && value.error) || t('callFailed'))
    }
    return value
  }
}
