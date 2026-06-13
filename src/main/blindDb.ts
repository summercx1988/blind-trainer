import { app } from 'electron'
import path from 'path'
import Database from 'better-sqlite3'
import { getDb } from './db'

export const BLIND_DB_PATH = process.env.STOCK_TRADING_BLIND_DB_PATH || path.join(app.getPath('userData'), 'blind-training.db')
let blindDb: Database.Database | null = null

const initBlindTables = (database: Database.Database) => {
  database.exec(`
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
      action_type TEXT NOT NULL CHECK(action_type IN ('buy', 'sell', 'hold', 'skip')),
      price REAL,
      shares INTEGER,
      amount REAL,
      commission REAL,
      position_before TEXT,
      position_after TEXT,
      unrealized_pnl REAL,
      realized_pnl REAL,
      source TEXT DEFAULT 'manual',
      strategy_id TEXT,
      created_at INTEGER NOT NULL
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

    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      bar_index INTEGER NOT NULL,
      label_type TEXT NOT NULL CHECK(label_type IN ('buy', 'sell', 'hold', 'no_action')),
      source TEXT NOT NULL,
      strategy_id TEXT,
      confidence REAL DEFAULT 0.5,
      user_confidence REAL,
      status TEXT DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'rejected', 'modified')),
      reason TEXT,
      note TEXT,
      version INTEGER DEFAULT 1,
      parent_version_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );

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
    );

    INSERT OR IGNORE INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
    VALUES ('default', '默认存档', 100000, 100000, 1, strftime('%s','now'), strftime('%s','now'));

    CREATE INDEX IF NOT EXISTS idx_blind_training_sessions_started_at ON training_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blind_training_sessions_profile_started ON training_sessions(profile_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blind_trade_session ON trade_actions(session_id);
    CREATE INDEX IF NOT EXISTS idx_blind_review_session ON session_reviews(session_id);
    CREATE INDEX IF NOT EXISTS idx_blind_labels_session ON labels(session_id);
    CREATE INDEX IF NOT EXISTS idx_blind_labels_bar ON labels(bar_index);
    CREATE INDEX IF NOT EXISTS idx_blind_profiles_active ON training_profiles(is_active);
  `)
}

const tableExists = (database: Database.Database, tableName: string): boolean => {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(tableName) as { name?: string } | undefined
  return Boolean(row?.name)
}

const hasBlindData = (database: Database.Database): boolean => {
  const sessions = Number((database.prepare('SELECT COUNT(*) as count FROM training_sessions').get() as { count?: number })?.count || 0)
  const actions = Number((database.prepare('SELECT COUNT(*) as count FROM trade_actions').get() as { count?: number })?.count || 0)
  const labels = Number((database.prepare('SELECT COUNT(*) as count FROM labels').get() as { count?: number })?.count || 0)
  const customProfiles = Number((database.prepare("SELECT COUNT(*) as count FROM training_profiles WHERE id <> 'default'").get() as { count?: number })?.count || 0)
  return sessions > 0 || actions > 0 || labels > 0 || customProfiles > 0
}

