/**
 * scripts/release.mjs — one-command release.
 *
 * Usage:
 *   npm run release            # patch bump (1.1.0 -> 1.1.1)
 *   npm run release -- minor   # minor bump (1.1.0 -> 1.2.0)
 *   npm run release -- major   # major bump
 *   npm run release -- 1.4.2   # explicit version
 *
 * Steps: verify clean tree -> build -> test -> npm version (bumps package.json,
 * commits, creates git tag vX.Y.Z) -> push branch + tag. Pushing the tag fires
 * .github/workflows/release.yml, which builds again and publishes to npm +
 * creates a GitHub Release. So this script never needs an npm token locally.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const run = (cmd) => {
  console.log(`\x1b[36m$ ${cmd}\x1b[0m`)
  execSync(cmd, { stdio: 'inherit' })
}
const capture = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
const fail = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
  process.exit(1)
}

// 1. Working tree must be clean (release commits are reproducible).
if (capture('git status --porcelain')) {
  fail('工作区有未提交的改动，请先 commit 或 stash 后再发布。')
}

// 2. Must be on a branch and have an origin remote.
const branch = capture('git rev-parse --abbrev-ref HEAD')
let remotes = ''
try { remotes = capture('git remote') } catch { /* ignore */ }
if (!remotes.split('\n').includes('origin')) fail('未配置 origin 远端。')

// 3. Determine the bump argument.
const arg = process.argv[2] || 'patch'
const allowed = new Set(['patch', 'minor', 'major'])
const isExplicit = /^\d+\.\d+\.\d+$/.test(arg)
if (!allowed.has(arg) && !isExplicit) {
  fail(`无效参数 "${arg}"：用 patch | minor | major 或明确版本号 x.y.z。`)
}

const before = JSON.parse(readFileSync('package.json', 'utf8')).version
console.log(`\x1b[33m当前版本 ${before}，分支 ${branch}，bump=${arg}\x1b[0m`)

// 4. Build + test before bumping, so a broken build never gets tagged.
run('npm run build')
run('npm test')

// 5. Bump version: writes package.json, commits, and creates tag vX.Y.Z.
//    (npm version fails loudly if the tree is dirty — already guaranteed clean.)
run(`npm version ${arg} -m "release: v%s"`)
const after = JSON.parse(readFileSync('package.json', 'utf8')).version

// 6. Push the branch and the new tag. The tag push triggers the CI publish.
run(`git push origin ${branch}`)
run(`git push origin v${after}`)

console.log(`\n\x1b[32m✓ 已发布 v${after}。GitHub Actions 正在构建并推送到 npm + 创建 Release。\x1b[0m`)
console.log(`  跟踪进度：git 仓库的 Actions 页，或 npm view dsh-model-pro version`)
