# CONTEXT.md —— 下次开发的最短路径

> **这份文档的目的**：让你（或下一个接手的 AI）**不用再读整个工程**就能开工。
> 先读这一份，再去读对应的那个文件。最后更新：2026-09-18 · 版本 `0.4.0`

---

## 0. 想干什么 → 直接看哪里

| 我要做的事 | 打开这个文件 | 改完怎么确认 |
|---|---|---|
| 加 / 改课程内容 | `content/<主线>/<模块>.json` + `content/tracks.json` | `node tools/check-content.mjs` |
| 改界面、加按钮、调样式 | `lib/client.js`（**2060 行**，界面全在这一个文件） | `node tools/check-all.mjs` **+ 浏览器看一眼** |
| 改读盘 / 存进度 / 自检 / 导出 | `lib/index.js`（**950 行**） | `node tools/check-all.mjs` |
| 改挂载或数据目录 | `cordis.patch.yml`、`package.json` | 重启 dsh |
| 查"为什么当初这么定" | 本文第 6 节 | —— |
| 查"这个坑踩过没有" | 本文第 8 节 | —— |
| 界面挂了/白屏 | 先跑 `node tools/check-render.mjs` | —— |

**改完之后怎么生效**（两件事完全分开，别搞混）：

| 改的是 | 生效方式 |
|---|---|
| `lib/client.js` | 浏览器 **Ctrl + Shift + R** 硬刷新 |
| `lib/index.js` | **重启 dsh**（主机半是启动时读进内存的） |
| `content/` `assets/` | 刷新页面即可 |
| `cordis.patch.yml` `package.json` | **重启 dsh** |

---

## 1. 这东西是什么

一个装在 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 里的**芯片封装学习插件**：
左侧栏底部一个常驻入口 → 进一个专属学习界面（三条主线 / 19 个模块 / 114 个细分点 / 450 道小测题 /
19 张剖面图），底部还是 dsh 原生的输入框，随时能问 AI。

**用户最初的三条硬约束（一直有效）**：

1. **绝不能让 dsh 崩溃** → `apply()` 在任何输入下都不许抛错，最坏只是"界面不出现"。
2. **要能方便地直接删掉、不牵连别的东西** → 所有副作用挂在 `ctx.effect` 上；没有任何后台进程、
   没有构建步骤、不写注册表、不动 dsh 自己的文件。
3. 课程内容由 AI 撰写，用户是初学者 → 内容深度按**第 3 档（面试拷问级）**：可计算的公式与数量级、
   "为什么不能反过来做"的反向论证、30 秒失效链案例、面试追问预判。

---

## 2. 文件地图

```
Package_Learn_Plug_In/
├─ CONTEXT.md            ← 你正在看的这份（交接文档）
├─ README.md             ← 给用户看的：安装、卸载、功能说明、数据结构、dsh 适配
├─ TODO.md               ← 任务板：A~E 分类、勾选、完成记录（含每次事故与反思）
├─ package.json          ← 插件包声明：版本、exports['./client']、dsh.bundle.patch、dsh.client
├─ cordis.patch.yml      ← 挂载行；想换数据目录就取消 config.root 注释
├─ lib/
│  ├─ index.js           ← 主机半：HTTP 路由 /package-learn/api + 19 个方法 + 课程自检
│  └─ client.js          ← 客户端半：侧栏入口 + 学习界面 + 今日复习 + 错题重做 + 四个面板
├─ content/              ← 课程内容（20 个 JSON / 1145 KB）
│  ├─ tracks.json        ← 课程地图：3 条主线、19 道工序、status、内容文件位置
│  ├─ traditional/       ← 8 个：减薄/划片/装片/键合/塑封/植球/切筋/测试
│  ├─ advanced/          ← 6 个：Bumping/WLCSP/Fan-out/TSV/堆叠/Chiplet
│  └─ topics/            ← 5 个：封装形式/材料/设备/可靠性/术语
├─ knowledge/points.json ← 114 个知识点 id 的登记表（自检会核对）
├─ assets/               ← 19 张 SVG（内联进界面；导出的 Markdown 会转成 data URI）
├─ tools/                ← 验收脚本（不属于运行路径，删掉不影响插件）
│  ├─ check-all.mjs      ← 一条命令跑完
│  ├─ check-content.mjs  ← 内容结构 / 字段 / 小测数 / 配图
│  ├─ check-host.mjs     ← 真挂主机半 + 走 HTTP 路由调每个方法
│  ├─ check-client.mjs   ← 静态：接线 / CSS / 写入顺序
│  └─ check-render.mjs   ← 迷你 React 真渲染一遍界面 + 点按钮
├─ progress/             ← 学习进度（本机私有，只有 README 进仓库）
└─ plugin/               ← ⚠️ 阶段一遗留源码，已废弃，仅作参考
```

