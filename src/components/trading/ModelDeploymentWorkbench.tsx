import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import RegistryTab from './model/RegistryTab'
import PredictTab from './model/PredictTab'
import SignalTab from './model/SignalTab'
import RetrainingTab from './model/RetrainingTab'
import RecommendationReviewTab from './model/RecommendationReviewTab'
import WorkflowHeader from './workflow/WorkflowHeader'
import type { WorkflowStep } from './workflow/WorkflowHeader'
import './ModelTrainingWorkbench.css'
import '../../types/global.d.ts'

type TabId = 'registry' | 'predict' | 'recommendation' | 'signal' | 'retraining'

interface TabDef {
  id: TabId
  label: string
  desc: string
  stage: 'registry' | 'predict' | 'recommendation' | 'feedback' | 'retraining'
}

const TAB_GROUPS: TabDef[] = [
  { id: 'registry', label: '模型仓库', desc: '同步产物、管理版本、选择活跃模型。', stage: 'registry' },
  { id: 'predict', label: '准实时预测', desc: '使用活跃模型或指定模型进行单标的/批量预测。', stage: 'predict' },
  { id: 'recommendation', label: '推荐复盘', desc: '查看近半年买入推荐与 T+N 真实胜率。', stage: 'recommendation' },
  { id: 'signal', label: '提醒反馈', desc: '查看模型提醒事件，并把采纳/修正反馈回流。', stage: 'feedback' },
  { id: 'retraining', label: '再训练', desc: '基于反馈样本触发全量或增量再训练。', stage: 'retraining' },
]

const ModelDeploymentWorkbench = () => {
  const [activeTab, setActiveTab] = useState<TabId>('registry')
  const activeDefinition = useMemo(
    () => TAB_GROUPS.find((tab) => tab.id === activeTab) ?? TAB_GROUPS[0],
    [activeTab]
  )

  const workflowStats = useMemo(() => ([
    {
      label: '部署入口',
      value: activeDefinition.label,
      hint: activeDefinition.desc,
      tone: 'accent' as const
    },
    {
      label: '运行模型',
      value: '仓库管理',
      hint: '活跃模型会被预测、提醒、盲训和 AI 助手复用',
      tone: 'neutral' as const
    },
    {
      label: '反馈闭环',
      value: '可回流',
      hint: '采纳/修正会进入后续候选与再训练链路',
      tone: 'positive' as const
    },
    {
      label: '再训练',
      value: '独立运营',
      hint: '与日常模型使用放在同一部署工作台',
      tone: 'neutral' as const
    },
    {
      label: '回测迁移',
      value: '策略验证',
      hint: '回测复盘已迁移到“策略验证”模块统一管理',
      tone: 'positive' as const
    }
  ]), [activeDefinition])

  const workflowSteps = useMemo<WorkflowStep[]>(() => {
    const currentStage = activeDefinition.stage
    return [
      {
        id: 'registry',
        label: '选择模型',
        desc: '管理模型版本并设置活跃模型。',
        state: currentStage === 'registry' ? 'active' : 'idle'
      },
      {
        id: 'predict',
        label: '运行预测',
        desc: '验证模型在最新行情上的输出。',
        state: currentStage === 'predict' ? 'active' : 'idle'
      },
      {
        id: 'recommendation',
        label: '推荐复盘',
        desc: '评估近半年推荐的历史质量。',
        state: currentStage === 'recommendation' ? 'active' : 'idle'
      },
      {
        id: 'feedback',
        label: '收集反馈',
        desc: '记录提醒是否可用，并沉淀回流样本。',
        state: currentStage === 'feedback' ? 'active' : 'idle'
      },
      {
        id: 'retraining',
        label: '再训练',
        desc: '把反馈样本变成下一轮训练输入。',
        state: currentStage === 'retraining' ? 'active' : 'idle'
      }
    ]
  }, [activeDefinition.stage])

  const renderers: Record<TabId, () => ReactNode> = {
    registry: () => <RegistryTab />,
    predict: () => <PredictTab />,
    recommendation: () => <RecommendationReviewTab />,
    signal: () => <SignalTab />,
    retraining: () => <RetrainingTab />
  }

  const activeContent = renderers[activeTab]()

  return (
    <div className="model-page">
      <WorkflowHeader
        eyebrow="Model Deployment"
        title="模型部署、预测与反馈闭环"
        description="这里负责把训练好的模型投入使用：管理活跃模型、运行准实时预测、查看提醒反馈，并把有效反馈回流到再训练链路。"
        stats={workflowStats}
        steps={workflowSteps}
        actions={(
          <button className="model-header-btn" onClick={() => setActiveTab('registry')}>回到模型仓库</button>
        )}
      />

      <section className="model-stage-card">
        <div className="model-stage-copy">
          <span className="model-stage-kicker">部署流程</span>
          <h3>{activeDefinition.label}</h3>
          <p>{activeDefinition.desc}</p>
          <p style={{ marginTop: 8, color: '#47658d' }}>
            回测复盘入口已迁移到「策略验证」工作台，部署页专注模型上线与反馈闭环。
          </p>
        </div>
        <div className="model-stage-next">
          <span className="model-stage-next-label">推荐切换</span>
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

      <div className="model-tab-content">{activeContent}</div>
    </div>
  )
}

export default ModelDeploymentWorkbench
