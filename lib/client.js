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

    // ------------------------------------------------------------------
    // 输入区占位（B2）
    //
    // dsh 的输入框是悬浮在内容之上的，而且会随「多行输入」变高。
    // 用户的要求是：**位置固定、别跟着输入框变、也别被盖住**。
    // 所以这里不去实时跟随，而是取「输入框最小高度（即空着/单行时）」当基准，
    // 再额外预留两行的高度；之后无论输入框涨到几行，正文都不动、也不会被压住。
    // ------------------------------------------------------------------
    const COMPOSER_EXTRA_PX = 72 // 约等于两行输入的高度

    const composerPad = { value: 286, min: 0, listeners: [] }

    function publishPad(raw) {
      const v = Math.max(120, Math.round(raw))
      if (composerPad.min === 0 || v < composerPad.min) composerPad.min = v
      const next = composerPad.min + COMPOSER_EXTRA_PX
      if (next === composerPad.value) return
      composerPad.value = next
      for (const fn of composerPad.listeners) {
        try {
          fn(next)
        } catch (error) {
          /* a stale subscriber must not break the measurement */
        }
      }
    }

    /** 零高度探针：放在 conversation.input.dock，量的就是「输入区一共占了多高」。 */
    function ComposerProbe(props) {
      const draft = typeof props.useInput === 'function' ? props.useInput((s) => (s && s.draft) || '') : ''
      const holder = React.useRef(null)

      React.useEffect(() => {
        const node = holder.current
        if (!node) return undefined
        const run = () => {
          try {
            publishPad(window.innerHeight - node.getBoundingClientRect().top + 16)
          } catch (error) {
            /* layout not ready yet */
          }
        }
        run()
        // 输入框变高后布局要过一帧才稳定
        const id = setTimeout(run, 80)
        window.addEventListener('resize', run)
        return () => {
          clearTimeout(id)
          window.removeEventListener('resize', run)
        }
      }, [draft])

      return h('div', {
        ref: holder,
        style: { height: 0, margin: 0, padding: 0, overflow: 'hidden', pointerEvents: 'none' },
      })
    }

    /** 输入区插槽的总入口：探针必须常驻，提示条可以按需隐藏，所以两个都放这。 */
    function LearnDock(props) {
      return h(React.Fragment, null, [
        h(ComposerProbe, { key: 'probe', useInput: props.useInput }),
        h(LearnHint, { key: 'hint', sessionId: props.sessionId }),
      ])
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
      '.pkl-opt-picked{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.pkl-submit-row{display:flex;align-items:center;gap:10px;margin-top:10px}',
      '.pkl-submit-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.pkl-toolbar{margin-left:auto;display:flex;align-items:center;gap:6px}',
      '.pkl-search{font:inherit;font-size:12.5px;width:210px;padding:4px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary)}',
      '.pkl-search:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.pkl-hit{padding:7px 9px;border-radius:8px;cursor:pointer;border:1px solid transparent}',
      '.pkl-hit:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}',
      '.pkl-hit-title{color:var(--dsw-alias-label-primary);font-weight:560}',
      '.pkl-hit-where{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px;word-break:break-word}',
      '.pkl-track-wrong{font-weight:600}',
      '.pkl-wrong{padding:22px 30px 44px;max-width:1080px}',
      '.pkl-wrong-sum{font-size:13px;color:var(--dsw-alias-label-secondary);margin-bottom:18px}',
      '.pkl-wrong-empty{padding:28px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary);font-size:14px;text-align:center}',
      '.pkl-wrong-group{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 20px;margin-bottom:16px}',
      '.pkl-wrong-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:12px;margin-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pkl-wrong-title{font-size:15px;font-weight:620;color:var(--dsw-alias-label-primary)}',
      '.pkl-wrong-meta{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.pkl-wrong-spacer{margin-left:auto}',
      '.pkl-relbar{margin:0 0 20px;padding:11px 15px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.pkl-rel-label{display:block;font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}',
      '.pkl-rel-chips{display:flex;flex-wrap:wrap;gap:7px}',
      '.pkl-rel{font:inherit;font-size:12.5px;text-align:left;padding:5px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.pkl-rel:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.pkl-explain{margin-top:9px;font-size:13px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:11px;line-height:1.75}',
      '.pkl-nav{display:flex;justify-content:space-between;gap:10px;margin-top:24px}',
      '.pkl-askbar{margin-top:26px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-wrap:wrap;gap:7px;align-items:center}',
      '.pkl-askbar-label{font-size:13px;font-weight:620;margin-right:3px}',
      '.pkl-askbar-hint{width:100%;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:3px}',
      '.pkl-chip{font:inherit;font-size:12.5px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.pkl-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.pkl-warn{margin:0 0 14px;padding:10px 14px;border-radius:8px;font-size:13px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
      '.pkl-warn-acts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}',
      '.pkl-warn-note{font-size:12px;color:var(--dsw-alias-label-secondary);opacity:.85}',
      '.pkl-warn-sub{margin-top:10px;font-size:12px;color:var(--dsw-alias-state-error-primary)}',
      '.pkl-track-review{border-color:var(--dsw-alias-brand-primary)}',
      '.pkl-due-tag{display:inline-block;margin-right:7px;padding:1px 7px;border-radius:6px;font-size:11px;vertical-align:1px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.pkl-due-hot{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.pkl-backup-ok{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.pkl-backup-link{color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:underline;word-break:break-all}',
      '.pkl-study-row{display:flex;gap:26px;flex-wrap:wrap;margin:14px 0 18px}',
      '.pkl-study-cell{min-width:86px}',
      '.pkl-study-num{font-size:19px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.pkl-study-cap{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:3px}',
      '.pkl-bars{display:flex;align-items:flex-end;gap:8px;height:74px;margin:6px 0 16px}',
      '.pkl-bar-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;min-width:34px}',
      '.pkl-bar{width:22px;min-height:2px;border-radius:4px 4px 0 0;background:var(--dsw-alias-brand-primary);opacity:.85}',
      '.pkl-bar-day{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.pkl-about-row{display:flex;gap:12px;align-items:baseline;padding:5px 0;font-size:12.5px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pkl-about-k{flex:0 0 76px;color:var(--dsw-alias-label-secondary)}',
      '.pkl-about-v{flex:1 1 auto;color:var(--dsw-alias-label-primary);word-break:break-all;user-select:text}',
      '.pkl-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.pkl-btn-danger:hover{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}',
      '.pkl-wait{padding:16px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.pkl-selfcheck{margin-left:auto}',
      '.pkl-check{padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);max-height:32vh;overflow-y:auto;font-size:12.5px;line-height:1.75}',
      '.pkl-check-head{font-weight:620;margin-bottom:7px;color:var(--dsw-alias-label-primary)}',
      '.pkl-check-line{color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.pkl-check-err{color:var(--dsw-alias-state-error-primary)}',
      '.pkl-check-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.pkl-check-ok{color:var(--dsw-alias-state-success-primary);font-weight:620}',
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

    /**
     * 进入学习会话：优先回到存下来的那一个；如果它已经失效（会话被删了），
     * 先清掉烂指针再新建一个，并把新 id 记回去。
     *
     * 入口按钮和学习界面里那个「进入学习会话」按钮共用这一份逻辑，
     * 免得两条路各写一遍、然后只有一条被修好。
     */
    function enterLearning(ctx) {
      const lookup = (name) => {
        try {
          return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined
        } catch (error) {
          return undefined
        }
      }
      // 关键：懒解析。正式插件是在 dsh 启动过程中 apply 的，那一刻 sessions /
      // uiWorkspace 这些客户端服务还没注册，必须到「点击这一刻」才取。
      const sess = lookup('sessions')
      const ui = lookup('uiWorkspace')
      if (sess === undefined) console.error('package-learn: client service sessions unavailable')
      if (ui === undefined) console.error('package-learn: client service uiWorkspace unavailable')

      const create = () => {
        if (ui === undefined) return Promise.resolve({ ok: false, how: 'no-ui' })
        return rpc('ensure-workspace', {}).then((res) => {
          const wsId = res && res.ok ? res.workspaceId : ''
          if (!wsId) {
            ui.startSession()
            return { ok: true, how: 'session-plain' }
          }
          return ui.connectWorkspace(wsId).then((id) => {
            if (id) {
              rpc('save-session', { sessionId: String(id) }).catch(() => {})
              if (sess !== undefined) sess.open(id)
              else ui.startSession(wsId)
              return { ok: true, how: 'created' }
            }
            return { ok: true, how: 'created-noid' }
          }).catch(() => {
            ui.startSession(wsId)
            return { ok: true, how: 'fallback' }
          })
        })
      }

      return rpc('get-session', {}).then((saved) => {
        const sid = saved && saved.ok ? String(saved.sessionId) : ''
        if (sid !== '' && sess !== undefined) {
          try {
            sess.open(sid)
            return { ok: true, how: 'opened' }
          } catch (error) {
            // 未知 id 会在这里抛。把指针清掉，否则每次进来都要再踩一次。
            console.error('package-learn: sessions.open failed, recreating :: ' + String((error && error.message) || error))
            rpc('forget-session', { sessionId: sid }).catch(() => {})
          }
        }
        return create()
      })
    }

    /**
     * 挂载失败的可见提示。
     * 平时走不到这里；只有 dsh 的服务名变了 / 插件加载顺序变了才会。
     * 那种情况下界面是「什么都不出现」，用户完全无从判断，所以直接把话写在页面上。
     * 这个节点挂在 <body> 上，随插件一起销毁（ctx.effect 的清理函数负责移除）。
     */
    function mountFailed(ctx, reason) {
      console.error('package-learn: ' + reason)
      try {
        if (typeof document === 'undefined' || !document.body) return
        const id = 'pkl-mount-error'
        if (document.getElementById(id)) return
        const box = document.createElement('div')
        box.id = id
        box.textContent = '📚 芯片封装学习插件没能挂载：' + reason + '（dsh 升级后服务名可能变了，可先禁用本插件）'
        box.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:2147483000;max-width:420px;padding:10px 14px;border-radius:10px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#fff);background:var(--dsw-alias-bg-layer-2,#2a2a2a);border:1px solid var(--dsw-alias-state-error-primary,#c33)')
        document.body.appendChild(box)
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            try { box.remove() } catch (error) { /* 页面已经在拆了 */ }
          })
        }
      } catch (error) {
        // 连提示都放不上就算了，绝不能因为这个把插件启动搞挂
      }
    }

    /** 左侧栏最下方的常驻入口。 */
    function EntryButton(props) {
      const [busy, setBusy] = React.useState(false)
      const onClick = () => {
        if (busy) return
        setBusy(true)
        enterLearning(props.ctx).catch((error) => {
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

    // ---------------------------------------------------------- E2 复习队列（纯函数）
    // 规则（界面上也写了同一句话，不让它变成黑箱）：
    //   1. 有没消化的错题 —— 不管隔了多久，直接进队列（错题就是「没学会」的硬证据）
    //   2. 在学且放了 LEARNING_DAYS 天还没学完 —— 催一下接着学
    //   3. 已掌握 —— 按间隔阶梯 1 / 3 / 7 / 16 / 35 天，每复习一次进下一档
    // 未学的点不进队列：还没学，谈不上复习。
    //
    // 为什么「在学」的门槛是 3 天而不是 1 天：
    // 打开一个知识点就会自动标成「在学」，所以「在学」本身只代表「我点开过」，
    // 不代表「我在复习它」。门槛设成 1 天的话，随便翻一翻就是几十条，
    // 队列立刻变成噪音墙 —— 实测本机数据就是 30 个点全在「在学」。
    //
    // 抽成纯函数（不碰 React、不自己取当前时间）有两个好处：
    // 验收脚本能拿固定时间真的算一遍数字；以后要改规则也只改这一处。
    const REVIEW_STEPS = [1, 3, 7, 16, 35]
    const LEARNING_DAYS = 3
    // 一次最多列这么多条：清掉之后剩下的会自动顶上来（不隐藏，只是分批）
    const REVIEW_PAGE = 25
    const DAY_MS = 86400000

    /** 距今天过了几天；时间戳不可用时返回 null（当作「不知道」，不硬猜） */
    function daysSince(iso, nowMs) {
      const t = Date.parse(iso || '')
      if (!Number.isFinite(t)) return null
      return Math.floor((nowMs - t) / DAY_MS)
    }

    /** 已掌握的点：复习过几次就走到第几档间隔 */
    function reviewInterval(entry) {
      const n = entry && Number.isInteger(entry.reviewCount) ? entry.reviewCount : 0
      return REVIEW_STEPS[Math.min(Math.max(n, 0), REVIEW_STEPS.length - 1)]
    }

    function reviewQueue(pointIndex, marked, wrongMap, nowMs) {
      const marks = marked || {}
      const wrongs = wrongMap || {}
      const out = []
      for (const pid of Object.keys(pointIndex)) {
        const e = pointIndex[pid]
        const entry = marks[pid] || {}
        const status = entry.status || 'unseen'
        if (status === 'unseen') continue
        const wrongCount = Array.isArray(wrongs[pid]) ? wrongs[pid].length : 0
        // 基准时间：复习过就看复习时间，否则看状态变更时间
        const gap = daysSince(entry.reviewedAt || entry.updatedAt, nowMs)
        const item = { pointId: pid, processId: e.processId, procTitle: e.procTitle, title: e.point.title, overdue: 0, rank: 2, reason: '' }
        if (wrongCount > 0) {
          item.rank = 0
          item.reason = '错题还没消化（' + wrongCount + ' 道）'
        } else if (status === 'learning') {
          if (gap === null || gap < LEARNING_DAYS) continue
          item.rank = 1
          item.overdue = gap - LEARNING_DAYS
          item.reason = '还在学，放了 ' + gap + ' 天还没学完'
        } else {
          const interval = reviewInterval(entry)
          if (gap === null || gap < interval) continue
          item.overdue = gap - interval
          item.reason = '已掌握，上次看是 ' + (gap === 0 ? '今天' : gap + ' 天前') + '，这一档间隔 ' + interval + ' 天'
          if (Number.isInteger(entry.reviewCount) && entry.reviewCount > 0) {
            item.reason += '（已复习 ' + entry.reviewCount + ' 次）'
          }
        }
        out.push(item)
      }
      // 该先看谁：错题未消 > 还在学 > 已掌握到期；同一档里拖得越久越靠前
      out.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank
        if (a.overdue !== b.overdue) return b.overdue - a.overdue
        return a.pointId < b.pointId ? -1 : (a.pointId > b.pointId ? 1 : 0)
      })
      return out
    }

    // -------------------------------------------------------- E3 学习时长（纯函数）
    // 只统计「学习界面在前台、而且你还动手了」的那段时间。
    // 明确不统计：标签页切到后台、窗口最小化、以及超过 IDLE_MS 一点操作都没有的空转。
    // 宁可少算，也不要把「窗口挂了一夜」算成学习时长 —— 那种数字只会骗自己。
    const IDLE_MS = 5 * 60 * 1000
    const TICK_MS = 60 * 1000
    const MIN_TICK_SECONDS = 5
    const MAX_TICK_SECONDS = 300

    /** 本地日期键 YYYY-MM-DD。用 UTC 会在北京时间凌晨把昨天算成今天 */
    function localDateKey(ms) {
      const d = new Date(ms)
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }

    /** 把 time.json 算成界面要的几个数（纯函数，验收脚本拿固定时间算一遍） */
    function studySummary(time, nowMs) {
      const t = time || {}
      const days = (t.days && typeof t.days === 'object') ? t.days : {}
      const pointTimes = (t.points && typeof t.points === 'object') ? t.points : {}
      const secs = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
      const today = localDateKey(nowMs)
      const todaySeconds = secs(days[today])
      let week = 0
      for (let i = 0; i < 7; i += 1) week += secs(days[localDateKey(nowMs - i * 86400000)])
      // 连续天数：从今天往回数，某天不足 1 分钟就断。今天还没学不算断，从昨天起算。
      let streak = 0
      let i = todaySeconds < 60 ? 1 : 0
      for (; i < 400; i += 1) {
        if (secs(days[localDateKey(nowMs - i * 86400000)]) < 60) break
        streak += 1
      }
      const topPoints = Object.keys(pointTimes)
        .map((id) => ({ id, seconds: secs(pointTimes[id]) }))
        .filter((it) => it.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 5)
      // 最近 7 天画柱状图用
      const bars = []
      for (let k = 6; k >= 0; k -= 1) {
        const ms = nowMs - k * 86400000
        bars.push({ key: localDateKey(ms), seconds: secs(days[localDateKey(ms)]) })
      }
      return {
        todaySeconds,
        weekSeconds: week,
        totalSeconds: secs(t.totalSeconds),
        streakDays: streak,
        topPoints,
        bars,
        activeDays: Object.keys(days).filter((k) => secs(days[k]) >= 60).length,
      }
    }

    /** 秒数说成人话 */
    function humanTime(seconds) {
      const s = Math.max(0, Math.round(seconds || 0))
      if (s < 60) return s + ' 秒'
      const m = Math.floor(s / 60)
      if (m < 60) return m + ' 分钟'
      const h = Math.floor(m / 60)
      const rm = m % 60
      return rm === 0 ? h + ' 小时' : h + ' 小时 ' + rm + ' 分钟'
    }

    /**
     * E3 学习计时器：挂在学习界面上，只在界面确实显示着的时候计时。
     * 它 return null，纯粹是个副作用组件（和 SendWatcher 同一套写法，互不干扰 Hook 序列）。
     */
    function StudyTimer(props) {
      const pointRef = React.useRef('')
      pointRef.current = props.pointId || ''
      React.useEffect(() => {
        let last = Date.now()
        let lastActive = Date.now()
        const touch = () => { lastActive = Date.now() }
        const hidden = () => {
          try {
            return typeof document !== 'undefined' && document.visibilityState === 'hidden'
          } catch (error) {
            return false
          }
        }
        // force=true 用于「马上要离开了」的场合：把最后这一小段也记上。
        // 每次都先推进 last，所以后台那段时间会被一次一次心跳自然吃掉，不会补算。
        const flush = (force) => {
          const now = Date.now()
          const elapsed = Math.round((now - last) / 1000)
          last = now
          if (!force && hidden()) return
          if (elapsed < MIN_TICK_SECONDS) return
          if (now - lastActive > IDLE_MS) return
          rpc('record-time', {
            seconds: Math.min(elapsed, MAX_TICK_SECONDS),
            pointId: pointRef.current,
          }).catch(() => {})
        }
        const onVisibility = () => {
          flush(true)
          last = Date.now()
          lastActive = Date.now()
        }
        try {
          document.addEventListener('mousemove', touch, { passive: true })
          document.addEventListener('keydown', touch, { passive: true })
          document.addEventListener('wheel', touch, { passive: true })
          document.addEventListener('visibilitychange', onVisibility)
        } catch (error) {
          // 环境不支持就算了，最多是统计不准，不该影响学习界面
        }
        const timer = setInterval(() => flush(false), TICK_MS)
        return () => {
          clearInterval(timer)
          flush(true)
          try {
            document.removeEventListener('mousemove', touch)
            document.removeEventListener('keydown', touch)
            document.removeEventListener('wheel', touch)
            document.removeEventListener('visibilitychange', onVisibility)
          } catch (error) {
            // 同上
          }
        }
      }, [props.pointId])
      return null
    }

    /** 学习界面本体。 */
    function LearnView(props) {      const [data, setData] = React.useState(null)
      const [allowed, setAllowed] = React.useState(false)
      const [checked, setChecked] = React.useState(false)
      const [failure, setFailure] = React.useState('')
      // C2：读盘失败后的重试计数。每加一次，下面那个 gate/load 的 effect 就重跑一遍。
      const [attempt, setAttempt] = React.useState(0)
      // C3：在「这不是学习会话」那个死胡同里，直接从这里把会话建出来
      const [entering, setEntering] = React.useState(false)
      // E1：导出信息（null=还没导出 / 'loading' / {url,name,size,points} / {error}）与导入结果
      const [backup, setBackup] = React.useState(null)
      const [importMsg, setImportMsg] = React.useState('')
      // E4：课程导出成 Markdown 的结果
      const [courseExport, setCourseExport] = React.useState(null)
      const [trackId, setTrackId] = React.useState('')
      const [processId, setProcessId] = React.useState('')
      const [pointId, setPointId] = React.useState('')
      const [marked, setMarked] = React.useState({})
      const [collapsedTracks, setCollapsedTracks] = React.useState({})
      const [answers, setAnswers] = React.useState({})
      // 哪些题已经「提交批改」过。提交前只记录选择、可随便改；提交后才判分并锁定。
      const [graded, setGraded] = React.useState({})
      // 顶栏工具区：null | 'check'（课程自检）| 'wrong'（错题重做）
      const [panel, setPanel] = React.useState(null)
      // B5 搜索关键词；非空时优先显示搜索结果
      const [query, setQuery] = React.useState('')
      // B4 错题本的本地位图（答对后从里面移出）。null = 还没改过，直接用服务端返回的
      const [wrongState, setWrongState] = React.useState(null)
      // 错题重做是「和三条主线并列的第四个入口」，点进去 occupy 整个中间区域，不是浮层
      const [wrongMode, setWrongMode] = React.useState(false)
      // E2：今日复习也是同一套做法 —— 并列的入口 + 独立界面
      const [reviewMode, setReviewMode] = React.useState(false)
      // 进入错题界面时拍一张快照：答对的题不从界面上消失（要能看解析），只标记「已移出」
      const [wrongSnapshot, setWrongSnapshot] = React.useState(null)
      const [check, setCheck] = React.useState(null)
      // E3：学习时长（打开统计面板时才去取，避免每次进界面都多一次请求）
      const [study, setStudy] = React.useState(null)
      // E5：设置 / 关于
      const [about, setAbout] = React.useState(null)
      const [pad, setPad] = React.useState(composerPad.value)
      // B3：顶部栏的真实高度（窗口窄时它会换行变高），知识树的吸附位置要跟着走
      const [geo, setGeo] = React.useState({ bar: 104, max: 560 })

      const sid = props.sessionId === undefined ? '' : String(props.sessionId)

      // 订阅探针量出来的输入区高度（B2）
      React.useEffect(() => {
        const fn = (v) => setPad(v)
        composerPad.listeners.push(fn)
        return () => {
          const i = composerPad.listeners.indexOf(fn)
          if (i >= 0) composerPad.listeners.splice(i, 1)
        }
      }, [])

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
      }, [sid, attempt])

      // 打开一个细分点就自动标成「在学」
      React.useEffect(() => {
        if (!allowed || !pointId) return
        const entry = marked[pointId]
        const cur = entry && entry.status
        if (cur === 'learning' || cur === 'mastered') return
        setMarked((prev) => Object.assign({}, prev, {
          [pointId]: Object.assign({}, prev[pointId] || {}, { status: 'learning', updatedAt: new Date().toISOString() }),
        }))
        rpc('set-status', { id: pointId, status: 'learning' }).catch(() => {})
      }, [allowed, pointId])

      // C2：重新读一遍课程数据（清掉错误、回到「正在读取」）
      const retry = () => {
        setFailure('')
        setChecked(false)
        setAttempt((n) => n + 1)
      }

      // C3：从死胡同里自己走出来 —— 回到原学习会话，或（会话被删了）新建一个
      const doEnter = () => {
        if (entering) return
        setEntering(true)
        enterLearning(props.ctx).catch((error) => {
          setFailure(String((error && error.message) || error))
        }).then(() => {
          setEntering(false)
          setChecked(false)
          setAttempt((n) => n + 1)
        })
      }

      if (!checked) return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-wait' }, '正在读取课程…'))
      if (!allowed) {
        return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-warn' }, [
          h('div', { key: 't' }, '这里是「芯片封装学习」专用界面。当前会话不是学习会话。'),
          h('div', { className: 'pkl-warn-acts', key: 'a' }, [
            h('button', {
              type: 'button',
              className: 'pkl-btn pkl-btn-primary',
              key: 'go',
              disabled: entering,
              onClick: doEnter,
            }, entering ? '正在打开…' : '进入学习会话'),
            h('span', { className: 'pkl-warn-note', key: 'n' }, '（等同于点左侧边栏最下方的 📚 芯片封装学习）'),
          ]),
          failure !== '' ? h('div', { className: 'pkl-warn-sub', key: 'f' }, '打开失败：' + failure) : null,
        ]))
      }
      if (failure !== '') {
        return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-warn' }, [
          h('div', { key: 't' }, '读取课程数据失败：' + failure),
          h('div', { className: 'pkl-warn-note', key: 'n' }, '（课程数据在插件的 content/ 目录里，主机半没挂上或目录被移动都会这样）'),
          h('div', { className: 'pkl-warn-acts', key: 'a' }, h('button', {
            type: 'button',
            className: 'pkl-btn pkl-btn-primary',
            key: 'r',
            onClick: retry,
          }, '重新读取')),
        ]))
      }
      if (data === null) return h('div', { className: 'pkl-view' }, h('div', { className: 'pkl-wait' }, '正在读取课程…'))

      const statusOf = (id) => {
        const entry = marked[id]
        return (entry && entry.status) || 'unseen'
      }

      const mark = (id, next) => {
        if (!id) return
        // 合并而不是覆盖：同一个条目里还存着 E2 的复习记录（reviewCount / reviewedAt），
        // 覆盖式写法会让「标记为已掌握」把复习进度悄悄抹掉。
        setMarked((prev) => Object.assign({}, prev, {
          [id]: Object.assign({}, prev[id] || {}, { status: next, updatedAt: new Date().toISOString() }),
        }))
        rpc('set-status', { id, status: next }).catch(() => {})
      }

      const tracks = data.tracks || []
      const track = tracks.find((t) => t.id === trackId) || tracks[0] || null
      const processes = (track && track.processes) || []
      // 当前工序：快捷提问要用它拼上下文，不能写死工序名
      const curProc = processes.find((p) => p.id === processId) || null
      const course = (processId && (data.courses || {})[processId]) || null
      const points = (course && course.points) || []
      const point = points.find((p) => p.id === pointId) || points[0] || null
      const svgs = data.svgs || {}
      const svgOf = (name) => svgs[name] || ''

      // A5：按知识点 id 反查它属于哪个模块（给「相关知识点」跳转用）。
      // 必须在 mainKids 构建之前定义，因为构建时就要解析出目标标题。
      const findPoint = (id) => {
        const courses = data.courses || {}
        for (const pid of Object.keys(courses)) {
          const c = courses[pid]
          const pts = Array.isArray(c && c.points) ? c.points : []
          for (const p of pts) {
            if (p.id === id) return { processId: pid, procTitle: (c && c.title) || pid, title: p.title }
          }
        }
        return null
      }

      const processStat = (proc) => {
        const c = (data.courses || {})[proc.id]
        const pts = (c && c.points) || []
        let done = 0
        for (const p of pts) if (statusOf(p.id) === 'mastered') done += 1
        return { done, total: pts.length }
      }

      // B6：整条主线的完成度（把所有已写工序的细分点掌握数加起来）
      const trackStat = (t) => {
        const procs = Array.isArray(t && t.processes) ? t.processes : []
        let done = 0
        let total = 0
        for (const proc of procs) {
          const st = processStat(proc)
          done += st.done
          total += st.total
        }
        return { done, total }
      }

      const selectProcess = (proc) => {
        if (!proc || proc.status !== 'ready') return
        setWrongMode(false)
        setWrongSnapshot(null)
        setProcessId(proc.id)
        const c = (data.courses || {})[proc.id]
        const pts = (c && c.points) || []
        if (pts[0]) setPointId(pts[0].id)
      }

      // 课程自检：再点一次收起
      const toggleSelfCheck = () => {
        if (panel === 'check') { setPanel(null); return }
        setPanel('check')
        setQuery('')
        setWrongMode(false)
        setWrongSnapshot(null)
        setReviewMode(false)
        setCheck('loading')
        rpc('selfcheck', {}).then((res) => {
          setCheck({
            issues: Array.isArray(res && res.issues) ? res.issues : [],
            trackCount: (res && res.trackCount) || 0,
            readyCount: (res && res.readyCount) || 0,
            pointCount: (res && res.pointCount) || 0,
            quizCount: (res && res.quizCount) || 0,
          })
        }).catch((error) => {
          setCheck({ error: String((error && error.message) || error) })
        })
      }

      // ---------------------------------------------- E3 学习统计
      const loadStudy = () => {
        setStudy('loading')
        rpc('time-summary', {}).then((res) => {
          setStudy({ time: (res && res.time) || null })
        }).catch((error) => {
          setStudy({ error: String((error && error.message) || error) })
        })
      }

      const toggleStudy = () => {
        if (panel === 'study') { setPanel(null); return }
        setPanel('study')
        setQuery('')
        setWrongMode(false)
        setWrongSnapshot(null)
        setReviewMode(false)
        loadStudy()
      }

      // ---------------------------------------------- E5 设置 / 关于
      const loadAbout = () => {
        setAbout('loading')
        rpc('about', {}).then((res) => {
          setAbout({ info: res || null })
        }).catch((error) => {
          setAbout({ error: String((error && error.message) || error) })
        })
      }

      const toggleAbout = () => {
        if (panel === 'about') { setPanel(null); return }
        setPanel('about')
        setQuery('')
        setWrongMode(false)
        setWrongSnapshot(null)
        setReviewMode(false)
        setImportMsg('')
        loadAbout()
      }

      /** 忘记当前学习会话（会话被删后卡住时的手动出口，对应 C3） */
      const doForgetSession = () => {
        rpc('forget-session', {}).then(() => {
          setImportMsg('✓ 已忘记学习会话。下次点左侧边栏的 📚 入口会新建一个。')
        }).catch((error) => {
          setImportMsg('操作失败：' + String((error && error.message) || error))
        })
      }

      /** 清空学习进度：不可逆，所以强制二次确认 + 服务端强制先备份 */
      const doReset = () => {
        let go = true
        try {
          go = window.confirm('确认清空学习进度？\n\n会清掉：知识点状态、错题本、作答流水、学习时长。\n清空前会自动把现有进度备份到 progress/backups/，需要时能找回。')
        } catch (error) {
          go = true
        }
        if (go !== true) {
          setImportMsg('已取消，什么都没改。')
          return
        }
        rpc('reset-progress', { confirm: 'RESET' }).then((res) => {
          if (!res || res.ok !== true) throw new Error((res && res.reason) || '重置失败')
          setMarked({})
          setWrongState({})
          setWrongSnapshot(null)
          setReviewMode(false)
          setWrongMode(false)
          setStudy(null)
          setImportMsg('✓ 已清空。你原来的进度备份在 ' + res.backupDir + '，需要的话在「备份与导出」里可以找回。')
          loadAbout()
        }).catch((error) => {
          setImportMsg('重置失败：' + String((error && error.message) || error))
        })
      }

      // ---------------------------------------------- E1 进度备份（导出 / 导入）
      // 学习记录是这台机器上的四个 JSON，硬盘坏一次就没了。这里给一条出路。
      const toggleBackup = () => {
        if (panel === 'backup') { setPanel(null); return }
        setPanel('backup')
        setQuery('')
        setWrongMode(false)
        setWrongSnapshot(null)
        setReviewMode(false)
        setBackup(null)
        setImportMsg('')
      }

      const doExport = () => {
        setBackup('loading')
        setImportMsg('')
        rpc('export-progress', {}).then((bundle) => {
          const text = JSON.stringify(bundle, null, 2)
          const name = 'package-learn-progress-' + new Date().toISOString().slice(0, 10) + '.json'
          let url = ''
          try {
            url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
          } catch (error) {
            url = ''
          }
          setBackup({
            url,
            name,
            size: text.length,
            points: Object.keys((bundle && bundle.state && bundle.state.points) || {}).length,
          })
        }).catch((error) => {
          setBackup({ error: String((error && error.message) || error) })
        })
      }

      /** 把一段文本变成可下载的 blob URL（浏览器不支持时退回空串，界面上还有右键另存为） */
      const toBlobUrl = (text, type) => {
        try {
          return URL.createObjectURL(new Blob([text], { type }))
        } catch (error) {
          return ''
        }
      }

      /** 触发下载 */
      const downloadBlob = (url, name) => {
        if (!url) return
        try {
          const a = document.createElement('a')
          a.href = url
          a.download = name
          a.click()
        } catch (error) {
          setImportMsg('浏览器没有自动保存？直接右键上面那个文件名选「另存为」。')
        }
      }

      const saveExport = () => {
        if (!backup || typeof backup !== 'object') return
        downloadBlob(backup.url, backup.name)
      }

      const saveCourse = () => {
        if (!courseExport || typeof courseExport !== 'object') return
        downloadBlob(courseExport.url, courseExport.name)
      }

      /** E4：整份课程导出成 Markdown（图内嵌，单文件可打印/离线看） */
      const doExportCourse = () => {
        setCourseExport('loading')
        setImportMsg('')
        rpc('export-markdown', {}).then((res) => {
          if (!res || res.ok !== true) throw new Error('主机半没有返回内容')
          const name = 'package-learn-course-' + new Date().toISOString().slice(0, 10) + '.md'
          setCourseExport({
            url: toBlobUrl(res.markdown, 'text/markdown;charset=utf-8'),
            name,
            size: res.markdown.length,
            stats: res.stats || {},
          })
        }).catch((error) => {
          setCourseExport({ error: String((error && error.message) || error) })
        })
      }

      const doImport = (file) => {
        setImportMsg('正在读取文件…')
        file.text().then((text) => {
          let bundle = null
          try {
            bundle = JSON.parse(text)
          } catch (error) {
            throw new Error('这个文件不是合法 JSON')
          }
          const pts = Object.keys((bundle && bundle.state && bundle.state.points) || {}).length
          let go = true
          try {
            go = window.confirm('确认用这个文件覆盖当前学习进度？\n\n文件里的知识点记录：' + pts + ' 条\n覆盖前会自动把你现在的进度备份下来。')
          } catch (error) {
            go = true
          }
          if (go !== true) {
            setImportMsg('已取消，什么都没改。')
            return null
          }
          return rpc('import-progress', { bundle }).then((res) => {
            if (!res || res.ok !== true) throw new Error((res && res.reason) || '导入失败')
            setImportMsg('✓ 导入成功：' + res.points + ' 个知识点记录 / ' + res.wrongPoints + ' 个知识点带错题 / '
              + res.attempts + ' 条作答流水。你原来的进度已备份到 ' + res.backupDir + '。')
            // 让界面重新读一遍数据（课程内容没变，但进度变了）
            setMarked({})
            setFailure('')
            setChecked(false)
            setAttempt((n) => n + 1)
          })
        }).catch((error) => {
          setImportMsg('导入失败：' + String((error && error.message) || error))
        })
      }

      const pickImportFile = () => {
        try {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.json,application/json'
          input.onchange = () => {
            const f = input.files && input.files[0]
            if (f) doImport(f)
          }
          input.click()
        } catch (error) {
          setImportMsg('打不开文件选择框：' + String((error && error.message) || error))
        }
      }

      // 进入错题重做：切到独立界面，并拍一张快照
      const enterWrong = () => {
        setWrongMode(true)
        setReviewMode(false)
        setQuery('')
        setPanel(null)
        setWrongSnapshot(wrongList())
      }

      const askSend = (text) => {
        const actions = props.inputActions
        if (!actions) return
        if (typeof actions.setDraft === 'function') actions.setDraft(text)
        if (typeof actions.submit === 'function') props.defer(() => { actions.submit() }, 80)
      }

      /** 选一个选项：只记录，不判分。提交前随便改。 */
      const pick = (pid, qi, oi) => {
        const key = pid + ':' + qi
        if (graded[key] === true) return
        setAnswers((prev) => Object.assign({}, prev, { [key]: oi }))
      }

      /** 提交本题：判分、写记录、锁定选项；若整份小测全对则自动标记已掌握。 */
      const submitAnswer = (pid, qi, q, quizAll) => {
        const key = pid + ':' + qi
        if (graded[key] === true) return
        const picked = answers[key]
        if (picked === undefined) return
        const correct = picked === q.answer
        setGraded((prev) => Object.assign({}, prev, { [key]: true }))
        rpc('record-quiz', {
          pointId: pid,
          index: qi,
          correct,
          attempt: { pointId: pid, index: qi, picked, correct, at: new Date().toISOString() },
        }).catch(() => {})
        if (Array.isArray(quizAll) && quizAll.length > 0) {
          let all = true
          for (let i = 0; i < quizAll.length; i += 1) {
            const k = pid + ':' + i
            const p = i === qi ? picked : answers[k]
            const g = i === qi ? true : graded[k] === true
            if (g !== true || p !== quizAll[i].answer) { all = false; break }
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
        }, [h('span', { key: 'a' }, isOpen ? '▾' : '▸'), h('span', { key: 'b', style: { flex: '1 1 auto' } }, t.title), h('span', { className: 'pkl-count', key: 'c' }, trackStat(t).done + '/' + trackStat(t).total)]))
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

        // A5：相关知识点——同一个概念在别的模块从别的角度也讲过，一键跳过去。
        // 刻意不做进度合并：学过键合里的紫斑，不等于学过材料学的 √(k·t)。
        const related = Array.isArray(point.related) ? point.related : []
        const relChips = []
        for (const rid of related) {
          const target = findPoint(rid)
          if (target === null) continue
          relChips.push(h('button', {
            type: 'button',
            key: rid,
            className: 'pkl-rel',
            title: target.title,
            onClick: () => jumpTo(target.processId, rid),
          }, target.procTitle + ' · ' + target.title))
        }
        if (relChips.length > 0) {
          mainKids.push(h('div', { className: 'pkl-relbar', key: 'rel' }, [
            h('span', { className: 'pkl-rel-label', key: 'l' }, '这个概念在别的模块也讲过：'),
            h('div', { className: 'pkl-rel-chips', key: 'c' }, relChips),
          ]))
        }

        const quiz = Array.isArray(point.quiz) ? point.quiz : []
        if (quiz.length > 0) {
          mainKids.push(h('div', { className: 'pkl-quiz', key: 'quiz' }, [
            h('div', { className: 'pkl-quiz-title', key: 'h' }, '小测 · ' + String(quiz.length) + ' 题（先选、可改，提交后才批改；全对自动标记已掌握）'),
            h('div', { key: 'q' }, quiz.map((q, qi) => {
              const key = point.id + ':' + qi
              const picked = answers[key]
              const done = graded[key] === true
              const opts = (Array.isArray(q.options) ? q.options : []).map((opt, oi) => {
                let cls = 'pkl-opt'
                if (done) {
                  if (oi === q.answer) cls += ' pkl-opt-right'
                  else if (oi === picked) cls += ' pkl-opt-wrong'
                } else if (oi === picked) {
                  cls += ' pkl-opt-picked'
                }
                return h('button', {
                  type: 'button',
                  key: oi,
                  className: cls,
                  disabled: done,
                  onClick: () => pick(point.id, qi, oi),
                }, String.fromCharCode(65 + oi) + '. ' + String(opt))
              })
              const footer = done
                ? h('div', { className: 'pkl-explain', key: 'e' },
                  (picked === q.answer ? '✓ 正确。' : '✗ 不对，正确答案是 ' + String.fromCharCode(65 + q.answer) + '。') + String(q.explain || ''))
                : h('div', { className: 'pkl-submit-row', key: 'e' }, [
                  h('button', {
                    type: 'button',
                    className: 'pkl-btn pkl-btn-primary',
                    key: 'b',
                    disabled: picked === undefined,
                    onClick: () => submitAnswer(point.id, qi, q, quiz),
                  }, picked === undefined ? '先选一个选项' : '提交本题'),
                  h('span', { className: 'pkl-submit-hint', key: 'h' }, '提交前可以随便改'),
                ])
              return h('div', { className: 'pkl-q', key: qi }, [
                h('div', { className: 'pkl-q-text', key: 'q' }, String(qi + 1) + '. ' + String(q.q)),
                h('div', { className: 'pkl-opts', key: 'o' }, opts),
                footer,
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
            onClick: () => askSend('我在学「' + (curProc ? curProc.title : '芯片封装') + '」的「' + point.title + '」。' + chip),
          }, chip))),
          h('div', { className: 'pkl-askbar-hint', key: 'h' }, '也可以直接在下面输入框里问，回车发送后会自动跳到「对话」界面看答案。'),
        ]))
      }

      // ------------------------------------------------------------ 顶栏面板
      // 三种面板互斥：搜索（有输入时）> 错题重做 > 课程自检

      const blockText = (b) => {
        if (!b || typeof b !== 'object') return ''
        if (typeof b.text === 'string') return b.text
        if (Array.isArray(b.items)) return b.items.join(' ')
        if (Array.isArray(b.head) || Array.isArray(b.rows)) {
          const flat = []
          if (Array.isArray(b.head)) for (const h1 of b.head) flat.push(String(h1))
          if (Array.isArray(b.rows)) for (const row of b.rows) if (Array.isArray(row)) for (const cell of row) flat.push(String(cell))
          return flat.join(' ')
        }
        if (typeof b.caption === 'string') return b.caption
        return ''
      }

      const pointIndex = {}
      for (const pid of Object.keys(data.courses || {})) {
        const c = data.courses[pid]
        const pts = Array.isArray(c && c.points) ? c.points : []
        for (const p of pts) pointIndex[p.id] = { processId: pid, procTitle: (c && c.title) || pid, point: p }
      }

      const searchAll = (needle) => {
        const out = []
        for (const id of Object.keys(pointIndex)) {
          const e = pointIndex[id]
          const body = (Array.isArray(e.point.body) ? e.point.body : []).map(blockText).join(' ')
          const quiz = (Array.isArray(e.point.quiz) ? e.point.quiz : [])
            .map((q) => String(q.q || '') + ' ' + (Array.isArray(q.options) ? q.options.join(' ') : '')).join(' ')
          const src = String(e.point.title || '') + ' ' + body + ' ' + quiz
          const at = src.toLowerCase().indexOf(needle)
          if (at < 0) continue
          const snippet = src.slice(Math.max(0, at - 18), Math.min(src.length, at + needle.length + 30)).trim()
          out.push({ pointId: id, processId: e.processId, procTitle: e.procTitle, title: e.point.title, snippet })
          if (out.length >= 30) break
        }
        return out
      }

      const jumpTo = (processId, pointId) => {
        for (const t of tracks) {
          const procs = Array.isArray(t.processes) ? t.processes : []
          if (procs.some((p) => p && p.id === processId)) { setTrackId(t.id); break }
        }
        setProcessId(processId)
        setPointId(pointId)
        setQuery('')
        setPanel(null)
        setWrongMode(false)
        setWrongSnapshot(null)
        setReviewMode(false)
      }

      const wrongList = () => {
        const map = wrongState || (data.wrong || {})
        const out = []
        for (const pid of Object.keys(map)) {
          const e = pointIndex[pid]
          if (!e) continue
          const quiz = Array.isArray(e.point.quiz) ? e.point.quiz : []
          const list = Array.isArray(map[pid]) ? map[pid] : []
          for (const qi of list) {
            const q = quiz[qi]
            if (!q) continue
            out.push({ pointId: pid, processId: e.processId, procTitle: e.procTitle, title: e.point.title, pointQuiz: quiz, qi, q })
          }
        }
        return out
      }

      const submitRedo = (item, picked) => {
        if (picked === undefined) return
        const correct = picked === item.q.answer
        submitAnswer(item.pointId, item.qi, item.q, item.pointQuiz)
        if (!correct) return
        setWrongState((prev) => {
          const cur = prev || (data.wrong || {})
          const list = Array.isArray(cur[item.pointId]) ? cur[item.pointId].filter((n) => n !== item.qi) : []
          const next = Object.assign({}, cur)
          if (list.length === 0) delete next[item.pointId]
          else next[item.pointId] = list
          return next
        })
        setWrongSnapshot((prev) => (Array.isArray(prev)
          ? prev.map((it) => (it.pointId === item.pointId && it.qi === item.qi ? Object.assign({}, it, { cleared: true }) : it))
          : prev))
      }

      // ------------------------------------------------- E2 今日复习：什么时候该回来看
      // 规则本身在模块作用域的 reviewQueue() 里（纯函数，验收脚本会算一遍）
      const reviewDue = () => reviewQueue(pointIndex, marked, wrongState || (data.wrong || {}), Date.now())

      const enterReview = () => {
        setReviewMode(true)
        setWrongMode(false)
        setWrongSnapshot(null)
        setQuery('')
        setPanel(null)
      }

      /** 记一次「复习过了」：间隔阶梯往上走一档 */
      const markReviewed = (pid) => {
        const now = new Date().toISOString()
        setMarked((prev) => Object.assign({}, prev, {
          [pid]: Object.assign({}, prev[pid] || {}, {
            reviewCount: ((prev[pid] && prev[pid].reviewCount) || 0) + 1,
            reviewedAt: now,
          }),
        }))
        rpc('record-review', { id: pid }).catch(() => {})
      }

      const needle = query.trim().toLowerCase()
      let topPanel = null

      if (needle !== '') {
        const hits = searchAll(needle)
        const kids = [h('div', { className: 'pkl-check-head', key: 'h' }, '搜索「' + query.trim() + '」· 命中 ' + hits.length + ' 个细分点')]
        if (hits.length === 0) {
          kids.push(h('div', { className: 'pkl-check-line', key: 'n' }, '没找到。换一个词试试（搜的是细分点标题、正文内容和小测题目）。'))
        } else {
          for (let i = 0; i < hits.length; i += 1) {
            const it = hits[i]
            kids.push(h('div', {
              className: 'pkl-hit',
              key: i,
              onClick: () => jumpTo(it.processId, it.pointId),
            }, [
              h('div', { className: 'pkl-hit-title', key: 't' }, it.title),
              h('div', { className: 'pkl-hit-where', key: 'w' }, it.procTitle + (it.snippet ? ' · ' + it.snippet : '')),
            ]))
          }
        }
        topPanel = kids
      } else if (panel === 'check' && check !== null) {
        if (check === 'loading') {
          topPanel = h('div', { className: 'pkl-check-line' }, '正在自检…')
        } else if (check.error !== undefined) {
          topPanel = h('div', { className: 'pkl-check-line pkl-check-err' }, '自检失败：' + check.error)
        } else {
          const kids = [h('div', { className: 'pkl-check-head', key: 'h' },
            '课程自检 · 主线 ' + check.trackCount + ' / 已写工序 ' + check.readyCount + ' / 细分点 ' + check.pointCount + ' / 小测题 ' + check.quizCount)]
          if (check.issues.length === 0) {
            kids.push(h('div', { className: 'pkl-check-ok', key: 'ok' }, '✓ 没发现问题'))
          } else {
            for (let i = 0; i < check.issues.length; i += 1) {
              const it = check.issues[i]
              kids.push(h('div', {
                className: 'pkl-check-line ' + (it.level === 'error' ? 'pkl-check-err' : 'pkl-check-warn'),
                key: i,
              }, (it.level === 'error' ? '[错误] ' : '[提醒] ') + it.where + ' — ' + it.message))
            }
          }
          topPanel = kids
        }
      } else if (panel === 'backup') {
        const kids = [h('div', { className: 'pkl-check-head', key: 'h' }, '备份与导出')]
        kids.push(h('div', { className: 'pkl-check-line', key: 'd' },
          '学习记录存在插件的 progress/ 目录里，是本机私有的、不进仓库。换电脑、重装、或者只是怕丢，都可以在这里先导出一份。'))
        const acts = [
          h('button', {
            type: 'button',
            className: 'pkl-btn pkl-btn-primary',
            key: 'e',
            disabled: backup === 'loading',
            onClick: doExport,
          }, backup === 'loading' ? '正在导出…' : '导出学习进度'),
          h('button', {
            type: 'button',
            className: 'pkl-btn',
            key: 'i',
            onClick: pickImportFile,
          }, '导入学习进度'),
          h('button', {
            type: 'button',
            className: 'pkl-btn',
            key: 'c',
            disabled: courseExport === 'loading',
            title: '整份课程导出成 Markdown：图片内嵌，单个文件即可打印或离线看',
            onClick: doExportCourse,
          }, courseExport === 'loading' ? '正在生成…' : '导出课程 Markdown'),
        ]
        kids.push(h('div', { className: 'pkl-warn-acts', key: 'a' }, acts))
        if (backup !== null && backup !== 'loading' && backup.error === undefined) {
          kids.push(h('div', { className: 'pkl-backup-ok', key: 'ok' }, [
            h('span', { key: 't' }, '✓ 已生成：' + String(backup.points) + ' 个知识点记录 / '
              + (backup.size / 1024).toFixed(1) + ' KB。'),
            h('a', {
              className: 'pkl-backup-link',
              key: 'l',
              href: backup.url || undefined,
              download: backup.name,
              onClick: (event) => { event.preventDefault(); saveExport() },
            }, backup.name),
            h('span', { className: 'pkl-warn-note', key: 'n' }, '（点文件名保存；没反应就右键它选「另存为」）'),
          ]))
        } else if (backup !== null && backup !== 'loading' && backup.error !== undefined) {
          kids.push(h('div', { className: 'pkl-check-line pkl-check-err', key: 'e' }, '导出失败：' + backup.error))
        }
        if (courseExport !== null && courseExport !== 'loading' && courseExport.error === undefined) {
          const st = courseExport.stats || {}
          kids.push(h('div', { className: 'pkl-backup-ok', key: 'cok' }, [
            h('span', { key: 't' }, '✓ 课程已导出：' + String(st.modules || 0) + ' 模块 / ' + String(st.points || 0) + ' 知识点 / '
              + String(st.questions || 0) + ' 题 / ' + String(st.figures || 0) + ' 张图（已内嵌） / '
              + (courseExport.size / 1024 / 1024).toFixed(2) + ' MB。进度状态也一并印在里面了。'),
            h('a', {
              className: 'pkl-backup-link',
              key: 'l',
              href: courseExport.url || undefined,
              download: courseExport.name,
              onClick: (event) => { event.preventDefault(); saveCourse() },
            }, courseExport.name),
          ]))
        } else if (courseExport !== null && courseExport !== 'loading' && courseExport.error !== undefined) {
          kids.push(h('div', { className: 'pkl-check-line pkl-check-err', key: 'cerr' }, '课程导出失败：' + courseExport.error))
        }
        if (importMsg !== '') {
          kids.push(h('div', {
            className: 'pkl-check-line' + (importMsg.indexOf('✓') === 0 ? ' pkl-check-ok' : ''),
            key: 'msg',
          }, importMsg))
        }
        kids.push(h('div', { className: 'pkl-warn-note', key: 'tip' },
          '导入会覆盖当前进度，但覆盖前会自动把现有进度备份到 progress/backups/<时间戳>/ —— 导错了也救得回来。'))
        topPanel = kids
      } else if (panel === 'study') {
        const kids = [h('div', { className: 'pkl-check-head', key: 'h' }, '学习统计')]
        if (study === null || study === 'loading') {
          kids.push(h('div', { className: 'pkl-check-line', key: 'l' }, '正在统计…'))
        } else if (study.error !== undefined) {
          kids.push(h('div', { className: 'pkl-check-line pkl-check-err', key: 'e' }, '读不到统计：' + study.error))
        } else {
          const sum = studySummary(study.time, Date.now())
          const maxBar = sum.bars.reduce((m, b) => Math.max(m, b.seconds), 0)
          kids.push(h('div', { className: 'pkl-study-row', key: 'r' }, [
            h('div', { className: 'pkl-study-cell', key: '1' }, [
              h('div', { className: 'pkl-study-num', key: 'n' }, humanTime(sum.todaySeconds)),
              h('div', { className: 'pkl-study-cap', key: 'c' }, '今天'),
            ]),
            h('div', { className: 'pkl-study-cell', key: '2' }, [
              h('div', { className: 'pkl-study-num', key: 'n' }, humanTime(sum.weekSeconds)),
              h('div', { className: 'pkl-study-cap', key: 'c' }, '最近 7 天'),
            ]),
            h('div', { className: 'pkl-study-cell', key: '3' }, [
              h('div', { className: 'pkl-study-num', key: 'n' }, humanTime(sum.totalSeconds)),
              h('div', { className: 'pkl-study-cap', key: 'c' }, '累计'),
            ]),
            h('div', { className: 'pkl-study-cell', key: '4' }, [
              h('div', { className: 'pkl-study-num', key: 'n' }, String(sum.streakDays) + ' 天'),
              h('div', { className: 'pkl-study-cap', key: 'c' }, '连续'),
            ]),
            h('div', { className: 'pkl-study-cell', key: '5' }, [
              h('div', { className: 'pkl-study-num', key: 'n' }, String(sum.activeDays) + ' 天'),
              h('div', { className: 'pkl-study-cap', key: 'c' }, '有学习的天数'),
            ]),
          ]))
          kids.push(h('div', { className: 'pkl-bars', key: 'bars' }, sum.bars.map((b) => h('div', {
            className: 'pkl-bar-col',
            key: b.key,
            title: b.key + ' · ' + humanTime(b.seconds),
          }, [
            h('div', { className: 'pkl-bar', key: 'b', style: { height: (maxBar > 0 ? Math.round((b.seconds / maxBar) * 46) : 0) + 'px' } }),
            h('div', { className: 'pkl-bar-day', key: 'd' }, b.key.slice(5)),
          ]))))
          if (sum.topPoints.length > 0) {
            const lines = sum.topPoints.map((it) => {
              const e2 = pointIndex[it.id]
              return (e2 ? e2.point.title : it.id) + '（' + humanTime(it.seconds) + '）'
            })
            kids.push(h('div', { className: 'pkl-check-line', key: 'top' }, '花时间最多的：' + lines.join(' ｜ ')))
          }
          kids.push(h('div', { className: 'pkl-warn-note', key: 'how' },
            '只统计「学习界面在前台、而且你还在操作」的时间：标签页切到后台、窗口最小化、'
            + '或者超过 5 分钟没有任何鼠标/键盘操作，那段都不算。宁可少算，也不把「窗口挂了一夜」算成学习。'))
          kids.push(h('div', { className: 'pkl-warn-acts', key: 'a' }, h('button', {
            type: 'button',
            className: 'pkl-btn',
            key: 'r',
            onClick: loadStudy,
          }, '刷新')))
        }
        topPanel = kids
      } else if (panel === 'about') {
        const kids = [h('div', { className: 'pkl-check-head', key: 'h' }, '设置 / 关于')]
        if (about === null || about === 'loading') {
          kids.push(h('div', { className: 'pkl-check-line', key: 'l' }, '正在读取…'))
        } else if (about.error !== undefined) {
          kids.push(h('div', { className: 'pkl-check-line pkl-check-err', key: 'e' }, '读不到：' + about.error))
        } else {
          const info = about.info || {}
          const c = info.counts || {}
          const rows = [
            ['插件版本', info.version || '—'],
            ['数据目录', info.root || '—'],
            ['目录来源', info.overridden === true ? '被 cordis.patch.yml 的 config.root 改过' : '插件包自定位（默认）'],
            ['主机方法', String((info.methods || []).length) + ' 个：' + (info.methods || []).join(' / ')],
            ['进度记录', String(c.marked || 0) + ' 个知识点（在学 ' + String(c.learning || 0) + ' / 已掌握 ' + String(c.mastered || 0) + '）'],
            ['错题与作答', String(c.wrongPoints || 0) + ' 个知识点有错题 · ' + String(c.attempts || 0) + ' 条作答流水'],
            ['学习时长', String(c.studyDays || 0) + ' 天有记录 · 累计 ' + humanTime(c.totalSeconds || 0)],
            ['自动备份', String(info.backupCount || 0) + ' 份（progress/backups/）'],
          ]
          const fileList = (info.files || []).map((f) => f.name + (f.bytes < 0 ? '（还没生成）' : ' ' + (f.bytes / 1024).toFixed(1) + ' KB'))
          rows.push(['进度文件', fileList.join(' · ')])
          for (let i = 0; i < rows.length; i += 1) {
            kids.push(h('div', { className: 'pkl-about-row', key: 'r' + i }, [
              h('span', { className: 'pkl-about-k', key: 'k' }, rows[i][0]),
              h('span', { className: 'pkl-about-v', key: 'v' }, rows[i][1]),
            ]))
          }
          kids.push(h('div', { className: 'pkl-warn-note', key: 'roottip' },
            '想换数据目录：改插件目录里的 cordis.patch.yml（把 config.root 取消注释、填绝对路径），然后重启 dsh。'
            + '没做成界面里可点，是因为改完必须重启才生效，做成按钮反而是个半成品。'))
          kids.push(h('div', { className: 'pkl-warn-acts', key: 'a' }, [
            h('button', {
              type: 'button',
              className: 'pkl-btn',
              key: 'f',
              title: '学习会话被删掉、入口点不动时用这个',
              onClick: doForgetSession,
            }, '忘记学习会话'),
            h('button', {
              type: 'button',
              className: 'pkl-btn pkl-btn-danger',
              key: 'dr',
              title: '清空知识点状态 / 错题本 / 作答流水 / 学习时长；清空前自动备份',
              onClick: doReset,
            }, '清空学习进度'),
            h('button', {
              type: 'button',
              className: 'pkl-btn',
              key: 're',
              onClick: loadAbout,
            }, '刷新'),
          ]))
          kids.push(h('div', { className: 'pkl-warn-note', key: 'danger' },
            '「清空学习进度」只清学过的痕迹，不动学习会话和界面偏好。它会先自动备份，'
            + '备份就在 progress/backups/ 里，用「备份与导出 → 导入学习进度」能把那份导回来。'))
        }
        if (importMsg !== '') {
          kids.push(h('div', {
            className: 'pkl-check-line' + (importMsg.indexOf('✓') === 0 ? ' pkl-check-ok' : ''),
            key: 'msg',
          }, importMsg))
        }
        topPanel = kids
      }

      // ------------------------------------------------ 错题重做（独立界面）
      // 按知识点分组：每个知识点一张卡片，卡片头是知识点名 + 来源工序 + 跳转。
      const wrongGroups = () => {
        const src = Array.isArray(wrongSnapshot) ? wrongSnapshot : wrongList()
        const order = []
        const byPoint = Object.create(null)
        for (const it of src) {
          if (byPoint[it.pointId] === undefined) {
            byPoint[it.pointId] = {
              pointId: it.pointId,
              processId: it.processId,
              procTitle: it.procTitle,
              title: it.title,
              items: [],
            }
            order.push(byPoint[it.pointId])
          }
          byPoint[it.pointId].items.push(it)
        }
        return order
      }

      const wrongQuestion = (item) => {
        const key = item.pointId + ':' + item.qi
        const picked = answers[key]
        const done = graded[key] === true
        const opts = (Array.isArray(item.q.options) ? item.q.options : []).map((opt, oi) => {
          let cls = 'pkl-opt'
          if (done) {
            if (oi === item.q.answer) cls += ' pkl-opt-right'
            else if (oi === picked) cls += ' pkl-opt-wrong'
          } else if (oi === picked) {
            cls += ' pkl-opt-picked'
          }
          return h('button', {
            type: 'button',
            key: oi,
            className: cls,
            disabled: done,
            onClick: () => pick(item.pointId, item.qi, oi),
          }, String.fromCharCode(65 + oi) + '. ' + String(opt))
        })
        const footer = done
          ? h('div', { className: 'pkl-explain', key: 'e' },
            (picked === item.q.answer ? '✓ 正确，已从错题本移出。' : '✗ 还是不对，正确答案是 ' + String.fromCharCode(65 + item.q.answer) + '。') + String(item.q.explain || ''))
          : h('div', { className: 'pkl-submit-row', key: 'e' }, [
            h('button', {
              type: 'button',
              className: 'pkl-btn pkl-btn-primary',
              key: 'b',
              disabled: picked === undefined,
              onClick: () => submitRedo(item, picked),
            }, picked === undefined ? '先选一个选项' : '提交本题'),
            h('span', { className: 'pkl-submit-hint', key: 'h' }, '提交前可以随便改'),
          ])
        return h('div', { className: 'pkl-q', key }, [
          h('div', { className: 'pkl-q-text', key: 'q' }, '第 ' + String(item.qi + 1) + ' 题：' + String(item.q.q)),
          h('div', { className: 'pkl-opts', key: 'o' }, opts),
          footer,
        ])
      }

      let wrongBody = null
      if (wrongMode) {
        const groups = wrongGroups()
        let total = 0
        for (const g of groups) total += g.items.length
        const kids = []
        if (total === 0) {
          kids.push(h('div', { className: 'pkl-wrong-empty', key: 'e' }, '✓ 错题本是空的。去各道工序做几道小测，答错的题会自动收进这里。'))
        } else {
          kids.push(h('div', { className: 'pkl-wrong-sum', key: 's' },
            '共 ' + String(total) + ' 道错题，分属 ' + String(groups.length) + ' 个知识点。先选、可改，提交后才批改；答对会自动移出。'))
          for (const g of groups) {
            kids.push(h('div', { className: 'pkl-wrong-group', key: g.pointId }, [
              h('div', { className: 'pkl-wrong-head', key: 'h' }, [
                h('div', { className: 'pkl-wrong-title', key: 't' }, g.title),
                h('div', { className: 'pkl-wrong-meta', key: 'm' }, g.procTitle + ' · ' + String(g.items.length) + ' 道'),
                h('span', { className: 'pkl-wrong-spacer', key: 'sp' }),
                h('button', {
                  type: 'button',
                  className: 'pkl-btn',
                  key: 'g',
                  onClick: () => jumpTo(g.processId, g.pointId),
                }, '去看这个知识点'),
              ]),
              h('div', { key: 'q' }, g.items.map((it) => wrongQuestion(it))),
            ]))
          }
        }
        wrongBody = kids
      }

      // ------------------------------------------------ E2 今日复习（独立界面）
      // 每一条只回答两个问题：为什么现在该看它、看完了点哪里。
      let reviewBody = null
      if (reviewMode) {
        const due = reviewDue()
        const kids = []
        if (due.length === 0) {
          kids.push(h('div', { className: 'pkl-wrong-empty', key: 'e' },
            '✓ 今天没有该复习的了。去学新知识点吧——错题会自动排进来，学过的点会按 1 / 3 / 7 / 16 / 35 天的间隔阶梯回来找你。'))
        } else {
          const wrongN = due.filter((it) => it.rank === 0).length
          kids.push(h('div', { className: 'pkl-wrong-sum', key: 's' },
            '今天该回看 ' + String(due.length) + ' 个知识点'
            + (wrongN > 0 ? '，其中 ' + String(wrongN) + ' 个是错题还没消化的' : '')
            + '。规则：错题未消 → 立刻；在学 → 放了 3 天还没学完就催；已掌握 → 1 / 3 / 7 / 16 / 35 天逐档拉长。'))
          const shown = due.slice(0, REVIEW_PAGE)
          if (due.length > shown.length) {
            kids.push(h('div', { className: 'pkl-check-line', key: 'more' },
              '下面只列最该先看的 ' + String(shown.length) + ' 个；清掉这些，剩下的 ' + String(due.length - shown.length) + ' 个会自动顶上来。'))
          }
          for (const it of shown) {
            kids.push(h('div', { className: 'pkl-wrong-group', key: it.pointId }, [
              h('div', { className: 'pkl-wrong-head', key: 'h' }, [
                h('div', { className: 'pkl-wrong-title', key: 't' }, [
                  it.rank === 0 ? h('span', { className: 'pkl-due-tag pkl-due-hot', key: 'tag' }, '错题') : null,
                  it.rank === 1 ? h('span', { className: 'pkl-due-tag', key: 'tag' }, '在学') : null,
                  h('span', { key: 'x' }, it.title),
                ]),
                h('div', { className: 'pkl-wrong-meta', key: 'm' }, it.procTitle + ' · ' + it.reason),
                h('span', { className: 'pkl-wrong-spacer', key: 'sp' }),
                h('button', {
                  type: 'button',
                  className: 'pkl-btn pkl-btn-primary',
                  key: 'r',
                  title: '记一次复习，这一档间隔往上走',
                  onClick: () => markReviewed(it.pointId),
                }, '复习过了'),
                h('button', {
                  type: 'button',
                  className: 'pkl-btn',
                  key: 'g',
                  onClick: () => jumpTo(it.processId, it.pointId),
                }, '去看'),
              ]),
            ]))
          }
        }
        reviewBody = kids
      }

      return h('div', { className: 'pkl-view' }, [
        // E3：把「界面开着且你在操作」的时间记下来。它渲染成 null，没有视觉影响。
        h(StudyTimer, { key: 'timer', pointId }),
        h('div', { className: 'pkl-learn', key: 'learn', style: { paddingBottom: pad + 'px' } }, [
          h('div', {
          className: 'pkl-bar',
          key: 'bar',
          // B3：把自己真实的高度报上去；知识树上边跟着顶部栏，下边跟着「底部预留」
          ref: (el) => {
            if (!el) return
            const bar = Math.round(el.offsetHeight)
            let max = 560
            try {
              max = Math.max(200, Math.round(window.innerHeight - bar - pad - 44))
            } catch (error) {
              max = 560
            }
            setGeo((prev) => (prev.bar === bar && prev.max === max ? prev : { bar, max }))
          },
        }, [
            h('div', { className: 'pkl-tracks', key: 'tr' }, [tracks.map((t) => h('button', {
              type: 'button',
              key: t.id,
              className: 'pkl-track' + (t.id === trackId ? ' pkl-track-on' : ''),
              title: t.hint || '',
              onClick: () => {
                setWrongMode(false)
                setWrongSnapshot(null)
                setTrackId(t.id)
                const procs = Array.isArray(t.processes) ? t.processes : []
                const ready = procs.find((p) => p && p.status === 'ready')
                if (ready) selectProcess(ready)
                else { setProcessId(''); setPointId('') }
              },
            }, t.title)), h('button', {
              type: 'button',
              key: 'wrong-entry',
              className: 'pkl-track pkl-track-wrong' + (wrongMode ? ' pkl-track-on' : ''),
              title: '点进去是独立的错题界面，按知识点分组',
              onClick: enterWrong,
            }, '错题重做' + (wrongList().length > 0 ? ' ' + String(wrongList().length) : '')), h('button', {
              type: 'button',
              key: 'review-entry',
              className: 'pkl-track pkl-track-review' + (reviewMode ? ' pkl-track-on' : ''),
              title: '按间隔重复挑出今天该回看的知识点（错题未消 > 还在学 > 已掌握到期）',
              onClick: enterReview,
            }, '今日复习' + (reviewDue().length > 0 ? ' ' + String(reviewDue().length) : ''))]),
            h('div', { className: 'pkl-toolbar', key: 'tools' }, [
              h('input', {
                className: 'pkl-search',
                key: 's',
                type: 'search',
                placeholder: '搜索知识点 / 正文 / 题目…',
                value: query,
                onChange: (event) => setQuery(event.target.value),
              }),
              h('button', {
                type: 'button',
                className: 'pkl-track' + (panel === 'check' ? ' pkl-track-on' : ''),
                key: 'c',
                title: '检查课程 JSON 有没有写错（字段缺失 / 类型不对 / 图找不到 / id 重复 / answer 越界）',
                onClick: toggleSelfCheck,
              }, '课程自检'),
              h('button', {
                type: 'button',
                className: 'pkl-track' + (panel === 'backup' ? ' pkl-track-on' : ''),
                key: 'b',
                title: '导出 / 导入学习进度；也可以把整份课程导出成 Markdown（图内嵌，可打印）',
                onClick: toggleBackup,
              }, '备份与导出'),
              h('button', {
                type: 'button',
                className: 'pkl-track' + (panel === 'study' ? ' pkl-track-on' : ''),
                key: 'st',
                title: '学习时长：今天 / 最近 7 天 / 累计 / 连续天数（只算界面在前台且你在操作的时间）',
                onClick: toggleStudy,
              }, '学习统计'),
              h('button', {
                type: 'button',
                className: 'pkl-track' + (panel === 'about' ? ' pkl-track-on' : ''),
                key: 'ab',
                title: '插件版本、数据目录、进度规模、以及「忘记学习会话 / 清空进度」',
                onClick: toggleAbout,
              }, '设置'),
            ]),
            h('div', { className: 'pkl-procs', key: 'pr' }, processes.map((proc) => h('button', {
              type: 'button',
              key: proc.id,
              className: 'pkl-proc' + (proc.id === processId ? ' pkl-proc-on' : '') + (proc.status === 'ready' ? '' : ' pkl-proc-planned'),
              title: proc.status === 'ready' ? proc.title : proc.title + '（内容待补）',
              onClick: () => selectProcess(proc),
            }, proc.title))),
          ]),
          topPanel !== null ? h('div', { className: 'pkl-check', key: 'panel' }, topPanel) : null,
          reviewMode
            ? h('div', { className: 'pkl-wrong', key: 'body' }, reviewBody)
            : wrongMode
              ? h('div', { className: 'pkl-wrong', key: 'body' }, wrongBody)
            : h('div', { className: 'pkl-body', key: 'body' }, [
              h('div', { className: 'pkl-tree', key: 'tree', style: { top: geo.bar + 'px', maxHeight: geo.max + 'px' } }, treeRows),
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
        // C3：死胡同里那个「进入学习会话」按钮要用它做懒解析
        ctx: props.ctx,
      }))
      return h(React.Fragment, null, kids)
    }

    // ------------------------------------------------------------------ 插件
    /** 把三个槽位登记上去。抽成函数是为了让 C5 的重试也能走同一条路。 */
    function installUI(ctx, slots, defer) {
      // 1. 左侧栏最下方的常驻入口
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'package-learn-entry', order: 5, label: '芯片封装学习' },
        (slotProps) => h(EntryButton, { wide: slotProps.wide === true, ctx }),
      ))

      // 2. 学习会话里的一次性提示
      slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'package-learn-hint', order: 1, label: '芯片封装学习' },
        (slotProps) => h(LearnDock, { sessionId: slotProps.sessionId, useInput: slotProps.useInput }),
      ))

      // 3. 学习界面本体（顶栏标签）
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: 'package-learn', order: 50, label: '📚 进入学习界面' },
        (slotProps) => h(LearnRoot, {
          sessionId: slotProps.sessionId,
          useChat: slotProps.useChat,
          inputActions: slotProps.inputActions,
          defer,
          ctx,
          onSend: () => {
            if (typeof slotProps.openView === 'function') slotProps.openView('chat', '')
          },
        }),
      ))
    }

    function applyInner(ctx) {
      // 用最防御的写法：任何一步出问题都只是「界面不出现」，绝不抛错。
      const defer = (fn, ms) => { ctx.timeout(fn, ms) }
      const readSlots = () => {
        try {
          return ctx && typeof ctx.get === 'function' ? ctx.get('slots') : undefined
        } catch (error) {
          return undefined
        }
      }

      ctx.effect(() => insertStyles(CSS))

      const first = readSlots()
      if (first !== undefined && first !== null) {
        try {
          installUI(ctx, first, defer)
        } catch (error) {
          mountFailed(ctx, '登记界面时出错：' + String((error && error.message) || error))
        }
        return
      }

      // C5：拿不到 slots 服务。
      // 正式插件是在 dsh 启动过程中 apply 的，服务可能晚一点才注册好，
      // 所以先有限重试几次；确实拿不到就把话写在页面上（否则界面是「什么都不出现」，
      // 用户完全看不出是插件没挂上还是 dsh 坏了）。
      let tries = 0
      const again = () => {
        const s = readSlots()
        if (s !== undefined && s !== null) {
          try {
            installUI(ctx, s, defer)
            return
          } catch (error) {
            mountFailed(ctx, '登记界面时出错：' + String((error && error.message) || error))
            return
          }
        }
        tries += 1
        if (tries > 5) {
          mountFailed(ctx, '拿不到 slots 服务（等了约 5 秒）')
          return
        }
        defer(again, 1000)
      }
      defer(again, 1000)
    }

    /**
     * 插件入口。这里有一条硬约束：**任何情况下都不许抛错**。
     * 客户端插件抛错会影响整棵插件树的启动，最坏是 dsh 打不开；
     * 而这个插件失败最多只该是「界面不出现」。所以最外层再兜一次。
     */
    function apply(ctx) {
      try {
        applyInner(ctx)
      } catch (error) {
        mountFailed(ctx, '插件启动出错：' + String((error && error.message) || error))
      }
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['timer']
    // 给验收脚本（_client-check.mjs）用：复习队列是纯函数，可以脱离浏览器算一遍。
    // 只读、无副作用，不影响插件行为。
    module.exports.__internal = {
      reviewQueue,
      daysSince,
      reviewInterval,
      REVIEW_STEPS,
      studySummary,
      humanTime,
      localDateKey,
      IDLE_MS,
    }
    return module.exports
  },
})