---

## 3. 架构：只有两半，靠一条 HTTP 路由连接

```
浏览器（客户端半 lib/client.js）
  ├─ 侧栏入口  sidebar.footer.action
  ├─ 一次性提示 conversation.input.dock
  └─ 学习界面   conversation.view
        │  fetch POST /package-learn/api  {method, args} → {ok, value}
        ▼
Node（主机半 lib/index.js，inject: ['webServer']）
  ├─ 读 content/ + assets/
  ├─ 读写 progress/（只有主机半碰磁盘）
  └─ 课程自检 / 导出 Markdown
```

**19 个方法**（客户端只能调这些，没有任意路径读写）：

`gate` `mark-visited` `load` `get-session` `save-session` `forget-session` `set-status`
`record-quiz` `record-review` `record-time` `ensure-workspace` `selfcheck` `export-progress`
`import-progress` `list-backups` `reset-progress` `about` `time-summary` `export-markdown`

**三条纪律**：

1. 客户端的 `ctx.get('sessions')` / `uiWorkspace` / `slots` 必须在**点击那一刻**懒解析——
   `apply()` 是在 dsh 启动过程中跑的，那时服务还没注册。
2. 主机半 `apply()` 在 `webServer` 缺失时安静 `return`，其余分支全部 try/catch。
3. 任何写盘操作都必须：**先备份 → 备份失败就拒绝写**。

---

## 4. 数据结构（照抄就能加内容）

### 4.1 课程文件 `content/<主线>/<模块>.json`

```json
{
  "id": "wafer-thinning",
  "track": "traditional",
  "title": "晶圆减薄",
  "subtitle": "一句话概括",
  "points": [
    {
      "id": "wt.why",
      "title": "为什么必须减薄：把「为什么」算出来",
      "estMinutes": 8,
      "body": [
        { "type": "p",       "text": "段落，只允许 **加粗**" },
        { "type": "h",       "text": "小标题" },
        { "type": "list",    "items": ["要点一", "要点二"] },
        { "type": "table",   "head": ["列1","列2"], "rows": [["a","b"]] },
        { "type": "figure",  "svg": "wt-backgrind.svg", "caption": "图注" },
        { "type": "callout", "tone": "key",  "text": "重点框" },
        { "type": "callout", "tone": "warn", "text": "注意框" }
      ],
      "quiz": [
        { "q": "题干", "options": ["A","B","C","D"], "answer": 1, "explain": "解析" }
      ],
      "related": ["dc.dbg", "wt.stress"]
    }
  ]
}
```

**内容写作的硬规矩**（自检会查）：

- `body` 只认这六种块，顺序随意、可重复；只有 `callout` 有 `tone`。
- `text` 里**只有 `**加粗**` 这一种标记**：不要反引号、不要 `#` 标题、不要链接、不要代码块。
- `answer` 是**选项序号，从 0 开始**，必须落在 `options` 范围内。
- `related` 是**跨模块跳转**（见第 6 节 A5），指向不存在的 id 会报错。
- `figure.svg` 只写文件名，从 `assets/` 解析。

### 4.2 课程地图 `content/tracks.json`

```json
{ "tracks": [ { "id":"traditional", "title":"传统封装流程", "hint":"一句话说明",
  "processes": [ { "id":"wafer-thinning", "title":"晶圆减薄",
                   "file":"traditional/01-wafer-thinning.json", "status":"ready" } ] } ] }
```

`status` 只有 `ready` / `planned`；`planned` 的工序按钮显示成灰的「待补」，不会被加载。

### 4.3 进度文件（都在 `progress/`，全部被 `.gitignore` 排除）

| 文件 | 结构 |
|---|---|
| `state.json` | `{points:{"<pid>":{status:'unseen'\|'learning'\|'mastered', updatedAt, reviewCount?, reviewedAt?}}}` |
| `quiz.json` | `{attempts:[…最多 500 条], wrong:{"<pid>":[题号,…]}}` |
| `session.json` | `{sessionId}` —— 固定学习会话；失效时客户端会 `forget-session` 后重建 |
| `ui.json` | `{visited}` —— 控制学习会话里那条一次性提示 |
| `time.json` | `{totalSeconds, days:{"YYYY-MM-DD":秒}, points:{"<pid>":秒}}` |
| `backups/<时间戳>[-before-reset]/` | 导入或清空前自动留下的旧进度（state/quiz/ui/time） |

