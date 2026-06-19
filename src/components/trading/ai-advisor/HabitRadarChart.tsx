import { normalizeIndicators } from './normalizeIndicators'
import type { HabitIndicators } from '../../../types/agent'

interface HabitRadarChartProps {
  indicators: HabitIndicators
  size?: number
}

export default function HabitRadarChart({ indicators, size = 280 }: HabitRadarChartProps) {
  const dims = normalizeIndicators(indicators)
  const center = size / 2
  const maxRadius = size / 2 - 60
  const n = dims.length
  const angleStep = (Math.PI * 2) / n

  const pointAt = (i: number, radius: number) => {
    const angle = -Math.PI / 2 + i * angleStep
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    }
  }

  const dataPoints = dims.map((d, i) => pointAt(i, maxRadius * d.value))
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ')

  const axisEnds = dims.map((_, i) => pointAt(i, maxRadius))
  const gridLevels = [0.25, 0.5, 0.75, 1.0]
  const gridPolygons = gridLevels.map(level =>
    dims.map((_, i) => {
      const p = pointAt(i, maxRadius * level)
      return `${p.x},${p.y}`
    }).join(' ')
  )

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="habit-radar-chart">
      {gridPolygons.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="rgba(123,140,171,0.15)" strokeWidth={1} />
      ))}
      {axisEnds.map((p, i) => (
        <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="rgba(123,140,171,0.2)" strokeWidth={1} />
      ))}
      <polygon points={dataPolygon} fill="rgba(220,38,38,0.25)" stroke="#dc2626" strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#dc2626" />
      ))}
      {dims.map((d, i) => {
        const labelPos = pointAt(i, maxRadius + 22)
        return (
          <g key={d.key}>
            <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#7b8cab">
              {d.label}
            </text>
            <text x={labelPos.x} y={labelPos.y + 13} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#505b73">
              {d.raw}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
