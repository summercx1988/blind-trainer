import { useCallback, useEffect, useState } from 'react'
import type { PlatformResult, TaskTriggerData, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { FeatureBuildTaskItem, DatasetItem } from './types'
import { toFeatureBuildTaskItem } from './types'
import { formatTime } from './helpers'
import { DEFAULT_FEATURE_SPEC_VERSION, FEATURE_SPECS } from './featureSpecRegistry'

interface FeatureTabProps {
  datasets: DatasetItem[]
}

const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

const FeatureTab = ({ datasets }: FeatureTabProps) => {
  const [featureTasks, setFeatureTasks] = useState<FeatureBuildTaskItem[]>([])
  const [isLoadingFeatures, setIsLoadingFeatures] = useState(false)
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [specVersion, setSpecVersion] = useState(DEFAULT_FEATURE_SPEC_VERSION)
  const [strictReal, setStrictReal] = useState(false)
  const [isTriggeringFeature, setIsTriggeringFeature] = useState(false)
  const [featureMessage, setFeatureMessage] = useState('')

  const frozenDatasets = datasets.filter((d) => d.status === 'frozen')
  const selectedSpec = FEATURE_SPECS.find((s) => s.version === specVersion)

  const loadFeatureTasks = useCallback(async () => {
    setIsLoadingFeatures(true)
    try {
      const rows = await window.electronAPI?.listFeatureBuildTasks?.(undefined, 100)
      const parsed = (rows || []).map((row) => toFeatureBuildTaskItem(row as UnknownRecord)).filter((row): row is FeatureBuildTaskItem => row !== null)
      setFeatureTasks(parsed)
    } catch (error) {
      console.error('加载特征构建任务失败:', error)
      setFeatureTasks([])
    } finally {
      setIsLoadingFeatures(false)
    }
  }, [])

  useEffect(() => { void loadFeatureTasks() }, [loadFeatureTasks])

  const handleTriggerFeatureBuild = useCallback(async () => {
    if (!selectedDatasetId) { setFeatureMessage('请选择冻结数据集'); return }
    setFeatureMessage(''); setIsTriggeringFeature(true)
    try {
      const result = await window.electronAPI?.createFeatureBuildTask?.(selectedDatasetId, specVersion, strictReal) as PlatformResult<TaskTriggerData> | undefined
      const taskId = asString(result?.success ? result.data.taskId : '')
      if (result?.success) { setFeatureMessage(`特征构建任务已触发: ${taskId}`); await loadFeatureTasks() }
      else { setFeatureMessage(getPlatformErrorMessage(result, '特征构建触发失败，请稍后重试')) }
    } catch (error) { console.error('触发特征构建失败:', error); setFeatureMessage('触发失败') }
    finally { setIsTriggeringFeature(false) }
  }, [selectedDatasetId, specVersion, strictReal, loadFeatureTasks])

  const handleDeleteFeatureTask = useCallback(async (taskId: string) => {
    if (!confirm(`确认删除特征任务 ${taskId}?`)) return
    try {
      const result = await window.electronAPI?.deleteFeatureTask?.(taskId)
      if (result?.success) await loadFeatureTasks()
      else alert((result as UnknownRecord)?.error || '删除失败')
    } catch (err) { console.error('删除特征任务失败:', err) }
  }, [loadFeatureTasks])

  return (
    <>
      <section className="model-card">
        <div className="model-card-head"><h3>特征构建</h3><button className="btn btn-secondary btn-sm" onClick={() => void loadFeatureTasks()} disabled={isLoadingFeatures}>{isLoadingFeatures ? '刷新中...' : '刷新'}</button></div>
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <label>冻结数据集
            <select value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)}>
              <option value="">请选择</option>
              {frozenDatasets.map((d) => (<option key={d.id} value={d.id}>{d.name} ({d.sampleCount})</option>))}
            </select>
          </label>
          <label>特征规格
            <select value={specVersion} onChange={(e) => setSpecVersion(e.target.value)}>
              {FEATURE_SPECS.map((s) => (
                <option key={s.version} value={s.version}>{s.version} — {s.columns} cols, {s.desc}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 18 }}>
            <input type="checkbox" checked={strictReal} onChange={(e) => setStrictReal(e.target.checked)} />
            严格真实数据模式
          </label>
        </div>
        {selectedSpec && (
          <div className="model-desc" style={{ marginTop: 8 }}>
            <strong>{selectedSpec.version}</strong>: {selectedSpec.columns} 列 — {selectedSpec.desc}
            <br />周期: {selectedSpec.interval}，回看窗口: {selectedSpec.lookbackBars} bars
            <br />核心指标: {selectedSpec.highlights.join(' / ')}
          </div>
        )}
        <div className="model-actions" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => void handleTriggerFeatureBuild()} disabled={isTriggeringFeature || !selectedDatasetId}>
            {isTriggeringFeature ? '构建中...' : '触发构建'}
          </button>
        </div>
        {featureMessage && <p className="model-message">{featureMessage}</p>}
      </section>

      <section className="model-card">
        <div className="model-card-head" style={{ marginTop: '1rem' }}><h3>构建任务列表</h3></div>
        {featureTasks.length === 0 ? (<div className="model-empty">暂无特征构建任务。</div>) : (
          <div className="model-table-wrap"><table><thead><tr><th>任务ID</th><th>数据集</th><th>规格</th><th>状态</th><th>创建</th><th>完成</th><th>错误</th><th>操作</th></tr></thead><tbody>
            {featureTasks.map((task) => (<tr key={task.id}><td>{task.id.slice(0, 12)}...</td><td>{task.datasetName ? `${task.datasetName} (${task.datasetId})` : task.datasetId}</td><td>{task.specVersion}</td><td><span className={`candidate-status status-${task.status}`}>{task.status}</span></td><td>{formatTime(task.createdAt)}</td><td>{formatTime(task.finishedAt)}</td><td className="reason-cell">{task.errorMessage || '-'}</td><td>{task.status !== 'running' && <button className="btn btn-sm btn-secondary" onClick={() => void handleDeleteFeatureTask(task.id)}>删除</button>}</td></tr>))}
          </tbody></table></div>
        )}
      </section>
    </>
  )
}

export default FeatureTab
