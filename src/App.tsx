import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react'
import InfoHover from './components/common/InfoHover'
import './App.css'

const BlindTrainingWorkbench = lazy(() => import('./components/trading/BlindTrainingWorkbench'))
const TrainingOverview = lazy(() => import('./components/trading/TrainingOverview'))
const DataManagement = lazy(() => import('./components/trading/DataManagement'))
const ModelTrainingWorkbench = lazy(() => import('./components/trading/ModelTrainingWorkbench'))
const StrategyVerificationWorkbench = lazy(() => import('./components/trading/StrategyVerificationWorkbench'))
const ModelDeploymentWorkbench = lazy(() => import('./components/trading/ModelDeploymentWorkbench'))
const AiChat = lazy(() => import('./components/trading/AiChat'))
const AlphaResearchWorkbench = lazy(() => import('./components/trading/AlphaResearchWorkbench'))

type AppModule = 'overview' | 'blind' | 'model' | 'verify' | 'deploy' | 'data' | 'aichat' | 'alpha'

interface ModuleDefinition {
  id: AppModule
  label: string
  category: string
  summary: string
  outcome: string
  focus: string[]
  group?: string
}

const MODULE_GROUPS = [
  {
    label: '数据基座',
    modules: [
      {
        id: 'data' as AppModule,
        label: '数据管理',
        category: '行情基础',
        summary: '初始化股票池、执行增量同步，检查真实行情覆盖情况。',
        outcome: '为盲训和量化模型提供统一的 K 线数据底座。',
        focus: ['初始化', '增量同步', '覆盖率检查']
      },
    ]
  },
  {
    label: '人的训练',
    modules: [
      {
        id: 'overview' as AppModule,
        label: '训练总览',
        category: '个人仪表盘',
        summary: '账户管理、训练日历、收益统计与盲训记录明细。',
        outcome: '像游戏存档一样管理账户，纵览训练表现与收益趋势。',
        focus: ['账户管理', '训练日历', '收益统计', '记录查询']
      },
      {
        id: 'blind' as AppModule,
        label: '盲训工作台',
        category: '模拟盘训练',
        summary: '基于真实历史 K 线做随机起点模拟盘训练，专注提升盘感与决策纪律。',
        outcome: '在不看未来的前提下，稳定完成买卖决策并沉淀会话复盘。',
        focus: ['真实样本', '动作执行', '会话结束复盘']
      },
    ]
  },
  {
    label: '量化模型',
    modules: [
      {
        id: 'alpha' as AppModule,
        label: 'Alpha 研究',
        category: '因子挖掘',
        summary: '因子库浏览、IC 分析、分箱收益与相关性矩阵，识别有效因子。',
        outcome: '发现可解释、稳定、可交易的因子，诊断共线性风险。',
        focus: ['因子库', 'IC 分析', '分箱收益', '相关性']
      },
      {
        id: 'model' as AppModule,
        label: '模型训练',
        category: '训练与评估',
        summary: '从候选审核、数据集冻结到特征构建和模型训练评估。',
        outcome: '把认可的趋势买卖点样本沉淀成可解释、可迭代的模型。',
        focus: ['候选审核', '数据集冻结', '特征构建', '训练评估']
      },
      {
        id: 'verify' as AppModule,
        label: '策略验证',
        category: '回测与对照',
        summary: '统一承载单模型回测、Benchmark 对照与 Walk-Forward 稳定性验证。',
        outcome: '先验证策略有效性，再推进到模型部署与生产使用。',
        focus: ['单模型回测', 'Benchmark 排名', 'Walk-Forward']
      },
      {
        id: 'deploy' as AppModule,
        label: '模型部署',
        category: '上线与监控',
        summary: '管理模型版本、激活生产模型、运行准实时预测，收集反馈。',
        outcome: '把训练出的模型投入使用，再把真实反馈回流到下一轮训练。',
        focus: ['模型仓库', '准实时预测', '提醒反馈', '再训练']
      },
    ]
  },
  {
    label: '辅助',
    modules: [
      {
        id: 'aichat' as AppModule,
        label: 'AI 助手',
        category: '智能问答',
        summary: '用自然语言探索交易策略、解读模型信号、分析回测指标。',
        outcome: '借助 AI 快速获得策略建议和模型优化方向。',
        focus: ['策略分析', '信号解读', '指标问答']
      },
    ]
  }
]

const MODULES: ModuleDefinition[] = MODULE_GROUPS.flatMap(g => g.modules as ModuleDefinition[])

const WorkspaceFallback = ({ label }: { label: string }) => {
  return (
    <div className="app-loading-state">
      <div className="app-loading-title">正在加载 {label}</div>
      <div className="app-loading-text">按需载入模块资源，优先保证首屏启动速度与主壳层响应。</div>
    </div>
  )
}

