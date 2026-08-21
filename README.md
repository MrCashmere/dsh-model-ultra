# dsh-model-pro

[![npm version](https://img.shields.io/npm/v/dsh-model-pro.svg)](https://www.npmjs.com/package/dsh-model-pro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A dynamic Cordis plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) that provides a "Model Pro" settings page — a full lifecycle management UI for `llm-pi-ai` providers.

## Features

- **Provider CRUD** — create (guided 3-step wizard), edit, and delete providers with a clean, state-rail card list
- **Enable / Disable** — toggle providers on/off; disabled providers are moved to a `disabledProviders` dict and removed from the model selector
- **Field editing** — edit `baseURL`, `api` protocol, `apiKeyEnv`, and `displayName` per provider (Overview tab with a readiness checklist)
- **Custom HTTP headers** — add/edit/remove per-provider custom request headers (authorization/api-key are auto-filled by the adapter)
- **Remote model discovery** — one-click `GET /models` fetch with select-all / unselect-all / invert operations
- **Batch model write** — replace or merge selected models into a provider's explicit model list
- **Connectivity test** — a "Test" tab runs one tiny real inference through the provider's full credential/header/protocol pipeline and reports latency, stop reason and the reply, so you can verify a model actually works
- **No data loss on uninstall** — when this plugin itself is uninstalled or disabled, every disabled provider is automatically returned to the `providers` dict via the inverse of the disable operation, so model configs are never stranded in `disabledProviders` (a key only this plugin understands)

## How it works — uninstall safety

`disabledProviders` is a foreign key to `llm-pi-ai`'s settings schema: only this plugin reads and writes it. If the plugin were removed while providers sat disabled there, that data could be silently dropped by later `llm-pi-ai` writes. The host half therefore listens for its own `dispose` (uninstall / disable) event and runs the **inverse of the toggle operation**: every disabled provider — with its full profile of models, headers, and credentials untouched — is moved back into `providers`, where `llm-pi-ai` persists and resolves it. Enabled providers are unaffected. The result: no provider or model data is lost when this plugin goes away.

## Installation

### Via dsh CLI (recommended)

```sh
dsh plugin add wqy8593521/dsh-model-pro
```

Or install from npm (prebuilt, skips build approval):

```sh
dsh plugin add npm:dsh-model-pro
```

### Manual activation

This plugin can also run as a dynamic Cordis plugin inside a DSH session. Use `cordis_define` with the Host and Client halves from `dist/`, then `cordis_run` to activate.

### Build from source

```sh
git clone https://github.com/wqy8593521/dsh-model-pro.git
cd dsh-model-pro
npm install
npm run build      # outputs dist/host.js + dist/client.js
```

### Project structure

```
src/
├── shared/
│   ├── constants.ts          # NS, PROTOS, EDITABLE_FIELDS
│   └── types.ts              # shared TypeScript interfaces
├── host/
│   ├── index.ts              # apply(ctx) — registers all harness.handle
│   ├── utils.ts              # makeHostPlain, readProviders, writeSection
│   └── handlers/              # one file per RPC handler
│       ├── list.ts           # list-providers
│       ├── toggle.ts          # toggle-provider
│       ├── get.ts             # get-provider
│       ├── discover.ts        # discover-models
│       ├── create.ts          # create-provider
│       ├── delete.ts          # delete-provider
│       ├── updateField.ts     # update-field
│       ├── updateHeaders.ts   # update-headers
│       ├── applyModels.ts     # apply-models
│       └── test.ts            # test-provider (real mini-inference)
│   ├── lifecycle.ts           # dispose hook — restore disabled providers on unload
├── client/
│   ├── index.tsx             # apply(ctx) — registers settings.section Slot
│   ├── i18n.ts               # ZH / EN dictionaries
│   ├── styles.ts              # CSS string
│   ├── labels.ts              # proto labels / formatting helpers
│   ├── rpc.ts                 # call() wrapper
│   ├── react.ts               # React global shim
│   └── components/
│       ├── ModelProPage.tsx    # dashboard (segments + create + cards)
│       ├── ProviderCard.tsx    # state-rail provider card
│       ├── CreateForm.tsx      # guided 3-step create wizard
│       ├── ProviderEditor.tsx  # tabbed editor
│       ├── OverviewPanel.tsx   # info fields + readiness checklist
│       ├── HeadersPanel.tsx    # headers tab
│       ├── ModelsPanel.tsx     # models tab
│       └── TestPanel.tsx       # connectivity test tab
├── dist/                      # build output (gitignored)
│   ├── host.js
│   └── client.js
├── tsconfig.json
├── tsup.config.ts
└── package.json
```

## How it works

### Disable & uninstall-restore

Disabling a provider moves its entire config from `llm-pi-ai.providers` to `llm-pi-ai.disabledProviders`. The `llm-pi-ai` adapter only resolves providers in the `providers` dict, so disabled providers vanish from the model selector. schemastery's non-strict object resolver preserves the unknown `disabledProviders` key through settings validation.

Because `disabledProviders` is schema-foreign, the host listens for its own unload (`dispose`) — plugin uninstalled **or** disabled — and runs the inverse of the toggle: every disabled provider is returned to `providers` with its full profile intact. See [Features → No data loss on uninstall](#features).

### Connectivity test

The "Test" tab (or per-card "Test") calls the `test-provider` handler, which resolves one advertised model via `llm.listModels`, prepares a call through `llm.prepareCall` (using the provider's stored credentials/headers/protocol), streams a tiny completion, and returns latency, stop reason and the reply. A timeout (default 30 s) aborts the request. Disabled or uninstalled providers are rejected with guidance before any I/O.

### Cross-realm safety

The Host half uses a `makeHostPlain()` helper that recursively rebuilds all objects with `Object.create(null)` (null prototype), ensuring they pass the `dsh-settings` `isPlainObject` check across the vm sandbox realm boundary.

### Build system

TypeScript source is compiled with [tsup](https://tsup.egoist.dev/) (esbuild) into single-file IIFE bundles. Each output is a self-contained JS file with no `require`/`import` — ready for the Cordis sandbox.

| File | Description |
|------|-------------|
| `dist/host.js` | Host-side bundle (RPC handlers) |
| `dist/client.js` | Client-side bundle (Settings UI) |
| `cordis.patch.yml` | Cordis composition patch for `dsh plugin add` |
| `package.json` | npm package metadata with `dsh.bundle` manifest |

## Screenshots

The Model Pro settings page provides:

- **Dashboard**: segments (All / Enabled / Disabled) with counts, a guided 3-step create wizard, and state-rail cards (green = enabled, amber = disabled)
- **Editor**: Overview (fields + readiness checklist) / Headers / Models / Test tabs
- **Model discovery**: fetch remote models with select-all / unselect-all / invert and batch write
- **Connectivity test**: run a real tiny inference per model, with latency + reply

## License

MIT
