import { getDb } from '../db'

export type ConflictPolicy = 'keep_all' | 'single_best'

export interface RecordDatasetPolicyEvaluationInput {
  mode: 'draft_preview' | 'dataset_compare' | 'dataset_merge'
  leftDatasetId?: string | null
  rightDatasetId?: string | null
  filters?: Record<string, unknown> | null
  summary?: Record<string, unknown> | null
  recommendedPolicy?: ConflictPolicy | null
  selectedPolicy?: ConflictPolicy | null
  appliedDatasetId?: string | null
}

export const recommendConflictPolicy = (
  conflictBarCount: number,
  sameBarMultiLabelCount: number,
  totalBars: number
): ConflictPolicy => {
  if (totalBars <= 0) return 'keep_all'
  const conflictRatio = conflictBarCount / totalBars
  const multiLabelRatio = sameBarMultiLabelCount / totalBars
  if (sameBarMultiLabelCount > 0) return 'single_best'
  if (multiLabelRatio >= 0.01) return 'single_best'
  if (conflictRatio >= 0.03) return 'single_best'
  return 'keep_all'
}

export const recordDatasetPolicyEvaluation = (input: RecordDatasetPolicyEvaluationInput): string => {
  const database = getDb()
  const now = Math.floor(Date.now() / 1000)
  const id = `dpe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  database.prepare(`
    INSERT INTO dataset_policy_evaluations (
      id, mode, left_dataset_id, right_dataset_id, filters_json, summary_json,
      recommended_policy, selected_policy, applied_dataset_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.mode,
    input.leftDatasetId || null,
    input.rightDatasetId || null,
    input.filters ? JSON.stringify(input.filters) : null,
    input.summary ? JSON.stringify(input.summary) : null,
    input.recommendedPolicy || null,
    input.selectedPolicy || null,
    input.appliedDatasetId || null,
    now
  )
  return id
}

export const listDatasetPolicyEvaluations = (mode?: string, limit?: number) => {
  const database = getDb()
  const maxLimit = Math.min(200, Math.max(1, Number(limit || 50)))
  if (mode && mode.trim()) {
    return database.prepare(`
      SELECT *
      FROM dataset_policy_evaluations
      WHERE mode = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(mode.trim(), maxLimit)
  }
  return database.prepare(`
    SELECT *
    FROM dataset_policy_evaluations
    ORDER BY created_at DESC
    LIMIT ?
  `).all(maxLimit)
}
