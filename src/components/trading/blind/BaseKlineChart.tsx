import { useEffect, useRef, useCallback } from 'react'
import { init, dispose } from 'klinecharts'
import type { Nullable, Chart, DataLoaderGetBarsParams } from 'klinecharts'

export interface BaseMarker {
  barIndex: number
  actionType: 'buy' | 'sell'
  price: number
}

export interface BaseKlineBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ExitWindowRange {
  entryBarIndex: number
  exitBarIndex: number
  highPrice: number
  lowPrice: number
}

interface BaseKlineChartProps {
  data: BaseKlineBar[]
  markers?: BaseMarker[]
  benchmarkMarkers?: BaseMarker[]
  selectedMarkerIndex?: number
  exitWindow?: ExitWindowRange
  ticker?: string
  visibleCount?: number
  minHeight?: number
  onMarkerClick?: (markerIndex: number) => void
  scrollToDate?: string
}

interface OverlayPoint {
  timestamp?: number
}

interface OverlayClickPayload {
  points?: OverlayPoint[]
}

interface OverlayClickableChart {
  bindOverlayClick?: (callback: (overlay: OverlayClickPayload) => void) => string | number | undefined
  unbindOverlayClick?: (subscriptionId: string | number) => void
}

const CHART_STYLES = {
  grid: {
    show: true,
    horizontal: { show: true, size: 1, color: 'rgba(77, 122, 178, 0.08)', style: 'dashed' as const, dashedValue: [2, 2] },
    vertical: { show: true, size: 1, color: 'rgba(77, 122, 178, 0.08)', style: 'dashed' as const, dashedValue: [2, 2] }
  },
  candle: {
    type: 'candle_solid' as const,
    priceMark: {
      show: true,
      high: { show: true, color: '#7b8cab', textSize: 10 },
      low: { show: true, color: '#7b8cab', textSize: 10 },
      last: {
        show: true,
        upColor: '#e74c3c',
        downColor: '#27ae60',
        noChangeColor: '#95a5a6',
        line: { show: true, style: 'dashed' as const, dashedValue: [4, 4], size: 1 }
      }
    },
    bar: {
      upColor: '#e74c3c', downColor: '#27ae60',
      upBorderColor: '#e74c3c', downBorderColor: '#27ae60',
      upWickColor: '#e74c3c', downWickColor: '#27ae60'
    },
    tooltip: { showRule: 'follow_cross' as const, showType: 'standard' as const }
  },
  indicator: { ohlc: { upColor: 'rgba(231, 76, 60, 0.65)', downColor: 'rgba(39, 174, 96, 0.65)' } },
  xAxis: { show: true, tickText: { color: '#7b8cab', size: 11 } },
  yAxis: { show: true, tickText: { color: '#7b8cab', size: 11 } },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { show: true, style: 'dashed' as const, dashedValue: [4, 2], size: 1, color: '#9eaFCB' },
      text: { show: true, color: '#fff', borderColor: '#505B73', backgroundColor: '#505B73' }
    },
    vertical: {
      show: true,
      line: { show: true, style: 'dashed' as const, dashedValue: [4, 2], size: 1, color: '#9eaFCB' },
      text: { show: true, color: '#fff', borderColor: '#505B73', backgroundColor: '#505B73' }
    }
  }
}

const toMs = (value: number) => (value < 1_000_000_000_000 ? value * 1000 : value)

const toOverlayPoint = (marker: BaseMarker, bars: BaseKlineBar[]): { timestamp: number; value: number } | null => {
  if (!Number.isInteger(marker.barIndex) || marker.barIndex < 0 || marker.barIndex >= bars.length) return null
  const timestamp = toMs(bars[marker.barIndex]!.timestamp)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  return { timestamp, value: marker.price }
}

