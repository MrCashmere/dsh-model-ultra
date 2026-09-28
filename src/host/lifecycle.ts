/**
 * dsh-model-ultra — Host half lifecycle hooks.
 *
 * restoreDisabledOnUnload: the inverse of the disable (toggle) operation, run
 * when the plugin is unloaded — i.e. when it is uninstalled or disabled. Every
 * provider parked in `disabledProviders` is moved back into `providers` with
 * its full original profile untouched, so the data lives where llm-pi-ai
 * actually persists and resolves it. `disabledProviders` is this plugin's own
 * settings state (the `dsh-model-ultra` entry), unknown to llm-pi-ai — so without
 * this the disabled providers (models included) would be silently lost the
 * moment this plugin is removed. Restoring is the "no data lost on uninstall"
 * guarantee.
 */

import type { HostCtx } from './utils'
import { readProviders, readDisabled, checkWritable, writeSection } from './utils'

/**
 * On unload (uninstall / disable of this plugin): every parked provider is
 * moved back into `providers` with its full original profile UNTOUCHED — this
 * plugin's `disabled: true` marker travels with it. The adapter stops caring
 * once the plugin is gone, but the marker is what lets a REINSTALL land in the
 * same disabled state (see parkDisabledProviders). `disabledProviders` is only
 * ever the operational parking slot, never the source of truth.
 */
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
      // `logger` is a Cordis context property, not a service: ctx.get('logger')
      // returns undefined.
      ctx.logger?.warn?.(`dsh-model-ultra: 卸载还原失败 — ${String((err as Error)?.message || err)}`)
    } catch { /* ignore */ }
    return { restored: 0, skipped }
  }

  return { restored, skipped }
}

/**
 * On plugin startup: scan `providers` for profiles carrying the `disabled`
 * marker (left there by a previous unload-restore) and re-park them into
 * `disabledProviders`. The marker is the source of truth; `disabledProviders`
 * is just the parking the llm-pi-ai adapter expects.  This is what makes a
 * reinstall land in exactly the same disabled state as before the unload.
 */
export async function parkDisabledProviders(ctx: HostCtx) {
  const st = ctx.get('settings')
  if (st === undefined) return { parked: 0 }
  if (!checkWritable(st)) return { parked: 0 }

  const providers = readProviders(st)
  const marked = Object.keys(providers).filter((r) => (providers as any)[r] && (providers as any)[r].disabled === true)
  if (marked.length === 0) return { parked: 0 }

  const disabled = readDisabled(st)
  const nextProviders: Record<string, unknown> = {}
  const nextDisabled: Record<string, unknown> = {}
  for (const k of Object.keys(providers)) nextProviders[k] = (providers as any)[k]
  for (const k of Object.keys(disabled)) nextDisabled[k] = (disabled as any)[k]

  let parked = 0
  for (const r of marked) {
    nextDisabled[r] = nextProviders[r]
    delete nextProviders[r]
    parked += 1
  }

  try {
    await writeSection(st, nextProviders as any, nextDisabled as any)
  } catch {
    return { parked: 0 }
  }
  return { parked }
}
