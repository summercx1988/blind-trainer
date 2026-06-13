import { useCallback, useState } from 'react'
import type { PlatformResult, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'

type ModelOption = {
  id: string
  model_name?: string
  model_type?: string
  spec_version?: string
  dataset_id?: string
}

type WfWindow = {
  window_index: number
  train_start: string
  train_end: string
  test_start: string
  test_end: string
  train_rows: number
  test_rows: number
  signal_count?: number
  executed_trade_count?: number
  skipped_signal_count?: number
  execution_rate?: number
  classification?: {
    metrics?: { auc?: number; f1?: number }
  }
  metrics_conservative?: {
    cumulative_return?: number
    sharpe_ratio?: number
    max_drawdown?: number
    win_rate?: number
    total_trades?: number
  }
  error?: string
}

type WfResult = {
  dataset_id: string
  spec_version: string
  engine: string
  threshold: number
  holding_days: number
  train_days: number
  test_days: number
  step_days: number
  max_windows: number
  windows_total: number
  windows_valid: number
  windows_failed: number
  avg_auc: number
  avg_f1: number
  oos_portfolio?: {
    cumulative_return?: number
    sharpe_ratio?: number
    max_drawdown?: number
    win_rate?: number
    total_trades?: number
  }
  oos_executed_trade_count?: number
  stability_summary?: {
    valid_window_count?: number
    profitable_window_count?: number
    loss_window_count?: number
    flat_window_count?: number
  }
}

const pct = (v: unknown): string => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0
  return `${(n * 100).toFixed(2)}%`
}
const num = (v: unknown, d = 2): string => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0
  return n.toFixed(d)
}

const parseWfResult = (raw: unknown): WfResult | null => {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  return {
    dataset_id: String(x.dataset_id || ''),
    spec_version: String(x.spec_version || ''),
    engine: String(x.engine || 'lightgbm'),
    threshold: typeof x.threshold === 'number' ? x.threshold : 0.5,
    holding_days: typeof x.holding_days === 'number' ? x.holding_days : 2,
    train_days: typeof x.train_days === 'number' ? x.train_days : 120,
    test_days: typeof x.test_days === 'number' ? x.test_days : 20,
    step_days: typeof x.step_days === 'number' ? x.step_days : 20,
    max_windows: typeof x.max_windows === 'number' ? x.max_windows : 12,
    windows_total: typeof x.windows_total === 'number' ? x.windows_total : 0,
    windows_valid: typeof x.windows_valid === 'number' ? x.windows_valid : 0,
    windows_failed: typeof x.windows_failed === 'number' ? x.windows_failed : 0,
    avg_auc: typeof x.avg_auc === 'number' ? x.avg_auc : 0,
    avg_f1: typeof x.avg_f1 === 'number' ? x.avg_f1 : 0,
    oos_portfolio: (x.oos_portfolio && typeof x.oos_portfolio === 'object') ? x.oos_portfolio as WfResult['oos_portfolio'] : undefined,
    oos_executed_trade_count: typeof x.oos_executed_trade_count === 'number' ? x.oos_executed_trade_count : 0,
    stability_summary: (x.stability_summary && typeof x.stability_summary === 'object') ? x.stability_summary as WfResult['stability_summary'] : undefined,
  }
}

const parseWindows = (raw: unknown): WfWindow[] => {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const w = (item || {}) as Record<string, unknown>
    return {
      window_index: typeof w.window_index === 'number' ? w.window_index : 0,
      train_start: String(w.train_start || ''),
      train_end: String(w.train_end || ''),
      test_start: String(w.test_start || ''),
      test_end: String(w.test_end || ''),
      train_rows: typeof w.train_rows === 'number' ? w.train_rows : 0,
      test_rows: typeof w.test_rows === 'number' ? w.test_rows : 0,
      signal_count: typeof w.signal_count === 'number' ? w.signal_count : undefined,
      executed_trade_count: typeof w.executed_trade_count === 'number' ? w.executed_trade_count : undefined,
      skipped_signal_count: typeof w.skipped_signal_count === 'number' ? w.skipped_signal_count : undefined,
      execution_rate: typeof w.execution_rate === 'number' ? w.execution_rate : undefined,
      classification: (w.classification && typeof w.classification === 'object')
        ? w.classification as WfWindow['classification']
        : undefined,
      metrics_conservative: (w.metrics_conservative && typeof w.metrics_conservative === 'object')
        ? w.metrics_conservative as WfWindow['metrics_conservative']
        : undefined,
      error: typeof w.error === 'string' ? w.error : undefined,
    }
  })
}

