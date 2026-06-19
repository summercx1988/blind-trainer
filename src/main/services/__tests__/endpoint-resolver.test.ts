import { describe, it, expect } from 'vitest'
import { resolveEndpoint, DEFAULT_BASE_URL, DEFAULT_MODEL } from '../endpoint-resolver'

describe('resolveEndpoint', () => {
  it('MiniMax 国内 base_url 自动拼 /v1/messages', () => {
    expect(resolveEndpoint('https://api.minimaxi.com/anthropic'))
      .toBe('https://api.minimaxi.com/anthropic/v1/messages')
  })

  it('MiniMax 海外 base_url 自动拼 /v1/messages', () => {
    expect(resolveEndpoint('https://api.minimax.io/anthropic'))
      .toBe('https://api.minimax.io/anthropic/v1/messages')
  })

  it('智谱 GLM base_url 自动拼 /v1/messages', () => {
    expect(resolveEndpoint('https://open.bigmodel.cn/api/anthropic'))
      .toBe('https://open.bigmodel.cn/api/anthropic/v1/messages')
  })

  it('已含 /v1/messages 的完整 URL 原样返回（向后兼容旧配置）', () => {
    const full = 'https://open.bigmodel.cn/api/anthropic/v1/messages'
    expect(resolveEndpoint(full)).toBe(full)
  })

  it('去除尾部斜杠避免双斜杠', () => {
    expect(resolveEndpoint('https://api.minimaxi.com/anthropic/'))
      .toBe('https://api.minimaxi.com/anthropic/v1/messages')
  })

  it('空字符串返回空字符串', () => {
    expect(resolveEndpoint('')).toBe('')
    expect(resolveEndpoint('   ')).toBe('')
  })

  it('默认值是 MiniMax 国内 endpoint', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(DEFAULT_MODEL).toBe('MiniMax-M3')
  })
})
