# Changelog

## 2.0.0 — 2026-09-29

**重命名：`dsh-model-pro` → `dsh-model-ultra`（显示名「模型 Pro」→「模型 Ultra」）**

- break!: 包名 `dsh-model-pro` → **`dsh-model-ultra`**；设置页本地化标题改为「模型 Ultra」/ `Model Ultra`，
  描述同步更新（思考强度、OpenRouter 已并入描述）。旧安装不会自动接管：请卸载旧包后重新安装新包。
- break!: 入口 id 与设置条目 `dsh-model-pro` → **`dsh-model-ultra`**（`cordis.patch.yml`），因此
  `disabledProviders` / `routes` / `composites` / `routeStats` / `uiPrefs` / `openrouter` 的存放位置随之改变；
  客户端 bundle id、`settings.dsh-model-ultra` 命名空间、UI 偏好存储键同步更名。
- refactor: 远程服务命名空间 `modelPro` → **`modelUltra`**，类型/组件随之更名
  （`ModelUltraRuntime`、`ModelUltraPage`、`ModelUltraCtx`）。
- refactor: 构建期不再硬编码包名——`scripts/build.mjs` 与 `__ModuleLoader__` 包装步骤都从
  `package.json` 读取 `name`，避免再次更名时漏改。
- docs: README 全面重写（目录、兼容性、逐项功能、安装/卸载、快速上手、原理、项目结构、开发与验证、排错、
  致谢与许可），并移除所有本地绝对路径示例。
- meta: 仓库地址指向 `MrCashmere/dsh-model-ultra`；`author` 保留原作者署名，LICENSE 追加本项目版权行。
- 保留：界面 CSS 类前缀 `mpro-`（纯内部样式作用域）与内部超时哨兵 `__mpro_attempt_timeout__`，不参与
  持久化与对外契约，故未随更名调整。

## 1.3.0 — 2026-09-29

新增两块能力：**逐模型思考强度编辑**与 **OpenRouter 提供商路由（移植 `dsh-openrouter-providers` 全部功能）**。
RPC 由 25 个增加到 **30 个**，插件设置条目新增一个 volatile 状态键 `openrouter`。

**思考强度（Thinking effort）**
- feat(thinking): 「思考强度」新页签。**路由级**编辑 `reasoning`（默认等级）、`thinkingBudgets`
  （minimal/low/medium/high 四个 token 预算）与思考相关 `compat`（`thinkingFormat`、
  `thinkingTokenBudgetField`、`supportsReasoningEffort`、`supportsThinkingTokenBudget`、
  `requiresThinkingAsText`、`forceAdaptiveThinking`），三态下拉的「继承」= 不写该字段。
- feat(thinking): **逐模型**编辑 `reasoningEfforts`——每个档位一个勾选 + **手动填写线上取值**的文本框，
  另附每个档位的**预设值按钮**与整表**一键预设**（两档 / 四档 / 五档 / 全七档 / 非推理）。显式 `models`
  列表的提供商写回 `models[i]`；**内置目录路由写 `modelOverrides[id]`，绝不把目录收窄成 `models` 列表**。
- fix(thinking): 归一化同时实施 llm-pi-ai `resolveModelReasoning()` 自己的解析规则（该规则不在 schema 里）：
  只有 `off` 档可以留空（`off:` → `null`），其余档位必须有线上取值、不得为空串；`{off: null}` 单独一项
  非法（非推理请用 `false`）；空对象按「删除=继承目录」处理而不是写入空字典。这样页面上永远无法保存
  一个 DSH 解析时会报错的配置。
- fix(thinking): 未知档位键、部分填写的 `thinkingBudgets`、路由级/模型级字段混用都会返回具名错误，
  被拒绝的补丁不会落到配置里。

**OpenRouter 提供商路由（对齐 `dsh-openrouter-providers` v1.3.0）**
- feat(openrouter): 新「OpenRouter」页签：总开关、路由模式（`only` / `order`）、提供商 slug 列表
  （每行一个，兼容换行 / 逗号 / 中文逗号 / 分号等分隔）、量化位数限制（12 级 + 不限制）、
  生效主机列表、应用归属头开关与 `X-OpenRouter-Title`；保存 / 撤销 / 未保存标记 / 自检读数（塑形器状态、
  计数、将写入的 `provider` 对象）。
