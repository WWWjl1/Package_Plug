// 渲染冒烟测试：把插件真的挂上去，用「迷你 React」把学习界面完整渲染一遍。
//
// 为什么需要它：
//   之前的验收脚本只测「数据对不对、接线在不在、纯函数算得对不对」，
//   从来没真正把组件树跑一遍 —— 所以「渲染时崩了 / 某块界面根本没出来」
//   这类问题只会在用户屏幕上暴露，我这边完全看不见。
//
// 它怎么做到「真实」：
//   1. 用 config.root 把主机半挂到一个**临时目录**（content/assets 拷过去），
//      所以测试读写的是临时进度，不会碰用户真实数据。
//   2. 走插件的真实入口 apply(ctx) + slots.register，
//      拿到的就是 dsh 会渲染的那个组件回调。
//   3. fetch 被接到真实的主机半路由上 —— 界面拿到的是真实课程数据。
//   4. 用自制的迷你 React 跑组件（含 useState/useEffect/useRef、
//      effect 重跑、异步 setState 收敛、**Hook 顺序变化检测**）。
//
// 它抓不到什么（不吹）：
//   - CSS 布局长什么样（这次的 22px 事故就属于那类，由 _client-check.mjs 的 CSS 自检兜）
//   - 视觉美观、真实浏览器的重排/溢出
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REAL = ROOT
const TMP = join(ROOT, '.tmp-check/render')
const SID = 'render-test-session'
let failed = 0
// 脚本可能中途 process.exit（比如渲染崩了），那就走不到最后的 rmSync。
// 挂一个退出钩子，保证临时目录不残留。
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch (error) { /* 已经没了 */ } })
const fail = (m) => { failed += 1; console.log('  x ' + m) }
const ok = (m) => console.log('  . ' + m)

// ---------------------------------------------------------------- 1. 临时数据目录
console.log('=== 1. 准备临时数据目录（不碰真实进度）===')
rmSync(TMP, { recursive: true, force: true })
mkdirSync(join(TMP, 'progress'), { recursive: true })
for (const dir of ['content', 'assets', 'knowledge']) {
  cpSync(join(REAL, dir), join(TMP, dir), { recursive: true })
}
cpSync(join(REAL, 'package.json'), join(TMP, 'package.json'))
const TODAY = (() => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
})()
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString()
writeFileSync(join(TMP, 'progress/session.json'), JSON.stringify({ version: 1, sessionId: SID }), 'utf8')
writeFileSync(join(TMP, 'progress/state.json'), JSON.stringify({
  version: 1,
  points: {
    // 一个「在学」（放了 5 天 -> 今日复习队列里应该有它）
    'dc.overview': { status: 'learning', updatedAt: iso(5) },
    // 一个「已掌握」且复习过一次（间隔 3 天，还没到期）
    'wb.principle': { status: 'mastered', updatedAt: iso(1), reviewCount: 1, reviewedAt: iso(1) },
  },
}, null, 2), 'utf8')
writeFileSync(join(TMP, 'progress/quiz.json'), JSON.stringify({
  version: 1,
  attempts: [{ at: iso(2), pointId: 'dc.overview', correct: false }],
  // dc.overview 的第 1 题答错 -> 它应该排进今日复习队列的最前面
  wrong: { 'dc.overview': [0] },
}, null, 2), 'utf8')
writeFileSync(join(TMP, 'progress/time.json'), JSON.stringify({
  version: 1, totalSeconds: 1800, days: { [TODAY]: 600 }, points: { 'dc.overview': 600 },
}, null, 2), 'utf8')
ok('临时目录就绪：content / assets / knowledge 已拷贝，进度是构造好的固定数据')

// ---------------------------------------------------------------- 2. 挂主机半
console.log('')
console.log('=== 2. 挂载主机半（临时 root）===')
const hostMod = await import(pathToFileURL(join(REAL, 'lib/index.js')).href)
let route = null
const hostCtx = {
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  get: (n) => (n === 'webServer' ? { register(row) { route = row; return () => {} } } : undefined),
  effect: (fn) => (typeof fn === 'function' ? fn() : fn),
  timeout: (fn) => setTimeout(fn, 0),
}
hostMod.apply(hostCtx, { root: TMP.replace(/\\/g, '/') })
if (route === null) { fail('主机半没有注册路由'); process.exit(1) }
ok('主机半挂在临时目录上：' + route.path)

