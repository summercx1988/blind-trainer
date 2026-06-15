import { useMemo, useState, type CSSProperties } from 'react'
import type { ExecutionMode, PeriodType, SessionStatus, TrainingSample } from '../blind/types'
import { CANDIDATE_COUNT_OPTIONS, DEFAULT_WORKBENCH_SETTINGS, REGIME_COLOR_MAP, REGIME_OPTIONS } from './constants'
import { CheckIcon, GearIcon } from '../../common/Icons'

const EXECUTION_MODE_OPTIONS: { value: ExecutionMode; label: string; tooltip: string }[] = [
  { value: 'close', label: '当天收盘价', tooltip: '以当前 K 线（t 时刻）的收盘价成交。适合模拟尾盘买入/卖出。' },
  { value: 'next_open', label: '次日开盘价', tooltip: '以下一根 K 线（t+1 时刻）的开盘价成交。更接近真实交易。' }
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
  candidateCount: number
  minPrice: number
  activeSampleLoadedBars: number
  activeSampleTotalBars?: number
  onToggleSettings: () => void
  onFinishSession: () => void
  onStartTraining: () => void
  onResetSettings: () => void
  onApplySettings: (settings: {
    period: PeriodType
    regime: string
    continuousMode: boolean
    executionMode: ExecutionMode
    candidateCount: number
    minPrice: number
  }) => void
  settingsFeedback?: string
}

interface DraftSettings {
  period: PeriodType
  regime: string
  continuousMode: boolean
  executionMode: ExecutionMode
  candidateCount: number
  minPrice: number
}

interface SettingsPanelProps {
  initialSettings: DraftSettings
  sampleLoading: boolean
  actionPending: boolean
  onApplySettings: SessionToolbarProps['onApplySettings']
  onResetSettings: () => void
}

const createDraftSettings = (settings: DraftSettings): DraftSettings => ({ ...settings })

const SettingsPanel = ({
  initialSettings,
  sampleLoading,
  actionPending,
  onApplySettings,
  onResetSettings
}: SettingsPanelProps) => {
  const [draftSettings, setDraftSettings] = useState(() => createDraftSettings(initialSettings))

  const hasChanges =
    draftSettings.period !== initialSettings.period ||
    draftSettings.regime !== initialSettings.regime ||
    draftSettings.continuousMode !== initialSettings.continuousMode ||
    draftSettings.executionMode !== initialSettings.executionMode ||
    draftSettings.candidateCount !== initialSettings.candidateCount ||
    draftSettings.minPrice !== initialSettings.minPrice

  const handleApply = () => {
    onApplySettings(draftSettings)
  }

  const handleReset = () => {
    onResetSettings()
  }

  return (
    <div className="wt-settings-bar">
      <div className="wt-settings-row">
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
          <span className="wt-filter-label">
            成交价
            <span className="wt-tooltip-trigger" data-tooltip="决定买入/卖出的成交价格。">?</span>
          </span>
          <div className="wt-period-btns">
            {EXECUTION_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`wt-period-btn ${draftSettings.executionMode === option.value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, executionMode: option.value }))}
                disabled={actionPending}
                title={option.tooltip}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="wt-filter-group">
          <span className="wt-filter-label">
            抽样范围
            <span className="wt-tooltip-trigger" data-tooltip="从多少只候选股票中随机抽取训练样本。数值越大，样本多样性越高，但加载耗时越长。">?</span>
          </span>
          <div className="wt-period-btns">
            {CANDIDATE_COUNT_OPTIONS.map((value) => (
              <button
                key={value}
                className={`wt-period-btn ${draftSettings.candidateCount === value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, candidateCount: value }))}
                disabled={sampleLoading}
              >
                {value}
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
      </div>
      <div className="wt-settings-footer">
        <button
          className="wt-btn wt-btn-secondary"
          onClick={handleReset}
          disabled={sampleLoading}
        >
          恢复默认
        </button>
        {hasChanges && <span className="wt-settings-hint">有未应用的更改</span>}
        <button
          className="wt-btn wt-btn-primary"
          onClick={handleApply}
          disabled={!hasChanges || sampleLoading}
        >
          {hasChanges ? (
            <span className="wt-btn-icon-text">
              <CheckIcon size={14} />
              <span>应用配置</span>
            </span>
          ) : '设置已同步'}
        </button>
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
  candidateCount,
  minPrice,
  activeSampleLoadedBars,
  activeSampleTotalBars,
  onToggleSettings,
  onFinishSession,
  onStartTraining,
  onApplySettings,
  onResetSettings,
  settingsFeedback
}: SessionToolbarProps) => {
  const initialSettings = useMemo<DraftSettings>(() => ({
    period,
    regime,
    continuousMode,
    executionMode,
    candidateCount,
    minPrice
  }), [period, regime, continuousMode, executionMode, candidateCount, minPrice])

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
          <span className="wt-session-tag">{executionMode === 'close' ? '当天收盘' : '次日开盘'}</span>
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
          actionPending={actionPending}
          onApplySettings={onApplySettings}
          onResetSettings={onResetSettings}
        />
      )}

      {settingsFeedback && (
        <div className="wt-settings-feedback">{settingsFeedback}</div>
      )}
    </>
  )
}

export { DEFAULT_WORKBENCH_SETTINGS }
export default SessionToolbar
