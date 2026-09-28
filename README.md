# dsh-model-ultra · 模型 Ultra

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue.svg)](https://github.com/deepseek-ai/dsh)

面向 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) 的**静态 bundle 插件**：在设置页新增一个「**模型 Ultra**」入口，为 `llm-pi-ai` 提供商提供**全生命周期管理 UI** —— 新建 / 编辑 / 删除、启用 / 禁用、远端模型发现、连通性测试、**逐模型思考强度**、**OpenRouter 提供商路由**、智能路由、组合提供商、观测与探活；并在插件被卸载或禁用时**把数据原样还回去（零丢失）**。

> 兼容 **DSH `0.2.0-rc.1` 及以上**，同时支持 **Web**（`dsh web`）与 **Desktop**（桌面应用）两种形态。
>
> 界面内置中英双语（跟随 DSH 语言设置自动切换）。

---

## 目录

- [兼容性](#兼容性)
- [功能特性](#功能特性)
- [安装](#安装)
- [快速上手](#快速上手)
- [工作原理](#工作原理)
- [项目结构](#项目结构)
- [开发与验证](#开发与验证)
- [排错](#排错)
- [更新日志](#更新日志)
- [致谢与许可](#致谢与许可)

---

## 兼容性

| 项目 | 说明 |
|------|------|
| DSH 版本 | **`>= 0.2.0-rc.1`**（peer：`@deepseek-ai/dsh-typert-protocol@^0.2.0-rc.1`） |
| 支持形态 | **Web**（`dsh web` / Web GUI）与 **Desktop**（`dsh desktop` / 桌面应用，Bundled Runtime） |
| 插件形态 | 静态 bundle：Host 半为 ESM（导出 `apply` / `name` / `inject` / `Config`），Client 半为 `window.__ModuleLoader__.load({ id, factory })` CJS 工厂 |
| Node | `>= 18`（构建脚本无 shell 依赖，Windows / macOS / Linux 通用） |
| 设置条目 | 本插件自己的 `dsh-model-ultra` 条目（由 `cordis.patch.yml` 声明入口 id） |

### `0.2.0-rc.1` 的两处破坏性契约（旧插件会因此失效）

1. **Typert 严格编解码器**：契约里的 `codec` 必须是 `{ mode: 'strict', typeSymbol, create() }`，消费方调用 `codec.create().parse(value)`。旧版的 `schema:` 字段会在注册时报 `typert: <subject> strict codec has no create() factory`。
2. **设置写入只允许 volatile 路径**：`settings` 服务不再提供 `get(ns)`（改用 `describe()`，其中 `user` 是原始配置、`value` 是 schema 解析后的配置）；写入逐路径校验，非 volatile 字段直接报 `Config field "X" is not volatile`。`llm-pi-ai` 只声明了 `providers` 一个 volatile 字段，因此本插件自己的状态存放于**插件自己的设置条目**（见[工作原理](#工作原理)）。

### 2.0.0：从 `dsh-model-pro` 更名

本版本由 **dsh-model-pro** 更名而来：包名 `dsh-model-pro` → **`dsh-model-ultra`**，设置页显示名「模型 Pro」→「**模型 Ultra**」，设置条目 id、客户端 bundle id、远程服务命名空间同步更名。

> 更名是**破坏性**的：旧安装的 `dsh-model-pro` 不会自动接管。请先在插件页卸载旧包，再安装 `dsh-model-ultra`（设置条目与状态键同时更新，旧的禁用列表需要在新条目里重新配置，或从旧配置里手工迁移）。

---

## 功能特性

### 提供商管理

- **提供商 CRUD** —— 新建（引导式 3 步向导）、编辑、删除；卡片列表带状态色条（绿=启用 / 琥珀=禁用）。
- **启用 / 禁用** —— 一键切换。禁用的提供商移入本插件自己的 `disabledProviders`，从模型选择器中隐藏，但配置完整保留。
- **字段编辑** —— `baseURL`、`api` 协议、`apiKeyEnv`、`displayName` 逐项编辑；概览页附「就绪检查」清单，直接指出缺哪一项。
- **自定义请求头** —— 按提供商增删改 HTTP 请求头（`authorization` / `api-key` 由适配器自动填充，无需手填）。

### 密钥与凭据

- **加密存储** —— 在 GUI 里直接粘贴 API Key，以 **AES-256-GCM 加密**写入配置（配置文件只存密文），同时写入 DSH 凭据服务供请求时解析。
- **按需解密查看** —— 默认掩码显示，点「显示已存」才解密；加密主密钥存于凭据服务且**永不重新生成**，卸载重装后旧密文仍可解密。

### 模型

- **远端模型发现** —— 一键 `GET /models` 拉取，支持全选 / 取消全选 / 反选。
- **批量写入模型** —— 将选中模型「替换」或「合并」进提供商的显式模型列表。
- **本地转发名映射** —— 为某个模型设置「转发名」，选中它时实际向 provider 发送映射后的模型名。

### 思考强度（Thinking effort）

- **路由级默认** —— 默认等级 `reasoning`：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`；四个 token 预算 `thinkingBudgets`（minimal / low / medium / high）；思考相关 `compat`：`thinkingFormat`、`thinkingTokenBudgetField`、`supportsReasoningEffort`、`supportsThinkingTokenBudget`、`requiresThinkingAsText`、`forceAdaptiveThinking`。下拉的「继承」= 不写该字段，把决定权留给目录。
- **逐模型档位 + 手动取值** —— 每个模型可设「**继承目录 / 非推理（false）/ 自定义档位**」。自定义时**一行一个档位**：勾选是否提供该档，文本框**手动填写发给网关的线上取值**（例如 `high`、某个网关方言的 `reasoning_effort` 值），并附**每档预设值按钮**；整表还可**一键预设**（两档 / 四档 / 五档 / 全七档 / 非推理）。
- **写入位置正确** —— 显式 `models` 列表的提供商写回 `models[i]`；**内置目录路由写 `modelOverrides[id]`**，目录本身保持完整（不会被收窄成一份手写列表）。
- **直接在 DSH 自己的模型选择器里可选** —— 保存后，聊天输入框的模型选择器（`conversation.input.model` 座位）里该模型会多出 **Effort** 一栏，选项就是这里勾选的档位，默认选中的是「默认等级」。选择器里的选项名始终是 DSH 的档位名（Off / Minimal / Low / Medium / High / Xhigh / Max），真正发给网关的取值由「线上取值」决定 —— 例如 `max: ultra` 在选择器里显示 `Max`，请求里发 `ultra`。**无需重启**：设置写入会触发 `settings/document-updated`，选择器随即刷新。
- **页面如实预告选择器结果** —— 每个模型卡片展开后有一行「聊天框 Effort 可选」预览；手写模型没有声明档位却设了路由默认等级时，卡片上会出现「无档位」告警（这种组合下请求会被 `UNSUPPORTED_REASONING_EFFORT` 拒绝）。
- **不可能保存出非法配置** —— 归一化与 `llm-pi-ai` 的 `resolveModelReasoning()` 规则一致（该规则不在 schema 里）：只有 `off` 档可以留空（`off:` → `null`），其余档位必须有取值且不能是空串；只有 `{off: ...}` 一项非法（非推理请用 `false`）；空对象 = 删除字段（继承目录）。

### OpenRouter 提供商路由

对齐 [`dsh-openrouter-providers`](https://github.com/MoRanYue/dsh-openrouter-providers) v1.3.0 的全部功能：

- **提供商白名单 / 顺序** —— `only` 模式写入 `provider.only` + `allow_fallbacks: false`；`order` 模式写入 `provider.order` + `allow_fallbacks: true`。slug 每行一个，分隔符兼容换行 / 逗号 / 中文逗号 / 分号。
- **量化位数限制** —— 12 级量化（`int4` … `fp32`、`unknown`）任选其一，写入 `provider.quantizations: [值]`；不限制则不写该字段。
- **应用归属头** —— 可选补发 `HTTP-Referer` / `X-OpenRouter-Title` / `X-OpenRouter-Categories`，让 OpenRouter 的界面与排行榜显示为可读应用名而不是 Unknown（DSH `0.2.0-rc.1` 自身只发 `user-agent`，所以这里由插件补齐）。
- **生效主机可配** —— 默认 `openrouter.ai`（含子域），可改成自建网关 / 代理域名；只有这些主机的请求会被改写。
- **导入旧配置** —— 一键探测并导入参考插件的 `$DSH_HOME/openrouter-providers.json`、`<workspace>/.dsh-plugins/openrouter-providers.json` 或旧 `settings.yaml.imported`，逐源报告结果。
- **自检 + 计数** —— 页面显示塑形器是否挂载、已见 / 已注入 / 已加归属头的请求数，以及「将会写入的 `provider` 对象」预览（用一条假请求体走同一条塑形逻辑）。状态**每次请求实时读取**，保存后对下一次请求立即生效，**无需重启**。
- **注入方式** —— 在启动期包装 `globalThis.fetch`，只改「配置主机 + POST/PUT/PATCH + 含 `model` 的 JSON」请求，并且**合并**（而非替换）已有的 `provider` 对象；任何异常都原样放行，卸载时还原全局 `fetch`。pi-ai 的流式、工具调用、图片、重放与重试全部保持原样。

> 与参考实现的有意差异：不再复刻 `node -e` 子进程 SSE 桥（`0.2.0-rc.1` 的 pi-ai 已原生支持 OpenRouter）、不再把 API Key 写进 `env`、`provider` 采用合并语义、总开关关闭时同时停发归属头；配置存在插件自己的设置条目里而不是单独一个 JSON 文件。

### 连通性测试

- **真实连通性测试** ——「测试」页对选定模型发起一次极小的真实推理，走完整凭据 / 请求头 / 协议链路，返回**延迟、停止原因与回复内容**，在依赖之前确认模型确实可用。

### 智能路由与组合

- **智能路由** —— 命名路由（如 `auto`）聚合多个 provider 的模型，支持 5 种策略：`priority`（顺序优先 + 回退）/ `weighted`（按权重随机）/ `round-robin`（平滑加权轮询）/ `min-latency`（历史低延迟优先）/ `sticky`（会话粘滞）。可设每目标权重、启用开关、`healthAware`、会话粘滞、`maxFallbacks`、单目标超时。在模型选择器里选「router / 路由名」即用。
- **无感切换（真实回退）** —— 首选目标不可达时自动换下一个目标：回退判定基于「首个内容块是否真正产出」，连接拒绝、HTTP 错误、空响应、超时都会在**任何内容到达对话之前**完成切换，对话无感知、不中断；调用方主动中止永不重试。回退成功的请求在观测台标记为 `fallback`。
- **组合提供商** —— 把多个 provider 的模型合并成一个虚拟 provider，支持**并集 / 交集**两种模式（模型选择器中显示为 `composite / 组合名::模型`）；交集非常适合同款模型多上游互备。

### 观测与健康

- **探活（Probe）** —— 对每个目标（`provider + model`）发起真实最小请求，标记 up / down / probing 与连续失败次数；健康感知分发会自动跳过 down 的目标（可按路由关闭）。
- **观测台** —— 会话内请求日志（路由 → 目标、延迟、token）与聚合统计（按路由 / 按目标：调用次数、成功率、平均延迟、token 合计），以统计卡与表格呈现。
- **对话提供商徽章（可开关）** —— 开启后，每个回合完成时会在其下方显示智能路由 / 组合**实际服务该回合**的目标（`provider/model`），发生自动切换时标注「已无感切换」；开关位于「智能路由 → 观测台」，偏好持久化保存。

### 卸载安全（零数据丢失）

- **卸载不丢数据** —— 插件被卸载或禁用时，会自动把 `disabledProviders` 里的每个提供商**原样还原**回 `providers`，避免模型配置滞留在只有本插件认识的外来键中；OpenRouter 的 `fetch` 包装器同时被拆除。详见[工作原理](#工作原理)。

---

## 安装

### Desktop（桌面应用）

在应用内打开 **设置 → 插件 → 安装**，填写**本地绝对路径**或 npm 包名：

```text
D:\path\to\dsh-model-ultra          # 本地路径（link 安装，改代码重建后重启即生效）
dsh-model-ultra                     # npm 包名（发布后可用）
```

安装后**重启应用**（Host 半在启动时加载）。Desktop 的 Profile 形如 `$DSH_HOME/profiles/desktop`（`DSH_HOME` 默认为 `~/.dsh`），安装成功即：

```jsonc
// $DSH_HOME/profiles/desktop/package.json
"dependencies":      { "dsh-model-ultra": "link:D:/path/to/dsh-model-ultra" },
"dsh": { "profile": { "bundles": [ …, "dsh-model-ultra" ] } }
```

### Web（CLI / Web GUI）

```sh
dsh plugin --profile web add npm:dsh-model-ultra                  # npm（发布后）
dsh plugin --profile web add file:D:\path\to\dsh-model-ultra      # 本地路径
node scripts/install-local.mjs                                    # 源码软链（开发联调）
```

### 从源码构建

```sh
npm install
npm run build       # dist/host.js（ESM）+ dist/client.js（__ModuleLoader__ 工厂）
npm test            # host + client 冒烟测试
```

> `dist/` 在 `.gitignore` 中（属构建产物），但**会随 npm 包发布**；`npm pack` 的内容由 `package.json` 的 `files` 决定：`dist/`、`locale/`、`icon.svg`、`cordis.patch.yml`、`README.md`、`LICENSE`。

### 卸载

**Desktop**：设置 → 插件 → 卸载（或 `dsh plugin --profile desktop remove dsh-model-ultra`）。
**Web**：`dsh plugin --profile web remove dsh-model-ultra`。

卸载前插件会把 `disabledProviders` 原样还原回 `providers`，并还原全局 `fetch`。

---

## 快速上手

1. **新建提供商** —— 进入「模型 Ultra」，点右上角「新增提供商」，按 3 步向导填写：命名（`route` + 可选显示名）→ 连接（协议 + `Base URL`）→ 凭据（`apiKeyEnv` 环境变量名，或直接粘贴密钥加密保存）。
2. **拉取模型** —— 「模型」标签页点「获取远端模型」，勾选后「替换为选中」或「合并选中」。
3. **连通性测试** —— 「测试」标签页选一个模型点「运行测试」，确认延迟、停止原因与回复。
4. **思考强度**（可选）—— 「思考强度」标签页设路由级默认等级 / 预算 / 兼容开关；下方逐模型开卡片，选「自定义档位」后勾选档位并**手动填写线上取值**（或点预设按钮），保存即写回 `models[i]` 或 `modelOverrides[id]`。
   **然后在聊天框验证**：点聊天输入框的模型选择器 → 选中该模型 → 多出的 **Effort** 一栏里就是刚才勾选的档位，默认选中「默认等级」。卡片展开后的「聊天框 Effort 可选」预览与它一致。想让选择器里有档位，**必须**给该模型写至少一个档位（除了 `off`）；只设路由级「默认等级」不会新增档位。
5. **OpenRouter**（可选）—— 「OpenRouter」标签页打开总开关，选 `only` / `order` 与提供商 slug，按需设量化与归属头。改动即时生效，无需重启。
6. **智能路由**（可选）—— 「智能路由 → 路由台」新建命名路由，加入多个目标、选策略、设权重；模型选择器里选「router / 路由名」使用，失败自动回退。
7. **组合提供商**（可选）—— 选 2 个以上 provider 按并集 / 交集合并；选择器里以「composite / 组合名::模型」使用。
8. **探活与观测**（可选）—— 「探活」页对目标发起真实探测更新健康状态；「观测台」查看调用统计与请求日志。

---

## 工作原理

### 设置存放与写入约定

本插件的状态全部存放于**插件自己的设置条目** `dsh-model-ultra`（`cordis.patch.yml` 声明入口 id = 包名），schema 见 `src/host/config.ts`，6 个字段全部 `.volatile()`：

| 字段 | 内容 |
|------|------|
| `disabledProviders` | 被禁用的提供商档案（含完整配置，便于还原） |
| `routes` | 智能路由定义 |
| `composites` | 组合提供商定义 |
| `routeStats` | 持久化的调用统计 |
| `uiPrefs` | 界面偏好（例如是否显示对话提供商徽章） |
| `openrouter` | OpenRouter 提供商路由状态 |

读取设置走 `settings.describe()` 的 **`user`** 字段（原始配置）而不是 `value`：`value` 是 owner schema 解析后的结果，会丢掉 `apiKeyEnc`、`disabled` 这类只有本插件认识的提供商私有键。

写入有两条约定：

- **全量快照**：`replace()` 会重置所有 volatile 字段，因此 `writeState()` 总是「读当前 → 合并本次改动 → 全量写」；
- **先加后删**：提供商 / 禁用字典分两次写，使单次失败最多留下重复项而不会丢配置。

### 禁用与卸载还原

禁用把提供商从 `llm-pi-ai.providers` 移入本插件条目的 `disabledProviders`；由于 `llm-pi-ai` 适配器只解析 `providers`，被禁用的提供商会从模型选择器消失。插件在 fiber 清理时（卸载**或**禁用）执行逆运算：把每个被禁用的提供商连同完整档案还原回 `providers`，启用中的提供商不受影响。

### 思考强度的归一化

页面写的是 `llm-pi-ai` 的配置：路由级 `reasoning` / `thinkingBudgets` / `compat`，逐模型 `reasoningEfforts`（`{ 档位: 线上取值 | null }`，`false` = 非推理，缺省 = 继承目录）。归一化刻意与 `resolveModelReasoning()` 的解析规则保持一致 —— 这些规则**不在 schema 里**（字典字段可选、`null` 合法），只在解析阶段报错，所以由本插件在写入前先拒绝，让页面上永远无法保存出一个 DSH 解析时会失败的配置。

目录路由的逐模型改写走 `modelOverrides[id]` 而不是生成 `models` 列表：后者会**替换**整份已安装目录，把其余模型全部丢掉。

### 档位如何出现在 DSH 聊天框的选择器里

聊天输入框的模型选择器自带 **Effort** 一栏，它不是客户端写死的词表，而是**完全由 Host 提供的逐模型元数据**驱动：

```text
settings 文档（llm-pi-ai.providers.<route>.models[i].reasoningEfforts）
  → llm-pi-ai 的 resolveModelReasoning()  →  pi-ai 模型的 reasoning + thinkingLevelMap
  → PiAiAdapter.modelInfo() → reasoningInfo()   （!model.reasoning 时直接返回 {}）
  → ctx.llm.resolveModelInfo() → session/modelCatalog
  → 聊天框模型选择器的 Effort 一栏
```

由此有三条硬规则（本插件的界面与预览严格照此实现）：

1. **只有逐模型 `reasoningEfforts` 会新增档位**；`model.reasoning` 为假（未声明 / `false`）时选择器完全不显示 Effort；
2. **路由级 `reasoning` 只是默认选中项**：它不会新增档位，若模型并不支持这个等级，请求会被 `UNSUPPORTED_REASONING_EFFORT` 拒绝（所以手写模型必须声明档位）；
3. **选项名是 DSH 自己的档位名**（档位 id 首字母大写），线上取值只影响真正发出的请求 —— `max: ultra` 在选择器里仍是 `Max`。

写入走设置服务，因此每次保存都会发出 `settings/document-updated`，客户端目录随之刷新：**改完即生效，无需重启**（选择器需重新打开一次）。

### OpenRouter 的请求塑形

DSH `0.2.0-rc.1` 的 `llm-pi-ai` 不自己建 HTTP 客户端：它把请求交给 `@earendil-works/pi-ai`，后者用 `openai` 包 `createClient(model, context, apiKey, options?.headers, options?.fetch, …)` 建客户端，而 `llm-pi-ai` **从不传 `options.fetch`**。`openai` 的构造逻辑是 `this.fetch = options.fetch ?? Shims.getDefaultFetch()`，即**构造时刻**取当前的 `globalThis.fetch`；pi-ai 又是**每次请求**新建客户端。因此本插件在 `apply()`（启动期）给 `globalThis.fetch` 装一层包装器，就能落在 pi-ai 的真实请求路径上。

包装器只在这三件事同时成立时改写：URL 主机在配置列表内（默认 `openrouter.ai`，含子域）、方法是 POST / PUT / PATCH、请求体是带 `model` 字段的 JSON。命中后**合并** `provider` 对象（`only` / `order` + `allow_fallbacks`、`quantizations`），可选补发归属头；其余情况逐字节放行。任何异常（体解析失败、未知 init 形状、状态读取失败）都被吞掉并回退到原始调用，绝不向调用方抛错；`dispose()` 只在全局 `fetch` 仍是自己时还原，插件卸载后立刻失效。

### 密钥加密

提供商 API Key 存于两处：**权威副本**在 DSH `credentials` 服务（`llm-pi-ai` 请求时解析）；**静态快照**为 `profile.apiKeyEnc` 下的 AES-256-GCM 密文。随机 AES 主密钥仅生成一次并存入凭据服务，**永不重新生成**，保证重装后旧密文仍可解密。运行环境缺少 WebCrypto 时回退到打包的纯 JS `@noble/ciphers`。

### 跨 realm 安全

Host 半用 `makeHostPlain()` 以 `Object.create(null)`（无原型）递归重建对象，确保跨 vm 沙箱 realm 边界通过 `dsh-settings` 的 `isPlainObject` 校验（静态 bundle 形态下 Host 半运行在普通 Node 进程，该处理用于兼容动态形态与未来的沙箱化加载）。

### 客户端适配

`conversation.chat.turnTail` 是 **list 座位**（不接受 `select`）：角标不依赖框架传入的 `matched`，而是由组件自己从座位 owner props（`turn`）推导窗口（`selectTurnSelection`），并通过座位提供的 `useChat` 快照（`snapshot.timeline.turns` / `snapshot.legacy.turnTimings`）算出「本回合 → 下一回合开始」的精确窗口。

Remote 命名空间在客户端是 cordis 服务 `remote.<namespace>`，因此 `ctx.remote.modelUltra` 与 `ctx.reflect.get('remote.modelUltra')` 两种投影都可用；`resolveRemoteHandle()` 优先读 traceable 属性、回退 reflect，句柄缺失时给出明确报错。

### 构建系统

TypeScript 源码经 [esbuild](https://esbuild.github.io/)（`scripts/build.mjs`）产出两个静态 bundle：

- `dist/host.js` 为 **ESM**（导出 `apply` / `name` / `inject` / `Config`），框架包（`@deepseek-ai/*`、`cordis`）保持 external 由 Profile 运行时解析；
- `dist/client.js` 为包在 `window.__ModuleLoader__.load({ id, factory })` 工厂里的 **CJS**，`react` 由 DSH 客户端模块系统提供。

Host↔Client 通信走 **Typert Remote 服务**（契约见 `src/shared/contract.ts`，共 30 个方法）。

| 文件 | 说明 |
|------|------|
| `dist/host.js` | Host 侧包：`modelUltra` 远程服务 + 路由 / 组合 / 健康 / 观测 / OpenRouter 塑形器，并导出设置 schema `Config` |
| `dist/client.js` | Client 侧包：设置页 UI（`__ModuleLoader__` 工厂） |
| `cordis.patch.yml` | Cordis 组合补丁：声明本插件入口 id（= 包名，即设置条目 `dsh-model-ultra`） |
| `locale/{en,zh}.json` | 插件卡片显示名 / 描述（Desktop 与 Web 的插件列表读取） |
| `icon.svg` | 插件图标（相对路径、≤256 KiB，Desktop 插件卡片使用） |
| `package.json` | npm 元数据 + `dsh.bundle` / `dsh.client` 清单（`platform: web` 同时适用于 Desktop） |

---

## 项目结构

```text
src/
├── shared/
│   ├── constants.ts          # NS / STATE_NS、PROTOS、EDITABLE_FIELDS、路由/组合/观测/UI 键
│   ├── types.ts              # 共享 TypeScript 接口
│   ├── thinking.ts           # 思考等级/格式/预算字段常量、预设表、归一化（对齐 resolveModelReasoning）
│   ├── openrouter.ts         # OpenRouter 状态、量化级别、provider 参数投影、归属头、请求体塑形
│   ├── contract.ts           # Typert 契约：INVOCATIONS + TYPERT_MANIFEST（30 方法，严格 codec 带 create()）
│   └── externals.d.ts        # 框架 peer 包的 ambient 类型（tsc 用）
├── host/
│   ├── index.ts              # apply(ctx) — 导出 Config、Typert 注册 + 各子系统装配
│   ├── config.ts             # 本插件设置条目的 schemastery Config（全部 volatile）
│   ├── service.ts            # ModelUltraRuntime extends TypertRemoteService
│   ├── utils.ts              # makeHostPlain、readSection(describe().user)、writeState/writeSection
│   ├── crypto.ts             # AES-256-GCM 密钥加解密（凭据服务主密钥）
│   ├── lifecycle.ts          # fiber 清理钩子 — 卸载时还原禁用提供商
│   ├── openrouter.ts         # globalThis.fetch 塑形器 + 遗留配置导入（可逆、不缓存）
│   ├── router.ts             # 智能路由分发引擎（router / composite 适配器）
│   ├── composite.ts          # 组合提供商（并集 / 交集）解析
│   ├── health.ts             # 目标健康追踪（探活）
│   ├── statsStore.ts         # 会话内请求日志 + 统计
│   ├── streamRewrite.ts      # 本地转发名映射
│   └── handlers/             # 每个业务 handler 一个文件
│       ├── list.ts / get.ts / create.ts / delete.ts
│       ├── toggle.ts / updateField.ts / updateHeaders.ts
│       ├── updateKey.ts / applyModels.ts / discover.ts / test.ts
│       ├── thinking.ts / openrouter.ts
│       └── routes.ts / composites.ts / observability.ts / uiPrefs.ts
├── client/
│   ├── index.tsx             # apply(ctx) — remote $mount + settings.section Slot + 样式注入
│   ├── i18n.ts               # ZH / EN 字典
│   ├── styles.ts             # CSS 字符串
│   ├── labels.ts / rpc.ts / react.ts
│   ├── remote-handle.ts      # remote.<namespace> 句柄解析（traceable 属性 + reflect 回退）
│   ├── cordis-globals.d.ts   # __ModuleLoader__ 静态 bundle 契约的 ambient 类型
│   └── components/
│       ├── ModelUltraPage.tsx  # 仪表盘（分段 + 新建 + 卡片）
│       ├── ProviderCard.tsx    # 状态色条卡片
│       ├── CreateForm.tsx      # 引导式 3 步向导
│       ├── ProviderEditor.tsx  # 标签页编辑器
│       ├── OverviewPanel.tsx / HeadersPanel.tsx / ModelsPanel.tsx
│       ├── ThinkingPanel.tsx   # 思考强度（路由级 + 逐模型档位/手动取值/预设）
│       ├── OpenRouterPanel.tsx # OpenRouter（模式/量化/归属头/导入/自检）
│       └── TestPanel.tsx / RoutesPanel.tsx / RouteBadge.tsx
locale/{en,zh}.json           # 插件卡片显示文案
icon.svg                      # 插件图标
tests/                        # host + client 冒烟测试
dist/                         # 构建输出（gitignored，随 npm 包发布）
scripts/
├── build.mjs                 # esbuild：host ESM + client __ModuleLoader__ 工厂
├── prepare.mjs               # 跨平台 prepare（有源码才构建，纯 Node，无 shell 依赖）
├── install-local.mjs         # Web 形态一键软链安装到 Profile
└── release.mjs               # 一键发版：bump + CHANGELOG + tag + push
tsconfig.json · package.json · cordis.patch.yml
```

> 界面 CSS 类统一使用内部前缀 `mpro-`（历史命名空间，纯样式作用域，不参与持久化与对外契约）。

---

## 开发与验证

```sh
npm run build       # 构建两个 bundle
npm run typecheck   # tsc --noEmit
npm test            # tests/host.smoke.mjs + tests/client.smoke.mjs
```

冒烟测试完全离线运行：

- `tests/host.smoke.mjs` 在 `vm` 沙箱里加载 `dist/host.js`，用 DSH `0.2.0-rc.1` 形状的 settings mock（`describe()` + volatile 写入校验 + 私有键丢失）驱动全部 30 个方法，覆盖提供商 CRUD、禁用/还原、智能路由、组合、观测、**思考强度归一化**与 **OpenRouter 塑形（含真实 fetch 拦截）**。
- `tests/client.smoke.mjs` 用极简 React 替身渲染客户端 bundle，断言座位注册、页面结构、两个新页签的交互路径、聊天框 Effort 预览与保存时发出的 RPC 载荷。

---

## 排错

| 现象 | 排查 |
|------|------|
| 设置里没有「模型 Ultra」 | 确认 Profile 的 `package.json` 里 `dependencies` 与 `dsh.profile.bundles` 都包含 `dsh-model-ultra`，然后**重启应用**（Host 半在启动时加载）。 |
| 安装报 `incompatible-version` | DSH 版本低于 `0.2.0-rc.1`，或 peer 范围被改坏；本插件只支持 `^0.2.0-rc.1`。 |
| 卡片显示包名而不是显示名 / 没有图标 | 检查 `exports` 是否包含 `./locale/*.json`，`icon` 是否为包内**相对路径**且 ≤256 KiB。 |
| 保存思考强度报「必须填写线上取值」 | 除 `off` 外的档位必须给出实际发送给网关的值；只想关闭思考请把该模型设为「非推理（false）」。 |
| 聊天框的模型选择器里没有 Effort 一栏 | 该模型还没有声明档位：进入「思考强度 → 该模型 → 自定义档位」，勾选至少一个档位（只勾 `off` 不算）并保存 —— 只设路由级「默认等级」不会新增档位；也要确认选择器里当前选中的就是该模型（Effort 只针对当前选中的模型显示）。 |
| 选择器里有档位，但请求被 `UNSUPPORTED_REASONING_EFFORT` 拒绝 | 路由级「默认等级」选了该模型不支持的档位（手写模型且未声明档位时尤其如此）；把默认等级改成选择器里存在的档位即可。 |
| OpenRouter 改了没生效 | 总开关是否打开、提供商 slug 列表是否非空（或量化不为「不限制」）、请求主机是否在「生效主机」列表内；页面自检区会显示是否挂载、计数是否增长。 |
| 请求里出现 `provider` 但字段不是预期的 | 本插件**合并**已有的 `provider` 对象：模型或自定义头里若已带 `provider`，同名键以页面配置为准覆盖。 |

---

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。当前版本 **2.0.1**。

## 致谢与许可

- 本项目由 **dsh-model-pro**（作者 [wqy8593521](https://github.com/wqy8593521)）更名并扩展而来；MIT 许可证与原版权声明保留在 [LICENSE](LICENSE)。
- OpenRouter 提供商路由能力的对照实现参考了 [dsh-openrouter-providers](https://github.com/MoRanYue/dsh-openrouter-providers)（MIT，作者 MoRanYue）。
- 中文社区：[Linux.do](https://linux.do/)。

[MIT](LICENSE) © 2025 wqy8593521 · 2026 MrCashmere