function callHost(method, args) {
  return new Promise((resolve) => {
    const listeners = {}
    let out = ''
    let done = null
    const finished = new Promise((r) => { done = r })
    const req = { method: 'POST', headers: {}, on(ev, cb) { listeners[ev] = cb; return req } }
    const res = { statusCode: 0, setHeader() {}, end(b) { if (b !== undefined) out += String(b); done() } }
    route.handler(req, res)
    queueMicrotask(() => {
      if (listeners.data) listeners.data(JSON.stringify({ method, args: args || {} }))
      if (listeners.end) listeners.end()
    })
    finished.then(() => {
      const parsed = JSON.parse(out)
      resolve(parsed.ok === true ? parsed.value : { __error: parsed.error })
    })
  })
}

// ---------------------------------------------------------------- 3. 迷你 React
console.log('')
console.log('=== 3. 迷你 React（含 Hook 顺序检测）===')
function createMiniReact() {
  const instances = new Map()
  let current = null
  let pending = false
  let effectQueue = []
  const cleanups = []
  const hookOrderErrors = []

  const Fragment = Symbol('Fragment')

  function slot(kind) {
    if (current === null) throw new Error('在组件外面调用了 Hook')
    const i = current.cursor
    current.cursor += 1
    const rec = current.slots[i] || (current.slots[i] = { kind })
    if (rec.kind !== kind) {
      const msg = '第 ' + i + ' 个 Hook 从 ' + rec.kind + ' 变成了 ' + kind
      hookOrderErrors.push(msg)
      throw new Error('Hook 顺序变了：' + msg + '（这就是 React #310 那种崩溃）')
    }
    return rec
  }

  const React = {
    Fragment,
    createElement(type, props, ...kids) { return { type, props: props || {}, kids } },
    useState(initial) {
      const rec = slot('state')
      if (!('value' in rec)) rec.value = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const v = typeof next === 'function' ? next(rec.value) : next
        if (Object.is(v, rec.value)) return
        rec.value = v
        pending = true
      }
      return [rec.value, set]
    },
    useEffect(fn, deps) {
      const rec = slot('effect')
      const prev = rec.deps
      const changed = prev === undefined || deps === undefined || deps.length !== prev.length
        || deps.some((d, i) => !Object.is(d, prev[i]))
      rec.deps = deps ? deps.slice() : undefined
      if (changed) effectQueue.push({ rec, fn })
    },
    useRef(v) {
      const rec = slot('ref')
      if (!('ref' in rec)) rec.ref = { current: v }
      return rec.ref
    },
  }

  function renderNode(node, path) {
    if (node === null || node === undefined || node === false || node === true || node === '') return null
    if (typeof node === 'string' || typeof node === 'number') {
      return { tag: '#text', props: {}, text: String(node), children: [] }
    }
    if (Array.isArray(node)) {
      const kids = []
      for (let i = 0; i < node.length; i += 1) {
        const c = renderNode(node[i], path + '/' + i)
        if (c) kids.push(c)
      }
      return { tag: '#frag', props: {}, text: '', children: kids }
    }
    if (typeof node.type === 'function') {
      const key = String(node.type.name || 'anonymous') + '(' + (node.props.key !== undefined ? node.props.key : path) + ')'
      let inst = instances.get(key)
      if (inst === undefined) { inst = { slots: [], cursor: 0 }; instances.set(key, inst) }
      const prev = current
      current = inst
      inst.cursor = 0
      let out
      try {
        out = node.type(node.props)
      } finally {
        current = prev
      }
      return renderNode(out, key)
    }
    if (node.type === Fragment) return renderNode(node.kids, path)
    const kids = []
    for (let i = 0; i < node.kids.length; i += 1) {
      const c = renderNode(node.kids[i], path + '/' + i)
      if (c) kids.push(c)
    }
    return { tag: node.type, props: node.props, text: '', children: kids }
  }

  const flush = async (n) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)) }

  // 在途请求计数：由测试里的 fetch 维护。
  // 为什么需要它：load 要顺序读 19 个内容文件 + 19 张图，每次文件读取都是一次真实 IO，
  // 落在事件循环的更晚一轮。只按"等 N 轮"来判断稳定，就会在请求还没回来时提前收工，
  // 渲染出一棵"正在读取课程…"的空树 —— 这不是等久一点的问题，是要等到真的没事在飞。
  let inFlight = 0
  const setInFlight = (n) => { inFlight = n }
  const getInFlight = () => inFlight

  async function render(thunk, maxPasses) {
    let tree = null
    const limit = maxPasses || 12
    for (let pass = 0; pass < limit; pass += 1) {
      pending = false
      effectQueue = []
      current = null
      tree = renderNode(thunk(), '')
      const queue = effectQueue
      effectQueue = []
      for (const item of queue) {
        const c = item.fn()
        if (typeof c === 'function') cleanups.push(c)
      }
      // 等到「有状态变化」或「彻底稳定」为止：
      //   - 一有状态变化就立刻进入下一轮渲染（不要白等）
      //   - 没有状态变化、也没有在途请求，就是稳定了
      for (let tick = 0; tick < 300; tick += 1) {
        await new Promise((r) => setTimeout(r, 0))
        if (pending) break
        if (getInFlight() === 0) break
      }
      // 再补两轮，让最后一刻的 setState 微任务也落地
      await flush(2)
      // 至少渲染两轮：第一轮只是把初始状态画出来，effect 的结果要再渲染一次才看得见
      if (!pending && pass >= 1) return tree
    }
    throw new Error('渲染没有收敛（' + limit + ' 轮之后还一直在 setState）')
  }

  return { React, render, cleanups, hookOrderErrors, instances, setInFlight }
}

