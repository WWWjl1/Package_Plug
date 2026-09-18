// 客户端半的运行时验收：把 lib/client.js 当成浏览器里的模块真的加载一次，
// 然后在不碰真 dsh 的前提下，把 apply() 的每一条失败路径都走一遍。
// 重点验证一条硬约束：apply() 无论遇到什么，都不能抛错。
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'lib', 'client.js')
let failed = 0
const fail = (m) => { failed += 1; console.log('  x ' + m) }
const ok = (m) => console.log('  . ' + m)

// ---------------------------------------------------------------- 假浏览器
let loaded = null
const addedToBody = []
let bannerRemoved = 0
const fakeDocument = {
  body: { appendChild(node) { addedToBody.push(node) } },
  createElement(tag) {
    return {
      tagName: tag, id: '', textContent: '', attrs: {},
      setAttribute(k, v) { this.attrs[k] = v },
      remove() { bannerRemoved += 1; const i = addedToBody.indexOf(this); if (i >= 0) addedToBody.splice(i, 1) },
    }
  },
  getElementById(id) { return addedToBody.find((n) => n.id === id) || null },
  head: { appendChild() {} },
}

globalThis.window = {
  __ModuleLoader__: {
    load(record) { loaded = record },
  },
}
globalThis.document = fakeDocument

const reactStub = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  Fragment: 'Fragment',
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
}

// ---------------------------------------------------------------- 加载模块
console.log('=== 1. 模块加载 ===')
const src = readFileSync(SRC, 'utf8')
try {
  // 用 Function 而不是 import：这个文件是给浏览器模块加载器用的，不是 ESM
  new Function('window', 'document', src)(globalThis.window, fakeDocument)
} catch (error) {
  fail('加载 lib/client.js 时抛错：' + error.message)
  process.exit(1)
}
if (loaded === null) { fail('没有调用 window.__ModuleLoader__.load'); process.exit(1) }
ok('模块已注册，id = ' + loaded.id)
if (loaded.id !== 'dsh-package-learn') fail('模块 id 不对：' + loaded.id)

let exported = null
try {
  exported = loaded.factory((name) => {
    if (name === 'react') return reactStub
    throw new Error('不允许的外部依赖：' + name)
  })
  ok('factory 执行成功（只 require 了 react）')
} catch (error) {
  fail('factory 抛错：' + error.message)
  process.exit(1)
}
if (typeof exported.apply !== 'function') fail('没有导出 apply')
else ok('导出 apply()，inject = ' + JSON.stringify(exported.inject))

// ---------------------------------------------------------------- 工具
function makeCtx(opts) {
  const o = opts || {}
  const calls = []
  const timers = []
  const ctx = {
    services: o.services === undefined ? {} : o.services,
    get(name) {
      if (o.getThrows) throw new Error('ctx.get 炸了')
      return ctx.services[name]
    },
    effect(fn) { const d = typeof fn === 'function' ? fn() : undefined; return d },
    timeout(fn, ms) { timers.push({ fn, ms }); return () => {} },
  }
  return { ctx, calls, timers }
}

function makeSlots(opts) {
  const o = opts || {}
  const seen = []
  return {
    seen,
    inject(key, cb) {
      if (o.injectThrows) throw new Error('inject 炸了')
      seen.push(key)
      if (typeof cb === 'function') cb()
      return () => {}
    },
    register(row) { return () => {} },
  }
}

// 每个小节开始前清空假 <body>：提示是按 id 去重的，不清掉会串台
function resetBanner() {
  addedToBody.length = 0
  bannerRemoved = 0
}

// ---------------------------------------------------------------- 2. 正常路径
console.log('')
console.log('=== 2. 正常路径：三个槽位都登记上了 ===')
{
  const slots = makeSlots()
  const { ctx } = makeCtx({ services: { slots } })
  try {
    exported.apply(ctx)
    const want = ['sidebar.footer.action', 'conversation.input.dock', 'conversation.view']
    const got = slots.seen
    if (JSON.stringify(got) === JSON.stringify(want)) ok('登记了 3 个槽位：' + got.join(' / '))
    else fail('槽位不对：' + JSON.stringify(got))
    if (addedToBody.length === 0) ok('正常路径不显示失败提示')
    else fail('正常路径不该显示提示，却挂了 ' + addedToBody.length + ' 个节点')
  } catch (error) {
    fail('正常路径抛错了：' + error.message)
  }
}

