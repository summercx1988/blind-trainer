export const statusLabel: Record<string, string> = {
  proposed: '待审核',
  accepted: '已接受',
  rejected: '已拒绝',
  edited: '已编辑'
}

export const signalEventStatusLabel: Record<string, string> = {
  new: '新提醒',
  read: '已读',
  feedback: '已反馈',
  ignored: '已忽略'
}

const factorTypeLabel: Record<string, string> = {
  ma_cross: '均线穿越',
  rsi_reversal: 'RSI 反转',
  macd_cross: 'MACD 交叉',
  boll_reversion: 'BOLL 反转',
  volume_price_breakout: '量价突破'
}

export const signalLabel = (signalType: string): string => {
  if (signalType === 'buy') return '买点'
  if (signalType === 'sell') return '卖点'
  return signalType || '-'
}

export const toFactorLabel = (factorType: string): string => {
  if (!factorType) return '-'
  return factorTypeLabel[factorType] || factorType
}

export const conflictPolicyLabel = (policy: string): string => {
  if (policy === 'single_best') return '同bar最高分'
  if (policy === 'keep_all') return '保留全部标签'
  return policy || '-'
}

export const formatTime = (timestamp: number): string => {
  if (!timestamp) return '-'
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

export const readTestAccuracy = (metricsJson: string, columnValue?: number | null): string => {
  if (columnValue != null && typeof columnValue === 'number') {
    return `${(columnValue * 100).toFixed(1)}%`
  }
  if (!metricsJson) return '-'
  try {
    const payload = JSON.parse(metricsJson) as Record<string, unknown>
    const test = payload.test
    if (!test || typeof test !== 'object') return '-'
    const accuracy = (test as Record<string, unknown>).accuracy
    if (typeof accuracy !== 'number') return '-'
    return `${(accuracy * 100).toFixed(1)}%`
  } catch {
    return '-'
  }
}

export const readTestAuc = (metricsJson: string, columnValue?: number | null): string => {
  if (columnValue != null && typeof columnValue === 'number') {
    return columnValue.toFixed(4)
  }
  if (!metricsJson) return '-'
  try {
    const payload = JSON.parse(metricsJson) as Record<string, unknown>
    const test = payload.test
    if (!test || typeof test !== 'object') return '-'
    const auc = (test as Record<string, unknown>).auc
    if (typeof auc !== 'number') return '-'
    return auc.toFixed(4)
  } catch {
    return '-'
  }
}

export const readTestF1 = (metricsJson: string, columnValue?: number | null): string => {
  if (columnValue != null && typeof columnValue === 'number') {
    return `${(columnValue * 100).toFixed(1)}%`
  }
  if (!metricsJson) return '-'
  try {
    const payload = JSON.parse(metricsJson) as Record<string, unknown>
    const test = payload.test
    if (!test || typeof test !== 'object') return '-'
    const f1 = (test as Record<string, unknown>).f1
    if (typeof f1 !== 'number') return '-'
    return `${(f1 * 100).toFixed(1)}%`
  } catch {
    return '-'
  }
}

export const readMetricValue = (metricsJson: string, split: 'train' | 'valid' | 'test', key: 'accuracy' | 'precision' | 'recall' | 'f1'): number | null => {
  if (!metricsJson) return null
  try {
    const payload = JSON.parse(metricsJson) as Record<string, unknown>
    const splitNode = payload[split]
    if (!splitNode || typeof splitNode !== 'object') return null
    const value = (splitNode as Record<string, unknown>)[key]
    return typeof value === 'number' ? value : null
  } catch {
    return null
  }
}

export interface ConvergenceMetrics {
  engine: string
  metric_name: string
  best_iteration: number
  total_iterations: number
  early_stopped: boolean
  best_valid_metric: number | null
  tail_improvement: number
  status: 'converged' | 'improving'
  train_curve: number[]
  valid_curve: number[]
  optuna_best_value: number | null
  optuna_curve: number[]
}

export const readConvergenceMetrics = (metricsJson: string): ConvergenceMetrics | null => {
  if (!metricsJson) return null
  try {
    const payload = JSON.parse(metricsJson) as Record<string, unknown>
    const node = payload.convergence
    if (!node || typeof node !== 'object') return null
    const raw = node as Record<string, unknown>
    const toNumArray = (value: unknown): number[] => {
      if (!Array.isArray(value)) return []
      return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    }
    return {
      engine: asString(raw.engine),
      metric_name: asString(raw.metric_name, 'loss'),
      best_iteration: asNumber(raw.best_iteration, 0),
      total_iterations: asNumber(raw.total_iterations, 0),
      early_stopped: raw.early_stopped === true,
      best_valid_metric: typeof raw.best_valid_metric === 'number' ? raw.best_valid_metric : null,
      tail_improvement: asNumber(raw.tail_improvement, 0),
      status: raw.status === 'improving' ? 'improving' : 'converged',
      train_curve: toNumArray(raw.train_curve),
      valid_curve: toNumArray(raw.valid_curve),
      optuna_best_value: typeof raw.optuna_best_value === 'number' ? raw.optuna_best_value : null,
      optuna_curve: toNumArray(raw.optuna_curve),
    }
  } catch {
    return null
  }
}

export const readSummaryField = (summaryJson: string, key: string): string => {
  if (!summaryJson) return '-'
  try {
    const payload = JSON.parse(summaryJson) as Record<string, unknown>
    const value = payload[key]
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string' && value) return value
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    return '-'
  } catch {
    return '-'
  }
}

export const toNumberMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = raw
  }
  return result
}

export const formatCountMap = (map: Record<string, number>): string => {
  const entries = Object.entries(map)
  if (entries.length === 0) return '-'
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key}:${count}`)
    .join(' / ')
}

export const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
export const asNumber = (value: unknown, fallback = 0): number => typeof value === 'number' ? value : fallback

export const toNumberMapFromUnknown = (value: unknown): Record<string, number> => toNumberMap(value)
