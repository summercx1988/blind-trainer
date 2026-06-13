import BaseKlineChart from './BaseKlineChart'
import type { BaseMarker } from './BaseKlineChart'
import type { ActionType, KlineBar } from './types'

export type { BaseMarker as TradeMarker }

interface KlineChartProps {
  data: KlineBar[]
  visibleCount?: number
  tradeMarkers?: Array<{
    barIndex: number
    actionType: Extract<ActionType, 'buy' | 'sell'>
    price: number
  }>
  benchmarkMarkers?: BaseMarker[]
}

const KlineChart = ({ data, visibleCount, tradeMarkers = [], benchmarkMarkers }: KlineChartProps) => {
  const markers: BaseMarker[] = tradeMarkers.map((m) => ({
    barIndex: m.barIndex,
    actionType: m.actionType,
    price: m.price
  }))

  return (
    <BaseKlineChart
      data={data}
      markers={markers}
      benchmarkMarkers={benchmarkMarkers}
      ticker="BLIND"
      visibleCount={visibleCount}
    />
  )
}

export default KlineChart
