import type { ManualActionType } from '../blind/types'

export type BuyRatio = 0.25 | 0.5 | 0.75 | 1

const BUY_RATIOS: { value: BuyRatio; label: string }[] = [
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1, label: '全仓' },
]

interface ActionSectionProps {
  actionPending: boolean
  accountShares: number
  actionError: string
  availableCash: number
  currentPrice: number
  selectedRatio: BuyRatio
  onSelectRatio: (ratio: BuyRatio) => void
  onActionClick: (actionType: ManualActionType) => void
  onNextBar: () => void
  onSwitchSample: () => void
}

const LOT_SIZE = 100
const COMMISSION_RATE = 0.0003
const MIN_COMMISSION = 5

const previewShares = (cash: number, price: number, ratio: BuyRatio): number => {
  if (cash <= 0 || price <= 0) return 0
  const budget = Math.min(cash * ratio, cash)
  if (budget <= MIN_COMMISSION) return 0
  const affordable = (budget - MIN_COMMISSION) / (price * (1 + COMMISSION_RATE))
  return Math.floor(affordable / LOT_SIZE) * LOT_SIZE
}

const ActionSection = ({
  actionPending,
  accountShares,
  actionError,
  availableCash,
  currentPrice,
  selectedRatio,
  onSelectRatio,
  onActionClick,
  onNextBar,
  onSwitchSample
}: ActionSectionProps) => {
  const shares = previewShares(availableCash, currentPrice, selectedRatio)
  return (
    <div className="wt-action-section">
      <div className="wt-shares-presets" role="group" aria-label="买入份额">
        {BUY_RATIOS.map((r) => (
          <button
            key={r.value}
            className={`wt-preset-btn ${selectedRatio === r.value ? 'wt-preset-btn-active' : ''}`}
            onClick={() => onSelectRatio(r.value)}
            disabled={actionPending}
            aria-pressed={selectedRatio === r.value}
          >
            {r.label}
          </button>
        ))}
        <span className="wt-shares-preview" aria-live="polite">
          {shares > 0 ? `买入 ${shares} 股` : '资金不足'}
        </span>
      </div>
      <div className="wt-action-btns">
        <button className="wt-btn wt-btn-buy" onClick={() => onActionClick('buy')} disabled={actionPending || shares <= 0} aria-label="买入（快捷键B）">
          买入 <kbd>B</kbd>
        </button>
        <button className="wt-btn wt-btn-sell" onClick={() => onActionClick('sell')} disabled={actionPending || accountShares <= 0} aria-label="卖出（快捷键S）">
          卖出 <kbd>S</kbd>
        </button>
        <button className="wt-btn wt-btn-hold" onClick={() => onActionClick('hold')} disabled={actionPending} aria-label="持有（快捷键H）">
          持有 <kbd>H</kbd>
        </button>
        <button className="wt-btn wt-btn-next-bar" onClick={onNextBar} disabled={actionPending} aria-label="推进下一根K线（快捷键右箭头）">
          下一根 <kbd>→</kbd>
        </button>
        <button className="wt-btn wt-btn-skip" onClick={onSwitchSample} disabled={actionPending} aria-label="换一只样本（快捷键N）">
          换一只 <kbd>N</kbd>
        </button>
      </div>
      {actionError && <div className="wt-action-error" role="alert">{actionError}</div>}
    </div>
  )
}

export default ActionSection