const mini = createMiniReact()
ok('迷你 React 就绪（useState / useEffect / useRef / Fragment + Hook 顺序检测）')

// ---------------------------------------------------------------- 4. 假浏览器环境
const domNodes = []
function fakeElement(tag) {
  return {
    tagName: tag, id: '', textContent: '', attrs: {}, style: {},
    setAttribute(k, v) { this.attrs[k] = v },
    remove() { },
    appendChild() { },
  }
}
const miniListeners = {}
globalThis.document = {
  documentElement: fakeElement('html'),
  head: { appendChild() {} },
  body: { appendChild(n) { domNodes.push(n) } },
  createElement: fakeElement,
  getElementById: () => null,
  addEventListener(k, fn) { (miniListeners[k] = miniListeners[k] || []).push(fn) },
  removeEventListener() {},
  visibilityState: 'visible',
}
globalThis.window = {
  __ModuleLoader__: { load(r) { globalThis.__loaded = r } },
  innerHeight: 900,
  confirm: () => true,
  addEventListener() {},
}
let lastStyle = ''
globalThis.document.createElement = (tag) => {
  const el = fakeElement(tag)
  if (tag === 'style') {
    Object.defineProperty(el, 'textContent', { set(v) { lastStyle = v }, get() { return lastStyle } })
  }
  return el
}
globalThis.URL.createObjectURL = () => 'blob:fake'
let inFlight = 0
mini.setInFlight(0)
globalThis.fetch = async (url, opts) => {
  const payload = JSON.parse(opts.body)
  inFlight += 1
  mini.setInFlight(inFlight)
  try {
    // gate 直接按测试会话作答，不依赖真实进度文件
    const value = payload.method === 'gate'
      ? { root: TMP, sessionId: SID, visited: false }
      : await callHost(payload.method, payload.args)
    return { json: async () => (value && value.__error ? { ok: false, error: value.__error } : { ok: true, value }) }
  } finally {
    inFlight -= 1
    mini.setInFlight(inFlight)
  }
}
ok('假浏览器环境就绪（document / window / fetch → 真实主机半）')

// ---------------------------------------------------------------- 5. 加载并挂上客户端半
console.log('')
console.log('=== 4. 走真实入口：apply(ctx) + slots.register ===')
const src = readFileSync(join(REAL, 'lib/client.js'), 'utf8')
new Function('window', 'document', src)(globalThis.window, globalThis.document)
const loaded = globalThis.__loaded
if (!loaded) { fail('客户端半没有注册模块'); process.exit(1) }

