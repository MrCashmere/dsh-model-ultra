# Changelog

## 1.1.5 — 2026-08-22

- feat: add custom model management and search functionality in ModelsPanel

## 1.1.4 — 2026-08-21

- fix: drop default export so loader keeps name/inject named exports
- refactor: convert to static bundle plugin (Typert Remote RPC)

## 1.1.3 — 2026-08-21

- fix: mount loader row under package name, not display label
- docs: fix install instructions — use npm: prefix; document git-source allowBuilds

## 1.1.2 — 2026-08-21

- chore: auto-generate CHANGELOG in release script; backfill 1.1.1 notes

## 1.1.1 — 2026-08-21

- **Smart routing** — named routes aggregating multiple providers' models with 5
  strategies (priority / weighted / round-robin / min-latency / sticky),
  per-target weights and enable switches, `healthAware` dispatch, session
  pinning, `maxFallbacks`, and per-target timeout
- **Composite providers** — merge several providers' models into one virtual
  provider with union / intersection modes (`composite / name::model`)
- **Observability & probing** — per-target live health probes (up / down /
  probing + consecutive-fail tracking) and a session-scoped request log with
  by-route / by-target stats (calls, success rate, avg latency, tokens)
- **Encrypted API keys** — paste a key in the GUI; stored AES-256-GCM encrypted
  at rest with the master key held in the DSH credentials service (never
  regenerated, so old ciphertext still decrypts after reinstall)
- **Local wire-name mapping** — forward a mapped model name to the provider via
  the stream-rewrite adapter
- **Automated release** — `prepare` + `prepublishOnly` build hooks and
  `scripts/release.mjs` one-command release; CI now builds, tests, and verifies
  `dist/` is inside the npm tarball before publishing (fixes the missing-entry
  artifact that broke 1.0.x installs)
- **Docs** — rewritten bilingual README with features, screenshots, usage, and
  install / uninstall guides

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
