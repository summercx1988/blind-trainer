# AI 报告呈现增强 + md 导出 设计 v1.0

> 状态：已确认决策（2026-06-19）
> 目的：优化 AI 交易教练报告卡的呈现（K 线嵌图 + 雷达图 + 卡片化），并支持导出 md 文件用于离线复盘
> 前置：[2026-06-18-ai-habit-advisor-design.md](./2026-06-18-ai-habit-advisor-design.md)（v1 已实现）
> 范围：盲训子系统 AI 教练模块增强

---

## 0. 决策汇总

| 维度 | 选择 |
| --- | --- |
| K 线图深度 | Top-3 代表性 session 嵌图 + 8 指标雷达图 |
| K 线数据来源 | 新增 IPC `session:getKlineForSession` 按需拉 |
| 复盘形式 | DB + md 文件双写（DB 已有，新增 md） |
| md 存放位置 | `userData/ai-reports/`（macOS: `~/Library/Application Support/blind-trainer/ai-reports/`） |
| md 文件名 | `{YYYY-MM-DD-HHmmss}-{胜率Y%}-{profile名}.md` |
| 雷达图持仓节奏最佳值 | 5 bars（超短线偏好） |
| K 线嵌图默认状态 | 折叠（点击展开） |

---

## 1. 架构（3 块独立改造）

```
┌─ 块 A：报告卡重设计（UI）─────────────────────────┐
│ AIHabitAdvisor.tsx 报告区改造                       │
│   ├ 顶部：8 指标雷达图（新 HabitRadarChart）         │
│ ├ 点评段：优/缺/坏习惯/计划 卡片化（改 CSS）         │
│ └ Top-3 session 嵌图：新 SessionKlineCard           │
│     └ 复用 BaseKlineChart                           │
└─────────────────────────────────────────────────────┘
                       ↓ 依赖
┌─ 块 B：K 线 IPC ───────────────────────────────────┐
│ 新增 session:getKlineForSession                      │
│   入参 sessionId → 后端 join kline_daily → OHLCV[]   │
│ preload + global.d.ts 加桥                          │
└─────────────────────────────────────────────────────┘

┌─ 块 C：md 导出（独立）─────────────────────────────┐
│ 新增 service md-exporter.ts                          │
│   reportToMarkdown(report, indicators, meta) → str  │
│   saveReportMd(filename, content) → 写 userData       │
│ agentIpc.generateReport 成功后调用一次               │
│ 新增 IPC agent:openReportsFolder（shell.openPath）   │
│ UI 加"打开报告文件夹"按钮                            │
└─────────────────────────────────────────────────────┘
```

**分块理由**：A 依赖 B（嵌图需 K 线数据），C 完全独立。三块可分别测、分别提交。零侵入约束延续：现有模块代码路径不改。

---

## 2. 块 A：报告卡重设计

### 2.1 雷达图 HabitRadarChart

8 维纯 SVG 雷达图，把 8 个指标归一化到 0–1（**健康度，越高越好**）。

#### 归一化算法（纯函数 `normalizeIndicators`）

| 维度 | 归一化公式 | 说明 |
| --- | --- | --- |
| 追涨率 | `1 - chase_high_rate` | 追涨越少越健康 |
| 倒金字塔加仓 | `1 - inverse_pyramid_rate` | 越少越健康 |
| 止损纪律 | `stop_loss_discipline` | 已是 0–1 |
| 盈亏比 | `min(profit_loss_ratio / 2, 1)` | 2 视为满分 |
| 止盈时机 | `clamp((timing - 0.5) / 0.8, 0, 1)` | 0.5 最差，1.3+ 满分 |
| 持仓节奏 | `1 - abs(avg_holding_bars - 5) / 15` | **5 bars 最佳**（超短线偏好），20+ 视为 0 |
| 仓位控制 | `1 - avg_position_ratio` | 越分散越健康 |
| 综合胜率 | `result_group.win_rate` | 已是 0–1 |

`clamp(x, 0, 1)` = `Math.min(1, Math.max(0, x))`。

#### 实现

- **纯 SVG**（不引新库），8 边形雷达
- 8 个顶点对应 8 维，半径正比于健康度
- 红色半透明填充（`rgba(220, 38, 38, 0.25)`）+ 红色描边
- 每个顶点外侧标注维度名 + 原始值（如 "追涨率 42%"）
- 接收 `HabitIndicators`，输出 SVG element