function createOverlays(
  chart: Chart,
  bars: BaseKlineBar[],
  markers: BaseMarker[],
  benchmarkMarkers: BaseMarker[] | undefined,
  selectedMarkerIndex: number | undefined,
  exitWindow: ExitWindowRange | undefined
) {
  chart.removeOverlay?.({ groupId: 'trade-markers' })
  chart.removeOverlay?.({ groupId: 'benchmark-markers' })
  chart.removeOverlay?.({ groupId: 'selected-marker' })
  chart.removeOverlay?.({ groupId: 'exit-window' })

  if (exitWindow && bars.length > 0) {
    const entryTs = toMs(bars[exitWindow.entryBarIndex]?.timestamp ?? 0)
    const exitTs = toMs(bars[Math.min(exitWindow.exitBarIndex, bars.length - 1)]?.timestamp ?? 0)
    if (entryTs > 0 && exitTs > 0 && exitWindow.highPrice > exitWindow.lowPrice) {
      chart.createOverlay({
        name: 'rect',
        groupId: 'exit-window',
        id: 'exit_window_rect',
        points: [
          { timestamp: entryTs, value: exitWindow.highPrice },
          { timestamp: exitTs, value: exitWindow.lowPrice }
        ],
        styles: {
          color: 'rgba(59, 130, 246, 0.08)',
          borderColor: 'rgba(59, 130, 246, 0.3)',
          borderSize: 1,
          borderStyle: 'dashed' as const,
          borderDashedValue: [4, 2]
        },
        extendData: 'Exit Window'
      })
    }
  }

  const createPointOverlays = (
    groupId: string,
    idPrefix: string,
    points: Array<{ timestamp: number; value: number }>,
    symbolType: 'diamond' | 'triangle',
    color: string,
    size: number,
    text: string
  ) => {
    points.forEach((point, index) => {
      chart.createOverlay({
        name: 'simpleAnnotation',
        groupId,
        id: `${idPrefix}_${index}_${Math.floor(point.timestamp)}`,
        points: [point],
        styles: { symbol: { type: symbolType, color, size } },
        extendData: text
      })
    })
  }

  const normalBuy = markers.filter((_, i) => i !== selectedMarkerIndex && _.actionType === 'buy')
  const normalSell = markers.filter((_, i) => i !== selectedMarkerIndex && _.actionType === 'sell')

  const normalBuyPoints = normalBuy.map((m) => toOverlayPoint(m, bars)).filter((p): p is { timestamp: number; value: number } => p !== null)
  const normalSellPoints = normalSell.map((m) => toOverlayPoint(m, bars)).filter((p): p is { timestamp: number; value: number } => p !== null)

  if (normalBuyPoints.length > 0) {
    createPointOverlays('trade-markers', 'buy_marker', normalBuyPoints, 'diamond', '#e74c3c', 7, 'B')
  }
  if (normalSellPoints.length > 0) {
    createPointOverlays('trade-markers', 'sell_marker', normalSellPoints, 'diamond', '#27ae60', 7, 'S')
  }

  if (selectedMarkerIndex !== undefined && selectedMarkerIndex >= 0 && selectedMarkerIndex < markers.length) {
    const selected = markers[selectedMarkerIndex]
    const point = toOverlayPoint(selected, bars)
    if (point) {
      const isSelectedBuy = selected.actionType === 'buy'
      chart.createOverlay({
        name: 'simpleAnnotation',
        groupId: 'selected-marker',
        id: 'selected_marker_highlight',
        points: [point],
        styles: { symbol: { type: 'diamond', color: isSelectedBuy ? '#ff4757' : '#2ed573', size: 12 } },
        extendData: isSelectedBuy ? '▶B' : '▶S'
      })

      const scrollTo = Math.max(0, selected.barIndex - 20)
      setTimeout(() => {
        chart.scrollToDataIndex(scrollTo)
      }, 80)
    }
  }

  if (benchmarkMarkers && benchmarkMarkers.length > 0) {
    const bBuyPoints = benchmarkMarkers.filter((m) => m.actionType === 'buy').map((m) => toOverlayPoint(m, bars)).filter((p): p is { timestamp: number; value: number } => p !== null)
    const bSellPoints = benchmarkMarkers.filter((m) => m.actionType === 'sell').map((m) => toOverlayPoint(m, bars)).filter((p): p is { timestamp: number; value: number } => p !== null)

    if (bBuyPoints.length > 0) {
      createPointOverlays('benchmark-markers', 'benchmark_buy_marker', bBuyPoints, 'triangle', '#f39c12', 7, 'MB')
    }
    if (bSellPoints.length > 0) {
      createPointOverlays('benchmark-markers', 'benchmark_sell_marker', bSellPoints, 'triangle', '#3498db', 7, 'MS')
    }
  }
}

