import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import type { PlatformResult, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'

type DatasetItem = {
  id: string
  name: string
  status: string
}

type AuditPayload = {
  dataset_id: string
  dataset_name: string
  dataset_status: string
  sample_count: number
  score: number
  verdict: string
  issues: string[]
  metrics: Record<string, number>
  preset?: string
  generated_at: string
}

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`

const toPayload = (raw: unknown): AuditPayload | null => {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  return {
    dataset_id: typeof x.dataset_id === 'string' ? x.dataset_id : '',
    dataset_name: typeof x.dataset_name === 'string' ? x.dataset_name : '',
    dataset_status: typeof x.dataset_status === 'string' ? x.dataset_status : '',
    sample_count: typeof x.sample_count === 'number' ? x.sample_count : 0,
    score: typeof x.score === 'number' ? x.score : 0,
    verdict: typeof x.verdict === 'string' ? x.verdict : 'unknown',
    issues: Array.isArray(x.issues) ? x.issues.filter((i): i is string => typeof i === 'string') : [],
    metrics: (x.metrics && typeof x.metrics === 'object' ? x.metrics as Record<string, number> : {}),
    generated_at: typeof x.generated_at === 'string' ? x.generated_at : '',
  }
}

const LabelQualityAuditPanel = () => {
  const [datasets, setDatasets] = useState<DatasetItem[]>([])
  const [datasetId, setDatasetId] = useState('')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [payload, setPayload] = useState<AuditPayload | null>(null)
  const [preset, setPreset] = useState<'strict' | 'balanced' | 'lenient'>('balanced')

  const loadDatasets = useCallback(async () => {
    const rows = await window.electronAPI?.listDatasets?.()
    if (!Array.isArray(rows)) {
      setDatasets([])
      return
    }
    const parsed = rows.map((row) => row as Record<string, unknown>).map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || row.id || ''),
      status: String(row.status || ''),
    })).filter((row) => row.id.length > 0)
    startTransition(() => {
      setDatasets(parsed)
    })
    if (!datasetId) {
      const preferred = parsed.find((d) => d.status === 'frozen') || parsed[0]
      if (preferred) {
        startTransition(() => {
          setDatasetId(preferred.id)
        })
      }
    }
  }, [datasetId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadDatasets()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [loadDatasets])

  const runAudit = useCallback(async () => {
    setRunning(true)
    setMessage('正在执行标签可学习性审计...')
    setPayload(null)

    const result = await window.electronAPI?.research?.labelQuality?.({
      datasetId: datasetId || undefined,
      preset,
    }) as PlatformResult<UnknownRecord> | undefined

    if (!result?.success) {
      setMessage(getPlatformErrorMessage(result, '审计失败'))
      setRunning(false)
      return
    }

    const parsed = toPayload(result.data)
    if (!parsed) {
      setMessage('审计结果格式异常')
      setRunning(false)
      return
    }
    setPayload(parsed)
    setMessage(`审计完成：${parsed.verdict}（score ${parsed.score.toFixed(1)}）`)
    setRunning(false)
  }, [datasetId, preset])

  const verdictTone = useMemo(() => {
    if (!payload) return ''
    if (payload.verdict === 'learnable') return 'positive'
    if (payload.verdict === 'moderate') return ''
    return 'negative'
  }, [payload])

  return (
    <div className="bt-basis-section">
      <div className="bt-section-head">
        <div className="bt-section-title">标签可学习性审计</div>
        <div className="bt-section-subtitle">只评估标签结构稳定性，不重复样本完整性审计。</div>
      </div>

      <div className="bt-controls" style={{ marginBottom: 8 }}>
        <div className="bt-control-group">
          <label>审计预设</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value as 'strict' | 'balanced' | 'lenient')}>
            <option value="strict">严格</option>
            <option value="balanced">平衡</option>
            <option value="lenient">宽松</option>
          </select>
        </div>
        <div className="bt-control-group">
          <label>数据集版本</label>
          <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
            {datasets.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name} ({d.status})
              </option>
            ))}
          </select>
        </div>
        <button className="bt-run-btn" onClick={runAudit} disabled={running}>
          {running ? '审计中...' : '运行审计'}
        </button>
      </div>

      {message && <div className={`bt-status ${running ? 'running' : 'empty'}`}>{message}</div>}

      {payload && (
        <>
          <div className="bt-summary-row" style={{ marginTop: 10 }}>
            <div className="bt-summary-card">
              <div className="bt-summary-label">Verdict</div>
              <div className={`bt-summary-value ${verdictTone}`}>{payload.verdict}</div>
              <div className="bt-summary-sub">数据集: {payload.dataset_name}</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">可学习性分数</div>
              <div className={`bt-summary-value ${verdictTone}`}>{payload.score.toFixed(1)}</div>
              <div className="bt-summary-sub">样本数 {payload.sample_count}</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">买卖比例</div>
              <div className="bt-summary-value">{pct(Number(payload.metrics.buy_ratio || 0))} / {pct(Number(payload.metrics.sell_ratio || 0))}</div>
              <div className="bt-summary-sub">buy / sell</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">时序漂移</div>
              <div className="bt-summary-value">{pct(Number(payload.metrics.drift_buy_ratio_train_valid_test || 0))}</div>
              <div className="bt-summary-sub">train/valid/test 买点比例差</div>
            </div>
            <div className="bt-summary-card">
              <div className="bt-summary-label">集中度</div>
              <div className="bt-summary-value">{pct(Number(payload.metrics.top10_code_share || 0))}</div>
              <div className="bt-summary-sub">Top10 股票样本占比</div>
            </div>
          </div>

          {payload.issues.length > 0 ? (
            <div className="bt-chip-row">
              {payload.issues.map((issue) => (
                <span className="bt-chip bt-chip-warn" key={issue}>{issue}</span>
              ))}
              <span className="bt-chip">预设: {payload.preset || preset}</span>
            </div>
          ) : (
            <div className="bt-chip-row">
              <span className="bt-chip">未发现显著可学习性风险</span>
              <span className="bt-chip">预设: {payload.preset || preset}</span>
              <span className="bt-chip">生成时间: {payload.generated_at.slice(0, 19).replace('T', ' ')}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default LabelQualityAuditPanel
