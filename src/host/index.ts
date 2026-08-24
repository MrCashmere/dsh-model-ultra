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
import { resetObservabilitySingletons, hydrateObservability, persistStats } from './statsStore'

/** Loader entry id / client bundle id. */
export const name = PACKAGE

/** Hard dependencies. `typert` is the RPC registry we register into. `settings`
 * and `llm` gate WHEN apply runs: cordis parks the fiber until every declared
 * service exists (dsh-cordis-host-runner: "a valid unresolved inject may remain
 * pending"), so declaring them guarantees the reinstall re-park below reads a
 * MOUNTED settings service. Without them an early apply would call
 * `ctx.get('settings')` before it is mounted, read an empty section, and the
 * re-park of marked providers would silently no-op — leaving disabled-marked
 * providers sitting in `providers`, where llm-pi-ai's resolveProfiles registers
 * them as fully active routes again (the marker means nothing to it). */
export const inject = ['typert', 'settings', 'llm']

export function apply(ctx: HostCtx) {
  const c = ctx as any

  // Mount the RPC service and register its strict manifest with the Gateway.
  new ModelProRuntime(ctx)
  c.effect(() => c.typert.register(TYPERT_MANIFEST), 'dsh-model-pro: typert manifest')

  // Rebind observability singletons to this fiber (fresh on each apply).
  resetHealthSingleton()
  resetObservabilitySingletons()
  initHealthTracker(ctx)
  // Seed the stats recorder + request-log ring from the persisted snapshot so
  // the 观测台 and the conversation route badge are populated after a page
  // refresh / host restart instead of starting blank.
  hydrateObservability(ctx)

  // Debounced persistence of the stats aggregates + a capped request-log tail
  // onto the settings snapshot, so 输入/输出 token 统计 and the routing 尾标
  // survive a reload. A burst of routed calls costs at most one write per
  // interval (the recorder's dirty flag skips no-op flushes); a final flush
  // runs on unload.
  const timer = c.get('timer') as { interval?: (fn: () => void, ms: number) => () => void } | undefined
  if (timer && typeof timer.interval === 'function') {
    timer.interval(() => { void persistStats(ctx) }, 5000)
  }
  if (typeof c.effect === 'function') {
    c.effect(() => () => { void persistStats(ctx, { force: true }) }, 'dsh-model-pro: stats flush')
  }

  // Smart routing: expose route combos + composites as models on the synthetic
  // "router" / "composite" routes, forwarding calls to real targets.
  registerRouterAdapter(ctx)
  // Per-provider local model mapping: select X, forward requestModel if set.
  registerStreamRewrite(ctx)

  // Reinstall recovery: parked providers keep their `disabled` marker, so on
  // startup re-park them into disabledProviders (adapter keeps ignoring them).
  //
  // Two-phase, because load order is not guaranteed:
  //  1. eager attempt — works when pi-ai already registered its section;
  //  2. `settings/updated` re-park — dsh-settings emits this for the
  //     `llm-pi-ai` namespace when it first commits (pi-ai registering its
  //     section) and on every later write. If the eager attempt ran before
  //     that section resolved (model-pro loaded before pi-ai), this catches
  //     the marked providers as soon as they become readable and parks them.
  //
  // parkDisabledProviders is idempotent and writes only when a marked profile
  // actually moved, so re-firing on our own write settles after one pass.
  // The `unloading` flag stops the listener from fighting the
  // uninstall-restore: restore moves parked providers BACK into `providers`
  // (marker intact) and its write emits settings/updated — without the flag
  // this listener would immediately re-park them behind the safety net's back.
  let unloading = false
  const reparkOnSettings = () => {
    if (unloading) return
    void parkDisabledProviders(ctx)?.catch?.(() => {})
  }
  reparkOnSettings()
  if (typeof c.on === 'function' && typeof c.effect === 'function') {
    c.effect(() => {
      const off = c.on('settings/updated', (ns: string) => {
        try {
          if (ns !== 'llm-pi-ai') return
          reparkOnSettings()
        } catch { /* ignore */ }
      })
      return () => {
        try { off?.() } catch { /* ignore */ }
      }
    }, 'dsh-model-pro: reinstall re-park on settings/updated')
  } else {
    // Fallback for harness contexts without event plumbing: settle async.
    queueMicrotask(reparkOnSettings)
  }

  // Uninstall / disable safety net: restore disabled providers to `providers`
  // (marker travels with them) so nothing is lost when this plugin goes away.
  // We hook the fiber effect's cleanup — the same pattern dsh-settings uses.
  if (typeof c.effect === 'function') {
    c.effect(() => () => {
      unloading = true
      try {
        return restoreDisabledOnUnload(ctx)
      } catch {
        return undefined
      }
    })
  }
}
