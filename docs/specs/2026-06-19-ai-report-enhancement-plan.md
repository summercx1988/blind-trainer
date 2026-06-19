# AI 报告呈现增强 + md 导出 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 AI 交易教练报告卡（8 维雷达图 + 卡片化点评 + Top-3 K 线嵌图）+ 导出 md 文件用于离线复盘。

**Architecture:** 3 块独立改造。块 C（md 导出）完全独立、价值最高、先做；块 B（K 线 IPC）是块 A 嵌图的依赖；块 A（UI 重设计）最后做。延续零侵入约束：现有模块代码路径不改，只追加新文件 + 在既有函数末尾追加调用。

**Tech Stack:** Electron 41 + React 19 + TypeScript 5 + better-sqlite3 + klinecharts（复用 BaseKlineChart）+ 纯 SVG（雷达图）+ vitest

**关联 spec:** [docs/specs/2026-06-19-ai-report-enhancement-design.md](../specs/2026-06-19-ai-report-enhancement-design.md)

**关键降级（已查证）**：finished session 的 K 线起点**无法精确反推**（samples 表不持久化，只存 sample_id 字符串）。本计划用 `started_at`（训练真实开始时间，秒级时间戳）作为锚点，往前取 20 根 warmup + 往后取 `max(bar_index)+10` 根。这是项目内既有的 warmup 默认值（`BlindTrainingWorkbench.tsx:587` 的 `Math.max(10, Math.min(sample.warmupBars, …))`，硬编码下限 10、典型值 20）。

---

## 文件结构

### 新建（6 个文件）

| 文件 | 职责 |
| --- | --- |
| `src/main/services/md-exporter.ts` | report→md 字符串 + 文件名构造 + 写 userData（纯函数为主） |
| `src/main/services/__tests__/md-exporter.test.ts` | md 生成 + 文件名单测 |
| `src/components/trading/ai-advisor/HabitRadarChart.tsx` | 8 维 SVG 雷达图 |
| `src/components/trading/ai-advisor/normalizeIndicators.ts` | 指标归一化纯函数（被雷达图用，可单测） |
| `src/components/trading/ai-advisor/__tests__/normalizeIndicators.test.ts` | 归一化单测 |
| `src/components/trading/ai-advisor/SessionKlineCard.tsx` | Top-3 session 嵌图卡片（折叠/展开 + 懒加载 K 线） |

### 修改（5 个文件，全部追加式）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `src/types/agent.ts` | 追加 `KlineBar` / `KlineMarker` / `SessionKlineResult` 类型 | 低 |
| `src/main/ipc/blind.ts` | `registerBlindIpc` 末尾追加 `session:getKlineForSession` handler | 低（新 handler） |
| `src/main/ipc/agentIpc.ts` | `generateReport` 成功后追加 md 导出；新增 `agent:openReportsFolder` handler | 低（追加逻辑） |
| `src/preload/index.ts` + `src/types/global.d.ts` | 加 `session.getKlineForSession` + `agent.openReportsFolder` 桥 | 低 |
| `src/components/trading/AIHabitAdvisor.tsx` | 报告区重设计：嵌雷达图 + 卡片化 + SessionKlineCard + md 状态显示 | 中（改 UI 渲染） |

---

## Task 1：md-exporter 纯函数 + 单测（块 C 核心）

**Files:**
- Create: `src/main/services/md-exporter.ts`
- Create: `src/main/services/__tests__/md-exporter.test.ts`

**Why:** spec §4.1。md 生成是纯函数，先 TDD 固化格式。

- [ ] **Step 1: 写失败测试**

Create `src/main/services/__tests__/md-exporter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { reportToMarkdown, buildReportFilename } from '../md-exporter'
import type { AdvisorReport, HabitIndicators } from '../../../types/agent'

const indicators: HabitIndicators = {
  chase_high_rate: 0.42,
  inverse_pyramid_rate: 0.3,
  stop_loss_discipline: 0.78,
  profit_loss_ratio: 1.8,
  profit_taking_timing: 0.7,
  avg_holding_bars: 7,
  avg_position_ratio: 0.35,
  result_group: { win_rate: 0.62, avg_pnl_pct: 0.052, max_drawdown_pct: 0.18, max_loss_streak: 3 },
}

const report: AdvisorReport = {
  strengths: [{ indicator: '盈亏比', value: '1.8', evidence: '优于 1.5 健康线', comment: '能严格止损' }],
  weaknesses: [{ indicator: '追涨率', value: '42%', evidence: '高于 30% 健康线', comment: '突破即追' }],
  bad_habits: [{ name: '突破即追入', severity: 'high', trigger: '看到突破立即追', fix: '等回踩 ±2%' }],
  action_plan: [{ priority: 1, action: '等回踩再入', rationale: '避免追高', expected_impact: '减少 30% 追高亏损' }],
}

const meta = { profileId: 'default', profileName: '默认存档', sessionCount: 28, model: 'MiniMax-M3', createdAt: 1718812800 }

describe('reportToMarkdown', () => {
  it('含标题、profile、模型、场次数', () => {
    const md = reportToMarkdown(report, indicators, meta)
    expect(md).toContain('# 交易习惯诊断报告')
    expect(md).toContain('MiniMax-M3')
    expect(md).toContain('默认存档')
    expect(md).toContain('28 场训练')
  })

  it('含完整指标表格 + 健康参考列', () => {
    const md = reportToMarkdown(report, indicators, meta)
    expect(md).toContain('| 追涨率 | 42% | < 30% |')
    expect(md).toContain('| 盈亏比 | 1.8 | > 1.5 |')
    expect(md).toContain('| 平均持仓 bars | 7 |')
    expect(md).toContain('| 胜率 | 62% |')
  })

  it('含 4 段点评 + 优先级编号', () => {
    const md = reportToMarkdown(report, indicators, meta)
    expect(md).toContain('## ✅ 优点')
    expect(md).toContain('**盈亏比 1.8**')
    expect(md).toContain('## ⚠️ 缺点')
    expect(md).toContain('## 🎯 不良习惯')
    expect(md).toContain('[HIGH]')
    expect(md).toContain('## 📋 改善计划')
    expect(md).toContain('1. **等回踩再入**')
  })

  it('含免责声明', () => {
    const md = reportToMarkdown(report, indicators, meta)
    expect(md).toContain('不构成投资建议')
  })
})

describe('buildReportFilename', () => {
  it('格式：时间-胜率%-profile名.md', () => {
    const name = buildReportFilename(meta, indicators)
    // createdAt=1718812800 = 2024-06-19 16:00:00 UTC = 2024-06-20 00:00 北京时间
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-胜率62%-默认存档\.md$/)
  })

  it('profile 名含非法字符时转义为下划线', () => {
    const bad = { ...meta, profileName: 'a/b:c?d' }
    const name = buildReportFilename(bad, indicators)
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name).toContain('a_b_c_d')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- md-exporter`
Expected: FAIL，`Cannot find module '../md-exporter'`

