import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlatformResult, DatasetDeleteData } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { DatasetItem } from './types'
import { toDatasetItem, asString, asNumber } from './types'
import { formatTime } from './helpers'
import type { UnknownRecord } from '../../../types/ipc'

interface DatasetTabProps {
  onDatasetsChange: (datasets: DatasetItem[]) => void
}

interface SwingRunItem {
  runId: string
  runName: string
  sourceStrategy: string
  createdAt: number
  updatedAt: number
  total: number
  proposed: number
  accepted: number
  rejected: number
  stockCount: number
  pairCount: number
  state: string
}

const toSwingRunItem = (raw: UnknownRecord): SwingRunItem | null => {
  const runId = asString(raw.runId)
  if (!runId) return null
  return {
    runId,
    runName: asString(raw.runName),
    sourceStrategy: asString(raw.sourceStrategy),
    createdAt: asNumber(raw.createdAt, 0),
    updatedAt: asNumber(raw.updatedAt, 0),
    total: asNumber(raw.total, 0),
    proposed: asNumber(raw.proposed, 0),
    accepted: asNumber(raw.accepted, 0),
    rejected: asNumber(raw.rejected, 0),
    stockCount: asNumber(raw.stockCount, 0),
    pairCount: asNumber(raw.pairCount, 0),
    state: asString(raw.state, 'unknown'),
  }
}

