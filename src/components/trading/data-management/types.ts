export interface SyncProgress {
  phase: string
  current: number
  total: number
  message: string
}

export interface StockRecord {
  code: string
  name: string
  daily_count: number
  m15_count: number
  m5_count: number
  minute_count: number
  last_sync: string
}

export interface SyncStrategy {
  id: string
  label: string
  description: string
  count: number
  periods: string[]
}

export const SYNC_STRATEGIES: SyncStrategy[] = [
  {
    id: 'full_update',
    label: '全量增量更新',
    description: '更新所有股票最新日线和15m数据，建议每日收盘后执行。',
    count: 0,
    periods: ['daily', '15m']
  },
  {
    id: 'daily_fast',
    label: '快速增量（日线）',
    description: '适合先补齐可用样本池，速度更快。',
    count: 20,
    periods: ['daily']
  },
  {
    id: 'blind_training',
    label: '盲训推荐（日线+15m）',
    description: '优先覆盖盲训样本，兼顾训练效率。',
    count: 20,
    periods: ['daily', '15m']
  }
]
