import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { UnknownRecord } from '../../types/ipc'
import type { DatasetItem } from './model/types'
import { toDatasetItem } from './model/types'
import LabelingDatasetTab from './model/LabelingDatasetTab'
import FeatureTrainTab from './model/FeatureTrainTab'
import EnsembleTab from './model/EnsembleTab'
import WorkflowHeader from './workflow/WorkflowHeader'
import type { WorkflowStep } from './workflow/WorkflowHeader'
import './ModelTrainingWorkbench.css'
import '../../types/global.d.ts'

type TabId = 'labeling' | 'features' | 'ensemble'

interface TabDef {
  id: TabId
  label: string
  desc: string
  stage: 'labeling' | 'feature' | 'train'
}

const TAB_GROUPS: TabDef[] = [
  { id: 'labeling', label: '标签与数据集', desc: '策略打标（全市场批量）→ 抽样K线审核 → 冻结数据集', stage: 'labeling' },
  { id: 'features', label: '特征与训练', desc: '按特征规格构建 → 选择引擎训练 → 评估对比模型', stage: 'feature' },
  { id: 'ensemble', label: '集成实验', desc: '对已训练模型做加权集成实验', stage: 'train' },
]

const ModelTrainingWorkbench = () => {
  const [activeTab, setActiveTab] = useState<TabId>('labeling')
  const [datasets, setDatasets] = useState<DatasetItem[]>([])

  const loadDatasets = useCallback(async () => {
    try {
      const rows = await window.electronAPI?.listDatasets?.()
      const parsed = (rows || []).map((row) => toDatasetItem(row as UnknownRecord)).filter((row): row is DatasetItem => row !== null)
      startTransition(() => {
        setDatasets(parsed)
      })
    } catch (error) {
      console.error('加载数据集列表失败:', error)
    }
  }, [])

  useEffect(() => { void loadDatasets() }, [loadDatasets])

  const handleDatasetsChange = useCallback((newDatasets: DatasetItem[]) => {
    setDatasets(newDatasets)
  }, [])

  const frozenDatasets = useMemo(() => datasets.filter((item) => item.status === 'frozen').length, [datasets])
  const activeDefinition = useMemo(
    () => TAB_GROUPS.find((tab) => tab.id === activeTab) ?? TAB_GROUPS[0],
    [activeTab]
  )

  const workflowStats = useMemo(() => ([
    {
      label: '数据集',
      value: `${datasets.length}`,
      hint: `${frozenDatasets} 个已冻结，可直接训练`,
      tone: 'accent' as const
    },
    {
      label: '冻结数据集',
      value: `${frozenDatasets}`,
      hint: '冻结后才能进入特征构建与训练',
      tone: frozenDatasets > 0 ? 'positive' as const : 'neutral' as const
    },
    {
      label: '当前阶段',
      value: activeDefinition.label,
      hint: activeDefinition.desc,
      tone: 'accent' as const
    }
  ]), [activeDefinition, datasets.length, frozenDatasets])

  const workflowSteps = useMemo<WorkflowStep[]>(() => {
    const currentStage = activeDefinition.stage
    const hasFrozen = frozenDatasets > 0
    return [
      {
        id: 'labeling',
        label: '标签与数据集',
        desc: '策略打标 → 抽样审核 → 冻结',
        state: currentStage === 'labeling' ? 'active' : hasFrozen ? 'done' : 'idle'
      },
      {
        id: 'feature',
        label: '特征构建',
        desc: '按规格构造训练特征。',
        state: currentStage === 'feature' ? 'active' : hasFrozen ? 'done' : 'idle'
      },
      {
        id: 'train',
        label: '训练与评估',
        desc: '启动任务、比较模型、查看评估结果。',
        state: currentStage === 'train' ? 'active' : 'idle'
      }
    ]
  }, [activeDefinition.stage, frozenDatasets])

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab)
    if (tab === 'features' || tab === 'ensemble') {
      void loadDatasets()
    }
  }, [loadDatasets])

  const renderers: Record<TabId, () => ReactNode> = {
    labeling: () => <LabelingDatasetTab onDatasetsChange={handleDatasetsChange} />,
    features: () => <FeatureTrainTab datasets={datasets} />,
    ensemble: () => <EnsembleTab />
  }

  const activeContent = renderers[activeTab]()

  return (
    <div className="model-page">
      <WorkflowHeader
        eyebrow="Model Pipeline"
        title="模型训练"
        description="先定义交易目标并批量打标，抽样审核后冻结数据集，然后构建特征并训练模型。"
        stats={workflowStats}
        steps={workflowSteps}
        actions={(
          <>
            <button className="model-header-btn" onClick={() => handleTabChange('labeling')}>回到标签与数据集</button>
          </>
        )}
      />

      <section className="model-stage-card">
        <div className="model-stage-copy">
          <span className="model-stage-kicker">训练流程</span>
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
                onClick={() => handleTabChange(tab.id)}
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
            onClick={() => handleTabChange(tab.id)}
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

export default ModelTrainingWorkbench
