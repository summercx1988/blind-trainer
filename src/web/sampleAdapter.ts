import type { TrainingSample } from './sampler'

function dateToTimestamp(yyyymmdd: string): number {
  if (!/^\d{8}$/.test(yyyymmdd)) return Date.now()
  const iso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
  return new Date(iso).getTime()
}

export function adaptSampleForWorkbench(sample: TrainingSample): Record<string, unknown> {
  return {
    id: sample.id,
    code: sample.code,
    name: sample.name,
    regime: sample.regime,
    period: sample.period,
    warmupBars: sample.warmupBars,
    forwardBars: sample.forwardBars,
    actualDate: sample.actualDate,
    totalAvailableBars: sample.totalAvailableBars,
    klines: sample.klines.map((k) => ({
      timestamp: dateToTimestamp(k.date),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    })),
  }
}
