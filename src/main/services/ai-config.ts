import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import log from '../logger'

/**
 * AI 助手配置 — 基于本地 .env 文件存储。
 *
 * 文件位置: app.getPath('userData') + '/ai-config.env'
 *   macOS: ~/Library/Application Support/<productName>/ai-config.env
 *
 * 字段名 (与 .env 通用约定一致):
 *   AI_BASE_URL  — API 端点 base url (如 https://api.minimaxi.com/anthropic)
 *   AI_API_KEY   — API key (明文存储, 由用户自主决定是否使用)
 *   AI_MODEL     — 模型名 (如 MiniMax-M3)
 *
 * 文件可被用户手动 vim/code 编辑, 也可被前端通过 IPC 写入。
 * 前端写入会覆盖整个文件, 不保留注释 — 首次配置后建议用户手动维护。
 *
 * 与现有环境变量 fallback (ANTHROPIC_*) 解耦:
 *   .env 文件字段 → ANTHROPIC_* env 变量 → 默认值 (优先级降序)
 */

const ENV_KEYS = {
  baseUrl: 'AI_BASE_URL',
  apiKey: 'AI_API_KEY',
  model: 'AI_MODEL',
} as const

const LEGACY_SQLITE_KEY = 'ai_advisor_config'

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'ai-config.env')
}

export interface AiConfigFile {
  baseUrl?: string
  apiKey?: string
  model?: string
}

/** 读取 ai-config.env 文件并解析。文件不存在返回空对象。 */
function readEnvFile(): AiConfigFile {
  const file = getConfigPath()
  try {
    if (!fs.existsSync(file)) return {}
    const content = fs.readFileSync(file, 'utf-8')
    const result: AiConfigFile = {}
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      // 支持 "value" / 'value' / value 三种格式
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key === ENV_KEYS.baseUrl) result.baseUrl = value
      else if (key === ENV_KEYS.apiKey) result.apiKey = value
      else if (key === ENV_KEYS.model) result.model = value
    }
    return result
  } catch (error) {
    log.error('[ai-config] readEnvFile error:', error)
    return {}
  }
}

/** 序列化为 .env 文本格式 (覆盖写入)。 */
function serializeEnv(cfg: AiConfigFile): string {
  const lines: string[] = [
    '# 盲训 AI 助手配置 — 本地明文存储',
    '# 由前端 IPC 写入或用户手动编辑; 文件存在 app.getPath("userData")',
    '# 字段: AI_BASE_URL / AI_API_KEY / AI_MODEL',
    '',
  ]
  if (cfg.baseUrl !== undefined) lines.push(`${ENV_KEYS.baseUrl}=${cfg.baseUrl}`)
  if (cfg.apiKey !== undefined) lines.push(`${ENV_KEYS.apiKey}=${cfg.apiKey}`)
  if (cfg.model !== undefined) lines.push(`${ENV_KEYS.model}=${cfg.model}`)
  lines.push('')
  return lines.join('\n')
}

/** 覆盖写入 env 文件 (会丢失原有注释)。 */
function writeEnvFile(cfg: AiConfigFile): void {
  const file = getConfigPath()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, serializeEnv(cfg), { encoding: 'utf-8', mode: 0o600 })
}

/**
 * 从老 SQLite 配置 (app_preferences.ai_advisor_config) 迁移到 env 文件。
 * 仅在 env 文件不存在且 SQLite 中有数据时执行, 一次性迁移。
 */
export function migrateFromSqlite(): { migrated: boolean; values: AiConfigFile } {
  try {
    const envFile = getConfigPath()
    if (fs.existsSync(envFile)) {
      return { migrated: false, values: readEnvFile() }
    }
    // 延迟加载 db, 避免主进程早期循环依赖
    const { getDb } = require('../db')
    const row = getDb()
      .prepare('SELECT value_json FROM app_preferences WHERE key = ? LIMIT 1')
      .get(LEGACY_SQLITE_KEY) as { value_json?: string } | undefined
    if (!row?.value_json) return { migrated: false, values: {} }
    const parsed = JSON.parse(row.value_json) as AiConfigFile & { endpoint?: string }
    const values: AiConfigFile = {
      baseUrl: parsed.baseUrl || parsed.endpoint,
      apiKey: parsed.apiKey,
      model: parsed.model,
    }
    if (!values.baseUrl && !values.apiKey && !values.model) {
      return { migrated: false, values: {} }
    }
    writeEnvFile(values)
    log.info('[ai-config] migrated from SQLite ai_advisor_config to env file')
    return { migrated: true, values }
  } catch (error) {
    log.error('[ai-config] migrateFromSqlite error:', error)
    return { migrated: false, values: readEnvFile() }
  }
}

export function readConfigFromFile(): AiConfigFile {
  return readEnvFile()
}

export function writeConfigToFile(cfg: AiConfigFile): void {
  writeEnvFile(cfg)
}

export function maskApiKey(key: string | undefined): string {
  if (!key) return ''
  return key.length <= 4 ? '****' : `****${key.slice(-4)}`
}
