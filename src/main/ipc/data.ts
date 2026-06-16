import { ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import log from '../logger'
import { getDb } from '../db'
import { getBlindDb } from '../blindDb'
import { marketDataService, type KlineInterval } from '../services/market-data'
import { resolveMarketDbPath, saveMarketDbPathPreference, loadMarketCandles } from '../marketDb'
import { getAutoSyncStatus, runIncrementalSync } from '../services/auto-sync'
import { fail, ok } from './platformResult'

const resolveIndexDbPath = (): string | null => {
  const indexPath = join(app.getPath('userData'), 'index_data.db')
  try {
    if (existsSync(indexPath)) return indexPath
  } catch { /* ignore */ }
  return null
}

interface KlineDailyRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

interface KlineMinuteRow extends KlineDailyRow {
  time: string
}

interface NormalizedBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type RegimeType = 'uptrend' | 'downtrend' | 'sideways' | 'volatile'

const PERIOD_TO_INTERVAL: Record<string, KlineInterval> = {
  daily: '1d',
  '1d': '1d',
  '15m': '15m',
  '5m': '5m',
  '30m': '30m',
  '60m': '60m'
}

const toTimestamp = (date: string, time?: string): number => {
  const clean = date.replace(/[-/]/g, '')
  if (clean.length !== 8) return Date.now()
  const year = Number(clean.slice(0, 4))
  const month = Number(clean.slice(4, 6)) - 1
  const day = Number(clean.slice(6, 8))
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return Date.now()
  if (!time) return new Date(year, month, day, 15, 0, 0, 0).getTime()
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return new Date(year, month, day, 15, 0, 0, 0).getTime()
  return new Date(year, month, day, hour, minute, 0, 0).getTime()
}

const average = (values: number[]): number => {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const std = (values: number[]): number => {
  if (values.length < 2) return 0
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length
  return Math.sqrt(variance)
}

const normalizeRegime = (regime: string): RegimeType | 'mixed' => {
  const value = (regime || '').trim().toLowerCase()
  if (value === 'uptrend') return 'uptrend'
  if (value === 'downtrend') return 'downtrend'
  if (value === 'sideways') return 'sideways'
  if (value === 'volatile') return 'volatile'
  return 'mixed'
}

const classifyRegime = (bars: NormalizedBar[]): RegimeType => {
  if (bars.length < 40) return 'sideways'
  const closes = bars.map((bar) => Number(bar.close || 0)).filter((value) => Number.isFinite(value) && value > 0)
  if (closes.length < 40) return 'sideways'

  const last = closes[closes.length - 1] || 0
  const prev20 = closes[closes.length - 21] || closes[0] || 0
  const trendPct = prev20 > 0 ? (last / prev20 - 1) : 0

  const returns: number[] = []
  for (let index = 1; index < closes.length; index++) {
    const prev = closes[index - 1] || 0
    const current = closes[index] || 0
    if (prev <= 0 || current <= 0) continue
    returns.push(current / prev - 1)
  }
  const volatility = std(returns)
  const window = closes.slice(-40)
  const high = window.length > 0 ? Math.max(...window) : 0
  const low = window.length > 0 ? Math.min(...window) : 0
  const rangePct = low > 0 ? (high - low) / low : 0

  if (volatility >= 0.028 || rangePct >= 0.2) return 'volatile'
  if (trendPct >= 0.05) return 'uptrend'
  if (trendPct <= -0.05) return 'downtrend'
  return 'sideways'
}

const isValidBar = (bar: NormalizedBar): boolean => {
  if (!Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close)) return false
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) return false
  if (bar.high < bar.low) return false
  if (bar.high < Math.max(bar.open, bar.close)) return false
  if (bar.low > Math.min(bar.open, bar.close)) return false
  return true
}

