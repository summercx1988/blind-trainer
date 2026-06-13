import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { getDb, DB_PATH } from './db'

export type KlineInterval = '5m' | '15m' | '30m' | '60m' | '1d'

const MARKET_DB_PREF_KEY = 'market_db_path_v1'

const normalizePath = (input: string): string => {
  if (!input) return ''
  return path.resolve(path.normalize(input))
}

const resolveRepoMarketDb = (): string => {
  return normalizePath(path.join(process.cwd(), 'data', 'trading.db'))
}

export const resolveMarketDbPath = (): { path: string; source: string; exists: boolean } => {
  const envPathRaw = process.env.TRADING_MARKET_DB_PATH || process.env.MARKET_DB_PATH || ''
  const envPath = normalizePath(envPathRaw)
  if (envPath && fs.existsSync(envPath)) {
    return { path: envPath, source: 'env', exists: true }
  }

  try {
    const row = getDb()
      .prepare('SELECT value_json FROM app_preferences WHERE key = ? LIMIT 1')
      .get(MARKET_DB_PREF_KEY) as { value_json?: string } | undefined
    if (row?.value_json) {
      const parsed = JSON.parse(row.value_json) as { path?: string } | null
      const prefPath = normalizePath(String(parsed?.path || ''))
      if (prefPath && fs.existsSync(prefPath)) {
        return { path: prefPath, source: 'preference', exists: true }
      }
    }
  } catch {
    // ignore malformed preference rows and fallback to repo/main db.
  }

  const repoPath = resolveRepoMarketDb()
  if (repoPath && fs.existsSync(repoPath)) {
    return { path: repoPath, source: 'repo_default', exists: true }
  }

  return { path: DB_PATH, source: 'main_fallback', exists: fs.existsSync(DB_PATH) }
}

export const saveMarketDbPathPreference = (rawPath: string): { path: string; exists: boolean } => {
  const targetPath = normalizePath(rawPath || '')
  const now = Math.floor(Date.now() / 1000)
  getDb().prepare(`
    INSERT INTO app_preferences (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(MARKET_DB_PREF_KEY, JSON.stringify({ path: targetPath }), now)
  return { path: targetPath, exists: targetPath ? fs.existsSync(targetPath) : false }
}

export const loadMarketCandles = (
  dbPath: string,
  code: string,
  interval: KlineInterval,
  startDate?: string,
  endDate?: string,
): Array<Record<string, unknown>> => {
  const tableMap: Record<KlineInterval, string> = {
    '1d': 'kline_daily',
    '5m': 'kline_5m',
    '15m': 'kline_15m',
    '30m': 'kline_30m',
    '60m': 'kline_60m',
  }
  const table = tableMap[interval]
  if (!table) return []

  const conn = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const clauses: string[] = ['code = ?']
    const values: Array<string> = [code]
    if (startDate) {
      clauses.push('trade_date >= ?')
      values.push(startDate)
    }
    if (endDate) {
      clauses.push('trade_date <= ?')
      values.push(endDate)
    }
    const where = `WHERE ${clauses.join(' AND ')}`

    if (interval === '1d') {
      const rows = conn.prepare(`
        SELECT trade_date, open, high, low, close, volume
        FROM ${table}
        ${where}
        ORDER BY trade_date ASC
      `).all(...values) as Array<{
        trade_date: string
        open: number
        high: number
        low: number
        close: number
        volume: number | null
      }>
      return rows.map((row) => ({
        timestamp: `${row.trade_date}T15:00:00+08:00`,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume || 0,
      }))
    }

    const rows = conn.prepare(`
      SELECT trade_date, trade_time, open, high, low, close, volume
      FROM ${table}
      ${where}
      ORDER BY trade_date ASC, trade_time ASC
    `).all(...values) as Array<{
      trade_date: string
      trade_time: string
      open: number
      high: number
      low: number
      close: number
      volume: number | null
    }>
    return rows.map((row) => ({
      timestamp: `${row.trade_date}T${row.trade_time}:00+08:00`,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume || 0,
    }))
  } finally {
    conn.close()
  }
}

