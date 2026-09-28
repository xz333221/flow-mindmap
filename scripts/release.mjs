#!/usr/bin/env node
// Copyright 2026 xz333221
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * flow-mindmap 发包脚本
 *
 * 1. 环境自检(节点版本 / git 仓库与锁 / 分支 / 工作区 / npm 登录)
 * 2. 发布前检查(版本号是否已被占用 / 类型检查 / 单测 / 浏览器冒烟)
 * 3. 更新版本号(默认 patch +1,可用 --version= / --bump= 覆盖)
 * 4. 构建库产物(types + lib,版本号由 vite define 烘进产物)
 * 5. 可选重跑 README 截图 + 把 README 里 jsDelivr 的 @vX.Y.Z 对齐到新版本
 * 6. 发布物自检(npm pack --dry-run 对着 files / main / module / types / exports 逐条核对)
 * 7. 提交 + 打 tag + push(只 add 白名单文件,禁止 git add -A)
 * 8. npm publish
 * 9. 发布后校验:轮询 registry,把线上 tarball 拉下来核对内容真的齐全
 *
 * 用法:
 *   pnpm release                       # 全流程(patch 版本 +1)
 *   pnpm release -- --dry-run          # 只打印计划:不写 package.json / 不 commit / 不 publish
 *   pnpm release -- --version=0.7.0    # 指定版本号(重跑发布用得上,见文末提示)
 *   pnpm release -- --bump=minor       # patch(默认) / minor / major
 *   pnpm release -- --skip-push        # 只发 npm,不 push git
 *   pnpm release -- --skip-tests --skip-smoke   # 跳过单测 / 跳过浏览器冒烟
 *   pnpm release -- --skip-build       # 跳过构建(会连带跳过发布物自检,自检结论无效)
 *   pnpm release -- --screenshots      # 重跑 README 截图(需要 demo 依赖 + playwright 浏览器)
 *   pnpm release -- --skip-readme      # 不动 README 里的 jsDelivr @vX.Y.Z
 *   pnpm release -- --dist-tag=next    # 预发布版默认自动用 beta 之类的 tag,可用它覆盖
 *   pnpm release -- --skip-verify-published     # 发布后不去核对线上发布物
 *   pnpm release -- --verify-only=0.6.3         # 只核对线上发布物(不构建/不发布),可事后重跑
 *   pnpm release -- --poll-interval=20 --poll-timeout=900   # 发布后校验的重试节奏(秒)
 *   pnpm release -- --yes              # 所有确认一律按 Y(非交互环境同样按 Y)
 *
 * 为什么发布后还要盯着 registry(第 9 步):
 * `npm publish` 返回成功 ≠ registry 立刻对外可见。新版本要过 registry 后台处理
 * ("Your package is being processed" 不是客套话)+ CDN 缓存刷新(packument 的
 * `Cache-Control: public, max-age=300`,实测能滞后更久)。所以发完要轮询,直到
 * 能确认"这个版本 + 这个 tarball"真的对外可取。
 *
 * 并且**两种先后顺序都实测出现过**(同源项目 zen-gitsync 的 release 脚本里记着):
 *   - 有时 packument 滞后几十分钟,而 tarball 早就可取;
 *   - 有时反过来 —— dist-tags 已经翻牌,tarball 的对象还没就绪。
 * 所以轮询里两条路都探:① `npm view <pkg>@<ver> version`(走 packument);
 * ② 直接 GET tarball 地址(tarball 按 URL 寻址、内容不可变,绕开 packument 那层缓存)。
 * 探 tarball 用 GET 而不是 HEAD —— 实测同一 URL 同一分钟内 HEAD 404 / GET 200,
 * 而 npm 真下载用的是 GET,所以只认 GET 的结论;带上 `Range: bytes=0-0` 只取 1 字节。
 * 第 2 轮起给 URL 挂个时间戳查询串:新路径在 CDN 边缘可能挂着"这条路径 404"的负缓存,
 * 换个 URL 就等于绕开它。
 *
 * 为什么自检要啃线上 tarball 的内容(而不是只看"版本号能查到"):
 * 本包的发布物是 `files: ["dist"]` —— 一旦构建没跑 / 跑失败 / 目录被清空,
 * `npm publish` 会**成功**打出一个没有 dist 的包;装到用户那边就是
 * "Cannot find module 'flow-mindmap'" 或样式丢失,而且本地永远复现不了
 * (本地 dist 好端端躺着)。所以发布前用 `npm pack --dry-run --json` 对着
 * files / main / module / types / exports 逐条核对(第 6 步),发布后再把线上
 * tarball 拉下来 `tar -tzf` 数一遍(第 9 步)。两道网故意不合并:前者防"配置写漏",
 * 后者防"配置对但线上那份不对"。
 *
 * 为什么提交只 add 白名单:
 * 这个仓库的 scripts/ 下有 30+ 个临时验证脚本,工作区动不动就是脏的。
 * `git add -A` 会把调试脚本、截图、tmp/ 一起卷进 release commit。
 *
 * 为什么失败要回滚 package.json / README.md:
 * 版本号是在构建前写的(构建要把版本烘进 dist)。要是构建或自检挂了,
 * 工作区会留着一个"已升版但没发出去"的 package.json,下一次跑脚本又会再 +1,
 * 版本号就这么漂走了。所以写盘前先留快照,未提交前的任何失败都还原。
 *
 * Windows 注意:安装/构建被文件占用打断是常态(杀软、编辑器、还开着的 dev server),
 * 脚本会在 git 操作前清锁文件,并在提示里点明"谁占着"。
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawn } from 'node:child_process'
import readline from 'node:readline/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// ===========================================================================
// CLI
// ===========================================================================

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)

const DRY_RUN = hasFlag('--dry-run')
const SKIP_PUSH = hasFlag('--skip-push')
const SKIP_TESTS = hasFlag('--skip-tests')
const SKIP_SMOKE = hasFlag('--skip-smoke')
const SKIP_BUILD = hasFlag('--skip-build')
const SKIP_README = hasFlag('--skip-readme')
const SKIP_VERIFY_PUBLISHED = hasFlag('--skip-verify-published')
const SCREENSHOTS = hasFlag('--screenshots')
const AUTOMATIC_YES = hasFlag('--yes')
const NO_COLOR = hasFlag('--no-color')

function readStringArg(name, fallback) {
  const prefix = `${name}=`
  const hit = argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : fallback
}

