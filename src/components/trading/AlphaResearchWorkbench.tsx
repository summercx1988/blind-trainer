import { useState, useEffect, useCallback } from 'react'
import InfoHover from '../common/InfoHover'
import './AlphaResearchWorkbench.css'

type AlphaTab = 'factor_library' | 'ic_analysis' | 'bin_return' | 'correlation'

interface FactorInfo {
  factor: string
  ic: number
  rank_ic: number
  rank_ic_ir?: number | null
  rank_ic_ir_months?: number
  samples: number
  mean: number
  std: number
}

interface BinFactorInfo {
  factor: string
  bins: number
  long_short_return: number
  monotonic: boolean
  bin_stats: { bin: number; count: number; mean_return: number; win_rate: number }[]
}

interface ICAnalysisResult {
  success: boolean
  data_info: { total_rows: number; feature_columns: number }
  ic_analysis: {
    summary: { ic_mean: number; ic_std: number; ic_ir: number; factors_analyzed: number }
    factors: FactorInfo[]
  }
  bin_analysis: {
    factor_count: number
    factors: BinFactorInfo[]
  }
  correlation_analysis: {
    features: string[]
    correlation: number[][]
    high_corr_pairs: { factor_a: string; factor_b: string; correlation: number }[]
  }
  ic_timeseries: {
    months: string[]
    by_factor: { factor: string; monthly_ic: { month: string; rank_ic: number | null; samples: number }[] }[]
  }
  ic_distribution: {
    by_factor: {
      factor: string
      mean: number
      std: number
      histogram: { counts: number[]; edges: number[] }
      positive_rate: number
      significant_rate: number
    }[]
  }
  ic_decay: {
    lags: number[]
    by_factor: { factor: string; decay: { lag: number; rank_ic: number | null; stock_count: number }[] }[]
  }
}

interface DatasetOption {
  id: string
  name: string
  status: string
  sample_count: number
  frozen_at: number
}

interface FeatureTaskOption {
  id: string
  dataset_id: string
  spec_version: string
  output_dir: string
}

const TABS: { id: AlphaTab; label: string; description: string }[] = [
  { id: 'factor_library', label: '因子库', description: '浏览各 feature spec 版本的因子列表及分类' },
  { id: 'ic_analysis', label: 'IC 分析', description: 'RankIC 均值/标准差/IR + 时间序列 + 衰减曲线' },
  { id: 'bin_return', label: '分箱收益', description: '因子分箱的平均收益与单调性' },
  { id: 'correlation', label: '相关性矩阵', description: '因子间 Pearson 相关系数热力图' },
]

const ColorCell = ({ value, min, max, greenIsGood }: {
  value: number
  min: number
  max: number
  greenIsGood: boolean
}) => {
  const range = max - min || 1
  const pct = (value - min) / range
  const green = greenIsGood ? pct : (1 - pct)
  const red = greenIsGood ? (1 - pct) : pct
  return (
    <span style={{
      color: red > 0.5 ? '#e74c3c' : green > 0.5 ? '#27ae60' : '#666',
      fontWeight: Math.abs(value) > (max - min) * 0.6 ? 600 : 400,
    }}>
      {value.toFixed(4)}
    </span>
  )
}