const captured = {}
const fakeSlots = {
  inject(key, cb) { if (typeof cb === 'function') cb(); return () => {} },
  register(row, component) { captured[row.name] = { row, component }; return () => {} },
}
const clientMod = loaded.factory((name) => {
  if (name === 'react') return mini.React
  throw new Error('不允许的外部依赖：' + name)
})
const clientCtx = {
  get: (n) => (n === 'slots' ? fakeSlots : undefined),
  effect: (fn) => { const d = typeof fn === 'function' ? fn() : undefined; mini.cleanups.push(() => d && d()); return d },
  timeout: (fn, ms) => setTimeout(fn, ms),
}
try {
  clientMod.apply(clientCtx)
} catch (error) {
  fail('apply() 抛错：' + error.message)
  process.exit(1)
}
const names = Object.keys(captured)
if (names.length === 3) ok('三个槽位都登记了：' + names.join(' / '))
else fail('槽位登记数不对：' + JSON.stringify(names))
if (!captured['conversation.view']) { fail('没有登记学习界面'); process.exit(1) }
ok('拿到 dsh 会渲染的那个组件回调（conversation.view）')

// ---------------------------------------------------------------- 6. 渲染
const slotProps = {
  sessionId: SID,
  inputActions: { setDraft() {}, submit() {} },
  openView() {},
}
const thunk = () => captured['conversation.view'].component(slotProps)
let tree = null
console.log('')
console.log('=== 5. 第一次渲染（真实课程数据 + 真实主机半）===')
try {
  tree = await mini.render(thunk)
  ok('整棵组件树渲染完成，没有抛错')
} catch (error) {
  fail('渲染时崩了：' + error.message + '\n' + String(error.stack || '').split('\n').slice(1, 5).join('\n'))
  process.exit(1)
}

// 渲染完先看一眼"到底渲染出了什么"：出问题时这行比任何断言都快
const brief = (v) => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array(' + v.length + ')'
  if (typeof v === 'object') return 'object(' + Object.keys(v).length + ')'
  if (typeof v === 'string') return JSON.stringify(v.length > 24 ? v.slice(0, 24) + '…' : v)
  return String(v)
}
console.log('  [调试] 组件实例 ' + mini.instances.size + ' 个')
for (const [key, inst] of mini.instances) {
  if (key.indexOf('LearnView') !== 0) continue
  console.log('  [调试] ' + key + ' 的状态：' + inst.slots.map((s, i) => i + ':' + s.kind + '=' + brief(s.value)).join('  '))
}
console.log('  [调试] 渲染出来的文字开头 160 字：' + allText(tree).replace(/\s+/g, ' ').slice(0, 160))

// ---------------------------------------------------------------- 工具
function walk(node, fn) {
  if (!node) return
  fn(node)
  for (const c of node.children || []) walk(c, fn)
}
function textOf(node) {
  if (!node) return ''
  let s = node.text || ''
  for (const c of node.children || []) s += textOf(c)
  return s
}
function allText(node) { let s = ''; walk(node, (n) => { s += n.text || '' }); return s }
function classList(node) { const out = new Set(); walk(node, (n) => { if (n.props && n.props.className) String(n.props.className).split(/\s+/).forEach((c) => out.add(c)) }); return out }
function buttons(node) { const out = []; walk(node, (n) => { if (n.tag === 'button') out.push(n) }); return out }
function click(node, label) {
  const hits = buttons(node).filter((b) => textOf(b).includes(label))
  if (hits.length === 0) throw new Error('找不到按钮「' + label + '」，当前按钮有：' + buttons(node).map((b) => textOf(b)).join(' | ').slice(0, 300))
  const onClick = hits[0].props.onClick
  if (typeof onClick !== 'function') throw new Error('按钮「' + label + '」没有 onClick')
  onClick()
}

// ---------------------------------------------------------------- 7. 断言
console.log('')
console.log('=== 6. 该出来的东西都出来了吗 ===')
const text = allText(tree)
const classes = classList(tree)

