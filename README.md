# dsh-model-pro

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

This plugin can also run as a dynamic Cordis plugin inside a DSH session. Use `cordis_define` with the Host and Client halves, then `cordis_run` to activate.

### Host half

The `host.js` file contains the Host-side plugin code that registers `harness.handle` RPC handlers for all provider operations.

### Client half

The `client.js` file contains the Client-side plugin code that registers a `settings.section` Slot rendering the Model Pro settings page.

## How it works

### Disable mechanism

Disabling a provider moves its entire config from `llm-pi-ai.providers` to `llm-pi-ai.disabledProviders`. The `llm-pi-ai` adapter only resolves providers in the `providers` dict, so disabled providers vanish from the model selector. schemastery's non-strict object resolver preserves the unknown `disabledProviders` key through settings validation.

### Cross-realm safety

The Host half uses a `makeHostPlain()` helper that recursively rebuilds all objects with `Object.create(null)` (null prototype), ensuring they pass the `dsh-settings` `isPlainObject` check across the vm sandbox realm boundary.

## Files

| File | Description |
|------|-------------|
| `host.js` | Host-side plugin code (RPC handlers) |
| `client.js` | Client-side plugin code (Settings UI) |

## License

MIT
