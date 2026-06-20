import { ipcMain, shell } from 'electron'
import fs from 'fs'
import log from '../logger'
import { getDb } from '../db'
import { getBlindDb } from '../blindDb'
import { ok, fail } from './platformResult'
import { computeHabitIndicators } from '../services/habit-analyzer'
import { buildMessages, parseReportResponse, selectRepresentativeSessions } from '../services/ai-advisor'
import { callLlm, testConnection } from '../services/ai-client'
import { resolveEndpoint, DEFAULT_BASE_URL, DEFAULT_MODEL } from '../services/endpoint-resolver'
import { reportToMarkdown, buildReportFilename, saveReportMd, getReportsDir } from '../services/md-exporter'
import {
  readConfigFromFile,
  writeConfigToFile,
  maskApiKey,
  getConfigPath,
  migrateFromSqlite,
} from '../services/ai-config'
import { DEFAULT_HABIT_CONFIG } from '../../types/agent'
import type {
  AiAdvisorConfig,
  AdvisorReport,
  HabitProfile,
  HabitIndicators,
  TradeActionRow,
  SessionReviewRow,
  SessionRow,
} from '../../types/agent'

const MIN_SESSIONS = 3

// 首次加载时尝试从老 SQLite 迁移
let _migrated = false
const ensureMigrated = () => {
  if (_migrated) return
  _migrated = true
  const { migrated } = migrateFromSqlite()
  if (migrated) log.info('[agent] SQLite → ai-config.env 迁移完成')
}

/**
 * 读取 AI 配置。优先级: ai-config.env 文件 → ANTHROPIC_* 环境变量 → 默认值。
 * 不再读写 SQLite, 旧 SQLite 数据在首次启动时迁移到 env 文件。
 */
const readConfig = (): AiAdvisorConfig => {
  ensureMigrated()
  const file = readConfigFromFile()
  // 兼容旧字段名 endpoint → baseUrl（老配置迁移后字段）
  const baseUrl = file.baseUrl
    || process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL
  const apiKey = file.apiKey || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || ''
  const model = file.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  return { baseUrl, apiKey, model, ready: Boolean(apiKey) }
}

interface ProfileData {
  sessions: SessionRow[]
  actions: TradeActionRow[]
  reviews: SessionReviewRow[]
}

const loadProfileData = (profileId: string): ProfileData => {
  const db = getBlindDb()
  const sessions = db.prepare(`
    SELECT id, stock_code, stock_name, interval_type, initial_capital, realized_pnl, status, started_at
    FROM training_sessions
    WHERE profile_id = ? AND status = 'finished'
    ORDER BY started_at ASC
  `).all(profileId) as SessionRow[]
  const sessionIds = sessions.map(s => s.id)
  if (sessionIds.length === 0) {
    return { sessions: [], actions: [], reviews: [] }
  }
  const placeholders = sessionIds.map(() => '?').join(',')
  const actions = db.prepare(`
    SELECT session_id, bar_index, action_type, price, shares, amount, realized_pnl, created_at
    FROM trade_actions
    WHERE session_id IN (${placeholders})
    ORDER BY created_at ASC
  `).all(...sessionIds) as TradeActionRow[]
  const reviews = db.prepare(`
    SELECT session_id, trade_win_rate, realized_pnl, realized_pnl_pct, max_drawdown_pct,
           buy_count, sell_count, hold_count, avg_holding_bars, total_trades, winning_trades
    FROM session_reviews
    WHERE session_id IN (${placeholders})
  `).all(...sessionIds) as SessionReviewRow[]
  return { sessions, actions, reviews }
}

