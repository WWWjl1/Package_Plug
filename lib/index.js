/**
 * 芯片封装学习 · 常驻版插件 —— Host 半
 * ---------------------------------------------------------------------------
 * 这是一个正式的 dsh 主机插件（不是动态插件），随 profile 启动自动挂载。
 *
 * 它做两件事：
 *   1. 用 import.meta.url 自定位数据目录 —— 插件包目录本身就是课程数据目录。
 *      所以没有硬编码路径问题：仓库 clone 到哪，插件就认哪。
 *      也可以用插件行 config.root 覆盖。
 *   2. 注册一个 HTTP 路由 /package-learn/api，给浏览器里的 Client 半提供
 *      「读课程 / 存进度」的接口（动态插件那种私有 RPC 在常驻插件里不存在）。
 *
 * 安全约定：apply() 里任何分支都不抛错。行不加载最多是「界面不出来」，
 * 绝不能让整棵插件树启动失败（那会导致 dsh 开不了机）。
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'package-learn'
export const inject = ['webServer']

/** 本文件位于 <包目录>/lib/index.js，所以向上一级就是包目录。 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ROUTE = '/package-learn/api'

export function apply(ctx, config) {
  const root = (config && typeof config.root === 'string' && config.root !== '')
    ? config.root
    : PACKAGE_ROOT

  const webServer = ctx.get('webServer')
  const registry = ctx.get('workspaceRegistry')

  const abs = (rel) => join(root, rel)
  const nowIso = () => new Date().toISOString()

  async function readText(rel) {
    return await readFile(abs(rel), 'utf8')
  }

  async function readJson(rel, fallback) {
    try {
      return JSON.parse(await readText(rel))
    } catch (error) {
      ctx.logger?.debug?.('package-learn: cannot read ' + rel + ' :: ' + String((error && error.message) || error))
      return fallback
    }
  }

  async function writeJson(rel, value) {
    await writeFile(abs(rel), JSON.stringify(value, null, 2), 'utf8')
  }

  // ---------------------------------------------------------------- 接口实现
  // 与阶段一动态插件的 harness.handle 一一对应，方法名保持不变。
  const methods = {
    async gate() {
      const session = await readJson('progress/session.json', null)
      const ui = await readJson('progress/ui.json', null)
      return {
        root,
        sessionId: (session && session.sessionId) || '',
        visited: !!(ui && ui.visited),
      }
    },

    async 'mark-visited'() {
      const cur = await readJson('progress/ui.json', null)
      await writeJson('progress/ui.json', Object.assign({ version: 1 }, cur || {}, { visited: true, updatedAt: nowIso() }))
      return { ok: true }
    },

    async load() {
      const map = await readJson('content/tracks.json', { tracks: [] })
      const tracks = Array.isArray(map && map.tracks) ? map.tracks : []
      const courses = {}
      const svgs = {}
      for (const track of tracks) {
        const list = Array.isArray(track && track.processes) ? track.processes : []
        for (const proc of list) {
          if (!proc || proc.status !== 'ready' || typeof proc.file !== 'string') continue
          const course = await readJson('content/' + proc.file, null)
          if (course === null) continue
          courses[proc.id] = course
          const points = Array.isArray(course.points) ? course.points : []
          for (const point of points) {
            const body = Array.isArray(point && point.body) ? point.body : []
            for (const block of body) {
              if (!block || block.type !== 'figure' || typeof block.svg !== 'string') continue
              if (svgs[block.svg] !== undefined) continue
              try {
                svgs[block.svg] = await readText('assets/' + block.svg)
              } catch (error) {
                svgs[block.svg] = ''
              }
            }
          }
        }
      }
      const progress = await readJson('progress/state.json', { version: 1, points: {} })
      const quiz = await readJson('progress/quiz.json', { version: 1, attempts: [], wrong: {} })
      return {
        root,
        tracks,
        courses,
        svgs,
        points: (progress && progress.points) || {},
        wrong: (quiz && quiz.wrong) || {},
      }
    },

    async 'get-session'() {
      const saved = await readJson('progress/session.json', null)
      const sid = saved && saved.sessionId
      if (typeof sid !== 'string' || sid === '') return { ok: false }
      return { ok: true, sessionId: sid }
    },

    async 'save-session'(args) {
      const sid = args && args.sessionId
      if (typeof sid !== 'string' || sid === '') return { ok: false }
      await writeJson('progress/session.json', { version: 1, sessionId: sid, updatedAt: nowIso() })
      return { ok: true }
    },

    /**
     * 清掉已失效的学习会话指针。
     * 会话被用户删掉之后，sessions.open() 会对未知 id 直接抛错；
     * 如果这时客户端服务恰好取不到、新建不出会话，指针就会一直烂在那里，
     * 学习界面每次进来都只会说「请点侧栏入口」。这个方法是那条退路。
     */
    async 'forget-session'(args) {
      const stale = args && args.sessionId
      const cur = await readJson('progress/session.json', null)
      const curId = (cur && cur.sessionId) || ''
      // 只清「确实还是同一个失效 id」的情况，避免把刚新建的会话误删
      if (typeof stale === 'string' && stale !== '' && curId !== '' && curId !== stale) {
        return { ok: true, kept: curId }
      }
      await writeJson('progress/session.json', { version: 1, sessionId: '', clearedAt: nowIso() })
      return { ok: true, cleared: curId }
    },

    async 'set-status'(args) {
      const id = args && args.id
      const status = args && args.status
      if (typeof id !== 'string' || id === '') return { ok: false, reason: 'bad-id' }
      if (status !== 'unseen' && status !== 'learning' && status !== 'mastered') return { ok: false, reason: 'bad-status' }
      const cur = await readJson('progress/state.json', { version: 1, points: {} })
      const points = (cur && typeof cur.points === 'object' && cur.points !== null) ? cur.points : {}
      // 注意：这里必须是「合并」而不是「覆盖」。
      // E2 的复习记录（reviewCount / reviewedAt）就存在同一个条目里，
      // 覆盖式写法会在每次点「标记为已掌握」时把复习进度悄悄抹掉。
      const prev = (points[id] && typeof points[id] === 'object') ? points[id] : {}
      points[id] = Object.assign({}, prev, { status, updatedAt: nowIso() })
      const next = { version: 1, updatedAt: nowIso(), points }
      if (cur && typeof cur.note === 'string') next.note = cur.note
      await writeJson('progress/state.json', next)
      return { ok: true, id, status }
    },

    /**
     * E2 复习提醒：记一次「复习过了」。
     * reviewCount 决定下一次的间隔（间隔阶梯在客户端，这里只负责计数与时间戳）。
     */
    async 'record-review'(args) {
      const id = args && args.id
      if (typeof id !== 'string' || id === '') return { ok: false, reason: 'bad-id' }
      const cur = await readJson('progress/state.json', { version: 1, points: {} })
      const points = (cur && typeof cur.points === 'object' && cur.points !== null) ? cur.points : {}
      const prev = (points[id] && typeof points[id] === 'object') ? points[id] : {}
      const count = Number.isInteger(prev.reviewCount) && prev.reviewCount >= 0 ? prev.reviewCount : 0
      const at = nowIso()
      points[id] = Object.assign({}, prev, {
        // 复习一个还没标记过的点，就当作「在学」，别把它悄悄升级成已掌握
        status: prev.status === 'mastered' ? 'mastered' : (prev.status || 'learning'),
        reviewCount: count + 1,
        reviewedAt: at,
        updatedAt: prev.updatedAt || at,
      })
      const next = { version: 1, updatedAt: at, points }
      if (cur && typeof cur.note === 'string') next.note = cur.note
      await writeJson('progress/state.json', next)
      return { ok: true, id, reviewCount: count + 1, reviewedAt: at }
    },

    async 'record-quiz'(args) {
      const cur = await readJson('progress/quiz.json', { version: 1, attempts: [], wrong: {} })
      const attempts = Array.isArray(cur && cur.attempts) ? cur.attempts.slice(-499) : []
      if (args && args.attempt) attempts.push(args.attempt)
      const wrong = (cur && typeof cur.wrong === 'object' && cur.wrong !== null) ? cur.wrong : {}
      const pid = args && args.pointId
      const index = args && args.index
      if (typeof pid === 'string' && typeof index === 'number') {
        const list = Array.isArray(wrong[pid]) ? wrong[pid] : []
        const has = list.indexOf(index) >= 0
        if (args.correct === true) {
          if (has) wrong[pid] = list.filter((n) => n !== index)
        } else if (!has) {
          wrong[pid] = list.concat([index])
        }
      }
      const next = { version: 1, attempts, wrong }
      if (cur && typeof cur.note === 'string') next.note = cur.note
      await writeJson('progress/quiz.json', next)
      return { ok: true }
    },

    /**
     * E1 进度导出：把「你个人的学习记录」打包成一个 JSON 交出去。
     *
     * 刻意**不带** session.json：会话 id 是这台机器上的，换台机器导进去只会是个
     * 失效指针（界面会自己走 C3 那套自愈新建一个），带着反而添乱。
     */
    async 'export-progress'() {
      const state = await readJson('progress/state.json', { version: 1, points: {} })
      const quiz = await readJson('progress/quiz.json', { version: 1, attempts: [], wrong: {} })
      const ui = await readJson('progress/ui.json', { version: 1 })
      return {
        format: 'dsh-package-learn/progress',
        formatVersion: 1,
        exportedAt: nowIso(),
        root,
        state,
        quiz,
        ui,
      }
    },

    /**
     * E1 进度导入。
     * 覆盖之前先把现有的三份文件抄进 progress/backups/<时间戳>/，
     * 这样「导入错了」永远救得回来 —— 导入是不可逆操作，没有备份就不该允许。
     */
    async 'import-progress'(args) {
      const bundle = args && args.bundle
      if (!bundle || typeof bundle !== 'object') return { ok: false, reason: 'bad-bundle' }

      const state = bundle.state
      const quiz = bundle.quiz
      if (!state || typeof state !== 'object' || typeof state.points !== 'object' || state.points === null) {
        return { ok: false, reason: 'bad-state' }
      }
      if (!quiz || typeof quiz !== 'object' || typeof quiz.wrong !== 'object' || quiz.wrong === null) {
        return { ok: false, reason: 'bad-quiz' }
      }
      // 逐条验状态值：宁可整包拒掉，也不要把界面读不懂的脏数据写进去
      const ids = Object.keys(state.points)
      if (ids.length > 20000) return { ok: false, reason: 'too-many-points' }
      for (const id of ids) {
        const entry = state.points[id]
        if (!entry || typeof entry !== 'object') return { ok: false, reason: 'bad-point:' + id }
        const st = entry.status
        if (st !== undefined && st !== 'unseen' && st !== 'learning' && st !== 'mastered') {
          return { ok: false, reason: 'bad-status:' + id }
        }
      }
      const wrongIds = Object.keys(quiz.wrong)
      for (const id of wrongIds) {
        if (!Array.isArray(quiz.wrong[id])) return { ok: false, reason: 'bad-wrong:' + id }
      }
      const attempts = Array.isArray(quiz.attempts) ? quiz.attempts.slice(-499) : []

      // 先备份
      const stamp = nowIso().replace(/[:.]/g, '-')
      const backupRel = 'progress/backups/' + stamp
      let backupDir = ''
      try {
        await mkdir(abs(backupRel), { recursive: true })
        for (const name of ['state.json', 'quiz.json', 'ui.json']) {
          const cur = await readJson('progress/' + name, null)
          if (cur === null) continue
          await writeJson(backupRel + '/' + name, cur)
        }
        backupDir = backupRel
      } catch (error) {
        // 备份失败就不许覆盖——这是「不可逆操作」的底线
        return { ok: false, reason: 'backup-failed:' + String((error && error.message) || error) }
      }

      const at = nowIso()
      await writeJson('progress/state.json', { version: 1, updatedAt: at, points: state.points })
      await writeJson('progress/quiz.json', { version: 1, attempts, wrong: quiz.wrong })
      if (bundle.ui && typeof bundle.ui === 'object') {
        const ui = Object.assign({ version: 1 }, bundle.ui, { updatedAt: at })
        await writeJson('progress/ui.json', ui)
      }
      return {
        ok: true,
        points: ids.length,
        wrongPoints: wrongIds.length,
        attempts: attempts.length,
        backupDir,
      }
    },

    /** E1：列出已有的进度备份（界面上给出「导入前会自动备份」的实证） */
    async 'list-backups'() {
      try {
        const names = await readdir(abs('progress/backups'))
        return { ok: true, backups: names.slice(-20).reverse() }
      } catch (error) {
        return { ok: true, backups: [] }
      }
    },

    /**
     * 课程自检：把 JSON 里的结构问题一次性列出来。
     * 以前 JSON 写错只会「静默少显示内容」，铺的内容一多这就是常态，必须有工具。
     */
    async selfcheck() {
      const issues = []
      const add = (level, where, message) => { issues.push({ level, where, message }) }
      const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

      const map = await readJson('content/tracks.json', null)
      if (map === null) {
        add('error', 'content/tracks.json', '读不到或不是合法 JSON')
        return { issues, trackCount: 0, readyCount: 0, pointCount: 0, quizCount: 0 }
      }
      const tracks = Array.isArray(map.tracks) ? map.tracks : []
      if (tracks.length === 0) add('error', 'content/tracks.json', 'tracks 为空或不是数组')

      const pointWhere = {}
      const svgRefs = {}
      // A5：知识点之间的「相关」跳转。指向不存在的 id 时界面会静默少一颗按钮，
      // 所以在自检里挑明，避免内容改着改着链接就断了。
      const relRefs = {}
      let readyCount = 0
      let pointCount = 0
      let quizCount = 0

      for (const track of tracks) {
        if (!track || typeof track !== 'object' || typeof track.id !== 'string') {
          add('error', 'content/tracks.json', '有一个 track 缺少 id')
          continue
        }
        if (typeof track.title !== 'string') add('warn', 'track ' + track.id, '缺少 title')
        const procs = Array.isArray(track.processes) ? track.processes : []
        if (procs.length === 0) add('warn', 'track ' + track.id, 'processes 为空')

        for (const proc of procs) {
          if (!proc || typeof proc !== 'object' || typeof proc.id !== 'string') {
            add('error', 'track ' + track.id, '有工序缺少 id')
            continue
          }
          const where = '工序 ' + proc.id
          if (typeof proc.title !== 'string') add('warn', where, '缺少 title')
          if (proc.status !== 'ready' && proc.status !== 'planned') {
            add('warn', where, 'status 应为 ready 或 planned，当前为 ' + JSON.stringify(proc.status))
          }
          if (proc.status !== 'ready') continue
          readyCount += 1
          if (typeof proc.file !== 'string' || proc.file === '') {
            add('error', where, 'status=ready 但没有 file')
            continue
          }
          const course = await readJson('content/' + proc.file, null)
          if (course === null) {
            add('error', where, '内容文件读不到或 JSON 非法：content/' + proc.file)
            continue
          }
          const points = Array.isArray(course.points) ? course.points : []
          if (points.length === 0) add('warn', where, 'points 为空')

          for (let pi = 0; pi < points.length; pi += 1) {
            const p = points[pi]
            const pwhere = proc.id + '.points[' + pi + ']'
            if (!p || typeof p !== 'object') { add('error', pwhere, '不是对象'); continue }
            if (typeof p.id !== 'string' || p.id === '') { add('error', pwhere, '缺 id'); continue }
            if (has(pointWhere, p.id)) add('error', '细分点 ' + p.id, 'id 重复，另一处：' + pointWhere[p.id])
            else pointWhere[p.id] = pwhere
            if (typeof p.title !== 'string' || p.title === '') add('warn', '细分点 ' + p.id, '缺 title')
            if (typeof p.estMinutes !== 'number') add('warn', '细分点 ' + p.id, '缺 estMinutes（预计学习分钟数）')
            pointCount += 1

            const related = Array.isArray(p.related) ? p.related : []
            for (const rid of related) {
              if (typeof rid !== 'string' || rid === '') { add('error', '细分点 ' + p.id, 'related 里有非字符串项'); continue }
              if (rid === p.id) add('error', '细分点 ' + p.id, 'related 指向了自己')
              if (!has(relRefs, rid)) relRefs[rid] = p.id
            }

            const body = Array.isArray(p.body) ? p.body : []
            if (body.length === 0) add('warn', '细分点 ' + p.id, 'body 为空')
            for (let bi = 0; bi < body.length; bi += 1) {
              const b = body[bi]
              const bwhere = p.id + '.body[' + bi + ']'
              if (!b || typeof b !== 'object' || typeof b.type !== 'string') { add('error', bwhere, '缺 type'); continue }
              const t = b.type
              if (t === 'p' || t === 'h' || t === 'callout') {
                if (typeof b.text !== 'string' || b.text === '') add('error', bwhere, 'type=' + t + ' 需要非空 text')
              } else if (t === 'list') {
                if (!Array.isArray(b.items) || b.items.length === 0) add('error', bwhere, 'type=list 需要非空 items 数组')
              } else if (t === 'table') {
                if (!Array.isArray(b.head)) add('error', bwhere, 'type=table 需要 head 数组')
                if (!Array.isArray(b.rows)) add('error', bwhere, 'type=table 需要 rows 数组')
              } else if (t === 'figure') {
                if (typeof b.svg !== 'string' || b.svg === '') add('error', bwhere, 'type=figure 需要 svg 文件名')
                else if (!has(svgRefs, b.svg)) svgRefs[b.svg] = bwhere
              } else {
                add('warn', bwhere, '未知的块类型：' + t + '（支持：p / h / list / table / figure / callout）')
              }
            }

            const quiz = Array.isArray(p.quiz) ? p.quiz : []
            if (quiz.length === 0) add('warn', '细分点 ' + p.id, '没有小测题')
            for (let qi = 0; qi < quiz.length; qi += 1) {
              const q = quiz[qi]
              const qwhere = p.id + '.quiz[' + qi + ']'
              if (!q || typeof q !== 'object') { add('error', qwhere, '不是对象'); continue }
              if (typeof q.q !== 'string' || q.q === '') add('error', qwhere, '缺题目文本 q')
              if (!Array.isArray(q.options) || q.options.length < 2) add('error', qwhere, 'options 至少要有 2 个选项')
              if (!Number.isInteger(q.answer)) add('error', qwhere, 'answer 必须是整数（选项序号，从 0 开始）')
              else if (Array.isArray(q.options) && (q.answer < 0 || q.answer >= q.options.length)) {
                add('error', qwhere, 'answer=' + q.answer + ' 超出 options 范围（0~' + (q.options.length - 1) + '）')
              }
              if (typeof q.explain !== 'string' || q.explain === '') add('warn', qwhere, '缺解析 explain')
              quizCount += 1
            }
          }
        }
      }

      for (const rid of Object.keys(relRefs)) {
        if (!has(pointWhere, rid)) add('error', '细分点 ' + relRefs[rid], 'related 指向不存在的知识点：' + rid)
      }

      for (const name of Object.keys(svgRefs)) {
        try {
          await readText('assets/' + name)
        } catch (error) {
          add('error', svgRefs[name], '配图找不到：assets/' + name)
        }
      }

      const kn = await readJson('knowledge/points.json', null)
      if (kn === null) {
        add('warn', 'knowledge/points.json', '读不到或 JSON 非法')
      } else {
        const reg = (kn && typeof kn.points === 'object' && kn.points !== null) ? kn.points : {}
        for (const id of Object.keys(pointWhere)) {
          if (!has(reg, id)) add('warn', 'knowledge/points.json', '知识点 ' + id + ' 未登记（不影响显示，但跨线进度互通会失效）')
        }
        for (const id of Object.keys(reg)) {
          if (!has(pointWhere, id)) add('warn', 'knowledge/points.json', '登记了 ' + id + '，但内容里找不到这个知识点')
        }
      }

      const progress = await readJson('progress/state.json', { points: {} })
      const marks = (progress && typeof progress.points === 'object' && progress.points !== null) ? progress.points : {}
      for (const id of Object.keys(marks)) {
        if (!has(pointWhere, id)) add('warn', 'progress/state.json', '进度里有已不存在的知识点：' + id)
      }

      return { issues, trackCount: tracks.length, readyCount, pointCount, quizCount }
    },

    async 'ensure-workspace'() {
      if (registry === undefined) return { ok: false, reason: 'workspace-registry-unavailable' }
      try {
        let ws = await registry.resolveByPath(root)
        if (ws === undefined || ws === null) ws = await registry.create(root, '芯片封装学习')
        const raw = ws && (ws.id !== undefined ? ws.id : ws.workspaceId)
        return { ok: true, workspaceId: raw === undefined ? '' : String(raw), path: root }
      } catch (error) {
        return { ok: false, reason: String((error && error.message) || error) }
      }
    },
  }

  // ------------------------------------------------------------------ 路由
  /**
   * 只挡「浏览器里的别的网页」，判据是 Origin。
   * 跨站的 POST 一定会带上 Origin（fetch / XHR / 表单都一样），而它正好是
   * CSRF 与 DNS rebinding 两种攻击都会暴露的东西：恶意页面的 Origin 就是它自己。
   *
   * 刻意**不**检查 Host 头：
   *   - 挡不住谁——Host 是请求方自己写的，本机程序随便伪造；
   *   - 却可能误伤——桌面版 Electron 壳若用 dsh:// app:// 之类加载页面，
   *     一刀切回环检查会把用户自己的界面也拦掉。
   * 所以不带 Origin 的调用一律放行：那已经属于「本机程序」范畴，
   * 真要挡得靠鉴权，而不是靠一个可以伪造成任何值的头。
   */
  function loopbackHostOf(value) {
    if (typeof value !== 'string' || value === '') return null
    let host = value.trim()
    if (host.startsWith('[')) {
      const end = host.indexOf(']')
      if (end < 0) return null
      return host.slice(1, end).toLowerCase()
    }
    const colon = host.lastIndexOf(':')
    if (colon >= 0) host = host.slice(0, colon)
    return host.toLowerCase()
  }

  function isLoopbackName(name) {
    return name === 'localhost' || name === '127.0.0.1' || name === '::1'
  }

  function originAllowed(req) {
    const origin = ((req && req.headers) || {}).origin
    // 没有 Origin（脚本 / 命令行 / file:// 页面）或 Origin: null：放行
    if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
    let url = null
    try {
      url = new URL(origin)
    } catch (error) {
      return false
    }
    // 非 http(s) 的自定义协议（dsh:// app:// 等）是宿主自己，放行
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
    return isLoopbackName(loopbackHostOf(url.host) || '')
  }

  function send(res, status, value) {
    try {
      const body = JSON.stringify(value)
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(body)
    } catch (error) {
      try { res.statusCode = 500; res.end('{"ok":false}') } catch (ignored) { /* response already gone */ }
    }
  }

  function readBody(req) {
    return new Promise((resolveBody) => {
      let text = ''
      req.on('data', (chunk) => {
        text += chunk
        if (text.length > 2_000_000) text = text.slice(0, 2_000_000)
      })
      req.on('end', () => resolveBody(text))
      req.on('error', () => resolveBody(''))
    })
  }

  async function handle(req, res) {
    try {
      if (!originAllowed(req)) {
        send(res, 403, { ok: false, error: 'forbidden-origin' })
        return
      }
      // 只接受本机同源页面的调用；不做鉴权（与其它本地插件一致），
      // 但只暴露上面这张方法表，不提供任意路径读写。
      if (req.method === 'GET') {
        send(res, 200, { ok: true, value: { root, methods: Object.keys(methods) } })
        return
      }
      if (req.method !== 'POST') {
        send(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const raw = await readBody(req)
      let payload = null
      try {
        payload = raw === '' ? {} : JSON.parse(raw)
      } catch (error) {
        send(res, 400, { ok: false, error: 'bad-json' })
        return
      }
      const method = payload && payload.method
      const handler = (typeof method === 'string' && Object.prototype.hasOwnProperty.call(methods, method))
        ? methods[method]
        : undefined
      if (handler === undefined) {
        send(res, 404, { ok: false, error: 'unknown-method' })
        return
      }
      const value = await handler(payload.args || {})
      send(res, 200, { ok: true, value })
    } catch (error) {
      send(res, 500, { ok: false, error: String((error && error.message) || error) })
    }
  }

  if (webServer === undefined) {
    ctx.logger?.warn?.('package-learn: webServer unavailable; host API not mounted')
    return
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => { handle(req, res) },
  }), 'package-learn: api route')

  ctx.logger?.info?.('package-learn: mounted, root=' + root + ', route=' + ROUTE)
}
