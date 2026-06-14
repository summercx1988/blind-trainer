interface IconProps {
  className?: string
  size?: number
}

const baseProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true
})

export const UserIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

export const ChartBarIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M3 3v18h18" />
    <rect x="7" y="13" width="3" height="5" />
    <rect x="12" y="9" width="3" height="9" />
    <rect x="17" y="5" width="3" height="13" />
  </svg>
)

export const GearIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export const CheckIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const CloseIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const CalendarIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
)

export const TrendUpIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M23 6l-9.5 9.5-5-5L1 18" />
    <path d="M17 6h6v6" />
  </svg>
)

export const WalletIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
  </svg>
)

export const TargetIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
)

export const ClockIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
)
