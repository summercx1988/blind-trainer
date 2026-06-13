import { useCallback, useEffect, useState } from 'react'
import type { EnsembleRunData, PlatformResult, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { ModelVersionItem } from './types'
import { toModelVersionItem } from './types'

const EnsembleTab = () => {
  const [models, setModels] = useState<ModelVersionItem[]>([])
  const [trendModelId, setTrendModelId] = useState('')
  const [reversalModelId, setReversalModelId] = useState('')
  const [weightTrend, setWeightTrend] = useState(0.6)
  const [isRunning, setIsRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  const loadModels = useCallback(async () => {
    try {
      const rows = await window.electronAPI?.listModels?.()
      setModels((rows || []).map((row) => toModelVersionItem(row as UnknownRecord)).filter((row): row is ModelVersionItem => row !== null))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { void loadModels() }, [loadModels])

  const handleRun = useCallback(async () => {
    if (!trendModelId || !reversalModelId) { setMessage('请选择两个模型'); return }
    if (trendModelId === reversalModelId) { setMessage('请选择不同的模型'); return }
    setIsRunning(true); setMessage(''); setResult(null)
    try {
      const res = await window.electronAPI?.createEnsemble?.(trendModelId, reversalModelId, weightTrend) as PlatformResult<EnsembleRunData> | undefined
      if (res?.success && res.data.result) {
        setResult(res.data.result)
        setMessage('集成完成')
      } else {
        setMessage(`集成失败: ${getPlatformErrorMessage(res, '未知错误')}`)
      }
    } catch (error) {
      setMessage(`异常: ${error instanceof Error ? error.message : 'unknown'}`)
    } finally {
      setIsRunning(false)
    }
  }, [trendModelId, reversalModelId, weightTrend])

  const formatMetric = (obj: unknown, key: string): string => {
    if (!obj || typeof obj !== 'object') return '-'
    const val = (obj as Record<string, unknown>)[key]
    return typeof val === 'number' ? `${(val * 100).toFixed(1)}%` : '-'
  }

  const ensembleMetrics = result?.ensemble_metrics as Record<string, unknown> | undefined
  const trendMetrics = result?.trend_metrics as Record<string, unknown> | undefined
  const reversalMetrics = result?.reversal_metrics as Record<string, unknown> | undefined
  const styleDist = result?.style_distribution as Record<string, unknown> | undefined

  return (
    <>
      <section className="model-card">
        <div className="model-card-head"><h3>集成模型配置</h3></div>
        <p className="model-desc">选择两个已训练模型，加权组合预测概率。权重 0.6 表示模型 A 占 60%。</p>
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <label>模型 A (趋势)
            <select value={trendModelId} onChange={(e) => setTrendModelId(e.target.value)}>
              <option value="">请选择</option>
              {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.id.slice(0, 12)})</option>))}
            </select>
          </label>
          <label>模型 B (反转)
            <select value={reversalModelId} onChange={(e) => setReversalModelId(e.target.value)}>
              <option value="">请选择</option>
              {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.id.slice(0, 12)})</option>))}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>模型 A 权重:</span>
            <input type="range" min={0} max={1} step={0.05} value={weightTrend} onChange={(e) => setWeightTrend(parseFloat(e.target.value))} style={{ flex: 1 }} />
            <strong>{weightTrend.toFixed(2)}</strong>
            <span style={{ color: '#9ca3af' }}>(B: {(1 - weightTrend).toFixed(2)})</span>
          </label>
        </div>
        <div className="model-actions" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => void handleRun()} disabled={isRunning || !trendModelId || !reversalModelId}>
            {isRunning ? '运行中...' : '运行集成'}
          </button>
        </div>
        {message && <p className="model-message">{message}</p>}
      </section>

      {result && (
        <section className="model-card">
          <div className="model-card-head"><h3>集成结果</h3></div>
          <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
            <div className="model-stat"><div className="model-stat-label">总样本</div><div className="model-stat-value">{result.total_samples as number || '-'}</div></div>
            <div className="model-stat"><div className="model-stat-label">集成正例率</div><div className="model-stat-value">{((result.ensemble_positive_rate as number) * 100).toFixed(1)}%</div></div>
            <div className="model-stat"><div className="model-stat-label">平均分歧</div><div className="model-stat-value">{((result.avg_divergence as number) * 100).toFixed(1)}%</div></div>
            <div className="model-stat"><div className="model-stat-label">风格分布</div><div className="model-stat-value">{((styleDist?.trend_pct as number) * 100).toFixed(0)}% 趋势 / {((styleDist?.reversal_pct as number) * 100).toFixed(0)}% 反转</div></div>
          </div>
          <div className="model-table-wrap">
            <table>
              <thead><tr><th>指标</th><th>集成</th><th>模型 A (趋势)</th><th>模型 B (反转)</th></tr></thead>
              <tbody>
                {['auc', 'accuracy', 'precision', 'recall', 'f1'].map((metric) => (
                  <tr key={metric}>
                    <td>{metric.toUpperCase()}</td>
                    <td className="compare-best">{formatMetric(ensembleMetrics, metric)}</td>
                    <td>{formatMetric(trendMetrics, metric)}</td>
                    <td>{formatMetric(reversalMetrics, metric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

export default EnsembleTab
