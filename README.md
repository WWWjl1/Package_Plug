# 芯片封装学习 · dsh 插件

一个装在 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 里的**芯片封装学习插件**：
左侧栏多一个入口，点开就进一个专属学习界面——顶部是真实工艺流程的工序按钮，左边是知识点树，右边是带剖面图和小测的正文，
底下的输入框还是 dsh 原生那个，随时能问 AI。

> **状态**：**已完整可用**。19 个模块 / 114 个细分点 / 450 道小测题 / 19 张剖面图，三条主线全亮。
> 插件是常驻的 web 插件包，装一次就一直在。逐项待办见 [`TODO.md`](TODO.md)。

---

## 界面长什么样

```
┌──────────────────────────────────────────────────────┐
│ [传统封装流程][先进封装][专题模块]          ← 三条主线  │
│ [减薄][划片][装片][◤引线键合◢][塑封][植球]  ← 工序按钮  │
├────────────┬─────────────────────────────────────────┤
│ ▾ 传统封装  │  键合原理：金属丝为什么能焊在铝焊盘上     │
│   晶圆减薄  │  ─────────────────────────────────────  │
│   引线键合  │  正文 · 表格 · SVG 剖面图 · 重点框        │
│     ◐ 键合原理│  小测 3 题（全对自动标记已掌握）         │
│     ○ 丝材选择│  ── 问 AI：[举个例子][没懂][考试怎么问]  │
│     ○ 键合机 │                                         │
├────────────┴─────────────────────────────────────────┤
│  dsh 原生输入框 —— 回车发送后自动跳到「对话」界面看答案  │
└──────────────────────────────────────────────────────┘
```

`✓` 已掌握 · `◐` 在学 · `○` 未学

---

## 仓库结构

```
Package_Plug/
├─ README.md                  ← 你正在看的这个
├─ TODO.md                    ← 逐项待办与进度勾选
├─ LICENSE                    ← MIT
├─ package.json               ← 插件包声明（dsh.bundle.patch + dsh.client）
├─ cordis.patch.yml           ← 挂载行（想换数据目录就改这里的 config.root）
├─ lib/                       ← ★ 插件本体（常驻版）
│  ├─ index.js                ← 主机半：HTTP 路由 /package-learn/api + 10 个方法
│  └─ client.js               ← 客户端半：侧栏入口 + 学习界面（三个槽位）
├─ content/                   ← 课程内容（19 个模块，约 1 MB JSON）
│  ├─ tracks.json             ← 课程地图：三条主线、每道工序、内容文件位置、是否已写好
│  ├─ traditional/            ← 传统封装 8 道工序（减薄 / 划片 / 装片 / 键合 / 塑封 / 植球 / 切筋 / 测试）
│  ├─ advanced/               ← 先进封装 6 个模块（Bumping / WLCSP / Fan-out / TSV / 堆叠 / Chiplet）
│  └─ topics/                 ← 专题模块 5 个（封装形式 / 材料 / 设备 / 可靠性 / 术语）
├─ knowledge/
│  └─ points.json             ← 知识点库：114 个细分点的全局唯一 id
├─ assets/                    ← 19 张剖面图 / 示意图（SVG，内联进界面）
├─ progress/                  ← 学习进度（本机私有，不进仓库，见其中 README）
├─ uninstall-常驻插件.bat      ← 一键卸载 / 回滚
└─ plugin/                    ← ⚠️ 阶段一遗留源码，已废弃，仅作参考
```

---

## 安装（常驻版）

插件已经是正式的 dsh web 插件包，**装一次就一直在**——不需要每次重启后重新激活，也不需要再点授权。

### 1. 放到任意位置

```powershell
git clone https://github.com/WWWjl1/Package_Plug.git D:\Dsh_WorkSpace\Package_Learn_Plug_In
```

**不需要配置路径**：插件用 `import.meta.url` 自定位，**插件包目录本身就是课程数据目录**，
clone 到哪都能用。

### 2. 挂到 dsh 的 profile

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$src     = "D:\Dsh_WorkSpace\Package_Learn_Plug_In"   # 换成你的实际路径

