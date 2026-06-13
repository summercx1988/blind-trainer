import { ipcMain } from 'electron'
import { getDb } from '../db'
import { fail, ok } from './platformResult'

interface CandidateFilter {
  status?: string
  code?: string
  period?: string
  limit?: number
}

interface ModelCandidateDeps {
  isSupportedPeriod: (period: string) => boolean
  generateFactorCandidates: (code: string, period: string, limit: number) => unknown
}

export const registerModelCandidateIpcHandlers = (deps: ModelCandidateDeps) => {
  const { isSupportedPeriod, generateFactorCandidates } = deps

  ipcMain.handle('modeling:generateCandidates', async (_, code: string, period: string, limit?: number) => {
    if (!isSupportedPeriod(period)) {
      return fail('CANDIDATE_GENERATE_UNSUPPORTED_PERIOD', '不支持的候选生成周期。', { code, period })
    }
    const result = generateFactorCandidates(code, period, typeof limit === 'number' ? limit : 260) as Record<string, unknown>
    if (typeof result.reason === 'string') {
      if (result.reason === 'kline_not_enough') {
        return fail('CANDIDATE_GENERATE_KLINE_NOT_ENOUGH', 'K 线数量不足，无法生成候选信号。', result)
      }
      return fail('CANDIDATE_GENERATE_FAILED', `候选信号生成失败：${result.reason}。`, result)
    }
    return ok({
      code: typeof result.code === 'string' ? result.code : code,
      period: typeof result.period === 'string' ? result.period : period,
      created: Number(result.created || 0),
      factors: Array.isArray(result.factors) ? result.factors.filter((item): item is string => typeof item === 'string') : undefined,
      candidates: Array.isArray(result.candidates) ? result.candidates.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : undefined,
      minRequired: typeof result.minRequired === 'number' ? result.minRequired : undefined,
      available: typeof result.available === 'number' ? result.available : undefined,
    })
  })

  ipcMain.handle('modeling:listCandidates', async (_, filters?: CandidateFilter) => {
    const whereParts: string[] = []
    const values: Array<string | number> = []
    if (filters?.status) {
      whereParts.push('status = ?')
      values.push(filters.status)
    }
    if (filters?.code) {
      whereParts.push('code = ?')
      values.push(filters.code)
    }
    if (filters?.period) {
      whereParts.push('period = ?')
      values.push(filters.period)
    }
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    const limit = Math.min(500, Math.max(1, Number(filters?.limit || 100)))
    values.push(limit)

    return getDb().prepare(`
      SELECT *
      FROM signal_candidates
      ${whereSql}
      ORDER BY bar_timestamp DESC, created_at DESC
      LIMIT ?
    `).all(...values)
  })

  ipcMain.handle('modeling:reviewSignalCandidate', async (_, candidateId: string, decision: 'accept' | 'reject' | 'edit', note?: string) => {
    const database = getDb()
    const targetId = String(candidateId || '').trim()
    if (!targetId) {
      return fail('CANDIDATE_REVIEW_INVALID_ID', '候选信号 ID 无效。')
    }
    const status = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : 'edited'
    const now = Math.floor(Date.now() / 1000)

    const updateResult = database.prepare('UPDATE signal_candidates SET status = ?, updated_at = ? WHERE id = ?').run(status, now, targetId)
    if (updateResult.changes <= 0) {
      return fail('CANDIDATE_REVIEW_NOT_FOUND', '未找到待审核的候选信号。', { candidateId: targetId })
    }
    database.prepare(`
      INSERT INTO candidate_review_logs (id, candidate_id, action, operator, note, created_at)
      VALUES (?, ?, ?, 'user', ?, ?)
    `).run(`cand_log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, targetId, decision, note || null, now)

    return ok({ candidateId: targetId, status })
  })
}
