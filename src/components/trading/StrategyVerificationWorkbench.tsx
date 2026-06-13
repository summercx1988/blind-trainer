import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import BacktestPage from './BacktestPage'
import BenchmarkPanel from './model/BenchmarkPanel'
import LabelQualityAuditPanel from './model/LabelQualityAuditPanel'
import WalkForwardPanel from './model/WalkForwardPanel'
import WorkflowHeader from './workflow/WorkflowHeader'
import type { WorkflowStep } from './workflow/WorkflowHeader'
import './ModelTrainingWorkbench.css'
import '../../types/global.d.ts'

type TabId = 'backtest' | 'benchmark' | 'walkforward'

interface TabDef {
  id: TabId
  label: string
  desc: string
  stage: 'backtest' | 'benchmark' | 'walkforward'
}

const TAB_GROUPS: TabDef[] = [
  { id: 'backtest', label: '单模型回测', desc: '复用回测面板，评估收益、回撤与阈值敏感性。', stage: 'backtest' },
  { id: 'benchmark', label: 'Benchmark 排名', desc: '经典策略与模型同口径对比，输出风险收益排名。', stage: 'benchmark' },
  { id: 'walkforward', label: 'Walk-Forward / 标签审计', desc: '滚动窗口稳定性验证与标签可学习性审计。', stage: 'walkforward' },
]

const StrategyVerificationWorkbench = () => {
  const [activeTab, setActiveTab] = useState<TabId>('backtest')
  const activeDefinition = useMemo(
    () => TAB_GROUPS.find((tab) => tab.id === activeTab) ?? TAB_GROUPS[0],
    [activeTab]
  )

  const workflowStats = useMemo(() => ([
    {
      label: '验证域',
      value: activeDefinition.label,
      hint: activeDefinition.desc,
      tone: 'accent' as const
    },
    {
      label: '回测入口',
      value: '已迁移',
      hint: '模型部署中的回测已统一迁移至策略验证工作台',
      tone: 'positive' as const
    },
    {
      label: '当前阶段',
      value: '可用',
      hint: '回测、Benchmark、Walk-Forward 均已可用',
      tone: 'accent' as const
    }
  ]), [activeDefinition])

  const workflowSteps = useMemo<WorkflowStep[]>(() => {
    const stage = activeDefinition.stage
    return [
      {
        id: 'backtest',
        label: '单模型回测',
        desc: '先看可成交口径的收益和回撤。',
        state: stage === 'backtest' ? 'active' : 'done'
      },
      {
        id: 'benchmark',
        label: 'Benchmark 排名',
        desc: '同口径比较模型与经典策略。',
        state: stage === 'benchmark' ? 'active' : 'idle'
      },
      {
        id: 'walkforward',
        label: 'Walk-Forward',
        desc: '滚动检验策略稳定性。',
        state: stage === 'walkforward' ? 'active' : 'idle'
      }
    ]
  }, [activeDefinition.stage])

  const renderers: Record<TabId, () => ReactNode> = {
    backtest: () => <BacktestPage />,
    benchmark: () => <BenchmarkPanel />,
    walkforward: () => (
      <>
        <LabelQualityAuditPanel />
        <WalkForwardPanel />
      </>
    )
  }

  return (
    <div className="model-page">
      <WorkflowHeader
        eyebrow="Strategy Verification"
        title="策略验证工作台"
        description="将回测、Benchmark 与 Walk-Forward 放在同一验证域，先证明策略有效，再进入部署链路。"
        stats={workflowStats}
        steps={workflowSteps}
        actions={(
          <button className="model-header-btn" onClick={() => setActiveTab('backtest')}>回到单模型回测</button>
        )}
      />

      <section className="model-stage-card">
        <div className="model-stage-copy">
          <span className="model-stage-kicker">验证流程</span>
          <h3>{activeDefinition.label}</h3>
          <p>{activeDefinition.desc}</p>
        </div>
        <div className="model-stage-next">
          <span className="model-stage-next-label">切换阶段</span>
          <div className="model-stage-chip-row">
            {TAB_GROUPS.map((tab) => (
              <button
                key={tab.id}
                className={`model-stage-chip ${activeTab === tab.id ? 'model-stage-chip--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <nav className="model-tabs">
        {TAB_GROUPS.map((tab) => (
          <button
            key={tab.id}
            className={`model-tab ${activeTab === tab.id ? 'model-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.desc}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="model-tab-content">{renderers[activeTab]()}</div>
    </div>
  )
}

export default StrategyVerificationWorkbench