**写这些文件时记住**：`set-status` / `record-review` 必须是**合并写**，不能覆盖整个条目——
复习记录（`reviewCount` / `reviewedAt`）和状态存在同一个对象里，覆盖写会把复习进度吃掉（踩过）。

### 4.4 客户端内部状态（改界面必看）

`LearnView` 一个组件装了全部界面状态。**`useState` 的调用顺序是一个隐含契约**：
`tools/check-render.mjs` 的迷你 React 按「组件实例 + 槽位序号」保存状态，
**调换两个 `useState` 的顺序会导致状态错位**（不会报错，但界面会莫名其妙）。
要加状态就**追加在末尾**，别插队；改完一定跑渲染测试 + 浏览器看一眼。

界面模式由三个变量决定：`panel`（`null`/`'check'`/`'backup'`/`'study'`/`'about'`）、
`wrongMode`（错题重做独立界面）、`reviewMode`（今日复习独立界面）；搜索用 `query`。
CSS 类名全部以 `pkl-` 开头。

---

## 5. 验收：一条命令

```powershell
node tools/check-all.mjs
```

| 脚本 | 真的会做什么 | 抓什么 |
|---|---|---|
| `check-content.mjs` | 读全部内容 JSON 逐块校验 | 字段缺失 / 类型不对 / answer 越界 / 图找不到 / 正文混进反引号 |
| `check-host.mjs` | 用假 ctx **真挂主机半**，走 HTTP 路由调每个方法 | 挂载抛错 / 返回不对 / 自检报错 / 关联断链 / 导入导出往返 / 来源限制 / 时长累加 |
| `check-client.mjs` | 静态读 `lib/client.js` | 接线还在不在 / 导入与重置的**写入顺序**（必须先备份）/ **CSS 同名选择器重复定义** / 横排会不会溢出被裁 / 类名有没有样式 |
| `check-render.mjs` | `content/` 拷到临时目录 + 挂主机半 + 迷你 React **真渲染一遍**，再点 6 组按钮 | 渲染崩溃 / 数据字段不对 / **Hook 顺序变化** / 某块界面没渲染出来 / 点了没反应 |

**它抓不到什么（别指望）**：

- **样式好不好看、有没有被挤扁** —— 只能查"同名选择器定义两次"这类静态问题。
  **改完 `lib/client.js` 的样式，一定要在浏览器里看一眼。**（22px 那次事故就是这类。）
- 视觉美观、交互手感、真实浏览器的重排与溢出。
- 嵌套错位的 SVG；真实 dsh 服务（脚本用假 ctx / 假浏览器，dsh 升级改服务名它照样全绿）。

**改检查脚本时的纪律**：新增一条检查，要**故意把问题改回去看它报不报**，
改完再核对文件哈希与注入前一致。没验证过的回归测试等于没有测试。

---

## 6. 已经定下来的设计决策（**不要再重新讨论**）

