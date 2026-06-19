import { describe, it, expect } from 'vitest'
import { adaptSampleForWorkbench } from './sampleAdapter'
import type { TrainingSample } from './sampler'

const sample: TrainingSample = {
  id: '600001-20240101',
  code: '600001',
  name: '测试科技',
  regime: 'mixed',
  period: '1d',
  warmupBars: 50,
  forwardBars: 210,
  actualDate: '20240101',
  totalAvailableBars: 260,
  klines: [
    { date: '20231228', open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1000, amount: 10200 },
    { date: '20231229', open: 10.2, high: 10.8, low: 10.1, close: 10.6, volume: 1200, amount: 12720 },
    { date: '20240102', open: 10.6, high: 11, low: 10.5, close: 10.9, volume: 900, amount: 9810 },
  ],
}

describe('sampleAdapter 格式转换', () => {
  it('把 date(YYYYMMDD) 转成 timestamp（毫秒）', () => {
    const adapted = adaptSampleForWorkbench(sample)
    const firstBar = (adapted.klines as Array<Record<string, unknown>>)[0]
    expect(firstBar).toHaveProperty('timestamp')
    expect(typeof firstBar.timestamp).toBe('number')
    expect(firstBar.timestamp).toBe(new Date('2023-12-28').getTime())
  })

  it('保留 open/high/low/close/volume', () => {
    const adapted = adaptSampleForWorkbench(sample)
    const firstBar = (adapted.klines as Array<Record<string, unknown>>)[0]
    expect(firstBar.open).toBe(10)
    expect(firstBar.close).toBe(10.2)
    expect(firstBar.volume).toBe(1000)
  })

  it('保留样本元数据（code/name/regime/warmupBars 等）', () => {
    const adapted = adaptSampleForWorkbench(sample)
    expect(adapted.code).toBe('600001')
    expect(adapted.name).toBe('测试科技')
    expect(adapted.regime).toBe('mixed')
    expect(adapted.warmupBars).toBe(50)
    expect(adapted.klines).toHaveLength(3)
  })

  it('转换后能被 normalizeBar 正确解析（端到端校验）', async () => {
    const { normalizeBar } = await import('../components/trading/blind/sampleFactory')
    const adapted = adaptSampleForWorkbench(sample)
    const bar = normalizeBar((adapted.klines as Array<Record<string, unknown>>)[0])
    expect(bar.timestamp).toBe(new Date('2023-12-28').getTime())
    expect(bar.close).toBe(10.2)
  })
})