// 读 `--xxx=<数字>` 形式的数值参数,非法/缺失时回落默认值
function readNumberArg(name, fallback) {
  const prefix = `${name}=`
  const hit = argv.find((a) => a.startsWith(prefix))
  if (!hit) return fallback
  const parsed = Number(hit.slice(prefix.length))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

if (hasFlag('--help') || hasFlag('-h')) {
  // 帮助就是文件头那段注释,直接打出来,免得两处维护
  const header = fs.readFileSync(__filename, 'utf8').split('*/')[0]
  console.log(header.slice(header.indexOf('/**') + 3).replace(/^ \* ?/gm, '').trim())
  process.exit(0)
}

const PKG_NAME = 'flow-mindmap'
const GIT_REMOTE = 'origin'
const TAG_PREFIX = 'v'
const DEV_PORT = 7851

// 发布必须打官方 registry:国内镜像(npmmirror 之类)是只读同步,往那边 publish 必失败。
// 想换源(比如公司内网私服)用 --registry= 覆盖。
const NPM_REGISTRY = readStringArg('--registry', 'https://registry.npmjs.org/')
const REGISTRY_ARG = `--registry=${NPM_REGISTRY}`

// 发布后轮询:默认 15s 一轮、上限 600s。
const POLL_INTERVAL_MS = readNumberArg('--poll-interval', 15) * 1000
const POLL_TIMEOUT_MS = readNumberArg('--poll-timeout', 600) * 1000

const BUMP_KIND = readStringArg('--bump', 'patch')
const VERSION_OVERRIDE = readStringArg('--version', '')

// `--verify-only` / `--verify-only=0.6.3`:只跑第 9 步(发布后校验),不做别的。
// 用途:轮询超时后重新确认、或事后核查某个已发布版本。不带 = 时取 package.json 里的版本。
const VERIFY_ONLY_VERSION = readStringArg('--verify-only', '')
const VERIFY_ONLY = hasFlag('--verify-only') || VERIFY_ONLY_VERSION !== ''

// 白名单:只有这些路径会进 release commit(目录写目录名,前缀匹配)。
// dist/ 在 .gitignore 里,只走 npm 的 files 白名单发布,不进 git。
const RELEASE_FILES = ['package.json', 'README.md', 'docs/screenshots']

// ===========================================================================
// 输出(不引 chalk:这个包 dependencies 只有 3 个运行时依赖,发包脚本不该为
// 了彩色输出再塞一个 devDep。ANSI 手写 10 行就够,顺带支持 NO_COLOR。)
// ===========================================================================

const COLOR_ON = !NO_COLOR && !process.env.NO_COLOR && Boolean(process.stdout.isTTY)
const paint = (code) => (s) => (COLOR_ON ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const red = paint(31)
const green = paint(32)
const yellow = paint(33)
const blue = paint(34)
const cyan = paint(36)
const gray = paint(90)
const bold = paint(1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ===========================================================================
// 子进程封装
// ===========================================================================

// 透传 stdio(构建、publish 这类要看到实时输出)
function run(cmd, { cwd = rootDir, timeout = 0 } = {}) {
  console.log(gray(`$ ${cmd}`))
  const opts = { cwd, stdio: 'inherit', maxBuffer: 32 * 1024 * 1024 }
  if (timeout > 0) opts.timeout = timeout
  return execSync(cmd, opts)
}

// 吞掉输出,只取 stdout(用于探测类命令)
function capture(cmd, { cwd = rootDir, timeout = 60000 } = {}) {
  return execSync(cmd, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  }).trim()
}

// cmd.exe 下路径带空格要靠双引号;统一转正斜杠,省得反斜杠被当成转义
function q(p) {
  return `"${String(p).replace(/\\/g, '/')}"`
}

// ===========================================================================
// 交互
// ===========================================================================

async function askContinue(message) {
  if (AUTOMATIC_YES) {
    console.log(yellow(`${message}(--yes,自动按 Y)`))
    return true
  }
  // 非 TTY(CI / 被别的脚本调起)时问不出答案,readline 会直接挂住 —— 按 Y 走
  if (!process.stdin.isTTY) {
    console.log(yellow(`${message}(非交互环境,按 Y 处理)`))
    return true
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(message)).trim().toLowerCase()
    return answer === '' || answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

// ===========================================================================
// 失败回滚
// ===========================================================================

// 写盘前的快照:路径 -> 内容(null = 文件原本不存在)。
// 未提交前的失败都用它还原,避免留下"升了版但没发出去"的 package.json。
const snapshot = new Map()
let committed = false
let worktreeWasClean = false

function remember(file) {
  const abs = path.join(rootDir, file)
  if (!snapshot.has(abs)) {
    snapshot.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null)
  }
}

async function rollbackUncommitted() {
  if (snapshot.size === 0) return
  // 先算出真正需要还原的文件,一个都没有就别吓唬人
  const dirty = [...snapshot].filter(([abs, content]) =>
    content === null ? fs.existsSync(abs) : fs.readFileSync(abs, 'utf8') !== content
  )
  if (dirty.length === 0 && !SCREENSHOTS) return

  console.log(yellow('\n回滚本次改动(还没提交,不留下改到一半的版本号)...'))
  for (const [abs, content] of dirty) {
    const rel = path.relative(rootDir, abs).replace(/\\/g, '/')
    try {
      if (content === null) {
        await fsp.rm(abs, { force: true })
        console.log(gray(`  · 删除 ${rel}`))
      } else {
        await fsp.writeFile(abs, content, 'utf8')
        console.log(gray(`  · 还原 ${rel}`))
      }
    } catch (err) {
      console.error(red(`  ✗ 还原 ${rel} 失败: ${err?.message || err}`))
    }
  }
  // 截图是二进制(上面按 utf8 存会影响还原),单独走 git 还原。
  // 只在"开工时工作区本来就是干净的"前提下做 —— 否则会把用户没提交的改动一起抹掉。
  if (SCREENSHOTS && worktreeWasClean) {
    try {
      execSync('git checkout -- docs/screenshots', { cwd: rootDir, stdio: 'ignore' })
      console.log(gray('  · 还原 docs/screenshots/(git checkout)'))
    } catch (err) {
      console.error(red(`  ✗ 还原 docs/screenshots 失败: ${err?.message || err}`))
    }
  }
}

// ===========================================================================
// 包管理器
// ===========================================================================

// 仓库锁文件是 pnpm-lock.yaml,优先用 pnpm;机器上没装就退回 npm。
// 注意 npm 会因为找不到 package-lock.json 而新生成一个 —— 那是未跟踪文件,
// 别手滑提交(脚本的白名单提交天然挡住了这件事)。
function detectPackageManager() {
  for (const pm of ['pnpm', 'npm']) {
    try {
      const v = capture(`${pm} --version`, { timeout: 30000 })
      if (v) return { pm, version: v }
    } catch {
      /* 没装,试下一个 */
    }
  }
  return { pm: 'npm', version: '?' }
}

const { pm: PM, version: PM_VERSION } = detectPackageManager()
const runScript = (name) => `${PM} run ${name}`

function ensureDeps() {
  const vite = path.join(rootDir, 'node_modules', 'vite')
  if (fs.existsSync(vite)) return
  console.log(yellow('未找到 node_modules,先装依赖...'))
  if (DRY_RUN) {
    // dry-run 不改动机器上的东西(和 zen-gitsync 的 release 脚本同一原则);
    // 但后面的类型检查 / 构建都依赖 node_modules,缺了会当场失败,所以把话说明白
    console.log(yellow(`[dry-run] 跳过 ${PM} install —— 若 node_modules 本来就缺,后面的检查会失败`))
    return
  }
  const frozen = PM === 'pnpm' ? ' --frozen-lockfile' : ''
  run(`${PM} install${frozen}`, { timeout: 0 })
  if (PM === 'npm') {
    console.log(yellow(
      '提示:没找到 pnpm,退回 npm —— 它不认 pnpm-lock.yaml,依赖版本可能和锁文件里的不一致\n'
      + '(实测 marked 会被装成 18.0.x 的最新版,而锁文件钉的是 18.0.5),'
      + '单测/构建结果可能因此和平时不同。\n'
      + '另外 npm 会生成 package-lock.json:它不在提交白名单里,不会被发出去,但别手动 git add。'
    ))
  }
}

// ===========================================================================
// 1. 环境自检
// ===========================================================================

// 清 git 锁文件。上次 git 操作被中断(关窗口、Ctrl+C)常留下 index.lock,
// 之后所有 git 命令都报 "Unable to create '.../index.lock': File exists"。
// 只删明确的几个路径 + refs 下的 *.lock,不用通配符乱扫。
// 本脚本的 git 调用全是同步(execSync),不存在"自己派生的 git 进程占着锁"的情况,
// 所以这里不做 kill —— 删不掉就是别的程序占着,交给用户决定。
async function checkAndCleanGitLocks() {
  console.log(gray('检查 Git 锁文件...'))
  const gitDir = path.join(rootDir, '.git')
  const lockFiles = [
    path.join(gitDir, 'index.lock'),
    path.join(gitDir, 'HEAD.lock'),
    path.join(gitDir, 'config.lock'),
    path.join(gitDir, 'packed-refs.lock'),
  ]
  const lockDirs = [path.join(gitDir, 'refs', 'heads'), path.join(gitDir, 'refs', 'remotes')]

  const busy = []
  const tryUnlink = async (p) => {
    try {
      await fsp.unlink(p)
      console.log(green(`已删除锁文件: ${p}`))
    } catch (err) {
      busy.push({ path: p, err })
    }
  }

  for (const p of lockFiles) {
    if (fs.existsSync(p)) await tryUnlink(p)
  }
  for (const dir of lockDirs) {
    if (!fs.existsSync(dir)) continue
    let entries = []
    try {
      entries = await fsp.readdir(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name.endsWith('.lock')) await tryUnlink(path.join(dir, name))
    }
  }

  if (busy.length === 0) {
    console.log(gray('未发现 Git 锁文件'))
    return
  }

  console.log(yellow('锁文件被占用,2 秒后重试...'))
  await sleep(2000)
  for (const item of busy) {
    try {
      await fsp.unlink(item.path)
      console.log(green(`重试后已删除: ${item.path}`))
    } catch (err) {
      console.error(red(`重试仍无法删除 ${item.path}: ${err.message}`))
      if (!(await askContinue(yellow('是否继续发布(可能失败)? (Y/n): ')))) {
        throw new Error('用户选择终止发布')
      }
    }
  }
}

// 发布前确认 npm 登录态 —— 放在最前面,别等构建跑完 3 分钟才发现没登录
function checkNpmAuth() {
  try {
    const who = capture(`npm whoami ${REGISTRY_ARG}`, { timeout: 30000 })
    console.log(gray(`  npm 登录账号: ${who}`))
    return who
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    if (/ENEEDAUTH|not logged in|401/i.test(out)) {
      throw new Error(
        `npm 未登录(${NPM_REGISTRY})。先执行:\n  npm login ${REGISTRY_ARG}\n`
        + '另外确认账号有 flow-mindmap 的发布权限。'
      )
    }
    // 网络问题不该在这里拦人,后面 publish 会给出准确原因
    console.log(yellow(`  npm whoami 没成功(${out.split(/\r?\n/)[0] || err.message}),继续`))
    return null
  }
}

async function checkEnvironment() {
  console.log(blue('=== 环境自检 ==='))

  const major = Number(process.versions.node.split('.')[0])
  if (major < 20) {
    throw new Error(`Node 版本过低(v${process.versions.node}),本仓库要求 Node 20+`)
  }
  console.log(gray(`  Node v${process.versions.node} / ${PM} ${PM_VERSION}`))

  try {
    execSync('git --version', { stdio: 'ignore' })
    capture('git rev-parse --is-inside-work-tree', { timeout: 15000 })
  } catch {
    throw new Error('当前目录不是 git 仓库')
  }
  await checkAndCleanGitLocks()

  const branch = capture('git rev-parse --abbrev-ref HEAD', { timeout: 15000 })
  console.log(gray(`  当前分支: ${branch}`))
  if (branch !== 'main' && branch !== 'master') {
    if (!(await askContinue(yellow(`当前不在主分支上,确定在 ${branch} 上发版? (Y/n): `)))) {
      throw new Error('用户选择取消发布')
    }
  }

  // dist/ 一旦被误提交进 git,release commit 就可能带上它 —— 这里提前叫停
  const trackedDist = capture('git ls-files dist', { timeout: 15000 })
  if (trackedDist) {
    throw new Error(
      'dist/ 被 git 跟踪了(dist 应在 .gitignore 里,只通过 npm files 白名单发布)。\n'
      + '先执行:`git rm -r --cached dist` 并提交,再发版。'
    )
  }

  try {
    execSync('git diff --quiet && git diff --staged --quiet', { cwd: rootDir, stdio: 'ignore' })
    worktreeWasClean = true
    console.log(green('  Git 工作区干净'))
  } catch {
    worktreeWasClean = false
    console.log(yellow('  Git 工作区有未提交的更改:'))
    execSync('git status -s', { cwd: rootDir, stdio: 'inherit' })
    console.log(yellow(
      '  注意:这些改动不会进 release commit(只 add 白名单),'
      + '但会留在工作区。—— 建议先提交再来发版:脚本调用的 skill 是 verify-and-commit。'
    ))
    if (!(await askContinue(yellow('  有未提交的更改,是否继续发布? (Y/n): ')))) {
      throw new Error('用户选择取消发布')
    }
  }

  checkNpmAuth()
  console.log(green('环境自检通过'))
}

// ===========================================================================
// 2. 版本号
// ===========================================================================

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * 算下一个版本号。
 *   patch(默认):0.6.2 -> 0.6.3;预发布版 0.7.0-beta.2 -> 0.7.0-beta.3
 *   minor / major:0.6.2 -> 0.7.0 / 1.0.0(并丢掉预发布后缀)
 * --version=x.y.z 直接指定时优先于这一切。
 */
function computeNextVersion(current) {
  if (VERSION_OVERRIDE) {
    if (!SEMVER_RE.test(VERSION_OVERRIDE)) {
      throw new Error(`--version=${VERSION_OVERRIDE} 不是合法的 semver(要形如 1.2.3 或 1.2.3-beta.1)`)
    }
    return VERSION_OVERRIDE
  }
  if (!['patch', 'minor', 'major'].includes(BUMP_KIND)) {
    throw new Error(`--bump=${BUMP_KIND} 不认识(只支持 patch / minor / major)`)
  }

  const m = SEMVER_RE.exec(current)
  if (!m) throw new Error(`package.json 里的 version "${current}" 不是合法 semver`)
  const [, maj, min, pat, pre] = m

  if (pre && BUMP_KIND === 'patch') {
    // 预发布阶段跑 patch:动的是预发布序号(尾段是数字就 +1,否则补一个 .1)
    const parts = pre.split('.')
    const last = parts[parts.length - 1]
    if (/^\d+$/.test(last)) parts[parts.length - 1] = String(Number(last) + 1)
    else parts.push('1')
    return `${maj}.${min}.${pat}-${parts.join('.')}`
  }

  if (BUMP_KIND === 'major') return `${Number(maj) + 1}.0.0`
  if (BUMP_KIND === 'minor') return `${maj}.${Number(min) + 1}.0`
  return `${maj}.${min}.${Number(pat) + 1}`
}

// 预发布版(1.2.3-beta.4)默认**不该**盖到 latest 上 —— 那会让 `npm i flow-mindmap`
// 装出一个 beta。默认按预发布标识取 dist-tag(取不到就 beta),可用 --dist-tag= 覆盖。
function resolveDistTag(version) {
  const explicit = readStringArg('--dist-tag', '')
  if (explicit) return explicit
  const pre = SEMVER_RE.exec(version)?.[4]
  if (!pre) return 'latest'
  const ident = pre.split('.')[0].replace(/[^0-9A-Za-z-]/g, '')
  return ident || 'beta'
}

// `npm view <pkg>@<ver> version` —— 命中返回版本号,404/无匹配返回 null,
// 网络类失败抛出去(由调用方决定是"当作未知继续"还是"当成致命")
function queryPublishedVersion(version) {
  try {
    const out = capture(
      `npm view ${PKG_NAME}@${version} version --json ${REGISTRY_ARG} --prefer-online`,
      { timeout: 45000 }
    )
    const parsed = JSON.parse(out)
    return typeof parsed === 'string' ? parsed.replace(/^v/, '') : null
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    if (/E404|not found|No match found|EINVALIDTAGNAME/i.test(out)) return null
    const e = new Error(`查询 registry 失败:${out.split(/\r?\n/).find(Boolean) || err.message}`)
    e.transient = true
    throw e
  }
}

function queryLatestVersion() {
  try {
    const out = capture(`npm view ${PKG_NAME} version --json ${REGISTRY_ARG} --prefer-online`, {
      timeout: 45000,
    })
    const parsed = JSON.parse(out)
    return typeof parsed === 'string' ? parsed.replace(/^v/, '') : null
  } catch {
    return null
  }
}

// 同一个版本号发不了第二次(npm 会 E403),提前查一次,别等构建跑完才失败
function assertVersionPublishable(version) {
  console.log(blue('\n=== 版本号可用性 ==='))
  console.log(gray(`  本地: ${readLocalVersion()}  本次发布: ${version}`))
  let published = null
  try {
    published = queryPublishedVersion(version)
  } catch (err) {
    console.log(yellow(`  registry 查询失败(${err.message}),跳过占用检查,继续`))
    return
  }
  if (published) {
    throw new Error(
      `${PKG_NAME}@${version} 已经发布过了,npm 不允许覆盖已发布版本。\n`
      + '换个版本号重跑(例如 `--version=<更大的版本>` 或 `--bump=minor`)。'
    )
  }
  const latest = queryLatestVersion()
  if (latest) {
    console.log(gray(`  registry 上 latest: ${latest};${version} 未被占用`))
    const distTag = resolveDistTag(version)
    if (distTag !== 'latest' && latest === version) {
      console.log(yellow(`  · ${version} 会发到 ${distTag} tag 下,不动 latest`))
    }
  }
}

function readLocalVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  return pkg.version
}

function writeVersion(version) {
  const p = path.join(rootDir, 'package.json')
  remember('package.json')
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'))
  const old = pkg.version
  pkg.version = version
  if (DRY_RUN) {
    console.log(yellow(`[dry-run] 跳过写入: ${old} -> ${version}`))
    return
  }
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log(green(`版本号已更新: ${old} -> ${version}`))
}

// ===========================================================================
// 3. 发布前检查:类型 / 单测 / 浏览器冒烟
// ===========================================================================

function runTypeCheck() {
  console.log(blue('\n=== 类型检查 (vue-tsc --noEmit) ==='))
  run(runScript('typecheck'))
  console.log(green('类型检查通过'))
}

function runUnitTests() {
  if (SKIP_TESTS) {
    console.log(yellow('\n--skip-tests: 跳过单元测试'))
    return
  }
  console.log(blue('\n=== 单元测试 (vitest run) ==='))
  run(runScript('test'))
  console.log(green('单元测试通过'))
}

// 起一个 dev server 跑 scripts/verify.mjs(Playwright 冒烟)。
// verify.mjs 只认 URL、自己不拉服务,所以这里负责起停:端口已被占用就直接复用
// (用户手动开着 dev server 很常见),复用的情况下不负责关掉它。
function viteBin() {
  return path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
}

async function isServerUp(url) {
  try {
    const res = await fetch(url, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

function killProcessTree(pid) {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true })
    } catch {
      /* 进程可能已经退出 */
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* 同上 */
    }
  }
}

