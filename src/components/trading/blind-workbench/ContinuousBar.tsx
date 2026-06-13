import type { ContinuousStats } from '../blind/types'
import { toSignedMoney } from './formatters'

interface ContinuousBarProps {
  continuousMode: boolean
  stats: ContinuousStats
}

const ContinuousBar = ({ continuousMode, stats }: ContinuousBarProps) => {
  if (!continuousMode || stats.sessionsCompleted <= 0) return null

  return (
    <div className="wt-continuous-bar">
      <div className="wt-cs-item">
        <span className="wt-cs-label">连续轮次</span>
        <span className="wt-cs-val">{stats.sessionsCompleted}</span>
      </div>
      <div className="wt-cs-item">
        <span className="wt-cs-label">累计收益</span>
        <span className={`wt-cs-val ${stats.totalPnl >= 0 ? 'up' : 'down'}`}>
          {toSignedMoney(stats.totalPnl)}
        </span>
      </div>
      <div className="wt-cs-item">
        <span className="wt-cs-label">胜/负</span>
        <span className="wt-cs-val">
          <span className="up">{stats.wins}</span> / <span className="down">{stats.losses}</span>
        </span>
      </div>
      <div className="wt-cs-item">
        <span className="wt-cs-label">胜率</span>
        <span className="wt-cs-val">
          {stats.sessionsCompleted > 0
            ? `${((stats.wins / stats.sessionsCompleted) * 100).toFixed(1)}%`
            : '-'}
        </span>
      </div>
      <div className="wt-cs-item">
        <span className="wt-cs-label">连胜</span>
        <span className="wt-cs-val up">
          {stats.currentStreak > 0 && stats.streakType === 'win'
            ? `${stats.currentStreak}连胜`
            : stats.bestStreak > 0 ? `最长${stats.bestStreak}` : '-'}
        </span>
      </div>
    </div>
  )
}

export default ContinuousBar
