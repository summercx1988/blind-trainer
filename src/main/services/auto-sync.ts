import { BrowserWindow, Notification } from 'electron'
import log from '../logger'
import { getDb } from '../db'
import { marketDataService, type KlineInterval } from './market-data'

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const SYNC_HOUR = 15
const SYNC_MINUTE = 15

const WEEKDAYS = [1, 2, 3, 4, 5]

let timer: ReturnType<typeof setInterval> | null = null
let lastSyncAt: string | null = null
let syncing = false
let syncType: string = 'auto'
let syncError: string | null = null

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
  if (items.length === 0) return []
  const size = Math.max(1, Math.floor(chunkSize))
  const result: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size))
  }
  return result
}

const refreshStockKlineStatsForCodes = (codes: string[]) => {
  const normalizedCodes = Array.from(new Set(codes.map((code) => String(code || '').trim()).filter((code) => code.length > 0)))
  if (normalizedCodes.length === 0) return

  const db = getDb()
  const upsert = db.prepare(`
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

  const tx = db.transaction((targetCodes: string[]) => {
    for (const codeBatch of chunkArray(targetCodes, 240)) {
      const placeholders = codeBatch.map(() => '?').join(', ')

      const dailyRows = db.prepare(`
        SELECT code, COUNT(*) AS count, MAX(trade_date || ' 15:00') AS last_sync
        FROM kline_daily
        WHERE code IN (${placeholders})
        GROUP BY code
      `).all(...codeBatch) as Array<{ code: string; count: number; last_sync: string | null }>

      const m15Rows = db.prepare(`
        SELECT code, COUNT(*) AS count, MAX(trade_date || ' ' || trade_time) AS last_sync
        FROM kline_15m
        WHERE code IN (${placeholders})
        GROUP BY code
      `).all(...codeBatch) as Array<{ code: string; count: number; last_sync: string | null }>

      const m5Rows = db.prepare(`
        SELECT code, COUNT(*) AS count, MAX(trade_date || ' ' || trade_time) AS last_sync
        FROM kline_5m
        WHERE code IN (${placeholders})
        GROUP BY code
      `).all(...codeBatch) as Array<{ code: string; count: number; last_sync: string | null }>

      const dailyMap = new Map(dailyRows.map((row) => [row.code, row]))
      const m15Map = new Map(m15Rows.map((row) => [row.code, row]))
      const m5Map = new Map(m5Rows.map((row) => [row.code, row]))

      for (const code of codeBatch) {
        const daily = dailyMap.get(code)
        const m15 = m15Map.get(code)
        const m5 = m5Map.get(code)
        upsert.run(
          code,
          Number(daily?.count || 0),
          Number(m15?.count || 0),
          Number(m5?.count || 0),
          daily?.last_sync || null,
          m15?.last_sync || null,
          m5?.last_sync || null
        )
      }
    }
  })

  tx(normalizedCodes)
}

function isTradingDay(date: Date): boolean {
  return WEEKDAYS.includes(date.getDay())
}

function getNextSyncTime(now: Date): Date {
  const candidate = new Date(now)
  candidate.setHours(SYNC_HOUR, SYNC_MINUTE, 0, 0)

  let next = candidate
  if (next.getTime() <= now.getTime()) {
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000)
  }

  while (!isTradingDay(next)) {
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000)
  }

  return next
}

async function runIncrementalSync(type: string = 'auto'): Promise<void> {
  if (syncing) {
    log.info('[AutoSync] Already syncing, skipping.')
    return
  }
  syncing = true
  syncType = type
  syncError = null
  const startedAt = new Date().toISOString()
  log.info(`[AutoSync] Starting ${type} incremental sync at ${startedAt}`)

  try {
    await marketDataService.syncStockList()

    const db = getDb()
    const codes = db.prepare('SELECT code FROM stock_list ORDER BY code ASC').all() as { code: string }[]
    const codeList = codes.map((r) => r.code)

    const BATCH_SIZE = 50
    let dailySynced = 0
    let m15Synced = 0
    const touchedCodes: string[] = []

    for (let i = 0; i < codeList.length; i += BATCH_SIZE) {
      const batch = codeList.slice(i, i + BATCH_SIZE)

      const dailyResults = await marketDataService.batchSync(batch, '1d' as KlineInterval, 250)
      dailySynced += dailyResults.filter((r) => r.source === 'api').length

      const m15Results = await marketDataService.batchSync(batch, '15m' as KlineInterval, 250)
      m15Synced += m15Results.filter((r) => r.source === 'api').length
      touchedCodes.push(...batch)

      await new Promise((r) => setTimeout(r, 100))
    }

    refreshStockKlineStatsForCodes(touchedCodes)

    lastSyncAt = startedAt
    saveLastSyncTime(startedAt)

    log.info(`[AutoSync] Done: daily=${dailySynced} m15=${m15Synced} stocks=${codeList.length}`)

    notifySyncComplete(type, codeList.length, dailySynced, m15Synced)
  } catch (error) {
    syncError = error instanceof Error ? error.message : String(error)
    log.error('[AutoSync] Error:', error)
  } finally {
    syncing = false
  }
}

function saveLastSyncTime(iso: string): void {
  try {
    const db = getDb()
    db.prepare(`
      INSERT INTO dataset_policy_evaluations (id, mode, summary_json, created_at)
      VALUES ('auto_sync_meta', 'draft_preview', ?, strftime('%s','now'))
      ON CONFLICT(id) DO UPDATE SET summary_json = excluded.summary_json, created_at = excluded.created_at
    `).run(iso)
  } catch { /* ignore */ }
}

function loadLastSyncTime(): string | null {
  try {
    const db = getDb()
    const row = db.prepare("SELECT summary_json as value FROM dataset_policy_evaluations WHERE id = 'auto_sync_meta'").get() as { value?: string } | undefined
    return row?.value || null
  } catch {
    return null
  }
}

function checkAndSync(): void {
  const now = new Date()
  const today = new Date(now)
  today.setHours(SYNC_HOUR, SYNC_MINUTE, 0, 0)

  if (!isTradingDay(now)) return

  const withinWindow = now.getTime() >= today.getTime() &&
    now.getTime() < today.getTime() + CHECK_INTERVAL_MS

  if (!withinWindow) return

  if (lastSyncAt) {
    const lastDate = lastSyncAt.slice(0, 10)
    if (lastDate === now.toISOString().slice(0, 10)) return
  }

  void runIncrementalSync()
}

export function startAutoSync(): void {
  lastSyncAt = loadLastSyncTime()
  log.info(`[AutoSync] Started. Last sync: ${lastSyncAt || 'never'}`)
  checkAndSync()
  timer = setInterval(checkAndSync, CHECK_INTERVAL_MS)
}

export function stopAutoSync(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getAutoSyncStatus(): { lastSyncAt: string | null; nextSyncAt: string; syncing: boolean; syncType: string; syncError: string | null } {
  return {
    lastSyncAt,
    nextSyncAt: getNextSyncTime(new Date()).toISOString(),
    syncing,
    syncType,
    syncError,
  }
}

export { runIncrementalSync }

function notifySyncComplete(type: string, stocks: number, daily: number, m15: number): void {
  try {
    const label = type === 'manual_full' ? '全量增量更新' : type === 'manual_partial' ? '部分同步' : '自动同步'
    new Notification({
      title: `${label}完成`,
      body: `${stocks} 只股票 | 日线 ${daily} | 15m ${m15}`,
      silent: false,
    }).show()
  } catch { /* Notification not available */ }

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('data:syncComplete', { type, stocks, daily, m15 })
  }
}
