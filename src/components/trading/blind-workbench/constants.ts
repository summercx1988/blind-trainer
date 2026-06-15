export const REGIME_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'mixed', label: '全部', color: '#6f7f9b' },
  { value: 'uptrend', label: '上升趋势', color: '#e74c3c' },
  { value: 'downtrend', label: '下降趋势', color: '#27ae60' },
  { value: 'sideways', label: '盘整', color: '#3498db' },
  { value: 'volatile', label: '高波动', color: '#f39c12' }
]

export const REGIME_COLOR_MAP: Record<string, string> = {
  uptrend: '#e74c3c',
  downtrend: '#27ae60',
  sideways: '#3498db',
  volatile: '#f39c12',
  mixed: '#6f7f9b',
  fallback: '#95a5a6'
}

export const CANDIDATE_COUNT_OPTIONS = [200, 500, 1000, 2000]

export const DEFAULT_WORKBENCH_SETTINGS = {
  regime: 'mixed',
  continuousMode: false,
  executionMode: 'next_open' as const,
  candidateCount: 500,
  minPrice: 0,
  visibleCount: 120
}
