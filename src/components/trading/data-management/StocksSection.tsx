import type { StockRecord } from './types'

interface StocksSectionProps {
  stocks: StockRecord[]
  stocksLoading: boolean
  onRefresh: () => void
}

const StocksSection = ({ stocks, stocksLoading, onRefresh }: StocksSectionProps) => {
  return (
    <div className="dm-stocks-section">
      <div className="dm-stocks-header">
        <h3>已入库股票（最近 {stocks.length} 只）</h3>
        <button
          className="dm-refresh-btn"
          onClick={onRefresh}
          disabled={stocksLoading}
        >
          {stocksLoading ? '加载中...' : '刷新'}
        </button>
      </div>

      {stocks.length === 0 ? (
        <div className="dm-empty">
          <p>暂无数据。请先在“数据同步”中初始化数据库。</p>
        </div>
      ) : (
        <div className="dm-stocks-table">
          <div className="dm-table-header">
            <span>代码</span>
            <span>名称</span>
            <span>日线</span>
            <span>分钟线</span>
            <span>最后同步</span>
          </div>
          <div className="dm-table-body">
            {stocks.map((stock) => (
              <div className="dm-table-row" key={stock.code}>
                <span className="dm-stock-code">{stock.code}</span>
                <span className="dm-stock-name">{stock.name}</span>
                <span className="dm-stock-count">{stock.daily_count.toLocaleString()}</span>
                <span className="dm-stock-count">{stock.minute_count.toLocaleString()}</span>
                <span className="dm-stock-date">{stock.last_sync || '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default StocksSection