const FactorLibraryTab = ({ result }: { result: ICAnalysisResult | null }) => {
  if (!result) {
    return (
      <div className="alpha-panel">
        <div className="alpha-panel-header">
          <h3>因子库</h3>
          <span className="alpha-subtitle">运行 IC 分析后展示因子详情</span>
        </div>
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
          请先在 IC 分析 Tab 中选择数据集并运行分析，因子库将自动展示。
        </div>
      </div>
    )
  }

  const factors = result.ic_analysis.factors

  const categories: Record<string, string[]> = {
    '趋势': [],
    '动量': [],
    '波动': [],
    '量价': [],
    '截面': [],
    '微观结构': [],
    '其他': [],
  }

  for (const f of factors) {
    const name = f.factor.toLowerCase()
    if (name.includes('ma') || name.includes('trend') || name.includes('adx') || name.includes('ema') || name.includes('sma')) {
      categories['趋势'].push(f.factor)
    } else if (name.includes('roc') || name.includes('rsi') || name.includes('mom') || name.includes('momentum')) {
      categories['动量'].push(f.factor)
    } else if (name.includes('atr') || name.includes('vol') || name.includes('std') || name.includes('boll') || name.includes('bb_')) {
      categories['波动'].push(f.factor)
    } else if (name.includes('vwap') || name.includes('vol_') || name.includes('amount') || name.includes('obv') || name.includes('volume')) {
      categories['量价'].push(f.factor)
    } else if (name.includes('rank') || name.includes('pct') || name.includes('zscore') || name.includes('cross')) {
      categories['截面'].push(f.factor)
    } else if (name.includes('spread') || name.includes('bid') || name.includes('ask') || name.includes('micro')) {
      categories['微观结构'].push(f.factor)
    } else {
      categories['其他'].push(f.factor)
    }
  }

  return (
    <div className="alpha-panel">
      <div className="alpha-panel-header">
        <h3>因子库</h3>
        <span className="alpha-subtitle">{factors.length} 个因子 | {result.data_info.total_rows.toLocaleString()} 行数据</span>
      </div>
      <div style={{ padding: '1rem' }}>
        {Object.entries(categories).filter(([, names]) => names.length > 0).map(([cat, names]) => (
          <div key={cat} style={{ marginBottom: '1rem' }}>
            <h4 style={{ color: '#4fc3f7', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>{cat} ({names.length})</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {names.map((name) => {
                const info = factors.find((f) => f.factor === name)
                return (
                  <span
                    key={name}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 3,
                      fontSize: '0.72rem',
                      fontFamily: 'monospace',
                      background: (info?.rank_ic || 0) > 0.03 ? 'rgba(39,174,96,0.15)' : (info?.rank_ic || 0) < -0.03 ? 'rgba(231,76,60,0.15)' : '#1a1a2e',
                      color: (info?.rank_ic || 0) > 0.03 ? '#27ae60' : (info?.rank_ic || 0) < -0.03 ? '#e74c3c' : '#aaa',
                      border: '1px solid #2a2a3e',
                    }}
                    title={`RankIC: ${info?.rank_ic?.toFixed(4)} | IC: ${info?.ic?.toFixed(4)} | 样本: ${info?.samples}`}
                  >
                    {name}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const ICAnalysisTab = ({ result, loading, onRun, datasetId, dataPath, onDatasetChange, onDataPathChange, datasets, featureTasks }: {
  result: ICAnalysisResult | null
  loading: boolean
  onRun: () => void
  datasetId: string
  dataPath: string
  onDatasetChange: (id: string) => void
  onDataPathChange: (path: string) => void
  datasets: DatasetOption[]
  featureTasks: FeatureTaskOption[]
}) => {
  return (
    <div className="alpha-panel">
      <div className="alpha-panel-header">
        <h3>IC 分析</h3>
        <button
          className="alpha-run-btn"
          disabled={loading || !dataPath}
          onClick={onRun}
        >
          {loading ? '分析中...' : '运行分析'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid #2a2a3e', flexWrap: 'wrap' }}>
        <select
          value={datasetId}
          onChange={(e) => onDatasetChange(e.target.value)}
          style={{ background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', minWidth: 200 }}
        >
          <option value="">-- 选择冻结数据集 --</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name || d.id} ({d.sample_count} 样本)
            </option>
          ))}
        </select>
        <select
          value={dataPath}
          onChange={(e) => onDataPathChange(e.target.value)}
          style={{ background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', minWidth: 240 }}
        >
          <option value="">-- 选择特征构建输出 --</option>
          {featureTasks.map((ft) => (
            <option key={ft.id} value={ft.output_dir}>
              {ft.spec_version} @ {ft.output_dir}
            </option>
          ))}
        </select>
      </div>

      {!result && !loading && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
          选择冻结数据集和特征版本后，点击"运行分析"开始因子 IC 分析。
        </div>
      )}

      {loading && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
          正在计算因子 RankIC...（可能需要 30-60 秒）
        </div>
      )}

      {result && (
        <div style={{ padding: '1rem' }}>
          <div className="alpha-metrics-row">
            <div className="alpha-metric-card">
              <div className="alpha-metric-label">数据量</div>
              <div className="alpha-metric-value">{result.data_info.total_rows.toLocaleString()} 行</div>
            </div>
            <div className="alpha-metric-card">
              <div className="alpha-metric-label">因子数</div>
              <div className="alpha-metric-value">{result.data_info.feature_columns}</div>
            </div>
            <div className="alpha-metric-card">
              <div className="alpha-metric-label">IC 均值</div>
              <div className="alpha-metric-value" style={{ color: result.ic_analysis.summary.ic_mean > 0 ? '#27ae60' : '#e74c3c' }}>
                {result.ic_analysis.summary.ic_mean.toFixed(4)}
              </div>
            </div>
            <div className="alpha-metric-card">
              <div className="alpha-metric-label">IC 标准差</div>
              <div className="alpha-metric-value">{result.ic_analysis.summary.ic_std.toFixed(4)}</div>
            </div>
            <div className="alpha-metric-card">
              <div className="alpha-metric-label">IC IR</div>
              <div className="alpha-metric-value" style={{ color: result.ic_analysis.summary.ic_ir > 0.5 ? '#27ae60' : result.ic_analysis.summary.ic_ir > 0 ? '#f39c12' : '#e74c3c' }}>
                {result.ic_analysis.summary.ic_ir.toFixed(2)}
              </div>
            </div>
            <div className="alpha-metric-card">
              <div className="alpha-metric-label">IR样本因子</div>
              <div className="alpha-metric-value">
                {(result.ic_analysis.summary as unknown as Record<string, unknown>).ic_ir_factors as number || 0}
              </div>
            </div>
            <div className="alpha-metric-card">
              <div className="alpha-metric-label">已分析</div>
              <div className="alpha-metric-value">{result.ic_analysis.summary.factors_analyzed} 因子</div>
            </div>
          </div>

          <h4 style={{ margin: '1rem 0 0.5rem' }}>因子 RankIC 排名</h4>
          <div style={{ maxHeight: 500, overflowY: 'auto', border: '1px solid #2a2a3e', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#1a1a2e', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={thStyle}>排名</th>
                  <th style={thStyle}>因子名</th>
                  <th style={thStyle}>RankIC</th>
                  <th style={thStyle}>IR(月序列)</th>
                  <th style={thStyle}>IR月数</th>
                  <th style={thStyle}>Pearson IC</th>
                  <th style={thStyle}>样本量</th>
                  <th style={thStyle}>均值</th>
                  <th style={thStyle}>标准差</th>
                </tr>
              </thead>
              <tbody>
                {result.ic_analysis.factors.map((f, i) => (
                  <tr key={f.factor} style={{ borderBottom: '1px solid #1a1a2e', background: i % 2 === 0 ? '#121220' : 'transparent' }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 500 }}>{f.factor}</td>
                    <td style={tdStyle}>
                      <ColorCell value={f.rank_ic} min={result.ic_analysis.factors[result.ic_analysis.factors.length - 1]?.rank_ic || 0} max={result.ic_analysis.factors[0]?.rank_ic || 1} greenIsGood={true} />
                    </td>
                    <td style={tdStyle}>
                      {typeof f.rank_ic_ir === 'number'
                        ? <span style={{ color: f.rank_ic_ir > 0.5 ? '#27ae60' : f.rank_ic_ir > 0 ? '#f39c12' : '#e74c3c' }}>{f.rank_ic_ir.toFixed(2)}</span>
                        : <span style={{ color: '#666' }}>-</span>}
                    </td>
                    <td style={tdStyle}>{typeof f.rank_ic_ir_months === 'number' ? f.rank_ic_ir_months : '-'}</td>
                    <td style={tdStyle}>{f.ic.toFixed(4)}</td>
                    <td style={tdStyle}>{f.samples.toLocaleString()}</td>
                    <td style={tdStyle}>{f.mean.toFixed(4)}</td>
                    <td style={tdStyle}>{f.std.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.ic_timeseries && result.ic_timeseries.by_factor.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>IC 时间序列（按月 RankIC，Top 10 因子）</h4>
              <div style={{ overflowX: 'auto', border: '1px solid #2a2a3e', borderRadius: 6, padding: '0.75rem' }}>
                {result.ic_timeseries.by_factor.slice(0, 10).map((f) => {
                  const maxAbs = Math.max(...f.monthly_ic.map((m) => Math.abs(m.rank_ic || 0)), 0.001)
                  return (
                    <div key={f.factor} style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#aaa', marginBottom: 2 }}>{f.factor}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28 }}>
                        {f.monthly_ic.map((m, mi) => {
                          const val = m.rank_ic
                          if (val === null) return <div key={mi} style={{ flex: 1, height: 4, background: '#1a1a2e', borderRadius: 2 }} title={`${m.month}: 无数据`} />
                          const h = Math.abs(val) / maxAbs * 22
                          const positive = val > 0
                          return (
                            <div key={mi} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                              <div style={{
                                width: '100%',
                                height: `${Math.max(h, 2)}px`,
                                background: positive ? '#27ae60' : '#e74c3c',
                                opacity: 0.75,
                                borderRadius: 2,
                              }} title={`${m.month}: RankIC=${val.toFixed(4)} (${m.samples}样本)`} />
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 2 }}>
                        {result.ic_timeseries.months.map((m, mi) => (
                          <div key={mi} style={{ flex: 1, textAlign: 'center', fontSize: '0.55rem', color: '#555' }}>
                            {mi % 3 === 0 ? m.slice(2) : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {result.ic_distribution && result.ic_distribution.by_factor.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>IC 分布（Bootstrap，Top 10 因子）</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                {result.ic_distribution.by_factor.slice(0, 10).map((f) => {
                  const maxCount = Math.max(...f.histogram.counts, 1)
                  return (
                    <div key={f.factor} style={{ background: '#121220', border: '1px solid #2a2a3e', borderRadius: 6, padding: '0.5rem', width: 180 }}>
                      <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#aaa', marginBottom: 4 }}>{f.factor}</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 36 }}>
                        {f.histogram.counts.map((c, ci) => {
                          const h = c / maxCount * 32
                          const centerBin = Math.floor(f.histogram.counts.length / 2)
                          const positive = ci >= centerBin
                          return (
                            <div key={ci} style={{
                              flex: 1,
                              height: `${Math.max(h, 1)}px`,
                              background: positive ? 'rgba(39,174,96,0.6)' : 'rgba(231,76,60,0.6)',
                              borderRadius: 1,
                            }} />
                          )
                        })}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: '#666', marginTop: 2 }}>
                        mean={f.mean.toFixed(3)} std={f.std.toFixed(3)} | 正率={(f.positive_rate * 100).toFixed(0)}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {result.ic_decay && result.ic_decay.by_factor.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>IC 衰减曲线（Top 10 因子）</h4>
              <div style={{ overflowX: 'auto', border: '1px solid #2a2a3e', borderRadius: 6, padding: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {result.ic_decay.by_factor.slice(0, 10).map((f) => {
                    const maxAbs = Math.max(...f.decay.map((d) => Math.abs(d.rank_ic || 0)), 0.001)
                    return (
                      <div key={f.factor}>
                        <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#aaa', marginBottom: 2 }}>{f.factor}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {f.decay.map((d) => {
                            const val = d.rank_ic
                            if (val === null) return (
                              <div key={d.lag} style={{ flex: 1, textAlign: 'center', fontSize: '0.6rem', color: '#555' }}>
                                <div style={{ height: 4, background: '#1a1a2e', borderRadius: 2 }} />
                                lag{d.lag}
                              </div>
                            )
                            const w = Math.abs(val) / maxAbs * 100
                            return (
                              <div key={d.lag} style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{
                                  width: '100%',
                                  height: `${Math.max(w * 0.2, 3)}px`,
                                  background: val > 0 ? '#27ae60' : '#e74c3c',
                                  opacity: Math.max(0.3, w / 100),
                                  borderRadius: 2,
                                }} />
                                <div style={{ fontSize: '0.6rem', color: '#888' }}>lag{d.lag}</div>
                                <div style={{ fontSize: '0.55rem', color: val > 0 ? '#27ae60' : '#e74c3c' }}>{val.toFixed(3)}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const BinReturnTab = ({ result }: { result: ICAnalysisResult | null }) => {
  if (!result) {
    return (
      <div className="alpha-panel">
        <div className="alpha-panel-header"><h3>分箱收益</h3></div>
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>运行 IC 分析后查看分箱收益。</div>
      </div>
    )
  }

  return (
    <div className="alpha-panel">
      <div className="alpha-panel-header">
        <h3>分箱收益</h3>
        <span className="alpha-subtitle">Top 20 因子 | 多空收益 = Top箱 - Bottom箱</span>
      </div>
      <div style={{ padding: '1rem', maxHeight: 600, overflowY: 'auto' }}>
        {result.bin_analysis.factors.slice(0, 20).map((f) => (
          <div key={f.factor} style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{f.factor}</span>
              <span style={{ color: f.long_short_return > 0 ? '#27ae60' : '#e74c3c', fontWeight: 500 }}>
                多空收益: {f.long_short_return > 0 ? '+' : ''}{f.long_short_return.toFixed(6)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 2, height: 24, alignItems: 'flex-end' }}>
              {f.bin_stats.map((bs) => {
                const maxH = 20
                const maxAbsVal = Math.max(...f.bin_stats.map(b => Math.abs(b.mean_return)), 0.001)
                const h = Math.abs(bs.mean_return) / maxAbsVal * maxH
                return (
                  <div
                    key={bs.bin}
                    style={{
                      flex: 1,
                      height: `${Math.max(h, 2)}px`,
                      backgroundColor: bs.mean_return > 0 ? '#27ae60' : '#e74c3c',
                      opacity: 0.8,
                      borderRadius: '2px 2px 0 0',
                    }}
                    title={`B${bs.bin}: ${bs.mean_return.toFixed(6)} (${bs.count}个, 胜率${(bs.win_rate * 100).toFixed(1)}%)`}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CorrelationTab = ({ result }: { result: ICAnalysisResult | null }) => {
  if (!result) {
    return (
      <div className="alpha-panel">
        <div className="alpha-panel-header"><h3>相关性矩阵</h3></div>
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>运行 IC 分析后查看因子相关性。</div>
      </div>
    )
  }

  const { correlation_analysis: corr } = result

  return (
    <div className="alpha-panel">
      <div className="alpha-panel-header">
        <h3>相关性矩阵</h3>
        <span className="alpha-subtitle">{corr.features.length} 因子 | {corr.high_corr_pairs.length} 对高相关 (|r|{'>'}0.7)</span>
      </div>
      <div style={{ padding: '1rem' }}>
        {corr.high_corr_pairs.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ color: '#f39c12', marginBottom: '0.5rem' }}>⚠️ 高相关性因子对</h4>
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #2a2a3e', borderRadius: 4 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#1a1a2e' }}>
                    <th style={thStyle}>因子 A</th>
                    <th style={thStyle}>因子 B</th>
                    <th style={thStyle}>相关系数</th>
                  </tr>
                </thead>
                <tbody>
                  {corr.high_corr_pairs.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a2e', background: i % 2 === 0 ? '#121220' : 'transparent' }}>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{p.factor_a}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{p.factor_b}</td>
                      <td style={{ ...tdStyle, color: Math.abs(p.correlation) > 0.9 ? '#e74c3c' : '#f39c12', fontWeight: 600 }}>
                        {p.correlation.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <h4 style={{ marginBottom: '0.5rem' }}>相关性热力图（前 20 因子）</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: '0.7rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, minWidth: 60 }}></th>
                {corr.features.slice(0, 20).map((f) => (
                  <th key={f} style={{ ...thStyle, writingMode: 'vertical-rl', textOrientation: 'mixed', height: 100, maxWidth: 20, fontSize: '0.65rem' }}>
                    {f.length > 12 ? f.slice(0, 10) + '..' : f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corr.correlation.slice(0, 20).map((row, i) => (
                <tr key={corr.features[i]}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                    {corr.features[i].length > 14 ? corr.features[i].slice(0, 12) + '..' : corr.features[i]}
                  </td>
                  {row.slice(0, 20).map((val, j) => (
                    <td
                      key={j}
                      style={{
                        width: 22,
                        height: 22,
                        textAlign: 'center',
                        fontSize: '0.6rem',
                        backgroundColor: i === j
                          ? '#1a1a2e'
                          : val > 0
                            ? `rgba(39, 174, 96, ${Math.abs(val) * 0.8})`
                            : `rgba(231, 76, 60, ${Math.abs(val) * 0.8})`,
                        color: Math.abs(val) > 0.5 ? '#fff' : '#888',
                      }}
                    >
                      {i === j ? '1' : val.toFixed(1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#aaa',
  borderBottom: '1px solid #2a2a3e',
}

const tdStyle: React.CSSProperties = {
  padding: '4px 10px',
  color: '#ccc',
}

const AlphaResearchWorkbench = () => {
  const [activeTab, setActiveTab] = useState<AlphaTab>('ic_analysis')
  const [datasetId, setDatasetId] = useState('')
  const [dataPath, setDataPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ICAnalysisResult | null>(null)
  const [datasets, setDatasets] = useState<DatasetOption[]>([])
  const [featureTasks, setFeatureTasks] = useState<FeatureTaskOption[]>([])
  const [error, setError] = useState('')

  const handleDatasetChange = useCallback(async (id: string) => {
    setDatasetId(id)
    setDataPath('')
    if (!id) return

    try {
      const res = await window.electronAPI?.research?.listFeatureTasks?.(id)
      if (res?.success && Array.isArray(res.data)) {
        setFeatureTasks(res.data)
      }
    } catch {
      setFeatureTasks([])
    }
  }, [])

  const handleLoadDatasets = useCallback(async () => {
    try {
      const res = await window.electronAPI?.research?.listDatasets?.()
      if (res?.success && Array.isArray(res.data)) {
        setDatasets(res.data)
      }
    } catch {
      // ignore
    }
  }, [])

  const handleRun = useCallback(async () => {
    if (!dataPath) return
    setLoading(true)
    setError('')
    try {
      const res = await window.electronAPI?.research?.factorAnalyze?.({ dataPath })
      if (res?.success && res.data) {
        setResult(res.data as unknown as ICAnalysisResult)
      } else {
        setError(((res as unknown as Record<string, unknown>)?.error as unknown as Record<string, unknown>)?.message as string || '分析失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [dataPath])

  useEffect(() => {
    handleLoadDatasets()
  }, [handleLoadDatasets])

  return (
    <div className="alpha-workbench">
      <div className="alpha-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Alpha 研究</h2>
          <InfoHover content="从因子库浏览、IC 分析到相关性诊断，帮助识别有效因子并发现共线性风险。" />
        </div>
        {error && (
          <div style={{ color: '#e74c3c', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            错误: {error}
          </div>
        )}
      </div>

      <div className="alpha-tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`alpha-tab ${activeTab === tab.id ? 'alpha-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="alpha-tab-label">{tab.label}</span>
            <span className="alpha-tab-desc">{tab.description}</span>
          </button>
        ))}
      </div>

      <div className="alpha-content">
        {activeTab === 'factor_library' && <FactorLibraryTab result={result} />}
        {activeTab === 'ic_analysis' && (
          <ICAnalysisTab
            result={result}
            loading={loading}
            onRun={handleRun}
            datasetId={datasetId}
            dataPath={dataPath}
            onDatasetChange={handleDatasetChange}
            onDataPathChange={setDataPath}
            datasets={datasets}
            featureTasks={featureTasks}
          />
        )}
        {activeTab === 'bin_return' && <BinReturnTab result={result} />}
        {activeTab === 'correlation' && <CorrelationTab result={result} />}
      </div>
    </div>
  )
}

export default AlphaResearchWorkbench
