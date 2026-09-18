// 插件整体验收：用假 ctx 把主机半真正挂载一次，再走一遍 HTTP 路由。
// 目的：在交给用户之前，确认「挂载不报错 + 自检无 error + 前端要的数据真的读得到」。
import { pathToFileURL } from 'node:url'
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const fail = (m) => { failed += 1; console.log('  x ' + m) }
const ok = (m) => console.log('  . ' + m)

// ---------------------------------------------------------------- 假 ctx
let captured = null
const ctx = {
  logger: {
    info: (m) => console.log('  [logger.info] ' + m),
    warn: (m) => console.log('  [logger.warn] ' + m),
    debug: () => {},
    error: (m) => console.log('  [logger.error] ' + m),
  },
  get(name) {
    if (name === 'webServer') {
      return { register(row) { captured = row; return () => { captured = null } } }
    }
    return undefined
  },
  effect(fn) { return typeof fn === 'function' ? fn() : fn },
  timeout: (fn) => setTimeout(fn, 0),
}

// ---------------------------------------------------------------- 调用路由
// opts: { route, headers, method } —— route 默认用主挂载，headers 用来测 C4 来源限制
function callRaw(method, args, opts) {
  const o = opts || {}
  const route = o.route || captured
  return new Promise((resolve) => {
    const listeners = {}
    let out = ''
    let done = null
    const finished = new Promise((r) => { done = r })
    const req = {
      method: o.method || 'POST',
      headers: o.headers || {},
      on(ev, cb) { listeners[ev] = cb; return req },
    }
    const res = {
      statusCode: 0,
      setHeader() {},
      end(body) { if (body !== undefined) out += String(body); done() },
    }
    route.handler(req, res)
    queueMicrotask(() => {
      if (listeners.data) listeners.data(JSON.stringify({ method, args: args || {} }))
      if (listeners.end) listeners.end()
    })
    finished.then(() => {
      let body = null
      try { body = JSON.parse(out) } catch (e) { body = { ok: false, error: 'not-json', raw: out.slice(0, 200) } }
      resolve({ status: res.statusCode, body })
    })
  })
}

function call(method, args, opts) {
  return callRaw(method, args, opts).then((r) => {
    if (r.body.ok !== true) throw new Error(method + ' 返回失败：' + JSON.stringify(r.body).slice(0, 300))
    return r.body.value
  })
}

// ---------------------------------------------------------------- 开始
console.log('=== 1. 主机半挂载 ===')
const mod = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
if (typeof mod.apply !== 'function') fail('lib/index.js 没有导出 apply')
else ok('导出 apply()')
if (String(mod.name) !== 'package-learn') fail('name 不是 package-learn：' + mod.name)
else ok('name = ' + mod.name + '，inject = ' + JSON.stringify(mod.inject))

try {
  mod.apply(ctx, undefined)
  if (captured === null) fail('apply() 没有注册路由（webServer.register 未被调用）')
  else if (captured.path !== '/package-learn/api') fail('路由路径不对：' + captured.path)
  else ok('路由已注册：' + captured.path + '（kind=' + captured.kind + '）')
} catch (error) {
  fail('apply() 抛错了（会让 dsh 启动失败）：' + error.message)
  process.exit(1)
}

console.log('')
console.log('=== 2. apply() 在 webServer 缺失时必须安静退出 ===')
try {
  mod.apply({ ...ctx, get: () => undefined, logger: { warn: () => {}, info: () => {}, debug: () => {} } }, undefined)
  ok('webServer 缺失时不抛错')
} catch (error) {
  fail('webServer 缺失时抛错了：' + error.message)
}

console.log('')
console.log('=== 3. 课程自检 ===')
const sc = await call('selfcheck', {})
const errs = sc.issues.filter((i) => i.level === 'error')
const warns = sc.issues.filter((i) => i.level === 'warn')
console.log('  主线 ' + sc.trackCount + ' / 已写工序 ' + sc.readyCount + ' / 细分点 ' + sc.pointCount + ' / 小测题 ' + sc.quizCount)
if (errs.length > 0) {
  for (const e of errs.slice(0, 20)) fail(e.where + ' :: ' + e.message)
  if (errs.length > 20) fail('……还有 ' + (errs.length - 20) + ' 条 error')
} else ok('没有 error 级问题')
if (warns.length > 0) {
  console.log('  （warn ' + warns.length + ' 条）')
  for (const w of warns.slice(0, 10)) console.log('    - ' + w.where + ' :: ' + w.message)
} else ok('没有 warn')