const isHighQualityWindow = (bars: NormalizedBar[], warmupBars: number): boolean => {
  if (bars.length < 115) return false
  const validCount = bars.filter((bar) => isValidBar(bar)).length
  if (validCount < Math.floor(bars.length * 0.98)) return false

  const recent = bars.slice(Math.max(0, warmupBars - 20))
  const closes = recent.map((bar) => bar.close)
  const distinctCloseCount = new Set(closes.map((value) => value.toFixed(3))).size
  if (distinctCloseCount < Math.max(8, Math.floor(recent.length * 0.2))) return false

  const avgRangePct = average(
    recent.map((bar) => {
      if (bar.close <= 0) return 0
      return (bar.high - bar.low) / bar.close
    })
  )
  if (avgRangePct < 0.002) return false
  return true
}

const shouldKeepRegime = (target: RegimeType | 'mixed', actual: RegimeType): boolean => {
  if (target === 'mixed') return true
  return target === actual
}

const getCoverage = () => {
  const database = getDb()
  const stockRow = database.prepare('SELECT COUNT(*) AS count FROM stock_list').get() as { count: number }
  const dailyCodeRow = database.prepare(`
    SELECT COUNT(*) AS count
    FROM stock_list s
    WHERE EXISTS (SELECT 1 FROM kline_daily d WHERE d.code = s.code LIMIT 1)
  `).get() as { count: number }
  const m15CodeRow = database.prepare(`
    SELECT COUNT(*) AS count
    FROM stock_list s
    WHERE EXISTS (SELECT 1 FROM kline_15m m WHERE m.code = s.code LIMIT 1)
  `).get() as { count: number }
  const m5CodeRow = database.prepare(`
    SELECT COUNT(*) AS count
    FROM stock_list s
    WHERE EXISTS (SELECT 1 FROM kline_5m m WHERE m.code = s.code LIMIT 1)
  `).get() as { count: number }
  return {
    totalStocks: Number(stockRow.count || 0),
    dailyCoveredStocks: Number(dailyCodeRow.count || 0),
    m15CoveredStocks: Number(m15CodeRow.count || 0),
    m5CoveredStocks: Number(m5CodeRow.count || 0)
  }
}



const STOCK_LIST_DEFAULT_LIMIT = 600
const STOCK_LIST_MAX_LIMIT = 2000
const STOCK_STATS_BATCH_SIZE = 240

interface KlineAggRow {
  code: string
  count: number
  last_sync: string | null
}

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
  if (items.length === 0) return []
  const size = Math.max(1, Math.floor(chunkSize))
  const result: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size))
  }
  return result
}

const getKlineAggregateByCodes = (
  database: ReturnType<typeof getDb>,
  table: 'kline_daily' | 'kline_15m' | 'kline_5m',
  lastSyncExpr: string,
  codes: string[]
): Map<string, { count: number; lastSync: string | null }> => {
  const result = new Map<string, { count: number; lastSync: string | null }>()
  if (codes.length === 0) return result

  for (const codeBatch of chunkArray(codes, STOCK_STATS_BATCH_SIZE)) {
    const placeholders = codeBatch.map(() => '?').join(', ')
    const rows = database.prepare(`
      SELECT code, COUNT(*) AS count, MAX(${lastSyncExpr}) AS last_sync
      FROM ${table}
      WHERE code IN (${placeholders})
      GROUP BY code
    `).all(...codeBatch) as KlineAggRow[]
    for (const row of rows) {
      result.set(row.code, {
        count: Number(row.count || 0),
        lastSync: row.last_sync || null
      })
    }
  }

  return result
}