**为什么纯 SVG**：比 klinecharts 轻，可单测（纯函数算坐标），雷达图不需要交互。

### 2.2 点评段卡片化

把现有 `<ul>`/`<ol>` 升级为带左边框色彩的卡片：

```
┌ ✅ 优点（绿色左边框 #16a34a）─────────────┐
│ 盈亏比 1.8                                │
│ 证据：优于 1.5 的健康线                    │
│ AI：你能在亏损单上严格止损…                │
└────────────────────────────────────────────┘
┌ ⚠️ 缺点（黄色左边框 #f59e0b）─────────────┐
│ 追涨率 42%                                │
│ 证据：高于 30% 健康线                      │
└────────────────────────────────────────────┘
┌ 🎯 不良习惯（红色左边框 #dc2626 + severity 角标）┐
│ 突破即追入 [HIGH]                          │
│ 触发：看到突破信号立即追入…                │
│ → 建议：等回踩 ±2%…                        │
└────────────────────────────────────────────┘
┌ 📋 改善计划（带优先级数字圆圈 ①②③）──────┐
│ ① 等回踩 ±2% 再入                         │
│   理由：… 预期：减少 30% 追高亏损          │
└────────────────────────────────────────────┘
```

通过 CSS class 区分，不改数据结构。

### 2.3 Top-3 session 嵌图 SessionKlineCard

```
┌ 中远海控 600029 · 盈亏 -7% · 5 笔交易 ────┐
│                              [▼ 展开 K 线] │
└────────────────────────────────────────────┘
点击展开后：
┌ 中远海控 600029 · 盈亏 -7% · 5 笔交易 ────┐
│                              [▲ 收起]      │
│        [BaseKlineChart 嵌入]               │
│        K 线 + buy/sell 菱形标注             │
│        自动滚动到首笔 buy 位置              │
│                                            │
│ AI 关联点评：你在 bar 12 追高买入…          │
└────────────────────────────────────────────┘
```

- **默认折叠**（避免一进页面拉 3 张图）
- 展开时调 `session:getKlineForSession` 拉 K 线，传给 `BaseKlineChart`
- 同时传 buy/sell markers（从 `selectRepresentativeSessions` 已有的 actions 转换）
- 折叠时不发 IPC（懒加载）

---

## 3. 块 B：K 线 IPC

### 3.1 新增 IPC handler

在 `src/main/ipc/blind.ts` 的 `registerBlindIpc` 内追加（不动现有 handler）：

```typescript
ipcMain.handle('session:getKlineForSession', async (_, payload: { sessionId: string }) => {
  try {
    const db = getBlindDb()
    const marketDb = getDb()
    // 1. 查 session 元信息
    const session = db.prepare(`
      SELECT id, stock_code, interval_type, started_at
      FROM training_sessions WHERE id = ?
    `).get(payload.sessionId) as SessionMeta | undefined
    if (!session) return fail('session_not_found', '找不到 session')

    // 2. 查该 session 的所有 trade_actions，确定 bar_index 范围 + 生成 markers
    const actions = db.prepare(`
      SELECT bar_index, action_type, price FROM trade_actions
      WHERE session_id = ? AND action_type IN ('buy','sell') AND price IS NOT NULL
      ORDER BY bar_index ASC
    `).all(payload.sessionId) as ActionMeta[]
    if (actions.length === 0) return ok({ bars: [], markers: [] })

    // 3. 从 kline_daily 取该 session 训练区间的 OHLCV
    //    起点 = session 样本起点（从 session 字段反推）
    //    终点 = 起点 + 最大 bar_index + 10 根缓冲（露出最后几笔动作的后续走势）
    const bars = querySessionKline(marketDb, session, maxBarIndex(actions))
    const markers = actions.map(a => ({ barIndex: a.bar_index, actionType: a.action_type, price: a.price }))
    return ok({ bars, markers })
  } catch (error) {
    log.error('[session] getKlineForSession ERROR:', error)
    return fail('kline_query_failed', String(error))
  }
})
```

### 3.2 session 起点反推（关键，需先验证表结构）

`querySessionKline` 需要知道 session 的 K 线起点。**实现前必须先查 `training_sessions` 表结构**，确认是否有以下任一字段：
- `start_date` / `sample_start_date`（直接日期）
- `sample_id`（关联 samples 表）
- `start_bar_index` + 全局 K 线偏移