// ---------------------------------------------------------------- 3. slots 拿不到
console.log('')
console.log('=== 3. 拿不到 slots：不抛错 + 限时重试 + 最终可见提示 ===')
{
  const { ctx, timers } = makeCtx({ services: {} })
  try {
    exported.apply(ctx)
    ok('apply() 没有抛错')
    if (timers.length === 1) ok('排了第一次重试')
    else fail('没有排重试，timers = ' + timers.length)
    // 一直拿不到：连跑 6 次
    let guard = 0
    while (timers.length > 0 && guard < 20) {
      const t = timers.shift()
      if (t.ms !== 1000) fail('重试间隔不是 1000ms，而是 ' + t.ms)
      t.fn()
      guard += 1
    }
    if (addedToBody.length === 1) ok('最终显示了一条可见提示：' + addedToBody[0].textContent.slice(0, 40) + '…')
    else fail('没有显示提示，body 上挂了 ' + addedToBody.length + ' 个节点')
    if (addedToBody[0] && addedToBody[0].attrs.style && addedToBody[0].attrs.style.includes('position:fixed')) ok('提示是固定定位（一定会看得见）')
    else fail('提示的样式不对')
  } catch (error) {
    fail('拿不到 slots 时抛错了（这条最要命）：' + error.message)
  }
}

// ---------------------------------------------------------------- 4. 晚一步才有 slots
console.log('')
console.log('=== 4. slots 晚一步才出现：重试要能接上 ===')
{
  resetBanner()
  const slots = makeSlots()
  const ctxBox = makeCtx({ services: {} })
  try {
    exported.apply(ctxBox.ctx)
    ok('第一次没拿到时不抛错')
    // 让服务"过一会儿"才出现
    ctxBox.ctx.services.slots = slots
    const t = ctxBox.timers.shift()
    t.fn()
    if (slots.seen.length === 3) ok('重试时把 3 个槽位补上了')
    else fail('重试没有登记槽位，seen = ' + JSON.stringify(slots.seen))
    if (addedToBody.length === 0) ok('接上之后不再显示失败提示')
    else fail('接上了却还显示提示')
  } catch (error) {
    fail('重试路径抛错：' + error.message)
  }
}

// ---------------------------------------------------------------- 5. 槽位名被改（inject 抛错）
console.log('')
console.log('=== 5. 槽位名被改：inject 抛错也不能漏出来 ===')
{
  resetBanner()
  const slots = makeSlots({ injectThrows: true })
  const { ctx } = makeCtx({ services: { slots } })
  const before = addedToBody.length
  try {
    exported.apply(ctx)
    ok('apply() 没有抛错')
    if (addedToBody.length === before + 1) ok('显示了可见提示：' + addedToBody[addedToBody.length - 1].textContent.slice(0, 34) + '…')
    else fail('没有显示提示')
  } catch (error) {
    fail('inject 抛错时漏出来了：' + error.message)
  }
}

// ---------------------------------------------------------------- 6. 连 ctx.get 都炸
console.log('')
console.log('=== 6. ctx.get 本身抛错：也要兜住 ===')
{
  const { ctx } = makeCtx({ getThrows: true })
  try {
    exported.apply(ctx)
    ok('apply() 没有抛错（会走重试→提示那条路）')
  } catch (error) {
    fail('ctx.get 抛错时漏出来了：' + error.message)
  }
}

// ---------------------------------------------------------------- 7. ctx 完全是坏的
console.log('')
console.log('=== 7. ctx 是 null / 缺方法：最外层兜底 ===')
resetBanner()
for (const bad of [null, {}, { get: 'not-a-function' }, { get: () => undefined }]) {
  try {
    exported.apply(bad)
    ok('apply(' + JSON.stringify(bad) + ') 没有抛错')
  } catch (error) {
    fail('apply(' + JSON.stringify(bad) + ') 抛错了：' + error.message)
  }
}

