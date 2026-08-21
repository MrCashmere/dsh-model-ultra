/**
 * dsh-model-pro — Host half entry point (static-bundle mode).
 *
 * Mounts the `modelPro` Typert Remote service (the client's RPC surface) and
 * registers its manifest, then wires up smart-routing, composites, health
 * probing, observability, and the uninstall-restore safety net — through
 * Cordis `ctx` (there is no dynamic `harness` global in a static plugin).
 *
 * Static-mounted plugins export `apply` (+ optional `name` / `inject`); the
 * loader imports this module and calls apply(ctx).
 *
 * Disabled providers are moved to a separate `disabledProviders` dict so the
 * llm-pi-ai adapter (which only reads `providers`) stops registering them.
 * Because `disabledProviders` is a foreign key only this plugin understands,
 * the host also restores them to `providers` on unload — no model data is lost.
 */

import type { HostCtx } from './utils'
import { ModelProRuntime } from './service'
import { TYPERT_MANIFEST, PACKAGE } from '../shared/contract'
import { registerRouterAdapter } from './router'
import { registerStreamRewrite } from './streamRewrite'
import { restoreDisabledOnUnload, parkDisabledProviders } from './lifecycle'
import { initHealthTracker, resetHealthSingleton } from './health'
import { resetObservabilitySingletons } from './statsStore'

/** Loader entry id / client bundle id. */
export const name = PACKAGE

/** Hard dependency: the Typert registry must exist before we register. */
export const inject = ['typert']

export function apply(ctx: HostCtx) {
  const c = ctx as any

  // Mount the RPC service and register its strict manifest with the Gateway.
  new ModelProRuntime(ctx)
  c.effect(() => c.typert.register(TYPERT_MANIFEST), 'dsh-model-pro: typert manifest')

  // Rebind observability singletons to this fiber (fresh on each apply).
  resetHealthSingleton()
  resetObservabilitySingletons()
  initHealthTracker(ctx)

  // Smart routing: expose route combos + composites as models on the synthetic
  // "router" / "composite" routes, forwarding calls to real targets.
  registerRouterAdapter(ctx)
  // Per-provider local model mapping: select X, forward requestModel if set.
  registerStreamRewrite(ctx)

  // Reinstall recovery: parked providers keep their `disabled` marker, so on
  // startup re-park them into disabledProviders (adapter keeps ignoring them).
  parkDisabledProviders(ctx)?.catch?.(() => {})

  // Uninstall / disable safety net: restore disabled providers to `providers`
  // (marker travels with them) so nothing is lost when this plugin goes away.
  // We hook the fiber effect's cleanup — the same pattern dsh-settings uses.
  if (typeof c.effect === 'function') {
    c.effect(() => () => {
      try {
        return restoreDisabledOnUnload(ctx)
      } catch {
        return undefined
      }
    })
  }
}

export { apply as default }