- [ ] **Step 3: 实现 md-exporter.ts**

Create `src/main/services/md-exporter.ts`:
```typescript
import type { AdvisorReport, HabitIndicators } from '../../types/agent'

export interface ReportMeta {
  profileId: string
  profileName: string
  sessionCount: number
  model: string
  createdAt: number
}

const pct = (n: number) => `${Math.round(n * 100)}%`
const num = (n: number) => n.toFixed(2)

export function reportToMarkdown(
  report: AdvisorReport,
  indicators: HabitIndicators,
  meta: ReportMeta
): string {
  const d = new Date(meta.createdAt * 1000)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  const lines: string[] = []
  lines.push('# 交易习惯诊断报告')
  lines.push('')
  lines.push(`> 生成于 ${dateStr} ${timeStr} · 模型 ${meta.model} · 基于 ${meta.sessionCount} 场训练 · profile：${meta.profileName}`)
  lines.push('')
  lines.push('## 📊 核心指标')
  lines.push('')
  lines.push('| 指标 | 数值 | 健康参考 |')
  lines.push('|---|---|---|')
  lines.push(`| 追涨率 | ${pct(indicators.chase_high_rate)} | < 30% |`)
  lines.push(`| 倒金字塔加仓率 | ${pct(indicators.inverse_pyramid_rate)} | 越低越好 |`)
  lines.push(`| 止损纪律 | ${pct(indicators.stop_loss_discipline)} | > 70% |`)
  lines.push(`| 盈亏比 | ${num(indicators.profit_loss_ratio)} | > 1.5 |`)
  lines.push(`| 止盈过早/过晚比 | ${num(indicators.profit_taking_timing)} | 0.8–1.3 为佳 |`)
  lines.push(`| 平均持仓 bars | ${num(indicators.avg_holding_bars)} | ~5 为佳（超短线） |`)
  lines.push(`| 单笔仓位占比中位数 | ${pct(indicators.avg_position_ratio)} | 越分散越好 |`)
  lines.push(`| 胜率 | ${pct(indicators.result_group.win_rate)} | — |`)
  lines.push(`| 平均盈亏 | ${pct(indicators.result_group.avg_pnl_pct)} | — |`)
  lines.push(`| 最大回撤 | ${pct(indicators.result_group.max_drawdown_pct)} | — |`)
  lines.push(`| 连损场次 | ${indicators.result_group.max_loss_streak} | 越少越好 |`)
  lines.push('')

  if (report.strengths.length > 0) {
    lines.push('## ✅ 优点')
    lines.push('')
    for (const s of report.strengths) {
      lines.push(`- **${s.indicator} ${s.value}** — ${s.evidence}。${s.comment}`)
    }
    lines.push('')
  }

  if (report.weaknesses.length > 0) {
    lines.push('## ⚠️ 缺点')
    lines.push('')
    for (const s of report.weaknesses) {
      lines.push(`- **${s.indicator} ${s.value}** — ${s.evidence}。${s.comment}`)
    }
    lines.push('')
  }

  if (report.bad_habits.length > 0) {
    lines.push('## 🎯 不良习惯')
    lines.push('')
    for (const h of report.bad_habits) {
      lines.push(`- **${h.name}** [${h.severity.toUpperCase()}]`)
      lines.push(`  - 触发：${h.trigger}`)
      if (h.evidence_session) lines.push(`  - 证据：${h.evidence_session}`)
      lines.push(`  - 建议：${h.fix}`)
    }
    lines.push('')
  }

  if (report.action_plan.length > 0) {
    lines.push('## 📋 改善计划')
    lines.push('')
    const sorted = [...report.action_plan].sort((a, b) => a.priority - b.priority)
    sorted.forEach((a, i) => {
      const line = `${i + 1}. **${a.action}** — ${a.rationale}`
      lines.push(a.expected_impact ? `${line}。预期：${a.expected_impact}` : line)
    })
    lines.push('')
  }

  lines.push('---')
  lines.push('*由盲训 AI 教练自动生成，仅供参考，不构成投资建议。*')
  lines.push('*原始数据见 app 内 AI 教练页面。*')
  return lines.join('\n')
}

export function buildReportFilename(meta: ReportMeta, indicators: HabitIndicators): string {
  const d = new Date(meta.createdAt * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const winRate = Math.round(indicators.result_group.win_rate * 100)
  const safeProfile = meta.profileName.replace(/[\\/:*?"<>|]/g, '_')
  return `${ts}-胜率${winRate}%-${safeProfile}.md`
}
```