// ---------------------------------------------------------------- 8. 样式表与提示可回收
console.log('')
console.log('=== 8. 副作用可回收 ===')
{
  const removed = []
  const slots = makeSlots()
  const ctx = {
    get: (n) => (n === 'slots' ? slots : undefined),
    effect(fn) { removed.push(fn); const d = fn(); return d },
    timeout: () => {},
  }
  exported.apply(ctx)
  const disposers = removed.map((fn) => fn()).filter((d) => typeof d === 'function')
  if (disposers.length >= 1) ok('insertStyles 返回了清理函数（插件停用时会移除样式）')
  else fail('样式没有清理函数，停用后会残留')
}

// ---------------------------------------------------------------- 9. E2 复习队列
console.log('')
console.log('=== 9. E2 复习队列：间隔规则要算对 ===')
{
  const inner = exported.__internal
  if (!inner || typeof inner.reviewQueue !== 'function') {
    fail('没有暴露 __internal.reviewQueue，无法验证复习规则')
  } else {
    const { reviewQueue, daysSince, reviewInterval, REVIEW_STEPS } = inner
    const NOW = Date.parse('2026-09-18T12:00:00.000Z')
    const DAY = 86400000
    const iso = (d) => new Date(NOW - d * DAY).toISOString()

    // 造 6 个知识点，覆盖每条分支
    const idx = {}
    for (const id of ['a.unseen', 'a.fresh', 'a.due1', 'a.steady', 'a.due2', 'a.learning', 'a.wrong', 'a.broken']) {
      idx[id] = { processId: 'mod', procTitle: '测试模块', point: { title: id } }
    }
    const marked = {
      'a.fresh': { status: 'mastered', updatedAt: iso(0) },                       // 今天刚掌握
      'a.due1': { status: 'mastered', updatedAt: iso(1) },                        // 1 天前，间隔 1 → 到期
      'a.steady': { status: 'mastered', updatedAt: iso(2), reviewCount: 1 },      // 复习过 1 次，间隔 3 → 没到
      'a.due2': { status: 'mastered', updatedAt: iso(9), reviewCount: 1 },        // 9 天前，间隔 3 → 到期，超期 6
      'a.learning': { status: 'learning', updatedAt: iso(5) },                    // 在学 5 天前 → 到期
      'a.untouched': { status: 'learning', updatedAt: iso(1) },                   // 在学 1 天前（只是点开过）
      'a.wrong': { status: 'mastered', updatedAt: iso(0), reviewCount: 9 },       // 已掌握很久档，但有错题
      'a.broken': { status: 'mastered', updatedAt: '这不是时间' },                // 时间戳非法
    }
    const wrongs = { 'a.wrong': [0, 2] }

    const due = reviewQueue(idx, marked, wrongs, NOW)
    const ids = due.map((it) => it.pointId)

    if (ids.indexOf('a.unseen') < 0) ok('未学的点不进队列（还没学，谈不上复习）')
    else fail('未学的点进了队列')
    if (ids.indexOf('a.fresh') < 0) ok('今天刚标记已掌握的不催（间隔 1 天）')
    else fail('刚掌握就被催复习')
    if (ids.indexOf('a.due1') >= 0) ok('1 天前掌握、间隔 1 天 → 到期')
    else fail('该到期的没到期')
    if (ids.indexOf('a.steady') < 0) ok('复习过 1 次（间隔 3 天）、才隔 2 天 → 不催')
    else fail('间隔没拉长')
    if (ids.indexOf('a.due2') >= 0) ok('复习过 1 次、隔了 9 天 → 到期')
    else fail('拉长后的间隔该到期了却没到期')
    if (ids.indexOf('a.learning') >= 0) ok('在学且放了 5 天 → 催一下接着学')
    else fail('放了 5 天的在学点没进队列')
    if (ids.indexOf('a.untouched') < 0) ok('只是点开过（在学 1 天）的不催 —— 否则翻一遍就是几十条噪音')
    else fail('在学 1 天就被催了（这正是实测 30 条墙的成因）')
    if (ids.indexOf('a.broken') < 0) ok('时间戳非法时不硬猜，不进队列')
    else fail('时间戳非法却进了队列')

    // 排序：错题 > 在学 > 已掌握到期；同档按超期天数降序
    if (ids[0] === 'a.wrong') ok('错题未消排最前（错题是「没学会」的硬证据）')
    else fail('错题没排最前，实际第一个是 ' + ids[0])
    const rankOrder = due.map((it) => it.rank)
    let sorted = true
    for (let i = 1; i < rankOrder.length; i += 1) if (rankOrder[i] < rankOrder[i - 1]) sorted = false
    if (sorted) ok('优先级顺序正确：' + rankOrder.join(' → '))
    else fail('优先级顺序乱了：' + rankOrder.join(','))
    const sameRank = due.filter((it) => it.rank === 2).map((it) => it.overdue)
    let desc = true
    for (let i = 1; i < sameRank.length; i += 1) if (sameRank[i] > sameRank[i - 1]) desc = false
    if (desc) ok('同一档里拖得越久越靠前（超期 ' + sameRank.join(' / ') + ' 天）')
    else fail('同档排序不对：' + sameRank.join(','))
    const w = due[0]
    if (w && w.reason.indexOf('2 道') >= 0) ok('错题的说明写清了几道：' + w.reason)
    else fail('错题说明不对：' + (w && w.reason))

    // 错题清空后就该回到正常间隔，而不是永远霸占队首
    const due2 = reviewQueue(idx, marked, {}, NOW)
    if (due2.map((it) => it.pointId).indexOf('a.wrong') < 0) ok('错题消化掉之后就不再霸占队首（间隔 35 天还没到）')
    else fail('错题清空了还在队列里')

    // 间隔阶梯
    const steps = [0, 1, 2, 3, 4, 5, 99].map((n) => reviewInterval({ reviewCount: n }))
    if (JSON.stringify(steps) === JSON.stringify([1, 3, 7, 16, 35, 35, 35])) ok('间隔阶梯 1/3/7/16/35 并正确封顶：' + steps.join(','))
    else fail('间隔阶梯不对：' + steps.join(','))
    if (reviewInterval({}) === 1) ok('没有 reviewCount 时按第一档（1 天）')
    else fail('缺字段时档位不对')
    if (daysSince(iso(0), NOW) === 0 && daysSince(iso(1), NOW) === 1 && daysSince(null, NOW) === null) ok('天数计算：今天 0 / 1 天前 1 / 空值 null')
    else fail('daysSince 算错了')
    if (REVIEW_STEPS.length === 5) ok('阶梯档数 = 5')
  }
}

