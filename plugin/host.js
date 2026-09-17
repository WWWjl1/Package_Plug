/**
 * 芯片封装学习 · 插件 Host 半
 * ---------------------------------------------------------------------------
 * 这一份是「阶段一：动态 Cordis 插件」的 Host 半源码。
 * 用法：把它整份作为 cordis_define 的 code.host 传入（不要加 import / require）。
 *
 * 职责：
 *   1. 读写课程数据文件夹（content / knowledge / progress / assets）
 *   2. 维护「固定学习会话」的 id
 *   3. 给 Client 半提供私有 JSON RPC（harness.handle）
 *
 * 数据根目录目前是写死的常量 ROOT，见下方。
 * 阶段二（常驻插件）会把它改成可配置。
 */

const ROOT = 'D:/Dsh_WorkSpace/Package_Learn_Plug_In'

return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const registry = ctx.get('workspaceRegistry')
    if (fs === undefined) {
      console.error('package-learn: fs service unavailable')
      return
    }

    const join = (rel) => ROOT + '/' + rel
    const nowIso = () => new Date().toISOString()

    async function readText(rel) {
      const target = await fs.resolve(join(rel))
      return await fs.readText(target)
    }

    async function readJson(rel, fallback) {
      try {
        return JSON.parse(await readText(rel))
      } catch (error) {
        console.error('package-learn: cannot read ' + rel + ' :: ' + String((error && error.message) || error))
        return fallback
      }
    }

    async function writeJson(rel, value) {
      const target = await fs.resolve(join(rel))
      await fs.writeText(target, JSON.stringify(value, null, 2))
    }

    // ---------------------------------------------------------------- 门禁
    // Client 半在每次会话加载时都会问一次：这个会话是不是学习会话？
    // 只读两个小文件，代价可以忽略。
    harness.handle('gate', async () => {
      const session = await readJson('progress/session.json', null)
      const ui = await readJson('progress/ui.json', null)
      return {
        sessionId: (session && session.sessionId) || '',
        visited: !!(ui && ui.visited),
      }
    })

    harness.handle('mark-visited', async () => {
      const cur = await readJson('progress/ui.json', null)
      const next = Object.assign({ version: 1 }, cur || {}, { visited: true, updatedAt: nowIso() })
      await writeJson('progress/ui.json', next)
      return { ok: true }
    })

    // ------------------------------------------------------------ 课程加载
    harness.handle('load', async () => {
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
        root: ROOT,
        tracks,
        courses,
        svgs,
        points: (progress && progress.points) || {},
        wrong: (quiz && quiz.wrong) || {},
      }
    })

    // ------------------------------------------------------------ 学习会话
    harness.handle('get-session', async () => {
      const saved = await readJson('progress/session.json', null)
      const sid = saved && saved.sessionId
      if (typeof sid !== 'string' || sid === '') return { ok: false }
      return { ok: true, sessionId: sid }
    })

    harness.handle('save-session', async (args) => {
      const sid = args && args.sessionId
      if (typeof sid !== 'string' || sid === '') return { ok: false }
      await writeJson('progress/session.json', { version: 1, sessionId: sid, updatedAt: nowIso() })
      return { ok: true }
    })

    // -------------------------------------------------------------- 进度
    harness.handle('set-status', async (args) => {
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
    })

    harness.handle('record-quiz', async (args) => {
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
    })

    // ---------------------------------------------------------- 工作空间
    harness.handle('ensure-workspace', async () => {
      if (registry === undefined) return { ok: false, reason: 'workspace-registry-unavailable' }
      try {
        let ws = await registry.resolveByPath(ROOT)
        if (ws === undefined || ws === null) ws = await registry.create(ROOT, '芯片封装学习')
        const raw = ws && (ws.id !== undefined ? ws.id : ws.workspaceId)
        return { ok: true, workspaceId: raw === undefined ? '' : String(raw), path: ROOT }
      } catch (error) {
        return { ok: false, reason: String((error && error.message) || error) }
      }
    })
  },
}