async function runSmokeTest() {
  if (SKIP_SMOKE) {
    console.log(yellow('\n--skip-smoke: 跳过浏览器冒烟测试'))
    return
  }
  console.log(blue('\n=== 浏览器冒烟测试 (Playwright) ==='))

  const verifyScript = path.join(rootDir, 'scripts', 'verify.mjs')
  if (!fs.existsSync(verifyScript)) {
    console.log(yellow('scripts/verify.mjs 不存在,跳过'))
    return
  }
  if (!fs.existsSync(path.join(rootDir, 'node_modules', 'playwright'))) {
    console.log(yellow('未安装 playwright,跳过(要跑请先 pnpm install && pnpm exec playwright install chromium)'))
    return
  }
  // playwright 装了但浏览器没下载,verify.mjs 会抛一段很晦涩的
  // "Executable doesn't exist at ..." —— 先自己查一下,把该敲的命令打出来
  try {
    const { chromium } = await import('playwright')
    const exe = chromium.executablePath()
    if (exe && !fs.existsSync(exe)) {
      console.log(yellow('Chromium 没装,跳过冒烟测试。要跑请执行:pnpm exec playwright install chromium'))
      return
    }
  } catch {
    /* 探测失败就当能跑,让 verify.mjs 自己去报错 */
  }

  const url = `http://localhost:${DEV_PORT}/`
  const reused = await isServerUp(url)
  let dev = null

  if (reused) {
    console.log(gray(`  ${DEV_PORT} 端口上已有服务,直接复用(测试结束不会关它)`))
  } else {
    const bin = viteBin()
    if (!fs.existsSync(bin)) {
      console.log(yellow(`  找不到 ${bin},跳过冒烟测试`))
      return
    }
    console.log(gray(`  启动 dev server: vite --port ${DEV_PORT} --strictPort`))
    // 整条命令拼成字符串再交给 shell:Windows 下 vite.cmd 必须过 shell,
    // 而"带 args 数组 + shell:true"在 Node 上已弃用(DEP0190)。参数全是常量,没有注入面。
    dev = spawn(`"${bin}" --port ${DEV_PORT} --strictPort`, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    })
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (await isServerUp(url)) break
      await sleep(500)
    }
    if (!(await isServerUp(url))) {
      killProcessTree(dev.pid)
      throw new Error(`dev server 60s 内没起来(${url});手动跑 \`${runScript('dev')}\` 看看报什么`)
    }
  }

  try {
    run(`"${process.execPath}" scripts/verify.mjs`, {
      cwd: rootDir,
      timeout: 300000,
    })
  } finally {
    if (dev && !reused) {
      killProcessTree(dev.pid)
      console.log(gray('  已关掉临时 dev server'))
    }
  }
  console.log(green('冒烟测试通过(详细截图见 verify-output/)'))
}

