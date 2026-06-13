import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModelVersionItem } from './types'
import { toModelVersionItem } from './types'
import { formatTime } from './helpers'
import type { PlatformResult, UnknownRecord } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import BaseKlineChart from '../blind/BaseKlineChart'
import type { BaseKlineBar, BaseMarker } from '../blind/BaseKlineChart'
import { IndexKlineChart } from './IndexKlineChart'

interface RecommendationReviewItem {
  id: string
  modelId: string
  modelName: string
  code: string
  stockName: string
  period: string
  signalDate: string
  eventTimestamp: number | null
  confidence: number
  score: number | null
  threshold: number | null
  source: string
  backtestId: string
  specVersion: string
  createdAt: number | null
  outcomeStatus: 'evaluated' | 'unresolved'
  outcomeReason?: string
  horizonDays?: number
  entryTimestamp?: number
  entryPrice?: number
  exitTimestamp?: number
  exitPrice?: number
  returnPct?: number
  maxDrawdownPct?: number
  win?: boolean
}

interface RecommendationReviewSummary {
  totalRecommendations: number
  evaluatedRecommendations: number
  winCount: number
  winRate: number
  avgReturnPct: number
  avgMaxDrawdownPct: number
  horizonDays: number
  startDate: string | null
  endDate: string | null
  source: string
  latestBatchOnly: boolean
  batchId: string | null
  batchCreatedAt: number | null
}

interface SummaryBucket {
  key: string
  total: number
  evaluated: number
  wins: number
  avgReturnPct: number
}

type ChartBar = BaseKlineBar

const asNumber = (value: unknown, fallback = 0): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const asString = (value: unknown): string => {
  return typeof value === 'string' ? value : ''
}

const toEpochMs = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 1_000_000_000_000 ? value * 1000 : value
}

const toRecommendationReviewItem = (raw: UnknownRecord): RecommendationReviewItem | null => {
  const id = asString(raw.id)
  const code = asString(raw.code)
  if (!id || !code) return null
  const status = asString(raw.outcomeStatus)
  const outcomeStatus: 'evaluated' | 'unresolved' = status === 'evaluated' ? 'evaluated' : 'unresolved'
  return {
    id,
    modelId: asString(raw.modelId),
    modelName: asString(raw.modelName),
    code,
    stockName: asString(raw.stockName),
    period: asString(raw.period),
    signalDate: asString(raw.signalDate),
    eventTimestamp: toEpochMs(raw.eventTimestamp),
    confidence: asNumber(raw.confidence),
    score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null,
    threshold: typeof raw.threshold === 'number' && Number.isFinite(raw.threshold) ? raw.threshold : null,
    source: asString(raw.source) || 'backtest',
    backtestId: asString(raw.backtestId),
    specVersion: asString(raw.specVersion),
    createdAt: toEpochMs(raw.createdAt),
    outcomeStatus,
    outcomeReason: asString(raw.outcomeReason) || undefined,
    horizonDays: asNumber(raw.horizonDays, 0) || undefined,
    entryTimestamp: toEpochMs(raw.entryTimestamp) || undefined,
    entryPrice: typeof raw.entryPrice === 'number' && Number.isFinite(raw.entryPrice) ? raw.entryPrice : undefined,
    exitTimestamp: toEpochMs(raw.exitTimestamp) || undefined,
    exitPrice: typeof raw.exitPrice === 'number' && Number.isFinite(raw.exitPrice) ? raw.exitPrice : undefined,
    returnPct: typeof raw.returnPct === 'number' && Number.isFinite(raw.returnPct) ? raw.returnPct : undefined,
    maxDrawdownPct: typeof raw.maxDrawdownPct === 'number' && Number.isFinite(raw.maxDrawdownPct) ? raw.maxDrawdownPct : undefined,
    win: typeof raw.win === 'boolean' ? raw.win : undefined,
  }
}

