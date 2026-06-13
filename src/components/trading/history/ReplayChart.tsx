import BaseKlineChart from '../blind/BaseKlineChart'
import type { BaseMarker } from '../blind/BaseKlineChart'

export interface ReplayAction {
  barIndex: number
  actionType: 'buy' | 'sell' | 'hold' | 'skip'
  price: number
}

interface ReplayChartProps {
  data: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]
  actions: ReplayAction[]
}

const ReplayChart = ({ data, actions }: ReplayChartProps) => {
  const markers: BaseMarker[] = actions
    .filter((a) => a.actionType === 'buy' || a.actionType === 'sell')
    .map((a) => ({
      barIndex: a.barIndex,
      actionType: a.actionType as 'buy' | 'sell',
      price: a.price
    }))

  return (
    <BaseKlineChart
      data={data}
      markers={markers}
      ticker="REPLAY"
      minHeight={320}
    />
  )
}

export default ReplayChart