# 建目录链接：profile 直接指向仓库，改了仓库就等于改了插件
cmd /c mklink /J "$profile\node_modules\dsh-package-learn" "$src"
```

然后编辑 `$profile\package.json`，加两处：

```jsonc
{
  "dependencies": {
    "dsh-package-learn": "file:D:/Dsh_WorkSpace/Package_Learn_Plug_In"   // ← 加这行（路径换成你的）
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "……",
        "dsh-package-learn"                                              // ← 加这行
      ]
    }
  }
}
```

### 3. 重启 dsh

之后每次开 dsh 都会自动加载。

### 4. 开始学

1. 点左侧栏最下方的 **📚 芯片封装学习** 进学习会话
2. 点会话标题下方的 **「📚 进入学习界面」** 标签（点过一次会按会话记住）
3. 读完正文，直接在底部输入框提问——**回车发送后会自动跳到「对话」界面看答案**

### 卸载

双击仓库里的 `uninstall-常驻插件.bat`（建议先复制一份到桌面备用）。它会移除 bundle 注册、
依赖和目录链接，**不碰你的课程内容和学习进度**。

### 想换课程目录的位置

编辑 `cordis.patch.yml`，取消 `config.root` 的注释并填绝对路径：

```yaml
- insert:
    - id: package-learn
      name: 'dsh-package-learn'
      config:
        root: 'D:\你的路径'