// ---------------------------------------------------------------- 11. E3 学习统计
console.log('')
console.log('=== 11. E3 学习统计：日期分桶、连续天数、柱状图 ===')
{
  const inner = exported.__internal
  if (typeof inner.studySummary !== 'function') {
    fail('没有暴露 __internal.studySummary')
  } else {
    const { studySummary, humanTime, localDateKey } = inner

    // 本地日期，不是 UTC —— 北京时间凌晨这段时间最容易算错
    const lateNight = new Date(2026, 8, 18, 23, 30).getTime()
    const earlyMorning = new Date(2026, 8, 18, 0, 30).getTime()
    if (localDateKey(lateNight) === '2026-09-18' && localDateKey(earlyMorning) === '2026-09-18') {
      ok('按本地日期分桶：当天 00:30 与 23:30 都算 9-18（用 UTC 会把凌晨那段算成前一天）')
    } else {
      fail('日期键不对：' + localDateKey(lateNight) + ' / ' + localDateKey(earlyMorning))
    }

    const NOW = new Date(2026, 8, 18, 12, 0).getTime()
    const D = (k) => localDateKey(NOW - k * 86400000)
    const time = {
      totalSeconds: 9000,
      days: { [D(0)]: 600, [D(1)]: 1200, [D(2)]: 30, [D(3)]: 100, [D(8)]: 5000 },
      points: { 'p.a': 300, 'p.b': 900, 'p.c': 60, 'p.d': 0, 'p.e': 120, 'p.f': 5000 },
    }
    const s = studySummary(time, NOW)
    if (s.todaySeconds === 600) ok('今天 600 秒')
    else fail('今天算错：' + s.todaySeconds)
    if (s.weekSeconds === 1930) ok('最近 7 天 1930 秒 = 600+1200+30+100（8 天前那 5000 不算）')
    else fail('7 天合计算错：' + s.weekSeconds)
    if (s.totalSeconds === 9000) ok('累计 9000 秒直接取 totalSeconds')
    else fail('累计算错：' + s.totalSeconds)
    if (s.streakDays === 2) ok('连续 2 天（今天 + 昨天；第 3 天只有 30 秒，不足 1 分钟，断开）')
    else fail('连续天数算错：' + s.streakDays)
    if (s.activeDays === 4) ok('有学习的天数 4（今天 / 昨天 / 3 天前 / 8 天前都 ≥1 分钟；30 秒那天不算）')
    else fail('有效天数算错：' + s.activeDays)
    if (s.bars.length === 7 && s.bars[6].key === D(0) && s.bars[6].seconds === 600 && s.bars[0].key === D(6)) {
      ok('柱状图 7 根，最右是今天、最左是 6 天前')
    } else {
      fail('柱状图不对：' + JSON.stringify(s.bars.map((b) => [b.key, b.seconds])))
    }
    const topIds = s.topPoints.map((it) => it.id)
    if (s.topPoints.length === 5 && topIds.join(',') === 'p.f,p.b,p.a,p.e,p.c') {
      ok('花时间最多的 5 个按秒降序、0 秒的不进榜（' + topIds.join(' > ') + '）')
    } else {
      fail('排行不对：' + JSON.stringify(s.topPoints))
    }

    // 今天还没学：连续天数从昨天起算，不算断
    const s2 = studySummary({ days: { [D(1)]: 600, [D(2)]: 600 } }, NOW)
    if (s2.todaySeconds === 0 && s2.streakDays === 2) ok('今天还没学时从昨天起算连续（不算断签）')
    else fail('没学时的连续天数不对：' + JSON.stringify(s2))
    const s3 = studySummary({ days: {} }, NOW)
    if (s3.streakDays === 0 && s3.todaySeconds === 0 && s3.totalSeconds === 0 && s3.bars.length === 7) ok('空数据不炸：全 0，柱状图仍是 7 根')
    else fail('空数据结果不对：' + JSON.stringify(s3))
    const s4 = studySummary(null, NOW)
    if (s4.totalSeconds === 0 && s4.streakDays === 0) ok('传 null 也不炸（第一次用时还没生成 time.json）')
    else fail('null 处理不对')
    const s5 = studySummary({ totalSeconds: -100, days: { [D(0)]: -50 } }, NOW)
    if (s5.todaySeconds === 0 && s5.totalSeconds === 0) ok('负数被当成 0（脏数据不显示负时长）')
    else fail('负数处理不对：' + JSON.stringify(s5))
    // 只统计最近 7 天，更早的不能混进 7 天合计
    const s6 = studySummary({ days: { [D(6)]: 60, [D(7)]: 99999 } }, NOW)
    if (s6.weekSeconds === 60) ok('第 8 天的不混进「最近 7 天」（边界取 6 天前）')
    else fail('7 天边界算错：' + s6.weekSeconds)

    // 人话化
    const cases = [[0, '0 秒'], [30, '30 秒'], [59, '59 秒'], [60, '1 分钟'], [90, '1 分钟'], [3599, '59 分钟'], [3600, '1 小时'], [3900, '1 小时 5 分钟'], [7200, '2 小时']]
    const badH = cases.filter(([s7, want]) => humanTime(s7) !== want)
    if (badH.length === 0) ok('时长说的是人话（0 秒 / 1 分钟 / 1 小时 5 分钟 / 2 小时 …）')
    else fail('humanTime 不对：' + badH.map(([s7, want]) => s7 + '→' + humanTime(s7) + '（期望 ' + want + '）').join(' '))
    if (inner.IDLE_MS === 300000) ok('空闲判定 5 分钟（超过就不计时：不把「窗口挂了一夜」算成学习）')
    else fail('IDLE_MS 不对：' + inner.IDLE_MS)
  }
}

