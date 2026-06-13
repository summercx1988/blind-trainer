import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import type { BenchmarkRunData, PlatformResult, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'

type ModelInfo = {
  id: string
  model_name?: string
  model_type?: string
  spec_version?: string
}

type RankingRow = {
  rank: number
  name: string
  strategy_type: 'classic' | 'ml' | string
  signal_count: number
  executed_trade_count: number
  win_rate: number
  cumulative_return: number
  max_drawdown: number
  sharpe_ratio: number
  profit_factor: number
}

type BenchmarkSnapshot = {
  key: string
  ranking: RankingRow[]
  generatedAt: string
}

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`
const num = (v: number, d = 2): string => Number.isFinite(v) ? v.toFixed(d) : '-'

const toRows = (raw: unknown): RankingRow[] => {
  if (!Array.isArray(raw)) return []
  return raw.map((item, idx) => {
    const row = (item || {}) as Record<string, unknown>
    return {
      rank: typeof row.rank === 'number' ? row.rank : idx + 1,
      name: typeof row.name === 'string' ? row.name : `row_${idx + 1}`,
      strategy_type: typeof row.strategy_type === 'string' ? row.strategy_type : 'classic',
      signal_count: typeof row.signal_count === 'number' ? row.signal_count : 0,
      executed_trade_count: typeof row.executed_trade_count === 'number' ? row.executed_trade_count : 0,
      win_rate: typeof row.win_rate === 'number' ? row.win_rate : 0,
      cumulative_return: typeof row.cumulative_return === 'number' ? row.cumulative_return : 0,
      max_drawdown: typeof row.max_drawdown === 'number' ? row.max_drawdown : 0,
      sharpe_ratio: typeof row.sharpe_ratio === 'number' ? row.sharpe_ratio : 0,
      profit_factor: typeof row.profit_factor === 'number' ? row.profit_factor : 0,
    }
  })
}

const defaultStartDate = (): string => {
  const now = new Date()
  const d = new Date(now.getTime() - 180 * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

const todayDate = (): string => new Date().toISOString().slice(0, 10)

const BenchmarkPanel = () => {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [startDate, setStartDate] = useState(defaultStartDate())
  const [endDate, setEndDate] = useState(todayDate())
  const [codesInput, setCodesInput] = useState('')
  const [holdingDays, setHoldingDays] = useState(2)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [ranking, setRanking] = useState<RankingRow[]>([])
  const [meta, setMeta] = useState<UnknownRecord | null>(null)
  const [lastSnapshot, setLastSnapshot] = useState<BenchmarkSnapshot | null>(null)
  const [compareText, setCompareText] = useState('')

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
      }))
      .filter((row) => row.id.length > 0)
    startTransition(() => {
      setModels(parsed)
    })
    if (!selectedModelId && parsed.length > 0) {
      startTransition(() => {
        setSelectedModelId(parsed[0]?.id || '')
      })
    }
  }, [selectedModelId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadModels()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [loadModels])

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId]
  )

  const runBenchmark = useCallback(async () => {
    if (!selectedModelId) {
      setMessage('请先选择模型')
      return
    }
    setRunning(true)
    setMessage('正在执行 Benchmark...')
    setRanking([])
    setMeta(null)
    setCompareText('')

    const codeList = codesInput
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    const result = await window.electronAPI?.backtest?.runBenchmark?.(
      selectedModelId,
      {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        codes: codeList.length > 0 ? codeList : undefined,
        holdingDays: Math.max(2, Number(holdingDays) || 2),
      }
    ) as PlatformResult<BenchmarkRunData> | undefined

    if (!result?.success) {
      const errMsg = result?.error?.message || getPlatformErrorMessage(result, 'Benchmark 执行失败')
      setMessage(errMsg)
      if (result?.error?.details && typeof result.error.details === 'object') {
        const details = result.error.details as Record<string, unknown>
        if (details.stderr && typeof details.stderr === 'string') {
          setMessage(`${errMsg}\n${details.stderr.slice(-500)}`)
        }
      }
      setRunning(false)
      return
    }

    const benchmarkData = (result.data?.benchmark || result.data || {}) as Record<string, unknown>
    const currentRows = toRows(benchmarkData.ranking)
    const currentKey = [selectedModelId, startDate || '', endDate || '', codeList.join(','), String(Math.max(2, Number(holdingDays) || 2))].join('|')
    if (lastSnapshot && lastSnapshot.key === currentKey && lastSnapshot.ranking.length > 0 && currentRows.length > 0) {
      const prevTop = lastSnapshot.ranking[0]
      const currTop = currentRows[0]
      const prevMl = lastSnapshot.ranking.find((row) => row.strategy_type === 'ml')
      const currMl = currentRows.find((row) => row.strategy_type === 'ml')
      const parts: string[] = []
      if (prevTop && currTop) {
        parts.push(`Top1: ${prevTop.name} -> ${currTop.name}`)
      }
      if (prevMl && currMl) {
        const delta = currMl.sharpe_ratio - prevMl.sharpe_ratio
        parts.push(`ML夏普变化: ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`)
      }
      setCompareText(parts.join(' | '))
    }
    setRanking(currentRows)
    setMeta(benchmarkData)
    setLastSnapshot({
      key: currentKey,
      ranking: currentRows,
      generatedAt: new Date().toISOString(),
    })
    setMessage(`Benchmark 完成：共 ${typeof benchmarkData.count === 'number' ? benchmarkData.count : 0} 个策略`)
    setRunning(false)
  }, [codesInput, endDate, holdingDays, lastSnapshot, selectedModelId, startDate])

  return (
    <div className="bt-compare-section">
      <div className="bt-section-title">Benchmark 排名（公平口径）</div>

      <div className="bt-controls" style={{ marginBottom: 12 }}>
        <div className="bt-control-group">
          <label>ML 对照模型</label>
          <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.model_name || m.id}
              </option>
            ))}
          </select>
        </div>
        <div className="bt-control-group">
          <label>开始日期</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="bt-control-group">
          <label>结束日期</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="bt-control-group">
          <label>股票范围（可选）</label>
          <input
            type="text"
            placeholder="000001,000002"
            value={codesInput}
            onChange={(e) => setCodesInput(e.target.value)}
          />
        </div>
        <div className="bt-control-group">
          <label>持有天数</label>
          <input
            type="number"
            min={2}
            max={30}
            value={holdingDays}
            onChange={(e) => setHoldingDays(Math.max(2, Number(e.target.value) || 2))}
          />
        </div>
        <button className="bt-run-btn" onClick={runBenchmark} disabled={running || !selectedModelId}>
          {running ? '执行中...' : '运行 Benchmark'}
        </button>
      </div>

      <div className="bt-status empty" style={{ marginBottom: 12 }}>
        {selectedModel
          ? `ML对照: ${selectedModel.model_name || selectedModel.id} | ${selectedModel.spec_version || '-'} · ${selectedModel.model_type || '-'}`
          : '未选择模型'}
      </div>

      {message && <div className={`bt-status ${running ? 'running' : 'empty'}`}>{message}</div>}
      {compareText && <div className="bt-status empty" style={{ marginTop: 8 }}>{compareText}</div>}

      {ranking.length > 0 && (
        <table className="bt-metrics-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>策略</th>
              <th>类型</th>
              <th>信号</th>
              <th>成交</th>
              <th>胜率</th>
              <th>累计收益</th>
              <th>最大回撤</th>
              <th>夏普</th>
              <th>盈亏比</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((row) => (
              <tr key={`${row.name}_${row.rank}`}>
                <td>{row.rank}</td>
                <td>{row.name}</td>
                <td>{row.strategy_type === 'ml' ? 'ML' : '经典'}</td>
                <td>{row.signal_count}</td>
                <td>{row.executed_trade_count}</td>
                <td className={row.win_rate >= 0.5 ? 'positive' : 'negative'}>{pct(row.win_rate)}</td>
                <td className={row.cumulative_return >= 0 ? 'positive' : 'negative'}>{pct(row.cumulative_return)}</td>
                <td className="negative">{pct(row.max_drawdown)}</td>
                <td>{num(row.sharpe_ratio, 3)}</td>
                <td>{num(row.profit_factor, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta && (
        <div className="bt-chip-row" style={{ marginTop: 12 }}>
          <span className="bt-chip">公平口径: 禁阈值 / 禁 TopN</span>
          <span className="bt-chip">窗口: {String((meta.window as Record<string, unknown> | undefined)?.start || 'ALL')} ~ {String((meta.window as Record<string, unknown> | undefined)?.end || 'ALL')}</span>
          <span className="bt-chip">持有: D+{String(meta.holding_days || 2)} 结算</span>
        </div>
      )}
    </div>
  )
}

export default BenchmarkPanel
