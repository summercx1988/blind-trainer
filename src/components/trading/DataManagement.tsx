import { useCallback, useEffect, useMemo, useState } from 'react'
import SyncSection from './data-management/SyncSection'
import StocksSection from './data-management/StocksSection'
import WorkflowHeader from './workflow/WorkflowHeader'
import type { WorkflowStep } from './workflow/WorkflowHeader'
import { SYNC_STRATEGIES, type StockRecord, type SyncProgress, type SyncStrategy } from './data-management/types'
import type { BackfillExecutionData, DataStats, DataSyncData, MissingCoverageData, PlatformResult } from '../../types/ipc'
import { getPlatformErrorMessage } from '../../types/ipc'
import './DataManagement.css'
import '../../types/global.d'

type DataManagementTab = 'sync' | 'stocks'
const STOCK_LIST_PREVIEW_LIMIT = 800

const DataManagement = () => {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [syncLog, setSyncLog] = useState<string[]>([])
  const [stocks, setStocks] = useState<StockRecord[]>([])
  const [summaryStats, setSummaryStats] = useState<DataStats | null>(null)
  const [stocksLoading, setStocksLoading] = useState(false)
  const [rebuildingStats, setRebuildingStats] = useState(false)
  const [gapLoading, setGapLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [syncCount, setSyncCount] = useState(0)
  const [syncPeriods, setSyncPeriods] = useState<string[]>(['daily', '15m'])
  const [activeTab, setActiveTab] = useState<DataManagementTab>('sync')
  const [autoSyncStatus, setAutoSyncStatus] = useState<{ lastSyncAt: string | null; nextSyncAt: string; syncing: boolean; syncType: string; syncError: string | null } | null>(null)
  const [gapSummary, setGapSummary] = useState<MissingCoverageData | null>(null)
  const [backfillSummary, setBackfillSummary] = useState<BackfillExecutionData['execution'] | null>(null)

  const loadStocks = useCallback(async () => {
    setStocksLoading(true)
    try {
      const [result, statsResult] = await Promise.all([
        window.electronAPI?.data?.getStockList(STOCK_LIST_PREVIEW_LIMIT),
        window.electronAPI?.data?.getStats()
      ])
      if (statsResult) {
        setSummaryStats(statsResult)
      }
      if (Array.isArray(result)) {
        setStocks(result.map((item: Record<string, unknown>) => ({
          code: String(item.code || ''),
          name: String(item.name || ''),
          daily_count: Number(item.daily_count || 0),
          m15_count: Number(item.m15_count || 0),
          m5_count: Number(item.m5_count || 0),
          minute_count: Number(item.minute_count || 0),
          last_sync: String(item.last_sync || '')
        })))
      }
    } catch (error) {
      console.error('加载股票列表失败:', error)
    } finally {
      setStocksLoading(false)
    }
  }, [])

  const loadAutoSyncStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI?.data?.getAutoSyncStatus() as { lastSyncAt: string | null; nextSyncAt: string; syncing: boolean; syncType: string; syncError: string | null } | undefined
      if (status) setAutoSyncStatus(status)
    } catch { /* ignore */ }
  }, [])

  const pollSyncStatus = useCallback(() => {
    let attempts = 0
    const maxAttempts = 360
    const interval = setInterval(async () => {
      attempts++
      try {
        const status = await window.electronAPI?.data?.getAutoSyncStatus() as { syncing: boolean; syncType: string; syncError: string | null; lastSyncAt: string | null } | undefined
        if (!status) { clearInterval(interval); return }
        setAutoSyncStatus(status as typeof autoSyncStatus)
        if (!status.syncing) {
          clearInterval(interval)
          setSyncing(false)
          setProgress(null)
          if (status.syncError) {
            setSyncLog((prev) => [...prev, `同步出错: ${status.syncError}`])
          } else {
            setSyncLog((prev) => [...prev, `同步完成 (${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('zh-CN') : '未知'})`])
          }
          void loadStocks()
        }
      } catch {
        clearInterval(interval)
        setSyncing(false)
        setProgress(null)
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval)
        setSyncing(false)
        setProgress(null)
      }
    }, 3000)
  }, [loadStocks])

  useEffect(() => {
    void loadStocks()
    void (async () => {
      try {
        const status = await window.electronAPI?.data?.getAutoSyncStatus() as { syncing: boolean; syncType: string; syncError: string | null; lastSyncAt: string | null; nextSyncAt: string } | undefined
        if (status) {
          setAutoSyncStatus(status as typeof autoSyncStatus)
          if (status.syncing) {
            setSyncing(true)
            setProgress({ phase: 'sync', current: 0, total: 0, message: '同步进行中...' })
            setSyncLog(['同步正在进行中，您可以离开此页面。'])
            void pollSyncStatus()
          }
        }
      } catch { /* ignore */ }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSync = useCallback(async () => {
    if (!window.electronAPI?.data?.sync) {
      setSyncLog(['数据桥接未加载成功，请重启应用后重试。'])
      return
    }
    setSyncLog([])
    setSyncing(true)
    setProgress({ phase: 'sync', current: 0, total: 0, message: '开始同步...' })

    try {
      if (syncCount === 0) {
        const result = await window.electronAPI?.data?.triggerIncrementalSync() as unknown as PlatformResult<{ started: boolean }> | undefined
        if (!result?.success) {
          setSyncing(false)
          setSyncLog([`全量更新失败: ${getPlatformErrorMessage(result, '同步失败')}`])
          return
        }
        setSyncLog(['全量增量更新已在后台启动，您可以离开此页面。同步完成后会弹出系统通知。'])
        void pollSyncStatus()
      } else {
        const result = await window.electronAPI?.data?.sync(syncCount, syncPeriods) as unknown as PlatformResult<DataSyncData> | undefined
        if (!result?.success) {
          setSyncing(false)
          setSyncLog([`同步失败: ${getPlatformErrorMessage(result, '同步失败')}`])
          return
        }

        const payload = result.data
        const lines = [
          `同步完成: ${syncCount}只股票, 周期: ${syncPeriods.join(', ')}`,
          `结果分布: API ${payload.syncedFromApi} / Cache ${payload.syncedFromCache} / Empty ${payload.syncedEmpty} / 总任务 ${payload.totalResults}`
        ]
        const autoSignalScan = payload.autoSignalScan as Record<string, unknown> | null
        if (autoSignalScan) {
          const scanSuccess = autoSignalScan.success === true
          const scanMessage = typeof autoSignalScan.message === 'string'
            ? autoSignalScan.message
            : typeof autoSignalScan.reason === 'string'
              ? autoSignalScan.reason
              : scanSuccess
                ? '自动扫描已执行'
                : '自动扫描未返回明确信息'
          lines.push(`自动扫描: ${scanMessage}`)
        }
        for (const advice of payload.syncAdvice) {
          if (typeof advice === 'string' && advice.trim()) {
            lines.push(`提示: ${advice.trim()}`)
          }
        }
        setSyncLog(lines)
        setSyncing(false)
        setProgress(null)
        await loadStocks()
        void loadAutoSyncStatus()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSyncLog((prev) => [...prev, `同步失败: ${message}`])
      setSyncing(false)
      setProgress(null)
    }
  }, [loadStocks, loadAutoSyncStatus, syncCount, syncPeriods])

  const handleRebuildStats = useCallback(async () => {
    if (!window.electronAPI?.data?.rebuildStats) {
      setSyncLog((prev) => [...prev, '统计重建接口不可用，请重启应用后重试。'])
      return
    }
    if (syncing || rebuildingStats) return
    setRebuildingStats(true)
    setSyncLog((prev) => [...prev, '开始重建统计表（stock_kline_stats）...'])
    try {
      const result = await window.electronAPI.data.rebuildStats() as unknown as PlatformResult<{
        stockCount: number
        dailyCount: number
        m15Count: number
        m5Count: number
        statsRows?: number
      }>
      if (!result?.success) {
        setSyncLog((prev) => [...prev, `重建失败: ${getPlatformErrorMessage(result, '重建失败')}`])
        return
      }
      const payload = result.data
      setSyncLog((prev) => [
        ...prev,
        `统计重建完成: 股票 ${payload.stockCount}，日线 ${payload.dailyCount}，15m ${payload.m15Count}，5m ${payload.m5Count}`
      ])
      await loadStocks()
      void loadAutoSyncStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSyncLog((prev) => [...prev, `重建失败: ${message}`])
    } finally {
      setRebuildingStats(false)
    }
  }, [loadAutoSyncStatus, loadStocks, rebuildingStats, syncing])

  const togglePeriod = useCallback((period: string) => {
    setSyncPeriods((prev) =>
      prev.includes(period) ? prev.filter((item) => item !== period) : [...prev, period]
    )
  }, [])

  const handleInspectMissing = useCallback(async () => {
    if (!window.electronAPI?.data?.inspectMissingCoverage) {
      setSyncLog((prev) => [...prev, '缺失检查接口不可用，请重启应用后重试。'])
      return
    }
    if (syncing || rebuildingStats || gapLoading || backfilling) return
    setGapLoading(true)
    setSyncLog((prev) => [...prev, '开始全面检查缺失与滞后数据...'])
    try {
      const result = await window.electronAPI.data.inspectMissingCoverage() as unknown as PlatformResult<MissingCoverageData> | undefined
      if (!result?.success) {
        setSyncLog((prev) => [...prev, `检查失败: ${getPlatformErrorMessage(result, '缺失检查失败')}`])
        return
      }
      setGapSummary(result.data)
      setBackfillSummary(null)
      setSyncLog((prev) => [
        ...prev,
        `检查完成: 日线缺失 ${result.data.intervals['1d'].totalMissing}，15m 缺失 ${result.data.intervals['15m'].totalMissing}，5m 缺失 ${result.data.intervals['5m'].totalMissing}`
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSyncLog((prev) => [...prev, `检查失败: ${message}`])
    } finally {
      setGapLoading(false)
    }
  }, [backfilling, gapLoading, rebuildingStats, syncing])

  const handleBackfillMissing = useCallback(async () => {
    if (!window.electronAPI?.data?.executeBackfillPlan) {
      setSyncLog((prev) => [...prev, '缺失补录接口不可用，请重启应用后重试。'])
      return
    }
    if (!gapSummary) {
      setSyncLog((prev) => [...prev, '请先执行一次全面检查，再开始补录。'])
      return
    }
    if (syncing || rebuildingStats || gapLoading || backfilling) return
    setBackfilling(true)
    setSyncLog((prev) => [...prev, '开始按检查结果补录缺失数据，并在完成后刷新汇总...'])
    try {
      const result = await window.electronAPI.data.executeBackfillPlan({
        dailyCodes: Array.from(new Set([
          ...gapSummary.intervals['1d'].missingCodes,
          ...gapSummary.intervals['1d'].staleCodes,
        ])),
        m15Codes: Array.from(new Set([
          ...gapSummary.intervals['15m'].missingCodes,
          ...gapSummary.intervals['15m'].staleCodes,
        ])),
        m5Codes: Array.from(new Set([
          ...gapSummary.intervals['5m'].missingCodes,
          ...gapSummary.intervals['5m'].staleCodes,
        ])),
      }) as unknown as PlatformResult<BackfillExecutionData> | undefined
      if (!result?.success) {
        setSyncLog((prev) => [...prev, `补录失败: ${getPlatformErrorMessage(result, '缺失补录失败')}`])
        return
      }
      setBackfillSummary(result.data.execution)
      setGapSummary(result.data.coverage)
      setSummaryStats(result.data.stats)
      setSyncLog((prev) => [
        ...prev,
        `补录完成: 日线新增 ${result.data.execution.daily.insertedRows}，15m 新增 ${result.data.execution.m15.insertedRows}，5m 新增 ${result.data.execution.m5.insertedRows}`,
        `补录后剩余缺口: 日线 ${result.data.coverage.intervals['1d'].totalMissing}，15m ${result.data.coverage.intervals['15m'].totalMissing}，5m ${result.data.coverage.intervals['5m'].totalMissing}`
      ])
      await loadStocks()
      void loadAutoSyncStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSyncLog((prev) => [...prev, `补录失败: ${message}`])
    } finally {
      setBackfilling(false)
    }
  }, [backfilling, gapLoading, gapSummary, loadAutoSyncStatus, loadStocks, rebuildingStats, syncing])

  const applyStrategy = useCallback((strategy: SyncStrategy) => {
    setSyncCount(strategy.count)
    setSyncPeriods(strategy.periods)
  }, [])

  const coverage = useMemo(() => {
    const totalDaily = summaryStats?.dailyCount ?? stocks.reduce((sum, stock) => sum + stock.daily_count, 0)
    const totalMinute = summaryStats?.m15Count !== undefined
      ? summaryStats.m15Count + (summaryStats.m5Count || 0)
      : stocks.reduce((sum, stock) => sum + stock.minute_count, 0)
    return {
      totalStocks: summaryStats?.stockCount ?? stocks.length,
      totalDaily,
      totalMinute,
      dailyCoverage: summaryStats?.dailyCoverage ?? stocks.filter((item) => item.daily_count > 0).length,
      m15Coverage: summaryStats?.m15Coverage ?? stocks.filter((item) => item.m15_count > 0).length,
      m5Coverage: summaryStats?.m5Coverage ?? stocks.filter((item) => item.m5_count > 0).length
    }
  }, [stocks, summaryStats])

  const workflowStats = useMemo(() => [
    {
      label: '股票池',
      value: `${coverage.totalStocks}`,
      hint: `${coverage.dailyCoverage} 只已具备日线`,
      tone: 'accent' as const
    },
    {
      label: '日线总量',
      value: coverage.totalDaily.toLocaleString(),
      hint: '用于标签与数据集生成',
      tone: 'neutral' as const
    },
    {
      label: '分钟线总量',
      value: coverage.totalMinute.toLocaleString(),
      hint: `${coverage.m15Coverage} 覆盖 15m`,
      tone: 'neutral' as const
    },
    {
      label: '数据状态',
      value: coverage.totalStocks > 0 ? '可用' : '待初始化',
      hint: '模型训练页将基于这些行情生成候选并冻结样本',
      tone: coverage.totalStocks > 0 ? 'positive' as const : 'accent' as const
    }
  ], [coverage])

  const workflowSteps = useMemo<WorkflowStep[]>(() => ([
    {
      id: 'sync',
      label: '同步数据',
      desc: '先把股票池和 K 线覆盖补齐。',
      state: activeTab === 'sync' ? 'active' : coverage.totalStocks > 0 ? 'done' : 'idle'
    },
    {
      id: 'stocks',
      label: '检查覆盖',
      desc: '确认股票列表、周期覆盖和最新同步时间。',
      state: activeTab === 'stocks' ? 'active' : coverage.totalStocks > 0 ? 'done' : 'idle'
    }
  ]), [activeTab, coverage.totalStocks])

  return (
    <div className="dm-page">
      <WorkflowHeader
        eyebrow="Data Ops"
        title="数据同步与覆盖检查"
        description="维护行情数据底座：同步最新数据、检查覆盖率。每日 15:15 自动同步。"
        stats={workflowStats}
        steps={workflowSteps}
      />

      <div className="dm-tabs">
        <button
          className={`dm-tab ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync')}
        >
          数据同步
        </button>
        <button
          className={`dm-tab ${activeTab === 'stocks' ? 'active' : ''}`}
          onClick={() => setActiveTab('stocks')}
        >
          股票列表 ({coverage.totalStocks})
        </button>
      </div>

      {activeTab === 'sync' && (
        <SyncSection
          syncing={syncing}
          rebuildingStats={rebuildingStats}
          progress={progress}
          syncLog={syncLog}
          syncCount={syncCount}
          syncPeriods={syncPeriods}
          coverage={coverage}
          strategies={SYNC_STRATEGIES}
          autoSyncStatus={autoSyncStatus}
          gapSummary={gapSummary}
          gapLoading={gapLoading}
          backfilling={backfilling}
          backfillSummary={backfillSummary}
          onApplyStrategy={applyStrategy}
          onSyncCountChange={setSyncCount}
          onTogglePeriod={togglePeriod}
          onInit={() => void handleSync()}
          onSync={() => void handleSync()}
          onRebuildStats={() => void handleRebuildStats()}
          onInspectMissing={() => void handleInspectMissing()}
          onBackfillMissing={() => void handleBackfillMissing()}
        />
      )}

      {activeTab === 'stocks' && (
        <StocksSection
          stocks={stocks}
          stocksLoading={stocksLoading}
          onRefresh={() => void loadStocks()}
        />
      )}

    </div>
  )
}

export default DataManagement
