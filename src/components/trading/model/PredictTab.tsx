import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BatchPredictionData,
  LivePredictionData,
  PlatformResult,
  PredictionSettings,
  PredictionSettingsData,
  UnknownRecord
} from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import type { ModelVersionItem } from './types'
import { toModelVersionItem } from './types'
import { formatTime, readTestAccuracy } from './helpers'

interface PredictionResult {
  code: string
  score: number
  signal: string
  confidence: number
  threshold: number
  model_type: string
  period: string
  date: string
  close: number
  bar_timestamp: number
  model_id: string
  error?: string
}

const toPredictionResult = (raw: unknown): PredictionResult | null => {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const code = typeof row.code === 'string' ? row.code.trim() : ''
  if (!code) return null

  const asNumber = (value: unknown, fallback = 0): number => {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }
  const asString = (value: unknown, fallback = ''): string => {
    return typeof value === 'string' ? value : fallback
  }

  return {
    code,
    score: asNumber(row.score),
    signal: asString(row.signal, 'hold'),
    confidence: asNumber(row.confidence),
    threshold: asNumber(row.threshold, 0.5),
    model_type: asString(row.model_type, 'unknown'),
    period: asString(row.period, '1d'),
    date: asString(row.date),
    close: asNumber(row.close, 0),
    bar_timestamp: asNumber(row.bar_timestamp, 0),
    model_id: asString(row.model_id),
    error: asString(row.error) || undefined
  }
}

const DEFAULT_PREDICTION_SETTINGS: PredictionSettings = {
  autoRefreshEnabled: false,
  autoRefreshIntervalSec: 60,
  freshnessThresholdMinutes: {
    '5m': 20,
    '15m': 60,
    '1d': 36 * 60,
  }
}

const asBoundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

const sanitizePredictionSettings = (
  input: Partial<PredictionSettings>,
  fallback: PredictionSettings = DEFAULT_PREDICTION_SETTINGS
): PredictionSettings => {
  return {
    autoRefreshEnabled: typeof input.autoRefreshEnabled === 'boolean'
      ? input.autoRefreshEnabled
      : fallback.autoRefreshEnabled,
    autoRefreshIntervalSec: asBoundedInt(input.autoRefreshIntervalSec, fallback.autoRefreshIntervalSec, 10, 1800),
    freshnessThresholdMinutes: {
      '5m': asBoundedInt(input.freshnessThresholdMinutes?.['5m'], fallback.freshnessThresholdMinutes['5m'], 5, 240),
      '15m': asBoundedInt(input.freshnessThresholdMinutes?.['15m'], fallback.freshnessThresholdMinutes['15m'], 10, 720),
      '1d': asBoundedInt(input.freshnessThresholdMinutes?.['1d'], fallback.freshnessThresholdMinutes['1d'], 60, 20160),
    }
  }
}

const normalizeEpochMs = (timestamp: number): number | null => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

const resolveBarTimestamp = (result: PredictionResult): number | null => {
  const fromBar = normalizeEpochMs(result.bar_timestamp)
  if (fromBar) return fromBar
  if (!result.date) return null
  const parsed = Date.parse(result.date)
  return Number.isNaN(parsed) ? null : parsed
}

const readFreshnessThresholdMinutes = (period: string, settings: PredictionSettings): number => {
  if (period === '5m') return settings.freshnessThresholdMinutes['5m']
  if (period === '15m') return settings.freshnessThresholdMinutes['15m']
  return settings.freshnessThresholdMinutes['1d']
}

const formatAgeLabel = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes < 0) return '-'
  if (minutes < 1) return '刚更新'
  if (minutes < 60) return `${Math.round(minutes)} 分钟前`
  if (minutes < 24 * 60) return `${(minutes / 60).toFixed(1)} 小时前`
  return `${(minutes / (24 * 60)).toFixed(1)} 天前`
}