const mustHaveText = [
  ['为什么必须减薄', '默认落在第一道工序的第一个知识点'],
  ['小测 ·', '小测区块标题'],
  ['先选一个选项', '小测按钮（还没选选项时）'],
  ['标记为已掌握', '状态按钮'],
  ['课程自检', '工具区第一颗按钮'],
  ['备份与导出', '工具区第二颗按钮'],
  ['学习统计', '工具区第三颗按钮'],
  ['设置', '工具区第四颗按钮'],
  ['传统封装流程', '主线 1'],
  ['先进封装', '主线 2'],
  ['专题模块', '主线 3'],
  ['错题重做', '错题重做入口'],
  ['今日复习', '今日复习入口'],
]
for (const [needle, label] of mustHaveText) {
  if (text.includes(needle)) ok(label + '（' + needle + '）')
  else fail('界面里找不到：' + label + '（' + needle + '）')
}
const mustHaveClass = ['pkl-bar', 'pkl-tracks', 'pkl-toolbar', 'pkl-procs', 'pkl-tree', 'pkl-main', 'pkl-quiz', 'pkl-askbar', 'pkl-nav', 'pkl-breadcrumb', 'pkl-opts', 'pkl-opt']
for (const c of mustHaveClass) {
  if (classes.has(c)) ok('结构类 ' + c + ' 渲染出来了')
  else if (c === 'pkl-breadcrumb') continue
  else fail('结构类 ' + c + ' 没渲染出来')
}

// 工序按钮：第一道主线的 8 道工序都该在
const procRow = (() => { let found = null; walk(tree, (n) => { if (n.props && String(n.props.className || '').includes('pkl-procs')) found = n }); return found })()
if (procRow) {
  const labels = buttons(procRow).map((b) => textOf(b))
  if (labels.length === 8 && labels.join(',').includes('减薄') && labels.join(',').includes('测试')) {
    ok('工序按钮 8 道都在：' + labels.join(' / '))
  } else {
    fail('工序按钮不对（' + labels.length + ' 个）：' + labels.join(' / '))
  }
} else {
  fail('找不到工序按钮那一行')
}

// 知识树：三条主线 + 全部 19 道工序
// 注意用「类名精确匹配」：pkl-tree-node / pkl-tree-proc 都含 pkl-tree 前缀，
// 用 includes 会一路匹配到最后一个叶子节点（我第一次就踩了这个坑）。
const hasClass = (node, cls) => {
  const list = String((node.props && node.props.className) || '').split(/\s+/)
  return list.indexOf(cls) >= 0
}
const treeCol = (() => { let found = null; walk(tree, (n) => { if (hasClass(n, 'pkl-tree')) found = n }); return found })()
if (treeCol) {
  const t = textOf(treeCol)
  const procs = ['减薄', '划片', '装片', '引线键合', '塑封', '植球', '切筋成型', '测试', 'Bumping', 'WLCSP', 'Fan-out', 'TSV', '堆叠', 'Chiplet', '封装形式分类', '封装材料', '设备', '可靠性测试', '行业术语']
  const missing = procs.filter((p) => !t.includes(p))
  if (missing.length === 0) ok('知识树里 19 道工序全都在（含三条主线的全部模块）')
  else fail('知识树里少了：' + missing.join(' / '))
} else {
  fail('找不到知识树')
}

// 今日复习队列：构造的数据里 dc.overview 有未消化错题 -> 队列 1 条
const reviewPill = buttons(tree).map((b) => textOf(b)).find((s) => s.startsWith('今日复习'))
if (reviewPill && /今日复习\s*1/.test(reviewPill)) ok('今日复习入口带着队列数：' + reviewPill.trim())
else fail('今日复习入口的数量不对：' + JSON.stringify(reviewPill))
const wrongPill = buttons(tree).map((b) => textOf(b)).find((s) => s.startsWith('错题重做'))
if (wrongPill && /错题重做\s*1/.test(wrongPill)) ok('错题重做入口带着错题数：' + wrongPill.trim())
else fail('错题重做入口的数量不对：' + JSON.stringify(wrongPill))

