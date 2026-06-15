import { useMemo, useState, type CSSProperties } from 'react'
import type { ExecutionMode, PeriodType, SessionStatus, TrainingSample } from '../blind/types'
import { REGIME_COLOR_MAP, REGIME_OPTIONS } from './constants'
import { CheckIcon, GearIcon } from '../../common/Icons'
const SAMPLE_POOL_BAR_OPTIONS = [260, 520, 1040, 1560]
const SAMPLE_CANDIDATE_OPTIONS = [
  { value: 40, label: '40只' },
  { value: 80, label: '80只' },
  { value: 200, label: '200只' },
  { value: 500, label: '500只' }
]
const EXECUTION_MODE_OPTIONS: { value: ExecutionMode; label: string }[] = [
  { value: 'close', label: '盘尾收盘' },
  { value: 'next_open', label: '次根开盘' }
]

interface SessionToolbarProps {
  activeSample: TrainingSample | null
  period: PeriodType
  regime: string
  currentBarIndex: number
  sampleCount: number
  sessionStatus: SessionStatus
  dataReady: boolean
  sampleLoading: boolean
  showSettings: boolean
  continuousMode: boolean
  executionMode: ExecutionMode
  actionPending: boolean
  samplePoolBars: number
  candidateCount: number
  minPrice: number
  activeSampleLoadedBars: number
  activeSampleTotalBars?: number
  loadingMoreBars: boolean
  onToggleSettings: () => void
  onFinishSession: () => void
  onStartTraining: () => void
  onApplySettings: (settings: {
    period: PeriodType
    regime: string
    continuousMode: boolean
    executionMode: ExecutionMode
    samplePoolBars: number
    candidateCount: number
    minPrice: number
  }) => void
  onLoadMoreBars: () => void
  settingsFeedback?: string
}

interface DraftSettings {
  period: PeriodType
  regime: string
  continuousMode: boolean
  executionMode: ExecutionMode
  samplePoolBars: number
  candidateCount: number
  minPrice: number
}

interface SettingsPanelProps {
  initialSettings: DraftSettings
  sampleLoading: boolean
  loadingMoreBars: boolean
  actionPending: boolean
  activeSample: TrainingSample | null
  onApplySettings: SessionToolbarProps['onApplySettings']
  onLoadMoreBars: () => void
}

const createDraftSettings = (settings: DraftSettings): DraftSettings => ({ ...settings })