const refreshStockKlineStatsForCodes = (database: ReturnType<typeof getDb>, codes: string[]) => {
  const normalizedCodes = Array.from(new Set(codes.map((code) => String(code || '').trim()).filter((code) => code.length > 0)))
  if (normalizedCodes.length === 0) return

  const dailyAgg = getKlineAggregateByCodes(database, 'kline_daily', "trade_date || ' 15:00'", normalizedCodes)
  const m15Agg = getKlineAggregateByCodes(database, 'kline_15m', "trade_date || ' ' || trade_time", normalizedCodes)
  const m5Agg = getKlineAggregateByCodes(database, 'kline_5m', "trade_date || ' ' || trade_time", normalizedCodes)

  const upsert = database.prepare(`
    INSERT INTO stock_kline_stats (
      code, daily_count, m15_count, m5_count, last_daily, last_m15, last_m5, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(code) DO UPDATE SET
      daily_count = excluded.daily_count,
      m15_count = excluded.m15_count,
      m5_count = excluded.m5_count,
      last_daily = excluded.last_daily,
      last_m15 = excluded.last_m15,
      last_m5 = excluded.last_m5,
      updated_at = excluded.updated_at
  `)

  const tx = database.transaction((targetCodes: string[]) => {
    for (const code of targetCodes) {
      const daily = dailyAgg.get(code)
      const m15 = m15Agg.get(code)
      const m5 = m5Agg.get(code)
      upsert.run(
        code,
        daily?.count || 0,
        m15?.count || 0,
        m5?.count || 0,
        daily?.lastSync || null,
        m15?.lastSync || null,
        m5?.lastSync || null
      )
    }
  })

  tx(normalizedCodes)
}

const ensureStockKlineStatsForCodes = (database: ReturnType<typeof getDb>, codes: string[]) => {
  const normalizedCodes = Array.from(new Set(codes.map((code) => String(code || '').trim()).filter((code) => code.length > 0)))
  if (normalizedCodes.length === 0) return

  const existingCodes = new Set<string>()
  for (const codeBatch of chunkArray(normalizedCodes, STOCK_STATS_BATCH_SIZE)) {
    const placeholders = codeBatch.map(() => '?').join(', ')
    const rows = database.prepare(`SELECT code FROM stock_kline_stats WHERE code IN (${placeholders})`).all(...codeBatch) as Array<{ code: string }>
    for (const row of rows) {
      existingCodes.add(row.code)
    }
  }

  const missingCodes = normalizedCodes.filter((code) => !existingCodes.has(code))
  if (missingCodes.length > 0) {
    refreshStockKlineStatsForCodes(database, missingCodes)
  }
}

const rebuildStockKlineStats = (database: ReturnType<typeof getDb>) => {
  database.exec(`
    INSERT INTO stock_kline_stats (
      code, daily_count, m15_count, m5_count, last_daily, last_m15, last_m5, updated_at
    )
    SELECT
      s.code,
      COALESCE(d.daily_count, 0) AS daily_count,
      COALESCE(m15.m15_count, 0) AS m15_count,
      COALESCE(m5.m5_count, 0) AS m5_count,
      d.last_daily,
      m15.last_m15,
      m5.last_m5,
      strftime('%s','now') AS updated_at
    FROM stock_list s
    LEFT JOIN (
      SELECT code, COUNT(*) AS daily_count, MAX(trade_date || ' 15:00') AS last_daily
      FROM kline_daily
      GROUP BY code
    ) d ON d.code = s.code
    LEFT JOIN (
      SELECT code, COUNT(*) AS m15_count, MAX(trade_date || ' ' || trade_time) AS last_m15
      FROM kline_15m
      GROUP BY code
    ) m15 ON m15.code = s.code
    LEFT JOIN (
      SELECT code, COUNT(*) AS m5_count, MAX(trade_date || ' ' || trade_time) AS last_m5
      FROM kline_5m
      GROUP BY code
    ) m5 ON m5.code = s.code
    ON CONFLICT(code) DO UPDATE SET
      daily_count = excluded.daily_count,
      m15_count = excluded.m15_count,
      m5_count = excluded.m5_count,
      last_daily = excluded.last_daily,
      last_m15 = excluded.last_m15,
      last_m5 = excluded.last_m5,
      updated_at = excluded.updated_at
  `)
}