const migrateLegacyBlindData = (database: Database.Database) => {
  if (hasBlindData(database)) return

  const mainDb = getDb()
  if (!tableExists(mainDb, 'training_sessions')) return

  const tx = database.transaction(() => {
    const profiles = mainDb.prepare(`
      SELECT
        id, name, initial_capital, current_capital, total_sessions, total_pnl, total_wins, total_losses,
        total_duration_seconds, total_holding_days, total_trades_count, total_winning_trades,
        avg_session_return_pct, best_session_return_pct, worst_session_return_pct, max_drawdown_pct,
        is_active, created_at, updated_at
      FROM training_profiles
    `).all() as Array<Record<string, unknown>>
    const insertProfile = database.prepare(`
      INSERT OR IGNORE INTO training_profiles (
        id, name, initial_capital, current_capital, total_sessions, total_pnl, total_wins, total_losses,
        total_duration_seconds, total_holding_days, total_trades_count, total_winning_trades,
        avg_session_return_pct, best_session_return_pct, worst_session_return_pct, max_drawdown_pct,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of profiles) {
      insertProfile.run(
        row.id, row.name, row.initial_capital, row.current_capital, row.total_sessions, row.total_pnl, row.total_wins, row.total_losses,
        row.total_duration_seconds, row.total_holding_days, row.total_trades_count, row.total_winning_trades,
        row.avg_session_return_pct, row.best_session_return_pct, row.worst_session_return_pct, row.max_drawdown_pct,
        row.is_active, row.created_at, row.updated_at
      )
    }

    const sessions = mainDb.prepare(`
      SELECT
        id, sample_id, stock_code, stock_name, interval_type, started_at, finished_at, status,
        initial_capital, final_capital, realized_pnl, total_trades, winning_trades, created_at, profile_id
      FROM training_sessions
    `).all() as Array<Record<string, unknown>>
    const insertSession = database.prepare(`
      INSERT OR IGNORE INTO training_sessions (
        id, sample_id, stock_code, stock_name, interval_type, started_at, finished_at, status,
        initial_capital, final_capital, realized_pnl, total_trades, winning_trades, created_at, profile_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of sessions) {
      insertSession.run(
        row.id, row.sample_id, row.stock_code, row.stock_name, row.interval_type, row.started_at, row.finished_at, row.status,
        row.initial_capital, row.final_capital, row.realized_pnl, row.total_trades, row.winning_trades, row.created_at, row.profile_id
      )
    }

    const actions = mainDb.prepare(`
      SELECT
        id, session_id, bar_index, action_type, price, shares, amount, commission,
        position_before, position_after, unrealized_pnl, realized_pnl, source, strategy_id, created_at
      FROM trade_actions
    `).all() as Array<Record<string, unknown>>
    const insertAction = database.prepare(`
      INSERT OR IGNORE INTO trade_actions (
        id, session_id, bar_index, action_type, price, shares, amount, commission,
        position_before, position_after, unrealized_pnl, realized_pnl, source, strategy_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of actions) {
      insertAction.run(
        row.id, row.session_id, row.bar_index, row.action_type, row.price, row.shares, row.amount, row.commission,
        row.position_before, row.position_after, row.unrealized_pnl, row.realized_pnl, row.source, row.strategy_id, row.created_at
      )
    }

    const reviews = mainDb.prepare(`
      SELECT
        id, session_id, trade_win_rate, realized_pnl, realized_pnl_pct, max_drawdown_pct,
        buy_count, sell_count, hold_count, avg_holding_bars, avg_holding_days, avg_daily_return_pct,
        win_hold_efficiency, total_trades, winning_trades, created_at, updated_at
      FROM session_reviews
    `).all() as Array<Record<string, unknown>>
    const insertReview = database.prepare(`
      INSERT OR IGNORE INTO session_reviews (
        id, session_id, trade_win_rate, realized_pnl, realized_pnl_pct, max_drawdown_pct,
        buy_count, sell_count, hold_count, avg_holding_bars, avg_holding_days, avg_daily_return_pct,
        win_hold_efficiency, total_trades, winning_trades, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of reviews) {
      insertReview.run(
        row.id, row.session_id, row.trade_win_rate, row.realized_pnl, row.realized_pnl_pct, row.max_drawdown_pct,
        row.buy_count, row.sell_count, row.hold_count, row.avg_holding_bars, row.avg_holding_days, row.avg_daily_return_pct,
        row.win_hold_efficiency, row.total_trades, row.winning_trades, row.created_at, row.updated_at
      )
    }

    if (tableExists(mainDb, 'labels')) {
      const labels = mainDb.prepare(`
        SELECT
          id, session_id, bar_index, label_type, source, strategy_id, confidence, user_confidence,
          status, reason, note, version, parent_version_id, created_at, updated_at
        FROM labels
        WHERE session_id IN (SELECT id FROM training_sessions)
      `).all() as Array<Record<string, unknown>>
      const insertLabel = database.prepare(`
        INSERT OR IGNORE INTO labels (
          id, session_id, bar_index, label_type, source, strategy_id, confidence, user_confidence,
          status, reason, note, version, parent_version_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const row of labels) {
        insertLabel.run(
          row.id, row.session_id, row.bar_index, row.label_type, row.source, row.strategy_id, row.confidence, row.user_confidence,
          row.status, row.reason, row.note, row.version, row.parent_version_id, row.created_at, row.updated_at
        )
      }
    }

    database.prepare('UPDATE training_profiles SET is_active = 0 WHERE is_active = 1').run()
    const active = database.prepare('SELECT id FROM training_profiles ORDER BY updated_at DESC, created_at DESC LIMIT 1').get() as { id?: string } | undefined
    if (active?.id) {
      database.prepare('UPDATE training_profiles SET is_active = 1, updated_at = ? WHERE id = ?')
        .run(Math.floor(Date.now() / 1000), active.id)
    } else {
      database.prepare(`
        INSERT OR IGNORE INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
        VALUES ('default', '默认存档', 100000, 100000, 1, strftime('%s','now'), strftime('%s','now'))
      `).run()
    }
  })

  tx()
}

const openBlindDb = (): Database.Database => {
  const database = new Database(BLIND_DB_PATH)
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  initBlindTables(database)
  migrateLegacyBlindData(database)
  return database
}

export const getBlindDb = (): Database.Database => {
  if (!blindDb) {
    blindDb = openBlindDb()
  }
  return blindDb
}

export const closeBlindDb = () => {
  if (!blindDb) return
  blindDb.close()
  blindDb = null
}