如果都没有，降级方案：**用 `started_at`（训练开始时间戳）+ stock_code，取该日期前 N=120 根 K 线**（假设训练区间约 120 个交易日）。降级路径在代码注释中标明。

### 3.3 类型

```typescript
// src/types/agent.ts 追加
export interface KlineBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export interface KlineMarker {
  barIndex: number
  actionType: 'buy' | 'sell'
  price: number
}
export interface SessionKlineResult {
  bars: KlineBar[]
  markers: KlineMarker[]
}
```

`BaseKlineChart` 已接受 `BaseKlineBar`（结构相同）+ `BaseMarker`（结构相同），可直接传。

---

## 4. 块 C：md 导出

### 4.1 md-exporter.ts（纯函数）

```typescript
// src/main/services/md-exporter.ts
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { AdvisorReport, HabitIndicators } from '../../types/agent'

export interface ReportMeta {
  profileId: string
  profileName: string
  sessionCount: number
  model: string
  createdAt: number
}

export function reportToMarkdown(
  report: AdvisorReport,
  indicators: HabitIndicators,
  meta: ReportMeta
): string {
  // 生成完整 md 字符串（见 §4.2 格式）
}

export function buildReportFilename(meta: ReportMeta, indicators: HabitIndicators): string {
  const d = new Date(meta.createdAt * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const winRate = Math.round(indicators.result_group.win_rate * 100)
  const safeProfile = meta.profileName.replace(/[\\/:*?"<>|]/g, '_')
  return `${ts}-胜率${winRate}%-${safeProfile}.md`
}

export function saveReportMd(filename: string, content: string): string {
  const dir = path.join(app.getPath('userData'), 'ai-reports')
  fs.mkdirSync(dir, { recursive: true })
  const fullPath = path.join(dir, filename)
  fs.writeFileSync(fullPath, content, 'utf-8')
  return fullPath
}
```

### 4.2 md 格式

```markdown
# 交易习惯诊断报告

> 生成于 2026-06-19 23:59 · 模型 MiniMax-M3 · 基于 28 场训练 · profile：默认存档

## 📊 核心指标

| 指标 | 数值 | 健康参考 |
|---|---|---|
| 追涨率 | 42% | < 30% |
| 倒金字塔加仓率 | 30% | 越低越好 |
| 止损纪律 | 78% | > 70% |
| 盈亏比 | 1.8 | > 1.5 |
| 止盈过早/过晚比 | 0.7 | 0.8–1.3 为佳 |
| 平均持仓 bars | 7 | ~5 为佳（超短线） |
| 单笔仓位占比中位数 | 35% | 越分散越好 |
| 胜率 | 62% | — |
| 平均盈亏 | 5.2% | — |
| 最大回撤 | 18% | — |
| 连损场次 | 3 | 越少越好 |

## ✅ 优点

- **盈亏比 1.8** — 优于 1.5 的健康线。你能在亏损单上严格止损…

## ⚠️ 缺点

- **追涨率 42%** — 高于 30% 健康线…

## 🎯 不良习惯

- **突破即追入** [HIGH]
  - 触发：看到突破信号立即追入，未等回踩
  - 建议：等回踩 ±2% 或量能确认后再入

## 📋 改善计划

1. **等回踩 ±2% 再入** — 避免追在最高 5%。预期：减少 30% 追高亏损
2. ...

---
*由盲训 AI 教练自动生成，仅供参考，不构成投资建议。*
*原始数据见 app 内 AI 教练页面。*
```

**为什么表格用 markdown 表格**：所有 md 渲染器（Typora/Obsidian/VSCode）都支持，复制到笔记软件格式不丢。

### 4.3 IPC 集成

修改 `agent:generateReport`（agentIpc.ts）：成功生成报告 + 写 DB 后，**追加一步**：

```typescript
// 写 DB 成功后
let mdPath: string | null = null
let mdError: string | null = null
try {
  const profileName = (getDb().prepare('SELECT name FROM training_profiles WHERE id = ?').get(payload.profileId) as { name?: string } | undefined)?.name ?? payload.profileId
  const mdContent = reportToMarkdown(parsed.report as AdvisorReport, habitProfile.indicators, {
    profileId: payload.profileId,
    profileName,
    sessionCount: habitProfile.session_count,
    model: config.model,
    createdAt: now,
  })
  const filename = buildReportFilename({ profileId: payload.profileId, profileName, sessionCount: habitProfile.session_count, model: config.model, createdAt: now }, habitProfile.indicators)
  mdPath = saveReportMd(filename, mdContent)
} catch (e) {
  mdError = String(e)
  log.error('[agent] md export failed:', e)
}
// 返回结果多带 md_path / md_error
```

