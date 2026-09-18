// 一条命令跑完全部验收：node tools/check-all.mjs
//
// 为什么是 .mjs 而不是 .ps1：
// Windows PowerShell 5.1 读 .ps1 默认按系统 ANSI 编码解码，脚本里一有中文就变乱码、
// 引号还会跟着断（我第一版就是这么挂的）。Node 读文件一律 UTF-8，没有这个坑。
//
// 子进程用 stdio:'inherit'（直通输出）而不是管道：
// 沙箱限制较严时，用管道捕获另一个程序的标准输出会被拒。
import { spawnSync } from 'node:child_process'
import { readdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLS = join(ROOT, 'tools')

const CHECKS = [
  { file: 'check-content.mjs', name: '课程内容', what: '结构 / 字段 / 小测数 / 配图' },
  { file: 'check-host.mjs', name: '主机半', what: '挂载 / 路由 / 自检 / 导出导入 / 时长' },
  { file: 'check-client.mjs', name: '客户端半', what: '接线 / CSS / 写入顺序' },
  { file: 'check-render.mjs', name: '界面渲染', what: '真渲染一遍 + 点几下' },
]

// 清掉上次可能残留的临时目录（脚本正常结束时会自己删，异常退出可能留下）
const tmp = join(ROOT, '.tmp-check')
if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })

const bar = '='.repeat(64)
const failed = []
for (const c of CHECKS) {
  console.log('')
  console.log(bar)
  console.log('  ' + c.name + '  ·  ' + c.what)
  console.log(bar)
  const r = spawnSync(process.execPath, [join(TOOLS, c.file)], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) failed.push(c.name + '（exit ' + r.status + '）')
}

console.log('')
console.log(bar)
if (failed.length === 0) {
  console.log('  全部通过 ✅')
  process.exit(0)
}
console.log('  没通过：' + failed.join(' / '))
process.exit(1)
