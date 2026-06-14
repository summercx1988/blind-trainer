import type { ManualActionType } from '../blind/types'

interface ActionSectionProps {
  actionPending: boolean
  accountShares: number
  actionError: string
  onActionClick: (actionType: ManualActionType) => void
  onNextBar: () => void
  onSwitchSample: () => void
}

const ActionSection = ({
  actionPending,
  accountShares,
  actionError,
  onActionClick,
  onNextBar,
  onSwitchSample
}: ActionSectionProps) => {
  return (
    <div className="wt-action-section">
      <div className="wt-action-btns">
        <button className="wt-btn wt-btn-buy" onClick={() => onActionClick('buy')} disabled={actionPending || accountShares > 0} aria-label="买入（快捷键B）">
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
