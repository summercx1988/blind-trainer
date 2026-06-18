export const REGIME_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'mixed', label: '全部', color: '#6f7f9b' },
  { value: 'uptrend', label: '上升趋势', color: '#dc2626' },
  { value: 'downtrend', label: '下降趋势', color: '#16a34a' },
  { value: 'sideways', label: '盘整', color: '#3498db' },
  { value: 'volatile', label: '高波动', color: '#f39c12' }
]

export const REGIME_COLOR_MAP: Record<string, string> = {
  uptrend: '#dc2626',
  downtrend: '#16a34a',
  sideways: '#3498db',
  volatile: '#f39c12',
  mixed: '#6f7f9b',
  fallback: '#95a5a6'
}

export const CANDIDATE_COUNT_OPTIONS = [200, 500, 1000, 2000]

export const POSITION_RATIO_OPTIONS: { value: number; label: string }[] = [
  { value: 0.2, label: '1/5' },
  { value: 0.25, label: '1/4' },
  { value: 0.3333, label: '1/3' },
  { value: 0.5, label: '1/2' },
  { value: 0.6667, label: '2/3' },
  { value: 0.75, label: '3/4' }
]

export const DEFAULT_POSITION_RATIO = 0.5

export const DEFAULT_WORKBENCH_SETTINGS = {
  regime: 'mixed',
  continuousMode: false,
  executionMode: 'next_open' as const,
  candidateCount: 500,
  minPrice: 0,
  visibleCount: 120,
  positionRatio: DEFAULT_POSITION_RATIO
}
