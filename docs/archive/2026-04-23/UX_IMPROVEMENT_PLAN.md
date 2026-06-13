# UX 改进 + LLM 评估盲训技术方案

## 背景

当前系统已有完整功能闭环，但存在以下使用体验问题：
1. UI 页面说明文字过多，关键操作不够直观
2. 盲训资金重置 bug（已修复：`handleStartSession` 现在重新加载 profile capital）
3. 缺少 LLM 驱动的盲训操作评估能力
4. AI 助手页面需要更深度集成（不仅是对话，还要能点评训练、解读模型）

---

## 1. UI 精简与 Info Hover

### 1.1 App.tsx Hero 区域精简

**现状：** 每个 module 都有 `summary` + `outcome` + `focus` 三段文字，在 hero 区域完整展示，占用大量空间。

**改动：**
- Hero 区域只保留模块标题 + 一句话 summary
- `outcome` 和 `focus` 改为 hover 展示（info icon + tooltip）
- 删除 `.app-hero-panel` 中的大块文字，改为紧凑的一行信息

**文件变更：**
- `src/App.tsx` — 精简 hero JSX，删除 `app-hero-outcome-label/outcome/focus` 大块渲染
- `src/App.css` — 删除 `.app-hero-panel` 相关的 padding/margin

### 1.2 盲训工作台说明精简

**现状：**
- `.wt-no-data-hint` 有完整段落说明
- `.wt-idle-ready-text` 有冗余说明

**改动：**
- `.wt-no-data-hint` 缩短为"请先同步数据"，详细说明移至 info hover
- `.wt-idle-ready-text` 改为"{n} 个样本就绪"

**文件变更：**
- `src/components/trading/BlindTrainingWorkbench.tsx` — 缩短文字

### 1.3 Info Hover 组件

新建通用 InfoHover 组件：

```tsx
// src/components/common/InfoHover.tsx
interface InfoHoverProps {
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}
// 渲染一个 (i) icon，hover 时显示 tooltip
```

**使用场景：**
- 盲训工作台各设置项说明
- 模型训练页各参数说明
- 回测页策略说明
- K 线数量/执行模式说明

**文件变更：**
- 新建 `src/components/common/InfoHover.tsx`
- 新建 `src/components/common/InfoHover.css`
- 各使用方引入

### 1.4 回测页说明精简

**现状：** `BacktestPage.tsx` 有两段说明文字。

**改动：**
- 保留第一句简短说明
- 第二句（策略机制说明）移至 info hover

**文件变更：**
- `src/components/trading/BacktestPage.tsx`

---

## 2. 盲训资金重置 Bug 修复（已完成）

### 2.1 问题分析

**根因：** `handleStartSession` 使用闭包中的 `activeProfile?.current_capital`，但 `finishSession` 更新 profile 后的 state 更新可能存在延迟。

### 2.2 修复内容

**文件：** `src/components/trading/BlindTrainingWorkbench.tsx`

1. `handleStartSession` 开头新增 `profile.getActive()` 实时读取最新 capital
2. 新增 `sessionInitialCapital` state 追踪本次会话实际起始资金
3. `finishSession` 中 `sessionPnl = finalCapital - sessionInitialCapital`（而非固定 INITIAL_CAPITAL）
4. `handleSwitchSample` 中同步更新 `sessionInitialCapital`

---

## 3. LLM 评估盲训操作

### 3.1 功能描述

在 AI 助手页面增加"评估我的训练"按钮，LLM 基于用户最近的训练会话数据（买卖点、收益、持仓时间、胜率等）给出专业点评和改进建议。

### 3.2 实现方案

**Step 1: 新增 IPC 获取训练摘要**

在 `src/main/ipc/blind.ts` 中新增：

```typescript
ipcMain.handle('aichat:getRecentSessions', async (_, limit = 5) => {
  const db = getDb()
  // 查询最近 N 个已完成会话，包含：
  // - session 基本信息（标的、周期、收益）
  // - trade_actions 买卖点（bar_index, action_type, price）
  // - session_review 指标（win_rate, max_drawdown 等）
  // 返回结构化 JSON
})
```

