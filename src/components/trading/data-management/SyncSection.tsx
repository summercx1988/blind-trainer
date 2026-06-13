import type { SyncProgress, SyncStrategy } from './types'

interface AutoSyncStatus {
  lastSyncAt: string | null
  nextSyncAt: string
  syncing: boolean
}

interface CoverageGapBucket {
  totalMissing: number
  totalStale: number
  sampleMissing: string[]
  sampleStale: string[]
}

interface CoverageGapSummary {
  scannedAt: string
  latestTradingDate: string | null
  latestMinuteCutoff: string | null
  intervals: Record<'1d' | '15m' | '5m', CoverageGapBucket>
}

interface BackfillExecutionItem {
  requested: number
  processed: number
  failed: number
  insertedRows: number
}

interface CoverageSummary {
  totalStocks: number
  totalDaily: number
  totalMinute: number
  dailyCoverage: number
  m15Coverage: number
  m5Coverage: number
}

interface SyncSectionProps {
  syncing: boolean
  rebuildingStats?: boolean
  progress: SyncProgress | null
  syncLog: string[]
  syncCount: number
  syncPeriods: string[]
  coverage: CoverageSummary
  strategies: SyncStrategy[]
  autoSyncStatus: AutoSyncStatus | null
  gapSummary?: CoverageGapSummary | null
  gapLoading?: boolean
  backfilling?: boolean
  backfillSummary?: {
    daily: BackfillExecutionItem
    m15: BackfillExecutionItem
    m5: BackfillExecutionItem
  } | null
  onApplyStrategy: (strategy: SyncStrategy) => void
  onSyncCountChange: (count: number) => void
  onTogglePeriod: (period: string) => void
  onInit: () => void
  onSync: () => void
  onRebuildStats: () => void
  onInspectMissing: () => void
  onBackfillMissing: () => void
}

const PERIOD_OPTIONS = [
  { value: 'daily', label: '日线' },
  { value: '15m', label: '15分钟' }
]

const toCoveragePct = (covered: number, total: number): string => {
  if (total === 0) return '0.0%'
  return `${((covered / total) * 100).toFixed(1)}%`
}

