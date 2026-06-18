import type {
  HabitProfile,
  RepresentativeSession,
  AdvisorReport,
  SessionRow,
  TradeActionRow,
} from '../../types/agent'

const SYSTEM_PROMPT = `你是一位资深 A 股交易教练，专门帮助散户改进交易习惯。
你将收到用户的盲训统计数据（基于真实历史 K 线的模拟盘训练，盲训中股价与板块信息被遮蔽）。
你的任务是基于这些指标与代表性交易记录，识别用户的交易优缺点与不良习惯，
给出具体可执行的改善建议。

请严格输出 JSON，结构如下：
{
  "strengths": [
    {"indicator": "盈亏比", "value": "1.8", "evidence": "优于 1.5 的健康线", "comment": "..."}
  ],
  "weaknesses": [
    {"indicator": "追涨率", "value": "42%", "evidence": "高于 30% 健康线", "comment": "..."}
  ],
  "bad_habits": [
    {
      "name": "突破即追入",
      "severity": "high | medium | low",
      "trigger": "看到突破信号立即追入，未等回踩",
      "evidence_session": "引用代表性 session 的股票名（如有）",
      "fix": "等回踩 ±2% 或量能确认后再入"
    }
  ],
  "action_plan": [
    {"priority": 1, "action": "...", "rationale": "...", "expected_impact": "..."}
  ]
}
不要输出 JSON 以外的内容。不要编造未在输入中给出的具体数字。`

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export function buildMessages(profile: HabitProfile, sessions: RepresentativeSession[]): ChatMessage[] {
  const payload = {
    profile,
    representative_sessions: sessions,
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload, null, 2) },
  ]
}

export function parseReportResponse(content: string): { report: AdvisorReport | { fallback_text: string }; error: string | null } {
  // 1. 直接解析
  try {
    const parsed = JSON.parse(content)
    if (isValidReport(parsed)) return { report: parsed, error: null }
  } catch {
    // 落到下一步
  }
  // 2. 提取 markdown 代码块内的 JSON
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1])
      if (isValidReport(parsed)) return { report: parsed, error: null }
    } catch {
      // 落到下一步
    }
  }
  // 3. 兜底：提取第一个 {...} 块
  const braceMatch = content.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0])
      if (isValidReport(parsed)) return { report: parsed, error: null }
    } catch {
      // 落到 fallback
    }
  }
  // 4. 降级
  return { report: { fallback_text: content }, error: 'json_parse_failed' }
}

function isValidReport(obj: unknown): obj is AdvisorReport {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return Array.isArray(o.strengths) && Array.isArray(o.weaknesses)
    && Array.isArray(o.bad_habits) && Array.isArray(o.action_plan)
}

export function selectRepresentativeSessions(
  sessions: Array<Pick<SessionRow, 'id' | 'stock_code' | 'stock_name' | 'interval_type' | 'realized_pnl' | 'status'>>,
  actions: TradeActionRow[],
  reviews: Array<{ session_id: string; realized_pnl_pct: number; total_trades: number; trade_win_rate: number }>
): RepresentativeSession[] {
  const finished = sessions.filter(s => s.status === 'finished')
  if (finished.length === 0) return []
  const reviewMap = new Map(reviews.map(r => [r.session_id, r]))
  const actionMap = new Map<string, TradeActionRow[]>()
  for (const a of actions) {
    const list = actionMap.get(a.session_id) ?? []
    list.push(a)
    actionMap.set(a.session_id, list)
  }

  const toRep = (s: typeof finished[number]): RepresentativeSession => {
    const rv = reviewMap.get(s.id)
    const sessActions = (actionMap.get(s.id) ?? [])
      .sort((a, b) => a.bar_index - b.bar_index)
      .map(a => ({
        bar_index: a.bar_index,
        action_type: a.action_type,
        price: a.price ?? undefined,
        shares: a.shares ?? undefined,
        realized_pnl: a.realized_pnl ?? undefined,
      }))
    return {
      stock_code: s.stock_code,
      stock_name: s.stock_name,
      interval_type: s.interval_type,
      realized_pnl_pct: rv?.realized_pnl_pct ?? 0,
      total_trades: rv?.total_trades ?? 0,
      trade_win_rate: rv?.trade_win_rate ?? 0,
      actions: sessActions,
    }
  }

  // 1 盈最多 + 2 亏最多（按 realized_pnl_pct）
  const withPnl = finished.map(s => ({ s, pct: reviewMap.get(s.id)?.realized_pnl_pct ?? 0 }))
  const topWin = [...withPnl].filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct)[0]
  const topLosses = [...withPnl]
    .filter(x => x.pct < 0 && (!topWin || x.s.id !== topWin.s.id))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 2)

  const picked = [topWin, ...topLosses].filter(Boolean) as Array<{ s: typeof finished[number] }>
  return picked.map(x => toRep(x.s))
}
