import { ipcMain } from 'electron'
import { existsSync, unlinkSync } from 'fs'
import log from '../logger'
import { getDb } from '../db'
import { loadMarketCandles, resolveMarketDbPath, type KlineInterval } from '../marketDb'
import { fail, ok } from './platformResult'
import { syncModelArtifactsIntoDatabase } from './modelArtifactSync'

type SupportedPeriod = '5m' | '15m' | '1d'
type SignalFeedbackAction = 'accept' | 'ignore' | 'modify'
type RetrainingTrigger = 'manual' | 'scheduled' | 'sync_after'

interface SignalEventFilters {
  code?: string
  period?: string
  modelId?: string
  status?: string
  limit?: number
}

interface RecommendationReviewFilters {
  modelId?: string
  period?: string
  startDate?: string
  endDate?: string
  horizonDays?: number
  limit?: number
  minPrice?: number
  maxPrice?: number
  minAmount?: number
  markets?: string[]
  source?: string
  latestBatchOnly?: boolean
  filterMa20Up?: boolean
  filterMa5GtMa20?: boolean
  filterAboveMa20?: boolean
}

interface FeedbackBackfillInput {
  limit?: number
  sinceCreatedAt?: number
}

interface FeedbackRetrainingInput {
  triggerType?: RetrainingTrigger
  specVersion?: string
  taskType?: string
  sampleLimit?: number
  minSamples?: number
  activateOnSuccess?: boolean
  sinceCreatedAt?: number
}

interface SignalEventFeedbackRow {
  eventId: string
  modelId: string
  code: string
  period: string
  barTimestamp: number
  signalType: 'buy' | 'sell' | 'hold'
  confidence: number
  score: number | null
  threshold: number | null
}

interface UpsertFeedbackResult {
  skipped?: boolean
  inserted?: boolean
  updated?: boolean
  candidateId?: string
}

interface ModelSignalRetrainingDeps {
  normalizePeriodAlias: (period: string) => SupportedPeriod | null
  runSignalInference: (code: string, period: SupportedPeriod, minConfidence: number) => unknown
  runAutoSignalScan: (
    periods: string[],
    options?: { maxCodesPerPeriod?: number; minConfidence?: number }
  ) => Promise<unknown>
  runHistoricalReplayScan: (options: {
    period: string
    startDate: string
    endDate: string
    minConfidence?: number
  }) => Promise<unknown>
  upsertFeedbackCandidateFromEvent: (
    database: ReturnType<typeof getDb>,
    eventRow: SignalEventFeedbackRow,
    action: 'accept' | 'modify',
    note: string | null,
    now: number
  ) => UpsertFeedbackResult
  backfillFeedbackCandidates: (input?: FeedbackBackfillInput) => unknown
  createFeedbackRetrainingRun: (input?: FeedbackRetrainingInput) => Promise<unknown>
  resolveArtifactPath: (artifactPath: string) => string | null
}

interface CandleBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  amount?: number
}

const normalizeDateInput = (value: string | undefined): string => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  return ''
}

const parseCandleTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

const asFiniteNumber = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
}

const normalizeCandleBars = (rows: Array<Record<string, unknown>>): CandleBar[] => {
  const bars = rows.map((row) => {
    const timestamp = parseCandleTimestamp(row.timestamp)
    const open = asFiniteNumber(row.open)
    const high = asFiniteNumber(row.high)
    const low = asFiniteNumber(row.low)
    const close = asFiniteNumber(row.close)
    const amount = asFiniteNumber(row.amount)
    return { timestamp, open, high, low, close, amount: Number.isFinite(amount) ? amount : undefined }
  }).filter((row) => (
    row.timestamp > 0
    && Number.isFinite(row.open)
    && Number.isFinite(row.high)
    && Number.isFinite(row.low)
    && Number.isFinite(row.close)
  ))
  bars.sort((left, right) => left.timestamp - right.timestamp)
  return bars
}

const findFirstBarAfter = (bars: CandleBar[], timestamp: number): number => {
  let left = 0
  let right = bars.length - 1
  let answer = -1
  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2)
    const bar = bars[mid]
    if (!bar) break
    if (bar.timestamp > timestamp) {
      answer = mid
      right = mid - 1
    } else {
      left = mid + 1
    }
  }
  return answer
}