| 决策 | 理由 |
|---|---|
| **A5 跨模块只做跳转，绝不合并知识点 id** | 看起来都是"IMC"的三个点（`wb.materials` 紫斑、`mt.imc` 的 √(k·t)、`rl.hts` 的 Arrhenius）讲的是三件事。共用 id 会让"学过紫斑"被当成"学过 IMC 动力学"，进度就是假的。CTE、共面性、MSL 爆米花、浴盆曲线、DNP 同理。串联用 `related` 字段 |
| **E2「在学」要放 3 天才催** | 打开一个点就自动标"在学"，所以"在学"只代表"我点开过"。按 1 天算，实测本机 30 个点会一次性糊成一堵墙 |
| **E2 间隔阶梯 1 / 3 / 7 / 16 / 35 天** | 每点一次「复习过了」往上走一档。错题未消的**无视间隔立刻进队列且排最前**——错题是"没学会"的硬证据 |
| **E3 时长口径保守** | 只算"界面在前台 + 最近 5 分钟有鼠标/键盘/滚轮操作"。后台标签页、最小化、走开了、切走时不足 5 秒的零头**都不算**。宁可少算，也不把"窗口挂了一夜"算成学习 |
| **E3 按本地日期分桶** | 用 UTC 会把北京时间凌晨那几小时算到前一天 |
| **E1/E5 不可逆操作先备份** | 导入进度、清空进度都必须"先备份 → 备份失败就拒绝执行"；导入的坏数据**整包拒掉、一个字都不写盘** |
| **E5 不做"界面里改数据目录"** | 改完必须重启 dsh 才生效，做成按钮就是个"点了没反应"的半成品。只在设置面板**显示路径 + 说明怎么改** |
| **D5 不给客户端 bundle 加构建步骤** | 现在"clone → 建目录链接 → 重启"就能跑；加了构建就变成"改了必须先 build"，和"方便、可直接删除"相冲 |
| **C4 只查 `Origin`，不查 `Host`** | `Host` 是请求方自己写的、随便伪造，挡不住谁；却会误伤 `dsh://` 这类自定义协议加载的宿主页面。外域 Origin → 403，足以挡住 CSRF 与 DNS rebinding |
| **学习时长只在学习界面里计** | 切到原生对话界面问 AI 那段时间不算——没有可靠办法判断那是不是"在学习" |
| **`apply()` 永不抛错** | 用户第一条硬约束。任何分支失败最多是"界面不出现"；挂载失败时页面左下角给一条可见提示 |

---

## 7. 内容现状

- 19 个模块 / 114 个细分点 / 450 道小测题 / 19 张配图，**三条主线全亮**。
- 关联：65 个知识点带 `related`，共 128 条链接（跨模块 121 条）。
- 主线与模块：

| 主线 | 模块 |
|---|---|
| 传统封装（8） | 晶圆减薄 / 划片 / 装片 / 引线键合 / 塑封 / 植球 / 切筋成型 / 测试 |
| 先进封装（6） | Bumping / WLCSP / Fan-out / TSV / 2.5D-3D 堆叠 / Chiplet |
| 专题模块（5） | 封装形式分类 / 封装材料 / 设备 / 可靠性测试 / 行业术语 |

加一个新模块的步骤：写 `content/<主线>/<模块>.json` → 往 `tracks.json` 加一条
（`status:"ready"`）→ 往 `knowledge/points.json` 登记知识点 id → 跑 `node tools/check-all.mjs`。

---

## 8. 踩过的坑（按"下次最可能再踩"排序）

### 8.1 代码里的坑

1. **CSS 类名冲突**（真出过事故）：给柱状图写 `.pkl-bar{width:22px}`，可 `.pkl-bar` 早就是整个顶栏容器
   —— 同名选择器后者覆盖前者，**整条顶栏被压成 22px**，里面所有按钮挤成竖排单字。
   → 现在 `check-client.mjs` 会拦"同名选择器被定义两次"；**加样式前先 grep 一下类名有没有被用过**。
2. **横排容器不换行会被裁**：`display:flex` 但没 `flex-wrap`，窄窗口下内容往右溢出，被外层一裁
   **按钮就凭空消失**，用户甚至不知道有这些功能。→ 横排一律 `flex-wrap:wrap` 或 `overflow-x:auto`；
   按钮加 `flex:0 0 auto` 永不被压缩。
3. **React Hook 顺序**：早期 `LearnView` 在提前 return 之后才调 `useChat`，触发
   "Rendered more hooks than during the previous render"（React #310）。
   → 所有 Hook 必须在提前 return 之前；读取 Hook 的组件要单独拆出去（`SendWatcher` / `RecentMessages`）。
4. **客户端服务必须懒解析**：`apply()` 时取 `sessions`/`uiWorkspace` 一定是 `undefined`，
   入口按钮会静默什么都不做 → 在**点击那一刻**再 `ctx.get(...)`。
5. **会话 id 失效**：`sessions.open(未知 id)` 会抛错。→ 捕获后先 `forget-session` 清指针再新建，
   否则每次进来都踩同一颗雷。
6. **覆盖写吃掉数据**：`set-status` 原来 `points[id] = {status, updatedAt}`，把同一条目里的
   `reviewCount`/`reviewedAt` 抹掉。→ 一律**合并写**（`Object.assign({}, prev, {...})`），
   客户端 `mark()` 与"打开即标在学"两处同理。
7. **渲染测试的事件循环**：`load` 要顺序读 19 个内容文件 + 19 张图，每次文件 IO 都落在**更晚一轮**。
   只按"等 N 轮"判断稳定会提前收工、渲染出空树。→ 等**在途请求清零**。

