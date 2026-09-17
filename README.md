# 芯片封装学习 · dsh 插件

一个装在 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 里的**芯片封装学习插件**：
左侧栏多一个入口，点开就进一个专属学习界面——顶部是真实工艺流程的工序按钮，左边是知识点树，右边是带剖面图和小测的正文，
底下的输入框还是 dsh 原生那个，随时能问 AI。

> **状态**：阶段一（动态插件）已完成并可用；阶段二（常驻插件）待做。详见[路线图](#路线图)。

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
├─ .gitignore                 ← 排除个人学习进度
├─ content/                   ← 课程内容
│  ├─ tracks.json             ← 课程地图：三条主线、每道工序、内容文件位置、是否已写好
│  ├─ traditional/            ← 传统封装各工序（芯片级流程）
│  │  └─ 04-wire-bonding.json ← 【已完成】引线键合：6 个细分点 / 18 道小测题
│  ├─ advanced/               ← 先进封装（晶圆级流程）
│  └─ topics/                 ← 专题模块（封装形式 / 材料 / 设备 / 可靠性 / 术语）
├─ knowledge/
│  └─ points.json             ← 知识点库：每个细分点的全局唯一 id（跨线共用时进度互通）
├─ assets/
│  └─ wb-cross-section.svg    ← 剖面图等配图
├─ progress/                  ← 学习进度（本机私有，不进仓库，见其中 README）
└─ plugin/                    ← 插件源码（host.js / client.js，见其中 README）
```

---

## 快速开始

**⚠️ 现在还不能「下载即用」**——插件是阶段一的动态形态，需要 dsh 里的 Agent 帮忙装载。
完整的装载说明写在 [`plugin/README.md`](plugin/README.md)。

简述：

1. 把本仓库放到 `D:\Dsh_WorkSpace\Package_Learn_Plug_In`
   （或改 `plugin/host.js` 顶部的 `ROOT` 常量指向你放的位置）
2. 在 dsh 里让 Agent 用 `cordis_define` 把 `plugin/host.js` 和 `plugin/client.js` 分别作为
   `code.host` / `code.client` 传入，再用 `cordis_run` 激活（首次需在界面上点一次「允许」）
3. 点左侧栏最下方的 **📚 芯片封装学习** 进入学习会话
4. 点会话标题下方的 **「📚 进入学习界面」** 标签（点过一次会按会话记住）

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

### 知识点 id 与进度互通

每个细分点的 `id` 是**全局唯一**的（例如 `wb.principle`）。
如果同一个知识点同时出现在多条线里（比如「塑封材料」在传统封装和专题模块里都有），
在两条线里**用同一个 id** 即可 —— 进度会自动互通，一边标了已掌握，另一边跟着亮。

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
- [ ] **阶段二 · 常驻插件** —— 打包成正式 web 插件包，装一次就一直在（不再每次重启重新激活）
- [ ] **阶段二附带** —— 数据根目录改成可配置；错误与加载状态收尾
- [ ] **内容铺满** —— 传统封装剩下七道工序
- [ ] **内容铺满** —— 先进封装：Bumping / WLCSP / Fan-out / TSV / 2.5D-3D / Chiplet
- [ ] **内容铺满** —— 专题模块：封装形式分类 / 封装材料 / 设备 / 可靠性测试 / 行业术语

---

## 已知限制

1. **数据根目录是写死的**（`plugin/host.js` 顶部的 `ROOT`）。换位置要改这一行。
2. **动态插件重启即失效**：dsh 一重启就要重新激活一次（阶段二解决）。
3. **「发送后自动跳转」只在学习界面里生效**：用的是 dsh 只发给当前激活视图的接口。
4. 只有「引线键合」一道工序有内容。

---

## 许可

课程内容供学习参考；工艺参数给的是**典型值**，实际以各自产线的工艺规范为准。