- feat(openrouter): 注入实现为 **`globalThis.fetch` 塑形器**：只改「配置主机 + POST/PUT/PATCH + JSON 且含
  `model`」的请求体，把 `provider.only` / `provider.order` / `provider.quantizations` **合并**进已有的
  `provider` 对象（参考实现是整体替换，这里更保守），并补发 `HTTP-Referer` / `X-OpenRouter-Title` /
  `X-OpenRouter-Categories`。任何异常（解析失败、未知 init 形状、无状态）都原样放行、绝不抛给调用方；
  `dispose()` 仅在仍是自己时还原全局 `fetch`，插件卸载后立即失效。
- feat(openrouter): 状态**每次请求实时读取**（不缓存），改完即对下一次请求生效，无需重启。
- feat(openrouter): 「导入旧插件配置」按钮：按 `$DSH_HOME/openrouter-providers.json` →
  `<workspaceRoot>/.dsh-plugins/openrouter-providers.json` → `$DSH_HOME/settings.yaml.imported` 顺序探测，
  第一个含可识别字段的源生效，结果逐源报告（imported / empty / missing / error / unsupported）。
- 与参考插件的**有意差异**：① 不再复刻 `node -e` 子进程 SSE 桥（`0.2.0-rc.1` 的 pi-ai 已原生支持
  OpenRouter，旧桥只是因为早期动态插件沙箱没有 `fetch`）；② 不再把 `OPENROUTER_API_KEY` 写进
  `env`；③ `provider` 对象为合并语义；④ 总开关关闭时**同时不发归属头**（关掉就是完全不碰流量）。
- feat(host): 新增 5 个 RPC：`set-thinking`、`get-openrouter`、`set-openrouter`、`import-openrouter`、
  `openrouter-selftest`；`get-provider` 增补 `reasoning` / `thinkingBudgets` / `compat` / `modelOverrides`。

**文档与测试**
- test: `tests/host.smoke.mjs` 新增思考强度（路由级 / `models` / `modelOverrides` / 归一化拒绝路径）与
  OpenRouter（状态、两种模式、量化、归属头、惰性、遗留导入 JSON + YAML、自检、卸载还原 `fetch`）用例；
  用例经 manifest 的调用 id 驱动，覆盖 30 个方法。
- test: `tests/client.smoke.mjs` 渲染并驱动两个新页签，断言保存时发出的 RPC 载荷。
- test: 新增 `.tools/verify/verify-openrouter-injection.mjs`（真实 `openai@6.40.0` SDK + 本地 SSE 端点：
  构造时机捕获、`only/order` 极性、量化、归属头、流式透明、惰性态逐字节不变、卸载还原）与
  `.tools/verify/verify-thinking-schema.mjs`（用运行时树里真实的 `@deepseek-ai/dsh-llm-pi-ai` `Config`
  校验页面写出的 profile，并断言 schema 无法表达的解析规则仍存在于编译产物中）。

## 1.2.0 — 2026-09-20

适配 **DeepSeek Harness `0.2.0-rc.1`**（含 **Desktop 桌面形态**）。下列「BREAKING/适配」条目都是
`0.2.0-rc.1` 的契约变更所致，旧版 DSH 不再受支持。

**BREAKING / 契约适配**
- fix(typert)!: 严格编解码器改为 `{ mode: 'strict', typeSymbol, create() }`（旧 `schema:` 字段会让注册抛出
  `typert: <subject> strict codec has no create() factory`）；manifest 同时更新为 25 个方法。
- fix(settings)!: `settings` 服务不再提供 `get(ns)`。改为 `describe()` 读取，且**读 `user`（原始配置）而非
  `value`**——`value` 经 owner schema 解析后会丢掉 `apiKeyEnc` / `disabled` 等提供商私有键。
