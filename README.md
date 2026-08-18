# dsh-model-pro

[![npm version](https://img.shields.io/npm/v/dsh-model-pro.svg)](https://www.npmjs.com/package/dsh-model-pro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A dynamic Cordis plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) that provides a "Model Pro" settings page — a full lifecycle management UI for `llm-pi-ai` providers.

## Features

- **Provider CRUD** — create, delete, and edit providers with a clean card-based list view
- **Enable / Disable** — toggle providers on/off; disabled providers are moved to a `disabledProviders` dict and removed from the model selector
- **Field editing** — edit `baseURL`, `api` protocol, `apiKeyEnv`, and `displayName` per provider
- **Custom HTTP headers** — add/edit/remove per-provider custom request headers (authorization/api-key are auto-filled by the adapter)
- **Remote model discovery** — one-click `GET /models` fetch with select-all / unselect-all / invert operations
- **Batch model write** — replace or merge selected models into a provider's explicit model list

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
│       └── applyModels.ts     # apply-models
├── client/
│   ├── index.tsx             # apply(ctx) — registers settings.section Slot
│   ├── i18n.ts               # ZH / EN dictionaries
│   ├── styles.ts              # CSS string
│   ├── rpc.ts                 # call() wrapper
│   ├── react.ts               # React global shim
│   └── components/
│       ├── ModelProPage.tsx    # list view
│       ├── ProviderCard.tsx    # provider card
│       ├── CreateForm.tsx      # new-provider form
│       ├── ProviderEditor.tsx  # tabbed editor
│       ├── InfoPanel.tsx       # info tab
│       ├── HeadersPanel.tsx    # headers tab
│       └── ModelsPanel.tsx     # models tab
├── dist/                      # build output (gitignored)
│   ├── host.js
│   └── client.js
├── tsconfig.json
├── tsup.config.ts
└── package.json
```

## How it works

### Disable mechanism

Disabling a provider moves its entire config from `llm-pi-ai.providers` to `llm-pi-ai.disabledProviders`. The `llm-pi-ai` adapter only resolves providers in the `providers` dict, so disabled providers vanish from the model selector. schemastery's non-strict object resolver preserves the unknown `disabledProviders` key through settings validation.

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

- **List view**: provider cards with status dots (active/disabled/catalog), type tags, and inline actions (edit/enable/disable/delete)
- **Editor view**: tabbed interface with Info / Headers / Models panels
- **Model discovery**: fetch remote models with select-all / unselect-all / invert and batch write

## License

MIT
