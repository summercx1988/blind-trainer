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
  lines.push('## 核心指标')
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
    lines.push('## 优点')
    lines.push('')
    for (const s of report.strengths) {
      lines.push(`- **${s.indicator} ${s.value}** — ${s.evidence}。${s.comment}`)
    }
    lines.push('')
  }

  if (report.weaknesses.length > 0) {
    lines.push('## 待改进')
    lines.push('')
    for (const s of report.weaknesses) {
      lines.push(`- **${s.indicator} ${s.value}** — ${s.evidence}。${s.comment}`)
    }
    lines.push('')
  }

  if (report.bad_habits.length > 0) {
    lines.push('## 不良习惯')
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
    lines.push('## 改善计划')
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
