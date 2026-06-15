import KlineChart from '../blind/KlineChart'
import type { BaseMarker } from '../blind/BaseKlineChart'
import type { ActionType } from '../blind/types'
import type { KlineBar, TradingState } from '../blind/types'
import { toMoney, toSignedMoney, toSignedPct } from './formatters'

interface TradeMarker {
  barIndex: number
  actionType: Extract<ActionType, 'buy' | 'sell'>
  price: number
}

interface AccountOverviewProps {
  account: TradingState
  accountEquity: number
  totalPnlPct: number
  unrealizedPnl: number
  currentBar: KlineBar
  visibleBars: KlineBar[]
  tradeMarkers: TradeMarker[]
  benchmarkMarkers?: BaseMarker[]
  visibleCount: number
  onVisibleCountChange: (value: number) => void
}

const AccountOverview = ({
  account,
  accountEquity,
  totalPnlPct,
  unrealizedPnl,
  currentBar,
  visibleBars,
  tradeMarkers,
  benchmarkMarkers,
  visibleCount,
  onVisibleCountChange
}: AccountOverviewProps) => {
  const prevBar = visibleBars.length >= 2 ? visibleBars[visibleBars.length - 2] : null
  const changePct = prevBar && prevBar.close > 0
    ? ((currentBar.close - prevBar.close) / prevBar.close) * 100
    : null

  return (
    <>
      <div className="wt-account-row">
        <div className="wt-acct-card wt-acct-main">
          <div className="wt-acct-title">净值</div>
          <div className="wt-acct-value">{toMoney(accountEquity)}</div>
          <div className="wt-acct-sub">收益率 {toSignedPct(totalPnlPct)}</div>
        </div>
        <div className="wt-acct-card">
          <div className="wt-acct-title">可用资金</div>
          <div className="wt-acct-value">{toMoney(account.cash)}</div>
        </div>
        <div className="wt-acct-card">
          <div className="wt-acct-title">持仓</div>
          <div className="wt-acct-value">{account.shares}</div>
          <div className="wt-acct-sub">成本 {account.shares > 0 ? toMoney(account.avgPrice) : '-'}</div>
        </div>
        <div className="wt-acct-card">
          <div className="wt-acct-title">浮动盈亏</div>
          <div className={`wt-acct-value ${unrealizedPnl >= 0 ? 'up' : 'down'}`}>{toSignedMoney(unrealizedPnl)}</div>
        </div>
        <div className="wt-acct-card">
          <div className="wt-acct-title">已实现盈亏</div>
          <div className={`wt-acct-value ${account.realizedPnl >= 0 ? 'up' : 'down'}`}>{toSignedMoney(account.realizedPnl)}</div>
        </div>
      </div>

      <div className="wt-chart-section">
        <div className="wt-chart-bar-header">
          <span className="wt-cbh-item">
            <span className="wt-cbh-label">振幅</span>
            <span className={`wt-cbh-value ${(currentBar.close - currentBar.open) >= 0 ? 'up' : 'down'}`}>
              {toSignedPct(((currentBar.close - currentBar.open) / Math.max(currentBar.open, 0.01)) * 100)}
            </span>
          </span>
          <span className="wt-cbh-item">
            <span className="wt-cbh-label">涨跌幅</span>
            <span className={`wt-cbh-value ${changePct !== null ? (changePct >= 0 ? 'up' : 'down') : ''}`}>
              {changePct !== null ? toSignedPct(changePct) : '-'}
            </span>
          </span>
        </div>
        <div className="wt-chart-container">
          <KlineChart data={visibleBars} tradeMarkers={tradeMarkers} benchmarkMarkers={benchmarkMarkers} />
        </div>
        <div className="wt-chart-info">
          <div className="wt-info-item">
            <span className="wt-info-label">收盘价</span>
            <span className="wt-info-value price">{currentBar.close.toFixed(2)}</span>
          </div>
          <div className="wt-info-item">
            <span className="wt-info-label">高/低</span>
            <span className="wt-info-value">{currentBar.high.toFixed(2)} / {currentBar.low.toFixed(2)}</span>
          </div>
          <div className="wt-info-item wt-visible-count-item">
            <span className="wt-info-label">K线数量</span>
            <div className="wt-visible-count-ctrl">
              <input
                type="range"
                className="wt-vc-slider"
                min={20}
                max={200}
                step={1}
                value={visibleCount}
                onChange={(e) => onVisibleCountChange(Number(e.target.value))}
                aria-label="K线可见数量"
              />
              <span className="wt-vc-val">{visibleCount}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default AccountOverview
