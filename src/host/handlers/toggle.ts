/** toggle-provider handler — flips a provider between enabled and disabled.
 *
 * Disabling does two things:
 *  - sets this plugin's `disabled: true` marker ON THE PROFILE (source of
 *    truth that survives unload and is re-read after a reinstall), and
 *  - moves the profile into `disabledProviders` so the llm-pi-ai adapter
 *    (which only reads `providers`) stops resolving it as a model route.
 * Enabling is the inverse: clear the marker and move it back to `providers`.
 * A profile that still carries the marker while sitting in `providers` (e.g.
 * right after an unload-restore) is treated as disabled here too. */

import { readProviders, readDisabled, checkWritable, writeSection } from '../utils'
import type { HostCtx } from '../utils'

type ProfileLike = Record<string, unknown>

export async function toggleProvider(ctx: HostCtx, args: { route?: string; enabled?: boolean }) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }

  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const enabled = args?.enabled !== false
  const providers = readProviders(st)
  const disabled = readDisabled(st)

  if (
    !Object.prototype.hasOwnProperty.call(providers, route) &&
    !Object.prototype.hasOwnProperty.call(disabled, route)
  ) {
    return { ok: false as const, error: `提供商 "${route}" 不存在` }
  }

  const nextProviders: ProfileLike = {}
  const nextDisabled: ProfileLike = {}
  for (const k of Object.keys(providers)) nextProviders[k] = providers[k]
  for (const k of Object.keys(disabled)) nextDisabled[k] = disabled[k]

  const parked = Object.prototype.hasOwnProperty.call(disabled, route)
  const markedInProviders = !parked && (providers[route] as ProfileLike)?.disabled === true

  if (enabled) {
    // clear the marker wherever it lives, then make sure it sits in providers
    if (parked) {
      const profile: ProfileLike = {}
      for (const fk of Object.keys((nextDisabled[route] as ProfileLike))) profile[fk] = (nextDisabled[route] as ProfileLike)[fk]
      delete profile.disabled
      nextProviders[route] = profile
      delete nextDisabled[route]
    } else if (markedInProviders) {
      const profile: ProfileLike = {}
      for (const fk of Object.keys((nextProviders[route] as ProfileLike))) profile[fk] = (nextProviders[route] as ProfileLike)[fk]
      delete profile.disabled
      nextProviders[route] = profile
    }
  } else {
    // set the marker and park in disabledProviders
    if (Object.prototype.hasOwnProperty.call(nextProviders, route)) {
      const profile: ProfileLike = {}
      for (const fk of Object.keys((nextProviders[route] as ProfileLike))) profile[fk] = (nextProviders[route] as ProfileLike)[fk]
      profile.disabled = true
      nextDisabled[route] = profile
      delete nextProviders[route]
    }
  }

  try {
    await writeSection(st, nextProviders as any, nextDisabled as any)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }

  return { ok: true as const, route, enabled }
}
