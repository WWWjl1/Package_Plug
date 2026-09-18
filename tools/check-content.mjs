// 课程内容统一验收：结构 + 深度标记 + 配图
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BLOCKS = new Set(['p', 'h', 'list', 'table', 'figure', 'callout'])

function xmlOk(p) {
  try {
    const t = readFileSync(p, 'utf8')
    if (!/<svg[\s>]/.test(t)) return 'no <svg> root'
    if (!/xmlns=/.test(t)) return 'no xmlns'
    // 先去掉引号里的内容再数标签：属性值里出现 < 或 > 是正常的（比如 path 的 d 属性），
    // 不去掉就会像以前那样误报 tag mismatch。
    const stripped = t.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''")
    const open = (stripped.match(/<[a-zA-Z][^>]*[^/]>/g) || []).length
    const close = (stripped.match(/<\/[a-zA-Z]/g) || []).length
    const self = (stripped.match(/<[a-zA-Z][^>]*\/>/g) || []).length
    // 正确的不变量是「开标签数 == 闭标签数」：
    // 自闭合标签（<rect/>）本来就不需要闭合标签，所以不能算进去。
    // 之前写成 open !== close + self，结果每张用了自闭合标签的图都误报，纯属自找麻烦。
    // 说明：这个检查抓不到「嵌套错位」（<a><b></a></b>），
    // 真要严格校验请用 XML 解析器；这里只求便宜地拦下漏闭合这类最常见的坏图。
    if (open !== close) return 'tag mismatch open=' + open + ' close=' + close + ' self=' + self
    return 'OK'
  } catch (e) {
    return 'read fail: ' + e.message
  }
}

let files = process.argv.slice(2)
if (files.length === 0) {
  // 不给参数就检查全部内容文件（以前必须手动列文件名，很容易漏）
  files = []
  for (const d of ['traditional', 'advanced', 'topics']) {
    const dir = join(ROOT, 'content', d)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) if (name.endsWith('.json')) files.push(name)
  }
  console.log('未指定文件，检查全部 ' + files.length + ' 个内容文件')
}
for (const f of files) {
  let base = 'content/traditional'
  for (const d of ['traditional', 'advanced', 'topics']) {
    if (existsSync(join(ROOT, 'content/' + d, f))) { base = 'content/' + d; break }
  }
  const path = join(ROOT, base, f)
  const line = []
  line.push('\n=== ' + f + ' ===')
  if (!existsSync(path)) { line.push('  ✗ 文件不存在'); console.log(line.join('\n')); continue }
  let doc
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    line.push('  ✗ JSON 解析失败: ' + e.message); console.log(line.join('\n')); process.exitCode = 1; continue
  }

  const problems = []
  const figures = []
  let points = 0, quizzes = 0, blocks = 0, keys = 0, warns = 0, backtick = 0, mdHead = 0

  if (typeof doc.id !== 'string') problems.push('缺 id')
  if (doc.track !== 'traditional' && doc.track !== 'advanced' && doc.track !== 'topics') problems.push('track 值异常: ' + doc.track)
  if (typeof doc.title !== 'string') problems.push('缺 title')
  if (typeof doc.subtitle !== 'string') problems.push('缺 subtitle')
  if (typeof doc.whyItMatters !== 'string') problems.push('缺 whyItMatters')

  const ids = new Set()
  for (const p of (doc.points || [])) {
    points += 1
    if (typeof p.id !== 'string') { problems.push('细分点缺 id'); continue }
    if (ids.has(p.id)) problems.push('细分点 id 重复: ' + p.id)
    ids.add(p.id)
    if (typeof p.title !== 'string') problems.push(p.id + ' 缺 title')
    if (typeof p.estMinutes !== 'number') problems.push(p.id + ' 缺 estMinutes')
    if (!Array.isArray(p.body) || p.body.length === 0) problems.push(p.id + ' body 为空')
    for (const b of (p.body || [])) {
      blocks += 1
      if (!b || !BLOCKS.has(b.type)) { problems.push(p.id + ' 未知块类型: ' + (b && b.type)); continue }
      if (b.type === 'callout') { if (b.tone === 'warn') warns += 1; else keys += 1 }
      if (b.type === 'figure') {
        if (typeof b.svg !== 'string' || !existsSync(join(ROOT, 'assets', b.svg))) problems.push(p.id + ' 图不存在: ' + b.svg)
        else figures.push(b.svg)
      }
    }
    const text = JSON.stringify(p)
    backtick += (text.match(/`/g) || []).length
    mdHead += (text.match(/\\n#{1,3} /g) || []).length
    if (!Array.isArray(p.quiz) || p.quiz.length < 3) problems.push(p.id + ' 小测少于 3 题')
    for (const [i, q] of (p.quiz || []).entries()) {
      quizzes += 1
      if (typeof q.q !== 'string' || q.q === '') problems.push(p.id + ' 第' + (i + 1) + '题缺题干')
      if (!Array.isArray(q.options) || q.options.length < 2) problems.push(p.id + ' 第' + (i + 1) + '题选项不足')
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) problems.push(p.id + ' 第' + (i + 1) + '题 answer 越界')
      if (typeof q.explain !== 'string' || q.explain === '') problems.push(p.id + ' 第' + (i + 1) + '题缺解析')
    }
  }

  line.push('  细分点 ' + points + ' / 小测 ' + quizzes + ' / 正文块 ' + blocks)
  line.push('  深度标记：面试预判(key) ' + keys + ' 处，陷阱/失效链(warn) ' + warns + ' 处')
  line.push('  格式：反引号 ' + backtick + '，markdown 标题 ' + mdHead)
  if (figures.length) line.push('  配图: ' + [...new Set(figures)].map((s) => s + ' [' + xmlOk(join(ROOT, 'assets', s)) + ']').join(', '))
  else line.push('  配图: 无')
  if (problems.length === 0) line.push('  ✓ 没问题')
  else { line.push('  ✗ 问题 ' + problems.length + ' 条：'); for (const x of problems.slice(0, 12)) line.push('     - ' + x); process.exitCode = 1 }
  console.log(line.join('\n'))
}