// ===========================================================================
// 4. 构建
// ===========================================================================

function buildLibrary() {
  if (SKIP_BUILD) {
    console.log(yellow('\n--skip-build: 跳过构建(发布物自检也会跟着跳过,这次的自检结论无效)'))
    return
  }
  console.log(blue('\n=== 构建库产物 ==='))
  // 拆成两步跑,失败时能一眼看出是类型声明的问题还是打包的问题
  run(runScript('build:types'))
  run(runScript('build:lib'))
  for (const f of ['dist/flow-mindmap.js', 'dist/flow-mindmap.umd.cjs', 'dist/style.css', 'dist/entry.d.ts']) {
    if (!fs.existsSync(path.join(rootDir, f))) {
      throw new Error(`构建结束但缺少 ${f},检查 vite.config.ts / tsconfig.build.json`)
    }
  }
  console.log(green('构建完成(版本号已由 vite define 烘进产物)'))
}

// ===========================================================================
// 5. README 截图 / CDN 版本号
// ===========================================================================

async function regenerateScreenshots() {
  console.log(blue('\n=== 重跑 README 截图 ==='))
  if (DRY_RUN) {
    console.log(yellow('[dry-run] 跳过 node scripts/screenshots.mjs'))
    return
  }
  const demoModules = path.join(rootDir, 'demo', 'node_modules')
  if (!fs.existsSync(demoModules)) {
    console.log(yellow('demo/ 依赖没装,先装(截图脚本要用 demo/ 的 vite)...'))
    run(`${PM} install${PM === 'pnpm' ? ' --frozen-lockfile' : ''}`, { cwd: path.join(rootDir, 'demo') })
  }
  run(`"${process.execPath}" scripts/screenshots.mjs`, { timeout: 300000 })
  console.log(green('截图已写入 docs/screenshots/'))
}