const DatasetTab = ({ onDatasetsChange }: DatasetTabProps) => {
  const [datasets, setDatasets] = useState<DatasetItem[]>([])
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false)

  const [runs, setRuns] = useState<SwingRunItem[]>([])
  const [isLoadingRuns, setIsLoadingRuns] = useState(false)
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [includeRejectedRuns, setIncludeRejectedRuns] = useState(false)
  const [sourceStrategyFilter, setSourceStrategyFilter] = useState('')

  const [datasetName, setDatasetName] = useState('')
  const [datasetConflictPolicy, setDatasetConflictPolicy] = useState<'keep_all' | 'single_best'>('single_best')
  const [datasetStatusSource, setDatasetStatusSource] = useState<'accepted_only' | 'accepted_and_proposed'>('accepted_only')
  const [datasetLabelMode, setDatasetLabelMode] = useState<'raw' | 'triple_barrier' | 'binary_profit'>('raw')
  const [datasetMinProfit, setDatasetMinProfit] = useState(3)
  const [datasetMinDDRatio, setDatasetMinDDRatio] = useState(1.5)
  const [datasetMinHoldDays, setDatasetMinHoldDays] = useState(3)

  const [freezingDatasetId, setFreezingDatasetId] = useState('')
  const [rollingBackDatasetId, setRollingBackDatasetId] = useState('')
  const [deletingDatasetId, setDeletingDatasetId] = useState('')
  const [isCreatingDataset, setIsCreatingDataset] = useState(false)
  const [datasetMessage, setDatasetMessage] = useState('')

  const loadDatasets = useCallback(async () => {
    setIsLoadingDatasets(true)
    try {
      const rows = await window.electronAPI?.listDatasets?.()
      const parsed = (rows || []).map((row) => toDatasetItem(row as UnknownRecord)).filter((row): row is DatasetItem => row !== null)
      setDatasets(parsed)
      onDatasetsChange(parsed)
    } catch (error) {
      console.error('加载数据集失败:', error)
      setDatasets([])
    } finally {
      setIsLoadingDatasets(false)
    }
  }, [onDatasetsChange])

  const loadRuns = useCallback(async () => {
    setIsLoadingRuns(true)
    try {
      const result = await window.electronAPI?.listSwingLabelRuns?.({
        sourceStrategy: sourceStrategyFilter.trim() || undefined,
        includeRejected: includeRejectedRuns,
        limit: 120,
      }) as { success?: boolean; data?: { runs?: UnknownRecord[] } } | undefined
      const rows = (result?.data?.runs || []) as UnknownRecord[]
      const parsed = rows.map((row) => toSwingRunItem(row)).filter((row): row is SwingRunItem => row !== null)
      setRuns(parsed)
      setSelectedRunIds((prev) => prev.filter((id) => parsed.some((run) => run.runId === id)))
    } catch (error) {
      console.error('加载标签版本失败:', error)
      setRuns([])
    } finally {
      setIsLoadingRuns(false)
    }
  }, [sourceStrategyFilter, includeRejectedRuns])

  useEffect(() => { void loadDatasets() }, [loadDatasets])
  useEffect(() => { void loadRuns() }, [loadRuns])

  const toggleRunSelection = useCallback((runId: string) => {
    setSelectedRunIds((prev) => prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId])
  }, [])

  const handleSelectReadyRuns = useCallback(() => {
    const ready = runs.filter((run) => run.accepted > 0 || run.proposed > 0).map((run) => run.runId)
    setSelectedRunIds(ready)
  }, [runs])

  const handleReviewRun = useCallback(async (runId: string, decision: 'accept' | 'reject') => {
    setDatasetMessage('')
    try {
      const result = await window.electronAPI?.reviewSwingLabelRun?.({
        runId,
        decision,
        status: 'proposed',
      }) as { success?: boolean; data?: { updated?: number }; error?: { message?: string } } | undefined
      if (!result?.success) {
        setDatasetMessage(`版本审核失败：${result?.error?.message || '未知错误'}`)
        return
      }
      const updated = Number(result.data?.updated || 0)
      setDatasetMessage(`版本 ${runId} 已${decision === 'accept' ? '接受' : '拒绝'}，影响 ${updated} 条标签。`)
      await loadRuns()
    } catch (error) {
      console.error('版本审核失败:', error)
      setDatasetMessage('版本审核失败，请稍后重试。')
    }
  }, [loadRuns])

  const handleCreateDatasetFromRuns = useCallback(async () => {
    if (selectedRunIds.length === 0) {
      setDatasetMessage('请先选择至少一个标签版本。')
      return
    }
    setDatasetMessage('')
    setIsCreatingDataset(true)
    try {
      const result = await window.electronAPI?.createDatasetDraftFromRuns?.({
        runIds: selectedRunIds,
        name: datasetName.trim() || undefined,
        sourceStrategy: sourceStrategyFilter.trim() || undefined,
        conflictPolicy: datasetConflictPolicy,
        includeStatuses: datasetStatusSource === 'accepted_only' ? ['accepted'] : ['accepted', 'proposed'],
        limit: 50000,
        qualityFilter: {
          labelMode: datasetLabelMode,
          ...(datasetLabelMode !== 'raw' ? {
            minProfitPct: datasetMinProfit,
            minDrawdownRatio: datasetMinDDRatio,
            minHoldDays: datasetMinHoldDays,
          } : {}),
        },
      }) as { success?: boolean; data?: { importedCount?: number; selectedRunCount?: number }; error?: { message?: string } } | undefined
      if (!result?.success) {
        setDatasetMessage(`创建草稿失败：${result?.error?.message || '未知错误'}`)
        return
      }
      setDatasetMessage(`已创建草稿：来源版本 ${result.data?.selectedRunCount || selectedRunIds.length} 个，导入样本 ${result.data?.importedCount || 0} 条。`)
      await loadDatasets()
    } catch (error) {
      console.error('创建运行版本草稿失败:', error)
      setDatasetMessage('创建草稿失败，请稍后重试。')
    } finally {
      setIsCreatingDataset(false)
    }
  }, [selectedRunIds, datasetName, datasetConflictPolicy, datasetStatusSource, sourceStrategyFilter, loadDatasets, datasetLabelMode, datasetMinProfit, datasetMinDDRatio, datasetMinHoldDays])

  const handleFreezeDataset = useCallback(async (datasetId: string) => {
    setFreezingDatasetId(datasetId)
    setDatasetMessage('')
    try {
      const result = await window.electronAPI?.freezeDataset?.(datasetId) as { success?: boolean; error?: { message?: string } } | undefined
      if (!result?.success) {
        setDatasetMessage(`冻结失败：${result?.error?.message || datasetId}`)
        return
      }
      setDatasetMessage(`数据集 ${datasetId} 已冻结。`)
      await loadDatasets()
    } catch (error) {
      console.error('冻结数据集失败:', error)
      setDatasetMessage('冻结失败，请稍后重试。')
    } finally {
      setFreezingDatasetId('')
    }
  }, [loadDatasets])

  const handleRollbackDataset = useCallback(async (datasetId: string) => {
    setRollingBackDatasetId(datasetId)
    setDatasetMessage('')
    try {
      const result = await window.electronAPI?.rollbackDatasetToDraft?.(datasetId) as { success?: boolean; data?: { importedCount?: number }; error?: { message?: string } } | undefined
      if (!result?.success) {
        setDatasetMessage(`回滚失败：${result?.error?.message || datasetId}`)
        return
      }
      setDatasetMessage(`已回滚为草稿，导入样本 ${result.data?.importedCount || 0} 条。`)
      await loadDatasets()
    } catch (error) {
      console.error('回滚数据集失败:', error)
      setDatasetMessage('回滚失败，请稍后重试。')
    } finally {
      setRollingBackDatasetId('')
    }
  }, [loadDatasets])

  const handleDeleteDraftDataset = useCallback(async (dataset: DatasetItem) => {
    if (dataset.status !== 'draft') {
      setDatasetMessage('仅支持删除草稿数据集。')
      return
    }
    if (!window.confirm(`确认删除草稿数据集 ${dataset.name || dataset.id}？该操作不可恢复。`)) return
    setDeletingDatasetId(dataset.id)
    setDatasetMessage('')
    try {
      const result = await window.electronAPI?.deleteDraftDataset?.(dataset.id) as PlatformResult<DatasetDeleteData> | undefined
      if (!result?.success) {
        setDatasetMessage(getPlatformErrorMessage(result, '删除草稿数据集失败'))
        return
      }
      setDatasetMessage(`已删除草稿数据集 ${result.data.datasetName || result.data.datasetId}，移除样本 ${result.data.deletedItems} 条。`)
      await loadDatasets()
    } catch (error) {
      console.error('删除草稿数据集失败:', error)
      setDatasetMessage('删除草稿数据集失败，请稍后重试。')
    } finally {
      setDeletingDatasetId('')
    }
  }, [loadDatasets])

  const frozenDatasets = useMemo(() => datasets.filter((item) => item.status === 'frozen'), [datasets])
  const draftDatasets = useMemo(() => datasets.filter((item) => item.status !== 'frozen'), [datasets])

  return (
    <>
      <section className="model-card">
        <div className="model-card-head">
          <h3>标签版本库</h3>
          <div className="model-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => void loadRuns()} disabled={isLoadingRuns}>
              {isLoadingRuns ? '刷新中...' : '刷新版本'}
            </button>
          </div>
        </div>
        <div className="model-grid dataset-grid">
          <label>策略过滤
            <input value={sourceStrategyFilter} onChange={(e) => setSourceStrategyFilter(e.target.value)} placeholder="可留空（如 greedy_uptrend_segment_v1）" />
          </label>
          <label>包含已拒绝版本
            <select value={includeRejectedRuns ? 'yes' : 'no'} onChange={(e) => setIncludeRejectedRuns(e.target.value === 'yes')}>
              <option value="no">否（推荐）</option>
              <option value="yes">是</option>
            </select>
          </label>
          <div className="model-actions">
            <button className="btn btn-secondary" onClick={handleSelectReadyRuns} disabled={runs.length === 0}>选择可用版本</button>
          </div>
        </div>

        {isLoadingRuns ? (
          <div className="model-empty">正在加载标签版本...</div>
        ) : runs.length === 0 ? (
          <div className="model-empty">暂无标签版本，请先在“策略打标”生成一版标签。</div>
        ) : (
          <div className="model-table-wrap" style={{ marginTop: '0.75rem' }}>
            <table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>版本名</th>
                  <th>Run ID</th>
                  <th>策略</th>
                  <th>状态</th>
                  <th>股票数</th>
                  <th>交易对</th>
                  <th>总标签</th>
                  <th>待审</th>
                  <th>通过</th>
                  <th>拒绝</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td>
                      <input type="checkbox" checked={selectedRunIds.includes(run.runId)} onChange={() => toggleRunSelection(run.runId)} />
                    </td>
                    <td>{run.runName || '--'}</td>
                    <td>{run.runId}</td>
                    <td>{run.sourceStrategy || '--'}</td>
                    <td>{run.state}</td>
                    <td>{run.stockCount}</td>
                    <td>{run.pairCount}</td>
                    <td>{run.total}</td>
                    <td>{run.proposed}</td>
                    <td>{run.accepted}</td>
                    <td>{run.rejected}</td>
                    <td>{formatTime(run.createdAt)}</td>
                    <td>
                      <div className="review-actions">
                        <button className="btn btn-sm btn-secondary" disabled={run.proposed <= 0} onClick={() => void handleReviewRun(run.runId, 'accept')}>整版接受</button>
                        <button className="btn btn-sm btn-secondary" disabled={run.proposed <= 0} onClick={() => void handleReviewRun(run.runId, 'reject')}>整版拒绝</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="model-card">
        <div className="model-card-head">
          <h3>多版本构建数据集草稿</h3>
        </div>
        <div className="model-grid dataset-grid">
          <label>草稿名称
            <input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder="默认自动命名" />
          </label>
          <label>状态来源
            <select value={datasetStatusSource} onChange={(e) => setDatasetStatusSource(e.target.value as 'accepted_only' | 'accepted_and_proposed')}>
              <option value="accepted_only">仅 accepted（推荐）</option>
              <option value="accepted_and_proposed">accepted + proposed</option>
            </select>
          </label>
          <label>冲突策略
            <select value={datasetConflictPolicy} onChange={(e) => setDatasetConflictPolicy(e.target.value as 'keep_all' | 'single_best')}>
              <option value="single_best">同bar同类型最高分（推荐）</option>
              <option value="keep_all">保留全部</option>
            </select>
          </label>
          <label>标签模式
            <select value={datasetLabelMode} onChange={(e) => setDatasetLabelMode(e.target.value as 'raw' | 'triple_barrier' | 'binary_profit')}>
              <option value="raw">原始（不过滤）</option>
              <option value="triple_barrier">Triple Barrier（止盈/止损/中性）</option>
              <option value="binary_profit">仅保留盈利标签</option>
            </select>
          </label>
          {datasetLabelMode !== 'raw' && (
            <>
              <label>最低盈利%
                <input type="number" min={0} max={50} step={0.5} value={datasetMinProfit} onChange={(e) => setDatasetMinProfit(Number(e.target.value) || 0)} />
              </label>
              <label>盈利/回撤比 ≥
                <input type="number" min={0} max={10} step={0.1} value={datasetMinDDRatio} onChange={(e) => setDatasetMinDDRatio(Number(e.target.value) || 0)} />
              </label>
              <label>最短持仓(天)
                <input type="number" min={0} max={60} step={1} value={datasetMinHoldDays} onChange={(e) => setDatasetMinHoldDays(Number(e.target.value) || 0)} />
              </label>
            </>
          )}
          <div className="model-actions">
            <button className="btn btn-primary" onClick={() => void handleCreateDatasetFromRuns()} disabled={isCreatingDataset || selectedRunIds.length === 0}>
              {isCreatingDataset ? '创建中...' : `从已选 ${selectedRunIds.length} 个版本创建草稿`}
            </button>
          </div>
        </div>
        {datasetMessage && <p className="model-message">{datasetMessage}</p>}
      </section>

      <section className="model-card">
        <div className="model-card-head">
          <h3>数据集版本（草稿/冻结）</h3>
          <div className="model-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => void loadDatasets()} disabled={isLoadingDatasets}>
              {isLoadingDatasets ? '刷新中...' : '刷新数据集'}
            </button>
          </div>
        </div>

        <div className="model-summary">
          <span>草稿: {draftDatasets.length}</span>
          <span>冻结: {frozenDatasets.length}</span>
          <span>总数: {datasets.length}</span>
        </div>

        {isLoadingDatasets ? (
          <div className="model-empty">正在加载数据集...</div>
        ) : datasets.length === 0 ? (
          <div className="model-empty">暂无数据集，请先从标签版本创建草稿。</div>
        ) : (
          <div className="model-table-wrap" style={{ marginTop: '0.75rem' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>状态</th>
                  <th>样本数</th>
                  <th>创建时间</th>
                  <th>冻结时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>{dataset.id}</td>
                    <td>{dataset.name}</td>
                    <td><span className={`candidate-status status-${dataset.status}`}>{dataset.status === 'frozen' ? '已冻结' : '草稿'}</span></td>
                    <td>{dataset.sampleCount}</td>
                    <td>{formatTime(dataset.createdAt)}</td>
                    <td>{formatTime(dataset.frozenAt)}</td>
                    <td>
                      {dataset.status === 'draft' ? (
                        <div className="review-actions">
                          <button className="btn btn-sm btn-secondary" disabled={freezingDatasetId === dataset.id || deletingDatasetId === dataset.id} onClick={() => void handleFreezeDataset(dataset.id)}>
                            {freezingDatasetId === dataset.id ? '冻结中...' : '冻结'}
                          </button>
                          <button className="btn btn-sm btn-secondary" disabled={deletingDatasetId === dataset.id || freezingDatasetId === dataset.id} onClick={() => void handleDeleteDraftDataset(dataset)}>
                            {deletingDatasetId === dataset.id ? '删除中...' : '删除草稿'}
                          </button>
                        </div>
                      ) : (
                        <button className="btn btn-sm btn-secondary" disabled={rollingBackDatasetId === dataset.id} onClick={() => void handleRollbackDataset(dataset.id)}>
                          {rollingBackDatasetId === dataset.id ? '回滚中...' : '回滚为草稿'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

export default DatasetTab
