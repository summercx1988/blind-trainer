import { getDb } from '../db'

export type OutcomeGatePeriod = '5m' | '15m' | '1d'

export interface OutcomeGatePeriodSettings {
  horizonBars: number
  minFutureBars: number
  buyMinMaxReturnPct: number
  buyMinExitReturnPct: number
  buyMaxDrawdownPct: number
  buyMinRiskReward: number
  sellMinDropPct: number
  sellMaxBouncePct: number
  sellMinRiskReward: number
}

export interface OutcomeGateSettings {
  '5m': OutcomeGatePeriodSettings
  '15m': OutcomeGatePeriodSettings
  '1d': OutcomeGatePeriodSettings
}

export const OUTCOME_GATE_SETTINGS_KEY = 'outcome_gate_settings_v1'

export const DEFAULT_OUTCOME_GATE_SETTINGS: OutcomeGateSettings = {
  '1d': {
    horizonBars: 20,
    minFutureBars: 8,
    buyMinMaxReturnPct: 6.0,
    buyMinExitReturnPct: 1.2,
    buyMaxDrawdownPct: 4.0,
    buyMinRiskReward: 1.4,
    sellMinDropPct: 4.0,
    sellMaxBouncePct: 2.2,
    sellMinRiskReward: 1.4,
  },
  '15m': {
    horizonBars: 48,
    minFutureBars: 20,
    buyMinMaxReturnPct: 2.4,
    buyMinExitReturnPct: 0.6,
    buyMaxDrawdownPct: 1.6,
    buyMinRiskReward: 1.3,
    sellMinDropPct: 1.8,
    sellMaxBouncePct: 1.0,
    sellMinRiskReward: 1.25,
  },
  '5m': {
    horizonBars: 72,
    minFutureBars: 24,
    buyMinMaxReturnPct: 1.8,
    buyMinExitReturnPct: 0.4,
    buyMaxDrawdownPct: 1.2,
    buyMinRiskReward: 1.2,
    sellMinDropPct: 1.2,
    sellMaxBouncePct: 0.8,
    sellMinRiskReward: 1.2,
  }
}

const asBoundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

const asBoundedFloat = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

const sanitizePeriodSettings = (
  input: Record<string, unknown>,
  fallback: OutcomeGatePeriodSettings
): OutcomeGatePeriodSettings => {
  const horizonBars = asBoundedInt(input.horizonBars, fallback.horizonBars, 8, 240)
  const minFutureBars = asBoundedInt(
    input.minFutureBars,
    Math.min(fallback.minFutureBars, horizonBars - 1),
    4,
    Math.max(4, horizonBars - 1)
  )
  return {
    horizonBars,
    minFutureBars,
    buyMinMaxReturnPct: asBoundedFloat(input.buyMinMaxReturnPct, fallback.buyMinMaxReturnPct, 0.1, 40),
    buyMinExitReturnPct: asBoundedFloat(input.buyMinExitReturnPct, fallback.buyMinExitReturnPct, 0, 20),
    buyMaxDrawdownPct: asBoundedFloat(input.buyMaxDrawdownPct, fallback.buyMaxDrawdownPct, 0.1, 30),
    buyMinRiskReward: asBoundedFloat(input.buyMinRiskReward, fallback.buyMinRiskReward, 0.2, 10),
    sellMinDropPct: asBoundedFloat(input.sellMinDropPct, fallback.sellMinDropPct, 0.1, 30),
    sellMaxBouncePct: asBoundedFloat(input.sellMaxBouncePct, fallback.sellMaxBouncePct, 0, 20),
    sellMinRiskReward: asBoundedFloat(input.sellMinRiskReward, fallback.sellMinRiskReward, 0.2, 10),
  }
}

export const sanitizeOutcomeGateSettings = (
  input: Record<string, unknown>,
  fallback: OutcomeGateSettings = DEFAULT_OUTCOME_GATE_SETTINGS
): OutcomeGateSettings => {
  const oneDay = sanitizePeriodSettings(asRecord(input['1d']), fallback['1d'])
  const fifteenMinute = sanitizePeriodSettings(asRecord(input['15m']), fallback['15m'])
  const fiveMinute = sanitizePeriodSettings(asRecord(input['5m']), fallback['5m'])
  return {
    '1d': oneDay,
    '15m': fifteenMinute,
    '5m': fiveMinute
  }
}

export const loadOutcomeGateSettingsFromDb = (): OutcomeGateSettings => {
  const row = getDb()
    .prepare('SELECT value_json FROM app_preferences WHERE key = ? LIMIT 1')
    .get(OUTCOME_GATE_SETTINGS_KEY) as { value_json: string } | undefined
  if (!row?.value_json) return DEFAULT_OUTCOME_GATE_SETTINGS
  try {
    const parsed = JSON.parse(row.value_json)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_OUTCOME_GATE_SETTINGS
    return sanitizeOutcomeGateSettings(parsed as Record<string, unknown>, DEFAULT_OUTCOME_GATE_SETTINGS)
  } catch {
    return DEFAULT_OUTCOME_GATE_SETTINGS
  }
}

export const mergeOutcomeGateSettings = (
  current: OutcomeGateSettings,
  patch: Record<string, unknown>
): OutcomeGateSettings => {
  return sanitizeOutcomeGateSettings({
    '1d': { ...current['1d'], ...asRecord(patch['1d']) },
    '15m': { ...current['15m'], ...asRecord(patch['15m']) },
    '5m': { ...current['5m'], ...asRecord(patch['5m']) }
  }, current)
}

export const saveOutcomeGateSettingsToDb = (settings: OutcomeGateSettings): void => {
  const now = Math.floor(Date.now() / 1000)
  getDb().prepare(`
    INSERT INTO app_preferences (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(OUTCOME_GATE_SETTINGS_KEY, JSON.stringify(settings), now)
}