- fix(settings)!: 设置写入只允许 volatile 路径，`llm-pi-ai` 只声明了 `providers`。因此本插件自己的状态
  （`disabledProviders` / `routes` / `composites` / `routeStats` / `uiPrefs`）改存到**插件自己的设置条目**
  `dsh-model-ultra`：新增 `src/host/config.ts`（schemastery，全部 `.volatile()`）并由 Host 半导出 `Config`。
  写入统一走 `settings.replace()` 的**全量快照**；提供商/禁用字典「先加后删」分两次写，避免失败时丢配置。
- fix(host): 监听 `settings/document-updated`（旧事件名 `settings/updated` 不再触发），重装/乱序加载时的
  禁用提供商重新停用逻辑恢复正常。
- fix(host): `ctx.get('logger')` → `ctx.logger`（logger 是 Cordis 上下文属性，不是服务）。
- fix(client)!: `conversation.chat.turnTail` 是 **list 座位**，注册项不再接受（也不再被传入）`select`；
  回合窗口由组件自己从座位 owner props 推导（`selectTurnSelection`）。
- fix(client): 会话时间的正确来源是 `useChat` 提供的 chat 视图快照
  （`snapshot.timeline.turns` / `snapshot.legacy.turnTimings`），旧代码只读 `snapshot.chat.*`，导致精确窗口
  静默退化为粗窗口、相邻回合互相“抢/丢”日志（“有时候有有时候没有”）。
- fix(client): 自定义样式改为带 `data-plugin` 的 `<style>` 并随 fiber 卸载移除，重复挂载不再堆叠规则。
- fix(client): Remote 句柄改为 `resolveRemoteHandle()`（新增 `src/client/remote-handle.ts`）：优先读 Gateway 安装
  的 traceable 属性 `remote.<namespace>`（`api-gateway` 的 `remoteServiceKey()`，其 spec 用的就是这种写法），
  `reflect.get('remote.<namespace>')` 作为回退，属性读取抛错时也不影响挂载；两种投影在 `0.2.0-rc.1` 都有效。

**Desktop / 打包**
- feat(desktop): 声明 `icon.svg` 与 `locale/{en,zh}.json`（插件卡片显示名与图标），`exports` 增加
  `./locale/*.json`，`files` 纳入两者。
- feat(client): `dsh.client` 清单补上 `@deepseek-ai/dsh-client-ui-renderer`（`slots` 服务提供方），并保留
  gateway/locale/settings/chat 依赖；`platform: 'web'` 同时适用于 Desktop 形态。
- fix(peer)!: peer `@deepseek-ai/dsh-typert-protocol` 提升到 `^0.2.0-rc.1`，devDependency 同步。
- fix(build): `prepare` 改为跨平台 `node scripts/prepare.mjs`（原 POSIX `test -f … && … || true` 在 Windows 上
  会因缺少 `test`/`true` 而失败）；新增依赖 `@deepseek-ai/schemastery@^3.18.4`。

**文档与测试**
- docs: README 增加兼容性矩阵、Desktop 安装步骤（设置 → 插件 / `install_bundle`）、`0.2.0-rc.1` 的两处破坏性
  适配说明，并更新设置存储、客户端座位、构建系统与项目结构章节。
- test: host 冒烟测试的 settings mock 升级为 `0.2.0-rc.1` 形状——`describe()`、按 schema 校验的
  `replace()`、非 volatile 字段拒绝写入、`value` 丢弃私有键——并新增严格 codec `create()`、`Config` volatile
  字段、`llm-pi-ai` 不被写入外来键等断言；client 冒烟测试改为驱动 list 座位的 owner props 与 `useChat` 快照，
  并覆盖 Remote 句柄的三种投影（traceable 属性 / reflect 回退 / 未挂载）。

## 1.1.8 — 2026-08-28

- fix(ui): primary button label unreadable in dark mode

## 1.1.7 — 2026-08-24

- feat: enhance turn selection and correlation window handling in RouteBadge component
- feat: enhance observability with persistent stats and request log management
- feat: add links section with Linux community resource

## 1.1.6 — 2026-08-22

- feat(ui): add UI preferences for conversation badge visibility

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
