/**
 * Resolve the mounted Remote namespace handle after `remote.$mount()`.
 *
 * The API Gateway installs each namespace as the cordis service
 * `remote.<namespace>` (api-gateway `remoteServiceKey()`), which upstream
 * clients reach as `ctx.remote.<namespace>` — the gateway's own specs use that
 * form. cordis resolves it through the service's traceable proxy
 * (`utils.ts createTraceable()`: `reflect.props["remote.<ns>"]` forwards the
 * property read to the context), and the same key is readable directly as
 * `ctx.reflect.get("remote.<namespace>")`.
 *
 * Both projections exist in 0.2.0-rc.1, so prefer the idiomatic property and
 * keep the reflect lookup as a fallback for hosts exposing only that one. A
 * namespace that is not mounted yields `undefined` either way; an inactive
 * fiber can make the property read throw, which is also not an error here —
 * the caller reports the missing namespace itself.
 */

/** The Remote service key a plugin's namespace mounts under. */
export function remoteServiceKey(namespace: string): string {
  return `remote.${namespace}`
}

/**
 * Read the mounted namespace handle.
 * @param ctx - client plugin context carrying the `remote` service.
 * @param namespace - wire namespace mounted by `remote.$mount()`.
 * @returns the namespace handle, or `undefined` when it is not mounted.
 */
export function resolveRemoteHandle<T = unknown>(
  ctx: any,
  namespace: string,
): T | undefined {
  const remote = ctx?.remote
  const key = remoteServiceKey(namespace)
  if (remote !== undefined && remote !== null && typeof remote === 'object') {
    try {
      const handle = (remote as Record<string, unknown>)[namespace]
      if (handle !== undefined && handle !== null) return handle as T
    } catch {
      /* an inactive/unnamed projection throws — fall through to reflect */
    }
  }
  try {
    const reflect = ctx?.reflect
    if (reflect !== undefined && typeof reflect.get === 'function') {
      const handle = reflect.get(key) as T | undefined
      if (handle !== undefined && handle !== null) return handle
    }
  } catch {
    /* no reflect service on this host */
  }
  return undefined
}
