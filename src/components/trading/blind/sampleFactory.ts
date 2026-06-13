import type { KlineBar, PeriodType, TrainingSample } from './types'

export const normalizeBar = (raw: Record<string, unknown>): KlineBar => {
  const rawTimestamp = raw.timestamp
  const normalizedTimestamp = typeof rawTimestamp === 'string'
    ? new Date(rawTimestamp).getTime()
    : Number(rawTimestamp || Date.now())

  return {
    timestamp: Number.isFinite(normalizedTimestamp) ? normalizedTimestamp : Date.now(),
    open: Number(raw.open || 0),
    high: Number(raw.high || 0),
    low: Number(raw.low || 0),
    close: Number(raw.close || 0),
    volume: Number(raw.volume || 0)
  }
}

export const normalizeSample = (
  raw: Record<string, unknown>,
  fallbackIndex: number,
  period: PeriodType
): TrainingSample => {
  const klinesRaw = Array.isArray(raw.klines) ? raw.klines : []
  const bars = klinesRaw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeBar(item))

  return {
    id: String(raw.id || `sample_${Date.now()}_${fallbackIndex}`),
    code: String(raw.code || '000001'),
    name: String(raw.name || '未知标的'),
    regime: String(raw.regime || 'mixed'),
    period: String(raw.period || period),
    warmupBars: Math.max(40, Number(raw.warmupBars || 60)),
    forwardBars: Math.max(30, Number(raw.forwardBars || 60)),
    actualDate: String(raw.actualDate || ''),
    totalAvailableBars: Number(raw.totalAvailableBars || 0) || undefined,
    klines: bars
  }
}
