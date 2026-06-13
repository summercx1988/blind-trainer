import type { ReactNode } from 'react'
import './WorkflowHeader.css'

export interface WorkflowStat {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'accent' | 'positive'
}

export interface WorkflowStep {
  id: string
  label: string
  desc: string
  state?: 'idle' | 'active' | 'done'
}

interface WorkflowHeaderProps {
  eyebrow: string
  title: string
  description: string
  stats?: WorkflowStat[]
  steps?: WorkflowStep[]
  actions?: ReactNode
}

const WorkflowHeader = ({
  eyebrow,
  title,
  description,
  stats = [],
  steps = [],
  actions
}: WorkflowHeaderProps) => {
  return (
    <section className="workflow-header">
      <div className="workflow-header-main">
        <div className="workflow-copy">
          <span className="workflow-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions && <div className="workflow-actions">{actions}</div>}
      </div>

      {stats.length > 0 && (
        <div className="workflow-stats" aria-label="关键指标">
          {stats.map((stat) => (
            <div key={stat.label} className={`workflow-stat workflow-stat--${stat.tone || 'neutral'}`}>
              <span className="workflow-stat-label">{stat.label}</span>
              <strong className="workflow-stat-value">{stat.value}</strong>
              {stat.hint && <span className="workflow-stat-hint">{stat.hint}</span>}
            </div>
          ))}
        </div>
      )}

      {steps.length > 0 && (
        <div className="workflow-steps" aria-label="流程阶段">
          {steps.map((step, index) => (
            <div key={step.id} className={`workflow-step workflow-step--${step.state || 'idle'}`}>
              <div className="workflow-step-index">{index + 1}</div>
              <div className="workflow-step-body">
                <strong>{step.label}</strong>
                <span>{step.desc}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default WorkflowHeader