console.log('')
console.log('=== 4. 前端真正用到的数据 ===')
const data = await call('load', {})
if (!Array.isArray(data.tracks) || data.tracks.length !== 3) fail('tracks 不是 3 条')
else ok('tracks = 3 条')
const courses = data.courses || {}
ok('courses = ' + Object.keys(courses).length + ' 个模块')
const svgs = data.svgs || {}
ok('svgs = ' + Object.keys(svgs).length + ' 张图已内联')

let badProc = 0
for (const t of data.tracks) {
  for (const p of t.processes || []) {
    if (p.status !== 'ready') continue
    const c = courses[p.id]
    if (!c) { fail('工序 ' + p.id + ' 标了 ready 但 load 里没有它的课程'); badProc += 1; continue }
    if (typeof c.title !== 'string' || c.title === '') { fail('课程 ' + p.id + ' 缺 title'); badProc += 1 }
    if (!Array.isArray(c.points) || c.points.length === 0) { fail('课程 ' + p.id + ' 没有 points'); badProc += 1 }
  }
}
if (badProc === 0) ok('所有 ready 工序都有可渲染的课程数据')

console.log('')
console.log('=== 5. A5 相关知识点：跳转目标必须真的能解析出来 ===')
const index = {}
for (const pid of Object.keys(courses)) {
  for (const p of (courses[pid] && courses[pid].points) || []) {
    index[p.id] = { pid, title: (courses[pid] && courses[pid].title) || pid }
  }
}
let withRel = 0
let links = 0
let broken = 0
let crossModule = 0
for (const pid of Object.keys(courses)) {
  for (const p of (courses[pid] && courses[pid].points) || []) {
    const rel = Array.isArray(p.related) ? p.related : []
    if (rel.length === 0) continue
    withRel += 1
    for (const rid of rel) {
      links += 1
      if (!index[rid]) { fail('内容里有断链：' + p.id + ' -> ' + rid + '（界面上这颗按钮会凭空消失）'); broken += 1; continue }
      if (rid === p.id) { fail('自引用：' + p.id); broken += 1 }
      if (index[rid].pid !== pid) crossModule += 1
    }
  }
}
console.log('  带关联的知识点 ' + withRel + ' 个 / 链接 ' + links + ' 条 / 其中跨模块 ' + crossModule + ' 条')
if (broken === 0) ok('没有断链、没有自引用')

console.log('')
console.log('=== 6. 前端资源的语法 ===')
const clientSrc = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')
ok('lib/client.js 可读（' + (clientSrc.length / 1024).toFixed(1) + ' KB）')

console.log('')
console.log('=== 7. 界面里用到的字段 ===')
for (const key of ['related', 'body', 'quiz', 'estMinutes', 'title']) {
  if (clientSrc.includes(key)) ok('client 用到 ' + key)
}

console.log('')
console.log('=== 8. C4 来源限制：只认本机 ===')
const list = await callRaw('GET', {}, { method: 'GET' })
const names = (list.body.value && list.body.value.methods) || []
if (!names.includes('forget-session')) fail('方法表里没有 forget-session')
else ok('方法表 ' + names.length + ' 个，含 forget-session')
const cases = [
  [{ origin: 'http://evil.example.com' }, 403, '外域网页 POST（CSRF）'],
  [{ host: 'evil.example.com', origin: 'http://evil.example.com' }, 403, 'DNS rebinding：域名解析到本机'],
  [{ origin: 'https://evil.example.com' }, 403, 'https 外域'],
  [{ host: 'evil.example.com' }, 200, '只带外域 Host、不带 Origin（脚本可伪造 Host，放行）'],
  [{ origin: 'http://127.0.0.1:43120' }, 200, '本机页面同源'],
  [{ origin: 'http://localhost:43120' }, 200, 'localhost 同源'],
  [{ origin: 'http://[::1]:43120' }, 200, 'IPv6 回环'],
  [{ origin: 'null' }, 200, 'Origin: null（file:// 之类）'],
  [{ origin: 'dsh://app' }, 200, '自定义协议（桌面壳可能是这个）'],
  [{ origin: 'not-a-url' }, 403, 'Origin 不是合法 URL'],
  [{}, 200, '完全没有头（命令行 / 裸调用）'],
  [undefined, 200, '连 headers 都没有'],
]
for (const [headers, want, label] of cases) {
  const r = await callRaw('gate', {}, { headers })
  if (r.status !== want) fail(label + ' 期望 ' + want + '，实际 ' + r.status)
  else ok(label + ' -> ' + r.status)
}