### 8.2 工具链的坑（Windows / PowerShell）

1. **PowerShell 5.1 读 `.ps1` 按系统 ANSI（GBK）解码**：脚本里一有中文就乱码、引号跟着断。
   → 工具脚本一律写 **`.mjs`**（Node 读文件一律 UTF-8）。
2. **`Get-Content -Raw` 读 UTF-8 文件会按 GBK 解**，得到假的 XML/JSON 报错。
   → 用 `[System.IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)` 或 `-Encoding UTF8`。
3. **PowerShell 的 `-replace` 不支持脚本块替换**：`-replace 'x', { ... }` 会把代码文本**插进字符串**里，
   文件直接被写坏。→ 用 `.Replace()` 字面量替换，或 `[regex]::Replace` + MatchEvaluator。
4. **别用正斜杠子串替换 Windows 路径**：`SRC.replace('lib/client.js', ...)` 在反斜杠路径上**替换不到**
   （曾导致"拿客户端半当主机半断言"，4 条假失败）。→ 用 `join(ROOT, 'lib', 'index.js')`。
5. `node -e` 会吃掉双引号 → 用 here-string 管道给 `node -`。
6. 本机**没有 `pwsh`**（只有 Windows PowerShell 5.1）；单引号里的 `"` 不需要转义，反引号才是转义符。
7. **改文件做"注入验证"后要核对哈希**：`(Get-FileHash $f).Hash` 与注入前一致，才能确认还原干净。

---

## 9. dsh 升级后先查这些（名字对不上就会"界面什么都不出现"）

| 用到的 | 名字 |
|---|---|
| 主机服务 | `webServer.register({kind:'exact', path, handler})` |
| 主机服务（可选） | `workspaceRegistry.resolveByPath` / `.create` |
| 客户端服务 | `slots`（登记槽位）、`sessions`（`.open`）、`uiWorkspace`（`.connectWorkspace`/`.startSession`） |
| 槽位名 | `sidebar.footer.action` / `conversation.view` / `conversation.input.dock` |
| 模块加载器 | `window.__ModuleLoader__.load({id, factory})`，`factory(require)` 里 `require('react')` |
| 主题变量 | `--dsw-alias-bg-base` `-bg-layer-1/2` `-border-l1/l2` `-brand-primary` `-label-primary/secondary` `-state-error/success/warn-primary` |

验证环境：DSH Desktop `dsh-plugin-desktop 2.0.4` / `@deepseek-harness-tui/dsh-tui 0.10.0-beta.5`。

对不上时的表现：界面不出现 + **页面左下角一条红色提示** + 控制台 `package-learn:` 开头的日志。
临时停掉：把 profile `package.json` 的 `dsh.profile.bundles` 里那行删掉再重启（或跑 `uninstall-常驻插件.bat`）。

---

## 10. 还没做的（未决项）

| | 状态 |
|---|---|
| **D3 README 加截图** | 没做。有一张界面截图（用户给的），但左边栏会露出他的私人工作区名字，**未经同意不能进仓库** |
| **D5 客户端 bundle 加构建步骤** | 决定不做，理由见第 6 节。真要做的话，值得做的是把纯逻辑（`reviewQueue` / `studySummary` 等）拆成独立文件 |
| 已知限制 | ① "发送后自动跳转"只在学习界面生效；② 主机路由挡不住本机其它程序；③ 跨模块只有跳转没有进度合并；④ `related` 链接是人工挑的 |

---

## 11. 下次接手的最短路径（给 AI）

1. **先读这份 `CONTEXT.md`**，别急着 `glob` 整个工程。
2. 按第 0 节的表定位到那**一个**文件；`lib/client.js` 很长，用 grep 找类名/函数名再局部读。
3. 动代码前先跑一次 `node tools/check-all.mjs`，建立"基线是绿的"这个前提。
4. 改完 → 再跑一次 → 涉及样式时**提醒用户在浏览器里看一眼**（脚本看不见样式）。
5. 加内容时严格照第 4.1 节的结构写，`related` 要指向真实存在的 id。
6. **遵守用户的工作方式**：他要求"回答前先提问，一次问一个问题，追问到 95% 确信再给方案"
   （写在 `~/.dsh/AGENTS.md` 里，对所有会话有效）。别一上来就给方案。
7. **不要往 GitHub 推**，除非他明确说推。
