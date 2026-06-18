import { useEffect, useState } from 'react'

interface AiAdvisorSettingsProps {
  onSaved?: () => void
}

export default function AiAdvisorSettings({ onSaved }: AiAdvisorSettingsProps) {
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [ready, setReady] = useState(false)
  const [masked, setMasked] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const cfg = await window.electronAPI?.agent?.getConfig()
      if (cfg) {
        setEndpoint(cfg.endpoint)
        setModel(cfg.model)
        setReady(cfg.ready)
        setMasked(cfg.apiKeyMasked)
      }
    })()
  }, [])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      if (apiKey) {
        await window.electronAPI?.agent?.saveConfig({ endpoint, apiKey, model })
      }
      const r = await window.electronAPI?.agent?.testConnection()
      setTestResult(r?.ok ? `连接成功（${r.latencyMs}ms）` : `失败：${r?.error ?? '未知'}`)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI?.agent?.saveConfig({ endpoint, apiKey, model })
      const cfg = await window.electronAPI?.agent?.getConfig()
      if (cfg) {
        setReady(cfg.ready)
        setMasked(cfg.apiKeyMasked)
      }
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ai-advisor-settings">
      <div className="ai-advisor-settings-row">
        <label>Endpoint</label>
        <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://open.bigmodel.cn/api/anthropic/v1/messages" />
      </div>
      <div className="ai-advisor-settings-row">
        <label>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={ready ? `已配置 ${masked}（留空则不修改）` : '输入 API Key'}
        />
      </div>
      <div className="ai-advisor-settings-row">
        <label>Model</label>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="glm-4.7" />
      </div>
      <div className="ai-advisor-settings-actions">
        <button onClick={handleTest} disabled={testing || (!apiKey && !ready)}>
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button onClick={handleSave} disabled={saving || !endpoint || !model}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      {testResult && <div className="ai-advisor-settings-test-result">{testResult}</div>}
      {!ready && (
        <div className="ai-advisor-settings-warning">
          ⚠️ AI 教练将向 {endpoint || '配置的 endpoint'} 发送你的脱敏训练记录（含已结束 session 的股票代码与动作序列）。配置即视为同意。
        </div>
      )}
    </div>
  )
}
