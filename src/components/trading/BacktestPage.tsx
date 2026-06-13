import { useCallback, useEffect, useMemo, useState } from 'react'
import InfoHover from '../common/InfoHover'
import WorkflowHeader from './workflow/WorkflowHeader'
import type { WorkflowStep } from './workflow/WorkflowHeader'
import './BacktestPage.css'
import '../../types/global.d'

interface ModelInfo {
  model_id: string
  model_name: string
  model_type: string
  spec_version: string
  dataset_id: string
  task_type: string
  threshold: number
  created_at: string
}

interface BacktestMetrics {
  total_trades: number
  win_rate: number
  avg_return: number
  cumulative_return: number
  annualized_return: number
  max_drawdown: number
  sharpe_ratio: number
  profit_factor: number
  avg_win: number
  avg_loss: number
  trades_per_day: number
  total_days: number
}

interface EquityPoint {
  date: string
  equity: number
  trades: number
}

interface BacktestCostProfile {
  commission_rate: number
  stamp_tax_rate: number
  transfer_fee_rate: number
  slippage_rate: number
  round_trip_cost_pct: number
}

interface BacktestDefinitionItem {
  key: string
  label: string
  definition: string
}

interface ThresholdAnalysisRow extends BacktestMetrics {
  threshold: number
  signal_count: number
  executed_trade_count?: number
  skipped_signal_count?: number
}

interface AccountSummary {
  initial_capital: number
  cash: number
  position_value: number
  nav: number
  exposure: number
  turnover: number
  open_positions: number
  closed_trades: number
  account_return?: number
}

interface BacktestReport {
  model_id: string
  model_name: string
  model_type: string
  spec_version: string
  dataset_id: string
  threshold: number
  max_positions_per_day: number
  holding_days?: number
  strategy_type?: string
  exit_mode?: string
  exit_params?: Record<string, unknown>
  entry_method: string
  exit_method_conservative: string
  exit_method_optimistic: string
  costs?: BacktestCostProfile
  test_samples: number
  signal_count: number
  executed_trade_count?: number
  skipped_signal_count?: number
  signal_rate: number
  execution_rate?: number
  skip_breakdown?: Record<string, number>
  calculation_basis?: Record<string, string>
  metric_definitions?: BacktestDefinitionItem[]
  data_leakage_guardrails?: string[]
  metrics_conservative: BacktestMetrics
  metrics_optimistic: BacktestMetrics
  account_summary?: AccountSummary
  threshold_analysis: ThresholdAnalysisRow[]
  equity_curve: EquityPoint[]
  trade_details?: TradeDetailRow[]
}

interface TradeDetailRow {
  code: string
  stock_name?: string
  signal_date: string
  probability?: number | null
  entry_price?: number | null
  exit_close?: number | null
  exit_high?: number | null
  trade_executed: boolean
  actual_return?: number | null
  best_return?: number | null
  skip_reason?: string
  [key: string]: unknown
}

interface CompareEntry {
  modelId: string
  modelName: string
  modelType: string
  spec: string
  strategyType?: string
  exitMode?: string
  report: BacktestReport | null
}

const formatPct = (v: number): string => `${(v * 100).toFixed(2)}%`
const formatNum = (v: number, d = 2): string => v.toFixed(d)

const CALCULATION_LABELS: Record<string, string> = {
  sample_scope: '样本范围',
  signal_generation: '信号生成',
  execution_filter: '成交过滤',
  entry_rule: '入场规则',
  exit_rule_conservative: '保守出场',
  exit_rule_optimistic: '乐观上界',
  portfolio_rule: '组合收益',
  cost_rule: '成本假设',
}

const SKIP_REASON_LABELS: Record<string, string> = {
  no_market_data: '缺少后续行情',
  no_d1_open: '缺少 D+1 开盘价',
  limit_up_entry: 'D+1 开盘涨停无法买入',
  no_d2_close: '缺少 D+2 收盘价，无法按 T+1 规则结算',
}

const formatSkipReason = (reason: string): string => SKIP_REASON_LABELS[reason] || reason

const EXPORT_CSV_HEADERS = [
  '股票代码', '股票名称', '信号日期', '模型概率', '是否成交',
  '入场价(D+1 Open)',
]