- [ ] **Step 4: 测试通过**

Run: `npm test -- md-exporter`
Expected: 6 passed

- [ ] **Step 5: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/main/services/md-exporter.ts src/main/services/__tests__/md-exporter.test.ts
git commit -m "feat(agent): md-exporter 报告转 markdown 纯函数 + 单测

reportToMarkdown（指标表格 + 4 段点评 + 免责声明）+ buildReportFilename（时间-胜率%-profile.md）。"
```

---

## Task 2：saveReportMd 文件写入 + IPC 集成（块 C 闭环）

**Files:**
- Modify: `src/main/services/md-exporter.ts`（追加 `saveReportMd`）
- Modify: `src/main/ipc/agentIpc.ts`（`generateReport` 末尾追加 md 导出；新增 `agent:openReportsFolder`）
- Modify: `src/preload/index.ts` + `src/types/global.d.ts`（加桥）

**Why:** spec §4.3 / §4.4。把 md 生成接到报告流程里，失败不阻塞。

- [ ] **Step 1: 在 md-exporter.ts 追加 saveReportMd**

在 `src/main/services/md-exporter.ts` 顶部 import 区追加：
```typescript
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
```

在文件末尾追加：
```typescript
export function getReportsDir(): string {
  return path.join(app.getPath('userData'), 'ai-reports')
}

