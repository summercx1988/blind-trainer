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
    expect(md).toContain('| 盈亏比 | 1.80 | > 1.5 |')
    expect(md).toContain('| 平均持仓 bars | 7.00 |')
    expect(md).toContain('| 胜率 | 62% |')
  })

  it('含 4 段点评 + 优先级编号', () => {
    const md = reportToMarkdown(report, indicators, meta)
    expect(md).toContain('## 优点')
    expect(md).toContain('**盈亏比 1.8**')
    expect(md).toContain('## 待改进')
    expect(md).toContain('## 不良习惯')
    expect(md).toContain('[HIGH]')
    expect(md).toContain('## 改善计划')
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
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-胜率62%-默认存档\.md$/)
  })

  it('profile 名含非法字符时转义为下划线', () => {
    const bad = { ...meta, profileName: 'a/b:c?d' }
    const name = buildReportFilename(bad, indicators)
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name).toContain('a_b_c_d')
  })
})
