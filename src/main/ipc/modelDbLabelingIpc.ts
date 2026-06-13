import { ipcMain } from 'electron'
import { getDb } from '../db'
import { getBlindDb } from '../blindDb'
import { fail, ok } from './platformResult'

interface ModelDbLabelingDeps {
  saveLabelToDb: (label: unknown) => unknown
  updateLabelStatusInDb: (labelId: string, status: string, userConfidence?: number) => void
}

interface LabelRowForExport {
  barIndex?: number
  bar_index?: number
  labelType?: string
  label_type?: string
  source?: string
  strategyId?: string
  confidence?: number
  status?: string
  reason?: string
}

interface LabelUpdateInput {
  id?: string
  status?: string
  userConfidence?: number
}

export const registerModelDbLabelingIpcHandlers = (deps: ModelDbLabelingDeps) => {
  const { saveLabelToDb, updateLabelStatusInDb } = deps

  const saveLabelToBlindDb = (label: unknown) => {
    const row = (label && typeof label === 'object') ? label as Record<string, unknown> : {}
    const sessionId = String(row.sessionId || row.session_id || '').trim()
    const barIndex = Number(row.barIndex ?? row.bar_index ?? 0)
    const labelType = String(row.labelType || row.label_type || 'hold')
    const source = String(row.source || 'manual')
    const strategyId = row.strategyId ? String(row.strategyId) : (row.strategy_id ? String(row.strategy_id) : null)
    const confidence = Number(row.confidence ?? 0.5)
    const userConfidence = row.userConfidence == null ? null : Number(row.userConfidence)
    const status = String(row.status || 'proposed')
    const reason = row.reason ? String(row.reason) : null
    const note = row.note ? String(row.note) : null
    const id = `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Math.floor(Date.now() / 1000)

    getBlindDb().prepare(`
      INSERT INTO labels
      (id, session_id, bar_index, label_type, source, strategy_id, confidence, user_confidence, status, reason, note, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, sessionId, barIndex, labelType, source, strategyId, confidence, userConfidence, status, reason, note, now, now)

    return { ...row, id, createdAt: now * 1000 }
  }

  ipcMain.handle('db:saveLabel', async (_, label: unknown) => {
    return saveLabelToBlindDb(label)
  })

  ipcMain.handle('db:updateLabelStatus', async (_, labelId: string, status: string, userConfidence?: number) => {
    const targetId = String(labelId || '').trim()
    if (!targetId) {
      return fail('LABEL_STATUS_INVALID_ID', '标签 ID 无效。')
    }
    try {
      const blindDb = getBlindDb()
      const changed = blindDb.prepare(`
        UPDATE labels
        SET status = ?, updated_at = ?, user_confidence = COALESCE(?, user_confidence)
        WHERE id = ?
      `).run(status, Math.floor(Date.now() / 1000), userConfidence, targetId).changes
      if (changed === 0) {
        updateLabelStatusInDb(targetId, status, userConfidence)
      }
      return ok({ labelId: targetId, status, userConfidence })
    } catch (error) {
      return fail('LABEL_STATUS_UPDATE_FAILED', error instanceof Error ? error.message : 'unknown_error', {
        labelId: targetId,
        status,
      })
    }
  })

  ipcMain.handle('db:getSessionLabels', async (_, sessionId: string) => {
    return getBlindDb().prepare('SELECT * FROM labels WHERE session_id = ? ORDER BY bar_index').all(sessionId)
  })

  ipcMain.handle('db:exportLabelsCSV', async (_, sessionId: string) => {
    const labels = getBlindDb().prepare('SELECT * FROM labels WHERE session_id = ? ORDER BY bar_index').all(sessionId) as LabelRowForExport[]
    if (labels.length === 0) return ''

    const headers = ['bar_index', 'label_type', 'source', 'strategy_id', 'confidence', 'status', 'reason']
    const rows = labels.map((label) => [
      label.barIndex !== undefined ? label.barIndex : label.bar_index,
      label.labelType !== undefined ? label.labelType : label.label_type,
      label.source,
      label.strategyId || '',
      (label.confidence || 0).toFixed(2),
      label.status,
      label.reason || ''
    ])

    return [headers, ...rows].map((row) => row.join(',')).join('\n')
  })

  ipcMain.handle('labeling:listLabels', async () => {
    return getDb().prepare('SELECT * FROM labels ORDER BY created_at DESC LIMIT 100').all()
  })

  ipcMain.handle('labeling:createLabel', async (_, label: unknown) => {
    return saveLabelToDb(label)
  })

  ipcMain.handle('labeling:updateLabel', async (_, label: LabelUpdateInput) => {
    if (label.id && label.status) {
      updateLabelStatusInDb(label.id, label.status, label.userConfidence)
    }
    return label
  })

  ipcMain.handle('labeling:listReviewQueue', async () => {
    return getDb().prepare("SELECT * FROM labels WHERE status = 'proposed' ORDER BY created_at DESC LIMIT 50").all()
  })

  ipcMain.handle('labeling:reviewCandidate', async (_, labelId: string, decision: string) => {
    const targetId = String(labelId || '').trim()
    if (!targetId) {
      return fail('LABEL_REVIEW_INVALID_ID', '标签 ID 无效。')
    }
    const status = decision === 'accept' ? 'accepted' : 'rejected'
    try {
      updateLabelStatusInDb(targetId, status)
      return ok({ labelId: targetId, status })
    } catch (error) {
      return fail('LABEL_REVIEW_FAILED', error instanceof Error ? error.message : 'unknown_error', {
        labelId: targetId,
        decision,
      })
    }
  })
}
