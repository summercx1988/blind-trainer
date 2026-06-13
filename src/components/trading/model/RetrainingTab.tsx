import { useCallback, useEffect, useState } from 'react'
import type { PlatformResult, RetrainingTriggerData, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { RetrainingRunItem } from './types'
import { toRetrainingRunItem, asString } from './types'
import { formatTime, readSummaryField } from './helpers'
import { DEFAULT_FEATURE_SPEC_VERSION, FEATURE_SPECS } from './featureSpecRegistry'

const RetrainingTab = () => {
  const [retrainingRuns, setRetrainingRuns] = useState<RetrainingRunItem[]>([])
  const [isLoadingRetraining, setIsLoadingRetraining] = useState(false)
  const [isTriggeringRetraining, setIsTriggeringRetraining] = useState(false)
  const [retrainingMessage, setRetrainingMessage] = useState('')
  const [retrainingSpec, setRetrainingSpec] = useState(DEFAULT_FEATURE_SPEC_VERSION)
  const [retrainingTaskType, setRetrainingTaskType] = useState('buy_signal')
  const [retrainingSampleLimit, setRetrainingSampleLimit] = useState(800)
  const [isTriggeringIncremental, setIsTriggeringIncremental] = useState(false)
  const [incrementalMessage, setIncrementalMessage] = useState('')

  const loadRetrainingRuns = useCallback(async () => {
    setIsLoadingRetraining(true)
    try {
      const rows = await window.electronAPI?.listRetrainingRuns?.(100)
      setRetrainingRuns((rows || []).map((row: UnknownRecord) => toRetrainingRunItem(row)).filter((row): row is RetrainingRunItem => row !== null))
    } catch (error) { console.error('加载再训练记录失败:', error); setRetrainingRuns([]) }
    finally { setIsLoadingRetraining(false) }
  }, [])

  useEffect(() => { void loadRetrainingRuns() }, [loadRetrainingRuns])

  const handleTriggerRetraining = useCallback(async () => {
    setRetrainingMessage(''); setIsTriggeringRetraining(true)
    try {
      const result = await window.electronAPI?.createFeedbackRetrainingRun?.({ specVersion: retrainingSpec, taskType: retrainingTaskType, sampleLimit: retrainingSampleLimit }) as PlatformResult<RetrainingTriggerData> | undefined
      if (result?.success) {
        const runId = asString((result.data.run as UnknownRecord | null)?.id)
        setRetrainingMessage(`再训练已触发: ${runId || '已创建运行记录'}`)
        await loadRetrainingRuns()
      } else {
        setRetrainingMessage(getPlatformErrorMessage(result, '再训练触发失败'))
      }
    } catch (error) { console.error('触发再训练失败:', error); setRetrainingMessage('再训练触发失败') }
    finally { setIsTriggeringRetraining(false) }
  }, [retrainingSpec, retrainingTaskType, retrainingSampleLimit, loadRetrainingRuns])

  const handleDeleteRun = useCallback(async (runId: string) => {
    if (!confirm(`确认删除再训练记录 ${runId}?`)) return
    try {
      const result = await window.electronAPI?.deleteRetrainingRun?.(runId)
      if (result?.success) await loadRetrainingRuns()
      else alert((result as UnknownRecord)?.error || '删除失败')
    } catch (err) { console.error('删除再训练记录失败:', err) }
  }, [loadRetrainingRuns])

  const handleTriggerIncrementalRetraining = useCallback(async () => {
    setIncrementalMessage(''); setIsTriggeringIncremental(true)
    try {
      const result = await window.electronAPI?.createIncrementalRetrainingRun?.({ specVersion: retrainingSpec, taskType: retrainingTaskType, sampleLimit: retrainingSampleLimit }) as PlatformResult<RetrainingTriggerData> | undefined
      if (result?.success) {
        const runId = asString((result.data.run as UnknownRecord | null)?.id)
        setIncrementalMessage(`增量再训练已触发: ${runId || '已创建运行记录'}`)
        await loadRetrainingRuns()
      } else {
        setIncrementalMessage(getPlatformErrorMessage(result, '增量再训练触发失败'))
      }
    } catch (error) { console.error('触发增量再训练失败:', error); setIncrementalMessage('增量再训练触发失败') }
    finally { setIsTriggeringIncremental(false) }
  }, [retrainingSpec, retrainingTaskType, retrainingSampleLimit, loadRetrainingRuns])

  return (
    <>
      <section className="model-card">
        <div className="model-card-head"><h3>再训练</h3><button className="btn btn-secondary btn-sm" onClick={() => void loadRetrainingRuns()} disabled={isLoadingRetraining}>{isLoadingRetraining ? '刷新中...' : '刷新'}</button></div>
        <div className="model-grid feature-grid">
          <label>规格版本
            <select value={retrainingSpec} onChange={(e) => setRetrainingSpec(e.target.value)}>
              {FEATURE_SPECS.map((spec) => (
                <option key={spec.version} value={spec.version}>
                  {spec.version} — {spec.columns} cols
                </option>
              ))}
            </select>
          </label>
          <label>任务类型<select value={retrainingTaskType} onChange={(e) => setRetrainingTaskType(e.target.value)}><option value="buy_signal">买点信号</option><option value="sell_signal">卖点信号</option></select></label>
          <label>样本上限<input type="number" min={100} max={3000} value={retrainingSampleLimit} onChange={(e) => setRetrainingSampleLimit(Math.max(100, Number(e.target.value) || 100))} /></label>
          <div className="model-actions"><button className="btn btn-primary" onClick={() => void handleTriggerRetraining()} disabled={isTriggeringRetraining}>{isTriggeringRetraining ? '触发中...' : '全量再训练'}</button></div>
          <div className="model-actions"><button className="btn btn-secondary" onClick={() => void handleTriggerIncrementalRetraining()} disabled={isTriggeringIncremental}>{isTriggeringIncremental ? '触发中...' : '增量再训练'}</button></div>
        </div>
        {retrainingMessage && <p className="model-message">{retrainingMessage}</p>}
        {incrementalMessage && <p className="model-message">{incrementalMessage}</p>}
      </section>

      <section className="model-card">
        <div className="model-card-head" style={{ marginTop: '1rem' }}><h3>再训练记录</h3></div>
        {isLoadingRetraining ? (<div className="model-empty">正在加载...</div>) : retrainingRuns.length === 0 ? (<div className="model-empty">暂无再训练记录。</div>) : (
          <div className="model-table-wrap"><table><thead><tr><th>Run ID</th><th>触发类型</th><th>规格</th><th>类型</th><th>状态</th><th>样本上限</th><th>已激活</th><th>数据集</th><th>模型</th><th>创建时间</th><th>完成时间</th><th>错误</th><th>操作</th></tr></thead><tbody>
            {retrainingRuns.map((run) => (<tr key={run.id}><td>{run.id}</td><td>{run.triggerType}</td><td>{run.specVersion}</td><td>{run.taskType}</td><td><span className={`candidate-status status-${run.status}`}>{run.status}</span></td><td>{run.sampleLimit}</td><td>{run.activated ? '✓' : '-'}</td><td>{run.datasetName || run.datasetId}</td><td>{run.modelName || run.modelId}</td><td>{formatTime(run.createdAt)}</td><td>{formatTime(run.finishedAt)}</td><td className="reason-cell">{run.errorMessage || '-'}</td><td>{run.status !== 'running' && <button className="btn btn-sm btn-secondary" onClick={() => void handleDeleteRun(run.id)}>删除</button>}</td></tr>))}
          </tbody></table></div>
        )}
      </section>

      {retrainingRuns.filter((run) => run.status === 'completed' && run.summaryJson).length > 0 && (
        <section className="model-card">
          <div className="model-card-head" style={{ marginTop: '1rem' }}><h3>再训练摘要</h3></div>
          <div className="model-table-wrap"><table><thead><tr><th>Run ID</th><th>训练样本</th><th>验证样本</th><th>测试样本</th><th>特征数</th><th>Test Acc</th><th>Test F1</th><th>已激活</th></tr></thead><tbody>
            {retrainingRuns.filter((run) => run.status === 'completed' && (run.summaryJson || run.trainSamples != null)).map((run) => (<tr key={`summary_${run.id}`}><td>{run.id}</td><td>{run.trainSamples ?? readSummaryField(run.summaryJson, 'trainSamples')}</td><td>{readSummaryField(run.summaryJson, 'validSamples')}</td><td>{run.testSamples ?? readSummaryField(run.summaryJson, 'testSamples')}</td><td>{run.featureCount ?? readSummaryField(run.summaryJson, 'featureCount')}</td><td>{run.testAccuracy != null ? (run.testAccuracy * 100).toFixed(1) + '%' : readSummaryField(run.summaryJson, 'testAccuracy')}</td><td>{run.testF1 != null ? (run.testF1 * 100).toFixed(1) + '%' : readSummaryField(run.summaryJson, 'testF1')}</td><td>{run.activated ? '✓' : '-'}</td></tr>))}
          </tbody></table></div>
        </section>
      )}
    </>
  )
}

export default RetrainingTab