const formatDateTime = (iso: string | null): string => {
  if (!iso) return '从未'
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

const SyncSection = ({
  syncing,
  rebuildingStats = false,
  progress,
  syncLog,
  syncCount,
  syncPeriods,
  coverage,
  strategies,
  autoSyncStatus,
  gapSummary = null,
  gapLoading = false,
  backfilling = false,
  backfillSummary = null,
  onApplyStrategy,
  onSyncCountChange,
  onTogglePeriod,
  onSync,
  onRebuildStats,
  onInspectMissing,
  onBackfillMissing
}: SyncSectionProps) => {
  const isFullUpdate = syncCount === 0

  return (
    <div className="dm-sync-section">
      <div className="dm-sync-overview">
        <div className="dm-overview-card">
          <div className="dm-overview-num">{coverage.totalStocks}</div>
          <div className="dm-overview-label">已入库股票</div>
        </div>
        <div className="dm-overview-card">
          <div className="dm-overview-num">{coverage.totalDaily.toLocaleString()}</div>
          <div className="dm-overview-label">日线K线总数</div>
        </div>
        <div className="dm-overview-card">
          <div className="dm-overview-num">{coverage.totalMinute.toLocaleString()}</div>
          <div className="dm-overview-label">分钟K线总数</div>
        </div>
      </div>

      <div className="dm-sync-log">
        <div className="dm-log-entry">
          覆盖率: 日线 {coverage.dailyCoverage}/{coverage.totalStocks} ({toCoveragePct(coverage.dailyCoverage, coverage.totalStocks)}) / 15m {coverage.m15Coverage}/{coverage.totalStocks} ({toCoveragePct(coverage.m15Coverage, coverage.totalStocks)})
        </div>
        {autoSyncStatus && (
          <div className="dm-log-entry">
            自动同步: 上次 {formatDateTime(autoSyncStatus.lastSyncAt)} / 下次 {formatDateTime(autoSyncStatus.nextSyncAt)}
            {autoSyncStatus.syncing && ' (同步中...)'}
          </div>
        )}
      </div>

      <div className="dm-sync-panel">
        <h3>数据同步</h3>
        <p className="dm-sync-desc">
          选择策略同步最新行情数据。自动同步在每个交易日 15:15 执行。
        </p>

        <div className="dm-sync-options">
          <div className="dm-option-row">
            <span className="dm-option-label">同步策略</span>
            <div className="dm-count-btns">
              {strategies.map((strategy) => {
                const active = strategy.id === 'full_update'
                  ? isFullUpdate && syncPeriods.length === strategy.periods.length && strategy.periods.every((item) => syncPeriods.includes(item))
                  : syncCount === strategy.count
                    && strategy.periods.length === syncPeriods.length
                    && strategy.periods.every((item) => syncPeriods.includes(item))
                return (
                  <button
                    key={strategy.id}
                    className={`dm-count-btn ${active ? 'active' : ''}`}
                    onClick={() => onApplyStrategy(strategy)}
                    title={strategy.description}
                  >
                    {strategy.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {!isFullUpdate && (
          <div className="dm-sync-options">
            <div className="dm-option-row">
              <span className="dm-option-label">同步数量</span>
              <div className="dm-count-btns">
                {[5, 10, 20, 50].map((count) => (
                  <button
                    key={count}
                    className={`dm-count-btn ${syncCount === count ? 'active' : ''}`}
                    onClick={() => onSyncCountChange(count)}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            <div className="dm-option-row">
              <span className="dm-option-label">数据周期</span>
              <div className="dm-period-checks">
                {PERIOD_OPTIONS.map((option) => (
                  <label key={option.value} className="dm-period-check">
                    <input
                      type="checkbox"
                      checked={syncPeriods.includes(option.value)}
                      onChange={() => onTogglePeriod(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="dm-sync-actions">
          <button
            className="dm-sync-btn"
            onClick={onSync}
            disabled={syncing || rebuildingStats || syncPeriods.length === 0}
          >
            {syncing ? '同步中...' : isFullUpdate ? '全量增量更新' : '开始同步'}
          </button>
          <button
            className="dm-secondary-btn"
            onClick={onRebuildStats}
            disabled={syncing || rebuildingStats}
            title="重新计算所有股票的 K 线统计，修复展示与实际数据不一致问题"
          >
            {rebuildingStats ? '重建中...' : '重建统计'}
          </button>
        </div>
      </div>

      <div className="dm-sync-panel">
        <h3>缺失补录</h3>
        <p className="dm-sync-desc">
          先做全量检查，确认哪些股票缺日线、15m、5m，或停留在旧交易日，再按计划补录，并在完成后刷新汇总统计。
        </p>
        <div className="dm-sync-actions">
          <button
            className="dm-secondary-btn"
            onClick={onInspectMissing}
            disabled={syncing || rebuildingStats || gapLoading || backfilling}
          >
            {gapLoading ? '检查中...' : '全面检查缺口'}
          </button>
          <button
            className="dm-sync-btn"
            onClick={onBackfillMissing}
            disabled={syncing || rebuildingStats || gapLoading || backfilling || !gapSummary}
          >
            {backfilling ? '补录中...' : '执行缺失补录'}
          </button>
        </div>

        {gapSummary && (
          <div className="dm-gap-grid">
            <div className="dm-gap-card">
              <div className="dm-gap-title">日线</div>
              <div className="dm-gap-metric">缺失 {gapSummary.intervals['1d'].totalMissing}</div>
              <div className="dm-gap-sub">滞后 {gapSummary.intervals['1d'].totalStale}</div>
            </div>
            <div className="dm-gap-card">
              <div className="dm-gap-title">15m</div>
              <div className="dm-gap-metric">缺失 {gapSummary.intervals['15m'].totalMissing}</div>
              <div className="dm-gap-sub">滞后 {gapSummary.intervals['15m'].totalStale}</div>
            </div>
            <div className="dm-gap-card">
              <div className="dm-gap-title">5m</div>
              <div className="dm-gap-metric">缺失 {gapSummary.intervals['5m'].totalMissing}</div>
              <div className="dm-gap-sub">滞后 {gapSummary.intervals['5m'].totalStale}</div>
            </div>
          </div>
        )}

        {gapSummary && (
          <div className="dm-gap-notes">
            <div className="dm-gap-note">
              检查时间: {formatDateTime(gapSummary.scannedAt)} | 日线基准: {gapSummary.latestTradingDate || '-'} | 分钟线基准: {gapSummary.latestMinuteCutoff || '-'}
            </div>
            <div className="dm-gap-note">
              日线样例: 缺失 {gapSummary.intervals['1d'].sampleMissing.join(', ') || '-'} | 滞后 {gapSummary.intervals['1d'].sampleStale.join(', ') || '-'}
            </div>
            <div className="dm-gap-note">
              15m 样例: 缺失 {gapSummary.intervals['15m'].sampleMissing.join(', ') || '-'} | 滞后 {gapSummary.intervals['15m'].sampleStale.join(', ') || '-'}
            </div>
            <div className="dm-gap-note">
              5m 样例: 缺失 {gapSummary.intervals['5m'].sampleMissing.join(', ') || '-'} | 滞后 {gapSummary.intervals['5m'].sampleStale.join(', ') || '-'}
            </div>
          </div>
        )}

        {backfillSummary && (
          <div className="dm-gap-notes">
            <div className="dm-gap-note">
              补录结果: 日线 {backfillSummary.daily.processed}/{backfillSummary.daily.requested}，15m {backfillSummary.m15.processed}/{backfillSummary.m15.requested}，5m {backfillSummary.m5.processed}/{backfillSummary.m5.requested}
            </div>
            <div className="dm-gap-note">
              新增行数: 日线 {backfillSummary.daily.insertedRows}，15m {backfillSummary.m15.insertedRows}，5m {backfillSummary.m5.insertedRows}
            </div>
            <div className="dm-gap-note">
              失败数: 日线 {backfillSummary.daily.failed}，15m {backfillSummary.m15.failed}，5m {backfillSummary.m5.failed}
            </div>
          </div>
        )}
      </div>

      {progress && (
        <div className="dm-progress">
          <div className="dm-progress-bar">
            <div
              className="dm-progress-fill"
              style={{
                width: progress.total > 0
                  ? `${(progress.current / progress.total) * 100}%`
                  : '0%'
              }}
            />
          </div>
          <div className="dm-progress-text">{progress.message}</div>
        </div>
      )}

      {syncLog.length > 0 && (
        <div className="dm-sync-log">
          {syncLog.map((log, index) => (
            <div key={`${log}-${index}`} className="dm-log-entry">{log}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SyncSection