新增 IPC：

```typescript
ipcMain.handle('agent:openReportsFolder', async () => {
  const { shell } = await import('electron')
  const dir = path.join(app.getPath('userData'), 'ai-reports')
  fs.mkdirSync(dir, { recursive: true })
  await shell.openPath(dir)
  return { success: true }
})
```

### 4.4 UI 显示

报告元信息栏追加：

```
生成于 2026-06-19 23:59 · MiniMax-M3 · 4.2k tokens
已导出：2026-06-19-23591-胜率62%-默认存档.md [打开文件夹]
```

若 `md_error` 非空：`md 导出失败：{error} [重试]`。

### 4.5 错误处理

md 写入失败（磁盘满/权限）**不阻塞**报告生成：
- DB 已写成功 → UI 照常显示报告
- 只在元信息栏标"md 导出失败"
- 不影响 LLM 调用、不影响指标展示

---

## 5. 测试策略

| 单元 | 测什么 | 类型 |
| --- | --- | --- |
| `normalizeIndicators` | 8 维归一化，边界（0/极大值/持仓 5 最佳）| 纯函数单测 |
| `reportToMarkdown` | 喂 mock report，断言 md 含表格、各段标题、指标行、免责声明 | 纯函数单测 |
| `buildReportFilename` | 时间格式、胜率百分比、profile 名转义（含非法字符）| 纯函数单测 |
| `saveReportMd` | 写临时目录，断言文件存在 + 内容正确 | 集成测试（tmpdir） |
| K 线 IPC | 手动验证（better-sqlite3 原生模块，单测难） | 手动 |
| 卡片化 CSS | 手动验证视觉 | 手动 |

---

## 6. 上线节奏（建议）

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 块 C：md-exporter + IPC + UI 按钮 | 生成报告后能在 Finder 看到 md 文件 |
| P2 | 块 B：K 线 IPC | 调用返回 OHLCV + markers |
| P3 | 块 A.2：点评段卡片化（CSS 为主） | 视觉升级 |
| P4 | 块 A.1：HabitRadarChart | 雷达图渲染正确 |
| P5 | 块 A.3：SessionKlineCard 嵌图 | Top-3 可展开看 K 线 |

建议先做 C（独立、价值高），再做 B，最后 A。

---

## 7. 不做的事（YAGNI）

- ❌ 报告版本对比 UI（"和上次报告 diff"）—— v1 只导出 md，对比留给用户的笔记软件
- ❌ md 里嵌 K 线图（ASCII/图片）—— 复杂度高、价值低，K 线图留在 app 内看
- ❌ md 模板可配置 —— 固定模板，够用
- ❌ 导出 PDF —— v2
- ❌ 雷达图交互（hover tooltip）—— 静态展示足够
- ❌ K 线嵌图里加 benchmark 对比线 —— 复用现有 markers 即可，不加新维度

---

## 8. 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| session 起点反推不准（表结构缺字段） | 实现前先查表；降级用 `started_at` 前 N 根 K 线 |
| 雷达图归一化阈值主观（盈亏比满分 2、持仓最佳 5） | 阈值集中在 `normalizeIndicators` 内，易调；初始值基于超短线偏好 |
| md 文件名含特殊字符导致 fs 错误 | `buildReportFilename` 转义 `[\\/:*?"<>|]` 为 `_` |
| userData 路径隐蔽用户找不到 | UI 加"打开报告文件夹"按钮，`shell.openPath` 跳 Finder |
| BaseKlineChart 在小卡片里渲染异常（高度不够） | SessionKlineCard 设 minHeight=300，展开时才 init |

---

## 9. 相关链接

- v1 设计：[2026-06-18-ai-habit-advisor-design.md](./2026-06-18-ai-habit-advisor-design.md)
- 现有 K 线组件：[src/components/trading/blind/BaseKlineChart.tsx](../../src/components/trading/blind/BaseKlineChart.tsx)
- 现有报告卡：[src/components/trading/AIHabitAdvisor.tsx](../../src/components/trading/AIHabitAdvisor.tsx)
- 现有 IPC：[src/main/ipc/agentIpc.ts](../../src/main/ipc/agentIpc.ts)
