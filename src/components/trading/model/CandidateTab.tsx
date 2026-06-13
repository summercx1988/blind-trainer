import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CandidateGenerationData,
  CandidateReviewData,
  OutcomeGatePeriodSettings,
  OutcomeGateSettings,
  OutcomeGateSettingsData,
  PlatformResult,
  UnknownRecord
} from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { CandidateItem, CandidateStatus, PeriodType, StockOption } from './types'
import { toCandidateItem, asNumber } from './types'
import { statusLabel, signalLabel, toFactorLabel } from './helpers'

interface CandidateTabProps {
  stockOptions: StockOption[]
  onRefreshAll: () => Promise<void>
}

const formatSignedPct = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '-'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(2)}%`
}

const formatRiskReward = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '-'
  return value.toFixed(2)
}

const outcomeTagLabel = (tag: string): string => {
  if (tag === 'buy_trend_qualified') return '买点已过门槛'
  if (tag === 'sell_trend_qualified') return '卖点已过门槛'
  return tag || '-'
}

const trendStateLabel = (state: string): string => {
  if (state === 'uptrend') return '上升趋势'
  if (state === 'downtrend') return '下降趋势'
  if (state === 'transition') return '过渡区'
  return state || '-'
}

const OUTCOME_FIELD_LIST: Array<{
  key: keyof OutcomeGatePeriodSettings
  label: string
  step: string
  min: number
  max: number
}> = [
  { key: 'horizonBars', label: '前瞻窗口 bars', step: '1', min: 8, max: 240 },
  { key: 'minFutureBars', label: '最小未来 bars', step: '1', min: 4, max: 239 },
  { key: 'buyMinMaxReturnPct', label: '买点最小浮盈(%)', step: '0.1', min: 0.1, max: 40 },
  { key: 'buyMinExitReturnPct', label: '买点最小退出收益(%)', step: '0.1', min: 0, max: 20 },
  { key: 'buyMaxDrawdownPct', label: '买点最大回撤(%)', step: '0.1', min: 0.1, max: 30 },
  { key: 'buyMinRiskReward', label: '买点最小RR', step: '0.05', min: 0.2, max: 10 },
  { key: 'sellMinDropPct', label: '卖点最小下跌(%)', step: '0.1', min: 0.1, max: 30 },
  { key: 'sellMaxBouncePct', label: '卖点最大反弹(%)', step: '0.1', min: 0, max: 20 },
  { key: 'sellMinRiskReward', label: '卖点最小RR', step: '0.05', min: 0.2, max: 10 },
]

const CandidateTab = ({ stockOptions, onRefreshAll }: CandidateTabProps) => {
  const [stockCode, setStockCode] = useState('600000')
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('15m')
  const [generateLimit, setGenerateLimit] = useState(260)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateMessage, setGenerateMessage] = useState('')

  const [statusFilter, setStatusFilter] = useState<CandidateStatus>('proposed')
  const [codeFilter, setCodeFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState<'all' | PeriodType>('all')
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false)
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [reviewingId, setReviewingId] = useState('')
  const [outcomeSettings, setOutcomeSettings] = useState<OutcomeGateSettings | null>(null)
  const [outcomeSettingsPeriod, setOutcomeSettingsPeriod] = useState<PeriodType>('15m')
  const [isLoadingOutcomeSettings, setIsLoadingOutcomeSettings] = useState(false)
  const [isSavingOutcomeSettings, setIsSavingOutcomeSettings] = useState(false)
  const [outcomeSettingsMessage, setOutcomeSettingsMessage] = useState('')

  const loadOutcomeSettings = useCallback(async () => {
    setIsLoadingOutcomeSettings(true)
    try {
      const result = await window.electronAPI?.getOutcomeGateSettings?.() as PlatformResult<OutcomeGateSettingsData> | undefined
      if (result?.success) {
        setOutcomeSettings(result.data.settings)
        setOutcomeSettingsMessage('结果门槛配置已加载')
      } else {
        setOutcomeSettings(null)
        setOutcomeSettingsMessage(getPlatformErrorMessage(result, '结果门槛配置加载失败'))
      }
    } catch (error) {
      console.error('加载结果门槛配置失败:', error)
      setOutcomeSettings(null)
      setOutcomeSettingsMessage('结果门槛配置加载失败')
    } finally {
      setIsLoadingOutcomeSettings(false)
    }
  }, [])

  useEffect(() => { void loadOutcomeSettings() }, [loadOutcomeSettings])

  const handleOutcomeSettingChange = useCallback((key: keyof OutcomeGatePeriodSettings, rawValue: string) => {
    const nextValue = Number(rawValue)
    if (!Number.isFinite(nextValue)) return
    setOutcomeSettings((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [outcomeSettingsPeriod]: {
          ...prev[outcomeSettingsPeriod],
          [key]: nextValue
        }
      }
    })
  }, [outcomeSettingsPeriod])

  const handleSaveOutcomeSettings = useCallback(async () => {
    if (!outcomeSettings) return
    setIsSavingOutcomeSettings(true)
    setOutcomeSettingsMessage('')
    try {
      const patch = { [outcomeSettingsPeriod]: outcomeSettings[outcomeSettingsPeriod] }
      const result = await window.electronAPI?.updateOutcomeGateSettings?.(patch) as PlatformResult<OutcomeGateSettingsData> | undefined
      if (result?.success) {
        setOutcomeSettings(result.data.settings)
        setOutcomeSettingsMessage('结果门槛配置已保存')
      } else {
        setOutcomeSettingsMessage(getPlatformErrorMessage(result, '结果门槛配置保存失败'))
      }
    } catch (error) {
      console.error('保存结果门槛配置失败:', error)
      setOutcomeSettingsMessage('结果门槛配置保存失败')
    } finally {
      setIsSavingOutcomeSettings(false)
    }
  }, [outcomeSettings, outcomeSettingsPeriod])

  const loadCandidates = useCallback(async () => {
    setIsLoadingCandidates(true)
    try {
      const filters: { status?: string; code?: string; period?: string; limit?: number } = { limit: 300 }
      if (statusFilter !== 'all') filters.status = statusFilter
      if (codeFilter.trim()) filters.code = codeFilter.trim()
      if (periodFilter !== 'all') filters.period = periodFilter
      const rows = await window.electronAPI?.listCandidates?.(filters)
      const parsed = (rows || [])
        .map((row) => toCandidateItem(row as UnknownRecord))
        .filter((row): row is CandidateItem => row !== null)
      setCandidates(parsed)
    } catch (error) {
      console.error('加载候选信号失败:', error)
      setCandidates([])
    } finally {
      setIsLoadingCandidates(false)
    }
  }, [statusFilter, codeFilter, periodFilter])

  useEffect(() => { void loadCandidates() }, [loadCandidates])

  const handleGenerateCandidates = useCallback(async () => {
    const code = stockCode.trim()
    if (!code) return
    setGenerateMessage('')
    setIsGenerating(true)
    try {
      const result = await window.electronAPI?.generateCandidates?.(code, selectedPeriod, generateLimit) as PlatformResult<CandidateGenerationData> | undefined
      const created = asNumber(result?.success ? result.data.created : 0, 0)
      const minRequired = asNumber(result?.success ? result.data.minRequired : 90, 90)
      const failureCode = result?.success === false ? result.code : ''
      if (result?.success && created > 0) {
        setGenerateMessage(`已生成 ${created} 条候选信号`)
      } else if (failureCode === 'CANDIDATE_GENERATE_KLINE_NOT_ENOUGH') {
        setGenerateMessage(`K线数量不足，未生成候选（至少需要 ${minRequired} 根）`)
      } else if (result?.success) {
        setGenerateMessage('未生成新候选信号')
      } else {
        setGenerateMessage(getPlatformErrorMessage(result, '候选信号生成失败，请检查数据同步状态'))
      }
      await loadCandidates()
    } catch (error) {
      console.error('生成候选信号失败:', error)
      setGenerateMessage('候选信号生成失败，请检查数据同步状态')
    } finally {
      setIsGenerating(false)
    }
  }, [stockCode, selectedPeriod, generateLimit, loadCandidates])

  const handleReview = useCallback(async (candidateId: string, decision: 'accept' | 'reject' | 'edit') => {
    setReviewingId(candidateId)
    try {
      let note = ''
      if (decision === 'edit') {
        note = window.prompt('请输入编辑说明（用于审计日志）', '') || ''
      }
      const result = await window.electronAPI?.reviewSignalCandidate?.(candidateId, decision, note) as PlatformResult<CandidateReviewData> | undefined
      if (!result?.success) {
        console.error('候选审核失败:', getPlatformErrorMessage(result, '候选审核失败'))
        return
      }
      await loadCandidates()
      await onRefreshAll()
    } catch (error) {
      console.error('候选审核失败:', error)
    } finally {
      setReviewingId('')
    }
  }, [loadCandidates, onRefreshAll])

  const summary = useMemo(() => {
    const proposed = candidates.filter((item) => item.status === 'proposed').length
    const accepted = candidates.filter((item) => item.status === 'accepted').length
    const rejected = candidates.filter((item) => item.status === 'rejected').length
    const buy = candidates.filter((item) => item.signalType === 'buy').length
    const sell = candidates.filter((item) => item.signalType === 'sell').length
    const trendQualified = candidates.filter((item) => item.outcomeTag.endsWith('_qualified')).length
    const upTrend = candidates.filter((item) => item.trendState === 'uptrend').length
    return { proposed, accepted, rejected, buy, sell, trendQualified, upTrend }
  }, [candidates])

  return (
    <>
      <section className="model-card">
        <h3>候选信号生成</h3>
        <p className="model-desc">候选生成已升级为结果导向：先提出技术触发点，再用前瞻收益/回撤/RR 做质量门控，只保留更接近“趋势盈利样本”的点进入人工审核。</p>
        <div className="model-grid">
          <label>
            标的代码
            <input value={stockCode} onChange={(e) => setStockCode(e.target.value.trim())} placeholder="如 600000" list="stock-code-options" />
            <datalist id="stock-code-options">
              {stockOptions.map((stock) => (<option key={stock.code} value={stock.code}>{stock.name}</option>))}
            </datalist>
          </label>
          <label>
            周期
            <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value as PeriodType)}>
              <option value="5m">5m</option><option value="15m">15m</option><option value="1d">1d</option>
            </select>
          </label>
          <label>
            回看条数
            <input type="number" min={60} max={500} value={generateLimit} onChange={(e) => setGenerateLimit(Math.max(60, Math.min(500, Number(e.target.value) || 60)))} />
          </label>
          <div className="model-actions">
            <button className="btn btn-primary" onClick={() => void handleGenerateCandidates()} disabled={isGenerating || !stockCode.trim()}>
              {isGenerating ? '生成中...' : '生成候选'}
            </button>
          </div>
        </div>
        {generateMessage && <p className="model-message">{generateMessage}</p>}
        <div className="model-card-head" style={{ marginTop: '0.65rem' }}>
          <h3>结果门槛参数</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => void loadOutcomeSettings()} disabled={isLoadingOutcomeSettings}>
            {isLoadingOutcomeSettings ? '加载中...' : '重载'}
          </button>
        </div>
        {outcomeSettings ? (
          <div className="model-grid">
            <label>
              配置周期
              <select value={outcomeSettingsPeriod} onChange={(e) => setOutcomeSettingsPeriod(e.target.value as PeriodType)}>
                <option value="5m">5m</option><option value="15m">15m</option><option value="1d">1d</option>
              </select>
            </label>
            {OUTCOME_FIELD_LIST.map((field) => (
              <label key={`outcome_field_${field.key}`}>
                {field.label}
                <input
                  type="number"
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  value={outcomeSettings[outcomeSettingsPeriod][field.key]}
                  onChange={(e) => handleOutcomeSettingChange(field.key, e.target.value)}
                />
              </label>
            ))}
            <div className="model-actions">
              <button className="btn btn-primary" onClick={() => void handleSaveOutcomeSettings()} disabled={isSavingOutcomeSettings}>
                {isSavingOutcomeSettings ? '保存中...' : '保存门槛'}
              </button>
            </div>
          </div>
        ) : (
          <div className="model-empty">结果门槛配置不可用，请重试加载。</div>
        )}
        {outcomeSettingsMessage && <p className="model-message">{outcomeSettingsMessage}</p>}
      </section>

      <section className="model-card">
        <div className="model-card-head">
          <h3>人工审核台</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => void loadCandidates()} disabled={isLoadingCandidates}>
            {isLoadingCandidates ? '刷新中...' : '刷新'}
          </button>
        </div>
        <div className="model-filters">
          <label>
            状态
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CandidateStatus)}>
              <option value="all">全部</option><option value="proposed">待审核</option><option value="accepted">已接受</option><option value="rejected">已拒绝</option><option value="edited">已编辑</option>
            </select>
          </label>
          <label>
            周期
            <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as 'all' | PeriodType)}>
              <option value="all">全部</option><option value="5m">5m</option><option value="15m">15m</option><option value="1d">1d</option>
            </select>
          </label>
          <label>
            标的
            <input value={codeFilter} onChange={(e) => setCodeFilter(e.target.value.trim())} placeholder="代码筛选" />
          </label>
        </div>
        <div className="model-summary">
          <span>总数 {candidates.length}</span><span>待审核 {summary.proposed}</span><span>已接受 {summary.accepted}</span>
          <span>已拒绝 {summary.rejected}</span><span>买点 {summary.buy}</span><span>卖点 {summary.sell}</span><span>结果门槛通过 {summary.trendQualified}</span><span>上升趋势 {summary.upTrend}</span>
        </div>
        {isLoadingCandidates ? (
          <div className="model-empty">正在加载候选信号...</div>
        ) : candidates.length === 0 ? (
          <div className="model-empty">暂无候选信号，先生成一批再审核。</div>
        ) : (
          <div className="model-table-wrap">
            <table>
              <thead>
                <tr><th>时间</th><th>标的</th><th>周期</th><th>信号</th><th>因子</th><th>评分</th><th>前瞻(退出/浮盈/回撤)</th><th>RR</th><th>趋势</th><th>结果标签</th><th>原因</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td>{candidate.tradeDate} {candidate.tradeTime || ''}</td>
                    <td>{candidate.code} {candidate.stockName || ''}</td>
                    <td>{candidate.period}</td>
                    <td className={candidate.signalType === 'buy' ? 'signal-buy' : 'signal-sell'}>{signalLabel(candidate.signalType)}</td>
                    <td>{toFactorLabel(candidate.factorType)}</td>
                    <td>{candidate.score.toFixed(1)}</td>
                    <td>{`${formatSignedPct(candidate.forwardExitReturnPct)} / ${formatSignedPct(candidate.forwardMaxReturnPct)} / ${formatSignedPct(candidate.forwardMinReturnPct)}`}</td>
                    <td>{formatRiskReward(candidate.forwardRiskReward)}</td>
                    <td>{trendStateLabel(candidate.trendState)}</td>
                    <td>{outcomeTagLabel(candidate.outcomeTag)}</td>
                    <td className="reason-cell">{candidate.reason || '-'}</td>
                    <td><span className={`candidate-status status-${candidate.status}`}>{statusLabel[candidate.status] || candidate.status}</span></td>
                    <td>
                      <div className="review-actions">
                        <button className="btn btn-sm btn-accept" disabled={!!reviewingId} onClick={() => void handleReview(candidate.id, 'accept')}>通过</button>
                        <button className="btn btn-sm btn-reject" disabled={!!reviewingId} onClick={() => void handleReview(candidate.id, 'reject')}>拒绝</button>
                        <button className="btn btn-sm btn-secondary" disabled={!!reviewingId} onClick={() => void handleReview(candidate.id, 'edit')}>编辑</button>
                      </div>
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

export default CandidateTab
