import { useCallback, useEffect, useState } from 'react'
import type { FeedbackBackfillData, PlatformResult, SignalFeedbackSubmitData, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { SignalEventItem, SignalEventStatus } from './types'
import { toSignalEventItem, asNumber } from './types'
import { signalEventStatusLabel, formatTime } from './helpers'

const SignalTab = () => {
  const [signalEvents, setSignalEvents] = useState<SignalEventItem[]>([])
  const [isLoadingSignals, setIsLoadingSignals] = useState(false)
  const [signalStatusFilter, setSignalStatusFilter] = useState<SignalEventStatus>('all')
  const [signalCodeFilter, setSignalCodeFilter] = useState('')
  const [signalPeriodFilter, setSignalPeriodFilter] = useState<'all' | '5m' | '15m' | '1d'>('all')
  const [feedbackingId, setFeedbackingId] = useState('')
  const [signalMessage, setSignalMessage] = useState('')
  const [isBackfillingSignals, setIsBackfillingSignals] = useState(false)

  const loadSignalEvents = useCallback(async () => {
    setIsLoadingSignals(true)
    try {
      const filters: { status?: string; code?: string; period?: string; limit?: number } = { limit: 100 }
      if (signalStatusFilter !== 'all') filters.status = signalStatusFilter
      if (signalCodeFilter.trim()) filters.code = signalCodeFilter.trim()
      if (signalPeriodFilter !== 'all') filters.period = signalPeriodFilter
      const rows = await window.electronAPI?.listSignalEvents?.(filters)
      setSignalEvents((rows || []).map((row) => toSignalEventItem(row as UnknownRecord)).filter((row): row is SignalEventItem => row !== null))
    } catch (error) { console.error('加载提醒事件失败:', error); setSignalEvents([]) }
    finally { setIsLoadingSignals(false) }
  }, [signalStatusFilter, signalCodeFilter, signalPeriodFilter])

  useEffect(() => { void loadSignalEvents() }, [loadSignalEvents])

  const handleFeedback = useCallback(async (eventId: string, action: 'accept' | 'modify' | 'ignore', note: string) => {
    setFeedbackingId(eventId); setSignalMessage('')
    try {
      const result = await window.electronAPI?.submitSignalFeedback?.(eventId, action, note) as PlatformResult<SignalFeedbackSubmitData> | undefined
      if (!result?.success) {
        setSignalMessage(getPlatformErrorMessage(result, '反馈提交失败'))
        return
      }
      setSignalMessage(`反馈已提交: ${result.data.action}`)
      await loadSignalEvents()
    } catch (error) { console.error('提交反馈失败:', error); setSignalMessage('反馈提交失败') }
    finally { setFeedbackingId('') }
  }, [loadSignalEvents])

  const handleBackfillSignals = useCallback(async () => {
    setIsBackfillingSignals(true); setSignalMessage('')
    try {
      const result = await window.electronAPI?.backfillFeedbackCandidates?.() as PlatformResult<FeedbackBackfillData> | undefined
      if (!result?.success) {
        setSignalMessage(getPlatformErrorMessage(result, '提醒回填失败'))
        return
      }
      const count = asNumber(result.data.inserted, 0)
      setSignalMessage(`提醒回填完成，新增 ${count} 条，更新 ${result.data.updated} 条`)
      await loadSignalEvents()
    } catch (error) { console.error('提醒回填失败:', error); setSignalMessage('提醒回填失败') }
    finally { setIsBackfillingSignals(false) }
  }, [loadSignalEvents])

  return (
    <>
      <section className="model-card">
        <div className="model-card-head"><h3>提醒事件</h3><button className="btn btn-secondary btn-sm" onClick={() => void loadSignalEvents()} disabled={isLoadingSignals}>{isLoadingSignals ? '刷新中...' : '刷新'}</button></div>
        <div className="model-filters">
          <label>状态<select value={signalStatusFilter} onChange={(e) => setSignalStatusFilter(e.target.value as SignalEventStatus)}><option value="all">全部</option><option value="new">新提醒</option><option value="read">已读</option><option value="feedback">已反馈</option><option value="ignored">已忽略</option></select></label>
          <label>标的<input value={signalCodeFilter} onChange={(e) => setSignalCodeFilter(e.target.value.trim())} placeholder="代码筛选" /></label>
          <label>周期<select value={signalPeriodFilter} onChange={(e) => setSignalPeriodFilter(e.target.value as 'all' | '5m' | '15m' | '1d')}><option value="all">全部</option><option value="5m">5m</option><option value="15m">15m</option><option value="1d">1d</option></select></label>
          <div className="model-actions"><button className="btn btn-secondary" onClick={() => void handleBackfillSignals()} disabled={isBackfillingSignals}>{isBackfillingSignals ? '回填中...' : '手动回填提醒'}</button></div>
        </div>
        {signalMessage && <p className="model-message">{signalMessage}</p>}
        {isLoadingSignals ? (<div className="model-empty">正在加载提醒事件...</div>) : signalEvents.length === 0 ? (<div className="model-empty">暂无提醒事件。</div>) : (
          <div className="model-table-wrap"><table><thead><tr><th>时间</th><th>模型</th><th>标的</th><th>周期</th><th>信号</th><th>置信度</th><th>评分</th><th>阈值</th><th>状态</th><th>上次反馈</th><th>操作</th></tr></thead><tbody>
            {signalEvents.map((event) => (<tr key={event.id}><td>{formatTime(event.createdAt)}</td><td>{event.modelName || event.modelId}</td><td>{event.code}</td><td>{event.period}</td><td className={event.signalType === 'buy' ? 'signal-buy' : 'signal-sell'}>{event.signalType === 'buy' ? '买点' : '卖点'}</td><td>{(event.confidence * 100).toFixed(1)}%</td><td>{event.score.toFixed(2)}</td><td>{event.threshold.toFixed(2)}</td><td><span className={`candidate-status status-${event.status}`}>{signalEventStatusLabel[event.status] || event.status}</span></td><td className="reason-cell">{event.lastFeedbackAction ? `${event.lastFeedbackAction} ${formatTime(event.lastFeedbackAt)}` : '-'}</td><td>
              <div className="review-actions">
                <button className="btn btn-sm btn-accept" disabled={!!feedbackingId} onClick={() => void handleFeedback(event.id, 'accept', '')}>采纳</button>
                <button className="btn btn-sm btn-reject" disabled={!!feedbackingId} onClick={() => { const note = window.prompt('修正说明', '') || ''; void handleFeedback(event.id, 'modify', note) }}>修正</button>
                <button className="btn btn-sm btn-secondary" disabled={!!feedbackingId} onClick={() => void handleFeedback(event.id, 'ignore', '')}>忽略</button>
              </div>
            </td></tr>))}
          </tbody></table></div>
        )}
      </section>
    </>
  )
}

export default SignalTab