**Step 2: AiChat 增加评估模式**

在 `src/components/trading/AiChat.tsx` 中：

```tsx
// 新增"评估训练"按钮
const handleEvaluateTraining = async () => {
  const sessions = await window.electronAPI?.aichatGetRecentSessions?.(5)
  if (!sessions?.length) {
    // 提示无训练数据
    return
  }
  // 构造评估 prompt
  const evalPrompt = `请评估我最近的 ${sessions.length} 次盲训表现...`
  setInput(evalPrompt)
  // 自动发送
}
```

**Step 3: 系统提示增强**

扩展 SYSTEM_PROMPT，增加盲训评估能力描述：

```
5. 评估用户的盲训操作表现（买卖时机、持仓纪律、止盈止损习惯）
6. 基于历史会话数据给出具体改进建议
```

**Step 4: 预处理训练数据**

在主进程中格式化训练数据为 LLM 友好的文本：

```typescript
function formatSessionsForLLM(sessions): string {
  return sessions.map(s => `
会话 ${s.id.slice(0,8)} | ${s.stock_name}(${s.stock_code}) | ${s.interval_type}
  收益: ${s.pnl_pct}% | 胜率: ${s.win_rate}% | 最大回撤: ${s.max_drawdown}%
  操作: ${s.actions.map(a => `${a.action_type}@${a.price}`).join(' → ')}
  `).join('\n')
}
```

### 3.3 文件变更清单

| 文件 | 改动 |
|------|------|
| `src/main/ipc/blind.ts` | 新增 `aichat:getRecentSessions` handler |
| `src/preload/index.ts` | 新增 `aichatGetRecentSessions` 方法 |
| `src/types/global.d.ts` | 新增类型声明 |
| `src/components/trading/AiChat.tsx` | 新增评估按钮 + prompt 构建 + SYSTEM_PROMPT 增强 |
| `src/components/trading/AiChat.css` | 评估按钮样式 |

---

## 4. AI 助手深度集成

### 4.1 功能描述

AI 助手页面不仅是对话，还能：
- 查看模型训练效果（读取模型评估报告）
- 配置训练参数（生成 CLI 命令建议）
- 解读回测结果（读取 backtest JSON）

### 4.2 实现方案

**Step 1: 增加上下文获取能力**

在 `buildContext` 中扩展：

```typescript
// 新增获取最近模型训练结果
const recentModels = await window.electronAPI?.listModels?.({ limit: 3 })
// 新增获取回测报告
const backtestReport = modelId ? await window.electronAPI?.backtest?.getReport?.(modelId) : null
```

**Step 2: 新增快捷操作按钮**

在 AiChat 空状态区域增加：

```
[评估最近训练] [分析模型效果] [解读回测报告] [优化训练参数]
```

每个按钮会自动收集相关数据并构造 prompt 发送给 LLM。

**Step 3: 增加模型数据解读 prompt**

```
const MODEL_ANALYSIS_PROMPT = `以下是我的模型训练结果：
{model_data}

请分析：
1. 模型效果如何？AUC/F1 是否达标？
2. 哪些特征最重要？是否有改进空间？
3. 下一步优化方向建议。
`
```

### 4.3 文件变更清单

| 文件 | 改动 |
|------|------|
| `src/components/trading/AiChat.tsx` | 扩展 buildContext、增加快捷按钮、增强 SYSTEM_PROMPT |
| `src/components/trading/AiChat.css` | 快捷操作按钮组样式 |

---

## 5. 实施优先级

| 优先级 | 项目 | 预计工时 |
|--------|------|----------|
| P0 | 资金重置 bug 修复 | ✅ 已完成 |
| P1 | InfoHover 组件 + UI 精简 | 2h |
| P1 | LLM 评估盲训 | 2h |
| P2 | AI 助手深度集成 | 1.5h |

---

## 6. 验收标准

1. 资金在连续训练中正确累积，不再重置为 10 万
2. UI 页面无超过一行的说明文字，复杂功能有 info hover
3. AI 助手可以一键评估最近 5 次训练并给出专业建议
4. AI 助手可以解读模型评估报告和回测结果
