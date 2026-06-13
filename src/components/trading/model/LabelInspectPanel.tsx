import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UnknownRecord } from '../../../types/ipc'
import type { BaseKlineBar, BaseMarker, ExitWindowRange } from '../blind/BaseKlineChart'
import BaseKlineChart from '../blind/BaseKlineChart'
import './LabelInspectPanel.css'

interface ChartBar extends BaseKlineBar {
  tradeDate: string
}

interface SwingSignal {
  id: string
  code: string
  sourceStrategy: string
  period: string
  tradeDate: string
  signalType: string
  factorType: string
  score: number
  reason: string
  status: string
  barTimestamp: number
  payload: SwingSignalPayload
  pairId: string
  pairSeq: number
  leg: 'buy' | 'sell' | ''
}

interface SwingSignalPayload {
  pair_id?: string
  pair_seq?: number
  leg?: string
  trend_direction?: string
  trend_adx?: number
  trend_phase?: string
  support_level?: number
  resistance_level?: number
  forward_max_profit_pct?: number | null
  forward_max_drawdown_pct?: number | null
  forward_exit_return_pct?: number | null
  forward_risk_reward?: number | null
  forward_holding_days?: number
  is_profitable?: boolean
  run_meta?: Record<string, unknown>
}

interface PairAuditStep {
  buy_idx?: number
  input_paths?: number
  candidate_pairs?: number
  expanded_paths?: number
  blocked_by_overlap?: number
  duplicate_paths?: number
  pruned_by_beam?: number
  kept_paths?: number
}

interface PairAuditSegment {
  segment?: [number, number]
  buy_candidates?: number
  seed_buy_candidates?: number
  sell_candidates?: number
  pairable_buy_nodes?: number
  selected_pairs?: number
  status?: string
  beam?: {
    steps?: PairAuditStep[]
    final_path_count?: number
    selected_pair_count?: number
  }
}

interface PairAudit {
  segment_count?: number
  segments?: PairAuditSegment[]
  dedup_discarded?: Array<{ buy_idx?: number; sell_idx?: number; reason?: string }>
}

const asNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

const parsePayload = (raw: unknown): SwingSignalPayload => {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return raw as SwingSignalPayload
}

const toSwingSignal = (raw: UnknownRecord): SwingSignal | null => {
  const id = String(raw.id || '')
  if (!id) return null
  const payload = parsePayload(raw.payload)
  const legRaw = String(payload.leg || '')
  const leg = legRaw === 'buy' || legRaw === 'sell' ? legRaw : ''
  return {
    id,
    code: String(raw.code || ''),
    sourceStrategy: String(raw.source_strategy || ''),
    period: String(raw.period || ''),
    tradeDate: String(raw.trade_date || ''),
    signalType: String(raw.signal_type || ''),
    factorType: String(raw.factor_type || ''),
    score: asNumber(raw.score),
    reason: String(raw.reason || ''),
    status: String(raw.status || 'proposed'),
    barTimestamp: asNumber(raw.bar_timestamp),
    payload,
    pairId: String(payload.pair_id || ''),
    pairSeq: asNumber(payload.pair_seq, 0),
    leg,
  }
}

const legOrder = (leg: SwingSignal['leg']): number => {
  if (leg === 'buy') return 0
  if (leg === 'sell') return 1
  return 2
}

const sortSignals = (signals: SwingSignal[]): SwingSignal[] => {
  return [...signals].sort((a, b) => {
    if (a.pairSeq > 0 && b.pairSeq > 0 && a.pairSeq !== b.pairSeq) return a.pairSeq - b.pairSeq
    if (a.pairId && b.pairId && a.pairId !== b.pairId) return a.pairId.localeCompare(b.pairId)
    if (a.barTimestamp !== b.barTimestamp) return a.barTimestamp - b.barTimestamp
    return legOrder(a.leg) - legOrder(b.leg)
  })
}

const formatPct = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

const formatPrice = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return value.toFixed(2)
}

const formatTradeDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const shiftTradeDate = (tradeDate: string, days: number): string => {
  const anchor = new Date(`${tradeDate}T12:00:00+08:00`)
  anchor.setDate(anchor.getDate() + days)
  const year = anchor.getFullYear()
  const month = String(anchor.getMonth() + 1).padStart(2, '0')
  const day = String(anchor.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toMillis = (value: unknown): number => {
  if (typeof value === 'number') return value > 1_000_000_000_000 ? value : value * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const toChartBars = (rows: UnknownRecord[]): ChartBar[] => {
  return rows
    .map((row) => {
      const timestamp = toMillis(row.timestamp)
      return {
        tradeDate: formatTradeDate(timestamp),
        timestamp,
        open: asNumber(row.open),
        high: asNumber(row.high),
        low: asNumber(row.low),
        close: asNumber(row.close),
        volume: asNumber(row.volume),
      }
    })
    .filter((bar) => bar.timestamp > 0 && bar.close > 0)
    .sort((left, right) => left.timestamp - right.timestamp)
}

const signalNameLabel: Record<string, string> = {
  TPB: '趋势回调买',
  BB: '突破买',
  TRB: '趋势恢复买',
  TBS: '趋势破位卖',
  DS: '派发卖',
  LHS: '低高卖点',
}

const parsePairAudit = (signal: SwingSignal | null): PairAudit | null => {
  const runMeta = signal?.payload?.run_meta
  if (!runMeta || typeof runMeta !== 'object') return null
  const raw = (runMeta as Record<string, unknown>).pair_audit
  if (!raw || typeof raw !== 'object') return null
  return raw as PairAudit
}

const LabelInspectPanel = () => {
  const [reviewQueue, setReviewQueue] = useState<SwingSignal[]>([])
  const [loadingQueue, setLoadingQueue] = useState(false)
  const [sampleSize, setSampleSize] = useState(30)
  const [stratify, setStratify] = useState(true)
  const [currentRunId, setCurrentRunId] = useState('')
  const [currentRunName, setCurrentRunName] = useState('')
  const [currentSourceStrategy, setCurrentSourceStrategy] = useState('')
  const [runStats, setRunStats] = useState<{ total: number; proposed: number; accepted: number; rejected: number; stockCount: number; pairCount: number }>({
    total: 0,
    proposed: 0,
    accepted: 0,
    rejected: 0,
    stockCount: 0,
    pairCount: 0,
  })

  const [availableRuns, setAvailableRuns] = useState<Array<{ runId: string; runName: string; sourceStrategy: string; total: number; proposed: number; accepted: number; rejected: number; stockCount: number; createdAt: number }>>([])
  const [selectedRunId, setSelectedRunId] = useState('')

  const [groupedQueue, setGroupedQueue] = useState<Map<string, SwingSignal[]>>(new Map())
  const [stockKeys, setStockKeys] = useState<string[]>([])
  const [currentStockIdx, setCurrentStockIdx] = useState(0)
  const [currentSignalIdx, setCurrentSignalIdx] = useState(0)

  const [chartBars, setChartBars] = useState<ChartBar[]>([])
  const [loadingChart, setLoadingChart] = useState(false)
  const [loadingStockSignals, setLoadingStockSignals] = useState(false)
  const [reviewingRun, setReviewingRun] = useState(false)
  const [error, setError] = useState('')

  const stockDetailLoadRef = useRef(0)
  const prevStockCodeRef = useRef('')

  useEffect(() => {
    const loadRuns = async () => {
      try {
        const result = await window.electronAPI?.listSwingLabelRuns?.({ limit: 100 }) as {
          success?: boolean
          data?: { runs?: Array<UnknownRecord>; total?: number }
        } | undefined
        if (result?.success && Array.isArray(result.data?.runs)) {
          const runs = result.data.runs.map((r: UnknownRecord) => ({
            runId: String(r.runId || ''),
            runName: String(r.runName || ''),
            sourceStrategy: String(r.sourceStrategy || ''),
            total: Number(r.total || 0),
            proposed: Number(r.proposed || 0),
            accepted: Number(r.accepted || 0),
            rejected: Number(r.rejected || 0),
            stockCount: Number(r.stockCount || 0),
            createdAt: Number(r.createdAt || 0),
          }))
          setAvailableRuns(runs)
        }
      } catch { /* ignore */ }
    }
    void loadRuns()
  }, [])

  const currentStockSignals = useMemo(() => {
    const key = stockKeys[currentStockIdx]
    if (!key) return []
    return groupedQueue.get(key) || []
  }, [groupedQueue, stockKeys, currentStockIdx])

  const currentSignal = useMemo(() => {
    return currentStockSignals[currentSignalIdx] || null
  }, [currentStockSignals, currentSignalIdx])

  const currentPairAudit = useMemo(() => parsePairAudit(currentSignal), [currentSignal])
  const [showAuditSteps, setShowAuditSteps] = useState(false)

  const stockPairs = useMemo(() => {
    const pairMap = new Map<string, { key: string; pairSeq: number; indices: number[]; buyDate: string; sellDate: string }>()
    currentStockSignals.forEach((sig, idx) => {
      const key = sig.pairId || `single_${sig.id}`
      const existing = pairMap.get(key)
      if (!existing) {
        pairMap.set(key, {
          key,
          pairSeq: sig.pairSeq || 0,
          indices: [idx],
          buyDate: sig.signalType === 'buy' ? sig.tradeDate : '--',
          sellDate: sig.signalType === 'sell' ? sig.tradeDate : '--',
        })
      } else {
        existing.indices.push(idx)
        if (sig.signalType === 'buy') existing.buyDate = sig.tradeDate
        if (sig.signalType === 'sell') existing.sellDate = sig.tradeDate
      }
    })
    return Array.from(pairMap.values()).sort((a, b) => {
      if (a.pairSeq > 0 && b.pairSeq > 0 && a.pairSeq !== b.pairSeq) return a.pairSeq - b.pairSeq
      return a.indices[0] - b.indices[0]
    })
  }, [currentStockSignals])

  const currentPairIndex = useMemo(() => {
    return stockPairs.findIndex((pair) => pair.indices.includes(currentSignalIdx))
  }, [stockPairs, currentSignalIdx])

  const chartMarkers = useMemo<BaseMarker[]>(() => {
    if (chartBars.length === 0 || currentStockSignals.length === 0) return []
    const dateToIndex = new Map(chartBars.map((bar, index) => [bar.tradeDate, index]))
    return currentStockSignals
      .map((sig) => {
        const barIndex = dateToIndex.get(sig.tradeDate)
        if (barIndex === undefined) return null
        const bar = chartBars[barIndex]
        return {
          barIndex,
          actionType: sig.signalType === 'buy' ? 'buy' as const : 'sell' as const,
          price: bar?.low ?? 0,
        }
      })
      .filter((m): m is BaseMarker => m !== null)
  }, [chartBars, currentStockSignals])

  const selectedMarkerIndex = useMemo(() => {
    if (!currentSignal || chartBars.length === 0) return undefined
    const dateToIndex = new Map(chartBars.map((bar, index) => [bar.tradeDate, index]))
    const barIdx = dateToIndex.get(currentSignal.tradeDate)
    if (barIdx === undefined) return undefined
    return chartMarkers.findIndex((m) => m.barIndex === barIdx)
  }, [chartBars, chartMarkers, currentSignal])

  const exitWindow = useMemo<ExitWindowRange | undefined>(() => {
    if (!currentSignal || chartBars.length === 0) return undefined
    const dateToIndex = new Map(chartBars.map((bar, index) => [bar.tradeDate, index]))
    const entryBarIdx = dateToIndex.get(currentSignal.tradeDate)
    if (entryBarIdx === undefined) return undefined
    const holdingDays = currentSignal.payload.forward_holding_days || 10
    const exitBarIdx = Math.min(entryBarIdx + holdingDays, chartBars.length - 1)
    if (exitBarIdx <= entryBarIdx) return undefined

    const windowBars = chartBars.slice(entryBarIdx, exitBarIdx + 1)
    const highPrice = Math.max(...windowBars.map((b) => b.high))
    const lowPrice = Math.min(...windowBars.map((b) => b.low))
    return { entryBarIndex: entryBarIdx, exitBarIndex: exitBarIdx, highPrice, lowPrice }
  }, [chartBars, currentSignal])

  const handleLoadQueue = useCallback(async () => {
    setLoadingQueue(true)
    setError('')
    try {
      const result = await window.electronAPI?.getSwingReviewQueue?.({
        sampleSize,
        status: 'proposed',
        stratify,
        latestRunOnly: !selectedRunId,
        ...(selectedRunId ? { runId: selectedRunId } : {}),
      })
      if (!result || typeof result !== 'object') {
        setError('审查队列加载失败')
        return
      }
      const r = result as { success?: boolean; data?: { samples?: UnknownRecord[]; total?: number }; error?: { message: string } }
      const data = r.data || r
      const samples = ((data as unknown as Record<string, unknown>).samples || []) as UnknownRecord[]
      const total = (data as unknown as Record<string, unknown>).total as number || 0
      const runId = String((data as unknown as Record<string, unknown>).runId || '')
      const runName = String((data as unknown as Record<string, unknown>).runName || '')
      const sourceStrategy = String((data as unknown as Record<string, unknown>).sourceStrategy || '')
      const statsRaw = ((data as unknown as Record<string, unknown>).runStats || {}) as Record<string, unknown>
      setCurrentRunId(runId)
      setCurrentRunName(runName)
      setCurrentSourceStrategy(sourceStrategy)
      setRunStats({
        total: asNumber(statsRaw.total, total),
        proposed: asNumber(statsRaw.proposed, 0),
        accepted: asNumber(statsRaw.accepted, 0),
        rejected: asNumber(statsRaw.rejected, 0),
        stockCount: asNumber(statsRaw.stock_count, 0),
        pairCount: asNumber(statsRaw.pair_count, 0),
      })

      const signals = sortSignals(samples.map(toSwingSignal).filter((s): s is SwingSignal => s !== null))
      setReviewQueue(signals)

      try {
        const refreshResult = await window.electronAPI?.listSwingLabelRuns?.({ limit: 100 }) as {
          success?: boolean
          data?: { runs?: Array<UnknownRecord>; total?: number }
        } | undefined
        if (refreshResult?.success && Array.isArray(refreshResult.data?.runs)) {
          setAvailableRuns(refreshResult.data.runs.map((r: UnknownRecord) => ({
            runId: String(r.runId || ''),
            runName: String(r.runName || ''),
            sourceStrategy: String(r.sourceStrategy || ''),
            total: Number(r.total || 0),
            proposed: Number(r.proposed || 0),
            accepted: Number(r.accepted || 0),
            rejected: Number(r.rejected || 0),
            stockCount: Number(r.stockCount || 0),
            createdAt: Number(r.createdAt || 0),
          })))
        }
      } catch { /* ignore */ }

      if (signals.length === 0) {
        setError('当前最新版本没有待审核标签。请先生成新标签版本，或在数据集管理中使用已接受/已拒绝的数据。')
      }

      const grouped = new Map<string, SwingSignal[]>()
      for (const sig of signals) {
        const key = `${sig.code}`
        const existing = grouped.get(key) || []
        existing.push(sig)
        grouped.set(key, existing)
      }
      for (const [key, list] of grouped.entries()) {
        grouped.set(key, sortSignals(list))
      }
      setGroupedQueue(grouped)
      setStockKeys(Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b)))
      setCurrentStockIdx(0)
      setCurrentSignalIdx(0)
      prevStockCodeRef.current = ''
    } catch (err) {
      setError(`审查队列加载失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setLoadingQueue(false)
    }
  }, [sampleSize, stratify, selectedRunId])

  const loadChartForStock = useCallback(async (code: string, signals: SwingSignal[]) => {
    if (signals.length === 0) {
      setChartBars([])
      return
    }
    setLoadingChart(true)
    try {
      const sorted = [...signals].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
      const lastDate = sorted[sorted.length - 1].tradeDate
      const chartStartDate = '2000-01-01'
      const chartEndDate = shiftTradeDate(lastDate, 30)
      const candles = await window.electronAPI?.data?.getCandles?.(code, '1d', chartStartDate, chartEndDate)
      const normalized = toChartBars((candles || []) as UnknownRecord[])
      setChartBars(normalized)
    } catch {
      setChartBars([])
    } finally {
      setLoadingChart(false)
    }
  }, [])

  const hydrateStockSignals = useCallback(async (code: string, fallbackSignals: SwingSignal[]) => {
    const targetCode = String(code || '').trim()
    if (!targetCode) return
    const reqId = stockDetailLoadRef.current + 1
    stockDetailLoadRef.current = reqId
    setLoadingStockSignals(true)
    try {
      const result = await window.electronAPI?.getSwingLabelDetails?.({
        code: targetCode,
        sourceStrategy: fallbackSignals[0]?.sourceStrategy || undefined,
        status: 'proposed',
        pairOnly: true,
        limit: 2000,
        latestRunOnly: !selectedRunId,
        ...(selectedRunId ? { runId: selectedRunId } : {}),
      })
      const payload = (result as { data?: { signals?: UnknownRecord[] } } | undefined)?.data
      const rows = Array.isArray(payload?.signals) ? payload.signals : []
      const fullSignals = sortSignals(rows.map(toSwingSignal).filter((s): s is SwingSignal => s !== null))
      if (stockDetailLoadRef.current !== reqId) return

      const nextSignals = fullSignals.length > 0 ? fullSignals : fallbackSignals
      setGroupedQueue((prev) => {
        const cloned = new Map(prev)
        cloned.set(targetCode, nextSignals)
        return cloned
      })
    } catch {
      if (stockDetailLoadRef.current !== reqId) return
      setGroupedQueue((prev) => {
        const cloned = new Map(prev)
        cloned.set(targetCode, fallbackSignals)
        return cloned
      })
    } finally {
      if (stockDetailLoadRef.current === reqId) setLoadingStockSignals(false)
    }
  }, [selectedRunId])

  useEffect(() => {
    const key = stockKeys[currentStockIdx]
    if (!key) return
    const signals = groupedQueue.get(key) || []
    const stockChanged = prevStockCodeRef.current !== key
    if (stockChanged) {
      prevStockCodeRef.current = key
      setCurrentSignalIdx(0)
      void hydrateStockSignals(key, signals)
    }
    if (signals.length > 0) {
      void loadChartForStock(key, signals)
    } else {
      setChartBars([])
    }
  }, [currentStockIdx, stockKeys, groupedQueue, loadChartForStock, hydrateStockSignals])

  const navigateStock = useCallback((direction: 1 | -1) => {
    setCurrentStockIdx((prev) => {
      const next = prev + direction
      if (next < 0) return 0
      if (next >= stockKeys.length) return stockKeys.length - 1
      return next
    })
  }, [stockKeys.length])

  const navigateSignal = useCallback((direction: 1 | -1) => {
    setCurrentSignalIdx((prev) => {
      const max = currentStockSignals.length - 1
      if (prev + direction < 0) return 0
      if (prev + direction > max) return max
      return prev + direction
    })
  }, [currentStockSignals.length])

  const navigatePair = useCallback((direction: 1 | -1) => {
    if (stockPairs.length === 0) return
    const current = currentPairIndex >= 0 ? currentPairIndex : 0
    const next = Math.max(0, Math.min(stockPairs.length - 1, current + direction))
    const pair = stockPairs[next]
    if (!pair || pair.indices.length === 0) return
    setCurrentSignalIdx(pair.indices[0])
  }, [stockPairs, currentPairIndex])

  const handleReviewRun = useCallback(async (decision: 'accept' | 'reject') => {
    if (!currentRunId) {
      setError('未找到当前打标版本，请先加载审查队列。')
      return
    }
    setReviewingRun(true)
    try {
      const result = await window.electronAPI?.reviewSwingLabelRun?.({
        decision,
        runId: currentRunId,
        sourceStrategy: currentSourceStrategy || undefined,
        status: 'proposed',
      }) as { success?: boolean; data?: { updated?: number }; error?: { message?: string } } | undefined
      if (!result?.success) {
        setError(`整版审核失败: ${result?.error?.message || '未知错误'}`)
        return
      }
      const updated = Number(result.data?.updated || 0)
      setRunStats((prev) => ({
        ...prev,
        proposed: Math.max(0, prev.proposed - updated),
        accepted: decision === 'accept' ? prev.accepted + updated : prev.accepted,
        rejected: decision === 'reject' ? prev.rejected + updated : prev.rejected,
      }))
      setReviewQueue((prev) => prev.map((sig) => ({ ...sig, status: decision === 'accept' ? 'accepted' : 'rejected' })))
      setGroupedQueue((prev) => {
        const cloned = new Map<string, SwingSignal[]>()
        for (const [key, list] of prev.entries()) {
          cloned.set(key, list.map((sig) => ({ ...sig, status: decision === 'accept' ? 'accepted' : 'rejected' })))
        }
        return cloned
      })
    } catch (err) {
      setError(`整版审核失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setReviewingRun(false)
    }
  }, [currentRunId, currentSourceStrategy])

  const handleMarkerClick = useCallback((markerIndex: number) => {
    setCurrentSignalIdx(markerIndex)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (reviewQueue.length === 0) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          navigateSignal(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          navigateSignal(1)
          break
        case 'PageUp':
          e.preventDefault()
          navigatePair(-1)
          break
        case 'PageDown':
          e.preventDefault()
          navigatePair(1)
          break
        case 'ArrowUp':
          e.preventDefault()
          navigateStock(-1)
          break
        case 'ArrowDown':
          e.preventDefault()
          navigateStock(1)
          break
        case 'a':
        case 'A':
        case 'r':
        case 'R':
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [reviewQueue.length, navigateSignal, navigatePair, navigateStock])

  const currentStockCode = stockKeys[currentStockIdx] || ''
  const reviewedCount = runStats.accepted + runStats.rejected
  const progressPct = runStats.total > 0 ? ((reviewedCount / runStats.total) * 100).toFixed(1) : '0'
  const agreementRate = reviewedCount > 0 ? ((runStats.accepted / reviewedCount) * 100).toFixed(1) : '0'

  return (
    <section className="model-card label-inspect-panel">
      <div className="model-card-head">
        <div>
          <h3>波段标签审查工作台</h3>
          <p className="model-subtle">
            简化为“整版审核”：先抽样查看，再对当前打标版本一键接受或拒绝。
          </p>
        </div>
      </div>

      <div className="label-inspect-section">
        <h4 className="label-inspect-section__title">抽样审查</h4>
        <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
          如需生成标签，请前往"策略打标"子视图。此处仅做抽样可视化审核。
        </p>
      </div>

      <div className="label-inspect-section">
        <h4 className="label-inspect-section__title">抽样审查队列</h4>
        <div className="label-inspect-toolbar">
          <label>
            打标版本
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              style={{ minWidth: 240 }}
            >
              <option value="">⟶ 最新版本</option>
              {availableRuns.map((run) => {
                const date = run.runId.split('_').length >= 3
                  ? run.runId.split('_').slice(-2).join('').replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6')
                  : new Date(run.createdAt * 1000).toLocaleString()
                return (
                  <option key={run.runId} value={run.runId}>
                    [{run.sourceStrategy.slice(0, 20)}] {run.total}条({run.proposed}待审) {run.stockCount}只 {date}
                  </option>
                )
              })}
            </select>
          </label>
          <label>
            抽样数量
            <input type="number" min={5} max={100} step={5} value={sampleSize} onChange={(e) => setSampleSize(Math.max(5, Math.min(100, Number(e.target.value) || 30)))} />
          </label>
          <label>
            分层抽样
            <select value={stratify ? 'yes' : 'no'} onChange={(e) => setStratify(e.target.value === 'yes')}>
              <option value="yes">按股票分层（推荐）</option>
              <option value="no">纯随机</option>
            </select>
          </label>
          <div className="model-actions label-inspect-actions">
            <button className="btn btn-primary" onClick={() => void handleLoadQueue()} disabled={loadingQueue}>
              {loadingQueue ? '加载中...' : '加载审查队列'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="label-inspect-error">{error}</div>}

      {reviewQueue.length > 0 && (
        <>
          <div className="label-inspect-progress">
            <div className="label-inspect-progress__bar">
              <div className="label-inspect-progress__fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="label-inspect-progress__stats">
              <span>名称 {currentRunName || '--'}</span>
              <span>版本 {currentRunId || '--'}</span>
              <span>股票 {runStats.stockCount}</span>
              <span>交易对 {runStats.pairCount}</span>
              <span>总标签 {runStats.total}</span>
              <span>待决策 {runStats.proposed}</span>
              <span>通过率 {agreementRate}%</span>
            </div>
          </div>

          <div className="label-inspect-pair-bar" style={{ marginTop: '0.5rem' }}>
            <div className="label-inspect-pair-bar__meta">
              <strong>整版审核</strong>
              <span>确认当前版本后，对本版本全部 `proposed` 标签统一改为 `accepted` 或 `rejected`。</span>
            </div>
            <div className="label-inspect-pair-bar__actions">
              <button
                className="btn btn-accept"
                disabled={reviewingRun || !currentRunId || runStats.proposed <= 0}
                onClick={() => void handleReviewRun('accept')}
              >
                {reviewingRun ? '处理中...' : '接受本版 (Yes)'}
              </button>
              <button
                className="btn btn-reject"
                disabled={reviewingRun || !currentRunId || runStats.proposed <= 0}
                onClick={() => void handleReviewRun('reject')}
              >
                {reviewingRun ? '处理中...' : '拒绝本版 (No)'}
              </button>
            </div>
          </div>

          {stockPairs.length > 0 && (
            <div className="label-inspect-pair-bar">
              <div className="label-inspect-pair-bar__meta">
                <strong>交易对 {Math.max(1, currentPairIndex + 1)} / {stockPairs.length}</strong>
                {currentPairIndex >= 0 && (
                  <span>
                    {stockPairs[currentPairIndex]?.pairSeq ? `P${stockPairs[currentPairIndex].pairSeq}` : '未编号'} ·
                    买入 {stockPairs[currentPairIndex]?.buyDate || '--'} · 卖出 {stockPairs[currentPairIndex]?.sellDate || '--'}
                  </span>
                )}
              </div>
              <div className="label-inspect-pair-bar__actions">
                <button className="label-inspect-pair-btn" onClick={() => navigatePair(-1)} disabled={currentPairIndex <= 0}>上一对</button>
                <button className="label-inspect-pair-btn" onClick={() => navigatePair(1)} disabled={currentPairIndex < 0 || currentPairIndex >= stockPairs.length - 1}>下一对</button>
              </div>
            </div>
          )}

          <div className="label-inspect-layout">
            <div className="label-inspect-chart">
              {loadingChart ? (
                <div className="model-empty">加载 K 线数据...</div>
              ) : loadingStockSignals ? (
                <div className="model-empty">加载该股票全量交易对...</div>
              ) : chartBars.length > 0 ? (
                <BaseKlineChart
                  data={chartBars}
                  markers={chartMarkers}
                  selectedMarkerIndex={selectedMarkerIndex}
                  exitWindow={exitWindow}
                  onMarkerClick={handleMarkerClick}
                  scrollToDate={currentSignal?.tradeDate}
                  ticker={`${currentStockCode}-SWING`}
                  visibleCount={chartBars.length}
                  minHeight={0}
                />
              ) : (
                <div className="model-empty">选择股票后加载 K 线数据。</div>
              )}
            </div>

            <div className="label-inspect-side">
              <div className="label-inspect-side__card">
                <h4>键盘快捷键</h4>
                <ul className="label-inspect-shortcut-list">
                  <li><kbd>←</kbd> <kbd>→</kbd> 切换标签点</li>
                  <li><kbd>↑</kbd> <kbd>↓</kbd> 切换股票</li>
                  <li>也可以点击 K 线图上的标记点选中</li>
                </ul>
              </div>

              {currentSignal && (
                <div className="label-inspect-side__card">
                  <h4>当前信号详情</h4>
                  <div className="label-inspect-signal-detail">
                    <div className="label-inspect-signal-row">
                      <span className="label-inspect-signal__label">标的</span>
                      <strong>{currentStockCode}</strong>
                    </div>
                    <div className="label-inspect-signal-row">
                      <span className="label-inspect-signal__label">日期</span>
                      <strong>{currentSignal.tradeDate}</strong>
                    </div>
                    <div className="label-inspect-signal-row">
                      <span className="label-inspect-signal__label">信号类型</span>
                      <span className={`label-inspect-badge ${currentSignal.signalType === 'buy' ? 'is-positive' : 'is-negative'}`}>
                        {signalNameLabel[currentSignal.factorType] || currentSignal.factorType} ({currentSignal.signalType === 'buy' ? '买' : '卖'})
                      </span>
                    </div>
                    <div className="label-inspect-signal-row">
                      <span className="label-inspect-signal__label">交易对</span>
                      <strong>{currentSignal.pairSeq > 0 ? `P${currentSignal.pairSeq} · ${currentSignal.leg || currentSignal.signalType}` : '--'}</strong>
                    </div>
                    <div className="label-inspect-signal-row">
                      <span className="label-inspect-signal__label">评分</span>
                      <strong>{currentSignal.score.toFixed(3)}</strong>
                    </div>
                    <div className="label-inspect-signal-row">
                      <span className="label-inspect-signal__label">状态</span>
                      <span className={`label-inspect-badge is-${currentSignal.status === 'accepted' ? 'positive' : currentSignal.status === 'rejected' ? 'negative' : 'aligned'}`}>
                        {currentSignal.status}
                      </span>
                    </div>
                    {currentSignal.reason && (
                      <div className="label-inspect-signal-row label-inspect-signal-row--full">
                        <span className="label-inspect-signal__label">原因</span>
                        <span className="label-inspect-signal__reason">{currentSignal.reason}</span>
                      </div>
                    )}
                  </div>

                  {currentSignal.payload && (
                    <>
                      <h4 style={{ marginTop: '0.6rem' }}>前瞻收益</h4>
                      <div className="label-inspect-signal-detail">
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">退出收益</span>
                          <strong className={((currentSignal.payload.forward_exit_return_pct ?? 0) >= 0) ? 'is-up' : 'is-down'}>
                            {formatPct(currentSignal.payload.forward_exit_return_pct)}
                          </strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">最大浮盈</span>
                          <strong className="is-up">{formatPct(currentSignal.payload.forward_max_profit_pct)}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">最大回撤</span>
                          <strong className="is-down">{formatPct(currentSignal.payload.forward_max_drawdown_pct)}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">风险回报比</span>
                          <strong>{currentSignal.payload.forward_risk_reward?.toFixed(2) || '--'}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">持仓天数</span>
                          <strong>{currentSignal.payload.forward_holding_days || '--'}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">盈利判定</span>
                          <span className={`label-inspect-badge ${currentSignal.payload.is_profitable ? 'is-positive' : 'is-negative'}`}>
                            {currentSignal.payload.is_profitable ? '盈利' : '亏损'}
                          </span>
                        </div>
                      </div>

                      <h4 style={{ marginTop: '0.6rem' }}>趋势背景</h4>
                      <div className="label-inspect-signal-detail">
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">趋势方向</span>
                          <strong>{currentSignal.payload.trend_direction || '--'}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">ADX</span>
                          <strong>{currentSignal.payload.trend_adx?.toFixed(1) || '--'}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">趋势阶段</span>
                          <strong>{currentSignal.payload.trend_phase || '--'}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">支撑位</span>
                          <strong>{formatPrice(currentSignal.payload.support_level)}</strong>
                        </div>
                        <div className="label-inspect-signal-row">
                          <span className="label-inspect-signal__label">阻力位</span>
                          <strong>{formatPrice(currentSignal.payload.resistance_level)}</strong>
                        </div>
                      </div>

                      {currentPairAudit && (
                        <>
                          <h4 style={{ marginTop: '0.6rem' }}>审计摘要</h4>
                          <div className="label-inspect-audit-compact">
                            <div className="label-inspect-audit-kv">
                              <span>Segment数</span>
                              <strong>{currentPairAudit.segment_count ?? '--'}</strong>
                            </div>
                            <div className="label-inspect-audit-kv">
                              <span>去重丢弃</span>
                              <strong>{currentPairAudit.dedup_discarded?.length ?? 0}</strong>
                            </div>
                            <div className="label-inspect-audit-kv">
                              <span>预筛后候选</span>
                              <strong>{
                                currentPairAudit.segments?.reduce((acc, seg) => acc + Number(seg.seed_buy_candidates || 0), 0) ?? 0
                              }</strong>
                            </div>
                            <div className="label-inspect-audit-kv">
                              <span>可配节点</span>
                              <strong>{
                                currentPairAudit.segments?.reduce((acc, seg) => acc + Number(seg.pairable_buy_nodes || 0), 0) ?? 0
                              }</strong>
                            </div>
                          </div>

                          <div className="label-inspect-audit-toggle">
                            <button
                              type="button"
                              className="label-inspect-pair-btn"
                              onClick={() => setShowAuditSteps((prev) => !prev)}
                            >
                              {showAuditSteps ? '收起 Beam 明细' : '展开 Beam 明细'}
                            </button>
                          </div>

                          {showAuditSteps && (
                            <div className="label-inspect-audit-steps">
                              {(currentPairAudit.segments || []).slice(0, 6).map((seg, segIdx) => (
                                <div key={`seg-${segIdx}`} className="label-inspect-audit-step-card">
                                  <div className="label-inspect-audit-step-head">
                                    <strong>
                                      Segment {segIdx + 1}
                                      {Array.isArray(seg.segment) ? ` [${seg.segment[0]}-${seg.segment[1]}]` : ''}
                                    </strong>
                                    <span>{seg.status || '--'}</span>
                                  </div>
                                  {(seg.beam?.steps || []).slice(0, 5).map((step, stepIdx) => (
                                    <div key={`step-${segIdx}-${stepIdx}`} className="label-inspect-audit-step-row">
                                      <span>buy@{step.buy_idx ?? '--'}</span>
                                      <span>候选{step.candidate_pairs ?? 0}</span>
                                      <span>扩展{step.expanded_paths ?? 0}</span>
                                      <span>剪枝{step.pruned_by_beam ?? 0}</span>
                                      <span>保留{step.kept_paths ?? 0}</span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}

                </div>
              )}
            </div>
          </div>

          {currentStockSignals.length > 0 && (
            <div className="model-table-wrap label-inspect-table">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>日期</th>
                    <th>交易对</th>
                    <th>信号</th>
                    <th>类型</th>
                    <th>评分</th>
                    <th>退出收益</th>
                    <th>最大浮盈</th>
                    <th>最大回撤</th>
                    <th>RR</th>
                    <th>盈利</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {currentStockSignals.map((sig, idx) => {
                    const isActive = idx === currentSignalIdx
                    return (
                      <tr
                        key={sig.id}
                        className={isActive ? 'is-active' : ''}
                        onClick={() => setCurrentSignalIdx(idx)}
                      >
                        <td>{idx + 1}</td>
                        <td><strong>{sig.tradeDate}</strong></td>
                        <td>{sig.pairSeq > 0 ? `P${sig.pairSeq}` : '--'}</td>
                        <td>
                          <span className={`label-inspect-badge ${sig.signalType === 'buy' ? 'is-positive' : 'is-negative'}`}>
                            {sig.signalType === 'buy' ? '买' : '卖'}
                          </span>
                        </td>
                        <td>{signalNameLabel[sig.factorType] || sig.factorType}</td>
                        <td>{sig.score.toFixed(3)}</td>
                        <td className={((sig.payload.forward_exit_return_pct ?? 0) >= 0) ? 'is-up' : 'is-down'}>
                          {formatPct(sig.payload.forward_exit_return_pct)}
                        </td>
                        <td className="is-up">{formatPct(sig.payload.forward_max_profit_pct)}</td>
                        <td className="is-down">{formatPct(sig.payload.forward_max_drawdown_pct)}</td>
                        <td>{sig.payload.forward_risk_reward?.toFixed(2) || '--'}</td>
                        <td>
                          <span className={`label-inspect-badge ${sig.payload.is_profitable ? 'is-positive' : 'is-negative'}`}>
                            {sig.payload.is_profitable ? '✓' : '✗'}
                          </span>
                        </td>
                        <td>
                          <span className={`label-inspect-badge is-${sig.status === 'accepted' ? 'positive' : sig.status === 'rejected' ? 'negative' : 'aligned'}`}>
                            {sig.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default LabelInspectPanel