const toSummary = (raw: UnknownRecord | null | undefined): RecommendationReviewSummary => {
  return {
    totalRecommendations: asNumber(raw?.totalRecommendations),
    evaluatedRecommendations: asNumber(raw?.evaluatedRecommendations),
    winCount: asNumber(raw?.winCount),
    winRate: asNumber(raw?.winRate),
    avgReturnPct: asNumber(raw?.avgReturnPct),
    avgMaxDrawdownPct: asNumber(raw?.avgMaxDrawdownPct),
    horizonDays: Math.max(1, asNumber(raw?.horizonDays, 5)),
    startDate: asString(raw?.startDate) || null,
    endDate: asString(raw?.endDate) || null,
    source: asString(raw?.source) || 'replay',
    latestBatchOnly: raw?.latestBatchOnly !== false,
    batchId: asString(raw?.batchId) || null,
    batchCreatedAt: toEpochMs(raw?.batchCreatedAt),
  }
}

const toDateInputValue = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toDateKey = (timestampMs: number): string => {
  const date = new Date(timestampMs)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const toChartBars = (rows: UnknownRecord[]): ChartBar[] => {
  const bars = rows.map((row) => ({
    timestamp: toMs(row.timestamp),
    open: asNumber(row.open, Number.NaN),
    high: asNumber(row.high, Number.NaN),
    low: asNumber(row.low, Number.NaN),
    close: asNumber(row.close, Number.NaN),
    volume: asNumber(row.volume, 0)
  })).filter((bar) => (
    bar.timestamp > 0
    && Number.isFinite(bar.open)
    && Number.isFinite(bar.high)
    && Number.isFinite(bar.low)
    && Number.isFinite(bar.close)
  ))
  bars.sort((left, right) => left.timestamp - right.timestamp)
  return bars
}

const findNearestBarIndex = (bars: ChartBar[], timestamp: number | undefined): number => {
  if (!timestamp || bars.length === 0) return -1
  let bestIndex = -1
  let bestGap = Number.POSITIVE_INFINITY
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]
    if (!bar) continue
    const gap = Math.abs(bar.timestamp - timestamp)
    if (gap < bestGap) {
      bestGap = gap
      bestIndex = index
    }
  }
  return bestIndex
}

const buildBucketSummary = (
  rows: RecommendationReviewItem[],
  keyResolver: (row: RecommendationReviewItem) => string
): SummaryBucket[] => {
  const buckets = new Map<string, { total: number; evaluated: number; wins: number; returnSum: number }>()
  for (const row of rows) {
    const key = keyResolver(row)
    if (!key) continue
    const bucket = buckets.get(key) || { total: 0, evaluated: 0, wins: 0, returnSum: 0 }
    bucket.total += 1
    if (row.outcomeStatus === 'evaluated' && typeof row.returnPct === 'number') {
      bucket.evaluated += 1
      bucket.returnSum += row.returnPct
      if (row.returnPct > 0) bucket.wins += 1
    }
    buckets.set(key, bucket)
  }
  return Array.from(buckets.entries()).map(([key, value]) => ({
    key,
    total: value.total,
    evaluated: value.evaluated,
    wins: value.wins,
    avgReturnPct: value.evaluated > 0 ? value.returnSum / value.evaluated : 0
  })).sort((left, right) => {
    if (right.evaluated !== left.evaluated) return right.evaluated - left.evaluated
    if (right.total !== left.total) return right.total - left.total
    return left.key.localeCompare(right.key)
  }).slice(0, 8)
}