const PredictTab = () => {
  const [models, setModels] = useState<ModelVersionItem[]>([])
  const [activeModel, setActiveModel] = useState<ModelVersionItem | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [codeInput, setCodeInput] = useState('')
  const [period, setPeriod] = useState<string>('1d')
  const [isPredicting, setIsPredicting] = useState(false)
  const [results, setResults] = useState<PredictionResult[]>([])
  const [message, setMessage] = useState('')
  const [settings, setSettings] = useState<PredictionSettings>(DEFAULT_PREDICTION_SETTINGS)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [isLoadingSettings, setIsLoadingSettings] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [versionRows, activeRow] = await Promise.all([
        window.electronAPI?.listModels?.(),
        window.electronAPI?.getActiveModel?.(),
      ])
      setModels((versionRows || []).map((row) => toModelVersionItem(row as UnknownRecord)).filter((row): row is ModelVersionItem => row !== null))
      if (activeRow) {
        setActiveModel(toModelVersionItem(activeRow as UnknownRecord))
      } else {
        setActiveModel(null)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const loadSettings = useCallback(async () => {
    if (!window.electronAPI?.getPredictionSettings) return
    setIsLoadingSettings(true)
    try {
      const result = await window.electronAPI.getPredictionSettings() as unknown as PlatformResult<PredictionSettingsData> | undefined
      if (result?.success) {
        setSettings(sanitizePredictionSettings(result.data.settings as Partial<PredictionSettings>))
      }
    } catch {
      setSettingsMessage('预测配置读取失败，已使用默认值。')
    } finally {
      setIsLoadingSettings(false)
    }
  }, [])

  useEffect(() => { void loadSettings() }, [loadSettings])

  const effectiveModelId = selectedModelId || activeModel?.id || ''
  const normalizedCodes = useMemo(() => codeInput.split(/[,，\s]+/).map(c => c.trim()).filter(c => c), [codeInput])
  const freshnessThresholdMinutes = readFreshnessThresholdMinutes(period, settings)

  const handlePredict = useCallback(async (fromAutoRefresh = false) => {
    if (isPredicting) return
    if (!effectiveModelId) {
      if (!fromAutoRefresh) setMessage('请先训练并激活模型')
      return
    }
    if (normalizedCodes.length === 0) {
      if (!fromAutoRefresh) setMessage('请输入至少一个股票代码')
      return
    }

    setIsPredicting(true)
    if (!fromAutoRefresh) {
      setMessage('')
      setResults([])
    }
    try {
      if (normalizedCodes.length === 1) {
        const result = await window.electronAPI?.predictLive?.(effectiveModelId, normalizedCodes[0], period) as PlatformResult<LivePredictionData> | undefined
        if (result?.success) {
          const single = toPredictionResult(result.data.prediction)
          if (!single) {
            const raw = result.data.prediction
            const rawInfo = raw === null
              ? 'null'
              : Array.isArray(raw)
                ? `array(${raw.length})`
                : typeof raw
            setResults([])
            setMessage(
              fromAutoRefresh
                ? `自动刷新完成，但返回数据格式异常（${rawInfo}）`
                : `预测返回格式异常（${rawInfo}），请检查模型输出`
            )
            return
          }
          setResults([single])
          setMessage(fromAutoRefresh ? `自动刷新完成 (${new Date().toLocaleTimeString('zh-CN', { hour12: false })})` : '预测完成')
        } else {
          setMessage(getPlatformErrorMessage(result, fromAutoRefresh ? '自动刷新失败' : '预测失败'))
        }
      } else {
        const result = await window.electronAPI?.predictBatch?.(effectiveModelId, normalizedCodes, period) as PlatformResult<BatchPredictionData> | undefined
        if (result?.success) {
          const rawPredictions = Array.isArray(result.data.predictions) ? result.data.predictions : []
          const predictions = rawPredictions
            .map((item) => toPredictionResult(item))
            .filter((item): item is PredictionResult => item !== null)
          setResults(predictions)
          setMessage(
            fromAutoRefresh
              ? `自动刷新完成，${predictions.length} 个标的 (${new Date().toLocaleTimeString('zh-CN', { hour12: false })})`
              : `预测完成，${predictions.length} 个标的`
          )
        } else {
          setMessage(getPlatformErrorMessage(result, fromAutoRefresh ? '自动刷新失败' : '批量预测失败'))
        }
      }
    } catch (error) {
      setMessage(`异常: ${error instanceof Error ? error.message : 'unknown_error'}`)
    } finally {
      setIsPredicting(false)
    }
  }, [effectiveModelId, isPredicting, normalizedCodes, period])

  useEffect(() => {
    if (!settings.autoRefreshEnabled) return
    if (!effectiveModelId) return
    if (normalizedCodes.length === 0) return
    const timer = window.setInterval(() => {
      void handlePredict(true)
    }, settings.autoRefreshIntervalSec * 1000)
    return () => window.clearInterval(timer)
  }, [effectiveModelId, handlePredict, normalizedCodes.length, settings.autoRefreshEnabled, settings.autoRefreshIntervalSec])

  const handleSaveSettings = useCallback(async () => {
    const normalized = sanitizePredictionSettings(settings)
    setSettings(normalized)
    setSettingsMessage('')
    if (!window.electronAPI?.updatePredictionSettings) {
      setSettingsMessage('当前环境未启用持久化，设置仅在当前页面生效。')
      return
    }
    setIsSavingSettings(true)
    try {
      const result = await window.electronAPI.updatePredictionSettings(normalized as unknown as UnknownRecord) as unknown as PlatformResult<PredictionSettingsData> | undefined
      if (result?.success) {
        setSettings(sanitizePredictionSettings(result.data.settings as Partial<PredictionSettings>, normalized))
        setSettingsMessage('预测配置已保存。')
      } else {
        setSettingsMessage(getPlatformErrorMessage(result, '预测配置保存失败'))
      }
    } catch {
      setSettingsMessage('预测配置保存失败。')
    } finally {
      setIsSavingSettings(false)
    }
  }, [settings])

  const freshnessSummary = useMemo(() => {
    if (results.length === 0) return null
    const now = Date.now()
    const timestamps = results
      .map((result) => resolveBarTimestamp(result))
      .filter((timestamp): timestamp is number => timestamp !== null)
    if (timestamps.length === 0) return null
    const ages = timestamps.map((timestamp) => (now - timestamp) / 60_000)
    const newestTimestamp = Math.max(...timestamps)
    const oldestTimestamp = Math.min(...timestamps)
    const minAgeMinutes = Math.min(...ages)
    const maxAgeMinutes = Math.max(...ages)
    const staleCount = ages.filter((age) => age > freshnessThresholdMinutes).length
    return {
      newestTimestamp,
      oldestTimestamp,
      minAgeMinutes,
      maxAgeMinutes,
      staleCount
    }
  }, [freshnessThresholdMinutes, results])

  return (
    <>
      <section className="model-card">
        <div className="model-card-head">
          <h3>准实时预测</h3>
          {settings.autoRefreshEnabled && normalizedCodes.length > 0 && (
            <span className="polling-badge">自动刷新 {settings.autoRefreshIntervalSec}s</span>
          )}
        </div>
        <p className="model-desc">使用本地最新同步行情运行模型预测。支持多个代码（逗号分隔），延迟通常取决于行情同步频率。</p>
        {message && <p className="model-message">{message}</p>}
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <label>模型
            <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
              <option value="">使用活跃模型</option>
              {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.id.slice(0, 12)})</option>))}
            </select>
          </label>
          <label>股票代码
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="如 000001 或 000001,600519" />
          </label>
          <label>周期
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="1d">日线</option>
              <option value="15m">15分钟</option>
              <option value="5m">5分钟</option>
            </select>
          </label>
          <label>&nbsp;
            <button className="btn btn-accept" disabled={isPredicting || !effectiveModelId} onClick={() => void handlePredict()}>
              {isPredicting ? '预测中...' : '预测'}
            </button>
          </label>
        </div>
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 10 }}>
          <label>自动刷新
            <select
              value={settings.autoRefreshEnabled ? 'on' : 'off'}
              onChange={(e) => setSettings((prev) => ({ ...prev, autoRefreshEnabled: e.target.value === 'on' }))}
              disabled={isLoadingSettings}
            >
              <option value="off">关闭</option>
              <option value="on">开启</option>
            </select>
          </label>
          <label>刷新间隔(秒)
            <input
              type="number"
              min={10}
              max={1800}
              step={5}
              value={settings.autoRefreshIntervalSec}
              onChange={(e) => setSettings((prev) => ({ ...prev, autoRefreshIntervalSec: asBoundedInt(e.target.value, prev.autoRefreshIntervalSec, 10, 1800) }))}
              disabled={isLoadingSettings}
            />
          </label>
          <label>5m 阈值(分钟)
            <input
              type="number"
              min={5}
              max={240}
              step={1}
              value={settings.freshnessThresholdMinutes['5m']}
              onChange={(e) => setSettings((prev) => ({
                ...prev,
                freshnessThresholdMinutes: {
                  ...prev.freshnessThresholdMinutes,
                  '5m': asBoundedInt(e.target.value, prev.freshnessThresholdMinutes['5m'], 5, 240),
                }
              }))}
              disabled={isLoadingSettings}
            />
          </label>
          <label>15m 阈值(分钟)
            <input
              type="number"
              min={10}
              max={720}
              step={5}
              value={settings.freshnessThresholdMinutes['15m']}
              onChange={(e) => setSettings((prev) => ({
                ...prev,
                freshnessThresholdMinutes: {
                  ...prev.freshnessThresholdMinutes,
                  '15m': asBoundedInt(e.target.value, prev.freshnessThresholdMinutes['15m'], 10, 720),
                }
              }))}
              disabled={isLoadingSettings}
            />
          </label>
        </div>
        <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 10 }}>
          <label>1d 阈值(分钟)
            <input
              type="number"
              min={60}
              max={20160}
              step={30}
              value={settings.freshnessThresholdMinutes['1d']}
              onChange={(e) => setSettings((prev) => ({
                ...prev,
                freshnessThresholdMinutes: {
                  ...prev.freshnessThresholdMinutes,
                  '1d': asBoundedInt(e.target.value, prev.freshnessThresholdMinutes['1d'], 60, 20160),
                }
              }))}
              disabled={isLoadingSettings}
            />
          </label>
          <label>&nbsp;
            <button className="btn btn-secondary" onClick={() => void handleSaveSettings()} disabled={isSavingSettings || isLoadingSettings}>
              {isSavingSettings ? '保存中...' : '保存预测配置'}
            </button>
          </label>
        </div>
        {settingsMessage && <p className="model-subtle">{settingsMessage}</p>}
        {activeModel && !selectedModelId && (
          <p className="model-subtle">当前活跃模型: {activeModel.name} (Test Acc: {readTestAccuracy(activeModel.metricsJson)})</p>
        )}
        {!activeModel && !selectedModelId && (
          <p className="model-subtle" style={{ color: '#d97706' }}>无活跃模型，请先在模型仓库中激活一个模型</p>
        )}
        <p className="model-subtle">数据模式：准实时（读取本地已同步的最新 K 线）。当前周期阈值：{freshnessThresholdMinutes} 分钟。</p>
      </section>

      {results.length > 0 && (
        <section className="model-card">
          <div className="model-card-head"><h3>预测结果 ({results.length})</h3></div>
          {freshnessSummary && (
            <>
              <div className="model-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div><span className="model-stat-label">最新数据时间</span><div><strong>{formatTime(freshnessSummary.newestTimestamp)}</strong></div></div>
                <div><span className="model-stat-label">最旧数据时间</span><div><strong>{formatTime(freshnessSummary.oldestTimestamp)}</strong></div></div>
                <div><span className="model-stat-label">延迟范围</span><div><strong>{formatAgeLabel(freshnessSummary.minAgeMinutes)} ~ {formatAgeLabel(freshnessSummary.maxAgeMinutes)}</strong></div></div>
                <div><span className="model-stat-label">超阈值标的</span><div><strong>{freshnessSummary.staleCount}</strong></div></div>
              </div>
              <p className="model-subtle" style={{ color: freshnessSummary.staleCount > 0 ? '#b45309' : '#6b7280' }}>
                当前阈值：{freshnessThresholdMinutes} 分钟。超阈值标的建议先补齐行情再判断信号。
              </p>
            </>
          )}
          <div className="model-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>代码</th><th>信号</th><th>分数</th><th>置信度</th><th>收盘价</th><th>数据时间</th><th>延迟</th><th>模型类型</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const barTimestamp = resolveBarTimestamp(r)
                  const ageMinutes = barTimestamp ? (Date.now() - barTimestamp) / 60_000 : Number.NaN
                  return (
                    <tr key={i}>
                      <td><strong>{r.code}</strong></td>
                      <td className={r.signal === 'buy' ? 'signal-buy' : 'signal-sell'}>
                        {r.signal === 'buy' ? '买点' : '卖点'}
                      </td>
                      <td>{(r.score * 100).toFixed(1)}%</td>
                      <td>{(r.confidence * 100).toFixed(1)}%</td>
                      <td>{r.close ? r.close.toFixed(2) : '-'}</td>
                      <td>{barTimestamp ? formatTime(barTimestamp) : (r.date || '-')}</td>
                      <td style={{ color: ageMinutes > freshnessThresholdMinutes ? '#b45309' : '#6b7280' }}>{formatAgeLabel(ageMinutes)}</td>
                      <td><span className={`engine-${r.model_type}`}>{r.model_type}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

export default PredictTab