const buildExportHeaders = (trades: TradeDetailRow[]): string[] => {
  const base = [...EXPORT_CSV_HEADERS]
  const exitDayCols = Object.keys(trades[0] || {})
    .filter((k) => /^exit_close_d\d+$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.replace('exit_close_d', ''), 10)
      const nb = parseInt(b.replace('exit_close_d', ''), 10)
      return na - nb
    })
  for (const col of exitDayCols) {
    const dayOffset = col.replace('exit_close_d', '')
    base.push(`D+${dayOffset} 收盘价`)
  }
  base.push('退出最高价(D+N High)', '保守收益率', '乐观收益率', '跳过原因')
  return base
}

const exportTradeDetailsCsv = (report: BacktestReport) => {
  const trades = report.trade_details || []
  if (trades.length === 0) {
    alert('当前回测报告无交易明细数据。请重新执行回测以生成含交易明细的报告。')
    return
  }

  const headers = buildExportHeaders(trades)
  const exitDayCols = Object.keys(trades[0] || {})
    .filter((k) => /^exit_close_d\d+$/.test(k))
    .sort((a, b) => parseInt(a.replace('exit_close_d', ''), 10) - parseInt(b.replace('exit_close_d', ''), 10))

  const escapeCsvField = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  const rows = trades.map((t) => {
    const cells = [
      escapeCsvField(t.code),
      escapeCsvField(t.stock_name || ''),
      escapeCsvField(t.signal_date),
      t.probability != null ? t.probability.toFixed(6) : '',
      t.trade_executed ? '是' : '否',
      t.entry_price != null ? t.entry_price.toFixed(4) : '',
    ]
    for (const col of exitDayCols) {
      const val = t[col]
      cells.push(typeof val === 'number' && Number.isFinite(val) ? val.toFixed(4) : '')
    }
    cells.push(
      t.exit_high != null ? t.exit_high.toFixed(4) : '',
      t.actual_return != null ? (t.actual_return * 100).toFixed(4) + '%' : '',
      t.best_return != null ? (t.best_return * 100).toFixed(4) + '%' : '',
      escapeCsvField(t.skip_reason || ''),
    )
    return cells.join(',')
  })

  const holdingDays = report.holding_days || 2
  const header = `模型: ${report.model_name || report.model_id} | 阈值: ${report.threshold} | 规格: ${report.spec_version} | 持有天数: ${holdingDays} | 导出时间: ${new Date().toLocaleString('zh-CN')}`
  const csv = [header, '', headers.join(','), ...rows].join('\n')
  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `backtest_trades_${report.model_id}_${report.threshold}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const EquityChart = ({ curve }: { curve: EquityPoint[] }) => {
  if (!curve.length) return <div className="bt-empty-state"><p>暂无净值数据</p></div>

  const w = 800
  const h = 260
  const pad = { top: 10, right: 10, bottom: 28, left: 55 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom

  const equities = curve.map((p) => p.equity)
  const minE = Math.min(...equities, 1)
  const maxE = Math.max(...equities, 1)
  const rangeE = maxE - minE || 1

  const toX = (i: number) => pad.left + (i / (curve.length - 1 || 1)) * plotW
  const toY = (e: number) => pad.top + plotH - ((e - minE) / rangeE) * plotH

  const linePath = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.equity).toFixed(1)}`).join(' ')

  const yTicks = 5
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => minE + (rangeE * i) / yTicks)

  const xTickCount = Math.min(curve.length, 6)
  const xStep = Math.max(1, Math.floor(curve.length / xTickCount))

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: 280 }}>
      {yLabels.map((val, i) => {
        const y = toY(val)
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={pad.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#9ca3af">{val.toFixed(2)}</text>
          </g>
        )
      })}
      {curve.filter((_, i) => i % xStep === 0 || i === curve.length - 1).map((p, idx) => {
        const i = idx * xStep
        const x = toX(i)
        return (
          <text key={idx} x={x} y={h - 6} textAnchor="middle" fontSize={9} fill="#9ca3af">{p.date.slice(5)}</text>
        )
      })}
      <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={1.8} />
      {curve.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.equity)} r={1.5} fill="#2563eb" opacity={0.4} />
      ))}
      <line x1={pad.left} y1={toY(1)} x2={w - pad.right} y2={toY(1)} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="4 2" />
    </svg>
  )
}

