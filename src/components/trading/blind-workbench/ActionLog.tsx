import type { LocalActionLog } from '../blind/types'
import { actionLabel, toMoney, toSignedMoney, toSignedPct } from './formatters'

interface ActionLogProps {
  actions: LocalActionLog[]
}

const ActionLog = ({ actions }: ActionLogProps) => {
  return (
    <div className="wt-log-section">
      <h4>动作日志 <span className="wt-log-hint">← 横滑查看更多 →</span></h4>
      {actions.length === 0 ? (
        <div className="wt-log-rail">
          <div className="wt-log-card wt-log-card-empty">尚无动作</div>
        </div>
      ) : (
        <div className="wt-log-rail" role="list">
          {actions.map((row) => {
            const pnlPct = row.actionType === 'sell' && row.amount > 0
              ? (row.realizedPnl / row.amount) * 100
              : null
            const pnlClass = row.realizedPnl >= 0 ? 'up' : 'down'
            return (
              <div className="wt-log-card" key={row.id} role="listitem">
                <div className="wt-log-card-top">
                  <span className="wt-log-card-bar">#{row.barIndex}</span>
                  <span className={`wt-action-tag ${row.actionType}`}>{actionLabel(row.actionType)}</span>
                </div>
                <div className="wt-log-card-mid">
                  <span className="wt-log-card-price">¥{row.price.toFixed(2)}</span>
                  <span className="wt-log-card-shares">{row.shares}股</span>
                </div>
                <div className="wt-log-card-bot">
                  <span className={pnlClass}>{toSignedMoney(row.realizedPnl)}</span>
                  <span className={pnlPct !== null ? pnlClass : ''}>
                    {pnlPct !== null ? toSignedPct(pnlPct) : '-'}
                  </span>
                </div>
                <div className="wt-log-card-amt">成交额 {toMoney(row.amount)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ActionLog