// README 里的截图走 jsDelivr 的 gh 通道,URL 上钉着 git tag(@vX.Y.Z)。
// 版本号不跟着走的话,README 会长时间指着旧 tag 的图(npm 页面也跟着旧)。
// 图片本身是入库的,所以钉到新 tag 依然取得到 —— 不重跑截图也安全。
function syncReadmeCdnTag(version) {
  if (SKIP_README) {
    console.log(yellow('\n--skip-readme: 不更新 README 里的 jsDelivr 版本号'))
    return
  }
  console.log(blue('\n=== 对齐 README 的 jsDelivr 版本号 ==='))
  const file = path.join(rootDir, 'README.md')
  const original = fs.readFileSync(file, 'utf8')
  const tag = `${TAG_PREFIX}${version}`
  const re = new RegExp(`(cdn\\.jsdelivr\\.net/gh/[^/]+/[^/]+@)v[0-9A-Za-z.\\-]+`, 'g')
  const hits = original.match(re) || []
  if (hits.length === 0) {
    console.log(gray('  README 里没有 jsDelivr 版本化链接,跳过'))
    return
  }
  const updated = original.replace(re, `$1${tag}`)
  if (updated === original) {
    console.log(gray(`  README 已经指向 ${tag},无需改动`))
    return
  }
  remember('README.md')
  if (DRY_RUN) {
    console.log(yellow(`[dry-run] README.md 里 ${hits.length} 处 jsDelivr 链接 -> ${tag}`))
    return
  }
  fs.writeFileSync(file, updated, 'utf8')
  console.log(green(`README.md 里 ${hits.length} 处 jsDelivr 链接已指向 ${tag}`))
}

// ===========================================================================
// 6. 发布物自检
// ===========================================================================

// 从 package.json 的入口字段里推出"发布物必须包含哪些文件"。
// 不硬编码文件名:main/module/types/exports 改了,这里自动跟着变。
function collectEntryPoints(pkg) {
  const wanted = new Set()
  const add = (p) => {
    if (typeof p === 'string' && p.startsWith('.')) wanted.add(p.replace(/^\.\//, ''))
  }
  add(pkg.main)
  add(pkg.module)
  add(pkg.types)
  const walkExports = (node) => {
    if (typeof node === 'string') return add(node)
    if (node && typeof node === 'object') Object.values(node).forEach(walkExports)
  }
  walkExports(pkg.exports)
  return [...wanted]
}

// `files` 白名单里的条目有两种写法:目录名(`dist`)和 glob(`docs/**`)。
// 判断"进了包没"要按前缀算:`dist` 命中 `dist/flow-mindmap.js` 才算数。
function packedCovers(paths, entry) {
  const prefix = entry.replace(/\/\*\*$/, '').replace(/\/$/, '')
  return paths.some((p) => p === prefix || p.startsWith(prefix + '/'))
}

function verifyPackageContents() {
  if (SKIP_BUILD) {
    console.log(yellow('\n--skip-build: 跳过发布物自检(没有新构建的产物,自检结论无效)'))
    return
  }
  console.log(blue('\n=== 发布物自检 ==='))

  let packJson
  try {
    const out = capture(`npm pack --dry-run --json ${REGISTRY_ARG}`, { timeout: 180000 })
    // npm 会在 JSON 前后混提示行,取第一个 '[' 到最后一个 ']' 之间
    packJson = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1))
  } catch (err) {
    throw new Error(`npm pack --dry-run 失败:${err.message || err}`)
  }

  const packed = new Set((packJson[0]?.files || []).map((f) => f.path))
  if (packed.size === 0) throw new Error('npm pack 打出了空包')

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))

  // ① files 白名单里的每一条都得真进包 —— 防 .npmignore / .gitignore 反手排除
  const packedList = [...packed]
  const missingFiles = (pkg.files || []).filter((entry) => !packedCovers(packedList, entry))
  if (missingFiles.length) {
    throw new Error(
      `files 白名单里有 ${missingFiles.length} 条没进包(大概率被 ignore 规则排除了):\n`
      + missingFiles.map((e) => `  - ${e}`).join('\n')
    )
  }

  // ② 入口字段指向的文件必须存在 —— 这是"用户 import 得到东西"的底线
  const entryPoints = collectEntryPoints(pkg)
  const missingEntries = entryPoints.filter((p) => !packed.has(p))
  if (missingEntries.length) {
    throw new Error(
      '入口字段指向的文件不在包里(装上去就是 Cannot find module):\n'
      + missingEntries.map((e) => `  - ${e}`).join('\n')
      + '\n先跑 `pnpm build`(或去掉 --skip-build)再发。'
    )
  }

  // ③ dist 里至少要有构建产物,而不是空目录
  const distCount = [...packed].filter((p) => p.startsWith('dist/')).length
  if (distCount === 0) {
    throw new Error('包里一个 dist/ 文件都没有 —— 构建没跑或产物被清空了')
  }

  console.log(green(
    `① files 白名单 ${(pkg.files || []).length} 条全部命中`
    + `\n② 入口文件 ${entryPoints.length} 个齐全(${entryPoints.join(', ')})`
    + `\n③ 共 ${packed.size} 个文件入包,其中 dist/ ${distCount} 个`
  ))
}

