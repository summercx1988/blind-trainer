import { useCallback, useEffect, useState } from 'react'
import type {
  ModelActivationData,
  ModelArtifactPayload,
  ModelArtifactSyncData,
  ModelDescriptionData,
  ModelMutationData,
  ModelRenameData,
  ModelReportPayload,
  PlatformResult,
  UnknownRecord
} from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { ModelVersionItem, ModelEvaluationItem, SignalEventItem } from './types'
import { toModelVersionItem, toModelEvaluationItem, toSignalEventItem } from './types'
import { formatTime, readTestAccuracy, readTestAuc, readTestF1 } from './helpers'

interface ArtifactData {
  feature_importance: Record<string, number>
  best_params: Record<string, unknown>
  threshold: number
  num_trees: number
  optuna_trials: number
  model_type: string
}

const readTestMetricNumber = (model: ModelVersionItem, metric: 'accuracy' | 'precision' | 'recall' | 'f1' | 'auc'): number | null => {
  const colMap: Record<string, keyof ModelVersionItem> = {
    accuracy: 'testAccuracy', precision: 'testPrecision', recall: 'testRecall', f1: 'testF1', auc: 'testAuc'
  }
  const col = colMap[metric]
  if (col) {
    const val = model[col]
    if (val != null && typeof val === 'number') return val
  }
  if (!model.metricsJson) return null
  try {
    const payload = JSON.parse(model.metricsJson) as Record<string, unknown>
    const test = payload.test
    if (!test || typeof test !== 'object') return null
    const value = (test as Record<string, unknown>)[metric]
    return typeof value === 'number' ? value : null
  } catch {
    return null
  }
}

interface RecommendationCandidate {
  model: ModelVersionItem
  score: number
  auc: number | null
  f1: number | null
  precision: number | null
  recall: number | null
}

interface RecommendationResult {
  candidate: RecommendationCandidate | null
  level: 'accepted' | 'proposed' | 'rejected'
  label: string
  reason: string
}

const formatMetricPercent = (value: number | null): string => value === null ? '-' : `${(value * 100).toFixed(1)}%`

const buildRecommendation = (models: ModelVersionItem[]): RecommendationResult => {
  const candidates = models
    .filter((model) => model.status !== 'active')
    .map((model) => {
      const auc = readTestMetricNumber(model, 'auc')
      const f1 = readTestMetricNumber(model, 'f1')
      const precision = readTestMetricNumber(model, 'precision')
      const recall = readTestMetricNumber(model, 'recall')
      const score = (auc ?? 0) * 0.55 + (f1 ?? 0) * 0.25 + (precision ?? 0) * 0.1 + (recall ?? 0) * 0.1
      return { model, score, auc, f1, precision, recall }
    })
    .filter((item) => item.auc !== null || item.f1 !== null)
    .sort((left, right) => right.score - left.score || (right.auc ?? 0) - (left.auc ?? 0))

  const selected = candidates[0] || null
  if (!selected) {
    return {
      candidate: null,
      level: 'rejected',
      label: '暂无候选',
      reason: '暂无可比较的测试指标，请先同步模型产物并完成评估。'
    }
  }

  const metricsText = `AUC ${formatMetricPercent(selected.auc)} / F1 ${formatMetricPercent(selected.f1)} / Precision ${formatMetricPercent(selected.precision)} / Recall ${formatMetricPercent(selected.recall)}`

  if ((selected.auc ?? 0) >= 0.62 && (selected.f1 ?? 0) >= 0.5 && (selected.precision ?? 0) >= 0.48 && (selected.recall ?? 0) >= 0.48) {
    return {
      candidate: selected,
      level: 'accepted',
      label: '可激活',
      reason: `测试指标达到激活阈值，${metricsText}。`
    }
  }

  if ((selected.auc ?? 0) >= 0.57 && (selected.f1 ?? 0) >= 0.45) {
    return {
      candidate: selected,
      level: 'proposed',
      label: '观察',
      reason: `测试指标接近阈值，建议继续积累样本再评估，${metricsText}。`
    }
  }

  return {
    candidate: selected,
    level: 'rejected',
    label: '不建议',
    reason: `当前测试指标偏弱，不建议直接激活，${metricsText}。`
  }
}

