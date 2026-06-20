import { useEffect, useState } from 'react'

interface AiAdvisorSettingsProps {
  onSaved?: () => void
}

export default function AiAdvisorSettings({ onSaved }: AiAdvisorSettingsProps) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [ready, setReady] = useState(false)
  const [masked, setMasked] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [configPath, setConfigPath] = useState('')

  useEffect(() => {
    void (async () => {
      const cfg = await window.electronAPI?.agent?.getConfig()
      if (cfg) {
        setBaseUrl(cfg.baseUrl)
        setModel(cfg.model)
        setReady(cfg.ready)
        setMasked(cfg.apiKeyMasked)
        setConfigPath(cfg.configPath)
      }
    })()
  }, [])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      if (apiKey || baseUrl || model) {
        await window.electronAPI?.agent?.saveConfig({ baseUrl, apiKey, model })
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
      await window.electronAPI?.agent?.saveConfig({ baseUrl, apiKey, model })
      const cfg = await window.electronAPI?.agent?.getConfig()
      if (cfg) {
        setReady(cfg.ready)
        setMasked(cfg.apiKeyMasked)
        setConfigPath(cfg.configPath)
        // 保存后清空 apiKey 输入, 与"留空则不修改"语义一致
        setApiKey('')
      }
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  const handleOpenConfigFile = async () => {
    await window.electronAPI?.agent?.openConfigFile()
  }

  return (
    <div className="ai-advisor-settings">
      <div className="ai-advisor-settings-row">
        <label>Base URL</label>
        <input
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://api.minimaxi.com/anthropic"
        />
        <small className="ai-advisor-settings-hint">
          不含 /v1/messages 后缀，程序自动拼接。常见：MiniMax 国内 https://api.minimaxi.com/anthropic ·
          MiniMax 海外 https://api.minimax.io/anthropic · 智谱 GLM https://open.bigmodel.cn/api/anthropic
        </small>
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
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="MiniMax-M3" />
        <small className="ai-advisor-settings-hint">
          MiniMax：MiniMax-M3 / MiniMax-M2.7 · 智谱：glm-4.6 / glm-4.7
        </small>
      </div>
      <div className="ai-advisor-settings-actions">
        <button onClick={handleTest} disabled={testing || (!apiKey && !ready)}>
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button onClick={handleSave} disabled={saving || !baseUrl || !model}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      {testResult && <div className="ai-advisor-settings-test-result">{testResult}</div>}
      {configPath && (
        <div className="ai-advisor-settings-config-file">
          <span className="ai-advisor-settings-config-file-label">配置文件：</span>
          <code className="ai-advisor-settings-config-path" title={configPath}>{configPath}</code>
          <button
            type="button"
            className="ai-advisor-settings-open-file"
            onClick={handleOpenConfigFile}
            title="用默认编辑器打开 ai-config.env 手动编辑"
          >
            打开
          </button>
        </div>
      )}
      {!ready && (
        <div className="ai-advisor-settings-warning" role="status">
          注意：AI 教练将向 {baseUrl || '配置的 Base URL'} 发送你的脱敏训练记录（含已结束 session 的股票代码与动作序列）。配置即视为同意。
        </div>
      )}
    </div>
  )
}
