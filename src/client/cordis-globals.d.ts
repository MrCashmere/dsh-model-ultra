/**
 * Ambient declarations for the DSH static-bundle CLIENT contract.
 *
 * In DSH 0.2.0-rc.1 (both the Web form and the Desktop form) the client half is
 * no longer evaluated with closure parameters — the old dynamic runner wrapped
 * the bundle as `new Function('React', 'styles', 'host', …)`, which is why this
 * file used to declare free `host` / `styles` identifiers. The client half is
 * now a CommonJS factory that the module loader registers before anything else
 * runs:
 *
 *   window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => … })
 *
 * `scripts/build.mjs` emits exactly that wrapper. Inside the factory the only
 * names available are:
 *   - the CommonJS `module`/`exports` pair the wrapper creates,
 *   - `require`, which resolves just the platform seed table (react,
 *     react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
 *     dsh-client-store, dsh-client-ui-slots, dsh-client-ui-primitives,
 *     dsh-client-ui-dockkit),
 *   - the Cordis client context this plugin is mounted with.
 *
 * Everything else is bundled in. In particular there is NO `styles` and NO
 * `host`: the plugin injects its own owned `<style>` element
 * (`adoptStyles`) and reaches the Host half only through the `remote` service
 * (`ctx.remote.$mount`). Anything that referenced those old closures would
 * throw a ReferenceError at runtime.
 */

/** One bundle registration accepted by the web boot protocol. */
declare interface DshModuleLoaderRegistration {
  /** Package name — must equal the plugin's declared entry id. */
  id: string
  /** CommonJS factory; `require` resolves only the platform seed table. */
  factory: (require: (specifier: string) => unknown) => unknown
}

/** The registration facade the Host injects as `window.__ModuleLoader__`. */
declare interface DshModuleLoader {
  load(registration: DshModuleLoaderRegistration): void
  /** Optional loader capabilities used by DSH's own client modules. */
  readonly version?: string
}

interface Window {
  __ModuleLoader__: DshModuleLoader
}