const BaseKlineChart = ({
  data,
  markers = [],
  benchmarkMarkers,
  selectedMarkerIndex,
  exitWindow,
  ticker = 'CHART',
  visibleCount,
  minHeight = 0,
  onMarkerClick,
  scrollToDate
}: BaseKlineChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Nullable<Chart>>(null)
  const markerTimestampsRef = useRef<Array<{ barIndex: number; timestamp: number }>>([])
  const onMarkerClickRef = useRef(onMarkerClick)
  // 用 ref 保存滚动参数，避免加入 handleGetBars 依赖导致数据重载
  const scrollRef = useRef<{ visibleCount?: number; scrollToDate?: string }>({})

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick
  }, [onMarkerClick])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = init(container, { styles: CHART_STYLES })
    if (chart) {
      chart.createIndicator('VOL', false, { height: 72 })
      chartRef.current = chart
    }

    return () => {
      dispose(container)
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    markerTimestampsRef.current = markers.map((m) => {
      const bar = data[m.barIndex]
      return { barIndex: m.barIndex, timestamp: bar ? toMs(bar.timestamp) : 0 }
    })
  }, [markers, data])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onMarkerClick) return

    const overlayChart = chart as unknown as OverlayClickableChart
    const subId = overlayChart.bindOverlayClick?.((overlay) => {
      if (!overlay || !overlay.points || overlay.points.length === 0) return
      const clickedTs = overlay.points[0]?.timestamp
      if (!clickedTs) return

      const idx = markerTimestampsRef.current.findIndex((mt) => Math.abs(mt.timestamp - clickedTs) < 1000)
      if (idx >= 0) {
        onMarkerClickRef.current?.(idx)
      }
    })

    return () => {
      if (subId !== undefined) {
        overlayChart.unbindOverlayClick?.(subId)
      }
    }
  }, [onMarkerClick])

  // 同步滚动参数到 ref
  useEffect(() => {
    scrollRef.current = { visibleCount, scrollToDate }
  }, [visibleCount, scrollToDate])

  const handleGetBars = useCallback((params: DataLoaderGetBarsParams) => {
    if (!data || data.length === 0) {
      params.callback([], false)
      return
    }

    const klineData = data.map((bar) => ({
      timestamp: bar.timestamp < 1_000_000_000_000 ? bar.timestamp * 1000 : bar.timestamp,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume
    }))

    params.callback(klineData, false)

    // 数据加载完成后立即滚动（resetData 后必须在 getBars 回调中滚动，否则图表停在默认位置）
    const { visibleCount: vc, scrollToDate: sd } = scrollRef.current
    setTimeout(() => {
      const chart = chartRef.current
      if (!chart) return
      if (sd && data.length > 0) {
        const targetTs = new Date(`${sd}T12:00:00+08:00`).getTime()
        const idx = data.findIndex((bar) => Math.abs(toMs(bar.timestamp) - targetTs) < 86400000)
        if (idx >= 0) chart.scrollToDataIndex(Math.max(0, idx - 10))
      } else if (vc && vc > 0) {
        const lastIdx = klineData.length - 1
        chart.scrollToDataIndex(Math.max(0, lastIdx - Math.min(vc, klineData.length) + 5))
      }
    }, 50)

    const chart = chartRef.current
    if (chart && (markers.length > 0 || (benchmarkMarkers && benchmarkMarkers.length > 0))) {
      setTimeout(() => createOverlays(chart, data, markers, benchmarkMarkers, selectedMarkerIndex, exitWindow), 50)
    }
  }, [benchmarkMarkers, data, markers, selectedMarkerIndex, exitWindow])

  // ⚠ klinecharts v10 API 陷阱（勿删此注释）：
  // 1. setDataLoader() 只注册回调，不会主动触发 getBars
  // 2. 必须先 resetData() 清空旧数据，chart 才会重新调用 getBars 拉取新数据
  // 3. resetData 后 getBars 是异步回调，滚动必须在 getBars 回调内执行
  //    否则 scrollToDataIndex 会在空图表上执行，导致 K线"不跳转"
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || data.length === 0) return

    chart.resetData()
    chart.setDataLoader({
      getBars: handleGetBars
    })
    chart.setSymbol({ ticker, pricePrecision: 2, volumePrecision: 0 })
    chart.setPeriod({ type: 'day', span: 1 })
  }, [data, handleGetBars, ticker])

  // visibleCount/scrollToDate 变化时仅滚动（不重载数据）
  // 数据加载后的首次滚动由 handleGetBars 回调处理
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || data.length === 0) return

    if (scrollToDate && data.length > 0) {
      const targetTs = new Date(`${scrollToDate}T12:00:00+08:00`).getTime()
      const idx = data.findIndex((bar) => Math.abs(toMs(bar.timestamp) - targetTs) < 86400000)
      if (idx >= 0) {
        chart.scrollToDataIndex(Math.max(0, idx - 10))
      }
    } else if (visibleCount && visibleCount > 0) {
      const lastIdx = data.length - 1
      chart.scrollToDataIndex(Math.max(0, lastIdx - Math.min(visibleCount, data.length) + 5))
    }
  }, [visibleCount, scrollToDate])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || data.length === 0) return
    setTimeout(() => createOverlays(chart, data, markers, benchmarkMarkers, selectedMarkerIndex, exitWindow), 50)
  }, [markers, benchmarkMarkers, data, selectedMarkerIndex, exitWindow])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      chartRef.current?.resize()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleResize = () => { chartRef.current?.resize() }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div
      ref={containerRef}
      className="kline-chart-canvas"
      style={{ width: '100%', height: '100%', minHeight: minHeight > 0 ? minHeight : undefined }}
    />
  )
}

export default BaseKlineChart
