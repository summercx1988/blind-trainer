import path from 'path'
import { existsSync } from 'fs'
import { resolvePythonWorkspace } from './modelCliRunner'

// ── Shared Types ──────────────────────────────────────────────────────────────

export type PeriodType = '5m' | '15m' | '1d'

export const isSupportedPeriod = (period: string): period is PeriodType => {
  return period === '5m' || period === '15m' || period === '1d'
}

export const normalizePeriodAlias = (period: string): PeriodType | null => {
  const value = (period || '').trim().toLowerCase()
  if (value === '1d' || value === 'daily' || value === 'day' || value === 'd') return '1d'
  if (value === '15m' || value === '15min' || value === '15') return '15m'
  if (value === '5m' || value === '5min' || value === '5') return '5m'
  return null
}

export const toBooleanFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
  }
  return false
}

export const getKlineTable = (period: PeriodType): string => {
  if (period === '1d') return 'kline_daily'
  if (period === '15m') return 'kline_15m'
  return 'kline_5m'
}

export const toBarTimestamp = (tradeDate: string, tradeTime?: string): number => {
  if (!tradeDate || tradeDate.length !== 8) return Date.now()
  const year = Number(tradeDate.slice(0, 4))
  const month = Number(tradeDate.slice(4, 6)) - 1
  const day = Number(tradeDate.slice(6, 8))
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return Date.now()

  if (!tradeTime) return new Date(year, month, day, 15, 0, 0, 0).getTime()
  const [hourText, minuteText] = tradeTime.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return new Date(year, month, day, 15, 0, 0, 0).getTime()
  return new Date(year, month, day, hour, minute, 0, 0).getTime()
}

export const toTradeDateTime = (timestamp: number, period: PeriodType | string): { tradeDate: string; tradeTime?: string } => {
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const date = new Date(ms)
  const year = date.getFullYear().toString()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hour = date.getHours().toString().padStart(2, '0')
  const minute = date.getMinutes().toString().padStart(2, '0')
  const tradeDate = `${year}${month}${day}`
  if (period === '1d') return { tradeDate }
  return { tradeDate, tradeTime: `${hour}:${minute}` }
}

export const toTimestampMillis = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export const resolveArtifactPath = (artifactPath: string): string | null => {
  if (!artifactPath) return null
  const workspace = resolvePythonWorkspace()
  const candidates = [
    artifactPath,
    path.isAbsolute(artifactPath) ? artifactPath : path.join(process.cwd(), artifactPath),
    workspace ? path.join(workspace, artifactPath) : null
  ].filter((item): item is string => typeof item === 'string')

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}