const SettingsPanel = ({
  initialSettings,
  sampleLoading,
  loadingMoreBars,
  actionPending,
  activeSample,
  onApplySettings,
  onLoadMoreBars
}: SettingsPanelProps) => {
  const [draftSettings, setDraftSettings] = useState(() => createDraftSettings(initialSettings))

  const hasChanges =
    draftSettings.period !== initialSettings.period ||
    draftSettings.regime !== initialSettings.regime ||
    draftSettings.continuousMode !== initialSettings.continuousMode ||
    draftSettings.executionMode !== initialSettings.executionMode ||
    draftSettings.samplePoolBars !== initialSettings.samplePoolBars ||
    draftSettings.candidateCount !== initialSettings.candidateCount ||
    draftSettings.minPrice !== initialSettings.minPrice

  const handleApply = () => {
    onApplySettings(draftSettings)
  }

  return (
    <div className="wt-settings-bar">
      <div className="wt-settings-row">
        <div className="wt-filter-group">
          <span className="wt-filter-label">周期</span>
          <div className="wt-period-btns">
            {(['1d'] as PeriodType[]).map((item) => (
              <button
                key={item}
                className={`wt-period-btn ${draftSettings.period === item ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, period: item }))}
                disabled={sampleLoading}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="wt-filter-group">
          <span className="wt-filter-label">走势筛选</span>
          <div className="wt-regime-btns">
            {REGIME_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`wt-regime-btn ${draftSettings.regime === option.value ? 'active' : ''}`}
                style={{ '--active-color': option.color } as CSSProperties}
                onClick={() => setDraftSettings((current) => ({ ...current, regime: option.value }))}
                disabled={sampleLoading}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="wt-filter-group">
          <label className="wt-continuous-check">
            <input
              type="checkbox"
              checked={draftSettings.continuousMode}
              onChange={(event) => setDraftSettings((current) => ({ ...current, continuousMode: event.target.checked }))}
            />
            <span>连续训练模式</span>
          </label>
        </div>
        <div className="wt-filter-group">
          <span className="wt-filter-label">成交模式</span>
          <div className="wt-period-btns">
            {EXECUTION_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`wt-period-btn ${draftSettings.executionMode === option.value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, executionMode: option.value }))}
                disabled={actionPending}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="wt-filter-group">
          <span className="wt-filter-label">
            样本池深度
            <span className="wt-tooltip-trigger" title="每只股票最多取多少根 K 线参与训练。数值越大，可训练的历史越深，但加载越慢。520 根约等于 2 年日线。">?</span>
          </span>
          <div className="wt-period-btns wt-sample-depth-btns">
            {SAMPLE_POOL_BAR_OPTIONS.map((value) => (
              <button
                key={value}
                className={`wt-period-btn ${draftSettings.samplePoolBars === value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, samplePoolBars: value }))}
                disabled={sampleLoading || loadingMoreBars}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="wt-filter-group">
          <span className="wt-filter-label">
            抽样范围
            <span className="wt-tooltip-trigger" title="从多少只候选股票中随机抽取训练样本。数值越大，样本多样性越高，但加载耗时越长。建议日常训练使用 80~200 只。">?</span>
          </span>
          <div className="wt-period-btns">
            {SAMPLE_CANDIDATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`wt-period-btn ${draftSettings.candidateCount === option.value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, candidateCount: option.value }))}
                disabled={sampleLoading}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="wt-filter-group">
          <span className="wt-filter-label">最低股价</span>
          <div className="wt-price-filter">
            <input
              className="wt-price-input"
              type="number"
              min="0"
              step="1"
              placeholder="不限"
              value={draftSettings.minPrice || ''}
              onChange={(e) => setDraftSettings((current) => ({ ...current, minPrice: Number(e.target.value) || 0 }))}
            />
            <span className="wt-price-unit">元</span>
          </div>
          <div className="wt-filter-subtext">
            过滤低价股，只选最新收盘价 ≥ 该值的股票。0 表示不限。
          </div>
        </div>
        {activeSample && (
          <div className="wt-filter-group">
            <span className="wt-filter-label">当前样本</span>
            <button
              className="wt-load-more-btn"
              onClick={onLoadMoreBars}
              disabled={loadingMoreBars}
            >
              {loadingMoreBars ? '补载中...' : '补载更多 K 线'}
            </button>
          </div>
        )}
      </div>
      <div className="wt-settings-footer">
        <button
          className="wt-btn wt-btn-primary"
          onClick={handleApply}
          disabled={!hasChanges || sampleLoading}
        >
          {hasChanges ? (
            <span className="wt-btn-icon-text">
              <CheckIcon size={14} />
              <span>应用设置</span>
            </span>
          ) : '设置已同步'}
        </button>
        {hasChanges && <span className="wt-settings-hint">有未应用的更改</span>}
      </div>
    </div>
  )
}

const SessionToolbar = ({
  activeSample,
  period,
  regime,
  currentBarIndex,
  sampleCount,
  sessionStatus,
  dataReady,
  sampleLoading,
  showSettings,
  continuousMode,
  executionMode,
  actionPending,
  samplePoolBars,
  candidateCount,
  minPrice,
  activeSampleLoadedBars,
  activeSampleTotalBars,
  loadingMoreBars,
  onToggleSettings,
  onFinishSession,
  onStartTraining,
  onApplySettings,
  onLoadMoreBars,
  settingsFeedback
}: SessionToolbarProps) => {
  const initialSettings = useMemo<DraftSettings>(() => ({
    period,
    regime,
    continuousMode,
    executionMode,
    samplePoolBars,
    candidateCount,
    minPrice
  }), [period, regime, continuousMode, executionMode, samplePoolBars, candidateCount, minPrice])

  const settingsKey = useMemo(
    () => JSON.stringify(initialSettings),
    [initialSettings]
  )

  return (
    <>
      <div className="wt-session-bar">
        <div className="wt-session-info">
          <span className="wt-session-tag">{activeSample?.period || period}</span>
          {activeSample && (
            <span
              className="wt-regime-tag"
              style={{ backgroundColor: REGIME_COLOR_MAP[activeSample.regime] || '#6f7f9b' }}
            >
              {activeSample.regime}
            </span>
          )}
          {activeSample && (
            <span className="wt-bar-counter">Bar {currentBarIndex + 1}/{activeSample.klines.length}</span>
          )}
          <span className="wt-session-tag">{executionMode === 'close' ? '盘尾收盘' : '次根开盘'}</span>
          {activeSample && activeSampleTotalBars != null && activeSampleTotalBars > 0 && (
            <span className="wt-bar-counter">已加载 {activeSampleLoadedBars}/{activeSampleTotalBars}</span>
          )}
          {!activeSample && dataReady && (
            <span className="wt-bar-counter">样本池 {sampleCount} 个</span>
          )}
        </div>
        <div className="wt-session-controls">
          <button
            className="wt-inline-btn"
            onClick={onToggleSettings}
            title="设置"
          >
            <span className="wt-btn-icon-text">
              <GearIcon size={14} />
              {showSettings ? '收起设置' : '设置'}
            </span>
          </button>
          {sessionStatus === 'running' && (
            <button
              className="wt-inline-btn"
              onClick={onFinishSession}
              disabled={actionPending}
            >
              结束结算
            </button>
          )}
          {!activeSample && dataReady && (
            <button
              className="wt-inline-btn wt-inline-btn-accent"
              onClick={onStartTraining}
              disabled={sampleLoading}
            >
              开始训练
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          key={settingsKey}
          initialSettings={initialSettings}
          sampleLoading={sampleLoading}
          loadingMoreBars={loadingMoreBars}
          actionPending={actionPending}
          activeSample={activeSample}
          onApplySettings={onApplySettings}
          onLoadMoreBars={onLoadMoreBars}
        />
      )}

      {settingsFeedback && (
        <div className="wt-settings-feedback">{settingsFeedback}</div>
      )}
    </>
  )
}

export default SessionToolbar