export function saveReportMd(filename: string, content: string): string {
  const dir = getReportsDir()
  fs.mkdirSync(dir, { recursive: true })
  const fullPath = path.join(dir, filename)
  fs.writeFileSync(fullPath, content, 'utf-8')
  return fullPath
}
```

- [ ] **Step 2: 在 agentIpc.ts 顶部追加 import**

Modify `src/main/ipc/agentIpc.ts`，在现有 import 区追加：
```typescript
import { reportToMarkdown, buildReportFilename, saveReportMd, getReportsDir } from '../services/md-exporter'
import type { AdvisorReport } from '../../types/agent'
```

并在文件顶部 `import { ipcMain } from 'electron'` 改为：
```typescript
import { ipcMain, app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
```

- [ ] **Step 3: 在 generateReport 末尾追加 md 导出**

在 `agentIpc.ts` 的 `generateReport` handler 内，紧接 `const record = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(reportId)` 之后、`if (!llmResult.ok) return fail(...)` 之前，插入：
```typescript
      // md 导出（失败不阻塞报告生成）
      let mdPath: string | null = null
      let mdError: string | null = null
      try {
        const profileRow = getDb().prepare('SELECT name FROM training_profiles WHERE id = ?').get(payload.profileId) as { name?: string } | undefined
        const profileName = profileRow?.name ?? payload.profileId
        const nowSec = Math.floor(Date.now() / 1000)
        const reportMeta = { profileId: payload.profileId, profileName, sessionCount: habitProfile.session_count, model: config.model, createdAt: nowSec }
        const mdContent = reportToMarkdown(parsed.report as AdvisorReport, habitProfile.indicators, reportMeta)
        const filename = buildReportFilename(reportMeta, habitProfile.indicators)
        mdPath = saveReportMd(filename, mdContent)
      } catch (e) {
        mdError = String(e)
        log.error('[agent] md export failed:', e)
      }
```

然后把最后的 `return ok(record)` 改为：
```typescript
      if (!llmResult.ok) return fail(llmResult.error || 'llm_failed', `LLM 调用失败：${llmResult.error}`)
      return ok({ ...(record as Record<string, unknown>), md_path: mdPath, md_error: mdError })
```

- [ ] **Step 4: 新增 agent:openReportsFolder handler**

在 `agentIpc.ts` 的 `registerAgentIpc` 函数内，紧接最后一个 `ipcMain.handle('agent:getHabitHistory', ...)` 之后追加：
```typescript
  ipcMain.handle('agent:openReportsFolder', async () => {
    try {
      const dir = getReportsDir()
      fs.mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
      return { success: true }
    } catch (error) {
      log.error('[agent] openReportsFolder ERROR:', error)
      return { success: false, error: String(error) }
    }
  })
```

- [ ] **Step 5: preload 加桥**

Modify `src/preload/index.ts`，在 `agent:` 命名空间末尾（`getHabitHistory` 之后）追加：
```typescript
    openReportsFolder: (): Promise<{ success: boolean; error?: string }> =>
      invoke('agent:openReportsFolder'),
```

- [ ] **Step 6: global.d.ts 加类型**

Modify `src/types/global.d.ts`，在 `agent?` 命名空间内 `getHabitHistory` 之后追加：
```typescript
        openReportsFolder: () => Promise<{ success: boolean; error?: string }>
```

- [ ] **Step 7: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 8: Commit**

```bash
git add src/main/services/md-exporter.ts src/main/ipc/agentIpc.ts src/preload/index.ts src/types/global.d.ts
git commit -m "feat(agent): generateReport 集成 md 导出 + openReportsFolder IPC

报告生成成功后自动写 userData/ai-reports/*.md，失败不阻塞。
新增 agent:openReportsFolder 用 shell.openPath 在 Finder 打开目录。"
```

---

## Task 3：UI 显示 md 状态（块 C UI）

**Files:**
- Modify: `src/components/trading/AIHabitAdvisor.tsx`

**Why:** spec §4.4。报告元信息栏显示导出文件名 + 打开文件夹按钮。

- [ ] **Step 1: ReportRecord 类型加 md 字段**

Modify `src/components/trading/AIHabitAdvisor.tsx`，在 `interface ReportRecord` 内追加两个字段：
```typescript
  md_path: string | null
  md_error: string | null
```

- [ ] **Step 2: 报告元信息栏追加 md 显示**

在 `AIHabitAdvisor.tsx` 找到 `<div className="ai-habit-advisor-report-meta">` 那一段，在其内部（现有"生成于…tokens"那一行之后）追加：
```tsx
            {(report.md_path || report.md_error) && (
              <div className="ai-habit-advisor-report-md">
                {report.md_path ? (
                  <>
                    已导出：{report.md_path.split('/').pop()}{' '}
                    <button
                      className="ai-habit-advisor-link-btn"
                      onClick={() => window.electronAPI?.agent?.openReportsFolder()}
                    >
                      打开文件夹
                    </button>
                  </>
                ) : (
                  <span className="ai-habit-advisor-error">md 导出失败：{report.md_error}</span>
                )}
              </div>
            )}
```

- [ ] **Step 3: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: 手动验证（npm run dev）**

启动 app → AI 教练 → 配置好 key → 生成 AI 报告 → 确认：
- 报告元信息栏出现"已导出：xxx.md"
- 点"打开文件夹"在 Finder 打开 ai-reports 目录
- 目录里有对应 md 文件，用 Typora/VSCode 打开格式正确

- [ ] **Step 5: Commit**

```bash
git add src/components/trading/AIHabitAdvisor.tsx
git commit -m "feat(agent): 报告卡显示 md 导出状态 + 打开文件夹按钮"
```

---

## Task 4：指标归一化纯函数 + 单测（块 A.1 基础）

**Files:**
- Create: `src/components/trading/ai-advisor/normalizeIndicators.ts`
- Create: `src/components/trading/ai-advisor/__tests__/normalizeIndicators.test.ts`

**Why:** spec §2.1。雷达图需要 0–1 归一化值。先 TDD 固化算法。

- [ ] **Step 1: 写失败测试**

Create `src/components/trading/ai-advisor/__tests__/normalizeIndicators.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { normalizeIndicators } from '../normalizeIndicators'
import type { HabitIndicators } from '../../../../types/agent'

const mk = (overrides: Partial<HabitIndicators> = {}): HabitIndicators => ({
  chase_high_rate: 0.4,
  inverse_pyramid_rate: 0.3,
  stop_loss_discipline: 0.7,
  profit_loss_ratio: 1.5,
  profit_taking_timing: 1.0,
  avg_holding_bars: 5,
  avg_position_ratio: 0.3,
  result_group: { win_rate: 0.5, avg_pnl_pct: 0, max_drawdown_pct: 0, max_loss_streak: 0 },
  ...overrides,
})

describe('normalizeIndicators', () => {
  it('返回 8 个 0..1 的健康度值', () => {
    const r = normalizeIndicators(mk())
    expect(r).toHaveLength(8)
    for (const v of r) {
      expect(v.value).toBeGreaterThanOrEqual(0)
      expect(v.value).toBeLessThanOrEqual(1)
    }
  })

  it('追涨率越低健康度越高', () => {
    const high = normalizeIndicators(mk({ chase_high_rate: 0.8 }))
    const low = normalizeIndicators(mk({ chase_high_rate: 0.1 }))
    expect(low[0].value).toBeGreaterThan(high[0].value)
    expect(low[0].value).toBeCloseTo(0.9, 5)
  })

  it('盈亏比 2 视为满分 1.0', () => {
    const r = normalizeIndicators(mk({ profit_loss_ratio: 2 }))
    const profitLossItem = r.find(i => i.key === 'profit_loss_ratio')!
    expect(profitLossItem.value).toBe(1)
  })

  it('持仓节奏 5 bars 最佳（健康度 1.0）', () => {
    const r = normalizeIndicators(mk({ avg_holding_bars: 5 }))
    const holdingItem = r.find(i => i.key === 'avg_holding_bars')!
    expect(holdingItem.value).toBe(1)
  })

  it('持仓节奏 20+ bars 健康度接近 0', () => {
    const r = normalizeIndicators(mk({ avg_holding_bars: 25 }))
    const holdingItem = r.find(i => i.key === 'avg_holding_bars')!
    expect(holdingItem.value).toBeLessThanOrEqual(0.05)
  })

  it('止盈时机 1.3+ 满分，0.5 最差', () => {
    const best = normalizeIndicators(mk({ profit_taking_timing: 1.3 }))
    const worst = normalizeIndicators(mk({ profit_taking_timing: 0.5 }))
    const bestItem = best.find(i => i.key === 'profit_taking_timing')!
    const worstItem = worst.find(i => i.key === 'profit_taking_timing')!
    expect(bestItem.value).toBe(1)
    expect(worstItem.value).toBe(0)
  })

  it('每项含 label 与原始值字符串', () => {
    const r = normalizeIndicators(mk({ chase_high_rate: 0.42 }))
    expect(r[0].label).toBe('追涨率')
    expect(r[0].raw).toBe('42%')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- normalizeIndicators`
Expected: FAIL，`Cannot find module '../normalizeIndicators'`

- [ ] **Step 3: 实现 normalizeIndicators.ts**

Create `src/components/trading/ai-advisor/normalizeIndicators.ts`:
```typescript
import type { HabitIndicators } from '../../../types/agent'

export interface NormalizedDimension {
  key: string
  label: string
  value: number       // 0..1 健康度
  raw: string         // 原始值展示
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const pct = (n: number) => `${Math.round(n * 100)}%`

export function normalizeIndicators(ind: HabitIndicators): NormalizedDimension[] {
  return [
    { key: 'chase_high_rate', label: '追涨率', value: clamp01(1 - ind.chase_high_rate), raw: pct(ind.chase_high_rate) },
    { key: 'inverse_pyramid_rate', label: '倒金字塔', value: clamp01(1 - ind.inverse_pyramid_rate), raw: pct(ind.inverse_pyramid_rate) },
    { key: 'stop_loss_discipline', label: '止损纪律', value: clamp01(ind.stop_loss_discipline), raw: pct(ind.stop_loss_discipline) },
    { key: 'profit_loss_ratio', label: '盈亏比', value: clamp01(ind.profit_loss_ratio / 2), raw: ind.profit_loss_ratio.toFixed(2) },
    { key: 'profit_taking_timing', label: '止盈时机', value: clamp01((ind.profit_taking_timing - 0.5) / 0.8), raw: ind.profit_taking_timing.toFixed(2) },
    { key: 'avg_holding_bars', label: '持仓节奏', value: clamp01(1 - Math.abs(ind.avg_holding_bars - 5) / 15), raw: ind.avg_holding_bars.toFixed(1) },
    { key: 'avg_position_ratio', label: '仓位控制', value: clamp01(1 - ind.avg_position_ratio), raw: pct(ind.avg_position_ratio) },
    { key: 'win_rate', label: '综合胜率', value: clamp01(ind.result_group.win_rate), raw: pct(ind.result_group.win_rate) },
  ]
}
```

- [ ] **Step 4: 测试通过**

Run: `npm test -- normalizeIndicators`
Expected: 7 passed

- [ ] **Step 5: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/components/trading/ai-advisor/normalizeIndicators.ts src/components/trading/ai-advisor/__tests__/
git commit -m "feat(agent): normalizeIndicators 8 维归一化纯函数 + 单测

持仓节奏最佳值 5 bars（超短线偏好），盈亏比满分 2，止盈时机 0.5-1.3 映射 0-1。"
```

---

## Task 5：HabitRadarChart SVG 雷达图（块 A.1）

**Files:**
- Create: `src/components/trading/ai-advisor/HabitRadarChart.tsx`

**Why:** spec §2.1。纯 SVG 8 边形雷达图。

- [ ] **Step 1: 创建组件**

Create `src/components/trading/ai-advisor/HabitRadarChart.tsx`:
```tsx
import { normalizeIndicators } from './normalizeIndicators'
import type { HabitIndicators } from '../../../types/agent'

interface HabitRadarChartProps {
  indicators: HabitIndicators
  size?: number
}

export default function HabitRadarChart({ indicators, size = 280 }: HabitRadarChartProps) {
  const dims = normalizeIndicators(indicators)
  const center = size / 2
  const maxRadius = size / 2 - 60
  const n = dims.length
  const angleStep = (Math.PI * 2) / n

  const pointAt = (i: number, radius: number) => {
    const angle = -Math.PI / 2 + i * angleStep
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    }
  }

  const dataPoints = dims.map((d, i) => pointAt(i, maxRadius * d.value))
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ')

  const axisEnds = dims.map((_, i) => pointAt(i, maxRadius))
  const gridLevels = [0.25, 0.5, 0.75, 1.0]
  const gridPolygons = gridLevels.map(level =>
    dims.map((_, i) => {
      const p = pointAt(i, maxRadius * level)
      return `${p.x},${p.y}`
    }).join(' ')
  )

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="habit-radar-chart">
      {gridPolygons.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="rgba(123,140,171,0.15)" strokeWidth={1} />
      ))}
      {axisEnds.map((p, i) => (
        <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="rgba(123,140,171,0.2)" strokeWidth={1} />
      ))}
      <polygon points={dataPolygon} fill="rgba(220,38,38,0.25)" stroke="#dc2626" strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#dc2626" />
      ))}
      {dims.map((d, i) => {
        const labelPos = pointAt(i, maxRadius + 22)
        return (
          <g key={d.key}>
            <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#7b8cab">
              {d.label}
            </text>
            <text x={labelPos.x} y={labelPos.y + 13} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#505b73">
              {d.raw}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 2: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/trading/ai-advisor/HabitRadarChart.tsx
git commit -m "feat(agent): HabitRadarChart 纯 SVG 8 维雷达图

红色填充表示弱点，8 个顶点带 label + 原始值标注。无新依赖。"
```

---

## Task 6：类型 + K 线 IPC（块 B）

**Files:**
- Modify: `src/types/agent.ts`（追加类型）
- Modify: `src/main/ipc/blind.ts`（追加 handler）
- Modify: `src/preload/index.ts` + `src/types/global.d.ts`（加桥）

**Why:** spec §3。按需拉 session 的 K 线 OHLCV + markers。用 `started_at` 锚点 + warmup=20 + max_bar+10 降级（samples 不持久化）。

- [ ] **Step 1: types/agent.ts 追加类型**

Modify `src/types/agent.ts`，在文件末尾追加：
```typescript
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
  note?: string
}
```

- [ ] **Step 2: 在 blind.ts 顶部 import 区确认已有 getDb/getBlindDb**

确认 `src/main/ipc/blind.ts` 顶部已 `import { getBlindDb } from '../blindDb'` 和 `import { getDb } from '../db'`（v1 已有，无需改）。

- [ ] **Step 3: 在 blind.ts 末尾追加 handler**

在 `registerBlindIpc` 函数体内，紧接 `registerAgentIpc()` 调用之前，追加：
```typescript
  ipcMain.handle('session:getKlineForSession', async (_, payload: { sessionId: string }) => {
    try {
      const blindDb = getBlindDb()
      const marketDb = getDb()
      const session = blindDb.prepare(`
        SELECT id, stock_code, interval_type, started_at
        FROM training_sessions WHERE id = ?
      `).get(payload.sessionId) as { id: string; stock_code: string; interval_type: string; started_at: number } | undefined
      if (!session) return fail('session_not_found', '找不到 session')

      const actions = blindDb.prepare(`
        SELECT bar_index, action_type, price FROM trade_actions
        WHERE session_id = ? AND action_type IN ('buy','sell') AND price IS NOT NULL
        ORDER BY bar_index ASC
      `).all(payload.sessionId) as Array<{ bar_index: number; action_type: 'buy' | 'sell'; price: number }>

      if (actions.length === 0) {
        return ok({ bars: [], markers: [], note: '该 session 无买卖动作' })
      }

      const maxBar = Math.max(...actions.map(a => a.bar_index))
      const WARMUP = 20
      const TAIL_BUFFER = 10
      const totalBars = WARMUP + maxBar + TAIL_BUFFER

      // 降级：用 started_at（训练真实开始时间）作为 K 线终点锚点，
      // 往前取 totalBars 根。samples 表不持久化起点，无法精确反推 warmup 区间。
      const anchorDate = new Date(session.started_at * 1000)
      const endDate = anchorDate.toISOString().slice(0, 10)

      const klines = marketDb.prepare(`
        SELECT trade_date, open, high, low, close, volume
        FROM kline_daily
        WHERE code = ? AND trade_date <= ?
        ORDER BY trade_date DESC
        LIMIT ?
      `).all(session.stock_code, endDate, totalBars) as Array<{
        trade_date: string; open: number; high: number; low: number; close: number; volume: number
      }>

      const bars = klines.reverse().map((k, i) => ({
        timestamp: new Date(k.trade_date + 'T00:00:00+08:00').getTime() / 1000,
        open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0,
      }))

      // bar_index 是相对 warmup 起点的偏移；映射到 bars 数组的实际下标
      const markers = actions
        .map(a => ({
          barIndex: WARMUP + a.bar_index,
          actionType: a.action_type,
          price: a.price,
        }))
        .filter(m => m.barIndex < bars.length)

      return ok({
        bars,
        markers,
        note: bars.length < totalBars
          ? `仅取到 ${bars.length} 根 K 线（期望 ${totalBars}），可能因上市较晚`
          : undefined,
      })
    } catch (error) {
      log.error('[session] getKlineForSession ERROR:', error)
      return fail('kline_query_failed', String(error))
    }
  })
```

- [ ] **Step 4: preload 加桥**

Modify `src/preload/index.ts`，在 `electronAPI` 对象内（`data:` 命名空间之后、`agent:` 之前 或 在末尾均可）追加：
```typescript
  session: {
    getKlineForSession: (sessionId: string): Promise<unknown> =>
      invoke('session:getKlineForSession', { sessionId }),
  },
```

- [ ] **Step 5: global.d.ts 加类型**

Modify `src/types/global.d.ts`，在 `electronAPI` 类型内追加（与 `agent?` 同级）：
```typescript
      session?: {
        getKlineForSession: (sessionId: string) => Promise<unknown>
      }
```

- [ ] **Step 6: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add src/types/agent.ts src/main/ipc/blind.ts src/preload/index.ts src/types/global.d.ts
git commit -m "feat(agent): session:getKlineForSession IPC 按需拉 K 线

降级实现：samples 表不持久化起点，改用 started_at 锚点 + warmup=20 + tail=10。
markers 的 bar_index 映射到 bars 数组实际下标（warmup + 原 bar_index）。"
```

---

## Task 7：SessionKlineCard 组件（块 A.3）

**Files:**
- Create: `src/components/trading/ai-advisor/SessionKlineCard.tsx`

**Why:** spec §2.3。Top-3 session 折叠卡片，展开时懒加载 K 线并嵌入 BaseKlineChart。

- [ ] **Step 1: 创建组件**

Create `src/components/trading/ai-advisor/SessionKlineCard.tsx`:
```tsx
import { useState } from 'react'
import BaseKlineChart, { type BaseKlineBar, type BaseMarker } from '../blind/BaseKlineChart'
import type { RepresentativeSession, SessionKlineResult } from '../../../types/agent'

interface SessionKlineCardProps {
  session: RepresentativeSession
  defaultExpanded?: boolean
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

export default function SessionKlineCard({ session, defaultExpanded = false }: SessionKlineCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SessionKlineResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExpand = async () => {
    if (!expanded && !result) {
      setLoading(true)
      setError(null)
      try {
        // RepresentativeSession 暂没存 sessionId，需要从外部传入或扩展类型
        // 这里假设通过 session.stock_code + 已知信息反查；实际需 IPC 支持
        // 见 Task 6 备注：需在 RepresentativeSession 加 sessionId 字段
        const r = await window.electronAPI?.session?.getKlineForSession((session as RepresentativeSession & { sessionId: string }).sessionId)
        const data = r && typeof r === 'object' && (r as { success?: boolean }).success === true
          ? (r as { data: SessionKlineResult }).data
          : null
        if (data) {
          setResult(data)
        } else {
          setError((r as { error?: { message?: string } })?.error?.message ?? '加载失败')
        }
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    setExpanded(!expanded)
  }

  const bars: BaseKlineBar[] = (result?.bars ?? []).map(b => ({
    timestamp: b.timestamp,
    open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }))
  const markers: BaseMarker[] = (result?.markers ?? []).map(m => ({
    barIndex: m.barIndex, actionType: m.actionType, price: m.price,
  }))

  return (
    <div className="session-kline-card">
      <div className="session-kline-card-header" onClick={handleExpand}>
        <span className="session-kline-card-title">
          {session.stock_name} {session.stock_code}
        </span>
        <span className="session-kline-card-meta">
          盈亏 {fmtPct(session.realized_pnl_pct)} · {session.total_trades} 笔
        </span>
        <span className="session-kline-card-toggle">{expanded ? '▲ 收起' : '▼ 展开 K 线'}</span>
      </div>
      {expanded && (
        <div className="session-kline-card-body">
          {loading && <div className="session-kline-card-loading">加载 K 线中...</div>}
          {error && <div className="session-kline-card-error">{error}</div>}
          {result && result.bars.length > 0 && (
            <>
              <div style={{ height: 320 }}>
                <BaseKlineChart data={bars} markers={markers} minHeight={300} />
              </div>
              {result.note && <div className="session-kline-card-note">{result.note}</div>}
            </>
          )}
          {result && result.bars.length === 0 && (
            <div className="session-kline-card-note">{result.note ?? '无 K 线数据'}</div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: RepresentativeSession 类型加 sessionId**

Modify `src/types/agent.ts`，在 `RepresentativeSession` 接口内追加一个字段：
```typescript
export interface RepresentativeSession {
  sessionId: string
  stock_code: string
  // ... 其余不变
```

- [ ] **Step 3: ai-advisor.ts 的 selectRepresentativeSessions 补 sessionId**

Modify `src/main/services/ai-advisor.ts`，在 `toRep` 函数返回对象里加 `sessionId: s.id`：
```typescript
    return {
      sessionId: s.id,
      stock_code: s.stock_code,
      // ... 其余不变
```

- [ ] **Step 4: 修 Task 7 Step 1 的类型断言**

把 SessionKlineCard 里的 `(session as RepresentativeSession & { sessionId: string }).sessionId` 改为直接 `session.sessionId`（因为类型已加字段）：
```tsx
        const r = await window.electronAPI?.session?.getKlineForSession(session.sessionId)
```

- [ ] **Step 5: 更新 ai-advisor 测试 fixture（补 sessionId）**

Modify `src/main/services/__tests__/ai-advisor.test.ts`，在 `selectRepresentativeSessions` 测试的断言里，确认返回的对象含 `sessionId`（已有测试用 `result.map(r => r.stock_name)`，类型变了 tsc 会过，但加一条断言更稳）：
在 "返回 1 盈 + 2 亏" 的 `it` 内末尾追加：
```typescript
    expect(result.every(r => typeof r.sessionId === 'string')).toBe(true)
```

- [ ] **Step 6: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 7: 全测通过**

Run: `npm test`
Expected: 全部 pass（含新增的 sessionId 断言）

- [ ] **Step 8: Commit**

```bash
git add src/components/trading/ai-advisor/SessionKlineCard.tsx src/types/agent.ts src/main/services/ai-advisor.ts src/main/services/__tests__/ai-advisor.test.ts
git commit -m "feat(agent): SessionKlineCard 折叠式 K 线嵌图卡片

默认折叠，展开时懒加载 session:getKlineForSession，复用 BaseKlineChart。
RepresentativeSession 加 sessionId 字段。"
```

---

## Task 8：报告区重设计 —— 嵌入雷达图 + 卡片化 + SessionKlineCard（块 A 闭环）

**Files:**
- Modify: `src/components/trading/AIHabitAdvisor.tsx`

**Why:** spec §2。把 Task 5/7 的新组件接入报告卡，同时点评段卡片化。

- [ ] **Step 1: 顶部加 import**

Modify `src/components/trading/AIHabitAdvisor.tsx`，在文件顶部 import 区追加：
```tsx
import HabitRadarChart from './ai-advisor/HabitRadarChart'
import SessionKlineCard from './ai-advisor/SessionKlineCard'
import type { RepresentativeSession } from '../../types/agent'
```

- [ ] **Step 2: 状态加 representativeSessions**

在 `AIHabitAdvisor` 组件内，已有的 state 声明区（`const [report, setReport]` 附近）追加：
```tsx
  const [repSessions, setRepSessions] = useState<RepresentativeSession[]>([])
```

- [ ] **Step 3: handleGenerateReport 内拿到 repSessions**

在 `handleGenerateReport` 内，`const data = unwrap<ReportRecord>(r)` 之后追加（从后端返回拿不到 repSessions，需在生成报告时另存）。更简单的做法：在 `generateReport` 的 IPC 返回里带上 repSessions。

Modify `src/main/ipc/agentIpc.ts` 的 `generateReport`，在 `return ok({ ...(record as Record<string, unknown>), md_path, md_error })` 改为：
```typescript
      return ok({ ...(record as Record<string, unknown>), md_path: mdPath, md_error: mdError, representative_sessions: repSessions })
```

（`repSessions` 变量在该 handler 内已存在，是 `selectRepresentativeSessions` 的返回值）

- [ ] **Step 4: handleGenerateReport 接收 repSessions**

回到 `AIHabitAdvisor.tsx` 的 `handleGenerateReport`，在 `if (data) { setReport(data) }` 改为：
```tsx
      if (data) {
        setReport(data)
        const rs = (data as ReportRecord & { representative_sessions?: RepresentativeSession[] }).representative_sessions
        if (rs) setRepSessions(rs)
      }
```

并在 `ReportRecord` interface 末尾加可选字段：
```tsx
  representative_sessions?: RepresentativeSession[]
```

- [ ] **Step 5: 报告区 JSX 重构**

在 `AIHabitAdvisor.tsx` 找到 `{report && (...)` 那一段 `<section className="ai-habit-advisor-report">`，在 `<h3>AI 诊断报告</h3>` 之后、`<div className="ai-habit-advisor-report-meta">` 之前插入雷达图：
```tsx
          {habit && (
            <div className="ai-habit-advisor-radar-wrap">
              <HabitRadarChart indicators={habit.indicators} />
            </div>
          )}
```

然后在报告 4 段（strengths/weaknesses/bad_habits/action_plan）的 `<ul>`/`<ol>` 上，把 className 从 `ai-habit-report-section--good/warn/bad` 保留（已有），无需改结构 —— CSS 卡片化在 Task 9 处理。

在 4 段之后、`</section>` 之前，追加 Top-3 K 线卡片区：
```tsx
          {repSessions.length > 0 && (
            <div className="ai-habit-advisor-sessions">
              <h4>代表性交易（Top-3）</h4>
              {repSessions.map((s, i) => (
                <SessionKlineCard key={i} session={s} />
              ))}
            </div>
          )}
```

- [ ] **Step 6: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 7: vite build 通过**

Run: `npx vite build`
Expected: 无错误，产出 AIHabitAdvisor chunk

- [ ] **Step 8: 手动验证（npm run dev）**

启动 app → AI 教练 → 生成报告 → 确认：
- 报告顶部出现 8 维雷达图（红色填充）
- 点评 4 段保持显示
- 底部出现 Top-3 session 卡片，默认折叠
- 点击某张卡片"展开 K 线" → 出现 K 线图 + buy/sell 菱形标注
- md 导出状态 + 打开文件夹按钮仍在

- [ ] **Step 9: Commit**

```bash
git add src/components/trading/AIHabitAdvisor.tsx src/main/ipc/agentIpc.ts
git commit -m "feat(agent): 报告区嵌入雷达图 + Top-3 K线卡 + 返回 representative_sessions

generateReport 返回值带 representative_sessions，UI 渲染雷达图 + SessionKlineCard。"
```

---

## Task 9：CSS 卡片化（块 A.2 视觉收尾）

**Files:**
- Modify: `src/App.css`（或项目主样式文件，追加新 class）

**Why:** spec §2.2。点评段从朴素列表升级为带色彩左边框的卡片。零侵入 —— 只追加新 class，不改现有。

- [ ] **Step 1: 追加 CSS**

在项目主 CSS 文件末尾（确认是 `src/App.css` 或 `src/index.css`，实施时 `grep -rn "ai-habit-report-section" src/` 定位）追加：
```css
.ai-habit-report-section {
  margin: 12px 0;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(123, 140, 171, 0.05);
}
.ai-habit-report-section--good { border-left: 4px solid #16a34a; }
.ai-habit-report-section--warn { border-left: 4px solid #f59e0b; }
.ai-habit-report-section--bad  { border-left: 4px solid #dc2626; }
.ai-habit-report-section h4 { margin-top: 0; }
.ai-habit-report-section li { margin: 6px 0; line-height: 1.6; }

.ai-habit-advisor-radar-wrap {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}
.habit-radar-chart { max-width: 100%; }

.ai-habit-advisor-sessions { margin-top: 20px; }
.session-kline-card {
  border: 1px solid rgba(123, 140, 171, 0.2);
  border-radius: 8px;
  margin: 8px 0;
  overflow: hidden;
}
.session-kline-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  background: rgba(123, 140, 171, 0.05);
}
.session-kline-card-title { font-weight: 600; }
.session-kline-card-meta { color: #7b8cab; font-size: 13px; }
.session-kline-card-toggle { margin-left: auto; color: #505b73; font-size: 13px; }
.session-kline-card-body { padding: 8px 14px 14px; }
.session-kline-card-loading, .session-kline-card-error, .session-kline-card-note {
  padding: 12px; color: #7b8cab; font-size: 13px;
}
.session-kline-card-error { color: #dc2626; }

.ai-habit-advisor-report-md { margin-top: 6px; font-size: 13px; color: #505b73; }
.ai-habit-advisor-link-btn {
  background: none; border: none; color: #2563eb; cursor: pointer;
  text-decoration: underline; padding: 0; font-size: 13px;
}
```

- [ ] **Step 2: tsc 通过（CSS 不影响 tsc，但跑一下确认没意外）**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: 手动验证视觉**

Run: `npm run dev` → 生成报告 → 确认：
- 优点段绿色左边框、缺点黄色、不良习惯红色
- 雷达图居中
- session 卡片有边框、header 可点击、展开有过渡

- [ ] **Step 4: Commit**

```bash
git add src/App.css
git commit -m "style(agent): 报告卡 CSS 卡片化 + 雷达图/session 卡片样式"
```

---

## Task 10：git 同步 + 全量回归

**Files:** 无（仅验证 + push）

- [ ] **Step 1: 全测通过**

Run: `npm test`
Expected: 全部 pass（含 md-exporter 6 + normalizeIndicators 7 + ai-advisor 原 7+1 = 21+）

- [ ] **Step 2: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: vite build 通过**

Run: `npx vite build`
Expected: 无错误

- [ ] **Step 4: 工作区干净**

Run: `git status -s`
Expected: 空（或仅 untracked 的 scripts/ 旧改动，不属本次任务）

- [ ] **Step 5: push**

Run: `git push origin main`
Expected: 推送成功（若网络问题，参考之前诊断：本机需代理访问 github.com）

---

## 回归测试清单（每个任务后都该跑）

- [ ] `npx tsc -b --noEmit` 无错误
- [ ] `npm test` 全绿
- [ ] 现有 AI 教练功能（无 K 线时）仍正常 —— 不破坏 v1

---

## 风险点

1. **Task 6 K 线降级**：用 `started_at` 锚点反推 warmup 区间是已知降级（samples 不持久化）。若用户训练时实际 warmup ≠ 20，K 线左边缘会偏。但 buy/sell 标注的相对位置正确，足够支撑 AI 点评的"你在 bar X 追高"这类反馈。
2. **Task 7 BaseKlineChart 复用**：该组件原本为工作台设计，在 320px 高度的小卡片里可能需要调整。Task 9 CSS 已设 minHeight=300，若仍有问题，可在 SessionKlineCard 调 size。
3. **Task 8 generateReport 返回值膨胀**：加了 `representative_sessions` 字段，每份报告多带 Top-3 的动作序列（约 1–2KB）。可接受。
4. **md 文件名时区**：`buildReportFilename` 用本地时间（`new Date(createdAt*1000).getHours()`），与 DB 存的 UTC 秒级时间戳一致 —— 用户看到的文件名时间 = 本地时间，符合直觉。
