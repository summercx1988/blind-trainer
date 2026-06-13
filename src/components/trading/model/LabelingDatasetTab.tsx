import { useCallback, useEffect, useState } from 'react'
import DatasetTab from './DatasetTab'
import LabelInspectPanel from './LabelInspectPanel'
import InfoHover from '../../common/InfoHover'
import type { DatasetItem } from './types'

interface LabelerInfo {
  name: string
  display_name: string
  supported_presets: string[]
  default_strategy: string
  description: string
  candidate_source: string
  path_validator: string
  created_at: string
}

interface LabelerPreset {
  id: string
  label: string
  desc: string
}

const LABELER_PRESET_META: Record<string, Record<string, LabelerPreset>> = {
  swing: {
    uptrend_strict: { id: 'uptrend_strict', label: '严格', desc: 'ADX≥22, 最小盈利10%, 持仓≥5天, 高质量样本' },
    uptrend_balanced: { id: 'uptrend_balanced', label: '平衡', desc: 'ADX≥20, 最小盈利8%, 持仓≥5天, MA20连续向上' },
    uptrend_loose: { id: 'uptrend_loose', label: '宽松', desc: 'ADX≥18, 最小盈利5%, 持仓≥3天, 更多样本' },
    quick_test: { id: 'quick_test', label: '快速验证', desc: '仅处理10只股票，快速验证打标质量' },
  },
  reversal_rebound: {
    coverage: { id: 'coverage', label: '宽覆盖', desc: '前置跌幅≥15%, 止盈10%, 止损8%, 最长60天' },
    balanced: { id: 'balanced', label: '平衡', desc: '前置跌幅≥18%, 止盈12%, 止损7%, 最长45天' },
    precision: { id: 'precision', label: '严格', desc: '前置跌幅≥25%, 止盈15%, 止损6%, 最长45天' },
    quick_test: { id: 'quick_test', label: '快速验证', desc: '仅处理10只股票，快速验证打标质量' },
  },
  classic_meta: {
    ma_cross_balanced: { id: 'ma_cross_balanced', label: 'MA交叉', desc: 'MA金叉候选 + Triple Barrier 验收' },
    macd_cross_balanced: { id: 'macd_cross_balanced', label: 'MACD交叉', desc: 'MACD金叉候选 + Triple Barrier 验收' },
    boll_rebound_balanced: { id: 'boll_rebound_balanced', label: 'BOLL反弹', desc: 'BOLL下轨反弹候选 + Triple Barrier 验收' },
    breakout_balanced: { id: 'breakout_balanced', label: '突破', desc: 'N日突破候选 + Triple Barrier 验收' },
  },
  cross_sectional_rank: {
    top10_balanced: { id: 'top10_balanced', label: 'Top10%', desc: '10日前瞻收益 Top 10% 个股' },
    top20_coverage: { id: 'top20_coverage', label: 'Top20%', desc: '15日前瞻收益 Top 20% 个股' },
    top5_precision: { id: 'top5_precision', label: 'Top5%', desc: '5日前瞻收益 Top 5% 个股' },
  },
  trend_pullback: {
    precision: { id: 'precision', label: '严格', desc: 'ADX≥22, 回踩≤8%, MA20斜率≥0.03%, 止盈10%' },
    balanced: { id: 'balanced', label: '平衡', desc: 'ADX≥18, 回踩≤12%, MA20斜率≥0.02%, 止盈8%' },
    coverage: { id: 'coverage', label: '宽覆盖', desc: 'ADX≥15, 回踩≤15%, MA20斜率≥0.01%, 止盈7%' },
    quick_test: { id: 'quick_test', label: '快速验证', desc: '仅处理10只股票，快速验证打标质量' },
  },
  breakout_retest: {
    precision: { id: 'precision', label: '严格', desc: '30日阻力位突破, 回踩≤3%, 量能确认1.5x' },
    balanced: { id: 'balanced', label: '平衡', desc: '20日阻力位突破, 回踩≤5%, 量能确认1.2x' },
    coverage: { id: 'coverage', label: '宽覆盖', desc: '15日阻力位突破, 回踩≤8%, 止盈8%' },
    quick_test: { id: 'quick_test', label: '快速验证', desc: '仅处理10只股票，快速验证打标质量' },
  },
  vol_squeeze: {
    precision: { id: 'precision', label: '严格', desc: 'BOLL(1.5σ)收敛≥15日, 量能≥2x, 止盈12%' },
    balanced: { id: 'balanced', label: '平衡', desc: 'BOLL(2σ)收敛≥10日, 量能≥1.5x, 止盈10%' },
    coverage: { id: 'coverage', label: '宽覆盖', desc: 'BOLL(2.5σ)收敛≥7日, 量能≥1.2x, 止盈8%' },
    quick_test: { id: 'quick_test', label: '快速验证', desc: '仅处理10只股票，快速验证打标质量' },
  },
}