const MetricsTable = ({ metrics, title }: { metrics: BacktestMetrics; title: string }) => {
  const rows = [
    ['总交易数', metrics.total_trades, ''],
    ['胜率', formatPct(metrics.win_rate), metrics.win_rate >= 0.5 ? 'positive' : 'negative'],
    ['单笔平均收益', formatPct(metrics.avg_return), metrics.avg_return >= 0 ? 'positive' : 'negative'],
    ['累计收益', formatPct(metrics.cumulative_return), metrics.cumulative_return >= 0 ? 'positive' : 'negative'],
    ['年化收益', formatPct(metrics.annualized_return), metrics.annualized_return >= 0 ? 'positive' : 'negative'],
    ['最大回撤', formatPct(metrics.max_drawdown), 'negative'],
    ['夏普比率', formatNum(metrics.sharpe_ratio), metrics.sharpe_ratio >= 1 ? 'positive' : ''],
    ['盈亏比', formatNum(metrics.profit_factor), metrics.profit_factor >= 1 ? 'positive' : ''],
    ['平均盈利', formatPct(metrics.avg_win), 'positive'],
    ['平均亏损', formatPct(metrics.avg_loss), 'negative'],
    ['日均交易', formatNum(metrics.trades_per_day), ''],
    ['覆盖天数', metrics.total_days, ''],
  ]

  return (
    <div>
      <div className="bt-section-title">{title}</div>
      <table className="bt-metrics-table">
        <thead>
          <tr><th>指标</th><th>结果</th></tr>
        </thead>
        <tbody>
          {rows.map(([label, value, cls]) => (
            <tr key={label as string}>
              <td className="metric-label">{label}</td>
              <td className={cls as string}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ThresholdTable = ({ analysis }: { analysis: BacktestReport['threshold_analysis'] }) => {
  if (!analysis || !analysis.length) return null

  const unique = analysis.filter((item, idx, arr) =>
    arr.findIndex((t) => t.threshold === item.threshold) === idx
  )

  return (
    <table className="bt-metrics-table">
      <thead>
        <tr>
          <th>阈值</th><th>信号数</th><th>成交数</th><th>胜率</th><th>平均收益</th>
          <th>累计收益</th><th>夏普</th><th>最大回撤</th>
        </tr>
      </thead>
      <tbody>
        {unique.map((row) => (
          <tr key={row.threshold}>
            <td>{row.threshold.toFixed(2)}</td>
            <td>{row.signal_count}</td>
            <td>{row.executed_trade_count ?? row.total_trades}</td>
            <td className={row.win_rate >= 0.5 ? 'positive' : 'negative'}>{formatPct(row.win_rate)}</td>
            <td className={row.avg_return >= 0 ? 'positive' : 'negative'}>{formatPct(row.avg_return)}</td>
            <td className={row.cumulative_return >= 0 ? 'positive' : 'negative'}>{formatPct(row.cumulative_return)}</td>
            <td>{formatNum(row.sharpe_ratio)}</td>
            <td className="negative">{formatPct(row.max_drawdown)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const CompareTable = ({ entries }: { entries: CompareEntry[] }) => {
  if (!entries.length) return null

  return (
    <table className="bt-metrics-table">
      <thead>
        <tr>
          <th>指标</th>
          {entries.map((e) => <th key={e.modelId}>{e.modelName}<br /><span style={{ fontWeight: 400, fontSize: '0.7rem', color: '#9ca3af' }}>{e.spec}</span>{e.strategyType && <><br /><span style={{ fontWeight: 400, fontSize: '0.65rem', color: '#6b7280' }}>{e.strategyType === 'model' ? '模型' : '指标'}</span></>}{e.exitMode && <><br /><span style={{ fontWeight: 400, fontSize: '0.65rem', color: '#6b7280' }}>{e.exitMode === 'fixed_holding' ? '固定持有' : e.exitMode === 'indicator_exit' ? '指标退出' : e.exitMode === 'model_exit' ? '模型退出' : '组合退出'}</span></>}</th>)}
        </tr>
      </thead>
      <tbody>
        {(() => {
          const metricKeys: Array<[string, (m: BacktestMetrics) => string]> = [
            ['交易数', (m) => String(m.total_trades)],
            ['胜率', (m) => formatPct(m.win_rate)],
            ['平均收益', (m) => formatPct(m.avg_return)],
            ['累计收益', (m) => formatPct(m.cumulative_return)],
            ['最大回撤', (m) => formatPct(m.max_drawdown)],
            ['夏普', (m) => formatNum(m.sharpe_ratio)],
            ['盈亏比', (m) => formatNum(m.profit_factor)],
          ]
          return metricKeys.map(([label, fn]) => (
            <tr key={label}>
              <td className="metric-label">{label}</td>
              {entries.map((e) => {
                const m = e.report?.metrics_conservative
                return <td key={e.modelId}>{m ? fn(m) : '—'}</td>
              })}
            </tr>
          ))
        })()}
      </tbody>
    </table>
  )
}

function BacktestPage() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [threshold, setThreshold] = useState(0.85)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<{ type: string; msg: string } | null>(null)
  const [report, setReport] = useState<BacktestReport | null>(null)
  const [compareEntries, setCompareEntries] = useState<CompareEntry[]>([])
  const [optimizing, setOptimizing] = useState(false)
  const [showBasisDetail, setShowBasisDetail] = useState(false)
  const [optResult, setOptResult] = useState<{
    recommended_threshold: number | null
    objective: string
    best_metrics: Record<string, unknown> | null
    constraints_relaxed?: boolean
  } | null>(null)

  const loadModels = useCallback(async () => {
    const list = await window.electronAPI?.backtest?.listModels()
    if (list) {
      setModels(list as unknown as ModelInfo[])
      if (list.length > 0 && !selectedModel) {
        setSelectedModel((list[0] as unknown as ModelInfo).model_id)
      }
    }
  }, [selectedModel])

  useEffect(() => { loadModels() }, [loadModels])

  const modelOptions = useMemo(() => {
    return models.map((m) => (
      <option key={m.model_id} value={m.model_id}>
        {m.model_name} ({m.spec_version}, {m.model_type})
      </option>
    ))
  }, [models])

  const selectedModelInfo = useMemo(() => models.find((m) => m.model_id === selectedModel), [models, selectedModel])
  const executionSummary = useMemo(() => {
    if (!report) {
      return { executedTradeCount: 0, skippedSignalCount: 0, executionRate: 0 }
    }
    const executedTradeCount = report.executed_trade_count ?? report.metrics_conservative.total_trades
    const skippedSignalCount = report.skipped_signal_count ?? Math.max(report.signal_count - executedTradeCount, 0)
    const executionRate = report.execution_rate ?? (report.signal_count > 0 ? executedTradeCount / report.signal_count : 0)
    return { executedTradeCount, skippedSignalCount, executionRate }
  }, [report])
  const calculationEntries = useMemo(
    () => report?.calculation_basis ? Object.entries(report.calculation_basis) : [],
    [report]
  )
  const skipEntries = useMemo(
    () => report?.skip_breakdown ? Object.entries(report.skip_breakdown) : [],
    [report]
  )

  const workflowStats = useMemo(() => ([
    {
      label: '已登记模型',
      value: `${models.length}`,
      hint: models.length > 0 ? '可直接切换回测对象' : '先去模型部署页激活模型',
      tone: 'accent' as const
    },
    {
      label: '当前阈值',
      value: threshold.toFixed(2),
      hint: '可执行阈值优化后再应用',
      tone: 'neutral' as const
    },
    {
      label: '比较列表',
      value: `${compareEntries.length}`,
      hint: compareEntries.length > 0 ? '已加入横向比较' : '回测后可加入比较',
      tone: 'neutral' as const
    },
    {
      label: '当前模型',
      value: selectedModelInfo?.model_name || '未选择',
      hint: selectedModelInfo ? `${selectedModelInfo.spec_version} · ${selectedModelInfo.model_type}` : '请选择一个模型',
      tone: selectedModelInfo ? 'positive' as const : 'neutral' as const
    }
  ]), [compareEntries.length, models.length, selectedModelInfo, threshold])

  const workflowSteps = useMemo<WorkflowStep[]>(() => ([
    {
      id: 'pick',
      label: '选择模型',
      desc: '先确认模型版本、数据集和默认阈值。',
      state: selectedModelInfo ? 'done' : 'active'
    },
    {
      id: 'run',
      label: '执行回测',
      desc: '观察保守收益、回撤和胜率。',
      state: running ? 'active' : report ? 'done' : 'idle'
    },
    {
      id: 'optimize',
      label: '优化阈值',
      desc: '用 Sharpe 和收益曲线寻找更稳的阈值。',
      state: optimizing ? 'active' : optResult ? 'done' : 'idle'
    },
    {
      id: 'compare',
      label: '横向比较',
      desc: '把多个模型放到同一张表里看差异。',
      state: compareEntries.length > 0 ? 'done' : 'idle'
    }
  ]), [compareEntries.length, optResult, optimizing, report, running, selectedModelInfo])

  const runBacktest = useCallback(async () => {
    if (!selectedModel) return
    setRunning(true)
    setStatus({ type: 'running', msg: `正在执行回测：${selectedModel}（阈值 ${threshold}）` })
    setReport(null)

    try {
      const result = await window.electronAPI?.backtest?.run(selectedModel, threshold) as unknown as {
        success?: boolean
        data?: { report?: BacktestReport; stdout?: string }
        error?: { code?: string; message?: string; details?: { stderr?: string } }
        meta?: { command?: string }
      } | undefined

      if (!result?.success) {
        const errMsg = result?.error?.message || '回测执行失败'
        const stderrHint = result?.error?.details?.stderr ? `\n${result.error.details.stderr.slice(-500)}` : ''
        setStatus({ type: 'error', msg: `${errMsg}${stderrHint}` })
        setRunning(false)
        return
      }

      const report = (result.data?.report || {}) as unknown as BacktestReport
      if (!report.model_id) {
        setStatus({ type: 'error', msg: '回测执行完成，但未返回有效报告。请检查模型文件是否存在。' })
        setRunning(false)
        return
      }
      setReport(report)
      setStatus(null)
    } catch (error) {
      setStatus({ type: 'error', msg: `回测异常：${(error as Error).message}` })
    }
    setRunning(false)
  }, [selectedModel, threshold])

  const optimizeThreshold = useCallback(async () => {
    if (!selectedModel) return
    setOptimizing(true)
    setOptResult(null)
    setStatus({ type: 'running', msg: `正在为 ${selectedModel} 优化阈值...` })

    try {
      const result = await window.electronAPI?.backtest?.optimizeThreshold(selectedModel, 'sharpe') as unknown as {
        success?: boolean
        data?: {
          optimization?: {
            recommended_threshold: number | null
            objective: string
            best_metrics: Record<string, unknown> | null
            constraints_relaxed?: boolean
          }
        }
        error?: { code?: string; message?: string }
      } | undefined

      if (!result?.success || !result.data?.optimization) {
        const errMsg = result?.error?.message || '阈值优化失败'
        setStatus({ type: 'error', msg: errMsg })
        return
      }

      setOptResult(result.data.optimization)
      setStatus(null)
    } catch (error) {
      setStatus({ type: 'error', msg: `阈值优化失败：${(error as Error).message}` })
    } finally {
      setOptimizing(false)
    }
  }, [selectedModel])

  const addToCompare = useCallback(() => {
    if (!report) return
    setCompareEntries((prev) => {
      if (prev.some((e) => e.modelId === report.model_id)) return prev
      return [...prev, {
        modelId: report.model_id,
        modelName: report.model_name || report.model_id,
        modelType: report.model_type,
        spec: report.spec_version,
        strategyType: report.strategy_type,
        exitMode: report.exit_mode,
        report,
      }]
    })
  }, [report])

  return (
    <div className="backtest-page">
      <WorkflowHeader
        eyebrow="Backtest Desk"
        title="模型回测与阈值决策"
        description="这里不只看单个指标，而是把收益、回撤、信号密度和阈值敏感性放在一起判断。先跑出保守结果，再决定是否优化阈值和加入模型比较。"
        stats={workflowStats}
        steps={workflowSteps}
      />

      {/* Controls */}
      <div className="bt-controls">
        <div className="bt-control-group">
          <label>回测模型</label>
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
            {modelOptions}
          </select>
        </div>
        <div className="bt-control-group">
          <label>
            信号阈值
            <InfoHover
              position="bottom"
              content="阈值越高，触发信号越少但通常更保守。建议先跑默认阈值，再用优化功能寻找更稳的收益/回撤平衡点。"
            />
          </label>
          <input
            type="number"
            step={0.05}
            min={0.1}
            max={0.99}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value) || 0.5)}
          />
        </div>
        <button className="bt-run-btn" onClick={runBacktest} disabled={running || !selectedModel}>
          {running ? '执行中...' : '执行回测'}
        </button>
        {report && (
          <>
            <button className="bt-compare-add-btn" onClick={addToCompare}>
              + 加入比较
            </button>
            <button
              className="bt-run-btn bt-run-btn-secondary"
              onClick={() => exportTradeDetailsCsv(report)}
            >
              导出交易明细 CSV
            </button>
          </>
        )}
        <button
          className="bt-run-btn bt-run-btn-secondary"
          onClick={optimizeThreshold}
          disabled={optimizing || !selectedModel}
        >
          {optimizing ? '优化中...' : '优化阈值'}
        </button>
      </div>

      {/* Status */}
      {status && <div className={`bt-status ${status.type}`}>{status.msg}</div>}

      {/* Model info */}
      {selectedModelInfo && (
        <div className="bt-status empty" style={{ marginBottom: 12 }}>
          <strong>{selectedModelInfo.model_name}</strong>
          <span className={`bt-model-tag ${selectedModelInfo.model_type}`}>
            {selectedModelInfo.model_type}
          </span>
          {' '}| 规格: {selectedModelInfo.spec_version} | 数据集: {selectedModelInfo.dataset_id}
          {' '}| 创建时间: {selectedModelInfo.created_at?.slice(0, 10) || 'N/A'}
        </div>
      )}

      {/* No report yet */}
      {!report && !running && (
        <div className="bt-empty-state">
          <p>
            选择模型和阈值，点击执行回测
            <InfoHover
              position="right"
              content="回测使用模型信号在历史数据上模拟交易。保守出场按 D+2 收盘价结算，乐观出场按最大高价结算。可通过阈值敏感性分析找到最优阈值。"
            />
          </p>
        </div>
      )}

      {/* Report */}
      {report && (
        <>
          {/* Summary cards */}
          <div className="bt-summary-row">
            <div className="bt-summary-card">
              <div className="bt-summary-label">信号 / 成交</div>
              <div className="bt-summary-value">{report.signal_count} / {executionSummary.executedTradeCount}</div>
              <div className="bt-summary-sub">
                触发率 {formatPct(report.signal_rate)} | 执行率 {formatPct(executionSummary.executionRate)}
              </div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">累计收益</div>
              <div className={`bt-summary-value ${report.metrics_conservative.cumulative_return >= 0 ? 'positive' : 'negative'}`}>
                {formatPct(report.metrics_conservative.cumulative_return)}
              </div>
              <div className="bt-summary-sub">保守出场（D+2 收盘，可成交主口径）</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">最大回撤</div>
              <div className="bt-summary-value negative">{formatPct(report.metrics_conservative.max_drawdown)}</div>
              <div className="bt-summary-sub">峰谷回撤压力</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">夏普比率</div>
              <div className={`bt-summary-value ${report.metrics_conservative.sharpe_ratio >= 1 ? 'positive' : ''}`}>
                {formatNum(report.metrics_conservative.sharpe_ratio)}
              </div>
              <div className="bt-summary-sub">风险调整后收益</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">胜率</div>
              <div className={`bt-summary-value ${report.metrics_conservative.win_rate >= 0.5 ? 'positive' : 'negative'}`}>
                {formatPct(report.metrics_conservative.win_rate)}
              </div>
              <div className="bt-summary-sub">
                {report.metrics_conservative.total_days} 天内共 {report.metrics_conservative.total_trades} 笔 | 跳过 {executionSummary.skippedSignalCount}
              </div>
            </div>
          </div>

          {/* Equity Curve */}
          <div className="bt-equity-section">
            <div className="bt-section-title">净值曲线（保守出场）</div>
            <EquityChart curve={report.equity_curve} />
          </div>

          {(report.strategy_type || report.exit_mode) && (
            <div className="bt-strategy-info-row">
              {report.strategy_type && (
                <span className="bt-chip">
                  策略类型: {report.strategy_type === 'model' ? '模型策略' : '指标策略'}
                </span>
              )}
              {report.exit_mode && (
                <span className="bt-chip">
                  退出模式: {report.exit_mode === 'fixed_holding' ? '固定持有' : report.exit_mode === 'indicator_exit' ? '指标退出' : report.exit_mode === 'model_exit' ? '模型退出' : '组合退出'}
                </span>
              )}
              {report.exit_params && typeof report.exit_params.holding_days === 'number' && (
                <span className="bt-chip">
                  持有天数: {report.exit_params.holding_days}
                </span>
              )}
            </div>
          )}

          {report.account_summary && (
            <div className="bt-account-section">
              <div className="bt-section-title">账户摘要</div>
              <div className="bt-summary-row">
                <div className="bt-summary-card">
                  <div className="bt-summary-label">现金</div>
                  <div className="bt-summary-value">{(report.account_summary.cash / 10000).toFixed(2)}万</div>
                  <div className="bt-summary-sub">可用资金</div>
                </div>
                <div className="bt-summary-card">
                  <div className="bt-summary-label">持仓市值</div>
                  <div className="bt-summary-value">{(report.account_summary.position_value / 10000).toFixed(2)}万</div>
                  <div className="bt-summary-sub">未平仓市值</div>
                </div>
                <div className="bt-summary-card">
                  <div className="bt-summary-label">NAV</div>
                  <div className="bt-summary-value">{(report.account_summary.nav / 10000).toFixed(2)}万</div>
                  <div className="bt-summary-sub">总净值</div>
                </div>
                <div className="bt-summary-card">
                  <div className="bt-summary-label">暴露度</div>
                  <div className="bt-summary-value">{formatPct(report.account_summary.exposure)}</div>
                  <div className="bt-summary-sub">仓位占比</div>
                </div>
                <div className="bt-summary-card">
                  <div className="bt-summary-label">换手率</div>
                  <div className="bt-summary-value">{formatPct(report.account_summary.turnover)}</div>
                  <div className="bt-summary-sub">累计换手</div>
                </div>
              </div>
              {report.account_summary.account_return !== undefined && (
                <div className="bt-chip-row">
                  <span className="bt-chip">
                    账户收益率: {formatPct(report.account_summary.account_return)}
                  </span>
                  <span className="bt-chip">
                    理论信号收益: {formatPct(report.metrics_conservative.cumulative_return)}
                  </span>
                  {report.account_summary.account_return !== undefined && report.metrics_conservative.cumulative_return !== 0 && (
                    <span className="bt-chip bt-chip-warn">
                      执行损耗: {formatPct(report.metrics_conservative.cumulative_return - report.account_summary.account_return)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {(calculationEntries.length > 0 || (report.metric_definitions || []).length > 0 || (report.data_leakage_guardrails || []).length > 0) && (
            <div className="bt-basis-section">
              <div className="bt-section-head">
                <div className="bt-section-title">回测口径说明</div>
                <div className="bt-section-subtitle">先看可成交保守结果，再把乐观结果当作止盈空间上界。</div>
                <button
                  className="bt-basis-toggle"
                  onClick={() => setShowBasisDetail((prev) => !prev)}
                >
                  {showBasisDetail ? '收起说明' : '展开说明'}
                </button>
              </div>

              {showBasisDetail && (
                <>
                  <div className="bt-basis-grid">
                    <div className="bt-basis-card">
                      <div className="bt-basis-card-title">成交与收益定义</div>
                      <div className="bt-basis-list">
                        {calculationEntries.map(([key, value]) => (
                          <div className="bt-basis-item" key={key}>
                            <div className="bt-basis-label">{CALCULATION_LABELS[key] || key}</div>
                            <p className="bt-basis-text">{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bt-basis-card">
                      <div className="bt-basis-card-title">指标口径</div>
                      <div className="bt-basis-list">
                        {(report.metric_definitions || []).map((item) => (
                          <div className="bt-basis-item" key={item.key}>
                            <div className="bt-basis-label">{item.label}</div>
                            <p className="bt-basis-text">{item.definition}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bt-chip-row">
                    {report.costs && (
                      <span className="bt-chip">
                        双边理论成本 {formatPct(report.costs.round_trip_cost_pct)}
                      </span>
                    )}
                    {skipEntries.map(([reason, count]) => (
                      <span className="bt-chip bt-chip-warn" key={reason}>
                        跳过 {count} 次: {formatSkipReason(reason)}
                      </span>
                    ))}
                  </div>

                  {(report.data_leakage_guardrails || []).length > 0 && (
                    <div className="bt-guardrail-box">
                      <div className="bt-basis-card-title">防未来函数检查</div>
                      <div className="bt-guardrail-list">
                        {(report.data_leakage_guardrails || []).map((item) => (
                          <div className="bt-guardrail-item" key={item}>{item}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {!showBasisDetail && (
                <div className="bt-basis-collapsed-note">
                  已折叠详细口径说明，点击“展开说明”可查看成交定义、指标口径与防未来函数检查。
                </div>
              )}
            </div>
          )}

          {/* Metrics */}
          <div className="bt-metrics-section">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <MetricsTable metrics={report.metrics_conservative} title="保守结果（D+2 收盘）" />
              {report.metrics_optimistic && (
                <MetricsTable metrics={report.metrics_optimistic} title="乐观结果（D+2 最高价，上界参考）" />
              )}
            </div>
          </div>

          {/* Threshold Analysis */}
          {report.threshold_analysis && report.threshold_analysis.length > 0 && (
            <div className="bt-threshold-section">
              <div className="bt-section-title">阈值敏感性分析</div>
              <ThresholdTable analysis={report.threshold_analysis} />
            </div>
          )}
        </>
      )}

      {/* Threshold Optimization Result */}
      {optResult && (
        <div className="bt-optimize-section">
          <div className="bt-optimize-header">
            <strong className="bt-optimize-title">阈值优化结果 ({optResult.objective})</strong>
            {optResult.recommended_threshold != null && (
              <button
                className="bt-optimize-apply"
                onClick={() => {
                  setThreshold(optResult.recommended_threshold!)
                  setOptResult(null)
                }}
              >
                应用 {optResult.recommended_threshold}
              </button>
            )}
          </div>
          {optResult.recommended_threshold == null ? (
            <p className="bt-optimize-empty">没有找到满足条件的阈值。</p>
          ) : (
            <div className="bt-optimize-grid">
              <div className="bt-optimize-stat">
                <span className="bt-optimize-label">推荐阈值</span>
                <div className="bt-optimize-value bt-optimize-value-accent">{optResult.recommended_threshold}</div>
              </div>
              {optResult.best_metrics && (
                <>
                  <div className="bt-optimize-stat">
                    <span className="bt-optimize-label">夏普</span>
                    <div className="bt-optimize-value">{(optResult.best_metrics.sharpe_ratio as number)?.toFixed(2)}</div>
                  </div>
                  <div className="bt-optimize-stat">
                    <span className="bt-optimize-label">累计收益</span>
                    <div className="bt-optimize-value bt-positive">{((optResult.best_metrics.cumulative_return as number) * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bt-optimize-stat">
                    <span className="bt-optimize-label">胜率</span>
                    <div className="bt-optimize-value">{((optResult.best_metrics.win_rate as number) * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bt-optimize-stat">
                    <span className="bt-optimize-label">最大回撤</span>
                    <div className="bt-optimize-value bt-negative">{((optResult.best_metrics.max_drawdown as number) * 100).toFixed(1)}%</div>
                  </div>
                </>
              )}
            </div>
          )}
          {optResult.constraints_relaxed && (
            <div className="bt-optimize-note">
              本次推荐是在放宽约束后得到的，建议应用后再完整回测一次确认收益与回撤。
            </div>
          )}
        </div>
      )}

      {/* Comparison */}
      {compareEntries.length > 0 && (
        <div className="bt-compare-section">
          <div className="bt-section-title">模型横向比较（{compareEntries.length} 个模型）</div>
          <CompareTable entries={compareEntries} />
        </div>
      )}
    </div>
  )
}

export default BacktestPage
