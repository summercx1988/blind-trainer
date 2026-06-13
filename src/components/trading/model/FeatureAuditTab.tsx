import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlatformResult, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { FeatureBuildTaskItem } from './types'
import { toFeatureBuildTaskItem } from './types'
import { formatTime } from './helpers'

const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const asNumber = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback

interface SplitStats {
  rows: number
  buy_count: number
  sell_count: number
  buy_rate: number
  start_date: string
  end_date: string
  monotonic_ts: boolean
  unique_codes: number
  feature_missing_ratio: number
}

interface SampleAuditPayload {
  spec_version: string
  lookback_bars: number
  feature_count: number
  split_stats: {
    train: SplitStats
    valid: SplitStats
    test: SplitStats
  }
  summary: {
    total_rows: number
    total_buy: number
    total_sell: number
    buy_rate: number
    start_date: string
    end_date: string
    warnings: string[]
  }
}

const toSplit = (raw: UnknownRecord | null | undefined): SplitStats => ({
  rows: asNumber(raw?.rows),
  buy_count: asNumber(raw?.buy_count),
  sell_count: asNumber(raw?.sell_count),
  buy_rate: asNumber(raw?.buy_rate),
  start_date: asString(raw?.start_date),
  end_date: asString(raw?.end_date),
  monotonic_ts: raw?.monotonic_ts !== false,
  unique_codes: asNumber(raw?.unique_codes),
  feature_missing_ratio: asNumber(raw?.feature_missing_ratio),
})

const toAudit = (raw: UnknownRecord | null | undefined): SampleAuditPayload | null => {
  if (!raw) return null
  const splitStatsRaw = raw.split_stats && typeof raw.split_stats === 'object' ? raw.split_stats as UnknownRecord : {}
  const summaryRaw = raw.summary && typeof raw.summary === 'object' ? raw.summary as UnknownRecord : {}
  return {
    spec_version: asString(raw.spec_version),
    lookback_bars: asNumber(raw.lookback_bars),
    feature_count: asNumber(raw.feature_count),
    split_stats: {
      train: toSplit(splitStatsRaw.train as UnknownRecord),
      valid: toSplit(splitStatsRaw.valid as UnknownRecord),
      test: toSplit(splitStatsRaw.test as UnknownRecord),
    },
    summary: {
      total_rows: asNumber(summaryRaw.total_rows),
      total_buy: asNumber(summaryRaw.total_buy),
      total_sell: asNumber(summaryRaw.total_sell),
      buy_rate: asNumber(summaryRaw.buy_rate),
      start_date: asString(summaryRaw.start_date),
      end_date: asString(summaryRaw.end_date),
      warnings: Array.isArray(summaryRaw.warnings) ? summaryRaw.warnings.filter((x): x is string => typeof x === 'string') : [],
    }
  }
}

const pct = (value: number): string => `${(value * 100).toFixed(2)}%`

