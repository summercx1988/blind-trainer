import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { saveSnapshot, loadSnapshot } from './idb'
import { calculateSessionReviewMetrics } from '../main/sessionReview'
import type {
  SessionActionRecord,
  SessionReview,
  SessionSummary,
  SaveTradeActionInput,
  SaveTradeActionResult,
  FinishSessionContext,
  TrainingProfileRecord,
  ProfileStats,
} from '../types/ipc'

const IDB_NAME = 'blind-trainer'
const IDB_STORE = 'db-snapshots'
const IDB_KEY = 'blind-db'

let SQL: SqlJsStatic | null = null
let blindDb: Database | null = null

export interface BlindInitOptions {
  forceRefresh?: boolean
  locateFile?: (file: string) => string
}

export interface SaveSessionInput {
  id: string
  sample_id: string
  stock_code: string
  stock_name: string
  interval_type: string
  started_at: number
  initial_capital: number
  created_at: number
  profile_id: string
}

export async function initBlindDb(options: BlindInitOptions = {}): Promise<void> {
  const { forceRefresh = false, locateFile = (file: string) => (file.endsWith('.wasm') ? wasmUrl : `/${file}`) } = options

  if (!SQL) {
    SQL = await initSqlJs({ locateFile })
  }

  let buffer: Uint8Array | null = null
  if (!forceRefresh) {
    buffer = await loadSnapshot(IDB_NAME, IDB_STORE, IDB_KEY)
  }

  if (buffer) {
    if (blindDb) blindDb.close()
    blindDb = new SQL.Database(buffer)
  } else {
    if (blindDb) blindDb.close()
    blindDb = new SQL.Database()
    createTables(blindDb)
    await persist()
  }
}

function createTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS training_sessions (
      id TEXT PRIMARY KEY,
      sample_id TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      interval_type TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT DEFAULT 'active',
      initial_capital REAL NOT NULL,
      final_capital REAL,
      realized_pnl REAL,
      total_trades INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      profile_id TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS trade_actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      bar_index INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      price REAL,
      shares INTEGER,
      amount REAL,
      commission REAL,
      realized_pnl REAL,
      source TEXT DEFAULT 'manual',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trained_stocks (
      code TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      trained_at INTEGER NOT NULL,
      PRIMARY KEY (code, profile_id)
    );
    CREATE TABLE IF NOT EXISTS session_reviews (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      trade_win_rate REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      realized_pnl_pct REAL NOT NULL DEFAULT 0,
      max_drawdown_pct REAL NOT NULL DEFAULT 0,
      buy_count INTEGER NOT NULL DEFAULT 0,
      sell_count INTEGER NOT NULL DEFAULT 0,
      hold_count INTEGER NOT NULL DEFAULT 0,
      avg_holding_bars REAL NOT NULL DEFAULT 0,
      avg_holding_days REAL NOT NULL DEFAULT 0,
      avg_daily_return_pct REAL NOT NULL DEFAULT 0,
      win_hold_efficiency REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      winning_trades INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_profile ON training_sessions(profile_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON training_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trained_profile ON trained_stocks(profile_id);
    CREATE INDEX IF NOT EXISTS idx_review_session ON session_reviews(session_id);
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS training_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      initial_capital REAL NOT NULL DEFAULT 100000,
      current_capital REAL NOT NULL DEFAULT 100000,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      total_pnl REAL NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_losses INTEGER NOT NULL DEFAULT 0,
      total_duration_seconds REAL NOT NULL DEFAULT 0,
      total_holding_days REAL NOT NULL DEFAULT 0,
      total_trades_count INTEGER NOT NULL DEFAULT 0,
      total_winning_trades INTEGER NOT NULL DEFAULT 0,
      avg_session_return_pct REAL NOT NULL DEFAULT 0,
      best_session_return_pct REAL NOT NULL DEFAULT 0,
      worst_session_return_pct REAL NOT NULL DEFAULT 0,
      max_drawdown_pct REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_profiles_active ON training_profiles(is_active)')
  db.run(
    `INSERT OR IGNORE INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
     VALUES ('default', '默认存档', 100000, 100000, 1, ?, ?)`,
    [Date.now(), Date.now()]
  )
}

async function persist(): Promise<void> {
  if (!blindDb) return
  const data = blindDb.export()
  await saveSnapshot(IDB_NAME, IDB_STORE, IDB_KEY, data)
}

export function isBlindDbReady(): boolean {
  return blindDb !== null
}

function requireDb(): Database {
  if (!blindDb) throw new Error('盲训库未初始化，请先调用 initBlindDb()')
  return blindDb
}

export async function saveSession(input: SaveSessionInput): Promise<void> {
  const db = requireDb()
  db.run(
    `INSERT INTO training_sessions
      (id, sample_id, stock_code, stock_name, interval_type, started_at, initial_capital, created_at, profile_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [input.id, input.sample_id, input.stock_code, input.stock_name,
     input.interval_type, input.started_at, input.initial_capital,
     input.created_at, input.profile_id]
  )
}

export async function markTrained(code: string, profileId: string): Promise<void> {
  const db = requireDb()
  db.run(
    `INSERT OR IGNORE INTO trained_stocks (code, profile_id, trained_at) VALUES (?, ?, ?)`,
    [code, profileId, Date.now()]
  )
  await persist()
}

function markTrainedSync(code: string, profileId: string): void {
  const db = requireDb()
  db.run(
    `INSERT OR IGNORE INTO trained_stocks (code, profile_id, trained_at) VALUES (?, ?, ?)`,
    [code, profileId, Date.now()]
  )
}

export async function getTrainedCodes(profileId: string): Promise<string[]> {
  const db = requireDb()
  const stmt = db.prepare(
    `SELECT code FROM trained_stocks WHERE profile_id = ? ORDER BY code`
  )
  stmt.bind([profileId])
  const codes: string[] = []
  while (stmt.step()) {
    codes.push(stmt.getAsObject().code as string)
  }
  stmt.free()
  return codes
}

export async function getRecentTrainedCodes(profileId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return []
  const db = requireDb()
  const stmt = db.prepare(
    `SELECT code FROM trained_stocks WHERE profile_id = ? ORDER BY trained_at DESC LIMIT ?`
  )
  stmt.bind([profileId, limit])
  const codes: string[] = []
  while (stmt.step()) {
    codes.push(stmt.getAsObject().code as string)
  }
  stmt.free()
  return codes
}

interface SessionRow {
  id: string
  initial_capital: number
  final_capital: number | null
  interval_type: string
  profile_id: string
  started_at: number
  finished_at: number | null
  status: string
}

function queryAll(db: Database, sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
  const stmt = db.prepare(sql)
  stmt.bind(params as Parameters<typeof stmt.bind>[0])
  const rows: Array<Record<string, unknown>> = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>)
  }
  stmt.free()
  return rows
}

function queryOne<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T | undefined {
  return queryAll(db, sql, params)[0] as T | undefined
}

function getSessionActionsInternal(sessionId: string): SessionActionRecord[] {
  const db = requireDb()
  return queryAll(
    db,
    'SELECT * FROM trade_actions WHERE session_id = ? ORDER BY bar_index ASC, created_at ASC',
    [sessionId]
  ) as unknown as SessionActionRecord[]
}

// 参考 main 版 recomputeAndSaveSessionReview：算 metrics → UPSERT session_reviews → 回写 session 聚合
function recomputeAndSaveSessionReview(sessionId: string): SessionReview | null {
  const db = requireDb()
  const session = queryOne<SessionRow>(
    db,
    'SELECT id, initial_capital, final_capital, interval_type FROM training_sessions WHERE id = ? LIMIT 1',
    [sessionId]
  )
  if (!session) return null

  const actions = getSessionActionsInternal(sessionId)
  const initialCapital = Number(session.initial_capital || 0)
  const intervalType = session.interval_type || '1d'

  // 先用 stored final_capital 算一次（拿 realizedPnl），再用 initial+realizedPnl 重算
  const storedFinal = Number(session.final_capital ?? initialCapital)
  const firstMetrics = calculateSessionReviewMetrics(actions, initialCapital, storedFinal, intervalType)
  const finalCapital = initialCapital + firstMetrics.realizedPnl
  const metrics = calculateSessionReviewMetrics(actions, initialCapital, finalCapital, intervalType)

  const now = Date.now()
  const reviewId = `review_${sessionId}`
  db.run(
    `INSERT INTO session_reviews (
        id, session_id, trade_win_rate, realized_pnl, realized_pnl_pct, max_drawdown_pct,
        buy_count, sell_count, hold_count, avg_holding_bars, avg_holding_days, avg_daily_return_pct,
        win_hold_efficiency, total_trades, winning_trades, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        trade_win_rate = excluded.trade_win_rate,
        realized_pnl = excluded.realized_pnl,
        realized_pnl_pct = excluded.realized_pnl_pct,
        max_drawdown_pct = excluded.max_drawdown_pct,
        buy_count = excluded.buy_count,
        sell_count = excluded.sell_count,
        hold_count = excluded.hold_count,
        avg_holding_bars = excluded.avg_holding_bars,
        avg_holding_days = excluded.avg_holding_days,
        avg_daily_return_pct = excluded.avg_daily_return_pct,
        win_hold_efficiency = excluded.win_hold_efficiency,
        total_trades = excluded.total_trades,
        winning_trades = excluded.winning_trades,
        updated_at = excluded.updated_at`,
    [
      reviewId, sessionId,
      metrics.tradeWinRate, metrics.realizedPnl, metrics.realizedPnlPct, metrics.maxDrawdownPct,
      metrics.buyCount, metrics.sellCount, metrics.holdCount,
      metrics.avgHoldingBars, metrics.avgHoldingDays, metrics.avgDailyReturnPct,
      metrics.winHoldEfficiency, metrics.totalTrades, metrics.winningTrades,
      now, now,
    ]
  )

  db.run(
    `UPDATE training_sessions SET total_trades = ?, winning_trades = ?, realized_pnl = ?, final_capital = ? WHERE id = ?`,
    [metrics.totalTrades, metrics.winningTrades, metrics.realizedPnl, finalCapital, sessionId]
  )

  return queryOne<SessionReview>(
    db,
    'SELECT * FROM session_reviews WHERE session_id = ? LIMIT 1',
    [sessionId]
  )!
}

export async function saveTradeAction(action: SaveTradeActionInput): Promise<SaveTradeActionResult> {
  const db = requireDb()
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  db.run(
    `INSERT INTO trade_actions
      (id, session_id, bar_index, action_type, price, shares, amount, commission, realized_pnl, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, action.sessionId, action.barIndex, action.actionType,
      action.price ?? null, action.shares ?? null, action.amount ?? null,
      action.commission ?? null, action.realizedPnl ?? null,
      action.source ?? 'manual', Date.now(),
    ]
  )
  await persist()
  return { ...action, id }
}

export async function getSessionActions(sessionId: string): Promise<SessionActionRecord[]> {
  return getSessionActionsInternal(sessionId)
}

export interface FinishSessionResult {
  success: boolean
  review?: SessionReview | null
}

export async function finishSession(
  sessionId: string,
  finalCapital: number,
  realizedPnl: number,
  context?: FinishSessionContext
): Promise<FinishSessionResult> {
  const db = requireDb()
  const session = queryOne<SessionRow & { profile_id: string; stock_code: string }>(
    db,
    'SELECT id, initial_capital, interval_type, profile_id, stock_code, started_at, finished_at, status FROM training_sessions WHERE id = ? LIMIT 1',
    [sessionId]
  )
  if (!session) return { success: false }

  db.run(
    `UPDATE training_sessions
     SET finished_at = COALESCE(finished_at, ?),
         status = 'finished',
         final_capital = ?,
         realized_pnl = ?
     WHERE id = ?`,
    [Date.now(), finalCapital, realizedPnl, sessionId]
  )

  const review = recomputeAndSaveSessionReview(sessionId)
  const profileId = session.profile_id || context?.profileId || 'default'
  rebuildProfileAggregate(profileId)
  if (session.stock_code) {
    markTrainedSync(session.stock_code, profileId)
  }
  await persist()

  return { success: true, review }
}

// 重建 profile 聚合：从该 profile 的所有 finished session 重新计算 total_sessions/total_pnl/current_capital 等
function rebuildProfileAggregate(profileId: string): void {
  const db = requireDb()
  const profile = queryOne<{ id: string; initial_capital: number }>(
    db, 'SELECT id, initial_capital FROM training_profiles WHERE id = ? LIMIT 1', [profileId]
  )
  if (!profile) return

  const sessions = queryAll(
    db,
    `SELECT
        s.started_at, s.finished_at, s.initial_capital, s.final_capital,
        r.avg_holding_days, r.total_trades, r.winning_trades, r.max_drawdown_pct,
        s.realized_pnl
     FROM training_sessions s
     LEFT JOIN session_reviews r ON r.session_id = s.id
     WHERE s.profile_id = ? AND s.status = 'finished'
     ORDER BY s.started_at ASC`,
    [profileId]
  ) as Array<{
    started_at: number
    finished_at: number | null
    initial_capital: number
    final_capital: number | null
    avg_holding_days?: number | null
    total_trades?: number | null
    winning_trades?: number | null
    max_drawdown_pct?: number | null
    realized_pnl?: number | null
  }>

  const initialCapital = Number(profile.initial_capital || 100000)
  let currentCapital = initialCapital
  let totalWins = 0
  let totalLosses = 0
  let totalHoldingDays = 0
  let totalTradesCount = 0
  let totalWinningTrades = 0
  let avgSessionReturnPct = 0
  let bestSessionReturnPct = 0
  let worstSessionReturnPct = 0
  let maxDrawdownPct = 0

  sessions.forEach((s, index) => {
    const ic = Number(s.initial_capital || 0)
    const fc = Number(s.final_capital ?? ic)
    const pnl = fc - ic
    const pnlPct = ic > 0 ? (pnl / ic) * 100 : 0
    currentCapital = fc
    if (pnl >= 0) totalWins += 1
    else totalLosses += 1
    totalHoldingDays += Number(s.avg_holding_days || 0)
    totalTradesCount += Number(s.total_trades || 0)
    totalWinningTrades += Number(s.winning_trades || 0)
    maxDrawdownPct = Math.max(maxDrawdownPct, Number(s.max_drawdown_pct || 0))

    if (index === 0) {
      avgSessionReturnPct = pnlPct
      bestSessionReturnPct = pnlPct
      worstSessionReturnPct = pnlPct
    } else {
      avgSessionReturnPct = (avgSessionReturnPct * index + pnlPct) / (index + 1)
      bestSessionReturnPct = Math.max(bestSessionReturnPct, pnlPct)
      worstSessionReturnPct = Math.min(worstSessionReturnPct, pnlPct)
    }
  })

  const totalPnl = sessions.length > 0 ? currentCapital - initialCapital : 0
  const finalCapital = sessions.length > 0 ? currentCapital : initialCapital

  db.run(
    `UPDATE training_profiles SET
       current_capital = ?, total_sessions = ?, total_pnl = ?,
       total_wins = ?, total_losses = ?,
       total_holding_days = ?, total_trades_count = ?, total_winning_trades = ?,
       avg_session_return_pct = ?, best_session_return_pct = ?, worst_session_return_pct = ?,
       max_drawdown_pct = ?, updated_at = ?
     WHERE id = ?`,
    [
      finalCapital, sessions.length, totalPnl,
      totalWins, totalLosses,
      totalHoldingDays, totalTradesCount, totalWinningTrades,
      sessions.length > 0 ? avgSessionReturnPct : 0,
      sessions.length > 0 ? bestSessionReturnPct : 0,
      sessions.length > 0 ? worstSessionReturnPct : 0,
      maxDrawdownPct, Date.now(),
      profileId,
    ]
  )
}

export async function listProfiles(): Promise<TrainingProfileRecord[]> {
  const db = requireDb()
  return queryAll(db, 'SELECT * FROM training_profiles ORDER BY created_at ASC') as unknown as TrainingProfileRecord[]
}

function ensureActiveProfileExists(): void {
  const db = requireDb()
  const active = queryOne(db, 'SELECT id FROM training_profiles WHERE is_active = 1 LIMIT 1')
  if (active) return
  const fallback = queryOne<{ id: string }>(db, 'SELECT id FROM training_profiles ORDER BY updated_at DESC, created_at DESC LIMIT 1')
  if (fallback) {
    db.run('UPDATE training_profiles SET is_active = 1, updated_at = ? WHERE id = ?', [Date.now(), fallback.id])
    return
  }
  db.run(
    `INSERT OR IGNORE INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
     VALUES ('default', '默认存档', 100000, 100000, 1, ?, ?)`,
    [Date.now(), Date.now()]
  )
}

export async function getActiveProfile(): Promise<TrainingProfileRecord | null> {
  const db = requireDb()
  let row = queryOne<TrainingProfileRecord>(db, 'SELECT * FROM training_profiles WHERE is_active = 1 LIMIT 1')
  if (!row) {
    ensureActiveProfileExists()
    row = queryOne<TrainingProfileRecord>(db, 'SELECT * FROM training_profiles WHERE is_active = 1 LIMIT 1')
  }
  return row ?? null
}

export async function createProfile(name: string, initialCapital: number): Promise<TrainingProfileRecord> {
  const db = requireDb()
  const normalized = String(name || '').trim()
  if (!normalized) throw new Error('账户名称不能为空')
  const existing = queryOne(db, 'SELECT id FROM training_profiles WHERE lower(name) = lower(?) LIMIT 1', [normalized])
  if (existing) throw new Error('账户名称已存在，请使用其他名称')
  const capital = Number(initialCapital)
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('初始资金必须大于 0')

  const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()
  db.run('UPDATE training_profiles SET is_active = 0 WHERE is_active = 1')
  db.run(
    `INSERT INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [id, normalized, capital, capital, now, now]
  )
  await persist()
  return queryOne<TrainingProfileRecord>(db, 'SELECT * FROM training_profiles WHERE id = ?', [id])!
}

export async function loadProfile(profileId: string): Promise<TrainingProfileRecord | null> {
  const db = requireDb()
  const existing = queryOne(db, 'SELECT id FROM training_profiles WHERE id = ?', [profileId])
  if (!existing) return null
  const now = Date.now()
  db.run('UPDATE training_profiles SET is_active = 0')
  db.run('UPDATE training_profiles SET is_active = 1, updated_at = ? WHERE id = ?', [now, profileId])
  await persist()
  return queryOne<TrainingProfileRecord>(db, 'SELECT * FROM training_profiles WHERE id = ?', [profileId]) ?? null
}

export interface ProfileDeleteResult {
  success: boolean
  error?: string
}

export async function deleteProfile(profileId: string): Promise<ProfileDeleteResult> {
  const db = requireDb()
  const target = String(profileId || '').trim()
  if (!target) return { success: false, error: 'invalid_profile_id' }
  if (target === 'default') return { success: false, error: 'cannot_delete_default' }
  const isActive = queryOne(db, 'SELECT id FROM training_profiles WHERE is_active = 1 AND id = ?', [target])
  if (isActive) return { success: false, error: 'cannot_delete_active' }
  const exists = queryOne(db, 'SELECT id FROM training_profiles WHERE id = ?', [target])
  if (!exists) return { success: false, error: 'not_found' }

  db.run('DELETE FROM trade_actions WHERE session_id IN (SELECT id FROM training_sessions WHERE profile_id = ?)', [target])
  db.run('DELETE FROM session_reviews WHERE session_id IN (SELECT id FROM training_sessions WHERE profile_id = ?)', [target])
  db.run('DELETE FROM trained_stocks WHERE profile_id = ?', [target])
  db.run('DELETE FROM training_sessions WHERE profile_id = ?', [target])
  db.run('DELETE FROM training_profiles WHERE id = ?', [target])
  ensureActiveProfileExists()
  await persist()
  return { success: true }
}

export async function resetProfileCapital(profileId: string, newCapital: number): Promise<TrainingProfileRecord | null> {
  const db = requireDb()
  const capital = Number(newCapital)
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('资金必须大于 0')
  const now = Date.now()
  db.run(
    `UPDATE training_profiles SET
       current_capital = ?, total_sessions = 0, total_pnl = 0,
       total_wins = 0, total_losses = 0, total_duration_seconds = 0,
       total_holding_days = 0, total_trades_count = 0, total_winning_trades = 0,
       avg_session_return_pct = 0, best_session_return_pct = 0, worst_session_return_pct = 0,
       max_drawdown_pct = 0, updated_at = ?
     WHERE id = ?`,
    [capital, now, profileId]
  )
  await persist()
  return queryOne<TrainingProfileRecord>(db, 'SELECT * FROM training_profiles WHERE id = ?', [profileId]) ?? null
}

export async function getProfileStats(profileId?: string): Promise<ProfileStats | null> {
  const db = requireDb()
  const target = profileId || 'default'
  const profile = queryOne<TrainingProfileRecord>(db, 'SELECT * FROM training_profiles WHERE id = ?', [target])
  if (!profile) return null

  const dailyRows = queryAll(
    db,
    `SELECT date(s.started_at / 1000, 'unixepoch', 'localtime') as day,
            COUNT(*) as count,
            AVG(r.realized_pnl_pct) as avg_pnl_pct,
            SUM(s.realized_pnl) as total_pnl,
            AVG(r.trade_win_rate) as avg_win_rate,
            AVG(r.avg_daily_return_pct) as avg_daily_return_pct
     FROM training_sessions s
     LEFT JOIN session_reviews r ON r.session_id = s.id
     WHERE s.profile_id = ? AND s.status = 'finished'
     GROUP BY day
     ORDER BY day ASC`,
    [target]
  ) as Array<Record<string, unknown>>

  const trendRows = queryAll(
    db,
    `SELECT s.started_at as date, r.realized_pnl_pct as pnlPct
     FROM training_sessions s
     LEFT JOIN session_reviews r ON r.session_id = s.id
     WHERE s.profile_id = ? AND s.status = 'finished'
     ORDER BY s.started_at ASC`,
    [target]
  ) as Array<{ date: number; pnlPct: number }>

  return {
    profile,
    sessionTrend: trendRows.map((r) => ({
      date: Number(r.date || 0),
      pnlPct: Number(r.pnlPct || 0),
    })),
    dailyStats: dailyRows.map((d) => ({
      day: String(d.day || ''),
      count: Number(d.count || 0),
      avgPnlPct: Number(d.avg_pnl_pct || 0),
      totalPnl: Number(d.total_pnl || 0),
      avgWinRatePct: Number(d.avg_win_rate || 0) * 100,
      avgDailyReturnPct: Number(d.avg_daily_return_pct || 0),
    })),
  }
}

export async function getSessionReview(sessionId: string): Promise<SessionReview | null> {
  const db = requireDb()
  const cached = queryOne<SessionReview>(
    db,
    'SELECT * FROM session_reviews WHERE session_id = ? LIMIT 1',
    [sessionId]
  )
  if (cached) return cached
  return recomputeAndSaveSessionReview(sessionId)
}

export async function listSessions(profileId?: string): Promise<SessionSummary[]> {
  const db = requireDb()
  const sql = `
    SELECT
      s.id, s.sample_id, s.stock_code, s.stock_name, s.interval_type,
      s.started_at, s.finished_at, s.status, s.profile_id,
      s.initial_capital, s.final_capital, s.realized_pnl,
      s.total_trades, s.winning_trades,
      r.trade_win_rate, r.realized_pnl_pct, r.max_drawdown_pct,
      r.buy_count, r.sell_count, r.hold_count,
      r.avg_holding_bars, r.avg_holding_days,
      r.avg_daily_return_pct, r.win_hold_efficiency
    FROM training_sessions s
    LEFT JOIN session_reviews r ON r.session_id = s.id
    ${profileId ? 'WHERE s.profile_id = ?' : ''}
    ORDER BY s.started_at DESC
    LIMIT 100`
  const rows = profileId ? queryAll(db, sql, [profileId]) : queryAll(db, sql)
  return rows as unknown as SessionSummary[]
}