const readStockKlineStatsSummary = (database: ReturnType<typeof getDb>) => {
  const stocks = database.prepare('SELECT COUNT(*) as count FROM stock_list').get() as { count: number }
  const statsRow = database.prepare(`
    SELECT
      COALESCE(SUM(daily_count), 0) AS daily_count,
      COALESCE(SUM(m15_count), 0) AS m15_count,
      COALESCE(SUM(m5_count), 0) AS m5_count,
      SUM(CASE WHEN daily_count > 0 THEN 1 ELSE 0 END) AS daily_coverage,
      SUM(CASE WHEN m15_count > 0 THEN 1 ELSE 0 END) AS m15_coverage,
      SUM(CASE WHEN m5_count > 0 THEN 1 ELSE 0 END) AS m5_coverage
    FROM stock_kline_stats
  `).get() as { daily_count: number; m15_count: number; m5_count: number; daily_coverage: number; m15_coverage: number; m5_coverage: number }

  return {
    stockCount: Number(stocks.count || 0),
    dailyCount: Number(statsRow.daily_count || 0),
    m15Count: Number(statsRow.m15_count || 0),
    m5Count: Number(statsRow.m5_count || 0),
    dailyCoverage: Number(statsRow.daily_coverage || 0),
    m15Coverage: Number(statsRow.m15_coverage || 0),
    m5Coverage: Number(statsRow.m5_coverage || 0)
  }
}