const WalkForwardPanel = () => {
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [trainDays, setTrainDays] = useState(120)
  const [testDays, setTestDays] = useState(20)
  const [stepDays, setStepDays] = useState(20)
  const [maxWindows, setMaxWindows] = useState(12)
  const [threshold, setThreshold] = useState(0.5)
  const [holdingDays, setHoldingDays] = useState(2)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<WfResult | null>(null)
  const [windows, setWindows] = useState<WfWindow[]>([])

  const loadModels = useCallback(async () => {
    const rows = await window.electronAPI?.backtest?.listModels()
    if (!Array.isArray(rows)) {
      setModels([])
      return
    }
    const parsed = rows
      .map((row) => row as Record<string, unknown>)
      .map((row) => ({
        id: String(row.model_id || ''),
        model_name: typeof row.model_name === 'string' ? row.model_name : '',
        model_type: typeof row.model_type === 'string' ? row.model_type : '',
        spec_version: typeof row.spec_version === 'string' ? row.spec_version : '',
        dataset_id: typeof row.dataset_id === 'string' ? row.dataset_id : '',
      }))
      .filter((r) => r.id.length > 0)
    setModels(parsed)
    if (!selectedModelId && parsed.length > 0) {
      setSelectedModelId(parsed[0].id)
    }
  }, [selectedModelId])

  const selectedModel = models.find((m) => m.id === selectedModelId)

  const runWalkForward = useCallback(async () => {
    if (!selectedModelId) {
      setMessage('请先选择模型')
      return
    }
    if (!selectedModel?.dataset_id || !selectedModel?.spec_version) {
      setMessage('所选模型缺少 dataset_id 或 spec_version 信息，无法执行 Walk-Forward。')
      return
    }

    setRunning(true)
    setMessage('正在执行 Walk-Forward 验证，可能需要几分钟...')
    setResult(null)
    setWindows([])

    const wfResult = await window.electronAPI?.backtest?.runWalkForward?.({
      datasetId: selectedModel.dataset_id,
      specVersion: selectedModel.spec_version,
      threshold,
      holdingDays,
      trainDays,
      testDays,
      stepDays,
      maxWindows,
    }) as PlatformResult<UnknownRecord> | undefined

    if (!wfResult?.success) {
      const errMsg = wfResult?.error?.message || getPlatformErrorMessage(wfResult, 'Walk-Forward 执行失败')
      let detail = errMsg
      if (wfResult?.error?.details && typeof wfResult.error.details === 'object') {
        const d = wfResult.error.details as Record<string, unknown>
        if (typeof d.stderr === 'string' && d.stderr.length > 0) {
          detail += `\n${d.stderr.slice(-500)}`
        }
      }
      setMessage(detail)
      setRunning(false)
      return
    }

    const raw = wfResult.data || {}
    const parsed = parseWfResult(raw)
    const parsedWindows = parseWindows((raw as Record<string, unknown>).windows)

    setResult(parsed)
    setWindows(parsedWindows)
    setMessage(parsed
      ? `Walk-Forward 完成：${parsed.windows_valid}/${parsed.windows_total} 窗口有效，平均 AUC ${parsed.avg_auc.toFixed(4)}`
      : 'Walk-Forward 完成，但结果格式异常')
    setRunning(false)
  }, [holdingDays, maxWindows, selectedModel, selectedModelId, stepDays, testDays, threshold, trainDays])

  const stabilityVerdict = (() => {
    if (!result?.stability_summary) return null
    const s = result.stability_summary
    const total = s.valid_window_count || 0
    if (total === 0) return { label: '无有效窗口', tone: 'negative' }
    const profitRate = (s.profitable_window_count || 0) / total
    if (profitRate >= 0.6) return { label: '稳定', tone: 'positive' }
    if (profitRate >= 0.4) return { label: '一般', tone: '' }
    return { label: '不稳定', tone: 'negative' }
  })()

  return (
    <div className="bt-compare-section">
      <div className="bt-section-title">Walk-Forward 滚动窗口验证</div>

      <div className="bt-controls" style={{ marginBottom: 12 }}>
        <div className="bt-control-group">
          <label>模型</label>
          <select
            value={selectedModelId}
            onChange={(e) => {
              setSelectedModelId(e.target.value)
              setResult(null)
              setWindows([])
              setMessage('')
            }}
            onClick={() => { void loadModels() }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.model_name || m.id}
              </option>
            ))}
          </select>
        </div>
        <div className="bt-control-group">
          <label>阈值</label>
          <input type="number" step={0.05} min={0.1} max={0.99} value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value) || 0.5)} />
        </div>
        <div className="bt-control-group">
          <label>训练天数</label>
          <input type="number" min={30} max={500} value={trainDays}
            onChange={(e) => setTrainDays(Math.max(30, parseInt(e.target.value) || 120))} />
        </div>
        <div className="bt-control-group">
          <label>测试天数</label>
          <input type="number" min={5} max={100} value={testDays}
            onChange={(e) => setTestDays(Math.max(5, parseInt(e.target.value) || 20))} />
        </div>
        <div className="bt-control-group">
          <label>滑动步长</label>
          <input type="number" min={5} max={100} value={stepDays}
            onChange={(e) => setStepDays(Math.max(5, parseInt(e.target.value) || 20))} />
        </div>
        <div className="bt-control-group">
          <label>最大窗口</label>
          <input type="number" min={2} max={50} value={maxWindows}
            onChange={(e) => setMaxWindows(Math.max(2, parseInt(e.target.value) || 12))} />
        </div>
        <div className="bt-control-group">
          <label>持有天数</label>
          <input type="number" min={2} max={30} value={holdingDays}
            onChange={(e) => setHoldingDays(Math.max(2, parseInt(e.target.value) || 2))} />
        </div>
        <button className="bt-run-btn" onClick={runWalkForward} disabled={running || !selectedModelId}>
          {running ? '执行中...' : '运行 Walk-Forward'}
        </button>
      </div>

      {selectedModel && (
        <div className="bt-status empty" style={{ marginBottom: 12 }}>
          模型: {selectedModel.model_name || selectedModel.id}
          {' '}| 规格: {selectedModel.spec_version || '-'}
          {' '}| 数据集: {selectedModel.dataset_id || '-'}
        </div>
      )}

      {message && <div className={`bt-status ${running ? 'running' : 'empty'}`}>{message}</div>}

      {result && (
        <>
          <div className="bt-summary-row" style={{ marginTop: 12 }}>
            <div className="bt-summary-card">
              <div className="bt-summary-label">有效窗口</div>
              <div className="bt-summary-value">{result.windows_valid} / {result.windows_total}</div>
              <div className="bt-summary-sub">失败 {result.windows_failed}</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">平均 AUC</div>
              <div className="bt-summary-value">{result.avg_auc.toFixed(4)}</div>
              <div className="bt-summary-sub">F1 {result.avg_f1.toFixed(4)}</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">OOS 累计收益</div>
              <div className={`bt-summary-value ${Number(result.oos_portfolio?.cumulative_return || 0) >= 0 ? 'positive' : 'negative'}`}>
                {pct(result.oos_portfolio?.cumulative_return)}
              </div>
              <div className="bt-summary-sub">跨窗口汇总</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">OOS 夏普</div>
              <div className="bt-summary-value">{num(result.oos_portfolio?.sharpe_ratio, 3)}</div>
              <div className="bt-summary-sub">OOS 最大回撤 {pct(result.oos_portfolio?.max_drawdown)}</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">稳定性</div>
              <div className={`bt-summary-value ${stabilityVerdict?.tone || ''}`}>
                {stabilityVerdict?.label || '-'}
              </div>
              <div className="bt-summary-sub">
                盈利窗口 {result.stability_summary?.profitable_window_count || 0} / {result.stability_summary?.valid_window_count || 0}
              </div>
            </div>
          </div>

          <div className="bt-chip-row" style={{ marginTop: 8, marginBottom: 12 }}>
            <span className="bt-chip">引擎: {result.engine}</span>
            <span className="bt-chip">阈值: {result.threshold}</span>
            <span className="bt-chip">训练/测试/步长: {result.train_days}/{result.test_days}/{result.step_days} 天</span>
            <span className="bt-chip">持有: D+{result.holding_days}</span>
            <span className="bt-chip">OOS 交易: {result.oos_executed_trade_count || 0} 笔</span>
          </div>
        </>
      )}

      {windows.length > 0 && (
        <table className="bt-metrics-table">
          <thead>
            <tr>
              <th>#</th>
              <th>训练区间</th>
              <th>测试区间</th>
              <th>AUC</th>
              <th>信号</th>
              <th>成交</th>
              <th>胜率</th>
              <th>OOS 收益</th>
              <th>OOS 夏普</th>
              <th>OOS 回撤</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((w) => {
              const hasError = !!w.error
              return (
                <tr key={w.window_index} style={hasError ? { opacity: 0.5 } : undefined}>
                  <td>{w.window_index}</td>
                  <td style={{ fontSize: '0.78rem' }}>{w.train_start.slice(0, 10)}~{w.train_end.slice(0, 10)}</td>
                  <td style={{ fontSize: '0.78rem' }}>{w.test_start.slice(0, 10)}~{w.test_end.slice(0, 10)}</td>
                  <td>{hasError ? '—' : num(w.classification?.metrics?.auc, 4)}</td>
                  <td>{w.signal_count ?? '—'}</td>
                  <td>{w.executed_trade_count ?? '—'}</td>
                  <td className={Number(w.metrics_conservative?.win_rate || 0) >= 0.5 ? 'positive' : 'negative'}>
                    {hasError ? '—' : pct(w.metrics_conservative?.win_rate)}
                  </td>
                  <td className={Number(w.metrics_conservative?.cumulative_return || 0) >= 0 ? 'positive' : 'negative'}>
                    {hasError ? '—' : pct(w.metrics_conservative?.cumulative_return)}
                  </td>
                  <td>{hasError ? '—' : num(w.metrics_conservative?.sharpe_ratio, 3)}</td>
                  <td className="negative">{hasError ? '—' : pct(w.metrics_conservative?.max_drawdown)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {windows.some((w) => w.error) && (
        <div className="bt-chip-row" style={{ marginTop: 8 }}>
          {windows.filter((w) => w.error).map((w) => (
            <span className="bt-chip bt-chip-warn" key={w.window_index}>
              W{w.window_index}: {w.error}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default WalkForwardPanel
