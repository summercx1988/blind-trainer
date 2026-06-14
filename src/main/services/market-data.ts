import fs from 'fs/promises'
import path from 'path'
import log from '../logger'
import { getDb } from '../db'

export type KlineInterval = '5m' | '15m' | '30m' | '60m' | '1d'

export interface MarketCandle {
  stockCode: string
  timestamp: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

interface MarketCachePayload {
  stockCode: string
  interval: KlineInterval
  updatedAt: string
  candles: MarketCandle[]
}

export interface SyncResult {
  code: string
  interval: KlineInterval
  fetched: number
  merged: number
  written: number
  source: 'api' | 'cache' | 'empty'
}

export interface MissingCoverageBucket {
  interval: '1d' | '15m' | '5m'
  missingCodes: string[]
  staleCodes: string[]
  totalMissing: number
  totalStale: number
  sampleMissing: string[]
  sampleStale: string[]
}

export interface MissingCoverageSummary {
  scannedAt: string
  stockCount: number
  latestTradingDate: string | null
  latestMinuteCutoff: string | null
  intervals: Record<'1d' | '15m' | '5m', MissingCoverageBucket>
}

export interface BackfillExecutionSummary {
  requested: number
  processed: number
  failed: number
  interval: '1d' | '15m' | '5m'
  insertedRows: number
  codes: string[]
}

const COVERAGE_SAMPLE_LIMIT = 12

const API_ENDPOINTS = {
  SINA_STOCK_LIST: 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData',
  SINA_KLINE: 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData',
  TENCENT_KLINE: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
} as const

let _cacheDir: string | null = null
const getCacheDir = (): string => {
  if (_cacheDir) return _cacheDir
  try {
    const { app } = require('electron')
    _cacheDir = path.join(app.getPath('userData'), 'data', 'market')
  } catch {
    _cacheDir = path.join(process.cwd(), 'data', 'market')
  }
  return _cacheDir
}

const INTERVAL_TO_TABLE: Record<KlineInterval, string> = {
  '1d': 'kline_daily',
  '5m': 'kline_5m',
  '15m': 'kline_15m',
  '30m': 'kline_30m',
  '60m': 'kline_60m'
}

const SINA_SCALE_MAP: Record<KlineInterval, string> = {
  '1d': '240',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '60m': '60'
}

const exchangePrefixCache = new Map<string, 'sh' | 'sz' | 'bj'>()

const fetchWithTimeout = async (url: string, timeoutMs: number = 8000): Promise<Response> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json,text/plain,*/*' }
    })
  } finally {
    clearTimeout(timeout)
  }
}

const inferExchangePrefix = (code: string): 'sh' | 'sz' | 'bj' => {
  const c = String(code || '').trim()
  if (c.startsWith('92') || c.startsWith('8') || c.startsWith('4')) return 'bj'
  if (c.startsWith('6') || c.startsWith('5') || (c.startsWith('9') && !c.startsWith('92'))) return 'sh'
  return 'sz'
}

const getExchangePrefix = (code: string): 'sh' | 'sz' | 'bj' => {
  const c = String(code || '').trim()
  if (!c) return 'sz'

  const cached = exchangePrefixCache.get(c)
  if (cached) return cached

  try {
    const db = getDb()
    const row = db.prepare('SELECT market FROM stock_list WHERE code = ? LIMIT 1').get(c) as { market?: string } | undefined
    const market = String(row?.market || '').trim().toUpperCase()
    if (market === 'SH' || market === 'SZ' || market === 'BJ') {
      const prefix = market.toLowerCase() as 'sh' | 'sz' | 'bj'
      exchangePrefixCache.set(c, prefix)
      return prefix
    }
  } catch {
    // Fall back to prefix inference if the database is not ready yet.
  }

  const inferred = inferExchangePrefix(c)
  exchangePrefixCache.set(c, inferred)
  return inferred
}

const sinaSymbol = (code: string): string => {
  const c = String(code || '').trim()
  return `${getExchangePrefix(c)}${c}`
}

const tencentSymbol = (code: string): string => {
  const c = String(code || '').trim()
  return `${getExchangePrefix(c)}${c}`
}

const normalizeCodes = (codes: string[]): string[] => {
  return Array.from(new Set(
    codes
      .map((code) => String(code || '').trim())
      .filter((code) => /^\d{6}$/.test(code))
  )).sort()
}

export class MarketDataService {
  private readonly cacheDir: string

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || getCacheDir()
  }

  async getCandles(
    stockCode: string,
    interval: KlineInterval,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandle[]> {
    const cached = await this.readCache(stockCode, interval)
    let merged = cached

    try {
      const fetched = await this.fetchKline(stockCode, interval, 250)
      if (fetched.length > 0) {
        merged = this.mergeCandles(cached, fetched)
        await this.writeCache(stockCode, interval, merged)
        this.writeToSqlite(stockCode, interval, fetched)
      }
    } catch (error) {
      log.warn('[MarketDataService] API fetch failed, fallback to cache:', error)
    }

    // 始终合并 SQLite 历史数据，避免仅用缓存/最近抓取导致长跨度K线缺失。
    const sqliteCandles = await this.readFromSqlite(stockCode, interval)
    if (sqliteCandles.length > 0) {
      merged = this.mergeCandles(sqliteCandles, merged)
    } else if (merged.length === 0) {
      merged = sqliteCandles
    }

    return this.filterRange(merged, startDate, endDate)
  }

  async syncStockList(): Promise<{ synced: number; failed: number }> {
    const allStocks: Array<{ code: string; name: string; market: string }> = []
    let page = 1
    const pageSize = 80

    while (true) {
      try {
        const url = `${API_ENDPOINTS.SINA_STOCK_LIST}?page=${page}&num=${pageSize}&sort=changepercent&asc=0&node=hs_a`
        const response = await fetchWithTimeout(url, 10000)
        const text = await response.text()
        let items: Array<Record<string, string>> = []
        try {
          items = JSON.parse(text)
        } catch {
          break
        }
        if (!Array.isArray(items) || items.length === 0) break

        for (const item of items) {
          const code = String(item.code || '').trim()
          const name = String(item.name || '').trim()
          const symbol = String(item.symbol || '').trim()
          if (!code || !name || !/^\d{6}$/.test(code)) continue
          const market = symbol.startsWith('sh') ? 'SH' : symbol.startsWith('sz') ? 'SZ' : symbol.startsWith('bj') ? 'BJ' : ''
          allStocks.push({ code, name, market })
        }

        if (items.length < pageSize) break
        page++
        await new Promise((r) => setTimeout(r, 100))
      } catch (error) {
        log.warn(`[MarketDataService] syncStockList page ${page} failed:`, error)
        break
      }
    }

    if (allStocks.length === 0) {
      log.error('[MarketDataService] syncStockList: no stocks fetched')
      return { synced: 0, failed: -1 }
    }

    const db = getDb()
    const upsert = db.prepare(`
      INSERT INTO stock_list (code, name, market, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'))
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, market=excluded.market, updated_at=strftime('%s','now')
    `)

    let synced = 0
    let failed = 0
    const tx = db.transaction(() => {
      for (const stock of allStocks) {
        try {
          upsert.run(stock.code, stock.name, stock.market)
          synced++
        } catch {
          failed++
        }
      }
    })
    tx()

    log.info(`[MarketDataService] syncStockList done: ${synced} synced, ${failed} failed, ${allStocks.length} total`)
    return { synced, failed }
  }

  async syncKline(
    stockCode: string,
    interval: KlineInterval,
    limit: number = 250
  ): Promise<SyncResult> {
    const cached = await this.readCache(stockCode, interval)
    let merged = cached
    let fetchedCount = 0
    let source: SyncResult['source'] = 'empty'

    try {
      const fetched = await this.fetchKline(stockCode, interval, limit)
      fetchedCount = fetched.length
      if (fetched.length > 0) {
        merged = this.mergeCandles(cached, fetched)
        await this.writeCache(stockCode, interval, merged)
        this.writeToSqlite(stockCode, interval, fetched)
        source = 'api'
      } else if (cached.length > 0) {
        source = 'cache'
      }
    } catch (error) {
      log.warn(`[MarketDataService] syncKline ${stockCode} ${interval} failed:`, error)
      if (cached.length > 0) source = 'cache'
    }

    if (merged.length === 0) {
      merged = await this.readFromSqlite(stockCode, interval)
      if (merged.length > 0) source = 'cache'
    }

    return { code: stockCode, interval, fetched: fetchedCount, merged: merged.length, written: fetchedCount, source }
  }

  async batchSync(codes: string[], interval: KlineInterval, limit: number = 250): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    for (const code of codes) {
      const result = await this.syncKline(code, interval, limit)
      results.push(result)
      await new Promise((r) => setTimeout(r, 150))
    }
    return results
  }

  private async fetchKline(stockCode: string, interval: KlineInterval, dataLen: number): Promise<MarketCandle[]> {
    try {
      return await this.fetchKlineSina(stockCode, interval, dataLen)
    } catch {
      log.warn(`[MarketDataService] Sina failed for ${stockCode}, trying Tencent...`)
    }
    try {
      return await this.fetchKlineTencent(stockCode, interval, dataLen)
    } catch {
      log.warn(`[MarketDataService] Tencent also failed for ${stockCode}`)
      return []
    }
  }

  private async fetchKlineSina(stockCode: string, interval: KlineInterval, dataLen: number): Promise<MarketCandle[]> {
    const symbol = sinaSymbol(stockCode)
    const scale = SINA_SCALE_MAP[interval]
    const url = `${API_ENDPOINTS.SINA_KLINE}?symbol=${symbol}&scale=${scale}&ma=no&datalen=${dataLen}`

    const response = await fetchWithTimeout(url, 8000)
    if (!response.ok) throw new Error(`Sina API ${response.status}`)
    const text = await response.text()
    let items: Array<Record<string, string>>
    try {
      items = JSON.parse(text)
    } catch {
      throw new Error('Sina API returned non-JSON')
    }
    if (!Array.isArray(items)) return []

    return items
      .map((item) => {
        const day = String(item.day || item.d || '').trim()
        if (!day) return null
        const open = Number(item.open)
        const close = Number(item.close || item.price)
        const high = Number(item.high)
        const low = Number(item.low)
        const volume = Number(item.volume)
        if (![open, close, high, low, volume].every((v) => Number.isFinite(v) && v > 0)) return null

        let timestamp: string
        if (interval === '1d') {
          timestamp = day.length <= 10 ? `${day}T15:00:00+08:00` : `${day}+08:00`
        } else {
          if (day.includes(' ') || day.includes('T')) {
            timestamp = day.includes('T') ? `${day}+08:00` : `${day.replace(' ', 'T')}+08:00`
          } else {
            timestamp = `${day}T15:00:00+08:00`
          }
        }

        return { stockCode, timestamp, open, close, high, low, volume } as MarketCandle
      })
      .filter((item): item is MarketCandle => item !== null)
  }

  private async fetchKlineTencent(stockCode: string, interval: KlineInterval, dataLen: number): Promise<MarketCandle[]> {
    const symbol = tencentSymbol(stockCode)
    const type = interval === '1d' ? 'day' : interval === '60m' ? 'm60' : interval === '30m' ? 'm30' : interval === '15m' ? 'm15' : 'm5'
    const url = `${API_ENDPOINTS.TENCENT_KLINE}?param=${symbol},${type},,,${dataLen},qfq`

    const response = await fetchWithTimeout(url, 8000)
    if (!response.ok) throw new Error(`Tencent API ${response.status}`)
    const json = await response.json() as { code: number; data?: Record<string, { qfqday?: string[][]; day?: string[][] }> }
    if (json.code !== 0 || !json.data) return []

    const stockData = json.data[symbol] || json.data[Object.keys(json.data)[0]]
    if (!stockData) return []
    const rows = stockData.qfqday || stockData.day || []
    if (!Array.isArray(rows)) return []

    return rows
      .map((row) => {
        if (!Array.isArray(row) || row.length < 6) return null
        const date = String(row[0]).trim()
        const open = Number(row[1])
        const close = Number(row[2])
        const high = Number(row[3])
        const low = Number(row[4])
        const volume = Number(row[5]) * 100
        if (![open, close, high, low].every((v) => Number.isFinite(v) && v > 0)) return null

        let timestamp: string
        if (interval === '1d') {
          timestamp = date.length <= 10 ? `${date}T15:00:00+08:00` : `${date}+08:00`
        } else {
          if (date.includes(' ') || date.includes('T')) {
            timestamp = date.includes('T') ? `${date}+08:00` : `${date.replace(' ', 'T')}+08:00`
          } else {
            timestamp = `${date}T15:00:00+08:00`
          }
        }

        return { stockCode, timestamp, open, close, high, low, volume } as MarketCandle
      })
      .filter((item): item is MarketCandle => item !== null)
  }

  private cacheFile(stockCode: string, interval: KlineInterval): string {
    return path.join(this.cacheDir, `${stockCode}_${interval}.json`)
  }

  private async readCache(stockCode: string, interval: KlineInterval): Promise<MarketCandle[]> {
    try {
      const filePath = this.cacheFile(stockCode, interval)
      const content = await fs.readFile(filePath, 'utf-8')
      const payload = JSON.parse(content) as MarketCachePayload
      return payload.candles || []
    } catch {
      return []
    }
  }

  private async writeCache(stockCode: string, interval: KlineInterval, candles: MarketCandle[]): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true })
    const filePath = this.cacheFile(stockCode, interval)
    const payload: MarketCachePayload = { stockCode, interval, updatedAt: new Date().toISOString(), candles }
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
  }

  private writeToSqlite(stockCode: string, interval: KlineInterval, candles: MarketCandle[]): void {
    const table = INTERVAL_TO_TABLE[interval]
    if (!table) return

    try {
      const db = getDb()

      if (interval === '1d') {
        const upsert = db.prepare(`
          INSERT INTO ${table} (code, trade_date, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(code, trade_date) DO UPDATE SET
            open=excluded.open, high=excluded.high, low=excluded.low,
            close=excluded.close, volume=excluded.volume
        `)
        const tx = db.transaction(() => {
          for (const c of candles) {
            const date = c.timestamp.slice(0, 10)
            upsert.run(stockCode, date, c.open, c.high, c.low, c.close, c.volume)
          }
        })
        tx()
      } else {
        this.ensureMinuteTable(table)
        const upsert = db.prepare(`
          INSERT INTO ${table} (code, trade_date, trade_time, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(code, trade_date, trade_time) DO UPDATE SET
            open=excluded.open, high=excluded.high, low=excluded.low,
            close=excluded.close, volume=excluded.volume
        `)
        const tx = db.transaction(() => {
          for (const c of candles) {
            const date = c.timestamp.slice(0, 10)
            const ts = new Date(c.timestamp)
            const time = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
            upsert.run(stockCode, date, time, c.open, c.high, c.low, c.close, c.volume)
          }
        })
        tx()
      }

      const stockUpsert = db.prepare(`
        INSERT INTO stock_list (code, name, market, updated_at)
        VALUES (?, ?, ?, strftime('%s','now'))
        ON CONFLICT(code) DO UPDATE SET updated_at=strftime('%s','now')
      `)
      stockUpsert.run(stockCode, stockCode, '')
      this.refreshStockKlineStatsForCode(stockCode)
    } catch (error) {
      log.warn(`[MarketDataService] writeToSqlite ${stockCode} ${interval} failed:`, error)
    }
  }

  private refreshStockKlineStatsForCode(stockCode: string): void {
    const code = String(stockCode || '').trim()
    if (!code) return
    try {
      const db = getDb()
      const daily = db.prepare(`
        SELECT COUNT(*) AS count, MAX(trade_date || ' 15:00') AS last_sync
        FROM kline_daily
        WHERE code = ?
      `).get(code) as { count?: number; last_sync?: string | null }
      const m15 = db.prepare(`
        SELECT COUNT(*) AS count, MAX(trade_date || ' ' || trade_time) AS last_sync
        FROM kline_15m
        WHERE code = ?
      `).get(code) as { count?: number; last_sync?: string | null }
      const m5 = db.prepare(`
        SELECT COUNT(*) AS count, MAX(trade_date || ' ' || trade_time) AS last_sync
        FROM kline_5m
        WHERE code = ?
      `).get(code) as { count?: number; last_sync?: string | null }

      db.prepare(`
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
      `).run(
        code,
        Number(daily.count || 0),
        Number(m15.count || 0),
        Number(m5.count || 0),
        daily.last_sync || null,
        m15.last_sync || null,
        m5.last_sync || null
      )
    } catch (error) {
      log.warn(`[MarketDataService] refreshStockKlineStatsForCode ${code} failed:`, error)
    }
  }

  private ensureMinuteTable(table: string): void {
    const db = getDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        trade_time TEXT NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL,
        amount REAL,
        UNIQUE(code, trade_date, trade_time)
      )
    `)
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_code_date ON ${table}(code, trade_date)`)
    } catch { /* index may already exist */ }
  }

  private async readFromSqlite(stockCode: string, interval: KlineInterval): Promise<MarketCandle[]> {
    const table = INTERVAL_TO_TABLE[interval]
    if (!table) return []

    try {
      const db = getDb()
      if (interval === '1d') {
        const rows = db.prepare(`
          SELECT trade_date, open, high, low, close, volume
          FROM ${table} WHERE code = ?
          ORDER BY trade_date ASC
        `).all(stockCode) as Array<{ trade_date: string; open: number; high: number; low: number; close: number; volume: number | null }>

        return rows.map((row) => ({
          stockCode,
          timestamp: `${row.trade_date}T15:00:00+08:00`,
          open: row.open, close: row.close, high: row.high, low: row.low,
          volume: row.volume || 0
        }))
      }

      const rows = db.prepare(`
        SELECT trade_date, trade_time, open, high, low, close, volume
        FROM ${table} WHERE code = ?
        ORDER BY trade_date ASC, trade_time ASC
      `).all(stockCode) as Array<{ trade_date: string; trade_time: string; open: number; high: number; low: number; close: number; volume: number | null }>

      return rows.map((row) => ({
        stockCode,
        timestamp: `${row.trade_date}T${row.trade_time}:00+08:00`,
        open: row.open, close: row.close, high: row.high, low: row.low,
        volume: row.volume || 0
      }))
    } catch {
      return []
    }
  }

  private mergeCandles(base: MarketCandle[], incoming: MarketCandle[]): MarketCandle[] {
    const map = new Map<string, MarketCandle>()
    for (const candle of base) { map.set(candle.timestamp, candle) }
    for (const candle of incoming) { map.set(candle.timestamp, candle) }
    return Array.from(map.values()).sort((left, right) => {
      return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    })
  }

  private filterRange(candles: MarketCandle[], startDate?: Date, endDate?: Date): MarketCandle[] {
    if (!startDate && !endDate) return candles
    return candles.filter((candle) => {
      const time = new Date(candle.timestamp).getTime()
      if (!Number.isFinite(time)) return false
      if (startDate && time < startDate.getTime()) return false
      if (endDate && time > endDate.getTime()) return false
      return true
    })
  }

  getBarCount(stockCode: string, interval: KlineInterval): number {
    const table = INTERVAL_TO_TABLE[interval]
    if (!table) return 0
    try {
      const db = getDb()
      const row = db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE code = ?`).get(stockCode) as { count: number } | undefined
      return Number(row?.count || 0)
    } catch {
      return 0
    }
  }

  needsBackfill(stockCode: string): boolean {
    return this.getBarCount(stockCode, '15m') < 1000
  }

  inspectMissingCoverage(): MissingCoverageSummary {
    const db = getDb()
    const scannedAt = new Date().toISOString()
    const stockCountRow = db.prepare('SELECT COUNT(*) AS count FROM stock_list').get() as { count?: number } | undefined
    const latestDailyRow = db.prepare('SELECT MAX(trade_date) AS value FROM kline_daily').get() as { value?: string | null } | undefined
    const latestMinuteRow = db.prepare(`
      SELECT MAX(trade_date || ' ' || trade_time) AS value
      FROM kline_15m
    `).get() as { value?: string | null } | undefined

    const latestTradingDate = latestDailyRow?.value || null
    const latestMinuteCutoff = latestMinuteRow?.value || null

    const allCodes = (db.prepare('SELECT code FROM stock_list ORDER BY code ASC').all() as Array<{ code: string }>)
      .map((row) => row.code)

    const buildBucket = (
      interval: '1d' | '15m' | '5m',
      table: string,
      lastExpr: string,
      staleThreshold: string | null
    ): MissingCoverageBucket => {
      const codeRows = db.prepare(`SELECT DISTINCT code FROM ${table}`).all() as Array<{ code: string }>
      const existing = new Set(codeRows.map((row) => String(row.code || '').trim()).filter(Boolean))
      const missingCodes = allCodes.filter((code) => !existing.has(code))

      let staleCodes: string[] = []
      if (staleThreshold) {
        const rows = db.prepare(`
          SELECT code
          FROM (
            SELECT code, MAX(${lastExpr}) AS last_value
            FROM ${table}
            GROUP BY code
          )
          WHERE COALESCE(last_value, '') < ?
          ORDER BY code ASC
        `).all(staleThreshold) as Array<{ code: string }>
        staleCodes = rows.map((row) => String(row.code || '').trim()).filter((code) => code && !missingCodes.includes(code))
      }

      return {
        interval,
        missingCodes,
        staleCodes,
        totalMissing: missingCodes.length,
        totalStale: staleCodes.length,
        sampleMissing: missingCodes.slice(0, COVERAGE_SAMPLE_LIMIT),
        sampleStale: staleCodes.slice(0, COVERAGE_SAMPLE_LIMIT),
      }
    }

    return {
      scannedAt,
      stockCount: Number(stockCountRow?.count || 0),
      latestTradingDate,
      latestMinuteCutoff,
      intervals: {
        '1d': buildBucket('1d', 'kline_daily', 'trade_date', latestTradingDate),
        '15m': buildBucket('15m', 'kline_15m', "trade_date || ' ' || trade_time", latestMinuteCutoff),
        '5m': buildBucket('5m', 'kline_5m', "trade_date || ' ' || trade_time", latestMinuteCutoff),
      }
    }
  }

  async runMinuteBackfill(
    codes: string[],
    period: '5m' | '15m'
  ): Promise<{ success: boolean; codesProcessed: number; insertedRows: number; failedCodes: string[]; error?: string }> {
    try {
      const { spawn } = await import('child_process')
      const pathModule = await import('path')
      const { existsSync } = await import('fs')
      const normalizedCodes = normalizeCodes(codes)

      if (normalizedCodes.length === 0) {
        return { success: true, codesProcessed: 0, insertedRows: 0, failedCodes: [] }
      }

      const workspace = [
        pathModule.join(process.cwd(), 'scripts'),
        pathModule.join(__dirname, '../../../scripts'),
        pathModule.join(__dirname, '../../scripts'),
        pathModule.join(process.cwd(), 'scripts'),
      ].find(p => existsSync(pathModule.join(p, 'sync_missing_minute.py')))

      if (!workspace) {
        return { success: false, codesProcessed: 0, insertedRows: 0, failedCodes: normalizedCodes, error: 'scripts directory not found' }
      }

      const args = [
        'sync_missing_minute.py',
        '--db', 'auto',
        '--period', period.replace('m', ''),
        '--codes', normalizedCodes.join(','),
        '--quiet'
      ]

      return await new Promise((resolve) => {
        const proc = spawn('python3', args, { cwd: workspace })
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
        proc.on('error', (err) => resolve({ success: false, codesProcessed: 0, insertedRows: 0, failedCodes: normalizedCodes, error: err.message }))
        proc.on('close', (code) => {
          const processedMatch = stdout.match(/processed=(\d+)/)
          const insertedMatch = stdout.match(/inserted_rows=(\d+)/)
          const failedMatch = stdout.match(/errors=(\d+)/)
          const processed = processedMatch ? Number(processedMatch[1]) : normalizedCodes.length
          const insertedRows = insertedMatch ? Number(insertedMatch[1]) : 0
          const failed = failedMatch ? Number(failedMatch[1]) : 0
          if (code === 0) {
            resolve({
              success: true,
              codesProcessed: processed,
              insertedRows,
              failedCodes: failed > 0 ? normalizedCodes.slice(Math.max(0, normalizedCodes.length - failed)) : []
            })
          } else {
            resolve({
              success: false,
              codesProcessed: processed,
              insertedRows,
              failedCodes: normalizedCodes,
              error: (stderr || stdout).slice(-800)
            })
          }
        })
      })
    } catch (error) {
      return { success: false, codesProcessed: 0, insertedRows: 0, failedCodes: normalizeCodes(codes), error: error instanceof Error ? error.message : 'unknown_error' }
    }
  }

  async executeBackfillPlan(input: { dailyCodes?: string[]; m15Codes?: string[]; m5Codes?: string[] }): Promise<{
    daily: BackfillExecutionSummary
    m15: BackfillExecutionSummary
    m5: BackfillExecutionSummary
  }> {
    const dailyCodes = normalizeCodes(input.dailyCodes || [])
    const m15Codes = normalizeCodes(input.m15Codes || [])
    const m5Codes = normalizeCodes(input.m5Codes || [])

    let dailyInsertedRows = 0
    const dailyFailedCodes: string[] = []
    for (const code of dailyCodes) {
      const before = this.getBarCount(code, '1d')
      const result = await this.syncKline(code, '1d', 2500)
      const after = this.getBarCount(code, '1d')
      dailyInsertedRows += Math.max(0, after - before)
      if (result.source === 'empty' && after <= before) {
        dailyFailedCodes.push(code)
      }
    }

    const m15Result = await this.runMinuteBackfill(m15Codes, '15m')
    const m5Result = await this.runMinuteBackfill(m5Codes, '5m')

    return {
      daily: {
        requested: dailyCodes.length,
        processed: dailyCodes.length,
        failed: dailyFailedCodes.length,
        interval: '1d',
        insertedRows: dailyInsertedRows,
        codes: dailyCodes,
      },
      m15: {
        requested: m15Codes.length,
        processed: Number(m15Result.codesProcessed || 0),
        failed: Number(m15Result.failedCodes?.length || 0),
        interval: '15m',
        insertedRows: Number(m15Result.insertedRows || 0),
        codes: m15Codes,
      },
      m5: {
        requested: m5Codes.length,
        processed: Number(m5Result.codesProcessed || 0),
        failed: Number(m5Result.failedCodes?.length || 0),
        interval: '5m',
        insertedRows: Number(m5Result.insertedRows || 0),
        codes: m5Codes,
      }
    }
  }
}

export const marketDataService = new MarketDataService()
