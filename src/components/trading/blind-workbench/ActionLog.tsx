import type { LocalActionLog } from '../blind/types'
import { actionLabel, toMoney, toSignedMoney, toSignedPct } from './formatters'

interface ActionLogProps {
  actions: LocalActionLog[]
}

const ActionLog = ({ actions }: ActionLogProps) => {
  return (
    <div className="wt-log-section">
      <h4>动作日志</h4>
      <div className="wt-log-table">
        <div className="wt-log-header">
          <span>Bar</span><span>动作</span><span>价格</span><span>股数</span><span>成交额</span><span>盈亏</span><span>盈亏%</span>
        </div>
        <div className="wt-log-body">
          {actions.length === 0 ? (
            <div className="wt-log-row empty"><span>-</span><span>-</span><span>-</span><span>-</span><span>-</span><span>-</span><span>-</span></div>
          ) : actions.slice().reverse().map((row) => {
            const pnlPct = row.actionType === 'sell' && row.amount > 0
              ? (row.realizedPnl / row.amount) * 100
              : null
            return (
              <div className="wt-log-row" key={row.id}>
                <span>{row.barIndex}</span>
                <span className={`wt-action-tag ${row.actionType}`}>{actionLabel(row.actionType)}</span>
                <span>{row.price.toFixed(2)}</span>
                <span>{row.shares}</span>
                <span>{toMoney(row.amount)}</span>
                <span className={row.realizedPnl >= 0 ? 'up' : 'down'}>{toSignedMoney(row.realizedPnl)}</span>
                <span className={pnlPct !== null ? (pnlPct >= 0 ? 'up' : 'down') : ''}>
                  {pnlPct !== null ? toSignedPct(pnlPct) : '-'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ActionLog