// ===========================================================================
// 7. 提交 / tag / push
// ===========================================================================

// 只 stage 白名单;目录按前缀匹配。stage 完再核一遍 staged 清单没越界。
// 返回真正进 staging 的文件列表(空 = 没东西可提交,例如"上次 commit 过了只差 publish"的重跑)。
function stageReleaseFiles() {
  if (DRY_RUN) {
    // dry-run 不真 add,但把"将会进提交的文件"算出来:一是让计划看得见,
    // 二是让下面 tag 冲突的判定在 dry-run 下同样有意义
    const wouldStage = capture(`git diff --name-only HEAD -- ${RELEASE_FILES.join(' ')}`, {
      timeout: 15000,
    })
      .split(/\r?\n/)
      .filter(Boolean)
    console.log(gray(wouldStage.length
      ? `  将会提交 ${wouldStage.length} 个文件: ${wouldStage.join(', ')}`
      : '  白名单里没有改动(提交会是个空提交)'))
    return wouldStage
  }

  console.log(gray('stage 白名单文件(避免 `git add -A` 把 scripts/ 下的调试脚本卷进来)...'))
  for (const entry of RELEASE_FILES) {
    if (!fs.existsSync(path.join(rootDir, entry))) continue
    execSync(`git add ${q(entry)}`, { cwd: rootDir, stdio: 'inherit' })
  }

  const staged = capture('git diff --cached --name-only', { timeout: 15000 })
    .split(/\r?\n/)
    .filter(Boolean)
  const unexpected = staged.filter(
    (f) => !RELEASE_FILES.some((entry) => f === entry || f.startsWith(entry + '/'))
  )
  if (unexpected.length) {
    console.error(red('staged 范围超出白名单,中止提交:'))
    for (const f of unexpected) console.error('  - ' + f)
    throw new Error('staged 文件越界')
  }
  if (staged.length === 0) {
    console.log(yellow('白名单里没有改动可提交'))
  } else {
    console.log(gray(
      `  本次提交 ${staged.length} 个文件: `
      + staged.slice(0, 5).join(', ') + (staged.length > 5 ? ' ...' : '')
    ))
  }
  return staged
}

// tag 指向哪个提交;不存在返回 null。
// 用 `rev-list -n 1` 而不是 `rev-parse <tag>^{commit}`:Windows 上 execSync 走 cmd.exe,
// 而 `^` 在 cmd 里是转义符,`^{commit}` 传到 git 时已经变成 `{commit}` —— 命令失败、
// 返回 null,于是"tag 冲突"这种该拦的情况会被静默放过(实测踩过)。
function readTagCommit(tag) {
  try {
    return capture(`git rev-list -n 1 refs/tags/${tag}`, { timeout: 15000 })
  } catch {
    return null
  }
}

async function commitChanges(version) {
  console.log(blue('\n=== 提交 + 打 tag + push ==='))
  await checkAndCleanGitLocks()

  const tag = `${TAG_PREFIX}${version}`
  const message = `chore(release): ${tag}`

  const staged = stageReleaseFiles()
  const tagCommit = readTagCommit(tag)

  // tag 已存在 + 又有新改动 = 上次跑到一半留下的状态。此时若照常提交,
  // 新提交和旧 tag 会错位(README 的 CDN 链接会指向错误的提交),所以在提交前就停。
  if (tagCommit && staged.length > 0) {
    throw new Error(
      `tag ${tag} 已经存在(上次发布跑到一半留下的?),而这次又有新的白名单改动。\n`
      + '继续提交会让新提交和这个 tag 错位。两种走法:\n'
      + `  · 只是上次没发完:先把改动还原(git checkout -- package.json README.md),再用 --version=${version} 重跑\n`
      + '  · 确实要发新内容:换个版本号例如 --version=<更大的版本>,或先手动删掉旧 tag'
    )
  }

  if (staged.length > 0) {
    if (DRY_RUN) {
      console.log(yellow(`[dry-run] git commit --no-verify -m "${message}"`))
    } else {
      run(`git commit --no-verify -m "${message}"`)
      console.log(green(`已提交: "${message}"`))
    }
  } else if (!DRY_RUN) {
    console.log(yellow('没有新改动要提交(重跑场景),直接沿用已有提交'))
  }

  if (tagCommit) {
    console.log(gray(`tag ${tag} 已存在,跳过创建`))
  } else if (DRY_RUN) {
    console.log(yellow(`[dry-run] git tag ${tag}`))
  } else {
    execSync(`git tag ${tag}`, { cwd: rootDir, stdio: 'inherit' })
    console.log(green(`已创建标签: ${tag}`))
  }

  if (SKIP_PUSH) {
    console.log(yellow('--skip-push: 跳过 git push'))
    return
  }

  const branch = capture('git rev-parse --abbrev-ref HEAD', { timeout: 15000 })
  if (DRY_RUN) {
    console.log(yellow(`[dry-run] git push ${GIT_REMOTE} ${branch}`))
    console.log(yellow(`[dry-run] git push ${GIT_REMOTE} ${tag}`))
    return
  }
  try {
    console.log(gray(`推送代码到 ${GIT_REMOTE}/${branch}...`))
    run(`git push ${GIT_REMOTE} ${branch}`)
    console.log(gray('推送 tag...'))
    run(`git push ${GIT_REMOTE} ${tag}`)
    console.log(green('代码和 tag 已推送'))
  } catch (err) {
    // 推送失败不阻塞 npm 发布:包已经能装,git 那边用户自己补推一次就好
    console.error(red('推送失败(不阻塞 npm 发布):'), err.message || err)
    console.error(yellow(`  稍后手动补推:git push ${GIT_REMOTE} ${branch} && git push ${GIT_REMOTE} ${tag}`))
  }
}

