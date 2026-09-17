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

import { readFile, writeFile } from 'node:fs/promises'
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

    async 'set-status'(args) {
      const id = args && args.id
      const status = args && args.status
      if (typeof id !== 'string' || id === '') return { ok: false, reason: 'bad-id' }
      if (status !== 'unseen' && status !== 'learning' && status !== 'mastered') return { ok: false, reason: 'bad-status' }
      const cur = await readJson('progress/state.json', { version: 1, points: {} })
      const points = (cur && typeof cur.points === 'object' && cur.points !== null) ? cur.points : {}
      points[id] = { status, updatedAt: nowIso() }
      const next = { version: 1, updatedAt: nowIso(), points }
      if (cur && typeof cur.note === 'string') next.note = cur.note
      await writeJson('progress/state.json', next)
      return { ok: true, id, status }
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
