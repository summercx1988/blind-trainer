import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelActivationData, ModelTrainingTriggerData, PlatformResult, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { DatasetItem, ModelTrainingTaskItem, ModelVersionItem, ModelEvaluationItem } from './types'
import { toDatasetItem, toModelTrainingTaskItem, toModelVersionItem, toModelEvaluationItem, asString } from './types'
import { formatTime, readConvergenceMetrics, readTestAccuracy, readMetricValue } from './helpers'
import { DEFAULT_FEATURE_SPEC_VERSION, FEATURE_SPECS } from './featureSpecRegistry'

interface TrainTabProps {
  datasets: DatasetItem[]
}

const TrainTab = ({ datasets: propsDatasets }: TrainTabProps) => {
  const [trainingTasks, setTrainingTasks] = useState<ModelTrainingTaskItem[]>([])
  const [modelVersions, setModelVersions] = useState<ModelVersionItem[]>([])
  const [evaluations, setEvaluations] = useState<ModelEvaluationItem[]>([])
  const [localDatasets, setLocalDatasets] = useState<DatasetItem[]>([])
  const [selectedTrainDatasetId, setSelectedTrainDatasetId] = useState('')
  const [selectedTrainSpec, setSelectedTrainSpec] = useState(DEFAULT_FEATURE_SPEC_VERSION)
  const [selectedEngine, setSelectedEngine] = useState('catboost')
  const [selectedTrials, setSelectedTrials] = useState(200)
  const [numBoostRound, setNumBoostRound] = useState(1000)
  const [earlyStoppingRounds, setEarlyStoppingRounds] = useState(50)
  const [runName, setRunName] = useState('')
  const [isTriggeringTraining, setIsTriggeringTraining] = useState(false)
  const [trainingMessage, setTrainingMessage] = useState('')
  const [isLoadingTraining, setIsLoadingTraining] = useState(false)
  const [activatingModelId, setActivatingModelId] = useState('')
  const [comparingModelIds, setComparingModelIds] = useState<string[]>([])
  const [logLines, setLogLines] = useState<{ stream: string; text: string }[]>([])
  const [showLogPanel, setShowLogPanel] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  const allDatasets = localDatasets.length > 0 ? localDatasets : propsDatasets
  const frozenDatasets = allDatasets.filter((d) => d.status === 'frozen')

  const loadTrainingData = useCallback(async () => {
    setIsLoadingTraining(true)
    try {
      const [taskRows, versionRows, evalRows, dsRows] = await Promise.all([
        window.electronAPI?.listModelTrainingTasks?.(undefined, 100),
        window.electronAPI?.listModels?.(),
        window.electronAPI?.listModelEvaluations?.('', 100),
        window.electronAPI?.listDatasets?.(),
      ])
      setTrainingTasks((taskRows || []).map((row) => toModelTrainingTaskItem(row as UnknownRecord)).filter((row): row is ModelTrainingTaskItem => row !== null))
      setModelVersions((versionRows || []).map((row) => toModelVersionItem(row as UnknownRecord)).filter((row): row is ModelVersionItem => row !== null))
      setEvaluations((evalRows || []).map((row) => toModelEvaluationItem(row as UnknownRecord)).filter((row): row is ModelEvaluationItem => row !== null))
      if (dsRows && Array.isArray(dsRows) && dsRows.length > 0) {
        setLocalDatasets(
          dsRows
            .map((row) => toDatasetItem(row as UnknownRecord))
            .filter((row): row is DatasetItem => row !== null)
        )
      }
    } catch (error) {
      console.error('加载训练数据失败:', error)
    } finally {
      setIsLoadingTraining(false)
    }
  }, [])

  useEffect(() => { void loadTrainingData() }, [loadTrainingData])

  useEffect(() => {
    const handler = (_event: unknown, data: { stream: string; text: string }) => {
      setLogLines((prev) => [...prev.slice(-2000), { stream: data.stream, text: data.text }])
    }
    window.electronAPI?.onTrainingLog?.(handler)
    return () => { window.electronAPI?.removeTrainingLogListener?.(handler) }
  }, [])

  const isJsonResultLine = (text: string): boolean => {
    const trimmed = text.trim()
    return trimmed.startsWith('{"model_id"') || trimmed.startsWith('{"engine"')
  }

  const colorizeLogLine = (stream: string, text: string) => {
    if (stream === 'stderr') return <span style={{ color: '#ff6b6b' }}>{text}</span>
    if (stream === 'system') return <span style={{ color: '#ffd93d' }}>{text}</span>
    if (isJsonResultLine(text)) {
      const trimmed = text.trim()
      try {
        const obj = JSON.parse(trimmed)
        const summary = [`model_id=${obj.model_id || '?'}`, `engine=${obj.engine || obj.metrics?.convergence?.engine || '?'}`]
        const m = obj.metrics || {}
        for (const split of ['train', 'valid', 'test']) {
          const s = m[split]
          if (s) summary.push(`${split}: AUC=${(s.auc ?? 0).toFixed(4)} F1=${(s.f1 ?? 0).toFixed(4)}`)
        }
        if (m.cv_avg) summary.push(`cv_avg: AUC=${(m.cv_avg.auc ?? 0).toFixed(4)}`)
        return <span style={{ color: '#68d391' }}>{summary.join(' | ')}</span>
      } catch {
        return <span style={{ color: '#a0aec0' }}>[JSON result, {trimmed.length} chars]</span>
      }
    }
    if (text.includes('[Optuna]')) return <span style={{ color: '#90cdf4' }}>{text}</span>
    if (text.includes('Loss curve:') || text.includes('[Iter')) return <span style={{ color: '#fc8181' }}>{text}</span>
    if (text.includes('Training Summary') || text.includes('=====')) return <span style={{ color: '#68d391', fontWeight: 'bold' }}>{text}</span>
    if (text.includes('Fold ')) return <span style={{ color: '#d6bcfa' }}>{text}</span>
    if (text.includes('Optuna done') || text.includes('CV done') || text.includes('Final model trained')) return <span style={{ color: '#68d391' }}>{text}</span>
    if (text.includes('Training final model') || text.includes('Training LightGBM') || text.includes('Training CatBoost')) return <span style={{ color: '#fbd38d' }}>{text}</span>
    return <span style={{ color: '#a8d8ea' }}>{text}</span>
  }

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logLines])

  const hasRunningTasks = trainingTasks.some(
    (t) => t.status === 'pending' || t.status === 'running' || t.status === 'queued'
  )

  useEffect(() => {
    if (!hasRunningTasks) return
    const timer = setInterval(() => { void loadTrainingData() }, 5000)
    return () => clearInterval(timer)
  }, [hasRunningTasks, loadTrainingData])

  const handleTriggerTraining = useCallback(async () => {
    if (!selectedTrainDatasetId) { setTrainingMessage('请选择冻结数据集'); return }
    setTrainingMessage(''); setIsTriggeringTraining(true); setLogLines([])
    try {
      const result = await window.electronAPI?.createModelTrainingTask?.(
        selectedTrainDatasetId, selectedTrainSpec, 'buy_signal', selectedEngine, selectedTrials,
        { numBoostRound, earlyStoppingRounds, runName: runName.trim() || undefined }
      ) as PlatformResult<ModelTrainingTriggerData> | undefined
      const taskId = result?.success ? result.data.taskId : ''
      if (result?.success) { setTrainingMessage(`训练任务已触发: ${taskId}`); setShowLogPanel(true); await loadTrainingData() }
      else { setTrainingMessage(getPlatformErrorMessage(result, '训练触发失败')) }
    } catch (error) { console.error('触发训练失败:', error); setTrainingMessage('训练触发失败') }
    finally { setIsTriggeringTraining(false) }
  }, [selectedTrainDatasetId, selectedTrainSpec, selectedEngine, selectedTrials, numBoostRound, earlyStoppingRounds, runName, loadTrainingData])

  const handleActivateModel = useCallback(async (modelId: string) => {
    setActivatingModelId(modelId); setTrainingMessage('')
    try {
      const result = await window.electronAPI?.activateModel?.(modelId) as PlatformResult<ModelActivationData> | undefined
      if (result?.success) { setTrainingMessage(`模型 ${modelId} 已激活`); await loadTrainingData() }
      else { setTrainingMessage(getPlatformErrorMessage(result, `激活失败：${modelId}`)) }
    } catch (error) { console.error('激活模型失败:', error); setTrainingMessage('激活失败') }
    finally { setActivatingModelId('') }
  }, [loadTrainingData])

  const toggleModelCompare = useCallback((modelId: string) => {
    setComparingModelIds((prev) => prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId].slice(-4))
  }, [])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!confirm(`确认删除训练任务 ${taskId}？`)) return
    try {
      const result = await window.electronAPI?.deleteTrainingTask?.(taskId) as PlatformResult<unknown> | undefined
      if (result?.success) { setTrainingMessage(`已删除任务 ${taskId}`); await loadTrainingData() }
      else { setTrainingMessage(getPlatformErrorMessage(result, '删除失败')) }
    } catch (error) { console.error('删除任务失败:', error); setTrainingMessage('删除失败') }
  }, [loadTrainingData])

  const handleUpdateTaskStatus = useCallback(async (taskId: string, status: string) => {
    try {
      const result = await window.electronAPI?.updateTrainingTaskStatus?.(taskId, status) as PlatformResult<unknown> | undefined
      if (result?.success) { setTrainingMessage(`任务 ${taskId} 状态已更新为 ${status}`); await loadTrainingData() }
      else { setTrainingMessage(getPlatformErrorMessage(result, '状态更新失败')) }
    } catch (error) { console.error('状态更新失败:', error); setTrainingMessage('状态更新失败') }
  }, [loadTrainingData])

  const parseEngineFromCommand = (cmd: string): string => {
    if (cmd.includes('--engine catboost')) return 'catboost'
    if (cmd.includes('--engine lightgbm')) return 'lightgbm'
    return 'lightgbm'
  }

  const selectedConvergenceModel = modelVersions.find((model) => comparingModelIds.includes(model.id)) || modelVersions[0] || null
  const convergence = selectedConvergenceModel ? readConvergenceMetrics(selectedConvergenceModel.metricsJson) : null
  const buildPolyline = (values: number[], width: number, height: number): string => {
    if (values.length === 0) return ''
    const minV = Math.min(...values)
    const maxV = Math.max(...values)
    const span = Math.max(1e-9, maxV - minV)
    return values.map((value, idx) => {
      const x = (idx / Math.max(1, values.length - 1)) * width
      const y = height - ((value - minV) / span) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    }).join(' ')
  }

  return (
    <>
      <section className="model-card">
        <div className="model-card-head"><h3>模型训练</h3><button className="btn btn-secondary btn-sm" onClick={() => void loadTrainingData()} disabled={isLoadingTraining}>{isLoadingTraining ? '刷新中...' : '刷新'}</button></div>
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <label>冻结数据集
            <select value={selectedTrainDatasetId} onChange={(e) => setSelectedTrainDatasetId(e.target.value)}>
              <option value="">请选择</option>
              {frozenDatasets.map((d) => (<option key={d.id} value={d.id}>{d.name} ({d.sampleCount})</option>))}
            </select>
          </label>
          <label>特征规格
            <select value={selectedTrainSpec} onChange={(e) => setSelectedTrainSpec(e.target.value)}>
              {FEATURE_SPECS.map((s) => (
                <option key={s.version} value={s.version}>{s.version} — {s.columns} cols, {s.desc}</option>
              ))}
            </select>
          </label>
          <label>训练引擎
            <select value={selectedEngine} onChange={(e) => setSelectedEngine(e.target.value)}>
              <option value="catboost">CatBoost (推荐)</option>
              <option value="lightgbm">LightGBM</option>
            </select>
          </label>
          <label>Optuna Trials
            <input type="number" min={10} max={1000} step={50} value={selectedTrials} onChange={(e) => setSelectedTrials(parseInt(e.target.value) || 100)} />
          </label>
          <label>迭代次数 (Boost Rounds)
            <input type="number" min={50} max={5000} step={100} value={numBoostRound} onChange={(e) => setNumBoostRound(parseInt(e.target.value) || 500)} />
          </label>
          <label>Early Stopping
            <input type="number" min={10} max={500} step={10} value={earlyStoppingRounds} onChange={(e) => setEarlyStoppingRounds(parseInt(e.target.value) || 50)} />
          </label>
          <label>运行名称 (可选)
            <input type="text" placeholder="如：趋势买点实验1" value={runName} onChange={(e) => setRunName(e.target.value)} style={{ fontSize: 13 }} />
          </label>
          <div className="model-actions" style={{ paddingTop: 18 }}>
            <button className="btn btn-primary" onClick={() => void handleTriggerTraining()} disabled={isTriggeringTraining || !selectedTrainDatasetId}>
              {isTriggeringTraining ? '训练中...' : '开始训练'}
            </button>
          </div>
          <div style={{ paddingTop: 18 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowLogPanel(!showLogPanel); if (!showLogPanel) setLogLines([]) }}>
              {showLogPanel ? '隐藏日志' : '查看日志'}
            </button>
          </div>
        </div>
        {trainingMessage && <p className="model-message">{trainingMessage}</p>}
      </section>

      {showLogPanel && (
        <section className="model-card" style={{ marginTop: '0.5rem' }}>
          <div className="model-card-head">
            <h3>训练日志</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setLogLines([])}>清空</button>
          </div>
          <div style={{
            background: '#1a1a2e',
            color: '#e0e0e0',
            fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
            fontSize: 12,
            lineHeight: 1.5,
            maxHeight: 400,
            overflowY: 'auto',
            padding: 12,
            borderRadius: 6,
            border: '1px solid #333',
          }}>
            {logLines.length === 0 ? (
              <span style={{ color: '#888' }}>等待训练输出...</span>
            ) : (
              logLines.filter((line) => !isJsonResultLine(line.text)).map((line, idx) => (
                <div key={idx}>{colorizeLogLine(line.stream, line.text)}</div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </section>
      )}

      <section className="model-card">
        <div className="model-card-head" style={{ marginTop: '1rem' }}>
          <h3>训练任务</h3>
          {hasRunningTasks && <span className="polling-badge">自动刷新中...</span>}
        </div>
        {trainingTasks.length === 0 ? (<div className="model-empty">暂无训练任务。</div>) : (
          <div className="model-table-wrap"><table><thead><tr><th>数据集</th><th>规格</th><th>引擎</th><th>Trials</th><th>状态</th><th>创建时间</th><th>错误</th><th>操作</th></tr></thead><tbody>
            {trainingTasks.slice(0, 20).map((task) => {
              const isActive = task.status === 'pending' || task.status === 'running' || task.status === 'queued'
              const engine = parseEngineFromCommand(asString((task as unknown as Record<string, unknown>).command))
              const trialsMatch = asString((task as unknown as Record<string, unknown>).command).match(/--trials (\d+)/)
              const trials = trialsMatch ? trialsMatch[1] : '100'
              return (
                <tr key={task.id} className={isActive ? 'task-row-active' : ''}>
                  <td>{task.datasetId}</td>
                  <td>{task.specVersion}</td>
                  <td><span className={`engine-badge engine-${engine}`}>{engine}</span></td>
                  <td>{trials}</td>
                  <td><span className={`candidate-status status-${task.status}`}>{task.status}</span></td>
                  <td>{formatTime(task.createdAt)}</td>
                  <td className="reason-cell">{task.errorMessage || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isActive && (
                      <button className="btn btn-sm" style={{ color: '#e53e3e', marginRight: 4 }} onClick={() => void handleUpdateTaskStatus(task.id, 'failed')}>标记失败</button>
                    )}
                    <button className="btn btn-sm" style={{ color: '#a0aec0' }} onClick={() => void handleDeleteTask(task.id)}>删除</button>
                  </td>
                </tr>
              )
            })}
          </tbody></table></div>
        )}
      </section>

      <section className="model-card">
        <div className="model-card-head" style={{ marginTop: '1rem' }}>
          <h3>模型对比</h3>
          <span className="model-hint">选择 2-4 个模型查看对比</span>
        </div>
        {modelVersions.length === 0 ? (<div className="model-empty">暂无模型。</div>) : (
          <div className="model-table-wrap"><table><thead><tr><th>✓</th><th>名称</th><th>状态</th><th>Test Acc</th><th>操作</th></tr></thead><tbody>
            {modelVersions.map((model) => (<tr key={model.id}>
              <td><input type="checkbox" checked={comparingModelIds.includes(model.id)} onChange={() => void toggleModelCompare(model.id)} /></td>
              <td>{model.name}<br /><span className="model-id-sub">{model.id.slice(0, 16)}</span></td>
              <td><span className={`candidate-status status-${model.status === 'active' ? 'accepted' : 'proposed'}`}>{model.status === 'active' ? '已激活' : model.status}</span></td>
              <td>{readTestAccuracy(model.metricsJson)}</td>
              <td>{model.status !== 'active' && (<button className="btn btn-sm btn-accept" disabled={activatingModelId === model.id} onClick={() => void handleActivateModel(model.id)}>{activatingModelId === model.id ? '...' : '激活'}</button>)}</td>
            </tr>))}
          </tbody></table></div>
        )}
      </section>

      {comparingModelIds.length >= 2 && (
        <section className="model-card">
          <div className="model-card-head"><h3>对比结果</h3></div>
          <div className="model-table-wrap"><table><thead><tr><th>指标</th>{comparingModelIds.map((id) => { const model = modelVersions.find((m) => m.id === id); return (<th key={id}>{model?.name || id.slice(0, 8)}</th>) })}</tr></thead><tbody>
            {(['accuracy', 'precision', 'recall', 'f1'] as const).map((metric) => {
              const values = comparingModelIds.map((id) => {
                const model = modelVersions.find((m) => m.id === id)
                return model ? readMetricValue(model.metricsJson, 'test', metric) : null
              })
              const bestVal = Math.max(...values.filter((v): v is number => v !== null))
              return (
                <tr key={metric}>
                  <td>{metric}</td>
                  {values.map((value, idx) => (
                    <td key={idx} className={value === bestVal ? 'compare-best' : ''}>{value !== null ? `${(value * 100).toFixed(1)}%` : '-'}</td>
                  ))}
                </tr>
              )
            })}
          </tbody></table></div>
        </section>
      )}

      <section className="model-card">
        <div className="model-card-head"><h3>评估明细</h3></div>
        {evaluations.length === 0 ? (<div className="model-empty">暂无评估记录。</div>) : (
          <div className="model-table-wrap"><table><thead><tr><th>模型</th><th>Split</th><th>Acc</th><th>Prec</th><th>Recall</th><th>F1</th><th>样本</th></tr></thead><tbody>
            {evaluations.slice(0, 30).map((item) => (<tr key={item.id}><td className="reason-cell">{item.modelId.slice(0, 12)}</td><td>{item.split}</td><td>{(item.accuracy * 100).toFixed(1)}%</td><td>{(item.precision * 100).toFixed(1)}%</td><td>{(item.recall * 100).toFixed(1)}%</td><td>{(item.f1 * 100).toFixed(1)}%</td><td>{item.sampleCount}</td></tr>))}
          </tbody></table></div>
        )}
      </section>

      <section className="model-card">
        <div className="model-card-head">
          <h3>收敛观察窗</h3>
          <span className="model-hint">{selectedConvergenceModel ? selectedConvergenceModel.name : '暂无模型'}</span>
        </div>
        {!convergence ? (
          <div className="model-empty">当前模型暂无收敛曲线数据。请使用最新训练流程重新训练一次。</div>
        ) : (
          <>
            <div className="model-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              <div className="model-stat"><div className="model-stat-label">状态</div><div className="model-stat-value">{convergence.status === 'converged' ? '已收敛' : '仍在改善'}</div></div>
              <div className="model-stat"><div className="model-stat-label">最优迭代</div><div className="model-stat-value">{convergence.best_iteration}</div></div>
              <div className="model-stat"><div className="model-stat-label">总迭代</div><div className="model-stat-value">{convergence.total_iterations}</div></div>
              <div className="model-stat"><div className="model-stat-label">最佳验证{convergence.metric_name}</div><div className="model-stat-value">{convergence.best_valid_metric !== null ? convergence.best_valid_metric.toFixed(5) : '-'}</div></div>
              <div className="model-stat"><div className="model-stat-label">末段改善</div><div className="model-stat-value">{convergence.tail_improvement.toFixed(5)}</div></div>
            </div>

            <div className="model-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '1rem' }}>
              <div className="model-curve-card">
                <div className="model-curve-title">训练/验证 {convergence.metric_name}</div>
                <svg viewBox="0 0 420 160" className="model-curve-svg">
                  <polyline fill="none" stroke="#3182ce" strokeWidth="2" points={buildPolyline(convergence.train_curve, 420, 160)} />
                  <polyline fill="none" stroke="#dd6b20" strokeWidth="2" points={buildPolyline(convergence.valid_curve, 420, 160)} />
                </svg>
                <div className="model-curve-legend"><span className="train">Train</span><span className="valid">Valid</span></div>
              </div>
              <div className="model-curve-card">
                <div className="model-curve-title">Optuna Trial AUC 轨迹</div>
                <svg viewBox="0 0 420 160" className="model-curve-svg">
                  <polyline fill="none" stroke="#2f855a" strokeWidth="2" points={buildPolyline(convergence.optuna_curve, 420, 160)} />
                </svg>
                <div className="model-curve-note">best={convergence.optuna_best_value !== null ? convergence.optuna_best_value.toFixed(5) : '-'}</div>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  )
}

export default TrainTab
