import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import InfoHover from './components/common/InfoHover'
import { initDb, queryStockList, queryKline, isDbReady } from './web/dbLoader'
import './App.css'

const BlindTrainingWorkbench = lazy(() => import('./components/trading/BlindTrainingWorkbench'))
const TrainingOverview = lazy(() => import('./components/trading/TrainingOverview'))
const DataManagement = lazy(() => import('./components/trading/DataManagement'))
const AIHabitAdvisor = lazy(() => import('./components/trading/AIHabitAdvisor'))

type AppModule = 'overview' | 'blind' | 'data' | 'agent'

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
        outcome: '为盲训提供统一的 K 线数据底座。',
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
      {
        id: 'agent' as AppModule,
        label: 'AI 交易教练',
        category: '习惯诊断',
        summary: '解析训练记录，识别交易优缺点与不良习惯，给出改善计划。',
        outcome: '把统计指标变成可执行的实战改进清单。',
        focus: ['习惯指标', 'AI 诊断', '改善计划']
      },
    ]
  },
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
  if (activeModule === 'agent') {
    return (
      <Suspense fallback={<WorkspaceFallback label="AI 交易教练" />}>
        <AIHabitAdvisor />
      </Suspense>
    )
  }
  return (
    <Suspense fallback={<WorkspaceFallback label="数据管理" />}>
      <DataManagement />
    </Suspense>
  )
}

function DataProbe() {
  const [status, setStatus] = useState('未初始化')
  const [stocks, setStocks] = useState<Array<Record<string, unknown>>>([])
  const [klines, setKlines] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    ;(async () => {
      try {
        setStatus('加载中…')
        await initDb()
        setStatus('已加载，查询中…')
        const s = await queryStockList(5)
        setStocks(s)
        if (s.length > 0) {
          const k = await queryKline(s[0].code as string, 'daily', 5)
          setKlines(k)
        }
        setStatus(`✅ 就绪（${s.length} 只股票示例）`)
      } catch (e) {
        setStatus(`❌ ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, [])

  return (
    <div style={{ padding: 16, background: '#0d0d0d', color: '#fff', fontFamily: 'monospace', minHeight: '100vh' }}>
      <h2 style={{ fontSize: 16 }}>数据探针 · PWA 阶段2a 验证</h2>
      <p style={{ fontSize: 13 }}>DB 状态：{status}</p>
      <p style={{ fontSize: 13 }}>isDbReady: {String(isDbReady())}</p>
      <h3 style={{ fontSize: 14, marginTop: 16 }}>股票列表（前5）</h3>
      <pre style={{ fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(stocks, null, 2)}</pre>
      <h3 style={{ fontSize: 14, marginTop: 16 }}>第一只股票最近5根K线</h3>
      <pre style={{ fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(klines, null, 2)}</pre>
    </div>
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

  if (typeof window !== 'undefined' && !(window as unknown as { electronAPI?: unknown }).electronAPI) {
    return <DataProbe />
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand-badge">盘感训练</span>
          <h1 onClick={() => { void navigateToModule('overview', false) }}>盲训工作台</h1>
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