```

---

## 课程数据结构

课程内容全在 `content/` 下的 JSON 里，**加内容不用改一行代码**。

### `content/tracks.json` — 课程地图

```json
{
  "tracks": [
    {
      "id": "traditional",
      "title": "传统封装流程",
      "hint": "芯片级：先把晶圆切成一颗颗芯片，再逐颗组装",
      "processes": [
        { "id": "wire-bonding", "title": "引线键合", "file": "traditional/04-wire-bonding.json", "status": "ready" },
        { "id": "molding",      "title": "塑封",     "file": "traditional/05-molding.json",     "status": "planned" }
      ]
    }
  ]
}
```

`status: ready` 的工序才会被加载；`planned` 是占位（按钮会显示成灰的「待补」）。

### 一道工序 —— `content/traditional/04-wire-bonding.json`

```json
{
  "id": "wire-bonding",
  "track": "traditional",
  "title": "引线键合",
  "subtitle": "把芯片上的焊盘和封装引脚用一根比头发还细的金属丝连起来",
  "points": [
    {
      "id": "wb.principle",
      "title": "键合原理：金属丝为什么能焊在铝焊盘上",
      "estMinutes": 8,
      "body": [
        { "type": "p",       "text": "正文段落" },
        { "type": "h",       "text": "小标题" },
        { "type": "list",    "items": ["要点一", "要点二"] },
        { "type": "table",   "head": ["列1", "列2"], "rows": [["a", "b"]] },
        { "type": "figure",  "svg": "wb-cross-section.svg", "caption": "图注" },
        { "type": "callout", "tone": "key",  "text": "重点框（tone 也可以是 warn）" }
      ],
      "quiz": [
        { "q": "题目", "options": ["A", "B", "C", "D"], "answer": 1, "explain": "解析" }
      ]
    }
  ]
}
```

`body` 支持这六种块，顺序随意、可重复。

### 知识点 id 与「相关知识点」

每个细分点的 `id` 是**全局唯一**的（例如 `wt.grind`）。

**同一条知识出现在多个模块时，不要共用 id。** 这是刻意的：
`wb.materials`（键合里的紫斑 / Kirkendall）、`mt.imc`（材料学的 √(k·t)）、
`rl.hts`（150 °C 长烤的 Arrhenius 加速因子）看起来都是「IMC」，
但其实讲的是三件不同的事。共用 id 会让「学过紫斑」被当成「学过 IMC 动力学」，
进度就变成假的了。CTE 失配、共面性、MSL 爆米花、浴盆曲线、DNP 同理。

模块之间要串起来，用这个字段：

```json
{
  "id": "wt.methods",
  "title": "减薄手段全景：Taiko、DBG、临时键合各自的适用边界",
  "related": ["dc.dbg", "wt.stress"]
}
```

界面上会在正文下面多出一行「**这个概念在别的模块也讲过：**」，
每颗按钮显示 `模块名 · 知识点名`，点一下直接跳过去（只跳转，不动进度）。

- 可以只写单向；想双向就两边都写。
- 指向不存在的 id、或指向自己，「课程自检」都会报错（否则那颗按钮会静默消失，很难查）。
- 目前 **65 个知识点带关联，共 128 条链接，其中跨模块 121 条**。

对应关系登记在 `knowledge/points.json`。

---

## 学习进度

进度存在 `progress/`（**本机私有，不进仓库**）：

- `state.json` —— 每个知识点的状态（未学 / 在学 / 已掌握）
- `quiz.json` —— 小测作答流水 + 错题本
- `session.json` —— 固定学习会话的 id
- `ui.json` —— 界面状态

想清空重来，删掉前两个即可。细节见 [`progress/README.md`](progress/README.md)。

---

## 路线图

- [x] **阶段一 · 动态插件** —— 侧栏入口、学习界面、工序切换、知识树、正文与剖面图、小测与进度、问 AI
- [x] **阶段二 · 常驻插件** —— 打包成正式 web 插件包，装一次就一直在
- [x] **阶段二附带** —— 数据目录改为自定位（`import.meta.url`），不再硬编码
- [x] **内容铺满** —— 传统封装 8 道工序
- [x] **内容铺满** —— 先进封装：Bumping / WLCSP / Fan-out / TSV / 2.5D-3D / Chiplet
- [x] **内容铺满** —— 专题模块：封装形式分类 / 封装材料 / 设备 / 可靠性测试 / 行业术语
- [x] **跨模块串联** —— 知识点之间的「相关」跳转（`related` 字段 + 界面按钮）
- [x] **深度统一** —— 全部内容提升到第 3 档（面试拷问级）：可计算的公式与数量级、
      「为什么不能反过来做」的反向论证、30 秒失效链案例、面试追问预判

> 逐项待办与进度勾选见 **[`TODO.md`](TODO.md)**。

---

## 改完之后怎么生效

| 改的是哪个文件 | 怎么生效 |
|---|---|
| `lib/client.js`（界面） | 在 dsh 页面 **Ctrl + Shift + R** 硬刷新 |
| `lib/index.js`（主机 / 读盘 / 自检逻辑） | **重启 dsh**（主机半是启动时加载进内存的，改磁盘不会重载） |
| `content/` `assets/`（课程内容） | 刷新页面即可（每次打开学习界面都会重新读） |
| `cordis.patch.yml` `package.json`（挂载与包声明） | **重启 dsh** |

---

## 适配的 dsh 版本

本插件写的时候对着这套环境验证过：

| 组件 | 版本 |
|---|---|
| DSH Desktop（Electron 壳） | `dsh-plugin-desktop` **2.0.4** |
| profile 里的 dsh 运行时 | `@deepseek-harness-tui/dsh-tui` **0.10.0-beta.5** |
| 本插件 | `0.2.0` |

它依赖的 dsh 接口面**只有下面这些**，dsh 大版本升级后如果界面「什么都不出现」，先查这几处：

| 用到的 | 名字 | 用在哪 |
|---|---|---|
| 主机服务 | `webServer.register({kind:'exact',path,handler})` | 注册 `/package-learn/api` |
| 主机服务（可选） | `workspaceRegistry.resolveByPath` / `.create` | 「进入学习会话」时复用同一个工作区 |
| 客户端服务 | `slots` | 登记三个槽位 |
| 客户端服务（点击时才取） | `sessions`（`.open`）、`uiWorkspace`（`.connectWorkspace` / `.startSession`） | 回到固定学习会话 |
| 槽位名 | `sidebar.footer.action` | 左侧栏最下方的常驻入口 |
| 槽位名 | `conversation.view` | 顶栏的「📚 进入学习界面」标签 |
| 槽位名 | `conversation.input.dock` | 学习会话里的一次性提示 |
| 客户端模块加载器 | `window.__ModuleLoader__.load({id, factory})` | `lib/client.js` 的包装形式 |
| 主题变量 | `--dsw-alias-*`（bg / border / label / brand / state） | 界面配色跟随 dsh 主题 |

**名字对不上时怎么办**：插件不会让 dsh 崩——最坏情况是界面不出现。
挂载失败时**页面左下角会出现一条红色提示**说明原因（`slots` 服务取不到、登记槽位报错等），
同时在浏览器控制台有 `package-learn:` 开头的错误日志。想临时停掉它，
把 profile `package.json` 的 `dsh.profile.bundles` 里那行删掉再重启即可（见[卸载](#卸载)）。

---

## 已知限制

1. **「发送后自动跳转」只在学习界面里生效**：用的是 dsh 只发给当前激活视图的接口；
   在原生对话界面里提问本来就不需要跳。
2. **主机路由只挡住了浏览器跨站，挡不住本机其它程序**：`Host` 不是回环地址、或 `Origin`
   是外部网页的请求会直接 403（防 CSRF 与 DNS rebinding），但同一个本机进程仍可直接调用
   `127.0.0.1:43120/package-learn/api`。彻底堵住需要密钥，而密钥在浏览器里藏不住，
   所以这里只做到「网页碰不到」。它也只暴露固定方法表，不能任意读写文件。
3. **跨模块只有跳转，没有进度合并**：这是刻意的决定，理由见[上文](#知识点-id-与相关知识点)。
   如果你以后觉得「同一个概念在哪儿学都该算学过」，那要改的是数据模型，不是几个 id。
4. **`related` 链接是人工挑的，不是自动算的**：新增内容时得自己挂，否则那个知识点就没有
   关联行（界面上不显示空行，不会难看，但也就串不起来）。
5. `plugin/` 目录是阶段一的遗留源码，**已废弃**，仅作参考。

---

## 许可

课程内容供学习参考；工艺参数给的是**典型值**，实际以各自产线的工艺规范为准。
