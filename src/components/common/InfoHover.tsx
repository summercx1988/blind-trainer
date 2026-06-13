import { useId, useMemo, useState } from 'react'
import './InfoHover.css'

interface InfoHoverProps {
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  label?: string
}

const InfoHover = ({ content, position = 'top', label = '查看说明' }: InfoHoverProps) => {
  const [show, setShow] = useState(false)
  const tooltipId = useId()
  const lines = useMemo(() => content.split('\n'), [content])

  const hideTip = () => setShow(false)

  return (
    <span
      className={`info-hover info-hover--${position}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={hideTip}
    >
      <button
        type="button"
        className="info-hover-trigger"
        aria-label={label}
        aria-describedby={show ? tooltipId : undefined}
        aria-expanded={show}
        onFocus={() => setShow(true)}
        onBlur={hideTip}
        onClick={() => setShow(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            hideTip()
          }
        }}
      >
        <span className="info-hover-icon" aria-hidden="true">ⓘ</span>
      </button>
      {show && (
        <span id={tooltipId} role="tooltip" className={`info-hover-tip info-hover-tip--${position}`}>
          {lines.map((line, i) => (
            <span key={i}>
              {line}
              {i < lines.length - 1 && <br />}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

export default InfoHover
