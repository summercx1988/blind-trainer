import { ipcMain } from 'electron'
import log from '../logger'
import { getBlindDb } from '../blindDb'
import { getDb } from '../db'
import { calculateSessionReviewMetrics } from '../sessionReview'
import { registerAgentIpc } from './agentIpc'
import type {
  SaveSessionInput,
  SaveTradeActionInput,
  SessionActionRecord,
  SessionReview
} from '../../types/ipc'

interface SaveTradeActionDbInput extends SaveTradeActionInput {
  positionBefore?: string
  positionAfter?: string
  unrealizedPnl?: number
}

const toMillis = (value: number | null | undefined): number => {
  if (!Number.isFinite(value)) return 0
  const raw = Number(value)
  if (raw <= 0) return 0
  return raw < 1_000_000_000_000 ? raw * 1000 : raw
}

const toDurationSec = (startedAt: number | null | undefined, finishedAt: number | null | undefined): number => {
  const startMs = toMillis(startedAt)
  const endMs = toMillis(finishedAt)
  if (!startMs || !endMs || endMs <= startMs) return 0
  return Math.max(0, Math.floor((endMs - startMs) / 1000))
}

const saveTradeActionToDb = (action: SaveTradeActionDbInput) => {
  const database = getBlindDb()
  const id = `action_${Date.now()}`

  database.prepare(`
    INSERT INTO trade_actions 
    (id, session_id, bar_index, action_type, price, shares, amount, commission, position_before, position_after, unrealized_pnl, realized_pnl, source, strategy_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    action.sessionId,
    action.barIndex,
    action.actionType,
    action.price,
    action.shares,
    action.amount,
    action.commission,
    action.positionBefore,
    action.positionAfter,
    action.unrealizedPnl,
    action.realizedPnl,
    action.source || 'manual',
    action.strategyId,
    Math.floor(Date.now() / 1000)
  )

  return { ...action, id }
}

const getSessionActionsFromDb = (sessionId: string): SessionActionRecord[] => {
  return getBlindDb()
    .prepare('SELECT * FROM trade_actions WHERE session_id = ? ORDER BY bar_index, created_at')
    .all(sessionId) as SessionActionRecord[]
}

const recomputeAndSaveSessionReview = (sessionId: string): SessionReview | null => {
  const database = getBlindDb()
  const session = database.prepare(`
    SELECT id, initial_capital, final_capital, interval_type
    FROM training_sessions
    WHERE id = ?
    LIMIT 1
  `).get(sessionId) as { id: string; initial_capital: number; final_capital: number | null; interval_type: string } | undefined

  if (!session) return null

  const actions = getSessionActionsFromDb(sessionId)
  const initialCapital = Number(session.initial_capital || 0)
  const storedFinalCapital = Number(session.final_capital ?? initialCapital)
  const actionMetrics = calculateSessionReviewMetrics(
    actions,
    initialCapital,
    storedFinalCapital,
    session.interval_type || '1d'
  )
  const finalCapital = initialCapital + actionMetrics.realizedPnl
  const metrics = calculateSessionReviewMetrics(
    actions,
    initialCapital,
    finalCapital,
    session.interval_type || '1d'
  )

  const now = Math.floor(Date.now() / 1000)
  const reviewId = `review_${sessionId}`
  database.prepare(`
    INSERT INTO session_reviews (
      id, session_id, trade_win_rate, realized_pnl, realized_pnl_pct, max_drawdown_pct,
      buy_count, sell_count, hold_count, avg_holding_bars, avg_holding_days, avg_daily_return_pct,
      win_hold_efficiency, total_trades, winning_trades, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      updated_at = excluded.updated_at
  `).run(
    reviewId,
    sessionId,
    metrics.tradeWinRate,
    metrics.realizedPnl,
    metrics.realizedPnlPct,
    metrics.maxDrawdownPct,
    metrics.buyCount,
    metrics.sellCount,
    metrics.holdCount,
    metrics.avgHoldingBars,
    metrics.avgHoldingDays,
    metrics.avgDailyReturnPct,
    metrics.winHoldEfficiency,
    metrics.totalTrades,
    metrics.winningTrades,
    now,
    now
  )

  database
    .prepare('UPDATE training_sessions SET total_trades = ?, winning_trades = ?, realized_pnl = ?, final_capital = ? WHERE id = ?')
    .run(
      metrics.totalTrades,
      metrics.winningTrades,
      metrics.realizedPnl,
      finalCapital,
      sessionId
    )

  return database.prepare('SELECT * FROM session_reviews WHERE session_id = ? LIMIT 1').get(sessionId) as SessionReview
}

const rebuildProfileAggregate = (database: ReturnType<typeof getBlindDb>, profileId: string, nowSec = Math.floor(Date.now() / 1000)) => {
  const profile = database.prepare(`
    SELECT id, initial_capital
    FROM training_profiles
    WHERE id = ?
    LIMIT 1
  `).get(profileId) as { id: string; initial_capital: number } | undefined

  if (!profile) return

  const sessions = database.prepare(`
    SELECT
      s.started_at,
      s.finished_at,
      s.initial_capital,
      s.final_capital,
      r.avg_holding_days,
      r.total_trades,
      r.winning_trades,
      r.max_drawdown_pct
    FROM training_sessions s
    LEFT JOIN session_reviews r ON r.session_id = s.id
    WHERE s.profile_id = ? AND s.status = 'finished'
    ORDER BY s.started_at ASC
  `).all(profileId) as Array<{
    started_at: number
    finished_at: number | null
    initial_capital: number
    final_capital: number | null
    avg_holding_days?: number | null
    total_trades?: number | null
    winning_trades?: number | null
    max_drawdown_pct?: number | null
  }>

  let currentCapital = Number(profile.initial_capital || 100000)
  let totalWins = 0
  let totalLosses = 0
  let totalDurationSeconds = 0
  let totalHoldingDays = 0
  let totalTradesCount = 0
  let totalWinningTrades = 0
  let avgSessionReturnPct = 0
  let bestSessionReturnPct = 0
  let worstSessionReturnPct = 0
  let maxDrawdownPct = 0

  sessions.forEach((session, index) => {
    const initialCapital = Number(session.initial_capital || 0)
    const finalCapital = Number(session.final_capital ?? initialCapital)
    const realizedPnl = finalCapital - initialCapital
    const sessionReturnPct = initialCapital > 0 ? ((finalCapital - initialCapital) / initialCapital) * 100 : 0

    currentCapital = finalCapital
    if (realizedPnl >= 0) totalWins += 1
    else totalLosses += 1
    totalDurationSeconds += toDurationSec(session.started_at, session.finished_at)
    totalHoldingDays += Number(session.avg_holding_days || 0)
    totalTradesCount += Number(session.total_trades || 0)
    totalWinningTrades += Number(session.winning_trades || 0)
    maxDrawdownPct = Math.max(maxDrawdownPct, Number(session.max_drawdown_pct || 0))

    if (index === 0) {
      avgSessionReturnPct = sessionReturnPct
      bestSessionReturnPct = sessionReturnPct
      worstSessionReturnPct = sessionReturnPct
    } else {
      avgSessionReturnPct = ((avgSessionReturnPct * index) + sessionReturnPct) / (index + 1)
      bestSessionReturnPct = Math.max(bestSessionReturnPct, sessionReturnPct)
      worstSessionReturnPct = Math.min(worstSessionReturnPct, sessionReturnPct)
    }
  })

  database.prepare(`
    UPDATE training_profiles SET
      current_capital = ?,
      total_sessions = ?,
      total_pnl = ?,
      total_wins = ?,
      total_losses = ?,
      total_duration_seconds = ?,
      total_holding_days = ?,
      total_trades_count = ?,
      total_winning_trades = ?,
      avg_session_return_pct = ?,
      best_session_return_pct = ?,
      worst_session_return_pct = ?,
      max_drawdown_pct = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    sessions.length > 0 ? currentCapital : Number(profile.initial_capital || 100000),
    sessions.length,
    (sessions.length > 0 ? currentCapital : Number(profile.initial_capital || 100000)) - Number(profile.initial_capital || 100000),
    totalWins,
    totalLosses,
    totalDurationSeconds,
    totalHoldingDays,
    totalTradesCount,
    totalWinningTrades,
    sessions.length > 0 ? avgSessionReturnPct : 0,
    sessions.length > 0 ? bestSessionReturnPct : 0,
    sessions.length > 0 ? worstSessionReturnPct : 0,
    maxDrawdownPct,
    nowSec,
    profileId
  )
}

const normalizeProfileName = (name: string): string => String(name || '').trim()

const ensureActiveProfileExists = (database: ReturnType<typeof getBlindDb>) => {
  const active = database.prepare('SELECT id FROM training_profiles WHERE is_active = 1 LIMIT 1').get() as { id: string } | undefined
  if (active) return

  const fallback = database.prepare('SELECT id FROM training_profiles ORDER BY updated_at DESC, created_at DESC LIMIT 1').get() as { id: string } | undefined
  if (fallback) {
    database.prepare('UPDATE training_profiles SET is_active = 1, updated_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), fallback.id)
    return
  }

  database.prepare(`
    INSERT OR IGNORE INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
    VALUES ('default', '默认存档', 100000, 100000, 1, strftime('%s','now'), strftime('%s','now'))
  `).run()
}

export const registerBlindIpc = () => {
  ipcMain.handle('db:getStatistics', async () => {
    const database = getBlindDb()
    const sessions = database.prepare('SELECT COUNT(*) as count FROM training_sessions').get() as { count: number }
    const labels = database.prepare('SELECT COUNT(*) as count FROM labels').get() as { count: number }

    const buyLabels = database.prepare("SELECT COUNT(*) as count FROM labels WHERE label_type = 'buy' AND status = 'accepted'").get() as { count: number }
    const sellLabels = database.prepare("SELECT COUNT(*) as count FROM labels WHERE label_type = 'sell' AND status = 'accepted'").get() as { count: number }

    const totalTrades = Math.min(buyLabels.count, sellLabels.count)
    let winRate = 0
    if (totalTrades > 0) {
      const winningTrades = database.prepare(`
        SELECT COUNT(*) as count FROM labels l_buy
        INNER JOIN labels l_sell ON l_sell.bar_index > l_buy.bar_index AND l_sell.session_id = l_buy.session_id
        WHERE l_buy.label_type = 'buy' AND l_buy.status = 'accepted'
        AND l_sell.label_type = 'sell' AND l_sell.status = 'accepted'
      `).get() as { count: number }
      winRate = winningTrades.count / totalTrades
    }

    return { totalSessions: sessions.count, totalLabels: labels.count, winRate }
  })

  ipcMain.handle('db:saveSession', async (_, session: SaveSessionInput) => {
    const database = getBlindDb()
    const id = typeof session.id === 'string' && session.id.trim().length > 0
      ? session.id
      : `session_${Date.now()}`
    const now = Math.floor(Date.now() / 1000)
    const profileId = session.profileId || 'default'

    try {
      database.prepare(`
        INSERT INTO training_sessions 
        (id, sample_id, stock_code, stock_name, interval_type, started_at, status, initial_capital, created_at, profile_id)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(
        id,
        session.sampleId,
        session.stockCode,
        session.stockName,
        session.intervalType,
        session.startedAt,
        session.initialCapital,
        now,
        profileId
      )
      log.info(`[blind] saveSession OK: id=${id} code=${session.stockCode} profile=${profileId}`)
    } catch (err) {
      log.error(`[blind] saveSession ERROR:`, err)
      return { ...session, id, error: String(err) }
    }

    return { ...session, id }
  })

  ipcMain.handle('db:finishSession', async (_, sessionId, finalCapital, realizedPnl, context) => {
    const database = getBlindDb()
    const nowMs = Date.now()
    const nowSec = Math.floor(nowMs / 1000)
    const session = database.prepare(`
      SELECT profile_id, started_at, initial_capital, interval_type, status, finished_at
      FROM training_sessions
      WHERE id = ?
      LIMIT 1
    `).get(sessionId) as {
      profile_id: string
      started_at: number
      initial_capital: number
      interval_type: string
      status: string
      finished_at: number | null
    } | undefined

    if (!session) {
      log.error(`[blind] finishSession missing session: ${sessionId}`)
      return { success: false }
    }

    const alreadyFinished = session.status === 'finished' || Number(session.finished_at || 0) > 0
    database.prepare(`
      UPDATE training_sessions
      SET finished_at = COALESCE(finished_at, ?),
          status = 'finished',
          final_capital = ?,
          realized_pnl = ?
      WHERE id = ?
    `).run(nowMs, finalCapital, realizedPnl, sessionId)

    // Resolve profile_id: session DB record > context > 'default'
    const profileId = session.profile_id
      || (context as Record<string, unknown> | undefined)?.profileId as string | undefined
      || 'default'

    log.info(`[blind] finishSession: session=${sessionId} profile=${profileId} final=${finalCapital} pnl=${realizedPnl} alreadyFinished=${alreadyFinished}`)

    const review = recomputeAndSaveSessionReview(sessionId)
    rebuildProfileAggregate(database, profileId, nowSec)

    const updatedProfile = database.prepare('SELECT current_capital, total_sessions, total_pnl FROM training_profiles WHERE id = ?').get(profileId) as { current_capital: number; total_sessions: number; total_pnl: number } | undefined
    log.info(`[blind] finishSession profile rebuilt: id=${profileId} capital=${updatedProfile?.current_capital} sessions=${updatedProfile?.total_sessions} pnl=${updatedProfile?.total_pnl} review=${!!review}`)

    return { success: true }
  })

  ipcMain.handle('db:saveTradeAction', async (_, action) => saveTradeActionToDb(action))

  ipcMain.handle('db:saveLabel', async (_, payload: {
    sessionId: string
    barIndex: number
    labelType: 'buy' | 'sell' | 'hold' | 'no_action'
    source: string
    status?: 'proposed' | 'accepted' | 'rejected' | 'modified'
    confidence?: number
  }) => {
    try {
      const db = getBlindDb()
      const id = `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO labels (id, session_id, bar_index, label_type, source, status, confidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        payload.sessionId,
        payload.barIndex,
        payload.labelType,
        payload.source,
        payload.status || 'proposed',
        payload.confidence ?? 0.5,
        now,
        now
      )
      return { id, success: true }
    } catch (error) {
      log.error('[blind] saveLabel ERROR:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('db:getSessionActions', async (_, sessionId) => getSessionActionsFromDb(sessionId))

  ipcMain.handle('db:getPreference', async (_, key: string) => {
    try {
      const row = getDb()
        .prepare('SELECT value_json FROM app_preferences WHERE key = ? LIMIT 1')
        .get(key) as { value_json?: string } | undefined
      if (!row?.value_json) return null
      return JSON.parse(row.value_json)
    } catch {
      return null
    }
  })

  ipcMain.handle('db:savePreference', async (_, key: string, value: unknown) => {
    try {
      const now = Math.floor(Date.now() / 1000)
      getDb().prepare(`
        INSERT INTO app_preferences (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).run(key, JSON.stringify(value ?? null), now)
      return true
    } catch (error) {
      console.error('savePreference failed:', error)
      return false
    }
  })

  ipcMain.handle('db:getSessionReview', async (_, sessionId) => {
    const database = getBlindDb()
    const review = database.prepare('SELECT * FROM session_reviews WHERE session_id = ? LIMIT 1').get(sessionId) as SessionReview | undefined
    if (review) return review
    return recomputeAndSaveSessionReview(sessionId)
  })

  ipcMain.handle('db:listSessions', async () => {
    const database = getBlindDb()
    return database.prepare(`
      SELECT
        s.*,
        r.trade_win_rate,
        r.realized_pnl_pct,
        r.max_drawdown_pct,
        r.buy_count,
        r.sell_count,
        r.hold_count,
        r.avg_holding_bars,
        r.avg_holding_days,
        r.avg_daily_return_pct,
        r.win_hold_efficiency,
        r.total_trades,
        r.winning_trades
      FROM training_sessions s
      LEFT JOIN session_reviews r ON r.session_id = s.id
      ORDER BY s.started_at DESC
      LIMIT 100
    `).all()
  })

  ipcMain.handle('aichat:getRecentSessions', async (_, limit = 5) => {
    const db = getBlindDb()
    const sessions = db.prepare(`
      SELECT
        s.id, s.stock_code, s.stock_name, s.interval_type,
        s.initial_capital, s.final_capital, s.realized_pnl,
        s.total_trades, s.winning_trades, s.started_at, s.finished_at,
        r.trade_win_rate, r.realized_pnl_pct, r.max_drawdown_pct,
        r.buy_count, r.sell_count, r.hold_count, r.avg_holding_bars
      FROM training_sessions s
      LEFT JOIN session_reviews r ON r.session_id = s.id
      WHERE s.status = 'finished'
      ORDER BY s.started_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>

    return sessions.map((s) => {
      const actions = db.prepare(
        'SELECT action_type, price, bar_index, realized_pnl FROM trade_actions WHERE session_id = ? ORDER BY bar_index ASC'
      ).all(s.id) as Array<Record<string, unknown>>
      return { ...s, actions }
    })
  })

  ipcMain.handle('profile:list', async () => {
    const database = getBlindDb()
    return database.prepare('SELECT * FROM training_profiles ORDER BY created_at ASC').all()
  })

  ipcMain.handle('profile:getActive', async () => {
    const db = getBlindDb()
    let profile = db.prepare('SELECT * FROM training_profiles WHERE is_active = 1 LIMIT 1').get() as Record<string, unknown> | undefined
    log.info(`[blind] getActive: found=${!!profile}`)
    if (!profile) {
      const fallback = db.prepare('SELECT id FROM training_profiles ORDER BY updated_at DESC, created_at DESC LIMIT 1').get() as { id: string } | undefined
      if (fallback) {
        const now = Math.floor(Date.now() / 1000)
        db.transaction(() => {
          db.prepare('UPDATE training_profiles SET is_active = 0 WHERE is_active = 1').run()
          db.prepare('UPDATE training_profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(now, fallback.id)
        })()
        profile = db.prepare('SELECT * FROM training_profiles WHERE id = ?').get(fallback.id) as Record<string, unknown>
        log.info(`[blind] getActive: restored fallback profile=${fallback.id}, found=${!!profile}`)
      } else {
        db.prepare(`INSERT OR IGNORE INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at) VALUES ('default', '默认存档', 100000, 100000, 1, strftime('%s','now'), strftime('%s','now'))`).run()
        profile = db.prepare('SELECT * FROM training_profiles WHERE id = ?').get('default') as Record<string, unknown>
        log.info(`[blind] getActive: created default, found=${!!profile}`)
      }
    }
    return profile
  })

  ipcMain.handle('profile:create', async (_, name: string, initialCapital: number) => {
    const db = getBlindDb()
    const normalizedName = normalizeProfileName(name)
    if (!normalizedName) {
      throw new Error('账户名称不能为空')
    }
    const exists = db.prepare('SELECT id FROM training_profiles WHERE lower(name) = lower(?) LIMIT 1').get(normalizedName) as { id: string } | undefined
    if (exists) {
      throw new Error('账户名称已存在，请使用其他名称')
    }

    const safeCapital = Number(initialCapital)
    if (!Number.isFinite(safeCapital) || safeCapital <= 0) {
      throw new Error('初始资金必须大于 0')
    }

    const id = `profile_${Date.now()}`
    const now = Math.floor(Date.now() / 1000)
    db.transaction(() => {
      db.prepare('UPDATE training_profiles SET is_active = 0 WHERE is_active = 1').run()
      db.prepare(`
        INSERT INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(id, normalizedName, safeCapital, safeCapital, now, now)
    })()
    return db.prepare('SELECT * FROM training_profiles WHERE id = ?').get(id)
  })

  ipcMain.handle('profile:load', async (_, profileId: string) => {
    const db = getBlindDb()
    db.transaction(() => {
      db.prepare('UPDATE training_profiles SET is_active = 0 WHERE is_active = 1').run()
      db.prepare('UPDATE training_profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), profileId)
    })()
    return db.prepare('SELECT * FROM training_profiles WHERE id = ?').get(profileId)
  })

  ipcMain.handle('profile:delete', async (_, profileId: string) => {
    const db = getBlindDb()
    const targetId = String(profileId || '').trim()
    if (!targetId) return { success: false, error: 'invalid_profile_id' }
    if (targetId === 'default') return { success: false, error: 'Cannot delete default profile' }

    const active = db.prepare('SELECT id FROM training_profiles WHERE is_active = 1 AND id = ?').get(targetId)
    if (active) return { success: false, error: 'Cannot delete active profile' }

    const existing = db.prepare('SELECT id FROM training_profiles WHERE id = ? LIMIT 1').get(targetId) as { id: string } | undefined
    if (!existing) return { success: false, error: 'Profile not found' }

    const deleted = db.transaction(() => {
      const labelsDeleted = db.prepare(`
        DELETE FROM labels
        WHERE session_id IN (SELECT id FROM training_sessions WHERE profile_id = ?)
      `).run(targetId).changes
      const actionsDeleted = db.prepare(`
        DELETE FROM trade_actions
        WHERE session_id IN (SELECT id FROM training_sessions WHERE profile_id = ?)
      `).run(targetId).changes
      const reviewsDeleted = db.prepare(`
        DELETE FROM session_reviews
        WHERE session_id IN (SELECT id FROM training_sessions WHERE profile_id = ?)
      `).run(targetId).changes
      const sessionsDeleted = db.prepare('DELETE FROM training_sessions WHERE profile_id = ?').run(targetId).changes
      const profileDeleted = db.prepare('DELETE FROM training_profiles WHERE id = ?').run(targetId).changes
      ensureActiveProfileExists(db)
      return { labelsDeleted, actionsDeleted, reviewsDeleted, sessionsDeleted, profileDeleted }
    })()

    log.info('[blind] profile:delete success', {
      profileId: targetId,
      ...deleted
    })

    return { success: deleted.profileDeleted > 0 }
  })

  ipcMain.handle('profile:resetCapital', async (_, profileId: string, newCapital: number) => {
    const db = getBlindDb()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      UPDATE training_profiles SET
        current_capital = ?,
        total_sessions = 0,
        total_pnl = 0,
        total_wins = 0,
        total_losses = 0,
        total_duration_seconds = 0,
        total_holding_days = 0,
        total_trades_count = 0,
        total_winning_trades = 0,
        avg_session_return_pct = 0,
        best_session_return_pct = 0,
        worst_session_return_pct = 0,
        max_drawdown_pct = 0,
        updated_at = ?
      WHERE id = ?
    `).run(newCapital, now, profileId)
    return db.prepare('SELECT * FROM training_profiles WHERE id = ?').get(profileId)
  })

  ipcMain.handle('profile:getStats', async (_, profileId?: string) => {
    const db = getBlindDb()
    const targetId = profileId || 'default'
    const profile = db.prepare('SELECT * FROM training_profiles WHERE id = ?').get(targetId) as Record<string, unknown> | undefined
    if (!profile) return null

    const dailyStats = db.prepare(`
      SELECT date(s.started_at / 1000, 'unixepoch', 'localtime') as day,
             COUNT(*) as count,
             AVG(r.realized_pnl_pct) as avg_pnl_pct,
             SUM(s.realized_pnl) as total_pnl,
             AVG(r.trade_win_rate) as avg_win_rate,
             AVG(r.avg_daily_return_pct) as avg_daily_return_pct
      FROM training_sessions s
      LEFT JOIN session_reviews r ON r.session_id = s.id
      WHERE s.profile_id = ? AND s.status = 'finished'
      GROUP BY day
      ORDER BY day ASC
    `).all(targetId) as Array<Record<string, unknown>>

    const sessionTrend = db.prepare(`
      SELECT s.started_at as date, r.realized_pnl_pct as pnlPct
      FROM training_sessions s
      LEFT JOIN session_reviews r ON r.session_id = s.id
      WHERE s.profile_id = ? AND s.status = 'finished'
      ORDER BY s.started_at ASC
    `).all(targetId) as Array<{ date: number; pnlPct: number }>

    return {
      profile,
      sessionTrend,
      dailyStats: dailyStats.map((d) => ({
        day: String(d.day || ''),
        count: Number(d.count || 0),
        avgPnlPct: Number(d.avg_pnl_pct || 0),
        totalPnl: Number(d.total_pnl || 0),
        avgWinRatePct: Number(d.avg_win_rate || 0) * 100,
        avgDailyReturnPct: Number(d.avg_daily_return_pct || 0)
      }))
    }
  })

  ipcMain.handle('simulation:startSession', async (_, sampleId) => {
    return {
      id: `session_${Date.now()}`,
      sampleId,
      status: 'running',
      currentBarIndex: 0,
      positionState: 'flat',
      startedAt: new Date().toISOString()
    }
  })

  ipcMain.handle('simulation:getSession', async (_, sessionId) => {
    const session = getBlindDb().prepare('SELECT * FROM training_sessions WHERE id = ?').get(sessionId)
    return session || {
      id: sessionId,
      sampleId: 'sample_001',
      status: 'running',
      currentBarIndex: 0,
      positionState: 'flat',
      startedAt: new Date().toISOString()
    }
  })

  ipcMain.handle('simulation:applyAction', async (_, action) => saveTradeActionToDb(action))

  ipcMain.handle('simulation:step', async (_, sessionId) => {
    return {
      id: sessionId,
      currentBarIndex: 1,
      positionState: 'flat'
    }
  })

  ipcMain.handle('simulation:finish', async (_, sessionId) => {
    return {
      id: sessionId,
      status: 'finished',
      finishedAt: new Date().toISOString()
    }
  })

  ipcMain.handle('simulation:getReview', async (_, sessionId) => {
    const review = recomputeAndSaveSessionReview(sessionId)
    const session = getBlindDb().prepare('SELECT initial_capital, final_capital FROM training_sessions WHERE id = ? LIMIT 1').get(sessionId) as {
      initial_capital?: number
      final_capital?: number | null
    } | undefined

    const baseCapital = Number(session?.initial_capital || 0)
    const finalCapital = Number(session?.final_capital ?? baseCapital)
    const netPct = baseCapital > 0 ? ((finalCapital - baseCapital) / baseCapital) * 100 : 0

    return {
      id: review?.id || `review_${Date.now()}`,
      sessionId,
      tradeWinRate: review?.trade_win_rate ?? 0,
      realizedPnlPct: review?.realized_pnl_pct ?? netPct,
      maxDrawdownPct: review?.max_drawdown_pct ?? 0,
      mfeAvgPct: 3.2,
      maeAvgPct: 1.8,
      entryEfficiencyScore: 0.8,
      exitEfficiencyScore: 0.7,
      disciplineScore: 0.85,
      skipQuality: 'good'
    }
  })

  registerAgentIpc()
}