type SubView = 'generate' | 'review' | 'dataset'

interface LabelingDatasetTabProps {
  onDatasetsChange: (datasets: DatasetItem[]) => void
}

const LabelingDatasetTab = ({ onDatasetsChange }: LabelingDatasetTabProps) => {
  const [subView, setSubView] = useState<SubView>('generate')
  const [labelers, setLabelers] = useState<LabelerInfo[]>([])
  const [labelersLoading, setLabelersLoading] = useState(true)
  const [selectedLabeler, setSelectedLabeler] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('')
  const [stockLimit, setStockLimit] = useState(0)
  const [lookbackBars, setLookbackBars] = useState(0)
  const [minRequiredBars, setMinRequiredBars] = useState(180)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [labelMessage, setLabelMessage] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])

  useEffect(() => {
    const loadLabelers = async () => {
      try {
        const result = await window.electronAPI?.listLabelers?.() as {
          success?: boolean
          data?: LabelerInfo[]
          error?: { message?: string }
        } | undefined
        if (result?.success && Array.isArray(result.data)) {
          setLabelers(result.data)
          if (result.data.length > 0 && !selectedLabeler) {
            setSelectedLabeler(result.data[0].name)
            const presets = result.data[0].supported_presets
            if (presets.length > 0) setSelectedPreset(presets[0])
          }
        }
      } catch { /* ignore */ }
      setLabelersLoading(false)
    }
    void loadLabelers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isGenerating) return
    const unsub = window.electronAPI?.onLabelProgress?.((msg: string) => {
      setLogLines((prev) => [...prev.slice(-4), msg])
    })
    return () => { unsub?.() }
  }, [isGenerating])

  const currentLabeler = labelers.find((l) => l.name === selectedLabeler)
  const currentPresets = currentLabeler?.supported_presets ?? []
  const presetMetaMap = selectedLabeler ? (LABELER_PRESET_META[selectedLabeler] ?? {}) : {}
  const currentPresetMeta = presetMetaMap[selectedPreset]

  const handleLabelerChange = useCallback((name: string) => {
    setSelectedLabeler(name)
    const labeler = labelers.find((l) => l.name === name)
    const presets = labeler?.supported_presets ?? []
    setSelectedPreset(presets[0] ?? '')
    setStockLimit(0)
    setLabelMessage('')
  }, [labelers])

  const handleGenerateLabels = useCallback(async () => {
    if (!selectedLabeler) return
    setIsGenerating(true)
    setLabelMessage('')
    setLogLines([])
    try {
      if (startDate && endDate && startDate > endDate) {
        setLabelMessage('时间窗口无效：结束日期不能早于开始日期')
        setIsGenerating(false)
        return
      }
      const result = await window.electronAPI?.generateLabels?.({
        labeler: selectedLabeler,
        start: startDate || undefined,
        end: endDate || undefined,
        qualityPreset: selectedPreset || undefined,
        stockLimit: stockLimit > 0 ? stockLimit : undefined,
        lookbackBars: lookbackBars > 0 ? lookbackBars : undefined,
        minRequiredBars: minRequiredBars > 0 ? minRequiredBars : undefined,
      }) as {
        success?: boolean
        data?: {
          output?: Record<string, unknown>
          [key: string]: unknown
        }
        error?: { message?: string }
      } | undefined
      if (result?.success) {
        const output = (result.data?.output ?? result.data ?? {}) as Record<string, unknown>
        const summary = formatResultSummary(selectedLabeler, output)
        setLabelMessage(summary || '标注完成，结果已入库')
      } else {
        setLabelMessage(`标注失败: ${result?.error?.message || '未知错误'}`)
      }
    } catch (error) {
      setLabelMessage(`标注异常: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsGenerating(false)
      setIsCancelling(false)
    }
  }, [selectedLabeler, selectedPreset, stockLimit, lookbackBars, minRequiredBars, startDate, endDate])

  const handleCancelGenerate = useCallback(async () => {
    if (!isGenerating || isCancelling) return
    setIsCancelling(true)
    try {
      const result = await window.electronAPI?.cancelLabelGeneration?.() as {
        success?: boolean
        error?: { message?: string }
      } | undefined
      if (result?.success) {
        setLabelMessage('已请求中止，正在停止标注进程...')
      } else {
        setLabelMessage(`中止失败: ${result?.error?.message || '当前没有可中止任务'}`)
        setIsCancelling(false)
      }
    } catch (error) {
      setLabelMessage(`中止异常: ${error instanceof Error ? error.message : String(error)}`)
      setIsCancelling(false)
    }
  }, [isGenerating, isCancelling])

  const subTabs: { id: SubView; label: string; desc: string }[] = [
    { id: 'generate', label: '标签生成', desc: '选择标签策略并批量生成标签' },
    { id: 'review', label: '抽样审核', desc: 'K线可视化检查标签质量' },
    { id: 'dataset', label: '数据集管理', desc: '创建、冻结、合并、对比数据集' },
  ]

  const paramHint = [
    currentLabeler ? `标签器: ${currentLabeler.display_name}` : '',
    currentPresetMeta ? `预设: ${currentPresetMeta.desc}` : selectedPreset ? `预设: ${selectedPreset}` : '',
    stockLimit > 0 ? `处理 ${stockLimit} 只` : '全市场',
    `历史窗口 ${lookbackBars > 0 ? `${lookbackBars} bars` : '全历史'}`,
    `最少 ${minRequiredBars} bars`,
    startDate || endDate ? `时间 ${startDate || '...'} ~ ${endDate || '...'}` : '',
  ].filter(Boolean).join(' | ')

  return (
    <>
      <div className="model-sub-tab-bar">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            className={`model-sub-tab ${subView === tab.id ? 'model-sub-tab--active' : ''}`}
            onClick={() => setSubView(tab.id)}
            title={tab.desc}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subView === 'generate' && (
        <section className="model-card">
          <div className="model-card-head">
            <h3>标签生成 <InfoHover content="选择已注册的标签策略，配置参数后批量生成标签。新增标签器 = Python 侧 1 个文件 + @register_labeler，前端自动可用。" /></h3>
          </div>

          {labelersLoading && <p className="model-desc" style={{ color: '#888' }}>加载标签器列表...</p>}

          {!labelersLoading && labelers.length === 0 && (
            <p className="model-desc" style={{ color: '#ff9800' }}>未找到已注册的标签器，请检查 Python 环境。</p>
          )}

          {!labelersLoading && labelers.length > 0 && (
            <>
              <div className="model-desc" style={{ marginTop: 2, marginBottom: 4, color: '#4fc3f7' }}>
                {paramHint}
              </div>

              <div className="model-section-label" style={{ marginTop: 2 }}>
                标签器 <InfoHover content="选择要使用的标签策略。每种策略有不同的候选生成逻辑和真值验收方法。" />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {labelers.map((labeler) => (
                  <button
                    key={labeler.name}
                    className={`model-stage-chip ${selectedLabeler === labeler.name ? 'model-stage-chip--active' : ''}`}
                    onClick={() => handleLabelerChange(labeler.name)}
                    title={labeler.description}
                    style={{ fontSize: '0.78rem' }}
                  >
                    {labeler.display_name}
                  </button>
                ))}
              </div>

              {currentLabeler && (
                <div style={{ marginTop: 6, marginBottom: 2, padding: '8px 12px', background: 'rgba(33,150,243,0.07)', borderRadius: 6, borderLeft: '3px solid #2196f3' }}>
                  <div style={{ fontSize: '0.82rem', color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>
                    {currentLabeler.display_name} — {currentLabeler.description}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#90caf9', lineHeight: 1.6 }}>
                    <span style={{ color: '#aaa' }}>策略:</span> {currentLabeler.default_strategy}
                  </div>
                  {currentLabeler.candidate_source && (
                    <div style={{ fontSize: '0.75rem', color: '#a5d6a7', lineHeight: 1.6, marginTop: 3 }}>
                      <span style={{ color: '#aaa' }}>候选生成:</span> {currentLabeler.candidate_source}
                    </div>
                  )}
                  {currentLabeler.path_validator && (
                    <div style={{ fontSize: '0.75rem', color: '#ffcc80', lineHeight: 1.6, marginTop: 3 }}>
                      <span style={{ color: '#aaa' }}>真值验收:</span> {currentLabeler.path_validator}
                    </div>
                  )}
                  {currentLabeler.created_at && (
                    <div style={{ fontSize: '0.68rem', color: '#555', marginTop: 4, textAlign: 'right' }}>
                      v{currentLabeler.created_at}
                    </div>
                  )}
                </div>
              )}

              {currentPresets.length > 0 && (
                <>
                  <div className="model-section-label" style={{ marginTop: 6 }}>
                    参数预设 <InfoHover content="一键切换参数组合，选择后可手动微调。" />
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {currentPresets.map((presetId) => {
                      const meta = presetMetaMap[presetId]
                      return (
                        <button
                          key={presetId}
                          className={`model-stage-chip ${selectedPreset === presetId ? 'model-stage-chip--active' : ''}`}
                          onClick={() => setSelectedPreset(presetId)}
                          title={meta?.desc || presetId}
                          style={{ fontSize: '0.78rem' }}
                        >
                          {meta?.label || presetId}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              <div className="model-section-label" style={{ marginTop: 6 }}>数据范围</div>
              <div className="model-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 4, gap: '0.5rem' }}>
                <label>开始日期 <InfoHover content="可选。留空表示从最早可用数据开始打标。" />
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
                <label>结束日期 <InfoHover content="可选。留空表示截至最新可用数据。" />
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </label>
                <label>处理股票数 <InfoHover content="最多标注多少只股票。0=全市场。建议验证时用10-50只。" />
                  <input type="number" min={0} max={5000} step={10} value={stockLimit} onChange={(e) => setStockLimit(parseInt(e.target.value) || 0)} />
                </label>
                <label>历史窗口 (bars) <InfoHover content="每只股票最多使用多少根日线。250≈1年，750≈3年。0=全历史。" />
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={50}
                    value={lookbackBars}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10)
                      setLookbackBars(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0)
                    }}
                  />
                </label>
                <label>最少有效 bars <InfoHover content="可用日线不足此值的股票直接跳过。" />
                  <input type="number" min={60} max={3000} step={20} value={minRequiredBars} onChange={(e) => setMinRequiredBars(parseInt(e.target.value) || 180)} />
                </label>
              </div>

              <div className="model-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-primary" onClick={() => void handleGenerateLabels()} disabled={isGenerating || !selectedLabeler}>
                  {isGenerating ? '标注中...' : `开始标注（${stockLimit > 0 ? `${stockLimit}只` : '全市场'}，${currentPresetMeta?.label || selectedPreset || '默认'}）`}
                </button>
                <button
                  className="btn"
                  onClick={() => void handleCancelGenerate()}
                  disabled={!isGenerating || isCancelling}
                >
                  {isCancelling ? '中止中...' : '中止标注'}
                </button>
              </div>
            </>
          )}
          {labelMessage && <p className="model-message">{labelMessage}</p>}

          {isGenerating && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  flex: 1, height: 18, background: '#1a1a2e',
                  borderRadius: 9, overflow: 'hidden', border: '1px solid #333',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${parseProgressPct(logLines)}%`,
                    background: 'linear-gradient(90deg, #1565c0, #42a5f5)',
                    borderRadius: 9,
                    transition: 'width 0.3s ease',
                    minWidth: logLines.length > 0 ? 2 : 0,
                  }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: '#4fc3f7', whiteSpace: 'nowrap', fontFamily: 'Menlo, Monaco, monospace' }}>
                  {logLines.length > 0 ? logLines[logLines.length - 1] : '准备中...'}
                </span>
              </div>
            </div>
          )}
          {!isGenerating && logLines.length > 0 && (
            <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#666' }}>
              上次完成: {logLines[logLines.length - 1]}
            </div>
          )}
        </section>
      )}

      {subView === 'review' && <LabelInspectPanel />}

      {subView === 'dataset' && <DatasetTab onDatasetsChange={onDatasetsChange} />}
    </>
  )
}

