import './Skeleton.css'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string
  className?: string
}

export const Skeleton = ({ width = '100%', height = '20px', borderRadius = '6px', className = '' }: SkeletonProps) => (
  <div
    className={`skeleton-box ${className}`}
    style={{ width, height, borderRadius }}
    aria-hidden
  />
)

export const SkeletonStatCard = () => (
  <div className="skeleton-stat-card" aria-hidden>
    <Skeleton width="60%" height="14px" />
    <Skeleton width="80%" height="24px" className="skeleton-mt" />
  </div>
)

export const SkeletonAccountCard = () => (
  <div className="skeleton-account-card" aria-hidden>
    <Skeleton width="50%" height="16px" />
    <Skeleton width="70%" height="28px" className="skeleton-mt" />
    <div className="skeleton-row">
      <Skeleton width="30%" height="14px" />
      <Skeleton width="30%" height="14px" />
    </div>
  </div>
)