// ---------------------------------------------------------------- 10. 静态检查
console.log('')
console.log('=== 10. 静态检查：关键接线都在 ===')
{
  const clientsrc = readFileSync(SRC, 'utf8')
  for (const [needle, label] of [
    ['function enterLearning(ctx)', 'C3 共享的进入逻辑'],
    ["rpc('forget-session'", 'C3 清烂指针'],
    ['mountFailed(ctx,', 'C5 挂载失败提示'],
    ['const [attempt, setAttempt]', 'C2 重试计数'],
    ['onClick: retry', 'C2 重新读取按钮'],
    ['onClick: doEnter', 'C3 进入学习会话按钮'],
    ['ctx: props.ctx', '把 ctx 传给学习界面'],
    ['onClick: toggleBackup', 'E1 进度备份入口'],
    ["rpc('export-progress'", 'E1 导出调用'],
    ["rpc('import-progress'", 'E1 导入调用'],
    ['onClick: doExport', 'E1 导出按钮'],
    ['onClick: pickImportFile', 'E1 导入按钮'],
    ["rpc('export-markdown'", 'E4 课程 Markdown 导出调用'],
    ['onClick: doExportCourse', 'E4 课程导出按钮'],
    ['const downloadBlob = (url, name)', '下载统一走一个函数（三处共用）'],
    ["rpc('time-summary'", 'E3 时长获取调用'],
    ['onClick: toggleStudy', 'E3 学习统计入口'],
    ['function studySummary(', 'E3 统计纯函数'],
    ['function StudyTimer(', 'E3 计时组件'],
    ['h(StudyTimer, { key: \'timer\'', 'E3 计时器挂在学习界面上'],
    ["rpc('about'", 'E5 设置信息调用'],
    ['onClick: toggleAbout', 'E5 设置入口'],
    ["rpc('reset-progress', { confirm: 'RESET' }", 'E5 清空进度（带显式确认串）'],
    ['onClick: doForgetSession', 'E5 忘记学习会话'],
    ['onClick: doReset', 'E5 清空进度按钮'],
    ['onClick: enterReview', 'E2 今日复习入口'],
    ['onClick: () => markReviewed', 'E2 复习过了按钮'],
    ['function reviewQueue(', 'E2 复习队列纯函数'],
    ['const [reviewMode, setReviewMode]', 'E2 独立界面状态'],
  ]) {
    if (clientsrc.includes(needle)) ok(label)
    else fail('客户端缺少：' + label + '（' + needle + '）')
  }
  // 导入必须先备份：确认 host 侧是先 mkdir 备份再写
  // 用 join 拼路径，不要用字符串 replace：Windows 下路径是反斜杠，
  // 'lib/client.js' 这种正斜杠子串替换不到，会把客户端半当成主机半来断言。
  const hostsrc = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
  const importAt = hostsrc.indexOf("async 'import-progress'")
  const backupAt = hostsrc.indexOf("const backupRel = 'progress/backups/'")
  const writeAt = hostsrc.indexOf("await writeJson('progress/state.json', { version: 1, updatedAt: at")
  if (importAt >= 0 && backupAt > importAt && writeAt > backupAt) ok('E1 导入顺序正确：先备份 → 备份失败就返回 → 才写盘')
  else fail('E1 导入的写入顺序不对（备份必须排在写盘之前）')
  if (hostsrc.indexOf("reason: 'backup-failed:") > backupAt) ok('E1 备份失败时不覆盖（返回 backup-failed）')
  else fail('E1 没有「备份失败就拒绝导入」这条底线')
  // 界面不许出现"先删后写"式的破坏性写法
  if (!/rmSync|unlink\(/.test(hostsrc)) ok('主机半没有任何删除文件的调用（只会覆盖写，且覆盖前有备份）')
  else fail('主机半出现了删除文件的调用，需要人工确认不可逆风险')
  // 重置进度也必须先备份、且必须显式确认
  const resetAt = hostsrc.indexOf("async 'reset-progress'")
  const needConfirm = hostsrc.indexOf("reason: 'need-confirm'")
  const resetBackup = hostsrc.indexOf("'-before-reset'")
  const resetWrite = hostsrc.indexOf("await writeJson('progress/state.json', { version: 1, updatedAt: at, points: {} })", resetAt)
  if (resetAt > 0 && needConfirm > resetAt && resetBackup > needConfirm && resetWrite > resetBackup) {
    ok('E5 重置顺序正确：先要 confirm → 再备份 → 备份成功才清空')
  } else {
    fail('E5 重置的写入顺序不对（必须：确认 → 备份 → 清空）')
  }
  // 版本号必须从插件包目录读，不能跟着数据目录走
  if (hostsrc.indexOf('join(PACKAGE_ROOT, \'package.json\')') > 0) {
    ok('E5 版本号从插件包目录读（config.root 指到别处也不会读不到版本）')
  } else {
    fail('E5 版本号是从数据目录读的，config.root 一改就空了')
  }

  // ---------------------------------------------------------------------
  // CSS 自检。这一组是被一次真实事故逼出来的：
  // 我给学习统计的柱状图写了 .pkl-bar{width:22px}，可 .pkl-bar 早就被
  // **整个顶栏容器**用了 —— 同名选择器后者覆盖前者，顶栏被压成 22px 宽，
  // 主线按钮 / 搜索框 / 工序按钮全挤成竖排单字。
  // 渲染类的问题脚本看不见，但「同名选择器被定义两次」这件事静态就能查。
  // ---------------------------------------------------------------------
  {
    const cssStart = clientsrc.indexOf('const CSS = [')
    const cssEnd = clientsrc.indexOf('\n    ]', cssStart)
    if (cssStart < 0 || cssEnd < 0) {
      fail('找不到 CSS 数组，样式自检没法做')
    } else {
      const css = clientsrc.slice(cssStart, cssEnd)
      const rules = []
      for (const line of css.split('\n')) {
        const m = line.match(/'(\.pkl[^']*)',?\s*$/)
        if (m) rules.push(m[1])
      }
      const bySelector = new Map()
      for (const r of rules) {
        const sel = r.slice(0, r.indexOf('{'))
        if (!bySelector.has(sel)) bySelector.set(sel, [])
        bySelector.get(sel).push(r)
      }
      const dups = [...bySelector.entries()].filter(([, v]) => v.length > 1)
      if (dups.length === 0) {
        ok('CSS ' + rules.length + ' 条规则，没有同名选择器被定义两次（真出过事的那一类，现在会被拦住）')
      } else {
        for (const [sel, v] of dups) {
          fail('选择器 ' + sel + ' 被定义了 ' + v.length + ' 次 —— 后面的会覆盖前面的，先确认它到底该管哪个元素：\n        ' + v.join('\n        '))
        }
      }
      // 结构容器各只能有一条规则：这次事故的直接形态
      for (const key of ['.pkl-bar', '.pkl-learn', '.pkl-body', '.pkl-main', '.pkl-tree', '.pkl-wrong']) {
        const n = rules.filter((r) => r.slice(0, r.indexOf('{')) === key).length
        if (n !== 1) fail('结构容器 ' + key + ' 被定义了 ' + n + ' 次（应恰好 1 次）')
      }
      // 渲染里用到的类名必须在 CSS 里有定义（typo / 漏样式都会被抓住）
      const usedClasses = new Set()
      for (const m of clientsrc.matchAll(/className: '([^']+)'/g)) {
        for (const c of m[1].split(/\s+/)) if (c.startsWith('pkl-')) usedClasses.add(c)
      }
      const missing = [...usedClasses].filter((c) => !css.includes('.' + c))
      if (missing.length === 0) ok('渲染代码用到的 ' + usedClasses.size + ' 个类名全都有对应样式')
      else fail('这些类名在渲染里用了但 CSS 里没有：' + missing.join(', '))

      // 横排容器必须「能换行」或「能横向滚动」：否则窄窗口下会往右溢出，
      // 被外层容器一裁，里头的按钮就凭空消失了 —— 用户甚至不知道有这些功能。
      for (const key of ['.pkl-toolbar', '.pkl-tracks', '.pkl-procs']) {
        const rule = rules.find((r) => r.slice(0, r.indexOf('{')) === key) || ''
        if (rule.includes('flex-wrap:wrap') || rule.includes('overflow-x:auto')) {
          ok('横排容器 ' + key + ' 允许换行或可横向滚动（不会溢出被裁掉）')
        } else {
          fail('横排容器 ' + key + ' 既不换行也不可滚动 —— 窄窗口下按钮会溢出后被裁掉')
        }
      }
      // 按钮不许被压缩：宁可换行，也不要挤成一条缝
      const trackRule = rules.find((r) => r.slice(0, r.indexOf('{')) === '.pkl-track') || ''
      if (trackRule.includes('flex:0 0 auto')) ok('按钮声明了 flex:0 0 auto（永不被压缩成一条缝）')
      else fail('.pkl-track 没有 flex:0 0 auto，窄窗口下按钮会被压扁甚至看不见')
    }
  }
}

console.log('')
console.log(failed === 0 ? '客户端半全部通过 ✅' : '有 ' + failed + ' 项没通过 ❌')
process.exit(failed === 0 ? 0 : 1)
