import type { AiAdvisorConfig } from '../../types/agent'

export interface LlmCallResult {
  ok: boolean
  content: string
  status: number | null
  promptTokens: number | null
  completionTokens: number | null
  durationMs: number
  error: string | null
}

const TIMEOUT_MS = 30_000

export async function callLlm(
  config: AiAdvisorConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  timeoutMs = TIMEOUT_MS
): Promise<LlmCallResult> {
  if (!config.ready) {
    return { ok: false, content: '', status: null, promptTokens: null, completionTokens: null, durationMs: 0, error: 'not_configured' }
  }
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        messages,
      }),
      signal: controller.signal,
    })
    const durationMs = Date.now() - start
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, content: text, status: res.status, promptTokens: null, completionTokens: null, durationMs, error: `http_${res.status}` }
    }
    const json = await res.json() as {
      content?: Array<{ text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const content = json.content?.[0]?.text ?? ''
    return {
      ok: true,
      content,
      status: res.status,
      promptTokens: json.usage?.input_tokens ?? null,
      completionTokens: json.usage?.output_tokens ?? null,
      durationMs,
      error: null,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      content: '',
      status: null,
      promptTokens: null,
      completionTokens: null,
      durationMs,
      error: aborted ? 'timeout' : 'network_error',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function testConnection(config: AiAdvisorConfig): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const result = await callLlm(config, [{ role: 'user', content: 'ping' }], 10_000)
  return { ok: result.ok, latencyMs: result.durationMs, error: result.error }
}