// ===========================================================================
// 8. 发布
// ===========================================================================

function publishToNpm(version, distTag) {
  console.log(blue('\n=== 发布到 NPM ==='))
  const cmd = `npm publish --tag ${distTag} ${REGISTRY_ARG}`
  console.log(gray(`  ${PKG_NAME}@${version} -> dist-tag: ${distTag}`))

  if (DRY_RUN) {
    console.log(yellow(`[dry-run] ${cmd}`))
    return
  }

  try {
    run(cmd)
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    let hint = ''
    if (/EOTP|one-time password/i.test(out)) {
      hint = '账号开了 2FA:publish 时把一次性验证码带上(npm publish --otp=<6位>)'
    } else if (/E403|forbidden|cannot publish over/i.test(out)) {
      hint = `没权限或版本已存在:确认登录账号是 ${PKG_NAME} 的 owner,且 ${version} 没被发过`
    } else if (/EPUBLISHCONFLICT/i.test(out)) {
      hint = '版本号已被占用:换个版本号(--version=)重跑'
    } else if (/ENEEDAUTH|401/i.test(out)) {
      hint = `未登录:先 npm login ${REGISTRY_ARG}`
    } else if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(out)) {
      hint = '网络问题:重试一次;国内网络可考虑配置代理后再发'
    }
    throw new Error(`npm publish 失败${hint ? `(${hint})` : ''}:${out.split(/\r?\n/).find(Boolean) || err.message}`)
  }
  console.log(green(`已发布 ${PKG_NAME}@${version} (dist-tag: ${distTag})`))
}

// ===========================================================================
// 9. 发布后校验
// ===========================================================================

// tarball 地址。cacheBust=true 时挂个时间戳绕开 CDN 的负缓存(见文件头注释)。
function tarballUrl(version, cacheBust = false) {
  const base = `${NPM_REGISTRY.replace(/\/$/, '')}/${PKG_NAME}/-/${PKG_NAME}-${version}.tgz`
  return cacheBust ? `${base}?t=${Date.now()}` : base
}

// GET(Range: bytes=0-0)探一次 tarball 是否可取 —— npm 真下载用 GET,所以只认 GET。
async function probeTarball(version, cacheBust) {
  if (typeof fetch !== 'function') return { ok: true, unknown: true }
  try {
    const res = await fetch(tarballUrl(version, cacheBust), {
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
    })
    const status = res.status
    try {
      await res.body?.cancel()
    } catch {
      /* 流已结束 */
    }
    return { ok: status === 200 || status === 206, status }
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) }
  }
}