export function registerAgentIpc() {
  ipcMain.handle('agent:getConfig', async () => {
    const c = readConfig()
    return {
      baseUrl: c.baseUrl,
      model: c.model,
      ready: c.ready,
      apiKeyMasked: maskApiKey(c.apiKey),
      configPath: getConfigPath(),
      fileExists: fs.existsSync(getConfigPath()),
    }
  })

  ipcMain.handle('agent:saveConfig', async (_, payload: { baseUrl?: string; endpoint?: string; apiKey?: string; model?: string }) => {
    try {
      const current = readConfig()
      // 兼容两种字段名；baseUrl 优先，其次 endpoint（老前端）
      const baseUrl = payload.baseUrl !== undefined
        ? payload.baseUrl
        : (payload.endpoint !== undefined ? payload.endpoint : current.baseUrl)
      // apiKey 留空 = 保持原值 (与现有 UI 行为一致)
      const apiKey = payload.apiKey || current.apiKey
      writeConfigToFile({
        baseUrl,
        apiKey,
        model: payload.model || current.model,
      })
      return { success: true }
    } catch (error) {
      log.error('[agent] saveConfig ERROR:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:getConfigPath', async () => getConfigPath())

  ipcMain.handle('agent:openConfigFile', async () => {
    try {
      const file = getConfigPath()
      // 文件不存在时先创建空模板
      if (!fs.existsSync(file)) writeConfigToFile({})
      await shell.openPath(file)
      return { success: true }
    } catch (error) {
      log.error('[agent] openConfigFile ERROR:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:testConnection', async () => {
    const result = await testConnection(readConfig())
    return result
  })

  ipcMain.handle('agent:analyzeHabits', async (_, payload: { profileId: string }) => {
    try {
      const { sessions, actions, reviews } = loadProfileData(payload.profileId)
      if (sessions.length < MIN_SESSIONS) {
        return fail('insufficient_data', `至少需要 ${MIN_SESSIONS} 场已结束训练，当前 ${sessions.length} 场`)
      }
      const indicators: HabitIndicators = computeHabitIndicators(actions, reviews, sessions, DEFAULT_HABIT_CONFIG)
      const db = getBlindDb()
      const id = `habit_${Date.now()}`
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO habits_profile (id, profile_id, computed_at, session_count, indicators_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, payload.profileId, now, sessions.length, JSON.stringify(indicators))
      const profile: HabitProfile = { id, profile_id: payload.profileId, computed_at: now, session_count: sessions.length, indicators }
      return ok(profile)
    } catch (error) {
      log.error('[agent] analyzeHabits ERROR:', error)
      return fail('analyze_failed', String(error))
    }
  })

  ipcMain.handle('agent:generateReport', async (_, payload: { profileId: string; habitProfileId?: string; force?: boolean }) => {
    try {
      const db = getBlindDb()
      let habitProfile: HabitProfile | null = null
      if (payload.habitProfileId) {
        const row = db.prepare('SELECT * FROM habits_profile WHERE id = ? LIMIT 1').get(payload.habitProfileId) as (Omit<HabitProfile, 'indicators'> & { indicators_json: string }) | undefined
        if (row) habitProfile = { id: row.id, profile_id: row.profile_id, computed_at: row.computed_at, session_count: row.session_count, indicators: JSON.parse(row.indicators_json) }
      } else {
        const row = db.prepare('SELECT * FROM habits_profile WHERE profile_id = ? ORDER BY computed_at DESC LIMIT 1').get(payload.profileId) as (Omit<HabitProfile, 'indicators'> & { indicators_json: string }) | undefined
        if (row) habitProfile = { id: row.id, profile_id: row.profile_id, computed_at: row.computed_at, session_count: row.session_count, indicators: JSON.parse(row.indicators_json) }
      }
      if (!habitProfile) {
        return fail('no_habit_profile', '请先生成习惯诊断')
      }

      if (!payload.force) {
        const cached = db.prepare(`
          SELECT * FROM ai_reports WHERE habit_profile_id = ? ORDER BY created_at DESC LIMIT 1
        `).get(habitProfile.id) as Record<string, unknown> | undefined
        if (cached && !cached.error) {
          return ok(cached)
        }
      }

      const config = readConfig()
      if (!config.ready) return fail('not_configured', '请先在设置中配置 AI 助手')
      const { sessions, actions, reviews } = loadProfileData(payload.profileId)
      const repSessions = selectRepresentativeSessions(
        sessions.map(s => ({ id: s.id, stock_code: s.stock_code, stock_name: s.stock_name, interval_type: s.interval_type, realized_pnl: s.realized_pnl, status: s.status })),
        actions,
        reviews.map(r => ({ session_id: r.session_id, realized_pnl_pct: r.realized_pnl_pct, total_trades: r.total_trades, trade_win_rate: r.trade_win_rate }))
      )
      const messages = buildMessages(habitProfile, repSessions)
      const endpoint = resolveEndpoint(config.baseUrl)
      const llmResult = await callLlm(config, endpoint, messages)

      const parsed = parseReportResponse(llmResult.content)
      const reportId = `report_${Date.now()}`
      const errorStr = !llmResult.ok ? llmResult.error : parsed.error
      db.prepare(`
        INSERT INTO ai_reports (id, profile_id, habit_profile_id, report_json, raw_response, model, prompt_tokens, completion_tokens, duration_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId, payload.profileId, habitProfile.id,
        JSON.stringify(parsed.report),
        llmResult.content || null,
        config.model,
        llmResult.promptTokens, llmResult.completionTokens, llmResult.durationMs,
        errorStr
      )
      const record = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(reportId)

      // md 导出（失败不阻塞报告生成）
      let mdPath: string | null = null
      let mdError: string | null = null
      try {
        const profileRow = getDb().prepare('SELECT name FROM training_profiles WHERE id = ?').get(payload.profileId) as { name?: string } | undefined
        const profileName = profileRow?.name ?? payload.profileId
        const nowSec = Math.floor(Date.now() / 1000)
        const reportMeta = { profileId: payload.profileId, profileName, sessionCount: habitProfile.session_count, model: config.model, createdAt: nowSec }
        const mdContent = reportToMarkdown(parsed.report as AdvisorReport, habitProfile.indicators, reportMeta)
        const filename = buildReportFilename(reportMeta, habitProfile.indicators)
        mdPath = saveReportMd(filename, mdContent)
      } catch (e) {
        mdError = String(e)
        log.error('[agent] md export failed:', e)
      }

      if (!llmResult.ok) return fail(llmResult.error || 'llm_failed', `LLM 调用失败：${llmResult.error}`)
      return ok({ ...(record as Record<string, unknown>), md_path: mdPath, md_error: mdError, representative_sessions: repSessions })
    } catch (error) {
      log.error('[agent] generateReport ERROR:', error)
      return fail('generate_failed', String(error))
    }
  })

  ipcMain.handle('agent:listReports', async (_, payload: { profileId: string; limit?: number }) => {
    try {
      const db = getBlindDb()
      const limit = payload.limit ?? 20
      return ok(db.prepare(`
        SELECT * FROM ai_reports WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(payload.profileId, limit))
    } catch (error) {
      log.error('[agent] listReports ERROR:', error)
      return fail('list_reports_failed', String(error))
    }
  })

  ipcMain.handle('agent:getHabitHistory', async (_, payload: { profileId: string; limit?: number }) => {
    try {
      const db = getBlindDb()
      const limit = payload.limit ?? 20
      const rows = db.prepare(`
        SELECT * FROM habits_profile WHERE profile_id = ? ORDER BY computed_at DESC LIMIT ?
      `).all(payload.profileId, limit) as Array<Omit<HabitProfile, 'indicators'> & { indicators_json: string }>
      return ok(rows.map(r => ({ ...r, indicators: JSON.parse(r.indicators_json) })))
    } catch (error) {
      log.error('[agent] getHabitHistory ERROR:', error)
      return fail('get_habit_history_failed', String(error))
    }
  })

  ipcMain.handle('agent:openReportsFolder', async () => {
    try {
      const dir = getReportsDir()
      fs.mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
      return { success: true }
    } catch (error) {
      log.error('[agent] openReportsFolder ERROR:', error)
      return { success: false, error: String(error) }
    }
  })
}