export const registerDataIpc = () => {
  ipcMain.handle('data:init', async () => {
    try {
      const listResult = await marketDataService.syncStockList()
      const database = getDb()
      const codes = database.prepare('SELECT code FROM stock_list ORDER BY code ASC LIMIT 50').all() as { code: string }[]
      const dailyResults = await marketDataService.batchSync(
        codes.map((r) => r.code),
        '1d',
        250
      )
      return ok({
        stockList: listResult,
        dailySynced: dailyResults.filter((r) => r.source === 'api').length,
        dailyFailed: dailyResults.filter((r) => r.source === 'empty').length,
      })
    } catch (error) {
      return fail('DATA_INIT_FAILED', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('data:sync', async (_, count: number, periods: string[]) => {
    try {
      if (getAutoSyncStatus().syncing) {
        return fail('SYNC_IN_PROGRESS', '同步正在进行中，请稍后再试。')
      }
      const normalizedPeriods = Array.isArray(periods) && periods.length > 0 ? periods : ['daily', '15m']
      const database = getDb()
      const codes = database.prepare('SELECT code FROM stock_list ORDER BY RANDOM() LIMIT ?').all(Math.max(count || 30, 5)) as { code: string }[]

      const allResults: Record<string, unknown>[] = []
      const intervals: KlineInterval[] = normalizedPeriods
        .map((p) => PERIOD_TO_INTERVAL[p])
        .filter((v): v is KlineInterval => v !== undefined)

      for (const interval of intervals) {
        const results = await marketDataService.batchSync(
          codes.map((r) => r.code),
          interval,
          250
        )
        allResults.push(...results.map((r) => ({ ...r })))
      }

      const coverage = getCoverage()
      const syncAdvice: string[] = []
      if (normalizedPeriods.includes('15m') && coverage.m15CoveredStocks === 0) {
        syncAdvice.push('15m 数据仍为空，建议先执行一次"日线+15m"20只股票同步后再开始盲训分钟级样本。')
      }
      if (normalizedPeriods.includes('5m') && coverage.m5CoveredStocks === 0) {
        syncAdvice.push('5m 数据仍为空，建议改用指定代码单独补齐 5m，同步成功后再开启 5m 训练。')
      }

      const syncedFromApi = allResults.filter((r) => r.source === 'api').length
      const syncedFromCache = allResults.filter((r) => r.source === 'cache').length
      const syncedEmpty = allResults.filter((r) => r.source === 'empty').length

      return ok({
        syncedFromApi,
        syncedFromCache,
        syncedEmpty,
        totalResults: allResults.length,
        coverage,
        syncAdvice
      })
    } catch (error) {
      return fail('DATA_SYNC_FAILED', error instanceof Error ? error.message : 'unknown_error', {
        count,
        periods: Array.isArray(periods) ? periods : [],
      })
    }
  })

  ipcMain.handle('data:getKline', async (_, code: string, period: string, limit: number) => {
    const database = getDb()
    const table = period === '1d' ? 'kline_daily' : `kline_${period}`

    try {
      if (period === '1d') {
        return database.prepare(`
          SELECT trade_date as date, open, high, low, close, volume, amount
          FROM ${table} WHERE code = ?
          ORDER BY trade_date DESC LIMIT ?
        `).all(code, limit)
      }

      return database.prepare(`
        SELECT trade_date as date, trade_time as time, open, high, low, close, volume, amount
        FROM ${table} WHERE code = ?
        ORDER BY trade_date DESC, trade_time DESC LIMIT ?
      `).all(code, limit)
    } catch {
      return []
    }
  })

  ipcMain.handle('data:getRandomSamples', async (
    _,
    regime: string,
    period: string,
    count: number,
    options?: { maxBarsPerSymbol?: number; excludeRecent?: number; profileId?: string; candidateCount?: number; minPrice?: number }
  ) => {
    const database = getDb()
    const table = period === '1d' ? 'kline_daily' : `kline_${period}`
    const targetRegime = normalizeRegime(regime)
    const minHistoryBars = 50
    const minForwardBars = 65
    const minTotalBars = minHistoryBars + minForwardBars
    const requestedMaxBars = Number(options?.maxBarsPerSymbol || 260)
    const maxBarsPerSymbol = Math.max(minTotalBars + 20, Math.min(5000, Math.floor(requestedMaxBars)))
    const excludeRecent = Number(options?.excludeRecent || 0)
    const profileId = options?.profileId || 'default'
    const requestedCandidates = Number(options?.candidateCount || 80)
    const candidateLimit = Math.max(20, Math.min(2000, requestedCandidates))
    const minPrice = Number(options?.minPrice || 0)

    try {
      let excludeCodes: Set<string> = new Set()
      if (excludeRecent > 0) {
        const recentCodes = getBlindDb().prepare(`
          SELECT DISTINCT stock_code FROM training_sessions
          WHERE profile_id = ? AND finished_at IS NOT NULL
          ORDER BY started_at DESC LIMIT ?
        `).all(profileId, excludeRecent) as { stock_code: string }[]
        excludeCodes = new Set(recentCodes.map((r) => r.stock_code))
      }

      const fetchLimit = candidateLimit + excludeCodes.size
      const allCodes = database.prepare(`
        SELECT DISTINCT code FROM ${table}
        ORDER BY RANDOM() LIMIT ?
      `).all(fetchLimit) as { code: string }[]

      let codes = allCodes.filter((c) => !excludeCodes.has(c.code)).slice(0, candidateLimit)

      if (codes.length === 0 && period !== '1d') {
        const klineInterval = PERIOD_TO_INTERVAL[period]
        if (klineInterval) {
          const fallbackCodes = database.prepare('SELECT code FROM stock_list ORDER BY RANDOM() LIMIT 20').all() as { code: string }[]
          if (fallbackCodes.length > 0) {
            await marketDataService.batchSync(
              fallbackCodes.map((r) => r.code),
              klineInterval,
              250
            )
            codes = database.prepare(`
              SELECT DISTINCT code FROM ${table}
              ORDER BY RANDOM() LIMIT ?
            `).all(Math.max(count * 10, 20)) as { code: string }[]
          }
        }
      }

      const samples: Array<{
        id: string
        code: string
        name: string
        regime: string
        period: string
        warmupBars: number
        forwardBars: number
        actualDate: string
        totalAvailableBars: number
        klines: NormalizedBar[]
      }> = []

      for (const { code } of codes) {
        const stockInfo = database.prepare('SELECT name FROM stock_list WHERE code = ? LIMIT 1').get(code) as { name?: string } | undefined
        const stockName = stockInfo?.name || code

        const rows = period === '1d'
          ? (database.prepare(`
              SELECT trade_date as date, open, high, low, close, volume, amount
              FROM ${table} WHERE code = ?
              ORDER BY trade_date DESC LIMIT ?
            `).all(code, maxBarsPerSymbol) as KlineDailyRow[])
          : (database.prepare(`
              SELECT trade_date as date, trade_time as time, open, high, low, close, volume, amount
              FROM ${table} WHERE code = ?
              ORDER BY trade_date DESC, trade_time DESC LIMIT ?
            `).all(code, maxBarsPerSymbol) as KlineMinuteRow[])

        if (rows.length < minTotalBars) continue

        const ascendingRows = [...rows].reverse()
        const bars: NormalizedBar[] = ascendingRows.map((row) => {
          const maybeMinute = row as KlineMinuteRow
          return {
            timestamp: toTimestamp(row.date, maybeMinute.time),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume || 0)
          }
        })

        if (bars.length < minTotalBars) continue

        const minStartIndex = minHistoryBars
        const maxStartIndex = bars.length - minForwardBars
        if (maxStartIndex < minStartIndex) continue
        const preferredForwardBars = Math.max(
          minForwardBars,
          Math.min(
            Math.floor(maxBarsPerSymbol * 0.35),
            Math.max(minForwardBars + 60, Math.floor(bars.length * 0.28))
          )
        )
        const preferredMaxStartIndex = Math.max(minStartIndex, bars.length - preferredForwardBars)

        let acceptedSample: {
          warmupBars: number
          forwardBars: number
          actualDate: string
          klines: NormalizedBar[]
          regime: RegimeType
        } | null = null

        for (let attempt = 0; attempt < 6; attempt++) {
          const attemptMaxStartIndex = attempt < 4 ? preferredMaxStartIndex : maxStartIndex
          const startIndex = Math.floor(Math.random() * (attemptMaxStartIndex - minStartIndex + 1)) + minStartIndex
          const windowStart = Math.max(0, startIndex - minHistoryBars)
          const qualityWindowEnd = Math.min(bars.length, startIndex + minForwardBars)
          const qualityWindowBars = bars.slice(windowStart, qualityWindowEnd)
          const warmupBars = startIndex - windowStart
          const qualityForwardBars = qualityWindowBars.length - warmupBars

          if (qualityWindowBars.length < minTotalBars || warmupBars < minHistoryBars || qualityForwardBars < minForwardBars) continue
          if (!isHighQualityWindow(qualityWindowBars, warmupBars)) continue

          const fullWindowBars = bars.slice(windowStart)
          // Classify regime from the warmup-only segment to avoid looking into forward bars.
          const actualRegime = classifyRegime(qualityWindowBars.slice(0, warmupBars))
          if (!shouldKeepRegime(targetRegime, actualRegime)) continue

          const startBar = bars[startIndex]
          const actualDate = new Date(startBar.timestamp).toISOString().slice(0, 10)
          acceptedSample = {
            warmupBars,
            forwardBars: fullWindowBars.length - warmupBars,
            actualDate,
            klines: fullWindowBars,
            regime: actualRegime
          }
          break
        }

        if (!acceptedSample) continue

        if (minPrice > 0) {
          const priceCheckBar = acceptedSample.klines[acceptedSample.warmupBars]
          if (priceCheckBar && priceCheckBar.close < minPrice) continue
        }

        samples.push({
          id: `db_sample_${Date.now()}_${code}_${samples.length}`,
          code,
          name: stockName,
          regime: acceptedSample.regime,
          period,
          warmupBars: acceptedSample.warmupBars,
          forwardBars: acceptedSample.forwardBars,
          actualDate: acceptedSample.actualDate,
          totalAvailableBars: bars.length,
          klines: acceptedSample.klines
        })
        if (samples.length >= count) break
      }

      return samples
    } catch {
      return []
    }
  })

  ipcMain.handle('data:getStockList', async (_, limit: number) => {
    const database = getDb()
    const safeLimit = Math.max(10, Math.min(STOCK_LIST_MAX_LIMIT, Math.floor(Number(limit) || STOCK_LIST_DEFAULT_LIMIT)))
    const topCodes = database.prepare(`
      SELECT code
      FROM stock_list
      ORDER BY updated_at DESC, code ASC
      LIMIT ?
    `).all(safeLimit) as Array<{ code: string }>
    ensureStockKlineStatsForCodes(database, topCodes.map((item) => item.code))

    return database.prepare(`
      SELECT
        s.code,
        s.name,
        s.market,
        s.industry,
        s.list_date,
        s.updated_at,
        COALESCE(ss.daily_count, 0) AS daily_count,
        COALESCE(ss.m15_count, 0) AS m15_count,
        COALESCE(ss.m5_count, 0) AS m5_count,
        COALESCE(ss.m15_count, 0) + COALESCE(ss.m5_count, 0) AS minute_count,
        NULLIF(
          max(
            max(COALESCE(ss.last_daily, ''), COALESCE(ss.last_m15, '')),
            COALESCE(ss.last_m5, '')
          ),
          ''
        ) AS last_sync
      FROM stock_list s
      LEFT JOIN stock_kline_stats ss ON ss.code = s.code
      ORDER BY s.updated_at DESC, s.code ASC
      LIMIT ?
    `).all(safeLimit)
  })

  ipcMain.handle('data:getStats', async () => {
    const database = getDb()
    const stocks = database.prepare('SELECT COUNT(*) as count FROM stock_list').get() as { count: number }
    const statsMeta = database.prepare('SELECT COUNT(*) AS count FROM stock_kline_stats').get() as { count: number }
    if (Number(statsMeta.count || 0) < Number(stocks.count || 0)) {
      rebuildStockKlineStats(database)
    }
    return readStockKlineStatsSummary(database)
  })

  ipcMain.handle('data:rebuildStats', async () => {
    try {
      if (getAutoSyncStatus().syncing) {
        return fail('SYNC_IN_PROGRESS', '同步正在进行中，请稍后再试。')
      }
      const database = getDb()
      rebuildStockKlineStats(database)
      const summary = readStockKlineStatsSummary(database)
      const row = database.prepare('SELECT COUNT(*) AS count FROM stock_kline_stats').get() as { count: number }
      return ok({
        ...summary,
        statsRows: Number(row.count || 0),
      })
    } catch (error) {
      return fail('DATA_REBUILD_STATS_FAILED', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('data:syncKline5m', async (_, code: string) => {
    return marketDataService.syncKline(code, '5m', 250)
  })

  ipcMain.handle('data:syncStockList', async () => {
    return marketDataService.syncStockList()
  })

  ipcMain.handle('data:syncKline', async (_, code: string, interval: KlineInterval, limit: number) => {
    return marketDataService.syncKline(code, interval, limit)
  })

  ipcMain.handle('data:batchSync', async (_, codes: string[], interval: KlineInterval, limit: number) => {
    return marketDataService.batchSync(codes, interval, limit)
  })

  ipcMain.handle('data:getCandles', async (_, code: string, interval: KlineInterval, startDate?: string, endDate?: string) => {
    const usePrimary = interval === '1d'
    if (usePrimary) {
      const market = resolveMarketDbPath()
      if (market.exists) {
        try {
          return loadMarketCandles(market.path, code, interval, startDate, endDate)
        } catch {
          // fallback to marketDataService on transient path/format issues
        }
      }
    }
    const start = startDate ? new Date(startDate) : undefined
    const end = endDate ? new Date(endDate) : undefined
    return marketDataService.getCandles(code, interval, start, end)
  })

  ipcMain.handle('data:getMarketDbConfig', async () => {
    const market = resolveMarketDbPath()
    return {
      path: market.path,
      source: market.source,
      exists: market.exists,
    }
  })

  ipcMain.handle('data:setMarketDbConfig', async (_, dbPath: string) => {
    const saved = saveMarketDbPathPreference(String(dbPath || ''))
    return {
      path: saved.path,
      exists: saved.exists,
    }
  })

  ipcMain.handle('data:checkSufficiency', async (_, codes: string[]) => {
    const results: Record<string, { barCount: number; needsBackfill: boolean }> = {}
    for (const code of codes) {
      const barCount = marketDataService.getBarCount(code, '15m')
      results[code] = { barCount, needsBackfill: barCount < 1000 }
    }
    const needsBackfill = Object.entries(results).filter(([, v]) => v.needsBackfill).map(([k]) => k)
    return { results, needsBackfill, sufficientCount: codes.length - needsBackfill.length }
  })

  ipcMain.handle('data:backfill15m', async (_, codes: string[]) => {
    try {
      if (codes.length === 0) {
        return ok({ codesProcessed: 0 })
      }
      log.info(`[data] Starting 15m backfill for ${codes.length} codes:`, codes.slice(0, 5))
      const result = await marketDataService.runMinuteBackfill(codes, '15m')
      log.info(`[data] Baostock backfill result:`, result)
      if (!result.success) {
        return fail('DATA_BACKFILL_FAILED', result.error || '15m 数据补齐失败。', {
          requestedCodes: codes.length,
          codesProcessed: Number(result.codesProcessed || 0),
        })
      }
      return ok({ codesProcessed: Number(result.codesProcessed || 0) })
    } catch (error) {
      return fail('DATA_BACKFILL_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {
        requestedCodes: codes.length,
      })
    }
  })

  ipcMain.handle('data:inspectMissingCoverage', async () => {
    try {
      const summary = marketDataService.inspectMissingCoverage()
      return ok(summary)
    } catch (error) {
      return fail('DATA_INSPECT_MISSING_FAILED', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('data:executeBackfillPlan', async (_, plan?: {
    dailyCodes?: string[]
    m15Codes?: string[]
    m5Codes?: string[]
  }) => {
    try {
      if (getAutoSyncStatus().syncing) {
        return fail('SYNC_IN_PROGRESS', '同步正在进行中，请稍后再试。')
      }
      const execution = await marketDataService.executeBackfillPlan({
        dailyCodes: Array.isArray(plan?.dailyCodes) ? plan?.dailyCodes : [],
        m15Codes: Array.isArray(plan?.m15Codes) ? plan?.m15Codes : [],
        m5Codes: Array.isArray(plan?.m5Codes) ? plan?.m5Codes : [],
      })
      const database = getDb()
      rebuildStockKlineStats(database)
      const stats = readStockKlineStatsSummary(database)
      const coverage = marketDataService.inspectMissingCoverage()
      return ok({
        execution,
        stats,
        coverage,
      })
    } catch (error) {
      return fail('DATA_EXECUTE_BACKFILL_FAILED', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('data:triggerIncrementalSync', async () => {
    try {
      const status = getAutoSyncStatus()
      if (status.syncing) {
        return fail('SYNC_IN_PROGRESS', '增量同步正在进行中，请稍后再试。')
      }
      void runIncrementalSync('manual_full')
      return ok({ started: true })
    } catch (error) {
      return fail('INCREMENTAL_SYNC_FAILED', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('data:getAutoSyncStatus', async () => {
    return getAutoSyncStatus()
  })

  ipcMain.handle('data:getIndexKline', async (_, code: string, startDate?: string, endDate?: string) => {
    const indexDbPath = resolveIndexDbPath()
    if (!indexDbPath) return ok([])
    try {
      const indexDb = new Database(indexDbPath, { readonly: true })
      let sql = 'SELECT code, trade_date, open, high, low, close, volume, amount FROM index_daily WHERE code = ?'
      const params: string[] = [code]
      if (startDate) { sql += ' AND trade_date >= ?'; params.push(startDate) }
      if (endDate) { sql += ' AND trade_date <= ?'; params.push(endDate) }
      sql += ' ORDER BY trade_date ASC'
      const rows = indexDb.prepare(sql).all(...params)
      indexDb.close()
      return ok(rows)
    } catch {
      return ok([])
    }
  })

  ipcMain.handle('data:getIndexMeta', async () => {
    const indexDbPath = resolveIndexDbPath()
    if (!indexDbPath) return ok([])
    try {
      const indexDb = new Database(indexDbPath, { readonly: true })
      const rows = indexDb.prepare('SELECT code, name, bar_count, last_sync FROM index_meta ORDER BY code').all()
      indexDb.close()
      return ok(rows)
    } catch {
      return ok([])
    }
  })
}
