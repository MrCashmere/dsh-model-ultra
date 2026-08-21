/**
 * dsh-model-pro — Host half entry point.
 *
 * Registers all harness.handle() RPC handlers that the Client half calls
 * via host.call(). Each handler is in its own file under handlers/.
 *
 * Key design: disabled providers are moved to a separate `disabledProviders`
 * dict so the llm-pi-ai adapter (which only reads `providers`) stops
 * registering them as model routes. Because `disabledProviders` is a foreign
 * key only this plugin understands, the host also listens for its own unload
 * (uninstall / disable) and runs the inverse operation — restoring every
 * disabled provider back into `providers` — so no model data is lost when
 * this plugin is removed.
 */

import type { HostCtx } from './utils'
import { listProviders } from './handlers/list'
import { toggleProvider } from './handlers/toggle'
import { getProvider } from './handlers/get'
import { discoverModels } from './handlers/discover'
import { createProvider } from './handlers/create'
import { deleteProvider } from './handlers/delete'
import { updateField } from './handlers/updateField'
import { updateHeaders } from './handlers/updateHeaders'
import { applyModels } from './handlers/applyModels'
import { testProvider } from './handlers/test'
import { restoreDisabledOnUnload } from './lifecycle'

export function apply(ctx: HostCtx) {
  // The harness global is provided by the Cordis sandbox at runtime.
  const h = (globalThis as any).harness

  h.handle('list-providers', async () => listProviders(ctx))
  h.handle('toggle-provider', async (args: any) => toggleProvider(ctx, args))
  h.handle('get-provider', async (args: any) => getProvider(ctx, args))
  h.handle('discover-models', async (args: any) => discoverModels(ctx, args))
  h.handle('create-provider', async (args: any) => createProvider(ctx, args))
  h.handle('delete-provider', async (args: any) => deleteProvider(ctx, args))
  h.handle('update-field', async (args: any) => updateField(ctx, args))
  h.handle('update-headers', async (args: any) => updateHeaders(ctx, args))
  h.handle('apply-models', async (args: any) => applyModels(ctx, args))
  h.handle('test-provider', async (args: any) => testProvider(ctx, args))

  // Uninstall / disable safety net: restore disabled providers to `providers`
  // so nothing is lost when this plugin goes away. cordis has no public
  // "dispose" event here, so we hook the fiber effect's cleanup — the same
  // pattern dsh-settings uses for unload cleanup.
  const ctxAny = ctx as any
  if (typeof ctxAny.effect === 'function') {
    ctxAny.effect(() => () => {
      try {
        return restoreDisabledOnUnload(ctx)
      } catch {
        return undefined
      }
    })
  }
}

export { apply as default }