async function downloadTarball(version, cacheBust) {
  const res = await fetch(tarballUrl(version, cacheBust), { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const file = path.join(os.tmpdir(), `${PKG_NAME}-${version}-${Date.now()}.tgz`)
  await fsp.writeFile(file, buf)
  return file
}

function tarAvailable() {
  try {
    execSync('tar --version', { stdio: 'ignore', timeout: 15000 })
    return true
  } catch {
    return false
  }
}

// 把线上 tarball 的清单拉出来,对着 package.json 该有的东西逐条核对。
// tar 不可用(极老的 Windows)时返回 null,由调用方降级成"只确认版本可见"。
//
// 注意 tar 的调用方式:先切到 tarball 所在目录(os.tmpdir()),只传**文件名**。
// 不能传绝对路径 —— Windows 上 `tar -tzf C:/Users/.../x.tgz` 会被 GNU tar 当成
// 远程主机写法(`主机:路径`),报 "Cannot connect to C: resolve failed"(实测踩过)。
// 相对文件名里没有冒号,msys 的 GNU tar 和 Windows 自带的 bsdtar 都能认。
function inspectPublishedTarball(file, pkg) {
  const dir = path.dirname(file)
  const base = path.basename(file)
  let entries
  try {
    entries = capture(`tar -tzf ${base}`, { cwd: dir, timeout: 120000 })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch (err) {
    return { error: `tar -tzf 失败:${err.message || err}` }
  }
  const set = new Set(entries)
  // tarball 里一律是 `package/xxx`,剥掉前缀好跟 package.json 里的相对路径对齐
  const rel = entries.map((p) => p.replace(/^package\//, ''))

  const problems = []
  for (const entry of pkg.files || []) {
    if (!packedCovers(rel, entry)) problems.push(`files 白名单里的 ${entry} 不在线上包里`)
  }
  for (const p of collectEntryPoints(pkg)) {
    if (!set.has(`package/${p}`)) problems.push(`入口文件 package/${p} 不在线上包里`)
  }
  if (!set.has('package/package.json')) problems.push('package/package.json 不在线上包里')

  // 包里那份 package.json 的版本号必须就是这次发的版本(防"发的是上一份产物")
  let innerVersion = null
  try {
    const raw = capture(`tar -xzOf ${base} package/package.json`, { cwd: dir, timeout: 60000 })
    innerVersion = JSON.parse(raw).version
  } catch (err) {
    problems.push(`读包内 package.json 失败:${err.message || err}`)
  }

  return { entries, problems, innerVersion }
}

async function verifyPublished(version, distTag) {
  console.log(blue('\n=== 发布后校验(线上发布物) ==='))
  console.log(gray('publish 成功 ≠ packument 立即可见、也 ≠ tarball 立即可取(两种先后顺序都出现过)。'))
  console.log(gray(`间隔 ${POLL_INTERVAL_MS / 1000}s,上限 ${POLL_TIMEOUT_MS / 1000}s(可用 --poll-interval / --poll-timeout 调)`))

  const startedAt = Date.now()
  const deadline = startedAt + POLL_TIMEOUT_MS
  const canTar = tarAvailable()
  if (!canTar) console.log(yellow('  系统没有 tar,只能确认版本可见,跳过包内容核对'))

  let attempt = 0
  let lastProblem = ''
  for (;;) {
    attempt += 1
    const bust = attempt > 1
    let visible = null
    try {
      visible = queryPublishedVersion(version)
    } catch (err) {
      lastProblem = err.message
    }
    const probe = await probeTarball(version, bust)

    console.log(gray(
      `第 ${attempt} 次尝试(packument ${visible === version ? '已可见' : '还没这个版本'},`
      + ` tarball ${probe.ok ? '已可取' : `还取不到${probe.status ? ` HTTP ${probe.status}` : ''}`})...`
    ))

    if (probe.ok) {
      // tarball 一旦可取,先核对内容 —— 它比 packument 更接近"用户真正装到的东西",
      // 而且 packument 滞后时这条信息照样拿得到(见文件头两种先后顺序的说明)。
      if (!canTar) {
        if (visible === version) {
          console.log(green(`线上已可见 ${PKG_NAME}@${version}(未核对包内容:系统没有 tar)`))
          return
        }
        lastProblem = 'packument 还没翻牌,且系统没有 tar 无法核对包内容'
      } else {
        let file = null
        try {
          file = await downloadTarball(version, bust)
          const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
          const res = inspectPublishedTarball(file, pkg)
          if (res.error) {
            lastProblem = res.error
            console.log(yellow(`  ✗ ${res.error}`))
          } else if (res.problems.length) {
            lastProblem = res.problems.join('; ')
            console.log(red('  ✗ 线上包内容不全:'))
            for (const p of res.problems) console.log(red(`    - ${p}`))
          } else if (res.innerVersion !== version) {
            lastProblem = `包内 package.json 版本是 ${res.innerVersion},不是 ${version}`
            console.log(yellow(`  ✗ ${lastProblem}`))
          } else if (visible !== version) {
            lastProblem = '包内容已核对无误,但 packument 还没翻牌(dist-tags 滞后)'
            console.log(yellow(`  · ${lastProblem},继续等`))
          } else {
            const cost = ((Date.now() - startedAt) / 1000).toFixed(1)
            console.log(green(
              `线上发布物核对通过(第 ${attempt} 次尝试,耗时 ${cost}s):`
              + `\n  · ${PKG_NAME}@${version} 已挂在 dist-tag "${distTag}" 上`
              + `\n  · tarball 里 ${res.entries.length} 个文件,files/入口/dist 全部命中,包内版本号一致`
            ))
            console.log(gray(`  · 装一下试试:npm i ${PKG_NAME}@${version}`))
            console.log(gray(
              '  · README 截图走 jsDelivr 的 gh 通道,新 tag 的图可能几分钟后才生效:\n'
              + `    https://cdn.jsdelivr.net/gh/xz333221/flow-mindmap@${TAG_PREFIX}${version}/docs/screenshots/overview.png`
            ))
            return
          }
        } catch (err) {
          lastProblem = err.message || String(err)
          console.log(yellow(`  ✗ ${lastProblem}`))
        } finally {
          if (file) await fsp.rm(file, { force: true }).catch(() => {})
        }
      }
    } else if (probe.status && probe.status !== 404) {
      lastProblem = `tarball 探测返回 HTTP ${probe.status}`
    } else {
      lastProblem = 'tarball 还取不到(registry 处理中 / CDN 还在传播)'
    }

    const remain = deadline - Date.now()
    if (remain <= 0) {
      console.error(red(`\n已尝试 ${attempt} 次,仍无法确认 ${PKG_NAME}@${version} 完整上线`))
      console.error(gray(`最后一次的原因:${lastProblem || '未知'}`))
      console.error(yellow(
        '包很可能已经发出去了,只是 registry / CDN 还没传播完。稍后手动确认:\n'
        + `  npm view ${PKG_NAME}@${version} version ${REGISTRY_ARG}\n`
        + `  npm i ${PKG_NAME}@${version}   # 装一下最直接\n`
        + `  ${tarballUrl(version)}\n`
        + '若确认包里缺文件,别用同一个版本号重发(发不上去),升个版本再发。'
      ))
      return
    }
    console.log(gray(`  ${Math.ceil(remain / 1000)}s 后重试`))
    await sleep(Math.min(POLL_INTERVAL_MS, remain))
  }
}

// ===========================================================================
// 主流程
// ===========================================================================

async function main() {
  console.log(cyan(bold(`\n🚀 flow-mindmap 发布流程${DRY_RUN ? '(DRY RUN)' : ''}\n`)))
  if (DRY_RUN) {
    console.log(yellow('--dry-run: 不改 package.json / 不 commit / 不 publish,只打印计划'))
    console.log(yellow('--dry-run: 类型检查 / 单测 / 构建仍然真跑(所以能在失败前中止)'))
  }
  if (SKIP_TESTS) console.log(yellow('--skip-tests: 跳过单测'))
  if (SKIP_SMOKE) console.log(yellow('--skip-smoke: 跳过浏览器冒烟'))
  if (SKIP_BUILD) console.log(yellow('--skip-build: 跳过构建(发布物自检一并跳过)'))
  if (SKIP_PUSH) console.log(yellow('--skip-push: 不 push git'))
  if (SCREENSHOTS) console.log(yellow('--screenshots: 会重跑 README 截图'))
  if (SKIP_README) console.log(yellow('--skip-readme: 不动 README 的 jsDelivr 版本号'))
  console.log(gray(`包管理器: ${PM} ${PM_VERSION} / registry: ${NPM_REGISTRY}\n`))

  // 只做发布后校验:不进构建/提交/发布,连环境自检都跳过(事后核查不该被工作区状态拦住)
  if (VERIFY_ONLY) {
    const version = VERIFY_ONLY_VERSION || readLocalVersion()
    console.log(cyan(`只核对线上发布物:${PKG_NAME}@${version}(--verify-only)`))
    await verifyPublished(version, resolveDistTag(version))
    return
  }

  try {
    ensureDeps()
    await checkEnvironment()

    const currentVersion = readLocalVersion()
    const newVersion = computeNextVersion(currentVersion)
    const distTag = resolveDistTag(newVersion)
    assertVersionPublishable(newVersion)

    runTypeCheck()
    runUnitTests()
    await runSmokeTest()

    console.log(blue('\n=== 更新版本号 ==='))
    writeVersion(newVersion)

    buildLibrary()
    if (SCREENSHOTS) await regenerateScreenshots()
    syncReadmeCdnTag(newVersion)

    verifyPackageContents()

    await commitChanges(newVersion)
    committed = true

    publishToNpm(newVersion, distTag)

    if (DRY_RUN || SKIP_VERIFY_PUBLISHED) {
      console.log(yellow(
        DRY_RUN
          ? '\n[dry-run] 跳过发布后校验(没有真的发布)'
          : '\n--skip-verify-published: 不去核对线上发布物'
      ))
      console.log(yellow('  手动确认:'))
      console.log(yellow(`    npm view ${PKG_NAME}@${newVersion} version ${REGISTRY_ARG}`))
    } else {
      await verifyPublished(newVersion, distTag)
    }

    console.log(green(bold('\n🎉 发布完成!')))
    if (!SKIP_PUSH && !DRY_RUN) {
      console.log(gray(`git: ${GIT_REMOTE} 已推送分支 + tag ${TAG_PREFIX}${newVersion}`))
    }
    console.log(gray(`npm: ${PKG_NAME}@${newVersion} (dist-tag: ${distTag})`))
  } catch (err) {
    if (!committed) await rollbackUncommitted()
    else {
      console.error(yellow(
        `\n注意:提交已经产生(chore(release): ${TAG_PREFIX}${readLocalVersion()}),`
        + '工作区不再回滚。修好问题后用 `--version=<同一个版本号>` 重跑,避免版本号漂移。'
      ))
    }
    throw err
  }
}

main().catch((err) => {
  console.error(red(`\n❌ 发布失败:${err?.message || err}`))
  process.exit(1)
})