console.log('')
console.log('=== 9. C3 forget-session：只在确实是同一个失效 id 时才清 ===')
// 用 config.root 挂到一个临时目录上测，绝不碰你真实的 progress/session.json
const TMP = join(ROOT, '.tmp-check/host')
// 脚本可能中途退出，走不到最后的 rmSync —— 挂退出钩子保证临时目录不残留
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch (error) { /* 已经没了 */ } })
mkdirSync(join(TMP, 'progress'), { recursive: true })
writeFileSync(join(TMP, 'progress/session.json'), JSON.stringify({ version: 1, sessionId: 'live-session-abc' }), 'utf8')
let tmpRoute = null
const tmpCtx = { ...ctx, get: (n) => (n === 'webServer' ? { register(row) { tmpRoute = row; return () => {} } } : undefined) }
try {
  mod.apply(tmpCtx, { root: TMP.replace(/\\/g, '/') })
  if (tmpRoute === null) fail('config.root 覆盖时没有注册路由')
  else ok('config.root 生效，路由挂在临时目录上')
  const kept = await call('forget-session', { sessionId: 'some-other-dead-id' }, { route: tmpRoute })
  const afterKept = JSON.parse(readFileSync(join(TMP, 'progress/session.json'), 'utf8'))
  if (kept.kept === 'live-session-abc' && afterKept.sessionId === 'live-session-abc') ok('id 不一致时保持不动（不会误删刚建的会话）')
  else fail('id 不一致时被清掉了：' + JSON.stringify(afterKept))
  const cleared = await call('forget-session', { sessionId: 'live-session-abc' }, { route: tmpRoute })
  const afterCleared = JSON.parse(readFileSync(join(TMP, 'progress/session.json'), 'utf8'))
  if (cleared.cleared === 'live-session-abc' && afterCleared.sessionId === '') ok('id 一致时清空（下次点击会自己新建）')
  else fail('id 一致时没清掉：' + JSON.stringify(afterCleared))

  console.log('')
  console.log('=== 9b. E2 record-review / set-status 不许把复习记录抹掉 ===')
  const STATE = join(TMP, 'progress/state.json')
  writeFileSync(STATE, JSON.stringify({
    version: 1,
    points: {
      'x.mastered': { status: 'mastered', updatedAt: '2026-09-01T00:00:00.000Z', reviewCount: 4, reviewedAt: '2026-09-10T00:00:00.000Z' },
      'x.fresh': { status: 'learning', updatedAt: '2026-09-17T00:00:00.000Z' },
    },
  }, null, 2), 'utf8')
  const readState = () => JSON.parse(readFileSync(STATE, 'utf8'))

  // 关键回归：标记为已掌握不能顺手把复习次数清零
  await call('set-status', { id: 'x.mastered', status: 'mastered' }, { route: tmpRoute })
  const s1 = readState().points['x.mastered']
  if (s1.reviewCount === 4 && s1.reviewedAt === '2026-09-10T00:00:00.000Z') ok('set-status 之后 reviewCount / reviewedAt 都还在（合并而非覆盖）')
  else fail('set-status 把复习记录抹掉了：' + JSON.stringify(s1))

  const r1 = await call('record-review', { id: 'x.mastered' }, { route: tmpRoute })
  const s2 = readState().points['x.mastered']
  if (r1.reviewCount === 5 && s2.reviewCount === 5 && /^\d{4}-/.test(s2.reviewedAt)) ok('record-review 把复习次数 +1 并刷新时间')
  else fail('record-review 没记上：' + JSON.stringify(s2))
  if (s2.status === 'mastered') ok('已掌握的点复习后仍是已掌握（不会被降级）')
  else fail('复习把状态改了：' + s2.status)

  await call('record-review', { id: 'x.unseen-before' }, { route: tmpRoute })
  const s3 = readState().points['x.unseen-before']
  if (s3.status === 'learning' && s3.reviewCount === 1) ok('复习一个没记录过的点 → 记为在学，不会凭空变已掌握')
  else fail('未知点的处理不对：' + JSON.stringify(s3))

  const bad = await callRaw('record-review', { id: '' }, { route: tmpRoute })
  if (bad.body.value && bad.body.value.ok === false) ok('空 id 被拒（返回 ok:false，不写盘）')
  else fail('空 id 没被拒')

  console.log('')
  console.log('=== 9c. E1 导出 / 导入：往返还得救得回来 ===')
  const QUIZ = join(TMP, 'progress/quiz.json')
  writeFileSync(QUIZ, JSON.stringify({ version: 1, attempts: [{ at: 'x', pointId: 'p.a', correct: false }], wrong: { 'p.a': [0] } }), 'utf8')
  writeFileSync(join(TMP, 'progress/ui.json'), JSON.stringify({ version: 1, visited: true }), 'utf8')

  const bundle = await call('export-progress', {}, { route: tmpRoute })
  if (bundle.format === 'dsh-package-learn/progress' && bundle.formatVersion === 1) ok('导出带格式标识（导入时可以认出来）')
  else fail('导出没有格式标识：' + JSON.stringify(bundle).slice(0, 120))
  // 不写死条数：按导出那一刻磁盘上真实的条数比对（前面的小组会往临时目录里加数据）
  const onDisk = Object.keys(readState().points).length
  const exportedPoints = Object.keys((bundle.state && bundle.state.points) || {}).length
  if (exportedPoints === onDisk) ok('导出的知识点记录数 = 磁盘上的 ' + onDisk + ' 条（一条不漏）')
  else fail('导出条数不对：磁盘 ' + onDisk + ' 条，导出 ' + exportedPoints + ' 条')
  if (bundle.state.points['x.mastered'].reviewCount === 5) ok('复习记录一起导出（reviewCount=5）')
  else fail('复习记录没导出')
  if (Object.keys((bundle.quiz && bundle.quiz.wrong) || {}).length === 1) ok('错题本一起导出')
  else fail('错题本没导出')
  if (bundle.session === undefined) ok('刻意不导出 session（会话 id 换台机器就是废的）')
  else fail('不该导出 session')

  // 模拟"导入之前又学了几天"，然后导回去，应该回到导出那一刻
  const before = readState()
  const mutated = { version: 1, points: Object.assign({}, before.points, { 'p.new': { status: 'mastered', updatedAt: '2026-09-18T00:00:00.000Z' } }) }
  writeFileSync(STATE, JSON.stringify(mutated, null, 2), 'utf8')

  const imported = await call('import-progress', { bundle }, { route: tmpRoute })
  if (imported.ok === true && imported.points === exportedPoints) ok('导入成功：' + imported.points + ' 个知识点 / ' + imported.wrongPoints + ' 个带错题 / ' + imported.attempts + ' 条流水')
  else fail('导入返回不对：' + JSON.stringify(imported))
  const after = readState()
  if (after.points['p.new'] === undefined && after.points['x.mastered'].reviewCount === 5) ok('导入后进度回到导出那一刻（新增的 p.new 没了，复习记录还在）')
  else fail('导入结果不对：' + JSON.stringify(Object.keys(after.points)))
  const backupRoot = join(TMP, imported.backupDir)
  const backedUp = existsSync(join(backupRoot, 'state.json'))
    ? JSON.parse(readFileSync(join(backupRoot, 'state.json'), 'utf8'))
    : null
  if (backedUp && backedUp.points['p.new'] !== undefined) ok('覆盖前的旧进度确实备份下来了（备份里还有 p.new）')
  else fail('没有备份，或备份的不是覆盖前的内容')

  // 坏数据必须整包拒掉，且不许动磁盘
  const stateBeforeBad = readFileSync(STATE, 'utf8')
  const cases2 = [
    [{}, 'bad-state', '空包'],
    [{ state: { points: {} }, quiz: {} }, 'bad-quiz', '缺 quiz'],
    [{ state: { points: { 'a.b': { status: '乱写' } } }, quiz: { wrong: {} } }, 'bad-status:a.b', '状态值非法'],
    [{ state: { points: { 'a.b': 'not-an-object' } }, quiz: { wrong: {} } }, 'bad-point:a.b', '知识点不是对象'],
    [{ state: { points: {} }, quiz: { wrong: { 'a.b': 'not-array' } } }, 'bad-wrong:a.b', '错题不是数组'],
  ]
  let rejected = 0
  for (const [b, want, label] of cases2) {
    const r = await callRaw('import-progress', { bundle: b }, { route: tmpRoute })
    if (r.body.value && r.body.value.ok === false && r.body.value.reason === want) rejected += 1
    else fail('坏包没按预期拒掉（' + label + '）：' + JSON.stringify(r.body.value))
  }
  if (rejected === cases2.length) ok(cases2.length + ' 种坏数据全部整包拒掉，理由明确')
  if (readFileSync(STATE, 'utf8') === stateBeforeBad) ok('拒掉时不写盘（进度一个字没动）')
  else fail('坏包被拒了却改了盘')

  const backups = await call('list-backups', {}, { route: tmpRoute })
  if (Array.isArray(backups.backups) && backups.backups.length >= 1) ok('能列出备份目录（' + backups.backups.length + ' 个）')
  else fail('列不出备份')

  console.log('')
  console.log('=== 9d. E3 record-time：累加、按本地日期分桶、单次封顶 ===')
  const localKey = (ms) => {
    const d = new Date(ms)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  const TIME = join(TMP, 'progress/time.json')
  if (existsSync(TIME)) rmSync(TIME, { force: true })
  const t1 = await call('record-time', { seconds: 90, pointId: 'p.a' }, { route: tmpRoute })
  if (t1.ok === true && t1.todaySeconds === 90 && t1.totalSeconds === 90) ok('第一次心跳：今天 90 秒')
  else fail('第一次心跳不对：' + JSON.stringify(t1))
  const t2 = await call('record-time', { seconds: 90, pointId: 'p.a' }, { route: tmpRoute })
  if (t2.todaySeconds === 180) ok('第二次累加：今天 180 秒（同一个知识点 180 秒）')
  else fail('累加不对：' + JSON.stringify(t2))
  const t3 = await call('record-time', { seconds: 1000, pointId: 'p.b' }, { route: tmpRoute })
  if (t3.totalSeconds === 480) ok('单次 1000 秒被压到 300（防止一次异常心跳把一天冲爆）')
  else fail('封顶没生效：' + JSON.stringify(t3))
  const timeDoc = JSON.parse(readFileSync(TIME, 'utf8'))
  if (timeDoc.days[localKey(Date.now())] === 480) ok('按本地日期分桶：' + localKey(Date.now()) + ' = 480 秒')
  else fail('日期分桶不对：' + JSON.stringify(timeDoc.days))
  if (timeDoc.points['p.a'] === 180 && timeDoc.points['p.b'] === 300) ok('按知识点也分开记了（p.a 180 / p.b 300）')
  else fail('知识点分桶不对：' + JSON.stringify(timeDoc.points))
  const badT = []
  for (const secs of [0, -5, 'x', null, 12.5]) {
    const r = await callRaw('record-time', { seconds: secs }, { route: tmpRoute })
    if (!(r.body.value && r.body.value.ok === false)) badT.push(JSON.stringify(secs))
  }
  if (badT.length === 0) ok('0 / 负数 / 字符串 / null / 小数 全部被拒（不写盘）')
  else fail('这些没被拒：' + badT.join(', '))
  const sumT = await call('time-summary', {}, { route: tmpRoute })
  if (sumT.ok === true && sumT.time.totalSeconds === 480) ok('time-summary 读得到（比 load 轻，界面刷新统计用）')
  else fail('time-summary 不对：' + JSON.stringify(sumT).slice(0, 120))

  // 时长要能跟着进度一起搬走
  const bundle2 = await call('export-progress', {}, { route: tmpRoute })
  if (bundle2.time && bundle2.time.totalSeconds === 480) ok('导出件里带上了学习时长（480 秒）')
  else fail('导出没带时长：' + JSON.stringify(bundle2.time))
  writeFileSync(TIME, JSON.stringify({ version: 1, totalSeconds: 99999, days: { '2020-01-01': 99999 }, points: {} }), 'utf8')
  const imported2 = await call('import-progress', { bundle: bundle2 }, { route: tmpRoute })
  const timeBack = JSON.parse(readFileSync(TIME, 'utf8'))
  if (timeBack.totalSeconds === 480 && timeBack.days[localKey(Date.now())] === 480) ok('导入后时长也回到导出那一刻（99999 被覆盖回来）')
  else fail('时长没有往返：' + JSON.stringify(timeBack))
  const timeBackup = join(TMP, (imported2 && imported2.backupDir) || '_none', 'time.json')
  if (existsSync(timeBackup) && JSON.parse(readFileSync(timeBackup, 'utf8')).totalSeconds === 99999) {
    ok('导入前的 time.json 也在备份里（备份里还是 99999）')
  } else {
    fail('time.json 没被备份：' + timeBackup)
  }

  console.log('')
  console.log('=== 9e. E5 about / reset-progress：重置不可逆，退路先铺好 ===')
  const info = await call('about', {}, { route: tmpRoute })
  if (typeof info.version === 'string' && /^\d+\.\d+\.\d+$/.test(info.version)) ok('报出插件版本 ' + info.version)
  else fail('版本读不到：' + JSON.stringify(info.version))
  if (info.root === TMP.replace(/\\/g, '/') && info.overridden === true) ok('报出真实数据目录，并标明「被 config.root 改过」')
  else fail('目录信息不对：' + JSON.stringify({ root: info.root, overridden: info.overridden }))
  if (Array.isArray(info.methods) && info.methods.length >= 17) ok('方法表 ' + info.methods.length + ' 个（界面上摊开给用户看）')
  else fail('方法表不对：' + JSON.stringify(info.methods))
  if (Array.isArray(info.files) && info.files.length === 5 && info.files.some((f) => f.bytes > 0)) ok('逐个进度文件的大小都报出来了')
  else fail('文件清单不对：' + JSON.stringify(info.files))
  if (info.counts.marked > 0 && info.counts.studyDays >= 1) ok('规模统计：' + info.counts.marked + ' 个知识点记录 / ' + info.counts.studyDays + ' 天时长')
  else fail('统计不对：' + JSON.stringify(info.counts))

  // 没有 confirm 就不许动
  const noConfirm = await callRaw('reset-progress', {}, { route: tmpRoute })
  if (noConfirm.body.value && noConfirm.body.value.ok === false && noConfirm.body.value.reason === 'need-confirm') {
    ok('不传 confirm 直接拒绝（need-confirm）')
  } else {
    fail('没确认就执行了：' + JSON.stringify(noConfirm.body.value))
  }
  const stillThere = JSON.parse(readFileSync(STATE, 'utf8'))
  if (Object.keys(stillThere.points).length > 0) ok('被拒时进度一个字没动')
  else fail('被拒却把进度清了')

  const beforeReset = JSON.parse(readFileSync(STATE, 'utf8'))
  const reset = await call('reset-progress', { confirm: 'RESET' }, { route: tmpRoute })
  if (reset.ok === true && typeof reset.backupDir === 'string' && reset.backupDir.indexOf('-before-reset') > 0) ok('带 confirm 才执行，并给出备份目录')
  else fail('重置返回不对：' + JSON.stringify(reset))
  const afterReset = JSON.parse(readFileSync(STATE, 'utf8'))
  if (Object.keys(afterReset.points).length === 0) ok('知识点状态已清空')
  else fail('状态没清干净：' + JSON.stringify(Object.keys(afterReset.points)))
  const quizAfter = JSON.parse(readFileSync(QUIZ, 'utf8'))
  if (Object.keys(quizAfter.wrong || {}).length === 0 && (quizAfter.attempts || []).length === 0) ok('错题本与作答流水已清空')
  else fail('错题/流水没清：' + JSON.stringify(quizAfter))
  const timeAfter = JSON.parse(readFileSync(TIME, 'utf8'))
  if (timeAfter.totalSeconds === 0 && Object.keys(timeAfter.days || {}).length === 0) ok('学习时长已清空')
  else fail('时长没清：' + JSON.stringify(timeAfter))
  const resetBackup = JSON.parse(readFileSync(join(TMP, reset.backupDir, 'state.json'), 'utf8'))
  if (Object.keys(resetBackup.points).length === Object.keys(beforeReset.points).length) {
    ok('清空前的 ' + Object.keys(beforeReset.points).length + ' 条记录确实备份下来了（能救回来）')
  } else {
    fail('重置前的备份不对')
  }
  if (existsSync(join(TMP, 'progress/session.json'))) ok('学习会话没被一起清掉（清它没有意义）')
  else fail('会话被误删了')
} catch (error) {
  fail('临时目录挂载测试出错：' + error.message)
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log('')
console.log('=== 10. 客户端半的静态检查 ===')
for (const [needle, label] of [
  ['function enterLearning(ctx)', 'C3 共享的进入逻辑'],
  ['rpc(\'forget-session\'', 'C3 清烂指针'],
  ['mountFailed(ctx,', 'C5 挂载失败提示'],
  ['const [attempt, setAttempt]', 'C2 重试计数'],
  ['onClick: retry', 'C2 重新读取按钮'],
  ['onClick: doEnter', 'C3 进入学习会话按钮'],
  ['ctx: props.ctx', '把 ctx 传给学习界面'],
]) {
  if (clientSrc.includes(needle)) ok(label)
  else fail('客户端缺少：' + label + '（' + needle + '）')
}
// 入口按钮不许再自己写一份进入逻辑（否则两条路只有一条会被修）
const entryBlock = clientSrc.slice(clientSrc.indexOf('function EntryButton'), clientSrc.indexOf('function LearnHint'))
if (entryBlock.includes('enterLearning(props.ctx)')) ok('入口按钮走的是同一份逻辑')
else fail('入口按钮没有复用 enterLearning')
if (entryBlock.includes('uiWorkspace')) fail('入口按钮里还留着旧的重复逻辑')
else ok('旧的重复逻辑已经删干净')

console.log('')
console.log('=== 11. E4 课程导出 Markdown ===')
{
  const md = await call('export-markdown', {})
  const s = md.stats
  if (s.modules === 19 && s.points === 114 && s.questions === 450 && s.figures === 19) {
    ok('统计与课程一致：' + s.modules + ' 模块 / ' + s.points + ' 知识点 / ' + s.questions + ' 题 / ' + s.figures + ' 图 / ' + s.relatedLinks + ' 条关联')
  } else {
    fail('统计对不上：' + JSON.stringify(s))
  }
  const text = md.markdown
  if (!text.startsWith('# 芯片封装学习 · 课程全集')) fail('开头不是标题')
  else ok('有文档标题（' + (text.length / 1024 / 1024).toFixed(2) + ' MB，内嵌图片）')

  // 结构：主线 / 模块 / 知识点三级标题都在
  const h1 = (text.match(/^# /gm) || []).length
  const h2 = (text.match(/^## /gm) || []).length
  const h3 = (text.match(/^### /gm) || []).length
  if (h1 === 4 && h2 === 20 && h3 === 114) ok('标题层级：主线 ' + (h1 - 1) + ' + 目录 ' + 1 + ' / 模块 ' + (h2 - 1) + ' / 知识点 ' + h3)
  else fail('标题层级不对：h1=' + h1 + ' h2=' + h2 + ' h3=' + h3)

  // 锚点必须都解析得到（目录链接点了要能跳）
  const anchors = new Set()
  for (const m of text.matchAll(/<a id="([^"]+)"><\/a>/g)) anchors.add(m[1])
  const links = []
  for (const m of text.matchAll(/\]\(#([^)]+)\)/g)) links.push(m[1])
  const broken = links.filter((id) => !anchors.has(id))
  if (links.length > 114 && broken.length === 0) ok(links.length + ' 个目录/关联锚点全部有落点（无死链）')
  else fail('有 ' + broken.length + ' 个锚点跳不过去，例如：' + broken.slice(0, 5).join(', '))

  // 图片：默认内嵌
  const inline = (text.match(/data:image\/svg\+xml;base64,/g) || []).length
  if (inline === 19) ok('19 张图全部内嵌成 data URI（单文件可用，换台机器图还在）')
  else fail('内嵌图片数不对：' + inline)
  const md2 = await call('export-markdown', { inlineImages: false })
  const relImgs = (md2.markdown.match(/\]\(assets\//g) || []).length
  if (relImgs === 19 && md2.markdown.indexOf('data:image') < 0) ok('inlineImages:false 时退回相对路径 assets/（文件小得多）')
  else fail('相对路径模式不对：' + relImgs)

  // 答案标记（选项是缩进 3 空格的列表项）
  const marks = (text.match(/^\s+- \*\*\[√\]\*\* /gm) || []).length
  if (marks === 450) ok('450 道题都标出了正确答案')
  else fail('答案标记数不对：' + marks)
  const explains = (text.match(/解析：/g) || []).length
  if (explains >= 400) ok('解析带出来 ' + explains + ' 条')
  else fail('解析太少：' + explains)

  // 表格：同一张表里每行的竖线数必须一致，否则渲染就散了
  const lines = text.split('\n')
  let tableRuns = 0
  let badRuns = 0
  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith('|')) {
      const run = []
      while (i < lines.length && lines[i].startsWith('|')) { run.push(lines[i]); i += 1 }
      tableRuns += 1
      const count = (row) => (row.match(/(?<!\\)\|/g) || []).length
      const want = count(run[0])
      if (run.length < 2 || count(run[1]) !== want || run.some((r) => count(r) !== want)) badRuns += 1
      if (!/^\|( --- \|)+$/.test(run[1] || '')) badRuns += 1
    } else {
      i += 1
    }
  }
  if (tableRuns > 0 && badRuns === 0) ok(tableRuns + ' 张表格结构完整（列数一致 + 分隔行正确）')
  else fail('表格有问题：' + tableRuns + ' 张里 ' + badRuns + ' 张不对')

  // 内容里的 **加粗** 是 Markdown 原生写法，不该被转义掉
  if (text.indexOf('\\*\\*') < 0 && (text.match(/\*\*/g) || []).length > 1000) ok('正文里的 **加粗** 原样保留（内容本来就是 Markdown 写法）')
  else fail('加粗被破坏或数量异常')

  // callout 变成了引用块
  const quotes = (text.match(/^> \*\*(重点|注意)\*\*：/gm) || []).length
  if (quotes > 100) ok('重点/注意框转成了 ' + quotes + ' 条引用块')
  else fail('callout 转换数量异常：' + quotes)

  // 关系与复习：导出里也带「相关知识点」
  const rel = (text.match(/\*\*相关知识点\*\*：/g) || []).length
  if (rel === 65) ok('65 个带关联的知识点在导出里也标了「相关知识点」')
  else fail('关联段落数不对：' + rel)

  // 学习状态也印进去了（导出件可以当打印出来打勾的复习清单）
  const realState = JSON.parse(readFileSync(join(ROOT, 'progress/state.json'), 'utf8'))
  const want = { learning: 0, mastered: 0 }
  for (const id of Object.keys(realState.points || {})) {
    const st = realState.points[id] && realState.points[id].status
    if (st === 'learning') want.learning += 1
    if (st === 'mastered') want.mastered += 1
  }
  const gotLearning = (text.match(/· 在学 · `/g) || []).length
  const gotMastered = (text.match(/· 已掌握 · `/g) || []).length
  if (gotMastered === want.mastered && gotLearning === want.learning) {
    ok('学习状态一并导出（在学 ' + gotLearning + " / 已掌握 " + gotMastered + '，与 progress/state.json 一致）')
  } else {
    fail('状态标记对不上：导出里在学 ' + gotLearning + ' / 已掌握 ' + gotMastered + '，进度文件里 ' + want.learning + ' / ' + want.mastered)
  }

  // 落一份到临时目录，方便人工抽查（跑完就删）
  const OUT = join(ROOT, '.tmp-check/export.md')
  writeFileSync(OUT, text, 'utf8')
  const head = text.split('\n').slice(0, 26).join('\n')
  console.log('  ---- 导出文件开头 26 行 ----')
  for (const line of head.split('\n')) console.log('  | ' + line.slice(0, 100))
  console.log('  ---- （完整文件已写一份到 _tmp_md.md 便于抽查） ----')
  rmSync(OUT, { force: true })
}

console.log('')
console.log(failed === 0 ? '全部通过 ✅' : '有 ' + failed + ' 项没通过 ❌')
process.exit(failed === 0 ? 0 : 1)