const RecommendationReviewTab = () => {
  const today = useMemo(() => new Date(), [])
  const defaultEnd = useMemo(() => toDateInputValue(today), [today])
  const defaultStart = useMemo(() => {
    const start = new Date(today.getTime())
    start.setDate(start.getDate() - 13)
    return toDateInputValue(start)
  }, [today])

  const [models, setModels] = useState<ModelVersionItem[]>([])
  const [activeModelId, setActiveModelId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [period, setPeriod] = useState<'all' | '1d' | '15m' | '5m'>('1d')
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [horizonDays, setHorizonDays] = useState(5)
  const [evaluatedOnly, setEvaluatedOnly] = useState(false)
  const [filterMa20Up, setFilterMa20Up] = useState(false)
  const [filterMa5GtMa20, setFilterMa5GtMa20] = useState(false)
  const [filterAboveMa20, setFilterAboveMa20] = useState(false)
  const [minPrice, setMinPrice] = useState(5)
  const [maxPrice, setMaxPrice] = useState(100)
  const [minAmount, setMinAmount] = useState(3000)
  const [minConfidence, setMinConfidence] = useState(0)
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(['sh', 'sz_main', 'sz_sme', 'cyb'])
  const [sourceFilter, setSourceFilter] = useState<string>('replay')
  const [latestBatchOnly, setLatestBatchOnly] = useState(true)
  const [rows, setRows] = useState<RecommendationReviewItem[]>([])
  const [indexKlineData, setIndexKlineData] = useState<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>>([])
  const [recCounts, setRecCounts] = useState<Array<{ date: string; total: number; win: number; loss: number }>>([])
  const [summary, setSummary] = useState<RecommendationReviewSummary>({
    totalRecommendations: 0,
    evaluatedRecommendations: 0,
    winCount: 0,
    winRate: 0,
    avgReturnPct: 0,
    avgMaxDrawdownPct: 0,
    horizonDays: 5,
    startDate: defaultStart,
    endDate: defaultEnd,
    source: 'replay',
    latestBatchOnly: true,
    batchId: null,
    batchCreatedAt: null,
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedRow, setSelectedRow] = useState<RecommendationReviewItem | null>(null)
  const [chartBars, setChartBars] = useState<ChartBar[]>([])
  const [chartMarkers, setChartMarkers] = useState<BaseMarker[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [scanMode, setScanMode] = useState<'latest_snapshot' | 'historical_replay'>('latest_snapshot')
  const [cleaningLegacy, setCleaningLegacy] = useState(false)

  const loadModels = useCallback(async () => {
    try {
      const [versionRows, activeRow] = await Promise.all([
        window.electronAPI?.listModels?.(),
        window.electronAPI?.getActiveModel?.(),
      ])
      const normalized = (versionRows || [])
        .map((row) => toModelVersionItem(row as UnknownRecord))
        .filter((row): row is ModelVersionItem => row !== null)
      setModels(normalized)
      const activeId = activeRow && typeof (activeRow as UnknownRecord).id === 'string'
        ? ((activeRow as UnknownRecord).id as string)
        : ''
      setActiveModelId(activeId)
      if (!selectedModelId && activeId) setSelectedModelId(activeId)
    } catch {
      // ignore
    }
  }, [selectedModelId])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  const loadRecommendations = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const result = await window.electronAPI?.listRecommendationReview?.({
        modelId: selectedModelId || activeModelId || undefined,
        period: period === 'all' ? undefined : period,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        horizonDays,
        limit: 1200,
        minPrice: minPrice || undefined,
        maxPrice: maxPrice || undefined,
        minAmount: minAmount || undefined,
        markets: selectedMarkets.length > 0 ? selectedMarkets : undefined,
        source: sourceFilter || undefined,
        latestBatchOnly,
        filterMa20Up: filterMa20Up || undefined,
        filterMa5GtMa20: filterMa5GtMa20 || undefined,
        filterAboveMa20: filterAboveMa20 || undefined,
      }) as PlatformResult<{ summary: UnknownRecord; items: UnknownRecord[] }> | undefined

      if (!result?.success) {
        setRows([])
        setSummary((prev) => ({ ...prev, totalRecommendations: 0, evaluatedRecommendations: 0, winCount: 0 }))
        setMessage(getPlatformErrorMessage(result, '推荐复盘加载失败'))
        return
      }

      const data = result.data
      const parsedRows = (Array.isArray(data.items) ? data.items : [])
        .map((item) => toRecommendationReviewItem(item as UnknownRecord))
        .filter((item): item is RecommendationReviewItem => item !== null)
      setRows(parsedRows)
      setSummary(toSummary((data.summary || {}) as UnknownRecord))
      if (parsedRows.length === 0) {
        setMessage('当前筛选范围暂无买入推荐记录。')
      }
    } catch (error) {
      setRows([])
      setMessage(`推荐复盘加载失败: ${error instanceof Error ? error.message : 'unknown_error'}`)
    } finally {
      setLoading(false)
    }
  }, [activeModelId, endDate, horizonDays, period, selectedModelId, startDate, filterMa20Up, filterMa5GtMa20, filterAboveMa20, minPrice, maxPrice, minAmount, selectedMarkets, sourceFilter, latestBatchOnly])

  useEffect(() => {
    void loadRecommendations()
  }, [loadRecommendations])

  useEffect(() => {
    const loadIndex = async () => {
      try {
        const api = window.electronAPI as Record<string, unknown>
      const getIndexKline = api.getIndexKline as ((code: string, startDate?: string, endDate?: string) => Promise<PlatformResult<Array<Record<string, unknown>>>>) | undefined
      const result = await getIndexKline?.('sh000001', startDate || undefined, endDate || undefined)
        if (result?.success && Array.isArray(result.data)) {
          setIndexKlineData(result.data.map((r) => ({
            timestamp: typeof r.trade_date === 'string' ? new Date(r.trade_date + 'T00:00:00+08:00').getTime() : 0,
            open: Number(r.open) || 0,
            high: Number(r.high) || 0,
            low: Number(r.low) || 0,
            close: Number(r.close) || 0,
            volume: Number(r.volume) || 0,
          })).filter((b) => b.timestamp > 0))
        }
      } catch { /* ignore */ }
    }
    void loadIndex()
  }, [startDate, endDate])

  useEffect(() => {
    if (rows.length === 0) { setRecCounts([]); return }
    const countMap = new Map<string, { total: number; win: number; loss: number }>()
    for (const r of rows) {
      const d = r.signalDate
      if (!d) continue
      const existing = countMap.get(d) || { total: 0, win: 0, loss: 0 }
      existing.total += 1
      if (r.outcomeStatus === 'evaluated') {
        if (r.win) existing.win += 1
        else existing.loss += 1
      }
      countMap.set(d, existing)
    }
    setRecCounts(Array.from(countMap.entries()).map(([date, counts]) => ({ date, ...counts })))
  }, [rows])

  const runSignalScan = useCallback(async () => {
    setScanning(true)
    setScanMessage(scanMode === 'historical_replay' ? '历史回放已启动（按日期全量扫描），耗时较长，可切换其他页面...' : '信号扫描已启动，后台运行中，可切换其他页面...')
    try {
      if (scanMode === 'historical_replay') {
        const result = await window.electronAPI?.runHistoricalReplay?.({
          period: period === 'all' ? '1d' : period,
          startDate,
          endDate,
          minConfidence: 0.85,
        }) as PlatformResult<UnknownRecord> | undefined

        if (!result?.success) {
          setScanMessage(`历史回放失败：${result?.error?.message || '未知错误'}`)
          return
        }

        const data = result.data || {}
        const created = Number(data.created || 0)
        const scannedCodes = Number(data.scannedCodes || 0)
        const deduplicated = Number(data.deduplicated || 0)
        const batches = Number(data.batches || 0)
        setScanMessage(`历史回放完成：共扫描 ${scannedCodes} 只股票（${batches} 批次），写入 ${created} 条回测口径推荐，${deduplicated} 条重复跳过。`)
      } else {
        const result = await window.electronAPI?.runSignalScan?.(
          [period === 'all' ? '1d' : period],
          { maxCodesPerPeriod: 80, minConfidence: 0.85 }
        ) as PlatformResult<UnknownRecord> | undefined

        if (!result?.success) {
          setScanMessage(`扫描失败：${result?.error?.message || '未知错误'}`)
          return
        }

        const data = result.data || {}
        const created = Number(data.created || 0)
        const scannedCodes = Number(data.scannedCodes || 0)
        const deduplicated = Number(data.deduplicated || 0)
        setScanMessage(`扫描完成：共扫描 ${scannedCodes} 只股票，新建 ${created} 条信号，${deduplicated} 条重复跳过。`)
      }
      void loadRecommendations()
    } catch (error) {
      setScanMessage(`扫描异常：${error instanceof Error ? error.message : 'unknown_error'}`)
    } finally {
      setScanning(false)
    }
  }, [period, startDate, endDate, scanMode, loadRecommendations])

  const cleanupLegacyReplay = useCallback(async () => {
    setCleaningLegacy(true)
    setScanMessage('')
    try {
      const result = await window.electronAPI?.cleanupLegacyReplayRecommendations?.()
      if (!result?.success) {
        setScanMessage(`清理失败：${result?.error?.message || '未知错误'}`)
        return
      }
      setScanMessage(`旧口径历史回放数据已清理：删除 ${Number(result.data.deleted || 0)} 条。`)
      void loadRecommendations()
    } catch (error) {
      setScanMessage(`清理异常：${error instanceof Error ? error.message : 'unknown_error'}`)
    } finally {
      setCleaningLegacy(false)
    }
  }, [loadRecommendations])

  const viewRows = useMemo(() => {
    let filtered = rows
    if (evaluatedOnly) filtered = filtered.filter((row) => row.outcomeStatus === 'evaluated')
    if (minConfidence > 0) filtered = filtered.filter((row) => row.confidence >= minConfidence)
    return filtered
  }, [evaluatedOnly, minConfidence, rows])

  const viewSummary = useMemo(() => {
    const evaluatedRows = viewRows.filter((row) => row.outcomeStatus === 'evaluated' && typeof row.returnPct === 'number')
    const wins = evaluatedRows.filter((row) => (row.returnPct as number) > 0).length
    const returnSum = evaluatedRows.reduce((sum, row) => sum + (row.returnPct || 0), 0)
    const drawdownSum = evaluatedRows.reduce((sum, row) => sum + (row.maxDrawdownPct || 0), 0)
    return {
      totalRecommendations: viewRows.length,
      evaluatedRecommendations: evaluatedRows.length,
      winCount: wins,
      winRate: evaluatedRows.length > 0 ? wins / evaluatedRows.length : 0,
      avgReturnPct: evaluatedRows.length > 0 ? returnSum / evaluatedRows.length : 0,
      avgMaxDrawdownPct: evaluatedRows.length > 0 ? drawdownSum / evaluatedRows.length : 0
    }
  }, [viewRows])

  const modelBuckets = useMemo(() => {
    return buildBucketSummary(viewRows, (row) => row.modelName || row.modelId.slice(0, 12))
  }, [viewRows])

  const loadChartForRow = useCallback(async (row: RecommendationReviewItem) => {
    setSelectedRow(row)
    setChartLoading(true)
    setChartError('')
    setChartBars([])
    setChartMarkers([])
    try {
      const anchor = row.eventTimestamp || Date.now()
      const period = row.period === '5m' || row.period === '15m' || row.period === '1d' ? row.period : '1d'
      const historyDays = period === '1d' ? 260 : 45
      const futureDays = period === '1d' ? Math.max(30, horizonDays * 3) : Math.max(10, horizonDays)
      const start = toDateInputValue(new Date(anchor - historyDays * 24 * 60 * 60 * 1000))
      const end = toDateInputValue(new Date(anchor + futureDays * 24 * 60 * 60 * 1000))
      const raw = await window.electronAPI?.data?.getCandles(row.code, period, start, end)
      const bars = toChartBars((raw || []) as UnknownRecord[])
      if (bars.length === 0) {
        setChartError('该标的在当前范围没有可展示的K线。')
        return
      }
      const markers: BaseMarker[] = []
      const entryIndex = findNearestBarIndex(bars, row.entryTimestamp)
      if (entryIndex >= 0) {
        markers.push({
          barIndex: entryIndex,
          actionType: 'buy',
          price: typeof row.entryPrice === 'number' ? row.entryPrice : bars[entryIndex]!.close
        })
      }
      const exitIndex = findNearestBarIndex(bars, row.exitTimestamp)
      if (exitIndex >= 0) {
        markers.push({
          barIndex: exitIndex,
          actionType: 'sell',
          price: typeof row.exitPrice === 'number' ? row.exitPrice : bars[exitIndex]!.close
        })
      }
      setChartBars(bars)
      setChartMarkers(markers)
    } catch (error) {
      setChartError(`K线加载失败: ${error instanceof Error ? error.message : 'unknown_error'}`)
    } finally {
      setChartLoading(false)
    }
  }, [horizonDays])

  return (
    <section className="model-card">
      <div className="model-card-head">
        <h3>每日买入推荐复盘（T+N）</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={scanMode}
            onChange={(event) => setScanMode(event.target.value as 'latest_snapshot' | 'historical_replay')}
            style={{ fontSize: '0.8rem', height: 28, padding: '0 4px' }}
          >
            <option value="latest_snapshot">实时快照</option>
            <option value="historical_replay">历史回放</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => void runSignalScan()} disabled={scanning}>
            {scanning ? '扫描中...' : '扫描信号'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => void cleanupLegacyReplay()} disabled={cleaningLegacy}>
            {cleaningLegacy ? '清理中...' : '清理旧回放'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => void loadRecommendations()} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>
      <p className="model-desc">展示模型买入推荐，并在第 N 个交易日评估真实收益与胜率。默认查看近两周，可按模型、周期与日期范围手动复盘。</p>
      {scanMessage && <p className="model-message">{scanMessage}</p>}

      <div className="model-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '0.55rem', marginTop: '0.65rem' }}>
        <label>模型
          <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
            <option value="">使用活跃模型</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.name} ({model.id.slice(0, 12)})</option>
            ))}
          </select>
        </label>
        <label>周期
          <select value={period} onChange={(event) => setPeriod(event.target.value as 'all' | '1d' | '15m' | '5m')}>
            <option value="all">全部</option>
            <option value="1d">日线</option>
            <option value="15m">15分钟</option>
            <option value="5m">5分钟</option>
          </select>
        </label>
        <label>开始日期
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>结束日期
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label>T+N (N)
          <input
            type="number"
            min={1}
            max={60}
            step={1}
            value={horizonDays}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              if (!Number.isFinite(parsed)) return
              setHorizonDays(Math.min(60, Math.max(1, Math.round(parsed))))
            }}
          />
        </label>
        <label>
          <span>结果筛选</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#1f2e49', fontSize: '0.8rem', height: 34 }}>
            <input
              type="checkbox"
              checked={evaluatedOnly}
              onChange={(event) => setEvaluatedOnly(event.target.checked)}
              style={{ width: 14, height: 14 }}
            />
            仅看已评估
          </div>
        </label>
      </div>

      <div className="model-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginTop: 6, gap: '0.55rem' }}>
        <label>最低价
          <input type="number" min={0} step={1} value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value) || 0)} />
        </label>
        <label>最高价
          <input type="number" min={0} step={1} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value) || 0)} />
        </label>
        <label>最低成交额(万)
          <input type="number" min={0} step={500} value={minAmount} onChange={(e) => setMinAmount(Number(e.target.value) || 0)} />
        </label>
        <label>最低置信度(%)
          <input type="number" min={0} max={100} step={1} value={minConfidence > 0 ? Math.round(minConfidence * 100) : 0} onChange={(e) => setMinConfidence(Number(e.target.value) / 100 || 0)} />
        </label>
        <label>数据来源
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="replay">历史回放</option>
            <option value="backtest">回测验证</option>
            <option value="realtime">实时扫描</option>
            <option value="">全部来源</option>
          </select>
        </label>
        <label>
          <span>数据批次</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#1f2e49', fontSize: '0.8rem', height: 34 }}>
            <input
              type="checkbox"
              checked={latestBatchOnly}
              disabled={!sourceFilter}
              onChange={(event) => setLatestBatchOnly(event.target.checked)}
              style={{ width: 14, height: 14 }}
            />
            仅看最新批次
          </div>
        </label>
      </div>

      <div style={{ marginTop: 6, border: '1px solid #e7edf7', borderRadius: 8, padding: '0.55rem 0.7rem', display: 'grid', gap: '0.45rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
          <span style={{ color: '#6e7f99', fontSize: '0.76rem', minWidth: 54 }}>市场</span>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={selectedMarkets.includes('sh')} onChange={(e) => { const next = e.target.checked ? [...selectedMarkets, 'sh'] : selectedMarkets.filter((m) => m !== 'sh'); setSelectedMarkets(next) }} style={{ width: 14, height: 14 }} />
            沪市主板
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={selectedMarkets.includes('sz_main') || selectedMarkets.includes('sz_sme')} onChange={(e) => { const next = e.target.checked ? [...selectedMarkets.filter((m) => m !== 'sz_main' && m !== 'sz_sme'), 'sz_main', 'sz_sme'] : selectedMarkets.filter((m) => m !== 'sz_main' && m !== 'sz_sme'); setSelectedMarkets(next) }} style={{ width: 14, height: 14 }} />
            深市主板
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={selectedMarkets.includes('cyb')} onChange={(e) => { const next = e.target.checked ? [...selectedMarkets, 'cyb'] : selectedMarkets.filter((m) => m !== 'cyb'); setSelectedMarkets(next) }} style={{ width: 14, height: 14 }} />
            创业板
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={selectedMarkets.includes('kcb')} onChange={(e) => { const next = e.target.checked ? [...selectedMarkets, 'kcb'] : selectedMarkets.filter((m) => m !== 'kcb'); setSelectedMarkets(next) }} style={{ width: 14, height: 14 }} />
            科创板
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={selectedMarkets.includes('bse')} onChange={(e) => { const next = e.target.checked ? [...selectedMarkets, 'bse'] : selectedMarkets.filter((m) => m !== 'bse'); setSelectedMarkets(next) }} style={{ width: 14, height: 14 }} />
            北交所
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
          <span style={{ color: '#6e7f99', fontSize: '0.76rem', minWidth: 54 }}>技术</span>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={filterMa20Up} onChange={(e) => setFilterMa20Up(e.target.checked)} style={{ width: 14, height: 14 }} />
            MA20 向上
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={filterMa5GtMa20} onChange={(e) => setFilterMa5GtMa20(e.target.checked)} style={{ width: 14, height: 14 }} />
            MA5 &gt; MA20
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#1f2e49' }}>
            <input type="checkbox" checked={filterAboveMa20} onChange={(e) => setFilterAboveMa20(e.target.checked)} style={{ width: 14, height: 14 }} />
            收盘价 &gt; MA20
          </label>
          <span style={{ color: '#6e7f99', fontSize: '0.75rem' }}>筛选基于信号日K线</span>
        </div>
      </div>

      {message && <p className="model-message">{message}</p>}

      <div className="model-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', marginTop: 10 }}>
        <div><span className="model-stat-label">推荐总数</span><div><strong>{viewSummary.totalRecommendations}</strong></div></div>
        <div><span className="model-stat-label">已评估</span><div><strong>{viewSummary.evaluatedRecommendations}</strong></div></div>
        <div><span className="model-stat-label">胜率</span><div><strong>{(viewSummary.winRate * 100).toFixed(1)}%</strong></div></div>
        <div><span className="model-stat-label">平均收益</span><div><strong>{(viewSummary.avgReturnPct * 100).toFixed(2)}%</strong></div></div>
        <div><span className="model-stat-label">平均最大回撤</span><div><strong>{(viewSummary.avgMaxDrawdownPct * 100).toFixed(2)}%</strong></div></div>
      </div>

      <p className="model-subtle">
        评估口径：信号后下一根可交易K线开盘价买入，T+{summary.horizonDays} 收盘价卖出。胜率=收益&gt;0 的占比。
        当前来源：{summary.source || '全部来源'}；{summary.latestBatchOnly ? '仅最新批次' : '包含历史批次'}
        {summary.batchCreatedAt ? `；批次时间 ${formatTime(summary.batchCreatedAt)}` : ''}
        {summary.batchId ? `；批次 ${summary.batchId.split('/').pop()}` : ''}
      </p>

      <div style={{ marginTop: 8 }}>
        <IndexKlineChart klineData={indexKlineData} recommendationCounts={recCounts} />
      </div>

      <div style={{ marginTop: 8 }}>
        <div className="model-subtle" style={{ marginTop: 0, marginBottom: 4 }}>模型汇总</div>
        <div className="model-table-wrap" style={{ marginTop: 0, maxHeight: 220 }}>
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>推荐</th>
                <th>已评估</th>
                <th>胜率</th>
                <th>均收益</th>
              </tr>
            </thead>
            <tbody>
              {modelBuckets.length === 0 ? (
                <tr><td colSpan={5} className="model-subtle">暂无数据</td></tr>
              ) : modelBuckets.map((bucket) => (
                <tr key={bucket.key}>
                  <td>{bucket.key}</td>
                  <td>{bucket.total}</td>
                  <td>{bucket.evaluated}</td>
                  <td>{bucket.evaluated > 0 ? `${((bucket.wins / bucket.evaluated) * 100).toFixed(1)}%` : '-'}</td>
                  <td>{bucket.evaluated > 0 ? `${(bucket.avgReturnPct * 100).toFixed(2)}%` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 明细列表 */}
      {viewRows.length > 0 && (
        <div className="model-table-wrap" style={{ maxHeight: 520 }}>
          <table>
            <thead>
              <tr>
                <th>信号时间</th>
                <th>模型</th>
                <th>代码</th>
                <th>名称</th>
                <th>周期</th>
                <th>置信度</th>
                <th>开仓</th>
                <th>平仓</th>
                <th>收益</th>
                <th>最大回撤</th>
                <th>结果</th>
                <th>批次</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {viewRows.map((row) => {
                const evaluated = row.outcomeStatus === 'evaluated'
                const pnl = row.returnPct
                const dd = row.maxDrawdownPct
                return (
                  <tr key={row.id}>
                    <td>{row.signalDate || (row.eventTimestamp ? formatTime(row.eventTimestamp) : '-')}</td>
                    <td>{row.modelName || row.modelId.slice(0, 12)}</td>
                    <td><strong>{row.code}</strong></td>
                    <td>{row.stockName || '-'}</td>
                    <td>{row.period}</td>
                    <td>{(row.confidence * 100).toFixed(1)}%</td>
                    <td>{row.entryTimestamp && row.entryPrice ? `${formatTime(row.entryTimestamp)} @ ${row.entryPrice.toFixed(2)}` : '-'}</td>
                    <td>{row.exitTimestamp && row.exitPrice ? `${formatTime(row.exitTimestamp)} @ ${row.exitPrice.toFixed(2)}` : '-'}</td>
                    <td className={typeof pnl === 'number' && pnl >= 0 ? 'signal-buy' : 'signal-sell'}>
                      {typeof pnl === 'number' ? `${(pnl * 100).toFixed(2)}%` : '-'}
                    </td>
                    <td className="signal-sell">
                      {typeof dd === 'number' ? `${(dd * 100).toFixed(2)}%` : '-'}
                    </td>
                    <td>
                      {evaluated
                        ? <span className={`candidate-status ${row.win ? 'status-accepted' : 'status-rejected'}`}>{row.win ? '胜' : '负'}</span>
                        : <span className="candidate-status status-read">{row.outcomeReason || '未完成'}</span>}
                    </td>
                    <td>{row.createdAt ? formatTime(row.createdAt) : '-'}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => void loadChartForRow(row)}>看K线</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedRow && (
        <section className="model-card" style={{ marginTop: 12, padding: 12 }}>
          <div className="model-card-head">
            <h3>
              K线复核 · {selectedRow.code} · {selectedRow.period} · {selectedRow.eventTimestamp ? toDateKey(selectedRow.eventTimestamp) : '-'}
            </h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedRow(null)}>关闭</button>
          </div>
          {chartError && <p className="model-message">{chartError}</p>}
          {chartLoading ? (
            <div className="model-empty" style={{ minHeight: 240 }}>K线加载中...</div>
          ) : chartBars.length > 0 ? (
            <div style={{ height: 460, border: '1px solid #e7edf7', borderRadius: 10, overflow: 'hidden' }}>
              <BaseKlineChart
                data={chartBars}
                markers={chartMarkers}
                ticker={`${selectedRow.code}_${selectedRow.period}`}
                visibleCount={Math.min(chartBars.length, selectedRow.period === '1d' ? 220 : 360)}
                scrollToDate={selectedRow.eventTimestamp ? toDateKey(selectedRow.eventTimestamp) : undefined}
              />
            </div>
          ) : (
            <div className="model-empty" style={{ minHeight: 240 }}>暂无K线数据</div>
          )}
        </section>
      )}
    </section>
  )
}

export default RecommendationReviewTab
