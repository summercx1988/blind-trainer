import { useCallback, useEffect, useRef, useState } from 'react'
import type { BacktestReportData, ModelArtifactPayload, ModelReportPayload, PlatformResult } from '../../types/ipc'
import { getPlatformErrorMessage } from '../../types/ipc'
import './AiChat.css'
import '../../types/global.d'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface LlmConfig {
  endpoint: string
  apiKey: string
  model: string
}

const STORAGE_KEY = 'aichat_config'

const DEFAULT_AI_ENDPOINT = 'https://open.bigmodel.cn/api/anthropic/v1/messages'
const ANTHROPIC_API_VERSION = '2023-06-01'

const DEFAULT_CONFIG: LlmConfig = {
  endpoint: DEFAULT_AI_ENDPOINT,
  apiKey: '',
  model: 'glm-4.7',
}

const PRESET_MODELS = [
  { label: 'GLM-5.2', endpoint: DEFAULT_AI_ENDPOINT, model: 'glm-5.2' },
  { label: 'GLM-4.7', endpoint: DEFAULT_AI_ENDPOINT, model: 'glm-4.7' },
  { label: 'GLM-4-Plus', endpoint: DEFAULT_AI_ENDPOINT, model: 'glm-4-plus' },
  { label: 'GLM-4-Flash', endpoint: DEFAULT_AI_ENDPOINT, model: 'glm-4-flash' },
  { label: 'GLM-4-Air', endpoint: DEFAULT_AI_ENDPOINT, model: 'glm-4-air' },
  { label: '自定义', endpoint: '', model: '' },
]

const SYSTEM_PROMPT = `你是一个专业的A股交易策略助手。你可以帮助用户：
1. 分析交易策略的优劣（MA/RSI/MACD/BOLL/量价突破等因子）
2. 解释模型信号含义（CatBoost/LightGBM输出的买卖信号）
3. 建议训练改进方向（特征筛选、阈值优化、集成方法）
4. 解读回测指标（夏普比率、最大回撤、盈亏比等）
5. 评估用户的盲训操作表现（买卖时机、持仓纪律、止盈止损习惯），基于历史会话数据给出具体改进建议
6. 分析模型训练效果和回测报告

回答要简洁专业，优先给出可操作建议。用中文回答。`

const buildContext = async (): Promise<string> => {
  const parts: string[] = []
  const [activeModel, candidates] = await Promise.all([
    Promise.resolve(window.electronAPI?.getActiveModel?.()).catch(() => undefined),
    Promise.resolve(window.electronAPI?.listCandidates?.({ status: 'accepted', limit: 50 })).catch(() => undefined),
  ])

  if (activeModel && (activeModel as Record<string, unknown>).id) {
    const modelRecord = activeModel as Record<string, unknown>
    parts.push(`当前激活模型: ${modelRecord.name || modelRecord.id} (${modelRecord.model_type || 'unknown'})`)
    if (modelRecord.metricsJson) {
      const metrics = modelRecord.metricsJson as Record<string, unknown>
      if (metrics.test_auc) parts.push(`Test AUC: ${metrics.test_auc}`)
      if (metrics.test_f1) parts.push(`Test F1: ${metrics.test_f1}`)
    }
  } else {
    parts.push('当前无激活模型')
  }

  if (Array.isArray(candidates) && candidates.length > 0) {
    const factorTypes = (candidates as Array<Record<string, unknown>>).reduce<Record<string, number>>((acc, c) => {
      const ft = String(c.factor_type || 'unknown')
      acc[ft] = (acc[ft] || 0) + 1
      return acc
    }, {})
    parts.push(`已审核候选信号: ${candidates.length}条 (因子分布: ${Object.entries(factorTypes).map(([k, v]) => `${k}:${v}`).join(', ')})`)
  }

  return parts.length > 0 ? `\n\n当前系统状态:\n${parts.join('\n')}` : ''
}

const toAnthropicMessages = (msgs: ChatMessage[]): Array<{ role: string; content: string }> => {
  return msgs.map((m) => ({ role: m.role, content: m.content }))
}

const AiChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState<LlmConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG
    } catch {
      return DEFAULT_CONFIG
    }
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (config.apiKey) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    }
  }, [config])

  useEffect(() => {
    if (config.apiKey) return
    const loadDefaults = async () => {
      try {
        const defaults = await window.electronAPI?.aichatGetDefaultConfig?.()
        if (defaults && defaults.apiKey) {
          setConfig((prev) => ({
            ...prev,
            endpoint: defaults.endpoint || prev.endpoint,
            apiKey: defaults.apiKey,
            model: defaults.model || prev.model,
          }))
        }
      } catch { /* ignore */ }
    }
    void loadDefaults()
  }, [config.apiKey])

  const sendMessage = useCallback(async (rawText: string, options?: { clearComposer?: boolean }) => {
    const text = rawText.trim()
    if (!text || loading) return false
    if (!config.apiKey) {
      setShowConfig(true)
      setMessages((prev) => [...prev, { role: 'assistant', content: '请先在设置中配置 API Key，再使用 AI 助手。' }])
      return false
    }

    const userMsg: ChatMessage = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    if (options?.clearComposer ?? false) {
      setInput('')
    }
    setLoading(true)

    try {
      const context = await buildContext()
      const systemPrompt = SYSTEM_PROMPT + context
      const apiMessages = toAnthropicMessages(nextMessages)

      const abort = new AbortController()
      abortRef.current = abort

      const isAnthropic = config.endpoint.includes('/messages')

      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: isAnthropic
          ? {
              'Content-Type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': ANTHROPIC_API_VERSION,
            }
          : {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.apiKey}`,
            },
        body: JSON.stringify(isAnthropic
          ? {
              model: config.model,
              max_tokens: 2000,
              system: systemPrompt,
              messages: apiMessages,
              stream: true,
            }
          : {
              model: config.model,
              messages: [{ role: 'system', content: systemPrompt }, ...apiMessages],
              stream: true,
              max_tokens: 2000,
            }
        ),
        signal: abort.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        setMessages((prev) => [...prev, { role: 'assistant', content: `API 错误 (${response.status}): ${errText.slice(0, 500)}` }])
        return false
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '接口未返回可读取的响应流。' }])
        return false
      }

      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      const applyStreamLine = (rawLine: string) => {
        const trimmed = rawLine.trim()
        if (!trimmed || !trimmed.startsWith('data:')) return false
        const data = trimmed.slice(5).trimStart()
        if (data === '[DONE]') return true
        try {
          const parsed = JSON.parse(data)
          if (isAnthropic) {
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              assistantContent += parsed.delta.text
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
                return updated
              })
            }
            return false
          }

          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            assistantContent += delta
            setMessages((prev) => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
              return updated
            })
          }
        } catch {
          return false
        }
        return false
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (applyStreamLine(line)) {
            buffer = ''
            break
          }
        }
      }

      const trailingLine = buffer.trim()
      if (trailingLine) {
        applyStreamLine(trailingLine)
      }
      return true
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => [...prev, { role: 'assistant', content: `请求失败: ${(err as Error).message}` }])
      }
      return false
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [loading, config, messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    await sendMessage(text, { clearComposer: true })
  }, [input, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  const handleClear = useCallback(() => {
    setMessages([])
  }, [])

  const handleEvaluateTraining = useCallback(async () => {
    try {
      const sessions = await window.electronAPI?.aichatGetRecentSessions?.(5)
      if (!sessions || sessions.length === 0) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '暂无已完成的训练会话数据。请先进行至少一次盲训。' }])
        return
      }

      const sessionLines = sessions.map((s, i) => {
        const actions = (s.actions as Array<Record<string, unknown>> || [])
          .filter((a) => a.action_type === 'buy' || a.action_type === 'sell')
          .map((a) => `${a.action_type}@${Number(a.price).toFixed(2)}`)
          .join(' → ')
        const pnl = s.realized_pnl != null ? Number(s.realized_pnl).toFixed(0) : '?'
        const winRate = s.trade_win_rate != null ? `${(Number(s.trade_win_rate) * 100).toFixed(1)}%` : '?'
        const drawdown = s.max_drawdown_pct != null ? `${Number(s.max_drawdown_pct).toFixed(2)}%` : '?'
        return `${i + 1}. ${s.stock_name}(${s.stock_code}) ${s.interval_type} | 收益: ${pnl}元 | 胜率: ${winRate} | 回撤: ${drawdown}\n   操作: ${actions || '无交易'}`
      }).join('\n\n')

      const prompt = `请评估我最近 ${sessions.length} 次盲训表现：\n\n${sessionLines}\n\n请从以下角度点评：\n1. 买卖时机是否合理\n2. 持仓纪律（是否过早止盈/止损）\n3. 整体收益趋势\n4. 具体改进建议`
      await sendMessage(prompt)
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `获取训练数据失败: ${(err as Error).message}` }])
    }
  }, [sendMessage])

  const handleAnalyzeModel = useCallback(async () => {
    try {
      const model = await window.electronAPI?.getActiveModel?.() as Record<string, unknown> | undefined
      if (!model || !model.id) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '当前无激活模型。请先在「模型部署」页面激活一个模型。' }])
        return
      }

      const [artifact, report] = await Promise.all([
        Promise.resolve(window.electronAPI?.getModelArtifact?.(String(model.id))).catch(() => undefined),
        Promise.resolve(window.electronAPI?.getModelReport?.(String(model.id))).catch(() => undefined),
      ]) as [
        PlatformResult<ModelArtifactPayload> | undefined,
        PlatformResult<ModelReportPayload> | undefined
      ]

      const lines = [`模型: ${model.name || model.id} (${model.model_type || 'unknown'})`]
      if (artifact?.success) {
        const payload = artifact.data.artifact as Record<string, unknown>
        if (payload.threshold) lines.push(`阈值: ${payload.threshold}`)
        if (payload.num_trees) lines.push(`树数量: ${payload.num_trees}`)
        const imp = payload.feature_importance as Record<string, number> | undefined
        if (imp) {
          const top5 = Object.entries(imp).sort(([, a], [, b]) => b - a).slice(0, 5)
          lines.push(`Top5 特征: ${top5.map(([k, v]) => `${k}(${(v * 100).toFixed(1)}%)`).join(', ')}`)
        }
      }
      if (report?.success) {
        lines.push(`训练报告: ${report.data.content.slice(0, 500)}`)
      }

      const prompt = `请分析以下模型的效果并给出优化建议：\n\n${lines.join('\n')}\n\n请从 AUC/F1 水平、特征质量、超参空间等角度分析，并给出下一步优化方向。`
      await sendMessage(prompt)
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `获取模型数据失败: ${(err as Error).message}` }])
    }
  }, [sendMessage])

  const handleAnalyzeBacktest = useCallback(async () => {
    try {
      const model = await window.electronAPI?.getActiveModel?.() as Record<string, unknown> | undefined
      if (!model || !model.id) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '当前无激活模型。请先在「模型部署」页面激活一个模型，并执行回测。' }])
        return
      }

      const report = await window.electronAPI?.backtest?.getReport?.(String(model.id)) as PlatformResult<BacktestReportData> | undefined
      if (!report?.success || !report.data.report) {
        setMessages((prev) => [...prev, { role: 'assistant', content: getPlatformErrorMessage(report, '未找到回测报告。请先在「回测分析」页面执行一次回测。') }])
        return
      }

      const lines = [`模型: ${model.name || model.id}`]
      const reportPayload = report.data.report as Record<string, unknown>
      const mc = reportPayload.metrics_conservative as Record<string, number> | undefined
      const mo = reportPayload.metrics_optimistic as Record<string, number> | undefined

      if (mc) {
        lines.push(`\n保守出场指标:`)
        lines.push(`  累计收益: ${((mc.cumulative_return || 0) * 100).toFixed(2)}%`)
        lines.push(`  夏普比率: ${(mc.sharpe_ratio || 0).toFixed(2)}`)
        lines.push(`  最大回撤: ${((mc.max_drawdown || 0) * 100).toFixed(2)}%`)
        lines.push(`  胜率: ${((mc.win_rate || 0) * 100).toFixed(1)}%`)
        lines.push(`  盈亏比: ${(mc.profit_factor || 0).toFixed(2)}`)
        lines.push(`  总交易: ${mc.total_trades || 0}`)
      }
      if (mo) {
        lines.push(`\n乐观出场指标:`)
        lines.push(`  累计收益: ${((mo.cumulative_return || 0) * 100).toFixed(2)}%`)
        lines.push(`  夏普比率: ${(mo.sharpe_ratio || 0).toFixed(2)}`)
      }

      const prompt = `请解读以下回测报告并给出优化建议：\n\n${lines.join('\n')}\n\n请从以下角度分析：\n1. 整体策略是否可盈利？夏普比率是否达标？\n2. 最大回撤是否可控？\n3. 保守 vs 乐观出场的差异说明了什么？\n4. 阈值和仓位管理的优化方向。`
      await sendMessage(prompt)
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取回测数据失败'
      setMessages((prev) => [...prev, { role: 'assistant', content: `获取回测数据失败: ${message}` }])
    }
  }, [sendMessage])

  const applyPreset = useCallback((preset: typeof PRESET_MODELS[number]) => {
    setConfig((prev) => ({
      ...prev,
      endpoint: preset.endpoint || prev.endpoint,
      model: preset.model || prev.model,
    }))
  }, [])

  return (
    <div className="aichat-container">
      <div className="aichat-header">
        <h3>AI 策略助手</h3>
        <div className="aichat-header-actions">
          <button className="aichat-btn" onClick={() => void handleEvaluateTraining()}>评估训练</button>
          <button className="aichat-btn" onClick={() => void handleAnalyzeModel()}>分析模型</button>
          <button className="aichat-btn" onClick={() => void handleAnalyzeBacktest()}>解读回测</button>
          <button className="aichat-btn" onClick={handleClear}>清空</button>
          <button className={`aichat-btn ${showConfig ? 'aichat-btn-active' : ''}`} onClick={() => setShowConfig((v) => !v)}>
            设置
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="aichat-config">
          <div className="aichat-config-presets">
            {PRESET_MODELS.map((p) => (
              <button key={p.label} className="aichat-preset-btn" onClick={() => applyPreset(p)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="aichat-config-row">
            <label>API Endpoint</label>
            <input
              type="text"
              value={config.endpoint}
              onChange={(e) => setConfig((c) => ({ ...c, endpoint: e.target.value }))}
              placeholder="https://api.openai.com/v1/chat/completions"
            />
          </div>
          <div className="aichat-config-row">
            <label>API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
              placeholder="sk-..."
            />
          </div>
          <div className="aichat-config-row">
            <label>Model</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              placeholder="gpt-4o-mini"
            />
          </div>
          <div className="aichat-config-hint">
            默认使用 GLM（智谱 AI），API Key 自动从系统环境变量加载。
            也支持自定义 Anthropic/OpenAI 兼容接口。Key 仅存本地 localStorage。
          </div>
        </div>
      )}

      <div className="aichat-messages">
        {messages.length === 0 && (
          <div className="aichat-empty">
            <div className="aichat-empty-icon">💬</div>
            <p>AI 策略助手 — 点评训练、解读模型、分析策略</p>
            <div className="aichat-quick-actions">
              <button className="aichat-action-btn" onClick={() => void handleEvaluateTraining()}>
                评估最近训练
              </button>
              <button className="aichat-action-btn" onClick={() => void handleAnalyzeModel()}>
                分析模型效果
              </button>
              <button className="aichat-action-btn" onClick={() => void handleAnalyzeBacktest()}>
                解读回测报告
              </button>
            </div>
            <div className="aichat-suggestions">
              {[
                '解释 MA20 上穿策略的优缺点',
                '如何判断模型信号是否可信？',
                '帮我分析当前的回测夏普比率',
                '建议下一步模型优化方向',
              ].map((s) => (
                <button key={s} className="aichat-suggestion" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`aichat-msg aichat-msg-${msg.role}`}>
            <div className="aichat-msg-label">{msg.role === 'user' ? '你' : 'AI'}</div>
            <div className="aichat-msg-content">
              {msg.content.split('\n').map((line, j) => (
                <span key={j}>
                  {line}
                  {j < msg.content.split('\n').length - 1 && <br />}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="aichat-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={config.apiKey ? '输入问题，Enter 发送，Shift+Enter 换行...' : '请先在「API 设置」中配置 API Key'}
          rows={2}
          disabled={loading}
        />
        <div className="aichat-input-actions">
          {loading ? (
            <button className="aichat-send-btn aichat-stop-btn" onClick={handleStop}>停止</button>
          ) : (
            <button className="aichat-send-btn" onClick={() => void handleSend()} disabled={!input.trim()}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AiChat