function parseProgressPct(logLines: string[]): number {
  if (logLines.length === 0) return 0
  const last = logLines[logLines.length - 1]
  const m = last.match(/(\d+)\/(\d+)/)
  if (!m) return 0
  const cur = parseInt(m[1], 10)
  const tot = parseInt(m[2], 10)
  return tot > 0 ? Math.round(cur / tot * 100) : 0
}

function formatResultSummary(_labeler: string, output: Record<string, unknown>): string {
  const parts: string[] = []
  const pairCount = Number(output.pair_count ?? output.count ?? 0)
  const inserted = Number(output.inserted ?? output.inserted_count ?? 0)
  const updated = Number(output.updated ?? output.updated_count ?? 0)
  const stockCount = Number(output.stock_count ?? output.stockCount ?? 0)
  const cleaned = Number(output.cleaned ?? 0)
  const detached = Number(output.detachedDatasetRefs ?? 0)
  const skipped = output.skippedReasons as Record<string, number> | undefined
  const runStats = output.runStats as Record<string, number> | undefined

  if (pairCount) parts.push(`${Math.floor(pairCount / 2) > 0 ? `${Math.floor(pairCount / 2)} 笔交易对` : `${pairCount} 条`}`)
  if (inserted) parts.push(`新增 ${inserted} 条`)
  if (updated) parts.push(`更新 ${updated} 条`)
  if (cleaned) parts.push(`覆盖清理 ${cleaned} 条`)
  if (detached) parts.push(`冻结引用解绑 ${detached} 条`)
  if (stockCount) parts.push(`覆盖 ${stockCount} 只股票`)

  const extra: string[] = []
  if (runStats) {
    if (runStats.no_pairs) extra.push(`无配对 ${runStats.no_pairs}`)
    if (runStats.insufficient_bars) extra.push(`数据不足 ${runStats.insufficient_bars}`)
    if (runStats.failed) extra.push(`失败 ${runStats.failed}`)
  }
  if (skipped && Object.keys(skipped).length > 0) {
    for (const [reason, count] of Object.entries(skipped)) {
      extra.push(`${reason} ${count}`)
    }
  }
  if (extra.length) parts.push(`| ${extra.join(' | ')}`)

  const preset = output.quality_preset ?? output.qualityPreset
  if (preset) parts.push(`| 预设: ${preset}`)

  return parts.length > 0 ? `标注完成: ${parts.join(', ')}` : ''
}

export default LabelingDatasetTab
