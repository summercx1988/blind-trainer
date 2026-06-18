import { useEffect, useState, useCallback } from 'react'
import AiAdvisorSettings from './blind-workbench/AiAdvisorSettings'
import type { HabitIndicators } from '../../types/agent'

interface HabitProfileRecord {
  id: string
  computed_at: number
  session_count: number
  indicators: HabitIndicators
}

interface ReportRecord {
  id: string
  report_json: string
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  duration_ms: number | null
  error: string | null
  created_at: number
}

const isPlatformOk = (r: unknown): r is { data: unknown } =>
  typeof r === 'object' && r !== null && (r as { success?: boolean }).success === true

const unwrap = <T,>(r: unknown): T | null => (isPlatformOk(r) ? ((r as { data: T }).data) : null)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`
const fmtNum = (n: number) => n.toFixed(2)

export default function AIHabitAdvisor() {
  const [profileId, setProfileId] = useState<string>('default')
  const [configReady, setConfigReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [habit, setHabit] = useState<HabitProfileRecord | null>(null)
  const [history, setHistory] = useState<HabitProfileRecord[]>([])
  const [report, setReport] = useState<ReportRecord | null>(null)
  const [loadingHabit, setLoadingHabit] = useState(false)
  const [loadingReport, setLoadingReport] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)

  const loadInit = useCallback(async () => {
    const active = await window.electronAPI?.profile?.getActive() as { id?: string } | undefined
    if (active?.id) setProfileId(active.id)
    const cfg = await window.electronAPI?.agent?.getConfig()
    setConfigReady(Boolean(cfg?.ready))
    const hist = unwrap<HabitProfileRecord[]>(await window.electronAPI?.agent?.getHabitHistory(active?.id ?? 'default', 10)) ?? []
    setHistory(hist)
    if (hist.length > 0) {
      setHabit(hist[0])
      const reports = unwrap<ReportRecord[]>(await window.electronAPI?.agent?.listReports(active?.id ?? 'default', 1)) ?? []
      if (reports.length > 0 && !reports[0].error) setReport(reports[0])
    }
  }, [])

  useEffect(() => { void loadInit() }, [loadInit])

  const handleAnalyze = async () => {
    setLoadingHabit(true)
    setError(null)
    try {
      const r = await window.electronAPI?.agent?.analyzeHabits(profileId)
      const data = unwrap<HabitProfileRecord>(r)
      if (data) {
        setHabit(data)
        const hist = unwrap<HabitProfileRecord[]>(await window.electronAPI?.agent?.getHabitHistory(profileId, 10)) ?? []
        setHistory(hist)
      } else {
        setError((r as { error?: { message?: string } })?.error?.message ?? '分析失败')
      }
    } finally {
      setLoadingHabit(false)
    }
  }

  const handleGenerateReport = async (force: boolean) => {
    if (!habit) return
    setLoadingReport(true)
    setReportError(null)
    try {
      const r = await window.electronAPI?.agent?.generateReport({
        profileId,
        habitProfileId: habit.id,
        force,
      })
      const data = unwrap<ReportRecord>(r)
      if (data) {
        setReport(data)
      } else {
        setReportError((r as { error?: { message?: string } })?.error?.message ?? '生成失败')
      }
    } finally {
      setLoadingReport(false)
    }
  }

  const prevHabit = history.length > 1 ? history[1] : null
  const trendChase = (prevHabit && habit) ? habit.indicators.chase_high_rate - prevHabit.indicators.chase_high_rate : null
  const trendWin = (prevHabit && habit) ? habit.indicators.result_group.win_rate - prevHabit.indicators.result_group.win_rate : null

  const parsedReport = report ? (() => {
    try { return JSON.parse(report.report_json) } catch { return null }
  })() : null

  return (
    <div className="ai-habit-advisor">
      <div className="ai-habit-advisor-toolbar">
        {prevHabit && habit && (
          <div className="ai-habit-advisor-trend">
            {trendChase !== null && (
              <span>追涨率 {trendChase > 0 ? '▲' : '▼'} {fmtPct(Math.abs(trendChase))} </span>
            )}
            {trendWin !== null && (
              <span>胜率 {trendWin > 0 ? '▲' : '▼'} {fmtPct(Math.abs(trendWin))}</span>
            )}
            <span className="ai-habit-advisor-trend-label">vs 上次</span>
          </div>
        )}
        <button onClick={handleAnalyze} disabled={loadingHabit}>
          {loadingHabit ? '分析中...' : habit ? '重新分析' : '生成诊断'}
        </button>
        <button
          onClick={() => handleGenerateReport(false)}
          disabled={loadingReport || !habit || !configReady}
          title={report ? '优先读缓存；若无缓存则重新生成' : '生成 AI 报告'}
        >
          {loadingReport ? '生成报告中...' : report ? '刷新报告' : '生成 AI 报告'}
        </button>
        <button
          onClick={() => handleGenerateReport(true)}
          disabled={loadingReport || !habit || !configReady}
          title="强制重新调用 LLM（不计缓存）"
        >
          强制重生
        </button>
        <button onClick={() => setShowSettings(s => !s)}>
          {showSettings ? '收起配置' : 'AI 配置'}
        </button>
      </div>

      {showSettings && <AiAdvisorSettings onSaved={() => { void loadInit(); setShowSettings(false) }} />}

      {error && <div className="ai-habit-advisor-error">{error}</div>}
      {!configReady && !showSettings && (
        <div className="ai-habit-advisor-warning">
          ⚠️ 未配置 AI 助手，无法生成 AI 报告（本地指标仍可查看）。
          <button onClick={() => setShowSettings(true)}>去配置</button>
        </div>
      )}

      {habit && (
        <section className="ai-habit-advisor-indicators">
          <h3>习惯指标（基于 {habit.session_count} 场训练）</h3>
          <div className="ai-habit-advisor-indicator-grid">
            <div className="ai-habit-card"><span>追涨率</span><strong>{fmtPct(habit.indicators.chase_high_rate)}</strong></div>
            <div className="ai-habit-card"><span>倒金字塔加仓率</span><strong>{fmtPct(habit.indicators.inverse_pyramid_rate)}</strong></div>
            <div className="ai-habit-card"><span>止损纪律</span><strong>{fmtPct(habit.indicators.stop_loss_discipline)}</strong></div>
            <div className="ai-habit-card"><span>盈亏比</span><strong>{fmtNum(habit.indicators.profit_loss_ratio)}</strong></div>
            <div className="ai-habit-card"><span>止盈过早/过晚比</span><strong>{fmtNum(habit.indicators.profit_taking_timing)}</strong></div>
            <div className="ai-habit-card"><span>平均持仓 bars</span><strong>{fmtNum(habit.indicators.avg_holding_bars)}</strong></div>
            <div className="ai-habit-card"><span>单笔仓位占比中位数</span><strong>{fmtPct(habit.indicators.avg_position_ratio)}</strong></div>
            <div className="ai-habit-card">
              <span>胜率 / 平均盈亏 / 最大回撤 / 连损场次</span>
              <strong>
                {fmtPct(habit.indicators.result_group.win_rate)} / {fmtPct(habit.indicators.result_group.avg_pnl_pct)} /{' '}
                {fmtPct(habit.indicators.result_group.max_drawdown_pct)} / {habit.indicators.result_group.max_loss_streak}
              </strong>
            </div>
          </div>
        </section>
      )}

      {report && (
        <section className="ai-habit-advisor-report">
          <h3>AI 诊断报告</h3>
          <div className="ai-habit-advisor-report-meta">
            生成于 {new Date(report.created_at * 1000).toLocaleString('zh-CN')}
            {report.model ? ` · ${report.model}` : ''}
            {report.prompt_tokens != null ? ` · ${report.prompt_tokens + (report.completion_tokens ?? 0)} tokens` : ''}
          </div>
          {parsedReport && !('fallback_text' in parsedReport) ? (
            <>
              {parsedReport.strengths?.length > 0 && (
                <div className="ai-habit-report-section ai-habit-report-section--good">
                  <h4>✅ 优点</h4>
                  <ul>{parsedReport.strengths.map((s: { indicator: string; value: string; evidence: string; comment: string }, i: number) => (
                    <li key={i}><strong>{s.indicator} {s.value}</strong> — {s.evidence} {s.comment}</li>
                  ))}</ul>
                </div>
              )}
              {parsedReport.weaknesses?.length > 0 && (
                <div className="ai-habit-report-section ai-habit-report-section--warn">
                  <h4>⚠️ 缺点</h4>
                  <ul>{parsedReport.weaknesses.map((s: { indicator: string; value: string; evidence: string; comment: string }, i: number) => (
                    <li key={i}><strong>{s.indicator} {s.value}</strong> — {s.evidence} {s.comment}</li>
                  ))}</ul>
                </div>
              )}
              {parsedReport.bad_habits?.length > 0 && (
                <div className="ai-habit-report-section ai-habit-report-section--bad">
                  <h4>🎯 不良习惯</h4>
                  <ul>{parsedReport.bad_habits.map((h: { name: string; severity: string; trigger: string; fix: string; evidence_session?: string }, i: number) => (
                    <li key={i}><strong>{h.name}</strong> [{h.severity}] — 触发：{h.trigger}{h.evidence_session ? `（证据：${h.evidence_session}）` : ''} → 建议：{h.fix}</li>
                  ))}</ul>
                </div>
              )}
              {parsedReport.action_plan?.length > 0 && (
                <div className="ai-habit-report-section">
                  <h4>📋 改善计划</h4>
                  <ol>{parsedReport.action_plan.map((a: { priority: number; action: string; rationale: string; expected_impact?: string }, i: number) => (
                    <li key={i}><strong>{a.action}</strong> — {a.rationale}{a.expected_impact ? `（预期：${a.expected_impact}）` : ''}</li>
                  ))}</ol>
                </div>
              )}
            </>
          ) : parsedReport && 'fallback_text' in parsedReport ? (
            <pre className="ai-habit-advisor-fallback">{parsedReport.fallback_text}</pre>
          ) : (
            <div className="ai-habit-advisor-error">报告解析失败，原始内容见日志</div>
          )}
        </section>
      )}
      {reportError && <div className="ai-habit-advisor-error">{reportError}</div>}
    </div>
  )
}