const summarizeSignals = (signals: SignalEventItem[]) => {
  const statusCounts = signals.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.status] = (acc[signal.status] || 0) + 1
    return acc
  }, {})
  const lastSignal = signals[0] || null
  return {
    total: signals.length,
    statusCounts,
    lastSignal,
  }
}

const RegistryTab = () => {
  const [models, setModels] = useState<ModelVersionItem[]>([])
  const [evaluations, setEvaluations] = useState<ModelEvaluationItem[]>([])
  const [activeModel, setActiveModel] = useState<ModelVersionItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activatingModelId, setActivatingModelId] = useState('')
  const [message, setMessage] = useState('')
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null)

  // Edit states
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [editingDescId, setEditingDescId] = useState<string | null>(null)
  const [editingDescValue, setEditingDescValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Artifact + report states
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactData>>({})
  const [reportContent, setReportContent] = useState<string | null>(null)
  const [reportModelId, setReportModelId] = useState<string | null>(null)
  const [syncingArtifacts, setSyncingArtifacts] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncSummary, setSyncSummary] = useState<ModelArtifactSyncData | null>(null)
  const [signalEvents, setSignalEvents] = useState<SignalEventItem[]>([])

  // Filter/sort
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('date')

  // Feature selection state (client-side computed)
  const [featureSelectionResult, setFeatureSelectionResult] = useState<Record<string, unknown> | null>(null)
  const [featureSelectionModelId, setFeatureSelectionModelId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [versionRows, evalRows, activeRow, signalRows] = await Promise.all([
        window.electronAPI?.listModels?.(),
        window.electronAPI?.listModelEvaluations?.('', 100),
        window.electronAPI?.getActiveModel?.(),
        window.electronAPI?.listSignalEvents?.({ limit: 20 }),
      ])
      setModels((versionRows || []).map((row) => toModelVersionItem(row as UnknownRecord)).filter((row): row is ModelVersionItem => row !== null))
      setEvaluations((evalRows || []).map((row) => toModelEvaluationItem(row as UnknownRecord)).filter((row): row is ModelEvaluationItem => row !== null))
      setSignalEvents((signalRows || []).map((row) => toSignalEventItem(row as UnknownRecord)).filter((row): row is SignalEventItem => row !== null))
      if (activeRow) {
        setActiveModel(toModelVersionItem(activeRow as UnknownRecord))
      } else {
        setActiveModel(null)
      }
    } catch (error) {
      console.error('加载模型数据失败:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const loadArtifact = useCallback(async (modelId: string) => {
    if (artifacts[modelId]) return
    try {
      const result = await window.electronAPI?.getModelArtifact?.(modelId) as PlatformResult<ModelArtifactPayload> | undefined
      if (result?.success) {
        setArtifacts((prev) => ({ ...prev, [modelId]: result.data.artifact as unknown as ArtifactData }))
      }
    } catch { /* ignore */ }
  }, [artifacts])

  const handleActivate = useCallback(async (modelId: string) => {
    setActivatingModelId(modelId); setMessage('')
    try {
      const result = await window.electronAPI?.activateModel?.(modelId) as PlatformResult<ModelActivationData> | undefined
      if (result?.success) {
        setMessage(`模型已激活: ${result.data.modelId.slice(0, 12)}`)
        await loadData()
      } else {
        setMessage(getPlatformErrorMessage(result, '激活失败'))
      }
    } catch { setMessage('激活异常') }
    finally { setActivatingModelId('') }
  }, [loadData])

  const handleDeactivate = useCallback(async () => {
    if (!activeModel) return
    setMessage('')
    try {
      const result = await window.electronAPI?.deactivateModel?.(activeModel.id) as PlatformResult<ModelMutationData> | undefined
      if (result?.success) {
        setMessage('已停用活跃模型')
        await loadData()
      } else {
        setMessage(getPlatformErrorMessage(result, '停用失败'))
      }
    } catch { setMessage('停用异常') }
  }, [activeModel, loadData])

  const handleRename = useCallback(async (modelId: string) => {
    if (!editingNameValue.trim()) return
    try {
      const result = await window.electronAPI?.renameModel?.(modelId, editingNameValue.trim()) as PlatformResult<ModelRenameData> | undefined
      if (result?.success) {
        setEditingNameId(null)
        await loadData()
      } else {
        setMessage(getPlatformErrorMessage(result, '重命名失败'))
      }
    } catch { /* ignore */ }
  }, [editingNameValue, loadData])

  const handleSaveDescription = useCallback(async (modelId: string) => {
    try {
      const result = await window.electronAPI?.updateModelDescription?.(modelId, editingDescValue) as PlatformResult<ModelDescriptionData> | undefined
      if (result?.success) {
        setEditingDescId(null)
        await loadData()
      } else {
        setMessage(getPlatformErrorMessage(result, '保存描述失败'))
      }
    } catch { /* ignore */ }
  }, [editingDescValue, loadData])

  const handleDelete = useCallback(async (modelId: string) => {
    try {
      const result = await window.electronAPI?.deleteModel?.(modelId) as PlatformResult<ModelMutationData> | undefined
      if (result?.success) {
        setConfirmDeleteId(null)
        const deletedRecommendations = Number(result.data.deletedRecommendations || 0)
        const deletedSignals = Number(result.data.deletedSignalEvents || 0)
        setMessage(`模型已删除；同步清理推荐复盘 ${deletedRecommendations} 条、信号事件 ${deletedSignals} 条。`)
        await loadData()
      } else {
        setMessage(getPlatformErrorMessage(result, '删除失败'))
        setConfirmDeleteId(null)
      }
    } catch { setMessage('删除异常') }
  }, [loadData])

  const handleViewReport = useCallback(async (modelId: string) => {
    if (reportModelId === modelId) { setReportModelId(null); setReportContent(null); return }
    try {
      const result = await window.electronAPI?.getModelReport?.(modelId) as PlatformResult<ModelReportPayload> | undefined
      if (result?.success) {
        setReportContent(result.data.content)
        setReportModelId(modelId)
      } else {
        setMessage(getPlatformErrorMessage(result, '报告不可用'))
      }
    } catch { setMessage('读取报告失败') }
  }, [reportModelId])

  const handleSyncArtifacts = useCallback(async () => {
    setSyncingArtifacts(true)
    setSyncMessage('')
    try {
      const result = await window.electronAPI?.syncModelArtifacts?.() as PlatformResult<{ summary: ModelArtifactSyncData }> | undefined
      if (result?.success) {
        setSyncSummary(result.data.summary)
        setSyncMessage(`同步完成：导入 ${result.data.summary.importedCount} 个，更新 ${result.data.summary.updatedCount} 个，跳过 ${result.data.summary.skippedCount} 个。`)
        await loadData()
      } else {
        setSyncMessage(getPlatformErrorMessage(result, '模型产物同步失败'))
      }
    } catch (error) {
      console.error('同步模型产物失败:', error)
      setSyncMessage('模型产物同步失败')
    } finally {
      setSyncingArtifacts(false)
    }
  }, [loadData])

  const getModelEvals = (modelId: string) => evaluations.filter((e) => e.modelId === modelId)
  const recommendation = buildRecommendation(models)
  const recommendedModel = recommendation.candidate?.model || null
  const signalSummary = summarizeSignals(signalEvents)

  const handleToggleExpand = useCallback((modelId: string) => {
    setExpandedModelId((prev) => prev === modelId ? null : modelId)
    void loadArtifact(modelId)
  }, [loadArtifact])

  const filteredModels = models
    .filter((m) => statusFilter === 'all' || m.status === statusFilter)
    .sort((a, b) => {
      if (sortBy === 'accuracy') {
        const left = readTestMetricNumber(a, 'accuracy') ?? -1
        const right = readTestMetricNumber(b, 'accuracy') ?? -1
        return right - left || b.createdAt - a.createdAt
      }
      return b.createdAt - a.createdAt
    })

  return (
    <>
      {activeModel && (
        <section className="model-card model-active-banner">
          <div className="model-card-head">
            <h3>当前活跃模型</h3>
            <div className="model-action-group">
              <span className="candidate-status status-accepted">ACTIVE</span>
              <button className="btn btn-sm btn-warn" onClick={() => void handleDeactivate()}>停用</button>
            </div>
          </div>
          <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div><span className="model-stat-label">名称</span><div><strong>{activeModel.name}</strong></div></div>
            <div><span className="model-stat-label">Test AUC</span><div>{readTestAuc(activeModel.metricsJson, activeModel.testAuc)}</div></div>
            <div><span className="model-stat-label">创建时间</span><div>{formatTime(activeModel.createdAt)}</div></div>
            <div><span className="model-stat-label">ID</span><div className="reason-cell">{activeModel.id.slice(0, 20)}</div></div>
          </div>
          {activeModel.description && (
            <p style={{ marginTop: 8, color: '#6b7280', fontSize: '0.82rem' }}>{activeModel.description}</p>
          )}
        </section>
      )}

      <section className="model-card">
        <div className="model-card-head">
          <h3>模型产物同步</h3>
          <button className="btn btn-primary btn-sm" onClick={() => void handleSyncArtifacts()} disabled={syncingArtifacts}>
            {syncingArtifacts ? '同步中...' : '扫描并导入'}
          </button>
        </div>
        <p className="model-desc">扫描 `models/` 与 `python/models/`，把文件里的模型产物、训练任务和评估记录补进仓库。</p>
        {syncMessage && <p className="model-message">{syncMessage}</p>}
        {syncSummary && (
          <>
            <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div><span className="model-stat-label">扫描</span><div><strong>{syncSummary.scannedCount}</strong></div></div>
              <div><span className="model-stat-label">导入</span><div><strong>{syncSummary.importedCount}</strong></div></div>
              <div><span className="model-stat-label">更新</span><div><strong>{syncSummary.updatedCount}</strong></div></div>
              <div><span className="model-stat-label">跳过</span><div><strong>{syncSummary.skippedCount}</strong></div></div>
            </div>
            <div className="model-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 8 }}>
              <div><span className="model-stat-label">数据集占位</span><div><strong>{syncSummary.datasetCreatedCount}</strong></div></div>
              <div><span className="model-stat-label">任务占位</span><div><strong>{syncSummary.taskCreatedCount}</strong></div></div>
              <div><span className="model-stat-label">评估条目</span><div><strong>{syncSummary.evaluationCount}</strong></div></div>
            </div>
            {syncSummary.items.length > 0 && (
              <div className="model-table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>动作</th>
                      <th>规格</th>
                      <th>数据集</th>
                      <th>产物</th>
                      <th>报告</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncSummary.items.slice(0, 8).map((item) => (
                      <tr key={`${item.modelId}_${item.artifactPath}`}>
                        <td>{item.modelName}<br /><span className="model-id-sub">{item.modelId.slice(0, 16)}</span></td>
                        <td><span className={`candidate-status status-${item.action === 'imported' ? 'accepted' : item.action === 'updated' ? 'proposed' : 'rejected'}`}>{item.action}</span></td>
                        <td>{item.specVersion}<br /><span className="reason-cell">{item.modelType}</span></td>
                        <td>{item.datasetId}</td>
                        <td className="reason-cell">{item.artifactPath}</td>
                        <td className="reason-cell">{item.reportPath || '-'}</td>
                        <td className="reason-cell">{item.reason || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="model-card">
        <div className="model-card-head">
          <h3>部署态势</h3>
        </div>
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div>
            <span className="model-stat-label">活跃模型</span>
            <div><strong>{activeModel?.name || '未激活'}</strong></div>
            <div className="reason-cell">{activeModel ? `${activeModel.specVersion} / ${readTestAccuracy(activeModel.metricsJson, activeModel.testAccuracy)}` : '-'}</div>
          </div>
          <div>
            <span className="model-stat-label">推荐候选</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{recommendedModel?.name || '暂无候选'}</strong>
              {recommendedModel && (
                <span className={`candidate-status status-${recommendation.level}`}>{recommendation.label}</span>
              )}
            </div>
            <div className="reason-cell">
              {recommendedModel
                ? `${recommendedModel.specVersion} / ${readTestAccuracy(recommendedModel.metricsJson, recommendedModel.testAccuracy)} / 综合 ${((recommendation.candidate?.score ?? 0) * 100).toFixed(1)}%`
                : '先同步产物再看推荐'}
            </div>
            <div className="reason-cell" style={{ marginTop: 2, color: '#6b7280' }}>{recommendation.reason}</div>
          </div>
          <div>
            <span className="model-stat-label">最近信号</span>
            <div><strong>{signalSummary.lastSignal ? `${signalSummary.lastSignal.code} ${signalSummary.lastSignal.signalType}` : '暂无提醒'}</strong></div>
            <div className="reason-cell">{signalSummary.lastSignal ? `${signalSummary.lastSignal.period} / ${formatTime(signalSummary.lastSignal.createdAt)}` : '尚未触发推理'}</div>
          </div>
        </div>
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 10 }}>
          <div><span className="model-stat-label">信号总数</span><div><strong>{signalSummary.total}</strong></div></div>
          <div><span className="model-stat-label">新提醒</span><div><strong>{signalSummary.statusCounts.new || 0}</strong></div></div>
          <div><span className="model-stat-label">已反馈</span><div><strong>{signalSummary.statusCounts.feedback || 0}</strong></div></div>
          <div><span className="model-stat-label">已忽略</span><div><strong>{signalSummary.statusCounts.ignored || 0}</strong></div></div>
        </div>
        <p className="model-subtle">分级规则：可激活（AUC ≥ 62%，F1 ≥ 50%）；观察（AUC ≥ 57%，F1 ≥ 45%）；其余不建议直接激活。</p>
        {signalEvents.length > 0 && (
          <div className="model-table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模型</th>
                  <th>标的</th>
                  <th>周期</th>
                  <th>信号</th>
                  <th>置信度</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {signalEvents.slice(0, 6).map((signal) => (
                  <tr key={signal.id}>
                    <td>{formatTime(signal.createdAt)}</td>
                    <td>{signal.modelName || signal.modelId.slice(0, 12)}</td>
                    <td>{signal.code}</td>
                    <td>{signal.period}</td>
                    <td className={signal.signalType === 'buy' ? 'signal-buy' : 'signal-sell'}>{signal.signalType === 'buy' ? '买点' : '卖点'}</td>
                    <td>{(signal.confidence * 100).toFixed(1)}%</td>
                    <td><span className={`candidate-status status-${signal.status}`}>{signal.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="model-card">
        <div className="model-card-head">
          <h3>所有模型 ({filteredModels.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => void loadData()} disabled={isLoading}>{isLoading ? '刷新中...' : '刷新'}</button>
        </div>
        {message && <p className="model-message">{message}</p>}
        <div className="model-filters">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">全部状态</option>
            <option value="active">已激活</option>
            <option value="inactive">未激活</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date">按时间</option>
            <option value="accuracy">按准确率</option>
          </select>
        </div>
        {filteredModels.length === 0 ? (<div className="model-empty">暂无模型版本。</div>) : (
          <div className="model-table-wrap">
            <table>
              <thead><tr><th>名称</th><th>状态</th><th>Test AUC</th><th>Acc</th><th>F1</th><th>Spec</th><th>创建</th><th>操作</th></tr></thead>
              <tbody>
                {filteredModels.map((model) => {
                  const isExpanded = expandedModelId === model.id
                  const modelEvals = isExpanded ? getModelEvals(model.id) : []
                  const artifact = artifacts[model.id]
                  const isEditingName = editingNameId === model.id
                  const isConfirmingDelete = confirmDeleteId === model.id
                  return (
                    <>
                      <tr key={model.id} className={model.status === 'active' ? 'task-row-active' : ''}>
                        <td>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleToggleExpand(model.id)} style={{ marginRight: 6, padding: '1px 6px' }}>
                            {isExpanded ? '\u2212' : '+'}
                          </button>
                          {isEditingName ? (
                            <input
                              className="model-inline-input"
                              value={editingNameValue}
                              onChange={(e) => setEditingNameValue(e.target.value)}
                              onBlur={() => void handleRename(model.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void handleRename(model.id); if (e.key === 'Escape') setEditingNameId(null) }}
                              autoFocus
                            />
                          ) : (
                            <span onClick={() => { setEditingNameId(model.id); setEditingNameValue(model.name) }} style={{ cursor: 'pointer' }} title="点击重命名">
                              {model.name}
                            </span>
                          )}
                          <br /><span className="model-id-sub">{model.id.slice(0, 16)}</span>
                        </td>
                        <td><span className={`candidate-status status-${model.status === 'active' ? 'accepted' : 'proposed'}`}>{model.status === 'active' ? '已激活' : '未激活'}</span></td>
                        <td>{readTestAuc(model.metricsJson, model.testAuc)}</td>
                        <td>{readTestAccuracy(model.metricsJson, model.testAccuracy)}</td>
                        <td>{readTestF1(model.metricsJson, model.testF1)}</td>
                        <td>{model.specVersion}</td>
                        <td>{formatTime(model.createdAt)}</td>
                        <td>
                          <div className="model-action-group">
                            {model.status !== 'active' && (
                              <button className="btn btn-sm btn-accept" disabled={activatingModelId === model.id} onClick={() => void handleActivate(model.id)}>
                                {activatingModelId === model.id ? '...' : '激活'}
                              </button>
                            )}
	                            {model.status === 'active' ? (
	                              <span className="reason-cell">先停用后删除</span>
	                            ) : isConfirmingDelete ? (
	                              <button className="btn btn-sm btn-danger" onClick={() => void handleDelete(model.id)}>确认删除</button>
	                            ) : (
	                              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteId(model.id)}>删除模型</button>
	                            )}
                            {isConfirmingDelete && (
                              <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDeleteId(null)}>取消</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${model.id}_detail`}>
                          <td colSpan={8} style={{ padding: '4px 12px 12px 36px', background: '#f9fafb' }}>
                            <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 8 }}>
                              <div><span className="model-stat-label">任务类型</span><div>{model.taskType}</div></div>
                              <div><span className="model-stat-label">数据集</span><div>{model.datasetId.slice(0, 24)}</div></div>
                              <div><span className="model-stat-label">激活时间</span><div>{model.activatedAt ? formatTime(model.activatedAt) : '-'}</div></div>
                              <div>
                                <button className="btn btn-sm btn-secondary" onClick={() => void handleViewReport(model.id)}>
                                  {reportModelId === model.id ? '关闭报告' : '查看报告'}
                                </button>
                              </div>
                            </div>

                            {artifact && (
                              <div style={{ marginBottom: 8 }}>
                                <span className="model-stat-label">训练参数</span>
                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4, fontSize: '0.82rem', color: '#4b5563' }}>
                                  <span>类型: <strong>{artifact.model_type}</strong></span>
                                  <span>树数: <strong>{artifact.num_trees}</strong></span>
                                  <span>Optuna: <strong>{artifact.optuna_trials} trials</strong></span>
                                  <span>阈值: <strong>{artifact.threshold.toFixed(3)}</strong></span>
                                  {artifact.best_params.num_leaves !== undefined && <span>num_leaves: <strong>{String(artifact.best_params.num_leaves)}</strong></span>}
                                  {artifact.best_params.max_depth !== undefined && <span>max_depth: <strong>{String(artifact.best_params.max_depth)}</strong></span>}
                                  {artifact.best_params.learning_rate !== undefined && <span>lr: <strong>{Number(artifact.best_params.learning_rate).toFixed(4)}</strong></span>}
                                </div>
                              </div>
                            )}

                            {artifact && Object.keys(artifact.feature_importance).length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <span className="model-stat-label">Feature Importance (Top 10)</span>
                                <div style={{ marginTop: 4 }}>
                                  {Object.entries(artifact.feature_importance)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 10)
                                    .map(([name, value]) => {
                                      const maxVal = Math.max(...Object.values(artifact.feature_importance))
                                      const pct = maxVal > 0 ? (value / maxVal) * 100 : 0
                                      return (
                                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                          <span style={{ width: 160, fontSize: '0.75rem', textAlign: 'right', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
                                          <div style={{ flex: 1, height: 14, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                                            <div className="importance-bar" style={{ width: `${pct}%`, height: '100%', borderRadius: 3 }} />
                                          </div>
                                          <span style={{ width: 40, fontSize: '0.7rem', color: '#6b7280' }}>{value}</span>
                                        </div>
                                      )
                                    })}
                                </div>
                              </div>
                            )}

                            {artifact && Object.keys(artifact.feature_importance).length > 3 && (() => {
                              const fi = artifact.feature_importance
                              const total = Object.values(fi).reduce((s, v) => s + v, 0)
                              const removed = Object.entries(fi)
                                .map(([name, value]) => ({ name, value, ratio: total > 0 ? value / total : 0 }))
                                .filter(e => e.ratio < 0.01)
                                .sort((a, b) => a.ratio - b.ratio)
                              const keptCount = Object.keys(fi).length - removed.length
                              const keptImportance = total > 0 ? (total - removed.reduce((s, e) => s + e.value, 0)) / total : 1
                              const isSelected = featureSelectionModelId === model.id && featureSelectionResult !== null
                              return (
                              <div style={{ marginBottom: 8 }}>
                                <button
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => {
                                    if (isSelected) {
                                      setFeatureSelectionModelId(null); setFeatureSelectionResult(null)
                                    } else {
                                      setFeatureSelectionResult({ keptCount, removedCount: removed.length, keptImportanceRatio: keptImportance, removed })
                                      setFeatureSelectionModelId(model.id)
                                    }
                                  }}
                                >
                                  {isSelected ? '收起筛选建议' : '特征筛选建议'}
                                </button>
                                {isSelected && featureSelectionResult && (
                                  <div style={{ marginTop: 6, fontSize: '0.82rem' }}>
                                    <div style={{ color: '#059669', marginBottom: 4 }}>
                                      保留 {String(featureSelectionResult.keptCount)} 个特征（覆盖 {Math.round(Number(featureSelectionResult.keptImportanceRatio) * 100)}% 重要性），
                                      <span style={{ color: '#d97706' }}>建议移除 {String(featureSelectionResult.removedCount)} 个</span>（{'<'} 1% 重要性）
                                    </div>
                                    {(featureSelectionResult.removed as Array<Record<string, unknown>>)?.length > 0 && (
                                      <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                        移除: {(featureSelectionResult.removed as Array<Record<string, unknown>>).map((r) => String(r.name)).join(', ')}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              )
                            })()}

                            <div style={{ marginBottom: 8 }}>
                              <span className="model-stat-label">备注</span>
                              {editingDescId === model.id ? (
                                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                  <textarea
                                    className="model-desc-textarea"
                                    value={editingDescValue}
                                    onChange={(e) => setEditingDescValue(e.target.value)}
                                  />
                                  <div>
                                    <button className="btn btn-sm btn-accept" onClick={() => void handleSaveDescription(model.id)}>保存</button>
                                    <br />
                                    <button className="btn btn-sm btn-secondary" onClick={() => setEditingDescId(null)} style={{ marginTop: 4 }}>取消</button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  style={{ cursor: 'pointer', minHeight: 24, color: model.description ? '#374151' : '#9ca3af', fontSize: '0.82rem' }}
                                  onClick={() => { setEditingDescId(model.id); setEditingDescValue(model.description) }}
                                  title="点击编辑备注"
                                >
                                  {model.description || '点击添加备注...'}
                                </div>
                              )}
                            </div>

                            {modelEvals.length > 0 && (
                              <table>
                                <thead><tr><th>Split</th><th>Acc</th><th>Prec</th><th>Recall</th><th>F1</th><th>AUC</th><th>样本</th></tr></thead>
                                <tbody>
                                  {modelEvals.map((ev) => (
                                    <tr key={ev.id}>
                                      <td>{ev.split}</td>
                                      <td>{(ev.accuracy * 100).toFixed(1)}%</td>
                                      <td>{(ev.precision * 100).toFixed(1)}%</td>
                                      <td>{(ev.recall * 100).toFixed(1)}%</td>
                                      <td>{(ev.f1 * 100).toFixed(1)}%</td>
                                      <td>{ev.auc > 0 ? `${(ev.auc * 100).toFixed(1)}%` : '-'}</td>
                                      <td>{ev.sampleCount}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reportContent && reportModelId && (
        <section className="model-card">
          <div className="model-card-head">
            <h3>模型报告 — {reportModelId.slice(0, 20)}</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => { setReportContent(null); setReportModelId(null) }}>关闭</button>
          </div>
          <pre className="model-report-pre">{reportContent}</pre>
        </section>
      )}
    </>
  )
}

export default RegistryTab
