#!/usr/bin/env node
/**
 * scripts/install-local.mjs — 一键本地安装/升级到 DSH Profile（本地测试用，不发版）。
 *
 * 用法（在本插件仓库根目录）：
 *   npm run install:local                 # 构建 + 软链安装到 ~/.dsh/profiles/web
 *   npm run install:local -- --profile my # 指定其他 Profile
 *   npm run install:local -- --dir ~/.dsh/profiles/web   # 直接指定 Profile 目录
 *   npm run install:local -- --no-build   # 跳过构建（dist 已是最新时）
 *
 * 原理：等价于在 Profile 目录执行
 *   dsh plugin --profile web add link:<本仓库绝对路径>
 * 即 `pnpm add link:...`——软链到本工作区，不拷贝、不触发 prepare 构建脚本，
 * 因此不会踩 pnpm 10 的 allowBuilds 拦截。之后迭代只需：
 *   改代码 → npm run build → 重启 dsh / 刷新 Web GUI。
 *
 * 回退到 registry 版本：
 *   dsh plugin --profile web remove dsh-model-ultra
 *   dsh plugin --profile web add npm:dsh-model-ultra
 */

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const name = pkg.name

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2)
const opt = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (flag) => argv.includes(flag)
const profileName = opt('--profile') || process.env.DSH_PROFILE || 'web'
const profileDir = path.resolve(opt('--dir') || path.join(os.homedir(), '.dsh', 'profiles', profileName))
const noBuild = has('--no-build')

const step = (msg) => console.log(`\x1b[36m▸ ${msg}\x1b[0m`)
const ok = (msg) => console.log(`\x1b[32m✓ ${msg}\x1b[0m`)
const die = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
  process.exit(1)
}

// --- sanity ----------------------------------------------------------------
const manifest = path.join(profileDir, 'package.json')
if (!existsSync(manifest)) {
  die(`Profile 不存在：${profileDir}\n  先用 dsh 初始化一次，或用 --dir/--profile 指定正确目录。`)
}

// --- 1. build --------------------------------------------------------------
if (!noBuild) {
  step('构建 dist/（host ESM + client 工厂）…')
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root, stdio: 'inherit',
  })
  if (r.status !== 0) die('构建失败，中止安装。')
} else if (!existsSync(path.join(root, 'dist', 'host.js')) || !existsSync(path.join(root, 'dist', 'client.js'))) {
  die('--no-build 但 dist/ 缺失，先去掉 --no-build 跑一次构建。')
}

// --- 2. dsh plugin add link:<root> ------------------------------------------
// 必须走 `dsh plugin add`（而非裸 pnpm add）：它在 pnpm 安装之后还会执行
// reconcilePlugins——把声明了 dsh.bundle 的依赖追加进 profile 的
// dsh.profile.bundles 层清单。裸 pnpm add 只装不登记，host 永远不会加载
// （表现为「已安装，未生效」，GUI 误判为纯客户端插件走市场挂载）。
const spec = `link:${root}`
step(`执行 dsh plugin --profile ${profileName} add ${spec} …`)
const add = spawnSync('dsh', ['plugin', '--profile', profileName, 'add', spec], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (add.error?.code === 'ENOENT') die('PATH 上找不到 dsh —— 请先全局安装 @deepseek-ai/dsh。')
if (add.status !== 0) die(`dsh plugin add 失败（exit ${add.status ?? '?'}）。`)

// --- 3. verify --------------------------------------------------------------
const installed = path.join(profileDir, 'node_modules', name)
let linkedTo = null
try {
  const st = lstatSync(installed)
  if (st.isSymbolicLink()) {
    const raw = readlinkSync(installed)
    linkedTo = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(installed), raw)
  }
} catch { /* not installed */ }

if (linkedTo && realpathSync(linkedTo) === realpathSync(root)) {
  ok(`${name} 已软链到 ${root}`)
} else {
  die(`${name} 已安装但不是指向本仓库的软链（${installed}）。检查 pnpm 输出。`)
}

// --- 4. hint ----------------------------------------------------------------
const backToRegistry = `dsh plugin --profile ${profileName} remove ${name} && dsh plugin --profile ${profileName} add npm:${name}`
ok('完成。重启 dsh（或刷新 Web GUI）后生效；此后迭代：改代码 → npm run build → 重启/刷新。')
console.log(`\n  回退 registry 版本：\n    ${backToRegistry}\n`)