const FeatureAuditTab = () => {
  const [featureTasks, setFeatureTasks] = useState<FeatureBuildTaskItem[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [audit, setAudit] = useState<SampleAuditPayload | null>(null)
  const [message, setMessage] = useState('')

  const succeededTasks = useMemo(
    () => featureTasks.filter((task) => task.status === 'succeeded' && task.manifestPath),
    [featureTasks]
  )

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true)
    try {
      const rows = await window.electronAPI?.listFeatureBuildTasks?.(undefined, 100)
      const parsed = (rows || [])
        .map((row) => toFeatureBuildTaskItem(row as UnknownRecord))
        .filter((row): row is FeatureBuildTaskItem => row !== null)
      setFeatureTasks(parsed)
      if (!selectedTaskId && parsed.length > 0) {
        const latestSucceeded = parsed.find((task) => task.status === 'succeeded' && task.manifestPath)
        if (latestSucceeded) setSelectedTaskId(latestSucceeded.id)
      }
    } catch (error) {
      console.error('加载特征任务失败:', error)
      setFeatureTasks([])
    } finally {
      setLoadingTasks(false)
    }
  }, [selectedTaskId])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const handleRunAudit = useCallback(async () => {
    if (!selectedTaskId) {
      setMessage('请先选择已成功的特征构建任务。')
      return
    }
    setLoadingAudit(true)
    setMessage('')
    try {
      const result = await window.electronAPI?.getFeatureSampleAudit?.(selectedTaskId) as PlatformResult<{
        audit?: UnknownRecord
      }> | undefined
      if (!result?.success) {
        setAudit(null)
        setMessage(getPlatformErrorMessage(result, '样本审计失败'))
        return
      }
      const payload = toAudit((result.data as UnknownRecord).audit as UnknownRecord)
      if (!payload) {
        setAudit(null)
        setMessage('样本审计返回为空。')
        return
      }
      setAudit(payload)
      setMessage('样本审计已完成。')
    } catch (error) {
      console.error('样本审计失败:', error)
      setAudit(null)
      setMessage('样本审计失败，请稍后重试。')
    } finally {
      setLoadingAudit(false)
    }
  }, [selectedTaskId])

  const selectedTask = succeededTasks.find((task) => task.id === selectedTaskId) || null

  return (
    <>
      <section className="model-card">
        <div className="model-card-head">
          <h3>特征构建样本审计</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => void loadTasks()} disabled={loadingTasks}>
            {loadingTasks ? '刷新中...' : '刷新'}
          </button>
        </div>
        <div className="model-desc">
          审计目标：检查样本时间切分、标签分布、缺失率与潜在未来信息风险（独立于 Alpha 研究页）。
        </div>
        <div className="model-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <label>特征构建任务
            <select value={selectedTaskId} onChange={(e) => setSelectedTaskId(e.target.value)}>
              <option value="">请选择已成功任务</option>
              {succeededTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.datasetName ? `${task.datasetName} (${task.datasetId})` : task.datasetId} | {task.specVersion} | {formatTime(task.finishedAt)}
                </option>
              ))}
            </select>
          </label>
          <div className="model-actions" style={{ paddingTop: 18 }}>
            <button className="btn btn-primary" onClick={() => void handleRunAudit()} disabled={loadingAudit || !selectedTaskId}>
              {loadingAudit ? '审计中...' : '运行审计'}
            </button>
          </div>
        </div>
        {selectedTask && (
          <div className="model-desc" style={{ marginTop: 8 }}>
            任务ID: {selectedTask.id} | 数据集: {selectedTask.datasetName ? `${selectedTask.datasetName} (${selectedTask.datasetId})` : selectedTask.datasetId} | 规格: {selectedTask.specVersion}
          </div>
        )}
        {message && <p className="model-message">{message}</p>}
      </section>

      {audit && (
        <>
          <section className="model-card">
            <div className="model-card-head"><h3>审计摘要</h3></div>
            <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="model-stat"><div className="model-stat-label">样本总数</div><div className="model-stat-value">{audit.summary.total_rows}</div></div>
              <div className="model-stat"><div className="model-stat-label">买点占比</div><div className="model-stat-value">{pct(audit.summary.buy_rate)}</div></div>
              <div className="model-stat"><div className="model-stat-label">特征数</div><div className="model-stat-value">{audit.feature_count}</div></div>
              <div className="model-stat"><div className="model-stat-label">回看窗口</div><div className="model-stat-value">{audit.lookback_bars} bars</div></div>
            </div>
            <div className="model-desc" style={{ marginTop: 8 }}>
              时间范围: {audit.summary.start_date || '-'} ~ {audit.summary.end_date || '-'} | 标签: buy={audit.summary.total_buy}, sell={audit.summary.total_sell}
            </div>
            {audit.summary.warnings.length > 0 && (
              <div style={{ marginTop: 10, color: '#e67e22' }}>
                {audit.summary.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`}>- {warning}</div>
                ))}
              </div>
            )}
          </section>

          <section className="model-card">
            <div className="model-card-head"><h3>分割明细</h3></div>
            <div className="model-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Split</th>
                    <th>样本数</th>
                    <th>买点</th>
                    <th>卖点</th>
                    <th>买点占比</th>
                    <th>时间范围</th>
                    <th>股票数</th>
                    <th>缺失率</th>
                    <th>时间有序</th>
                  </tr>
                </thead>
                <tbody>
                  {(['train', 'valid', 'test'] as const).map((key) => {
                    const split = audit.split_stats[key]
                    return (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>{split.rows}</td>
                        <td>{split.buy_count}</td>
                        <td>{split.sell_count}</td>
                        <td>{pct(split.buy_rate)}</td>
                        <td>{split.start_date || '-'} ~ {split.end_date || '-'}</td>
                        <td>{split.unique_codes}</td>
                        <td>{pct(split.feature_missing_ratio)}</td>
                        <td>{split.monotonic_ts ? '是' : '否'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  )
}

export default FeatureAuditTab