const resolveMarket = (code: string): string => {
  if (code.startsWith('688')) return 'kcb'
  if (code.startsWith('300')) return 'cyb'
  if (code.startsWith('8')) return 'bse'
  if (code.startsWith('60')) return 'sh'
  if (code.startsWith('002')) return 'sz_sme'
  if (code.startsWith('001') || code.startsWith('003')) return 'sz_main'
  if (code.startsWith('000')) return 'sz_main'
  return 'other'
}

export const registerModelSignalRetrainingIpcHandlers = (deps: ModelSignalRetrainingDeps) => {
  const {
    normalizePeriodAlias,
    runSignalInference,
    runAutoSignalScan,
    runHistoricalReplayScan,
    upsertFeedbackCandidateFromEvent,
    backfillFeedbackCandidates,
    createFeedbackRetrainingRun
  } = deps

  ipcMain.handle('modeling:runSignalInference', async (_, code: string, period: string, minConfidence?: number) => {
    const targetCode = (code || '').trim()
    if (!targetCode) {
      return fail('SIGNAL_INFERENCE_INVALID_CODE', '股票代码不能为空。')
    }
    const normalizedPeriod = normalizePeriodAlias(period)
    if (!normalizedPeriod) {
      return fail('SIGNAL_INFERENCE_UNSUPPORTED_PERIOD', '不支持的周期。', { period })
    }

    const parsedConfidence = Number(minConfidence)
    const confidenceThreshold = Number.isFinite(parsedConfidence)
      ? Math.min(0.99, Math.max(0, parsedConfidence))
      : 0.85
    const result = await runSignalInference(targetCode, normalizedPeriod, confidenceThreshold) as Record<string, unknown>
    if (result.success !== true) {
      const reason = typeof result.reason === 'string' ? result.reason : 'unknown_error'
      const codeMap: Record<string, string> = {
        no_active_model: 'SIGNAL_INFERENCE_ACTIVE_MODEL_MISSING',
        artifact_not_found: 'SIGNAL_INFERENCE_ARTIFACT_NOT_FOUND',
        artifact_parse_error: 'SIGNAL_INFERENCE_ARTIFACT_PARSE_ERROR',
        artifact_schema_invalid: 'SIGNAL_INFERENCE_ARTIFACT_INVALID',
        kline_not_enough: 'SIGNAL_INFERENCE_KLINE_NOT_ENOUGH',
        low_confidence: 'SIGNAL_INFERENCE_LOW_CONFIDENCE',
      }
      const messageMap: Record<string, string> = {
        no_active_model: '当前没有激活模型，无法执行推理。',
        artifact_not_found: '未找到激活模型的产物文件。',
        artifact_parse_error: '模型产物解析失败。',
        artifact_schema_invalid: '模型产物结构无效。',
        kline_not_enough: 'K 线数量不足，无法执行推理。',
        low_confidence: '当前信号置信度不足，已跳过。',
      }
      return fail(codeMap[reason] || 'SIGNAL_INFERENCE_FAILED', messageMap[reason] || `信号推理失败：${reason}。`, result)
    }
    return ok({
      event: (result.event && typeof result.event === 'object') ? result.event as Record<string, unknown> : null,
      modelId: typeof result.modelId === 'string' ? result.modelId : '',
      deduplicated: result.deduplicated === true,
    })
  })

  ipcMain.handle('modeling:runSignalScan', async (_, periods?: string[], options?: { maxCodesPerPeriod?: number; minConfidence?: number }) => {
    const targetPeriods = Array.isArray(periods) && periods.length > 0 ? periods : ['1d']
    const result = await runAutoSignalScan(targetPeriods, options) as Record<string, unknown>
    if (result.success !== true) {
      return fail('SIGNAL_SCAN_FAILED', `信号扫描失败：${result.reason || 'unknown_error'}`, result)
    }
    return ok({
      attempted: Number(result.attempted || 0),
      scannedCodes: Number(result.scannedCodes || 0),
      created: Number(result.created || 0),
      deduplicated: Number(result.deduplicated || 0),
      lowConfidence: Number(result.lowConfidence || 0),
      failed: Number(result.failed || 0),
      periods: targetPeriods,
    })
  })

  ipcMain.handle('modeling:runHistoricalReplay', async (_, options?: { period?: string; startDate?: string; endDate?: string; minConfidence?: number }) => {
    const period = String(options?.period || '1d').trim()
    const startDate = String(options?.startDate || '').trim()
    const endDate = String(options?.endDate || '').trim()
    if (!startDate || !endDate) {
      return fail('REPLAY_INVALID_DATE_RANGE', '历史回放需要指定起止日期。')
    }
    const result = await runHistoricalReplayScan({
      period,
      startDate,
      endDate,
      minConfidence: options?.minConfidence,
    }) as Record<string, unknown>
    if (result.success !== true) {
      return fail('REPLAY_FAILED', `历史回放失败：${result.reason || 'unknown_error'}`, result)
    }
    return ok({
      attempted: Number(result.attempted || 0),
      scannedCodes: Number(result.scannedCodes || 0),
      created: Number(result.created || 0),
      deduplicated: Number(result.deduplicated || 0),
      lowConfidence: Number(result.lowConfidence || 0),
      failed: Number(result.failed || 0),
      batches: Number(result.batches || 0),
      period,
      startDate,
      endDate,
    })
  })

  ipcMain.handle('modeling:listSignalEvents', async (_, filters?: SignalEventFilters) => {
    const whereParts: string[] = []
    const values: Array<string | number> = []

    if (filters?.code && filters.code.trim()) {
      whereParts.push('e.code = ?')
      values.push(filters.code.trim())
    }
    if (filters?.period && filters.period.trim()) {
      whereParts.push('e.period = ?')
      values.push(filters.period.trim())
    }
    if (filters?.modelId && filters.modelId.trim()) {
      whereParts.push('e.model_id = ?')
      values.push(filters.modelId.trim())
    }
    if (filters?.status && filters.status.trim()) {
      whereParts.push('e.status = ?')
      values.push(filters.status.trim())
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    const limit = Math.min(500, Math.max(1, Number(filters?.limit || 100)))
    values.push(limit)

    return getDb().prepare(`
      SELECT
        e.*,
        m.name AS model_name,
        (
          SELECT f.action
          FROM signal_feedback f
          WHERE f.signal_event_id = e.id
          ORDER BY f.created_at DESC
          LIMIT 1
        ) AS last_feedback_action,
        (
          SELECT f.note
          FROM signal_feedback f
          WHERE f.signal_event_id = e.id
          ORDER BY f.created_at DESC
          LIMIT 1
        ) AS last_feedback_note,
        (
          SELECT f.created_at
          FROM signal_feedback f
          WHERE f.signal_event_id = e.id
          ORDER BY f.created_at DESC
          LIMIT 1
        ) AS last_feedback_at
      FROM signal_events e
      LEFT JOIN model_versions m ON m.id = e.model_id
      ${whereSql}
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(...values)
  })

  ipcMain.handle('modeling:listRecommendationReview', async (_, filters?: RecommendationReviewFilters) => {
    const safeLimit = Math.min(5000, Math.max(20, Number(filters?.limit || 2000)))
    const horizonDays = Math.min(60, Math.max(1, Number(filters?.horizonDays || 5)))
    const normalizedPeriod = filters?.period ? normalizePeriodAlias(filters.period) : null
    const startDate = normalizeDateInput(filters?.startDate)
    const endDate = normalizeDateInput(filters?.endDate)
    const modelId = String(filters?.modelId || '').trim()
    const source = String(filters?.source || 'replay').trim()
    const latestBatchOnly = filters?.latestBatchOnly !== false

    const whereParts: string[] = ['r.signal_type = ?']
    const values: Array<string | number> = ['buy']

    if (modelId) {
      whereParts.push('r.model_id = ?')
      values.push(modelId)
    }
    if (normalizedPeriod) {
      whereParts.push('r.period = ?')
      values.push(normalizedPeriod)
    }
    if (startDate) {
      whereParts.push('r.signal_date >= ?')
      values.push(startDate)
    }
    if (endDate) {
      whereParts.push('r.signal_date <= ?')
      values.push(endDate)
    }
    if (source) {
      whereParts.push('r.source = ?')
      values.push(source)
    }

    if (latestBatchOnly && source) {
      if (source === 'replay') {
        whereParts.push("r.backtest_id IS NOT NULL AND r.backtest_id <> ''")
      }
      whereParts.push(`
        r.created_at = (
          SELECT MAX(r2.created_at)
          FROM model_recommendations r2
          WHERE r2.model_id = r.model_id
            AND r2.source = r.source
            AND r2.period = r.period
            AND r2.signal_type = r.signal_type
            AND r2.signal_date = r.signal_date
            ${source === 'replay' ? "AND r2.backtest_id IS NOT NULL AND r2.backtest_id <> ''" : ''}
        )
      `)
    }
    values.push(safeLimit)

    const rows = getDb().prepare(`
      SELECT
        r.id, r.model_id, COALESCE(mv.name, r.model_name) AS model_name, r.code, r.stock_name,
        r.signal_date, r.period, r.probability, r.threshold,
        r.confidence, r.trade_executed, r.entry_price, r.exit_close,
        r.exit_high, r.actual_return, r.best_return, r.skip_reason,
        r.source, r.backtest_id, r.spec_version, r.created_at
      FROM model_recommendations r
      LEFT JOIN model_versions mv ON mv.id = r.model_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY r.signal_date DESC, r.created_at DESC
      LIMIT ?
    `).all(...values) as Array<{
      id: string
      model_id: string
      model_name: string | null
      code: string
      stock_name: string | null
      signal_date: string
      period: string
      probability: number | null
      threshold: number
      confidence: number | null
      trade_executed: number
      entry_price: number | null
      exit_close: number | null
      exit_high: number | null
      actual_return: number | null
      best_return: number | null
      skip_reason: string | null
      source: string
      backtest_id: string | null
      spec_version: string | null
      created_at: number
    }>

    const barsCache = new Map<string, CandleBar[]>()
    const market = resolveMarketDbPath()

    const readBars = (code: string, period: SupportedPeriod): CandleBar[] => {
      const key = `${code}|${period}`
      const cached = barsCache.get(key)
      if (cached) return cached

      let normalized: CandleBar[] = []
      try {
        if (market.exists) {
          const candles = loadMarketCandles(market.path, code, period as KlineInterval)
          normalized = normalizeCandleBars(candles)
        }
      } catch {
        normalized = []
      }
      barsCache.set(key, normalized)
      return normalized
    }

    const items: Array<Record<string, unknown>> = []
    let evaluatedCount = 0
    let winCount = 0
    let sumReturn = 0
    let sumMaxDrawdown = 0

    for (const row of rows) {
      const period = normalizedPeriod || normalizePeriodAlias(row.period)
      const baseItem: Record<string, unknown> = {
        id: row.id,
        modelId: row.model_id,
        modelName: row.model_name || row.model_id.slice(0, 12),
        code: row.code,
        stockName: row.stock_name || '',
        period: period || row.period,
        signalDate: row.signal_date,
        confidence: Number(row.confidence || 0),
        score: typeof row.probability === 'number' ? row.probability : null,
        threshold: typeof row.threshold === 'number' ? row.threshold : null,
        source: row.source,
        backtestId: row.backtest_id || '',
        specVersion: row.spec_version || '',
        createdAt: row.created_at,
      }

      if (filters?.markets && filters.markets.length > 0) {
        const stockMarket = resolveMarket(row.code)
        if (!filters.markets.includes(stockMarket)) continue
      }

      if (row.trade_executed && row.actual_return != null) {
        const returnPct = row.actual_return
        const isWin = returnPct > 0
        evaluatedCount += 1
        if (isWin) winCount += 1
        sumReturn += returnPct

        items.push({
          ...baseItem,
          outcomeStatus: 'evaluated',
          horizonDays,
          entryPrice: row.entry_price,
          exitPrice: row.exit_close,
          returnPct,
          win: isWin,
        })
        continue
      }

      if (!period) {
        items.push({ ...baseItem, outcomeStatus: 'unresolved', outcomeReason: 'invalid_period' })
        continue
      }

      const bars = readBars(row.code, period)
      if (bars.length === 0) {
        items.push({ ...baseItem, outcomeStatus: 'unresolved', outcomeReason: 'missing_candles' })
        continue
      }

      const eventMs = new Date(row.signal_date + 'T00:00:00+08:00').getTime()
      if (!Number.isFinite(eventMs) || eventMs <= 0) {
        items.push({ ...baseItem, outcomeStatus: 'unresolved', outcomeReason: 'invalid_date' })
        continue
      }

      const eventIndex = findFirstBarAfter(bars, eventMs) < 0
        ? bars.length - 1
        : findFirstBarAfter(bars, eventMs) - 1
      const signalBar = eventIndex >= 0 && bars[eventIndex] ? bars[eventIndex] : null
      const signalClose = signalBar ? signalBar.close : null

      if (filters?.minPrice != null && signalClose != null && signalClose < filters.minPrice) continue
      if (filters?.maxPrice != null && signalClose != null && signalClose > filters.maxPrice) continue
      if (filters?.minAmount != null && signalBar) {
        const barRecord = signalBar as unknown as Record<string, unknown>
        const barAmount = barRecord.amount
        if (typeof barAmount === 'number' && barAmount < filters.minAmount) continue
      }

      const maWindow = bars.slice(Math.max(0, eventIndex - 25), eventIndex + 1)
      const ma5 = maWindow.length >= 5 ? maWindow.slice(-5).reduce((s, b) => s + b.close, 0) / 5 : null
      const ma20 = maWindow.length >= 20 ? maWindow.slice(-20).reduce((s, b) => s + b.close, 0) / 20 : null
      const prevMa20 = maWindow.length >= 21
        ? maWindow.slice(-21, -1).reduce((s, b) => s + b.close, 0) / 20
        : null

      baseItem.ma5 = ma5
      baseItem.ma20 = ma20
      baseItem.signalClose = signalClose

      if (filters?.filterMa20Up && (ma20 === null || prevMa20 === null || ma20 <= prevMa20)) continue
      if (filters?.filterMa5GtMa20 && (ma5 === null || ma20 === null || ma5 <= ma20)) continue
      if (filters?.filterAboveMa20 && (signalClose === null || ma20 === null || signalClose <= ma20)) continue

      const entryIndex = findFirstBarAfter(bars, eventMs)
      if (entryIndex < 0) {
        items.push({ ...baseItem, outcomeStatus: 'unresolved', outcomeReason: 'missing_next_bar' })
        continue
      }
      const exitIndex = entryIndex + horizonDays - 1
      const entryBar = bars[entryIndex]
      const exitBar = bars[exitIndex]
      if (!entryBar || !exitBar || !Number.isFinite(entryBar.open) || entryBar.open <= 0 || !Number.isFinite(exitBar.close)) {
        items.push({ ...baseItem, outcomeStatus: 'unresolved', outcomeReason: 'insufficient_horizon_bars' })
        continue
      }

      const holdWindow = bars.slice(entryIndex, exitIndex + 1)
      const minLow = holdWindow.reduce((minValue, bar) => Math.min(minValue, Number.isFinite(bar.low) ? bar.low : minValue), entryBar.open)
      const returnPct = (exitBar.close - entryBar.open) / entryBar.open
      const maxDrawdownPct = (minLow - entryBar.open) / entryBar.open
      const isWin = returnPct > 0

      evaluatedCount += 1
      if (isWin) winCount += 1
      sumReturn += returnPct
      sumMaxDrawdown += maxDrawdownPct

      items.push({
        ...baseItem,
        outcomeStatus: 'evaluated',
        horizonDays,
        entryTimestamp: entryBar.timestamp,
        entryPrice: entryBar.open,
        exitTimestamp: exitBar.timestamp,
        exitPrice: exitBar.close,
        returnPct,
        maxDrawdownPct,
        win: isWin,
      })
    }

    const summary = {
      totalRecommendations: rows.length,
      evaluatedRecommendations: evaluatedCount,
      winCount,
      winRate: evaluatedCount > 0 ? winCount / evaluatedCount : 0,
      avgReturnPct: evaluatedCount > 0 ? sumReturn / evaluatedCount : 0,
      avgMaxDrawdownPct: evaluatedCount > 0 ? sumMaxDrawdown / evaluatedCount : 0,
      horizonDays,
      startDate: startDate || null,
      endDate: endDate || null,
      source,
      latestBatchOnly,
      batchId: rows[0]?.backtest_id || null,
      batchCreatedAt: rows[0]?.created_at || null,
    }

    return ok({ summary, items })
  })

  ipcMain.handle('modeling:cleanupLegacyReplayRecommendations', async () => {
    const database = getDb()
    const result = database.prepare(`
      DELETE FROM model_recommendations
      WHERE source = 'replay'
        AND (backtest_id IS NULL OR backtest_id = '')
    `).run()
    return ok({ deleted: result.changes })
  })

  ipcMain.handle('modeling:syncModelArtifacts', async () => {
    const result = syncModelArtifactsIntoDatabase()
    if (!result.success) {
      return fail('MODEL_ARTIFACT_SYNC_FAILED', `模型产物同步失败：${result.reason}。`, {
        reason: result.reason,
        summary: result.summary,
      })
    }
    return ok({
      summary: result.summary,
    })
  })

  ipcMain.handle('modeling:submitSignalFeedback', async (_, signalEventId: string, action: SignalFeedbackAction, note?: string) => {
    const eventId = (signalEventId || '').trim()
    if (!eventId) {
      return fail('SIGNAL_FEEDBACK_INVALID_EVENT_ID', '信号事件 ID 无效。')
    }
    if (!['accept', 'ignore', 'modify'].includes(action)) {
      return fail('SIGNAL_FEEDBACK_INVALID_ACTION', '反馈动作无效。', { action })
    }

    const database = getDb()
    const eventRow = database.prepare(`
      SELECT
        e.id,
        e.model_id,
        e.code,
        e.period,
        e.bar_timestamp,
        e.signal_type,
        e.confidence,
        e.score,
        e.threshold
      FROM signal_events e
      WHERE e.id = ?
      LIMIT 1
    `).get(eventId) as {
      id: string
      model_id: string
      code: string
      period: string
      bar_timestamp: number
      signal_type: 'buy' | 'sell' | 'hold'
      confidence: number
      score: number | null
      threshold: number | null
    } | undefined
    if (!eventRow) {
      return fail('SIGNAL_FEEDBACK_EVENT_NOT_FOUND', '未找到对应的信号事件。', { signalEventId: eventId })
    }

    const feedbackEvent: SignalEventFeedbackRow = {
      eventId: eventRow.id,
      modelId: eventRow.model_id,
      code: eventRow.code,
      period: eventRow.period,
      barTimestamp: eventRow.bar_timestamp,
      signalType: eventRow.signal_type,
      confidence: eventRow.confidence,
      score: eventRow.score,
      threshold: eventRow.threshold
    }

    const now = Math.floor(Date.now() / 1000)
    const feedbackId = `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const nextStatus = action === 'ignore' ? 'ignored' : 'feedback'
    let candidateRef: string | null = null

    database.transaction(() => {
      database.prepare(`
        INSERT INTO signal_feedback (id, signal_event_id, action, note, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(feedbackId, eventId, action, note || null, now)

      database.prepare(`
        UPDATE signal_events
        SET status = ?
        WHERE id = ?
      `).run(nextStatus, eventId)

      if (action === 'accept' || action === 'modify') {
        const backfillResult = upsertFeedbackCandidateFromEvent(
          database,
          feedbackEvent,
          action,
          note || null,
          now
        )
        candidateRef = backfillResult.candidateId || null
      }
    })()

    const event = database.prepare('SELECT * FROM signal_events WHERE id = ? LIMIT 1').get(eventId) as Record<string, unknown> | undefined
    return ok({
      signalEventId: eventId,
      feedbackId,
      action,
      candidateId: candidateRef,
      event: event || null
    })
  })

  ipcMain.handle('modeling:backfillFeedbackCandidates', async (_, limit?: number, sinceCreatedAt?: number) => {
    const result = backfillFeedbackCandidates({
      limit: typeof limit === 'number' ? limit : undefined,
      sinceCreatedAt: typeof sinceCreatedAt === 'number' ? sinceCreatedAt : undefined
    })
    const payload = result as Record<string, unknown>
    if (payload.success !== true) {
      return fail('SIGNAL_BACKFILL_FAILED', '反馈候选回填失败。', payload)
    }
    return ok({
      scanned: Number(payload.scanned || 0),
      inserted: Number(payload.inserted || 0),
      updated: Number(payload.updated || 0),
      skipped: Number(payload.skipped || 0),
      sinceCreatedAt: typeof payload.sinceCreatedAt === 'number' ? payload.sinceCreatedAt : null,
    })
  })

  ipcMain.handle('modeling:createFeedbackRetrainingRun', async (_, input?: FeedbackRetrainingInput) => {
    const result = await createFeedbackRetrainingRun(input || { triggerType: 'manual' }) as Record<string, unknown>
    if (result.success !== true) {
      const reason = typeof result.reason === 'string' ? result.reason : 'unknown_error'
      const codeMap: Record<string, string> = {
        no_active_model: 'RETRAIN_ACTIVE_MODEL_MISSING',
        run_already_running: 'RETRAIN_ALREADY_RUNNING',
        dataset_create_failed: 'RETRAIN_DATASET_CREATE_FAILED',
        insufficient_samples: 'RETRAIN_INSUFFICIENT_SAMPLES',
        freeze_failed: 'RETRAIN_FREEZE_FAILED',
        feature_failed: 'RETRAIN_FEATURE_FAILED',
        train_failed: 'RETRAIN_TRAIN_FAILED',
        exception: 'RETRAIN_EXCEPTION',
      }
      return fail(codeMap[reason] || 'RETRAIN_TRIGGER_FAILED', `再训练触发失败：${reason}。`, result)
    }
    return ok({
      run: (result.run && typeof result.run === 'object') ? result.run as Record<string, unknown> : null,
      backfill: (result.backfill && typeof result.backfill === 'object') ? result.backfill as Record<string, unknown> : null,
      datasetId: typeof result.datasetId === 'string' ? result.datasetId : null,
      featureTaskId: typeof result.featureTaskId === 'string' ? result.featureTaskId : null,
      modelTaskId: typeof result.modelTaskId === 'string' ? result.modelTaskId : null,
      modelId: typeof result.modelId === 'string' ? result.modelId : null,
      activated: result.activated === true,
    })
  })

  ipcMain.handle('modeling:createIncrementalRetrainingRun', async (_, input?: FeedbackRetrainingInput) => {
    const database = getDb()
    const checkpoint = database.prepare(`
      SELECT MAX(finished_at) AS last_finished_at
      FROM retraining_runs
      WHERE status = 'succeeded' AND source = 'feedback'
    `).get() as { last_finished_at?: number } | undefined

    const fallbackSince = typeof checkpoint?.last_finished_at === 'number' && checkpoint.last_finished_at > 0
      ? checkpoint.last_finished_at
      : undefined
    const mergedInput: FeedbackRetrainingInput = {
      ...(input || {}),
      triggerType: input?.triggerType || 'sync_after',
      sinceCreatedAt: typeof input?.sinceCreatedAt === 'number' ? input.sinceCreatedAt : fallbackSince
    }
    const result = await createFeedbackRetrainingRun(mergedInput) as Record<string, unknown>
    if (result.success !== true) {
      const reason = typeof result.reason === 'string' ? result.reason : 'unknown_error'
      const codeMap: Record<string, string> = {
        no_active_model: 'RETRAIN_ACTIVE_MODEL_MISSING',
        run_already_running: 'RETRAIN_ALREADY_RUNNING',
        no_new_feedback: 'RETRAIN_NO_NEW_FEEDBACK',
        dataset_create_failed: 'RETRAIN_DATASET_CREATE_FAILED',
        insufficient_samples: 'RETRAIN_INSUFFICIENT_SAMPLES',
        freeze_failed: 'RETRAIN_FREEZE_FAILED',
        feature_failed: 'RETRAIN_FEATURE_FAILED',
        train_failed: 'RETRAIN_TRAIN_FAILED',
        exception: 'RETRAIN_EXCEPTION',
      }
      return fail(codeMap[reason] || 'RETRAIN_INCREMENTAL_FAILED', `增量再训练触发失败：${reason}。`, {
        ...result,
        sinceCreatedAt: mergedInput.sinceCreatedAt || null,
      })
    }
    return ok({
      run: (result.run && typeof result.run === 'object') ? result.run as Record<string, unknown> : null,
      backfill: (result.backfill && typeof result.backfill === 'object') ? result.backfill as Record<string, unknown> : null,
      datasetId: typeof result.datasetId === 'string' ? result.datasetId : null,
      featureTaskId: typeof result.featureTaskId === 'string' ? result.featureTaskId : null,
      modelTaskId: typeof result.modelTaskId === 'string' ? result.modelTaskId : null,
      modelId: typeof result.modelId === 'string' ? result.modelId : null,
      activated: result.activated === true,
      sinceCreatedAt: mergedInput.sinceCreatedAt || null,
    })
  })

  ipcMain.handle('modeling:listRetrainingRuns', async (_, limit?: number) => {
    const maxLimit = Math.min(200, Math.max(1, Number(limit || 50)))
    return getDb().prepare(`
      SELECT
        r.*,
        d.name AS dataset_name,
        m.name AS model_name
      FROM retraining_runs r
      LEFT JOIN dataset_versions d ON d.id = r.dataset_id
      LEFT JOIN model_versions m ON m.id = r.model_id
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(maxLimit)
  })

  ipcMain.handle('modeling:activateModel', async (_, modelId: string) => {
    const database = getDb()
    const now = Math.floor(Date.now() / 1000)
    database.prepare(`UPDATE model_versions SET status = 'inactive', activated_at = NULL WHERE status = 'active'`).run()
    const result = database.prepare(`
      UPDATE model_versions
      SET status = 'active', activated_at = ?
      WHERE id = ?
    `).run(now, modelId)
    if (result.changes <= 0) {
      return fail('MODEL_ACTIVATE_NOT_FOUND', '激活失败，未找到对应模型。', { modelId })
    }
    return ok({ modelId })
  })

  ipcMain.handle('modeling:renameModel', async (_, modelId: string, newName: string) => {
    const database = getDb()
    const nextName = String(newName || '').trim()
    if (!nextName) {
      return fail('MODEL_RENAME_INVALID', '模型名称不能为空。', { modelId })
    }
    const result = database.prepare('UPDATE model_versions SET name = ? WHERE id = ?').run(nextName, modelId)
    if (result.changes <= 0) {
      return fail('MODEL_RENAME_NOT_FOUND', '重命名失败，未找到对应模型。', { modelId })
    }
    return ok({ modelId, name: nextName })
  })

  ipcMain.handle('modeling:deactivateModel', async (_, modelId: string) => {
    const database = getDb()
    const result = database.prepare("UPDATE model_versions SET status = 'inactive', activated_at = NULL WHERE id = ? AND status = 'active'").run(modelId)
    if (result.changes <= 0) {
      return fail('MODEL_DEACTIVATE_NOT_ACTIVE', '停用失败，目标模型不是当前活跃模型。', { modelId })
    }
    return ok({ modelId })
  })

  ipcMain.handle('modeling:updateModelDescription', async (_, modelId: string, description: string) => {
    const database = getDb()
    const result = database.prepare('UPDATE model_versions SET description = ? WHERE id = ?').run(description, modelId)
    if (result.changes <= 0) {
      return fail('MODEL_DESCRIPTION_NOT_FOUND', '更新描述失败，未找到对应模型。', { modelId })
    }
    return ok({ modelId, description })
  })

  ipcMain.handle('modeling:deleteModel', async (_, modelId: string) => {
    const database = getDb()
    const model = database.prepare('SELECT status, artifact_path FROM model_versions WHERE id = ?').get(modelId) as { status: string; artifact_path: string } | undefined
    if (!model) return fail('MODEL_DELETE_NOT_FOUND', '未找到待删除的模型。', { modelId })
    if (model.status === 'active') return fail('MODEL_DELETE_ACTIVE', '当前激活模型不能删除，请先停用。', { modelId })

    // Cleanup artifact files
    const absPath = deps.resolveArtifactPath(model.artifact_path)
    if (absPath) {
      try { unlinkSync(absPath) } catch { /* ignore */ }
      // Try native model file (same dir, different extension)
      const dir = absPath.substring(0, absPath.lastIndexOf('/'))
      const base = absPath.replace(/\.json$/, '')
      for (const ext of ['.txt', '.cbm', '.eval.json', '.report.md', '.backtest.json']) {
        try { const p = base + ext; if (existsSync(p)) unlinkSync(p) } catch { /* ignore */ }
      }
      try { const p = dir + '/catboost_info'; if (existsSync(p)) { /* skip dir cleanup */ } } catch { /* ignore */ }
    }

    database.prepare('DELETE FROM signal_feedback WHERE signal_event_id IN (SELECT id FROM signal_events WHERE model_id = ?)').run(modelId)
    const signalResult = database.prepare('DELETE FROM signal_events WHERE model_id = ?').run(modelId)
    const recResult = database.prepare('DELETE FROM model_recommendations WHERE model_id = ?').run(modelId)
    const evalResult = database.prepare('DELETE FROM model_evaluations WHERE model_id = ?').run(modelId)
    database.prepare('DELETE FROM model_versions WHERE id = ?').run(modelId)
    return ok({
      modelId,
      deletedSignalEvents: signalResult.changes,
      deletedRecommendations: recResult.changes,
      deletedEvaluations: evalResult.changes,
    })
  })

  ipcMain.handle('modeling:runTask', async (_, taskType: string, params: Record<string, unknown>) => {
    log.info(`Running task ${taskType} with params:`, params)
    return {
      jobId: `job_${Date.now()}`,
      taskType,
      status: 'running',
      startedAt: new Date().toISOString()
    }
  })
}
