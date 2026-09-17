/**
 * 芯片封装学习 · 常驻版插件 —— Client 半（界面）
 * ---------------------------------------------------------------------------
 * 这是 dsh 的 web 客户端插件包形态（和 dsh-better-sidebar 同一套机制）：
 * 用 window.__ModuleLoader__.load 注册模块，导出一个带 apply(ctx) 的插件对象。
 *
 * 与阶段一动态版的差别只有三处「管道」：
 *   1. React 通过 require("react") 拿，不是全局注入
 *   2. host.call(m, a)  →  rpc(m, a)：改成 fetch 主机半注册的 /package-learn/api
 *   3. styles.insert(css) → insertStyles(css)：自己往 <head> 插 <style>
 * 界面代码本身与阶段一完全一致。
 */

window.__ModuleLoader__.load({
  id: 'dsh-package-learn',
  factory: (require) => {
    const React = require('react')

    const h = React.createElement

    // 发送后自动跳转用：记住上一次看到的最后一条用户消息，用于判断「刚发送了」。
    let lastSeenUserKey = null

    // ------------------------------------------------------------ 主机通信
    const API = '/package-learn/api'

    async function rpc(method, args) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args: args || {} }),
      })
      const data = await res.json()
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'rpc failed: ' + method)
      return data.value
    }

    function insertStyles(css) {
      const el = document.createElement('style')
      el.setAttribute('data-package-learn', '1')
      el.textContent = css
      document.head.appendChild(el)
      return () => {
        try {
          el.remove()
        } catch (error) {
          /* already detached */
        }
      }
    }

    const CSS = [
      '.pkl-entry{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;text-align:left}',
      '.pkl-entry:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.pkl-entry-rail{justify-content:center;padding:6px 0}',
      '.pkl-entry-icon{font-size:15px;line-height:1}',
      '.pkl-hint{display:flex;align-items:center;gap:9px;padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.pkl-hint-go{margin-left:auto;color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.pkl-view{display:block;font-size:14px;color:var(--dsw-alias-label-primary)}',
      '.pkl-learn{padding:0 0 214px}',
      '.pkl-bar{position:sticky;top:0;z-index:3;padding:10px 16px 0;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      '.pkl-tracks{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}',
      '.pkl-track{font:inherit;font-size:12px;padding:3px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.pkl-track:hover{border-color:var(--dsw-alias-border-l2)}',
      '.pkl-track-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.pkl-procs{display:flex;gap:6px;overflow-x:auto;padding-bottom:10px}',
      '.pkl-proc{white-space:nowrap;font:inherit;font-size:13px;padding:5px 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.pkl-proc:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.pkl-proc-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.pkl-proc-on:hover{color:#fff}',
      '.pkl-proc-planned{opacity:.42;cursor:default}',
      '.pkl-body{display:flex;align-items:flex-start}',
      '.pkl-tree{position:sticky;top:104px;flex:0 0 236px;width:236px;max-height:calc(100vh - 340px);overflow-y:auto;border-right:1px solid var(--dsw-alias-border-l1);padding:12px 9px 24px}',
      '.pkl-tree-node{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;text-align:left}',
      '.pkl-tree-node:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.pkl-tree-track{font-weight:600;color:var(--dsw-alias-label-primary);margin-top:6px}',
      '.pkl-tree-proc{padding-left:14px}',
      '.pkl-tree-point{padding-left:26px}',
      '.pkl-tree-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.pkl-count{margin-left:auto;font-size:11px;opacity:.7}',
      '.pkl-dot{flex:0 0 auto;width:15px;text-align:center;font-size:11px;line-height:1}',
      '.pkl-dot-mastered{color:var(--dsw-alias-state-success-primary)}',
      '.pkl-dot-learning{color:var(--dsw-alias-state-warn-primary)}',
      '.pkl-dot-unseen{color:var(--dsw-alias-label-secondary);opacity:.5}',
      '.pkl-planned-tag{margin-left:auto;font-size:10px;opacity:.6;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px}',
      '.pkl-main{flex:1;min-width:0;padding:18px 30px 20px}',
      '.pkl-title{font-size:20px;font-weight:650;line-height:1.4;margin:0 0 6px}',
      '.pkl-sub{font-size:13px;color:var(--dsw-alias-label-secondary);margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.pkl-pill{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 9px;font-size:12px}',
      '.pkl-btn{font:inherit;font-size:12px;padding:3px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.pkl-btn:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.pkl-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.pkl-btn-primary:hover{color:#fff}',
      '.pkl-h{font-size:16px;font-weight:620;margin:24px 0 10px}',
      '.pkl-p{margin:0 0 13px;font-size:14px;line-height:1.85}',
      '.pkl-ul{margin:0 0 15px;padding-left:22px;font-size:14px;line-height:1.85}',
      '.pkl-ul li{margin-bottom:6px}',
      '.pkl-callout{border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-base);border-radius:0 8px 8px 0;padding:12px 15px;margin:0 0 17px;font-size:13.5px;line-height:1.8}',
      '.pkl-callout-warn{border-left-color:var(--dsw-alias-state-warn-primary)}',
      '.pkl-tablewrap{overflow-x:auto;margin:0 0 19px}',
      '.pkl-table{border-collapse:collapse;width:100%;font-size:13px}',
      '.pkl-table th,.pkl-table td{border:1px solid var(--dsw-alias-border-l1);padding:8px 11px;text-align:left;vertical-align:top}',
      '.pkl-table th{background:var(--dsw-alias-bg-layer-2);font-weight:600;white-space:nowrap}',
      '.pkl-figure{margin:0 0 19px}',
      '.pkl-svg{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px}',
      '.pkl-svg svg{display:block;width:100%;height:auto}',
      '.pkl-svg-missing{padding:18px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.pkl-figcaption{margin-top:7px;font-size:12.5px;color:var(--dsw-alias-label-secondary);text-align:center}',
      '.pkl-quiz{margin-top:28px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:18px}',
      '.pkl-quiz-title{font-size:15px;font-weight:620;margin-bottom:15px}',
      '.pkl-q{margin-bottom:20px}',
      '.pkl-q-text{font-weight:560;margin-bottom:8px}',
      '.pkl-opts{display:flex;flex-direction:column;gap:6px}',
      '.pkl-opt{font:inherit;font-size:13.5px;text-align:left;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.pkl-opt:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}',
      '.pkl-opt:disabled{cursor:default}',
      '.pkl-opt-right{border-color:var(--dsw-alias-state-success-primary)}',
      '.pkl-opt-wrong{border-color:var(--dsw-alias-state-error-primary)}',
      '.pkl-explain{margin-top:9px;font-size:13px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:11px;line-height:1.75}',
      '.pkl-nav{display:flex;justify-content:space-between;gap:10px;margin-top:24px}',
      '.pkl-askbar{margin-top:26px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-wrap:wrap;gap:7px;align-items:center}',
      '.pkl-askbar-label{font-size:13px;font-weight:620;margin-right:3px}',
      '.pkl-askbar-hint{width:100%;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:3px}',
      '.pkl-chip{font:inherit;font-size:12.5px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.pkl-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.pkl-warn{margin:0 0 14px;padding:10px 14px;border-radius:8px;font-size:13px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
      '.pkl-wait{padding:16px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
    ].join('\n')

    function statusSymbol(status) {
      if (status === 'mastered') return { text: '✓', cls: 'pkl-dot-mastered' }
      if (status === 'learning') return { text: '◐', cls: 'pkl-dot-learning' }
      return { text: '○', cls: 'pkl-dot-unseen' }
    }

    /**
     * 监听会话消息：一发现新的「我」发出的消息，就通知外层切到原生对话界面。
     * 做成独立子组件是为了把 useChat 这两个 Hook 隔离在自己的实例里，
     * 否则父组件在早期返回前后 Hook 数量会不一致（React error #310）。
     */
    function SendWatcher(props) {
      const order = props.useChat((s) => (s && s.order) || null)
      const nodes = props.useChat((s) => (s && s.nodes) || null)

      React.useEffect(() => {
        lastSeenUserKey = null
      }, [])

      React.useEffect(() => {
        if (!Array.isArray(order) || nodes === null || typeof nodes.get !== 'function') return
        let lastUserKey = null
        for (let i = order.length - 1; i >= 0; i -= 1) {
          let node = null
          try {
            node = nodes.get(order[i])
          } catch (error) {
            node = null
          }
          if (node && node.kind === 'user') {
            lastUserKey = String(order[i])
            break
          }
        }
        if (lastUserKey === null) return
        if (lastSeenUserKey === null) {
          lastSeenUserKey = lastUserKey
          return
        }
        if (lastUserKey !== lastSeenUserKey) {
          lastSeenUserKey = lastUserKey
          try {
            props.onSend()
          } catch (error) {
            console.error('package-learn: switch after send failed :: ' + String((error && error.message) || error))
          }
        }
      }, [order, nodes])

      return null
    }

    /** 左侧栏最下方的常驻入口。 */
    function EntryButton(props) {
      const [busy, setBusy] = React.useState(false)
      const onClick = () => {
        if (busy) return
        setBusy(true)
        // 关键：懒解析。
        // 正式插件是在 dsh 启动过程中 apply 的，那一刻 sessions / uiWorkspace
        // 这些客户端服务还没注册。必须到「点击这一刻」重新取，否则永远是 undefined，
        // 入口就会静默什么都不做。
        const lookup = (name) => {
          try {
            const c = props.ctx
            return c && typeof c.get === 'function' ? c.get(name) : undefined
          } catch (error) {
            return undefined
          }
        }
        const sess = lookup('sessions')
        const ui = lookup('uiWorkspace')
        if (sess === undefined) console.error('package-learn: client service sessions unavailable at click time')
        if (ui === undefined) console.error('package-learn: client service uiWorkspace unavailable at click time')
        rpc('get-session', {}).then((saved) => {
          const sid = saved && saved.ok ? saved.sessionId : ''
          if (sid !== '' && sess !== undefined) {
            try {
              sess.open(sid)
              return 'opened'
            } catch (error) {
              console.error('package-learn: sessions.open failed :: ' + String((error && error.message) || error))
              return null
            }
          }
          return null
        }).then((result) => {
          if (result === 'opened') return null
          if (ui === undefined) return null
          return rpc('ensure-workspace', {}).then((res) => {
            const wsId = res && res.ok ? res.workspaceId : ''
            if (wsId) {
              return ui.connectWorkspace(wsId).then((id) => {
                if (id) {
                  rpc('save-session', { sessionId: String(id) }).catch(() => {})
                  if (sess !== undefined) sess.open(id)
                  else ui.startSession(wsId)
                }
                return null
              }).catch(() => {
                ui.startSession(wsId)
                return null
              })
            }
            ui.startSession()
            return null
          })
        }).catch((error) => {
          console.error('package-learn: enter failed :: ' + String((error && error.message) || error))
        }).then(() => { setBusy(false) })
      }
      const kids = [h('span', { className: 'pkl-entry-icon', key: 'i' }, '📚')]
      if (props.wide) kids.push(h('span', { className: 'pkl-entry-label', key: 'l' }, busy ? '正在打开…' : '芯片封装学习'))
      return h('button', {
        type: 'button',
        className: 'pkl-entry' + (props.wide ? '' : ' pkl-entry-rail'),
        title: '芯片封装学习',
        onClick,
        disabled: busy,
      }, kids)
    }

    /** 学习会话里的一条提示，进过一次学习界面后自动隐藏。 */
    function LearnHint(props) {
      const [state, setState] = React.useState({ matched: false, visited: true })
      React.useEffect(() => {
        let alive = true
        rpc('gate', {}).then((gate) => {
          if (!alive || !gate) return
          const saved = gate.sessionId ? String(gate.sessionId) : ''
          const sid = props.sessionId === undefined ? '' : String(props.sessionId)
          setState({ matched: saved !== '' && sid === saved, visited: gate.visited === true })
        }).catch(() => {})
        return () => { alive = false }
      }, [props.sessionId])
      if (!state.matched || state.visited) return null
      return h('div', { className: 'pkl-hint' }, [
        h('span', { key: 'i' }, '📚'),
        h('span', { key: 't' }, '学习界面在上方标签栏里'),
        h('span', { className: 'pkl-hint-go', key: 'g' }, '点「📚 进入学习界面」 ↑'),
      ])
    }

    /** 渲染 body 里的一个内容块（p / h / list / callout / table / figure）。 */
    function Block(props) {
      const block = props.block
      if (!block || typeof block !== 'object') return null
      if (block.type === 'p') return h('p', { className: 'pkl-p' }, block.text)
      if (block.type === 'h') return h('h3', { className: 'pkl-h' }, block.text)
      if (block.type === 'list') {
        const items = Array.isArray(block.items) ? block.items : []
        return h('ul', { className: 'pkl-ul' }, items.map((item, i) => h('li', { key: i }, item)))
      }
      if (block.type === 'callout') {
        return h('div', { className: 'pkl-callout' + (block.tone === 'warn' ? ' pkl-callout-warn' : '') }, block.text)
      }
      if (block.type === 'table') {
        const head = Array.isArray(block.head) ? block.head : []
        const rows = Array.isArray(block.rows) ? block.rows : []
        return h('div', { className: 'pkl-tablewrap' }, h('table', { className: 'pkl-table' }, [
          h('thead', { key: 'h' }, h('tr', null, head.map((cell, i) => h('th', { key: i }, cell)))),
          h('tbody', { key: 'b' }, rows.map((row, ri) => h('tr', { key: ri }, (Array.isArray(row) ? row : []).map((cell, ci) => h('td', { key: ci }, cell))))),
        ]))
      }
      if (block.type === 'figure') {
        const svg = props.svgOf(block.svg)
        const kids = []
        if (svg) kids.push(h('div', { className: 'pkl-svg', key: 's', dangerouslySetInnerHTML: { __html: svg } }))
        else kids.push(h('div', { className: 'pkl-svg-missing', key: 's' }, '图未找到：' + String(block.svg)))
        if (block.caption) kids.push(h('figcaption', { className: 'pkl-figcaption', key: 'c' }, block.caption))
        return h('figure', { className: 'pkl-figure' }, kids)
      }
      return null
    }

    /** 学习界面本体。 */
    function LearnView(props) {
      const [data, setData] = React.useState(null)
      const [allowed, setAllowed] = React.useState(false)
      const [checked, setChecked] = React.useState(false)
      const [failure, setFailure] = React.useState('')
      const [trackId, setTrackId] = React.useState('')
      const [processId, setProcessId] = React.useState('')
      const [pointId, setPointId] = React.useState('')
      const [marked, setMarked] = React.useState({})
      const [collapsedTracks, setCollapsedTracks] = React.useState({})
      const [answers, setAnswers] = React.useState({})

      const sid = props.sessionId === undefined ? '' : String(props.sessionId)

      React.useEffect(() => {
        let alive = true
        rpc('gate', {}).then((gate) => {
          if (!alive) return null
          setChecked(true)
          const saved = gate && gate.sessionId ? String(gate.sessionId) : ''
          const hit = saved !== '' && sid === saved
          setAllowed(hit)
          if (!hit) return null
          rpc('mark-visited', {}).catch(() => {})
          return rpc('load', {})
        }).then((value) => {
          if (!alive || !value) return
          setData(value)
          setMarked((value && value.points) || {})
          const tracks = (value && value.tracks) || []
          const first = tracks[0]
          if (!first) return
          setTrackId(first.id)
          const procs = Array.isArray(first.processes) ? first.processes : []
          const ready = procs.find((p) => p && p.status === 'ready')
          if (!ready) return
          setProcessId(ready.id)
          const course = (value.courses || {})[ready.id]
          const pts = (course && course.points) || []
          if (pts[0]) setPointId(pts[0].id)
        }).catch((error) => {
          if (alive) setFailure(String((error && error.message) || error))
        })
        return () => { alive = false }
      }, [sid])

      // 打开一个细分点就自动标成「在学」
      React.useEffect(() => {
        if (!allowed || !pointId) return
        const entry = marked[pointId]
        const cur = entry && entry.status
        if (cur === 'learning' || cur === 'mastered') return
        setMarked((prev) => Object.assign({}, prev, { [pointId]: { status: 'learning', updatedAt: new Date().toISOString() } }))
        rpc('set-status', { id: pointId, status: 'learning' }).catch(() => {})
      }, [allowed, pointId])

      if (!checked) return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-wait' }, '正在读取课程…'))
      if (!allowed) {
        return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-warn' }, '这里是「芯片封装学习」专用界面。请点左侧边栏最下方的 📚 芯片封装学习 进入学习会话。'))
      }
      if (failure !== '') return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-warn' }, '读取课程数据失败：' + failure))
      if (data === null) return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-wait' }, '正在读取课程…'))

      const statusOf = (id) => {
        const entry = marked[id]
        return (entry && entry.status) || 'unseen'
      }

      const mark = (id, next) => {
        if (!id) return
        setMarked((prev) => Object.assign({}, prev, { [id]: { status: next, updatedAt: new Date().toISOString() } }))
        rpc('set-status', { id, status: next }).catch(() => {})
      }

      const tracks = data.tracks || []
      const track = tracks.find((t) => t.id === trackId) || tracks[0] || null
      const processes = (track && track.processes) || []
      const course = (processId && (data.courses || {})[processId]) || null
      const points = (course && course.points) || []
      const point = points.find((p) => p.id === pointId) || points[0] || null
      const svgs = data.svgs || {}
      const svgOf = (name) => svgs[name] || ''

      const processStat = (proc) => {
        const c = (data.courses || {})[proc.id]
        const pts = (c && c.points) || []
        let done = 0
        for (const p of pts) if (statusOf(p.id) === 'mastered') done += 1
        return { done, total: pts.length }
      }

      const selectProcess = (proc) => {
        if (!proc || proc.status !== 'ready') return
        setProcessId(proc.id)
        const c = (data.courses || {})[proc.id]
        const pts = (c && c.points) || []
        if (pts[0]) setPointId(pts[0].id)
      }

      const askSend = (text) => {
        const actions = props.inputActions
        if (!actions) return
        if (typeof actions.setDraft === 'function') actions.setDraft(text)
        if (typeof actions.submit === 'function') props.defer(() => { actions.submit() }, 80)
      }

      const onAnswer = (pid, qi, picked, correctIndex) => {
        const key = pid + ':' + qi
        if (answers[key] !== undefined) return
        const next = Object.assign({}, answers, { [key]: picked })
        setAnswers(next)
        const correct = picked === correctIndex
        rpc('record-quiz', {
          pointId: pid,
          index: qi,
          correct,
          attempt: { pointId: pid, index: qi, picked, correct, at: new Date().toISOString() },
        }).catch(() => {})
        if (point && Array.isArray(point.quiz) && point.quiz.length > 0) {
          let all = true
          for (let i = 0; i < point.quiz.length; i += 1) {
            if (next[pid + ':' + i] !== point.quiz[i].answer) { all = false; break }
          }
          if (all) mark(pid, 'mastered')
        }
      }

      // ------------------------------------------------------- 左侧知识树
      const treeRows = []
      for (const t of tracks) {
        const isOpen = collapsedTracks[t.id] !== true
        treeRows.push(h('button', {
          type: 'button',
          key: 'track-' + t.id,
          className: 'pkl-tree-node pkl-tree-track',
          onClick: () => setCollapsedTracks((prev) => Object.assign({}, prev, { [t.id]: isOpen })),
        }, [h('span', { key: 'a' }, isOpen ? '▾' : '▸'), h('span', { key: 'b' }, t.title)]))
        if (!isOpen) continue
        const tProcs = Array.isArray(t.processes) ? t.processes : []
        for (const proc of tProcs) {
          const stat = processStat(proc)
          const kids = [h('span', { key: 'n', style: { flex: '1 1 auto' } }, proc.title)]
          if (proc.status === 'ready' && stat.total > 0) kids.push(h('span', { className: 'pkl-count', key: 'c' }, stat.done + '/' + stat.total))
          else kids.push(h('span', { className: 'pkl-planned-tag', key: 'c' }, '待补'))
          treeRows.push(h('button', {
            type: 'button',
            key: 'proc-' + proc.id,
            className: 'pkl-tree-node pkl-tree-proc' + (proc.id === processId ? ' pkl-tree-on' : ''),
            onClick: () => selectProcess(proc),
          }, kids))
          if (proc.id !== processId || proc.status !== 'ready') continue
          const c = (data.courses || {})[proc.id]
          const pts = (c && c.points) || []
          for (const p of pts) {
            const sym = statusSymbol(statusOf(p.id))
            treeRows.push(h('button', {
              type: 'button',
              key: 'pt-' + p.id,
              className: 'pkl-tree-node pkl-tree-point' + (p.id === pointId ? ' pkl-tree-on' : ''),
              onClick: () => setPointId(p.id),
            }, [
              h('span', { className: 'pkl-dot ' + sym.cls, key: 'd' }, sym.text),
              h('span', { key: 't', style: { flex: '1 1 auto' } }, p.title),
            ]))
          }
        }
      }

      // ------------------------------------------------------- 右侧正文
      const mainKids = []
      if (point === null) {
        mainKids.push(h('div', { className: 'pkl-warn', key: 'empty' }, '这道工序的内容还没写。'))
      } else {
        const st = statusOf(point.id)
        mainKids.push(h('div', { key: 'head' }, [
          h('h2', { className: 'pkl-title', key: 't' }, point.title),
          h('div', { className: 'pkl-sub', key: 's' }, [
            h('span', { className: 'pkl-pill', key: 'a' }, '约 ' + String(point.estMinutes || 8) + ' 分钟'),
            h('span', { className: 'pkl-pill', key: 'b' }, st === 'mastered' ? '已掌握' : st === 'learning' ? '在学' : '未学'),
            st !== 'mastered' ? h('button', { className: 'pkl-btn pkl-btn-primary', key: 'm', onClick: () => mark(point.id, 'mastered') }, '标记为已掌握') : null,
            st === 'mastered' ? h('button', { className: 'pkl-btn', key: 'u', onClick: () => mark(point.id, 'learning') }, '退回在学') : null,
          ]),
        ]))
        const body = Array.isArray(point.body) ? point.body : []
        mainKids.push(h('div', { key: 'body' }, body.map((block, i) => h(Block, { key: i, block, svgOf }))))

        const quiz = Array.isArray(point.quiz) ? point.quiz : []
        if (quiz.length > 0) {
          mainKids.push(h('div', { className: 'pkl-quiz', key: 'quiz' }, [
            h('div', { className: 'pkl-quiz-title', key: 'h' }, '小测 · ' + String(quiz.length) + ' 题（全对自动标记已掌握）'),
            h('div', { key: 'q' }, quiz.map((q, qi) => {
              const key = point.id + ':' + qi
              const picked = answers[key]
              const opts = (Array.isArray(q.options) ? q.options : []).map((opt, oi) => {
                let cls = 'pkl-opt'
                if (picked !== undefined) {
                  if (oi === q.answer) cls += ' pkl-opt-right'
                  else if (oi === picked) cls += ' pkl-opt-wrong'
                }
                return h('button', {
                  type: 'button',
                  key: oi,
                  className: cls,
                  disabled: picked !== undefined,
                  onClick: () => onAnswer(point.id, qi, oi, q.answer),
                }, String.fromCharCode(65 + oi) + '. ' + String(opt))
              })
              const explain = picked === undefined ? null : h('div', { className: 'pkl-explain', key: 'e' },
                (picked === q.answer ? '✓ 正确。' : '✗ 不对，正确答案是 ' + String.fromCharCode(65 + q.answer) + '。') + String(q.explain || ''))
              return h('div', { className: 'pkl-q', key: qi }, [
                h('div', { className: 'pkl-q-text', key: 'q' }, String(qi + 1) + '. ' + String(q.q)),
                h('div', { className: 'pkl-opts', key: 'o' }, opts),
                explain,
              ])
            })),
          ]))
        }

        const idx = points.indexOf(point)
        const prev = idx > 0 ? points[idx - 1] : null
        const next = idx >= 0 && idx < points.length - 1 ? points[idx + 1] : null
        mainKids.push(h('div', { className: 'pkl-nav', key: 'nav' }, [
          prev ? h('button', { className: 'pkl-btn', key: 'p', onClick: () => setPointId(prev.id) }, '← ' + prev.title) : h('span', { key: 'p' }),
          next ? h('button', { className: 'pkl-btn', key: 'n', onClick: () => setPointId(next.id) }, next.title + ' →') : h('span', { key: 'n' }),
        ]))

        const chips = [
          '用更通俗的话再讲一遍，打个比方',
          '举个实际生产中的例子',
          '这个点和上下步工序是什么关系？',
          '面试或考试里这个点一般怎么问？',
        ]
        mainKids.push(h('div', { className: 'pkl-askbar', key: 'ask' }, [
          h('span', { className: 'pkl-askbar-label', key: 'l' }, '问 AI：'),
          h('div', { className: 'pkl-chips-inline', key: 'c', style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } }, chips.map((chip, i) => h('button', {
            type: 'button',
            className: 'pkl-chip',
            key: i,
            onClick: () => askSend('我在学「引线键合」的「' + point.title + '」。' + chip),
          }, chip))),
          h('div', { className: 'pkl-askbar-hint', key: 'h' }, '也可以直接在下面输入框里问，回车发送后会自动跳到「对话」界面看答案。'),
        ]))
      }

      return h('div', { className: 'pkl-view' }, [
        h('div', { className: 'pkl-learn', key: 'learn' }, [
          h('div', { className: 'pkl-bar', key: 'bar' }, [
            h('div', { className: 'pkl-tracks', key: 'tr' }, tracks.map((t) => h('button', {
              type: 'button',
              key: t.id,
              className: 'pkl-track' + (t.id === trackId ? ' pkl-track-on' : ''),
              title: t.hint || '',
              onClick: () => {
                setTrackId(t.id)
                const procs = Array.isArray(t.processes) ? t.processes : []
                const ready = procs.find((p) => p && p.status === 'ready')
                if (ready) selectProcess(ready)
                else { setProcessId(''); setPointId('') }
              },
            }, t.title))),
            h('div', { className: 'pkl-procs', key: 'pr' }, processes.map((proc) => h('button', {
              type: 'button',
              key: proc.id,
              className: 'pkl-proc' + (proc.id === processId ? ' pkl-proc-on' : '') + (proc.status === 'ready' ? '' : ' pkl-proc-planned'),
              title: proc.status === 'ready' ? proc.title : proc.title + '（内容待补）',
              onClick: () => selectProcess(proc),
            }, proc.title))),
          ]),
          h('div', { className: 'pkl-body', key: 'body' }, [
            h('div', { className: 'pkl-tree', key: 'tree' }, treeRows),
            h('div', { className: 'pkl-main', key: 'main' }, mainKids),
          ]),
        ]),
      ])
    }

    /**
     * 视图根组件：把「发送监听」和「学习界面」并排放。
     * 拆成两个组件是为了让 SendWatcher 的 useChat Hook 有自己的实例，
     * 不与 LearnView 的 Hook 序列互相影响。
     */
    function LearnRoot(props) {
      const kids = []
      if (typeof props.useChat === 'function') {
        kids.push(h(SendWatcher, {
          key: 'watch',
          useChat: props.useChat,
          onSend: props.onSend,
        }))
      }
      kids.push(h(LearnView, {
        key: 'view',
        sessionId: props.sessionId,
        inputActions: props.inputActions,
        defer: props.defer,
      }))
      return h(React.Fragment, null, kids)
    }

    // ------------------------------------------------------------------ 插件
    function apply(ctx) {
      // 用最防御的写法：拿不到 slots 就安静退出，绝不抛错。
      const slots = ctx && typeof ctx.get === 'function' ? ctx.get('slots') : undefined
      if (slots === undefined || slots === null) {
        console.error('package-learn: slots service unavailable; UI not mounted')
        return
      }

      const defer = (fn, ms) => { ctx.timeout(fn, ms) }

      ctx.effect(() => insertStyles(CSS))

      // 1. 左侧栏最下方的常驻入口
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'package-learn-entry', order: 5, label: '芯片封装学习' },
        (slotProps) => h(EntryButton, { wide: slotProps.wide === true, ctx }),
      ))

      // 2. 学习会话里的一次性提示
      slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'package-learn-hint', order: 1, label: '芯片封装学习' },
        (slotProps) => h(LearnHint, { sessionId: slotProps.sessionId }),
      ))

      // 3. 学习界面本体（顶栏标签）
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: 'package-learn', order: 50, label: '📚 进入学习界面' },
        (slotProps) => h(LearnRoot, {
          sessionId: slotProps.sessionId,
          useChat: slotProps.useChat,
          inputActions: slotProps.inputActions,
          defer,
          onSend: () => {
            if (typeof slotProps.openView === 'function') slotProps.openView('chat', '')
          },
        }),
      ))
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['timer']
    return module.exports
  },
})
