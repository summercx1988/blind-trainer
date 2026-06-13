import type { ActionType } from '../blind/types'

export const toMoney = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0
  return safe.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const toSignedMoney = (value: number): string => `${value >= 0 ? '+' : ''}${toMoney(value)}`
export const toSignedPct = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

export const actionLabel = (actionType: ActionType): string => {
  if (actionType === 'buy') return '买入'
  if (actionType === 'sell') return '卖出'
  if (actionType === 'hold') return '持有'
  if (actionType === 'skip') return '跳过'
  return '结束'
}
