/**
 * dsh-model-ultra — Client half entry point (static-bundle mode).
 *
 * Exports a Cordis `apply(ctx)` that:
 *   - registers ZH/EN locale dictionaries,
 *   - injects the page CSS (no `styles` closure in static mode — we adopt a
 *     <style> element directly),
 *   - mounts the `modelUltra` Typert Remote service through the API Gateway
 *     (ctx.remote.$mount) and resolves its handle via resolveRemoteHandle, and
 *   - registers the settings.section Slot rendering ModelUltraPage.
 *
 * All data operations go through the mounted remote (see rpc.ts).
 */

import { CLIENT_NS, ZH, EN } from './i18n'
import { CSS } from './styles'
import { createCall } from './rpc'
import { resolveRemoteHandle } from './remote-handle'
import { ModelUltraPage } from './components/ModelUltraPage'
import { registerRouteBadge } from './components/RouteBadge'
import { INVOCATIONS, PACKAGE, SERVICE_KEY } from '../shared/contract'
import type { TFunc } from '../shared/types'
import React from './react'

/** Loader entry id / bundle id. */
export const name = PACKAGE

/** Client services this plugin reads. */
export const inject = ['slots', 'remote', 'locale']

const STYLE_ID = 'dsh-model-ultra-styles'

/** Inject the page CSS as an owned <style> element and return its disposer.
 * Static-bundle mode has no `styles` closure, so the element is adopted
 * directly; `data-plugin` marks it as ours (the client-module system claims
 * untagged plugin styles the same way during materialization), and the returned
 * disposer removes it on unload/reload so repeat mounts never stack rules. */
function adoptStyles(cssText: string): () => void {
  if (typeof document === 'undefined') return () => undefined
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => { try { existing.remove() } catch { /* ignore */ } }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.setAttribute('data-plugin', PACKAGE)
  style.textContent = cssText
  document.head.appendChild(style)
  return () => { try { style.remove() } catch { /* ignore */ } }
}

export function apply(ctx: any) {
  const locale = ctx.get('locale') ?? ctx.locale
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(CLIENT_NS, { zh: ZH, en: EN })
      } catch (_e) {
        // namespace already registered from a prior run — safe to ignore
      }
    }, 'dsh-model-ultra: dictionaries')
  }

  const t: TFunc = locale !== undefined ? locale.bind(CLIENT_NS) : (k: string) => k

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => adoptStyles(CSS), 'dsh-model-ultra: styles')
  } else {
    adoptStyles(CSS)
  }

  // Mount the remote service and resolve its handle. The handle appears as the
  // traceable property `remote.<SERVICE_KEY>` (and, on hosts that expose it,
  // through `reflect.get('remote.<SERVICE_KEY>')`) — resolveRemoteHandle covers
  // both projections and reports a missing namespace as undefined.
  let remote: Record<string, (args: unknown) => Promise<any>> | null = null
  ctx.effect(async () => {
    const dispose = await ctx.remote.$mount({ package: PACKAGE, descriptors: INVOCATIONS })
    const handle = resolveRemoteHandle<any>(ctx, SERVICE_KEY)
    if (handle === undefined) {
      throw new Error(`dsh-model-ultra: the ${SERVICE_KEY} Remote namespace did not mount`)
    }
    remote = handle
    return () => {
      remote = null
      void dispose()
    }
  }, 'dsh-model-ultra: remote')

  const call = createCall(t, () => remote)

  const slots = ctx.get('slots') ?? ctx.slots
  if (slots === undefined) return

  slots.inject('settings.section', () => {
    return slots.register(
      { name: 'settings.section', id: 'dsh-model-ultra', order: 12, label: () => t('nav') },
      () => React.createElement(ModelUltraPage, { t, call }),
    )
  })

  // Conversation badge: under each completed turn, show which provider/model
  // actually served it (smart routes + composites only). No-op on hosts that
  // don't declare the turnTail slot. The bound `t` is passed explicitly so the
  // badge never renders raw dictionary keys.
  registerRouteBadge(slots, call, t)
}

// NOTE: no `default` export here — the loader's unwrapExports prefers a
// default export and would swallow the `name`/`inject` named exports.

/** Test-only re-export: the smoke harness asserts the per-turn correlation
 * window (preciseWindowKey) and the list-seat owner gate (selectTurnSelection)
 * directly — both are pure and the badge's correctness hinges on them. */
export { preciseWindowKey, selectTurnSelection } from './components/RouteBadge'

/** Test-only re-export: the smoke harness drives all three Remote-handle
 * projections (traceable property, reflect fallback, neither) directly. */
export { resolveRemoteHandle, remoteServiceKey } from './remote-handle'
