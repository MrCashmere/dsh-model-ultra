/**
 * dsh-model-pro — Host half lifecycle hooks.
 *
 * restoreDisabledOnUnload: the inverse of the disable (toggle) operation, run
 * when the plugin is unloaded — i.e. when it is uninstalled or disabled. Every
 * provider parked in `disabledProviders` is moved back into `providers` with
 * its full original profile untouched, so the data lives where llm-pi-ai
 * actually persists and resolves it. `disabledProviders` is a foreign key to
 * llm-pi-ai's schema — only this plugin understands it — so without this the
 * disabled providers (models included) would be silently lost the moment this
 * plugin is removed. Restoring is the "no data lost on uninstall" guarantee.
 */

import type { HostCtx } from './utils'
import { readProviders, readDisabled, checkWritable, writeSection } from './utils'

export async function restoreDisabledOnUnload(ctx: HostCtx) {
  const st = ctx.get('settings')
  if (st === undefined) return { restored: 0, skipped: 0 }
  if (!checkWritable(st)) return { restored: 0, skipped: 0 }

  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const disabledRoutes = Object.keys(disabled)
  if (disabledRoutes.length === 0) return { restored: 0, skipped: 0 }

  const nextProviders: Record<string, unknown> = {}
  const nextDisabled: Record<string, unknown> = {}
  let restored = 0
  let skipped = 0

  for (const k of Object.keys(providers)) nextProviders[k] = (providers as any)[k]
  for (const k of Object.keys(disabled)) nextDisabled[k] = (disabled as any)[k]

  for (const route of disabledRoutes) {
    if (Object.prototype.hasOwnProperty.call(nextProviders, route)) {
      // Defensive: never clobber a provider that is already active. Its data is safe.
      skipped += 1
      continue
    }
    // The whole original profile moves back untouched — models, headers, credentials.
    nextProviders[route] = disabled[route]
    delete nextDisabled[route]
    restored += 1
  }

  if (restored === 0) return { restored: 0, skipped }

  try {
    await writeSection(st, nextProviders as any, nextDisabled as any)
  } catch (err) {
    try {
      ;(ctx.get('logger') as any)?.warn?.(`dsh-model-pro: 卸载还原失败 — ${String((err as Error)?.message || err)}`)
    } catch { /* ignore */ }
    return { restored: 0, skipped }
  }

  return { restored, skipped }
}
