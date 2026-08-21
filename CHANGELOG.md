# Changelog

## 1.1.0

- **Connectivity test** — new "Test" tab (and per-card Test button) runs a tiny
  real inference through the provider's full credential/header/protocol pipeline
  via `llm.prepareCall`, reporting latency, stop reason and the reply, with a
  configurable timeout and clear errors for disabled/unconfigured providers
- **Uninstall safety (no data loss)** — the host listens for its own `dispose`
  event (plugin uninstalled or disabled) and runs the inverse of disable:
  every provider in `disabledProviders` is moved back to `providers` with its
  full profile (models, headers, credentials) untouched, so model data is never
  stranded in the schema-foreign `disabledProviders` key
- **Redesigned UX** — dashboard with All/Enabled/Disabled segments (counts),
  state-rail provider cards with status pills and config chips, a guided 3-step
  create wizard with inline validation and "Create & test", an Overview tab with
  a readiness checklist, and a cleaned-up Models tab (discovery bar + bulk
  apply)
- Friendly protocol labels, mono type for route/baseURL/model ids, responsive
  layout, reduced-motion support

## 1.0.0

- Provider CRUD: create, delete, edit with card-based list UI
- Enable/disable via `disabledProviders` dict (removes from model selector)
- Per-provider custom HTTP headers editor
- Remote model discovery with select-all / unselect-all / invert
- Batch model write (replace / merge modes)
- Tabbed editor: Info / Headers / Models
- Cross-realm safe via `makeHostPlain` (null-proto objects)