const renderModule = (
  activeModule: AppModule,
  onNavigate: (module: AppModule) => void,
  onStartTraining: () => void,
  autoStartBlind: boolean,
  registerBlindNavigationGuard: (guard: (() => Promise<void>) | null) => void
) => {
  if (activeModule === 'overview') {
    return (
      <Suspense fallback={<WorkspaceFallback label="训练总览" />}>
        <TrainingOverview onStartTraining={onStartTraining} />
      </Suspense>
    )
  }
  if (activeModule === 'blind') {
    return (
      <Suspense fallback={<WorkspaceFallback label="盲训工作台" />}>
        <BlindTrainingWorkbench
          onNavigate={(m) => onNavigate(m as AppModule)}
          autoStart={autoStartBlind}
          registerNavigationGuard={registerBlindNavigationGuard}
        />
      </Suspense>
    )
  }
  if (activeModule === 'model') {
    return (
      <Suspense fallback={<WorkspaceFallback label="模型训练" />}>
        <ModelTrainingWorkbench />
      </Suspense>
    )
  }
  if (activeModule === 'verify') {
    return (
      <Suspense fallback={<WorkspaceFallback label="策略验证" />}>
        <StrategyVerificationWorkbench />
      </Suspense>
    )
  }
  if (activeModule === 'deploy') {
    return (
      <Suspense fallback={<WorkspaceFallback label="模型部署" />}>
        <ModelDeploymentWorkbench />
      </Suspense>
    )
  }
  if (activeModule === 'aichat') {
    return (
      <Suspense fallback={<WorkspaceFallback label="AI 助手" />}>
        <AiChat />
      </Suspense>
    )
  }
  if (activeModule === 'alpha') {
    return (
      <Suspense fallback={<WorkspaceFallback label="Alpha 研究" />}>
        <AlphaResearchWorkbench />
      </Suspense>
    )
  }
  return (
    <Suspense fallback={<WorkspaceFallback label="数据管理" />}>
      <DataManagement />
    </Suspense>
  )
}

function App() {
  const [activeModule, setActiveModule] = useState<AppModule>('overview')
  const [autoStartBlind, setAutoStartBlind] = useState(false)
  const blindNavigationGuardRef = useRef<(() => Promise<void>) | null>(null)

  const navigateToModule = useCallback(async (module: AppModule, nextAutoStartBlind = false) => {
    if (activeModule === 'blind' && module !== 'blind') {
      try {
        await blindNavigationGuardRef.current?.()
      } catch (error) {
        console.error('[App] blind navigation guard failed:', error)
      }
    }

    setAutoStartBlind(module === 'blind' ? nextAutoStartBlind : false)
    setActiveModule(module)
  }, [activeModule])

  const handleNavigate = useCallback((module: AppModule) => {
    void navigateToModule(module, false)
  }, [navigateToModule])

  const handleStartTraining = useCallback(() => {
    void navigateToModule('blind', true)
  }, [navigateToModule])

  const activeDefinition = useMemo(
    () => MODULES.find((module) => module.id === activeModule) ?? MODULES[0],
    [activeModule]
  )

  /* eslint-disable react-hooks/refs */
  const page = useMemo(
    () => renderModule(
      activeModule,
      handleNavigate,
      handleStartTraining,
      autoStartBlind,
      (guard: (() => Promise<void>) | null) => { blindNavigationGuardRef.current = guard }
    ),
    [activeModule, handleNavigate, handleStartTraining, autoStartBlind]
  )
  /* eslint-enable react-hooks/refs */

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand-badge">Stock Trainer</span>
          <h1 onClick={() => { void navigateToModule('overview', false) }}>人机协同交易系统</h1>
        </div>

        <nav className="app-nav" aria-label="主导航">
          {MODULE_GROUPS.map((group, gi) => (
            <div key={group.label} className="app-nav-group">
              {gi > 0 && <div className="app-nav-divider" />}
              <div className="app-nav-group-header">{group.label}</div>
              {group.modules.map((module) => (
                <button
                  key={module.id}
                  className={`app-nav-item ${activeModule === module.id ? 'app-nav-item--active' : ''}`}
                  onClick={() => { void navigateToModule(module.id, false) }}
                >
                  <span className="app-nav-item-top">
                    <span className="app-nav-item-label">{module.label}</span>
                    <span className="app-nav-item-category">{module.category}</span>
                  </span>
                  <span className="app-nav-item-desc">{module.summary}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="app-workspace">
        <header className="app-hero">
          <div className="app-hero-copy">
            <span className="app-hero-kicker">{activeDefinition.category}</span>
            <h2>{activeDefinition.label}</h2>
            <p>{activeDefinition.summary}</p>
          </div>

          <div className="app-hero-panel">
            <div className="app-hero-focus">
              {activeDefinition.focus.map((item) => (
                <span key={item} className="app-hero-chip">{item}</span>
              ))}
              <InfoHover content={`目标：${activeDefinition.outcome}`} label={`${activeDefinition.label}说明`} />
            </div>
          </div>
        </header>

        <main className="app-main">{page}</main>
      </div>
    </div>
  )
}

export default App
