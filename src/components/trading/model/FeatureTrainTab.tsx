import { useState } from 'react'
import FeatureTab from './FeatureTab'
import TrainTab from './TrainTab'
import FeatureAuditTab from './FeatureAuditTab'
import type { DatasetItem } from './types'

type SubView = 'features' | 'audit' | 'train'

interface FeatureTrainTabProps {
  datasets: DatasetItem[]
}

const FeatureTrainTab = ({ datasets }: FeatureTrainTabProps) => {
  const [subView, setSubView] = useState<SubView>('features')

  const subTabs: { id: SubView; label: string; desc: string }[] = [
    { id: 'features', label: '特征构建', desc: '按规格构建训练特征' },
    { id: 'audit', label: '样本审计', desc: '审计样本切分、时间边界与缺失风险' },
    { id: 'train', label: '训练评估', desc: '启动训练、对比模型、查看评估' },
  ]

  return (
    <>
      <div className="model-sub-tab-bar">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            className={`model-sub-tab ${subView === tab.id ? 'model-sub-tab--active' : ''}`}
            onClick={() => setSubView(tab.id)}
            title={tab.desc}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subView === 'features' && <FeatureTab datasets={datasets} />}
      {subView === 'audit' && <FeatureAuditTab />}
      {subView === 'train' && <TrainTab datasets={datasets} />}
    </>
  )
}

export default FeatureTrainTab