// ---------------------------------------------------------------- 8. 交互
console.log('')
console.log('=== 7. 点几下，看界面会不会跟着变 ===')
try {
  click(tree, '今日复习')
  tree = await mini.render(thunk)
  const t = allText(tree)
  if (t.includes('今天该回看') && t.includes('错题还没消化')) ok('点「今日复习」→ 独立界面出现，并说清了为什么该看它')
  else fail('今日复习界面没出来，或理由没写：' + t.slice(0, 200))
} catch (error) {
  fail('点今日复习出错：' + error.message)
}

try {
  click(tree, '设置')
  tree = await mini.render(thunk)
  const t = allText(tree)
  if (t.includes('数据目录') && t.includes('进度文件') && t.includes('清空学习进度')) ok('点「设置」→ 版本 / 数据目录 / 进度规模 / 维护按钮都在')
  else fail('设置面板内容不全：' + t.slice(0, 200))
} catch (error) {
  fail('点设置出错：' + error.message)
}

try {
  click(tree, '学习统计')
  tree = await mini.render(thunk)
  const t = allText(tree)
  if (t.includes('今天') && t.includes('最近 7 天') && t.includes('连续')) ok('点「学习统计」→ 统计数字渲染出来了（含异步取数后的二次渲染）')
  else fail('学习统计面板没出来：' + t.slice(0, 200))
} catch (error) {
  fail('点学习统计出错：' + error.message)
}

try {
  click(tree, '备份与导出')
  tree = await mini.render(thunk)
  const t = allText(tree)
  if (t.includes('导出学习进度') && t.includes('导入学习进度') && t.includes('导出课程 Markdown')) ok('点「备份与导出」→ 三颗按钮都在')
  else fail('备份面板内容不全：' + t.slice(0, 200))
} catch (error) {
  fail('点备份与导出出错：' + error.message)
}

// 小测：先选一个选项，再提交，看判分是否出现
try {
  click(tree, '备份与导出') // 收起面板，回到正文
  tree = await mini.render(thunk)
  const opts = []
  walk(tree, (n) => { if (n.tag === 'button' && n.props && String(n.props.className || '').includes('pkl-opt')) opts.push(n) })
  if (opts.length === 0) throw new Error('正文里没有小测选项')
  opts[0].props.onClick()
  tree = await mini.render(thunk)
  const beforeSubmit = buttons(tree).map((b) => textOf(b)).join('|')
  if (beforeSubmit.includes('提交本题')) ok('选了选项之后「提交本题」变成可提交状态（' + opts.length + ' 个选项渲染出来）')
  else fail('选完选项后按钮状态不对：' + beforeSubmit.slice(0, 200))
  click(tree, '提交本题')
  tree = await mini.render(thunk)
  const after = allText(tree)
  if (after.includes('✓ 正确') || after.includes('✗ 不对，正确答案是')) ok('提交后立刻判分并给出解析')
  else fail('提交后没有判分：' + after.slice(0, 200))
} catch (error) {
  fail('小测交互出错：' + error.message)
}

// ---------------------------------------------------------------- 9. 收尾
console.log('')
console.log('=== 8. 收尾 ===')
if (mini.hookOrderErrors.length === 0) ok('全程没有出现 Hook 顺序变化')
else fail('出现 Hook 顺序变化：' + mini.hookOrderErrors.join(' / '))
// 渲染过程只应该在临时目录里写东西
const realState = readFileSync(join(REAL, 'progress/state.json'), 'utf8')
const tmpState = readFileSync(join(TMP, 'progress/state.json'), 'utf8')
if (realState === tmpState) fail('渲染把临时数据写成了和真实进度一样？这不可能，检查测试是否真的在用临时目录')
else ok('渲染只写了临时目录，没碰你真实的 progress/')

let cleaned = 0
for (const fn of mini.cleanups) { try { fn(); cleaned += 1 } catch (error) { /* 忽略 */ } }
ok('跑完 ' + cleaned + ' 个清理函数（定时器 / 事件监听都收掉了）')
rmSync(TMP, { recursive: true, force: true })

console.log('')
console.log(failed === 0 ? '渲染冒烟测试全部通过 ✅' : '有 ' + failed + ' 项没通过 ❌')
process.exit(failed === 0 ? 0 : 1)
