import { useMemo, useState, type CSSProperties } from 'react'
import type { ExecutionMode, PeriodType, SessionStatus, TrainingSample } from '../blind/types'
import { DEFAULT_WORKBENCH_SETTINGS, POSITION_RATIO_OPTIONS, REGIME_COLOR_MAP, REGIME_OPTIONS } from './constants'
import { CheckIcon, GearIcon } from '../../common/Icons'

const EXECUTION_MODE_OPTIONS: { value: ExecutionMode; label: string; tooltip: string }[] = [
  { value: 'close', label: '当天收盘价', tooltip: '以当前 K 线（t 时刻）的收盘价成交。适合模拟尾盘买入/卖出。' },
  { value: 'next_open', label: '次日开盘价', tooltip: '以下一根 K 线（t+1 时刻）的开盘价成交。更接近真实交易。' }
]

const SAMPLE_POOL_OPTIONS = [
  { value: 520, label: '标准' },
  { value: 1040, label: '深度' },
  { value: 1560, label: '超深' }
]

const CANDIDATE_DEFAULT = [200, 500]
const CANDIDATE_ADVANCED = [1000, 2000]

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
  samplePoolBars: number
  positionRatio: number
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
    samplePoolBars: number
    positionRatio: number
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
  samplePoolBars: number
  positionRatio: number
}

interface SettingsPanelProps {
  initialSettings: DraftSettings
  sampleLoading: boolean
  actionPending: boolean
  sessionStatus: SessionStatus
  onApplySettings: SessionToolbarProps['onApplySettings']
  onResetSettings: () => void
}

const createDraftSettings = (settings: DraftSettings): DraftSettings => ({ ...settings })

const SettingsPanel = ({
  initialSettings,
  sampleLoading,
  actionPending,
  sessionStatus,
  onApplySettings,
  onResetSettings
}: SettingsPanelProps) => {
  const [draftSettings, setDraftSettings] = useState(() => createDraftSettings(initialSettings))
  const [showAdvanced, setShowAdvanced] = useState(false)

  const hasChanges =
    draftSettings.regime !== initialSettings.regime ||
    draftSettings.continuousMode !== initialSettings.continuousMode ||
    draftSettings.executionMode !== initialSettings.executionMode ||
    draftSettings.candidateCount !== initialSettings.candidateCount ||
    draftSettings.minPrice !== initialSettings.minPrice ||
    draftSettings.samplePoolBars !== initialSettings.samplePoolBars ||
    draftSettings.positionRatio !== initialSettings.positionRatio

  // 判断改了哪些"破坏性"设置（会重置样本池）
  const destructiveChanged =
    draftSettings.regime !== initialSettings.regime ||
    draftSettings.candidateCount !== initialSettings.candidateCount ||
    draftSettings.minPrice !== initialSettings.minPrice ||
    draftSettings.samplePoolBars !== initialSettings.samplePoolBars

  const handleApply = () => {
    onApplySettings(draftSettings)
  }

  const handleReset = () => {
    onResetSettings()
  }

  return (
    <div className="wt-settings-bar">
      {/* 第一组：影响样本池的设置（破坏性） */}
      <div className="wt-settings-group-label">样本筛选</div>
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
          <span className="wt-filter-label">
            样本深度
            <span className="wt-tooltip-trigger" data-tooltip="每只股票最多取多少根 K 线参与训练。标准(520)约 2 年日线，深度(1040)约 4 年，超深(1560)约 6 年。">?</span>
          </span>
          <div className="wt-period-btns">
            {SAMPLE_POOL_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`wt-period-btn ${draftSettings.samplePoolBars === option.value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, samplePoolBars: option.value }))}
                disabled={sampleLoading}
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
            {CANDIDATE_DEFAULT.map((value) => (
              <button
                key={value}
                className={`wt-period-btn ${draftSettings.candidateCount === value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, candidateCount: value }))}
                disabled={sampleLoading}
              >
                {value === 200 ? '标准' : '广泛'}
              </button>
            ))}
            {(showAdvanced || CANDIDATE_ADVANCED.includes(draftSettings.candidateCount)) &&
              CANDIDATE_ADVANCED.map((value) => (
                <button
                  key={value}
                  className={`wt-period-btn ${draftSettings.candidateCount === value ? 'active' : ''}`}
                  onClick={() => setDraftSettings((current) => ({ ...current, candidateCount: value }))}
                  disabled={sampleLoading}
                >
                  {value}
                </button>
              ))
            }
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
        </div>
      </div>

      {/* 分隔线 */}
      <div className="wt-settings-divider" />

      {/* 第二组：热生效设置 */}
      <div className="wt-settings-group-label">交易设置 <span className="wt-settings-group-hint">（即时生效，无需重载）</span></div>
      <div className="wt-settings-row">
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
            仓位档位
            <span className="wt-tooltip-trigger" data-tooltip="每次 B 买入的资金占比。会话开始时按【初始资金 × 比例 ÷ 首根成交价】算出固定股数，之后每次 B 都买这个股数，可多次加仓到满仓。下次新训练生效。">?</span>
          </span>
          <div className="wt-period-btns">
            {POSITION_RATIO_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`wt-period-btn ${draftSettings.positionRatio === option.value ? 'active' : ''}`}
                onClick={() => setDraftSettings((current) => ({ ...current, positionRatio: option.value }))}
                disabled={actionPending}
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
      </div>

      {/* 自动扩展提示 */}
      <div className="wt-settings-hint-row">
        样本不足时系统自动扩展，无需手动操作。
      </div>

      {/* 高级折叠 */}
      {!showAdvanced && !CANDIDATE_ADVANCED.includes(draftSettings.candidateCount) && (
        <button
          className="wt-advanced-toggle"
          onClick={() => setShowAdvanced(true)}
        >
          高级选项
        </button>
      )}

      {/* 底部操作栏 */}
      <div className="wt-settings-footer">
        <button
          className="wt-btn wt-btn-secondary"
          onClick={handleReset}
          disabled={sampleLoading}
        >
          恢复默认
        </button>
        {hasChanges && (
          <span className="wt-settings-hint">
            {sessionStatus === 'running' && destructiveChanged
              ? '⚠ 将结束当前训练并重载样本'
              : '有未应用的更改'}
          </span>
        )}
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
  samplePoolBars,
  positionRatio,
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
    minPrice,
    samplePoolBars,
    positionRatio
  }), [period, regime, continuousMode, executionMode, candidateCount, minPrice, samplePoolBars, positionRatio])

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
          sessionStatus={sessionStatus}
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
