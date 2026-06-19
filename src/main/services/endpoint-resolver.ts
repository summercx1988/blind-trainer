export const DEFAULT_BASE_URL = 'https://api.minimaxi.com/anthropic'
export const DEFAULT_MODEL = 'MiniMax-M3'
const MESSAGES_PATH = '/v1/messages'

/**
 * 把用户填的 base_url 解析成完整请求 URL。
 * - 若已含 /v1/messages（旧配置或用户填了完整路径），原样返回
 * - 否则拼接 base_url + /v1/messages，自动去除尾部斜杠避免双斜杠
 *
 * Anthropic 兼容接口的几家供应商：
 * - MiniMax（国内）: https://api.minimaxi.com/anthropic
 * - MiniMax（海外）: https://api.minimax.io/anthropic
 * - 智谱 GLM: https://open.bigmodel.cn/api/anthropic
 * 后缀都是 /v1/messages。
 */
export function resolveEndpoint(baseUrl: string): string {
  const trimmed = (baseUrl ?? '').trim()
  if (trimmed === '') return ''
  if (trimmed.includes(MESSAGES_PATH)) return trimmed
  return `${trimmed.replace(/\/+$/, '')}${MESSAGES_PATH}`
}
