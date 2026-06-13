import { useEffect, useRef, useMemo, useCallback } from 'react'
import { init, dispose, registerIndicator } from 'klinecharts'
import type { Chart, DataLoaderGetBarsParams, DeepPartial, KLineData, Styles } from 'klinecharts'

interface IndexKlineBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface RecommendationCount {
  date: string
  total: number
  win: number
  loss: number
}

type RecommendationKLineData = KLineData & {
  recWin: number
  recLoss: number
}

interface IndexKlineChartProps {
  klineData: IndexKlineBar[]
  recommendationCounts: RecommendationCount[]
  height?: number
}

let indicatorRegistered = false

const registerRecCountIndicator = () => {
  if (indicatorRegistered) return
  registerIndicator({
    name: 'RecCount',
    shortName: '推荐数',
    series: 'volume',
    figures: [
      { key: 'win', title: '盈利', type: 'bar' },
      { key: 'loss', title: '亏损', type: 'bar' },
    ],
    calc: (dataList: Array<Record<string, unknown>>) => {
      return dataList.map((kline) => ({
        win: (kline as Record<string, unknown>).recWin ?? 0,
        loss: -((kline as Record<string, unknown>).recLoss ?? 0),
      }))
    },
  })
  indicatorRegistered = true
}

const CHART_STYLES: DeepPartial<Styles> = {
  grid: { show: true, horizontal: { show: true, size: 1, color: 'rgba(77,77,77,0.2)' }, vertical: { show: true, size: 1, color: 'rgba(77,77,77,0.2)' } },
  candle: {
    bar: { upColor: '#ef5350', downColor: '#26a69a', noChangeColor: '#888888' },
    tooltip: { showRule: 'follow_cross' },
  },
  indicator: {
    tooltip: { showRule: 'follow_cross' },
  },
  xAxis: { tickText: { color: '#9ca3af' } },
  yAxis: { tickText: { color: '#9ca3af' } },
  crosshair: { horizontal: { show: true, line: { show: true, style: 'dashed' } }, vertical: { show: true, line: { show: true, style: 'dashed' } } },
}

const toMs = (ts: number) => (ts < 1_000_000_000_000 ? ts * 1000 : ts)

export const IndexKlineChart = ({
  klineData,
  recommendationCounts,
  height = 260,
}: IndexKlineChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Chart | null>(null)

  const recMap = useMemo(() => {
    const m = new Map<string, { total: number; win: number; loss: number }>()
    for (const r of recommendationCounts) {
      m.set(r.date, { total: r.total, win: r.win, loss: r.loss })
    }
    return m
  }, [recommendationCounts])

  const mergedData = useMemo<RecommendationKLineData[]>(() => {
    return klineData.map((bar) => {
      const d = new Date(toMs(bar.timestamp))
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const rec = recMap.get(dateStr)
      return {
        timestamp: toMs(bar.timestamp),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0,
        recWin: rec?.win ?? 0,
        recLoss: rec?.loss ?? 0,
      }
    })
  }, [klineData, recMap])

  useEffect(() => {
    registerRecCountIndicator()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = init(container, { styles: CHART_STYLES })
    if (chart) {
      chart.createIndicator('VOL', false, { height: 48 })
      chart.createIndicator('RecCount', false, { height: 40 })
      chartRef.current = chart
    }

    return () => {
      dispose(container)
      chartRef.current = null
    }
  }, [])

  const applyData = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setDataLoader({
      getBars: (params: DataLoaderGetBarsParams) => {
        params.callback(mergedData, false)
      },
    })
    chart.setSymbol({ ticker: 'SSE_INDEX', pricePrecision: 2, volumePrecision: 0 })
    chart.setPeriod({ type: 'day', span: 1 })
  }, [mergedData])

  useEffect(() => {
    applyData()
  }, [applyData])

  if (klineData.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7f99', fontSize: '0.85rem' }}>
        暂无指数数据（需执行 scripts/sync_index_daily.py）
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: '0.82rem', color: '#1f2e49', fontWeight: 600 }}>
          上证指数 D+K线 · 推荐信号吸附
        </span>
        <span style={{ fontSize: '0.75rem', color: '#6e7f99' }}>
          <span style={{ color: '#4caf50' }}>■</span> 盈利 &nbsp;
          <span style={{ color: '#ef5350' }}>■</span> 亏损
        </span>
      </div>
      <div ref={containerRef} style={{ height }} />
    </div>
  )
}
