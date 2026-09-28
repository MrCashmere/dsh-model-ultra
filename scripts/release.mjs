/**
 * scripts/release.mjs — one-command release with CHANGELOG automation.
 *
 * Usage:
 *   npm run release            # patch bump (1.1.0 -> 1.1.1)
 *   npm run release -- minor   # minor bump (1.1.0 -> 1.2.0)
 *   npm run release -- major   # major bump
 *   npm run release -- 1.4.2   # explicit version
 *   npm run release -- patch --no-build   # skip local build (CI builds anyway)
 *
 * Steps: verify clean tree -> build+test (unless --no-build) -> bump version in
 * package.json (no tag yet) -> prepend a CHANGELOG.md section generated from the
 * commits since the last tag -> commit (package.json + lockfile + CHANGELOG) ->
 * tag vX.Y.Z -> push branch + tag. Pushing the tag fires the Release workflow,
 * which builds again and publishes to npm + creates a GitHub Release. So this
 * script never needs an npm token locally.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const run = (cmd) => {
  console.log(`\x1b[36m$ ${cmd}\x1b[0m`)
  execSync(cmd, { stdio: 'inherit' })
}
const capture = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
const tryCapture = (cmd) => { try { return capture(cmd) } catch { return '' } }
const fail = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
  process.exit(1)
}

// --- parse args ------------------------------------------------------------
const rawArgs = process.argv.slice(2)
const noBuild = rawArgs.includes('--no-build')
const arg = rawArgs.find((a) => !a.startsWith('-')) || 'patch'
const allowed = new Set(['patch', 'minor', 'major'])
const isExplicit = /^\d+\.\d+\.\d+$/.test(arg)
if (!allowed.has(arg) && !isExplicit) {
  fail(`无效参数 "${arg}"：用 patch | minor | major 或明确版本号 x.y.z。`)
}

// --- preconditions ---------------------------------------------------------
if (capture('git status --porcelain')) {
  fail('工作区有未提交的改动，请先 commit 或 stash 后再发布。')
}
const branch = capture('git rev-parse --abbrev-ref HEAD')
if (!tryCapture('git remote').split('\n').includes('origin')) fail('未配置 origin 远端。')

const before = JSON.parse(readFileSync('package.json', 'utf8')).version
console.log(`\x1b[33m当前版本 ${before}，分支 ${branch}，bump=${arg}${noBuild ? '（跳过本地构建）' : ''}\x1b[0m`)

// --- build + test (skippable; CI always builds regardless) -----------------
if (!noBuild) {
  run('npm run build')
  run('npm test')
}

// --- bump version WITHOUT committing/tagging, so we can also stage CHANGELOG -
run(`npm version ${arg} --no-git-tag-version`)
const after = JSON.parse(readFileSync('package.json', 'utf8')).version

// --- generate + prepend a CHANGELOG.md section -----------------------------
updateChangelog(after)

// --- commit (package.json + lockfile + CHANGELOG), tag, push ---------------
run('git add -A')
run(`git commit -m "release: v${after}"`)
run(`git tag -a v${after} -m "release: v${after}"`)
run(`git push origin ${branch}`)
run(`git push origin v${after}`)

console.log(`\n\x1b[32m✓ 已发布 v${after}。GitHub Actions 正在构建并推送到 npm + 创建 Release。\x1b[0m`)
console.log(`  跟踪进度：仓库 Actions 页，或 npm view dsh-model-ultra version`)

/**
 * Prepend a new "## <version> — <date>" section to CHANGELOG.md, its body built
 * from commit subjects since the last version tag. Existing content is kept
 * untouched below the new section. If CHANGELOG.md has no leading "# Changelog"
 * title, one is added.
 */
function updateChangelog(version) {
  const path = 'CHANGELOG.md'
  const date = new Date().toISOString().slice(0, 10)

  // Commits since the previous tag (fall back to whole history on first tag).
  const prevTag = tryCapture('git describe --tags --abbrev=0')
  const range = prevTag ? `${prevTag}..HEAD` : ''
  const log = tryCapture(`git log ${range} --no-merges --pretty=format:%s`)
  const bullets = log
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    // drop the mechanical release/version-bump commits from the list
    .filter((s) => !/^release: v\d/.test(s) && !/^\d+\.\d+\.\d+$/.test(s))
    .map((s) => `- ${s}`)

  const body = bullets.length ? bullets.join('\n') : '- Maintenance release.'
  const section = `## ${version} — ${date}\n\n${body}\n`

  let existing = existsSync(path) ? readFileSync(path, 'utf8') : '# Changelog\n'
  const titleMatch = existing.match(/^(#\s+Changelog\s*\n)/i)
  let next
  if (titleMatch) {
    const head = titleMatch[1]
    const rest = existing.slice(head.length).replace(/^\n+/, '')
    next = `${head}\n${section}\n${rest}`
  } else {
    next = `# Changelog\n\n${section}\n${existing.replace(/^\n+/, '')}`
  }
  writeFileSync(path, next.replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n'))
  console.log(`\x1b[36m✎ CHANGELOG.md 已写入 ${version}（${bullets.length} 条提交）。\x1b[0m`)
}
