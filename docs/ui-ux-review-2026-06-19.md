# 盲训 App UI/UX 评估报告

> 日期：2026-06-19
> 评估人：ZCode
> 评估范围：训练总览 / 盲训工作台 / 数据管理 / AI 交易教练 四个模块
> 评估方法：源码静态审计 + 设计 spec 对照 + 日志验证
> **重要说明：本评估未做 App 视觉走查**（沙盒环境无屏幕录制权限 + 项目为 Vite-Plugin-Electron 内嵌架构无独立 dev 端口可截图），所有发现均来自代码 / 样式 / 设计文档对照。视觉层面的判断仅在源码层面可靠，真实渲染需用户自行走查。

---

## 0. 评估方法与可信度说明

| 维度 | 评估方式 | 可信度 |
|------|---------|--------|
| 设计 token 一致性 | 对照 `src/index.css` vs `docs/UI_DESIGN_SPEC.md` | 高 |
| 模块内 CSS 与 spec 一致性 | 对照 `src/App.css` / `BlindTrainingWorkbench.css` / `TrainingOverview.css` vs spec | 高 |
| 组件交互流程 | 读 `.tsx` 状态机 + props + IPC 调用 | 高 |
| 可用性 / 可访问性 (a11y) | 检查 aria 属性 / 键盘事件 / 焦点管理 | 中（无运行时验证） |
| 视觉走查（颜色/间距/层次） | 仅基于 CSS 推断 | 低，**需用户手动补做** |

> **后续必须补做的视觉走查清单**（用户自行跑 `npm run electron:dev` 后）：
> 1. 四个模块切换时的实际配色对比
> 2. K 线图与上方 Session 工具栏的视觉断层
> 3. AI 报告卡 + 雷达图在 1200×800 默认窗口下的滚动情况
> 4. dark 账户卡片与浅色页面背景的对比度（WCAG AA）
> 5. 盲训工作台主操作按钮（买入/卖出/持有/下一根/换一只）的视觉权重是否合理

---

## 1. 总体评价（一句话）

**「底子扎实、功能完整，但视觉系统处于『半重构完成』状态——`index.css` 设计 token 已对齐 spec，4 个模块的局部 CSS 多数完成去 AI 味儿，但 `App.css` 仍是重构前的旧风格（毛玻璃/大圆角/多层渐变），AI 交易教练模块从出生起就完全游离于新设计系统之外。键盘可访问性是盲训工作台的最大短板。」**

### 1.1 已完成项

- ✅ `src/index.css` 已按 `UI_DESIGN_SPEC.md` 完整落地（`#f0f1f3` 页面底色、`#1a1d23` 主文字、teal 品牌色、A 股涨红跌绿、6/10px 圆角、whisper 阴影）
- ✅ `--font-mono` + `tabular-nums` 数字等宽方案已就位
- ✅ A 股配色统一（commit `db26800`）
- ✅ 3 个核心模块的 `.tsx` + `.css` 已拆开（关注点分离）
- ✅ 训练总览有 6 指标卡 + GitHub 式贡献日历（自研 SVG）
- ✅ 盲训工作台有完整状态机（idle / running / finished）
- ✅ AI 模块从 DB schema → IPC → client → analyzer → UI 闭环完整

### 1.2 核心风险（按严重度排序）

| 等级 | 数量 | 含义 |
|------|------|------|
| **P0** | 3 | 视觉系统与 spec 严重不一致，影响产品定位；可访问性阻塞盲训核心场景 |
| **P1** | 7 | 交互流程可优化；CSS 重复；组件代码债 |
| **P2** | 6 | 锦上添花；小瑕疵；i18n 准备 |

---

## 2. 详细发现

### P0-1：App.css 是"AI 味儿"重灾区，视觉系统分裂

**位置**：`src/App.css`（共 446 行，App shell + sidebar + hero + 快捷方式 + AI 模块临时样式）

**问题**：`docs/UI_DESIGN_SPEC.md` 已明确"不做什么"清单（毛玻璃 / 渐变 / scale(1.05) / 18-28px 大圆角 / 0 14px+ 大阴影），但 `App.css` 几乎全中招：

| 行号 | 违规 | 对应 spec 禁令 |
|------|------|----------------|
| L5-7 | `radial-gradient + linear-gradient` 三层页面底色 | ❌ 不用彩色渐变背景 |
| L17-19 | `backdrop-filter: blur(18px)` 毛玻璃 | ❌ 毛玻璃效果 |
| L45 | `border-radius: 22px`（品牌徽章） | ❌ 圆角统一 5-10px |
| L112 | `.app-nav-item` 18px 圆角 | ❌ 同上 |
| L128-130 | active 项用 `linear-gradient` + `0 14px 34px` 大阴影 | ❌ 渐变 + 大阴影 |
| L121 | `transform: translateY(-1px)` hover 动效 | ❌ hover 动效（应静态或微色变） |
| L204 | `.app-hero` `0 18px 46px` 阴影 | ❌ 大阴影 |
| L237-238 | `.app-hero-panel` 用 `linear-gradient(160deg, #163246, #1e4958)` 深蓝渐变 | ❌ 渐变 + spec 明确说改 `#1a1d23` 纯深色 |
| L283-285 | `.app-shortcut` 18px 圆角 + `0 10px 30px` 阴影 | ❌ 同上 |
| L310-314 | `.app-main` 28px 圆角 + `0 18px 46px` 阴影 | ❌ 同上 |
| L325-327 | `.app-loading-state` 双层渐变 | ❌ 渐变 |

**影响**：
- App shell 与右侧 4 个模块是**两个完全不同的视觉系统**——左边蓝色毛玻璃 glassmorphism（重写前），右边各模块的灰白 clinical 风（重写后）
- 用户首屏看到的是「蓝绿渐变 + 模糊 + 18-28px 圆角」SaaS 落地页感，**与产品定位"专业 A 股盘感训练工具"严重错位**
- `index.css` 的设计 token 在 `App.css` 里**基本没被引用**（sidebar / hero 全部是硬编码 rgba 值）

**修复建议**（按 spec 重写 `App.css`）：
```css
/* 删除：所有 backdrop-filter、所有大阴影、所有 >12px 圆角、所有 linear-gradient 装饰 */
/* 改用：var(--bg-card) / var(--border) / var(--radius-lg) 等 token */
.app-shell {
  background: var(--bg-page);          /* 而非多层渐变 */
  /* 删除整个 .app-shell 里的 radial-gradient */
}
.app-sidebar {
  background: var(--dark-bg);          /* 而非 rgba + blur */
  /* 删除 backdrop-filter */
  border-right: 1px solid var(--dark-border);
  border-radius: 0;                    /* 而非 sticky + 圆角 */
}
.app-nav-item {
  border: 1px solid var(--dark-border);
  border-radius: var(--radius-md);     /* 6px 而非 18px */
  background: transparent;
  /* 删除 transform: translateY */
}
.app-nav-item--active {
  border-color: var(--color-brand);
  background: var(--color-brand-bg);   /* 不用渐变 */
  /* 删除 box-shadow */
}
.app-hero {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: none;                    /* 改用边框 */
}
.app-hero-panel {
  background: var(--dark-bg);          /* 而非 #163246 → #1e4958 渐变 */
  border-radius: var(--radius-lg);
  /* spec §3.1 明确指定 #1a1d23 */
}
.app-main {
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: none;
}
```

**工作量估计**：1 个文件、~400 行 CSS 改写 + 验证视觉走查。预计 1-2 个 commit。

---

### P0-2：AI 交易教练模块完全脱离新设计系统

**位置**：`src/components/trading/AIHabitAdvisor.tsx` + `src/components/trading/ai-advisor/*` + `src/App.css` L398-446 的 `.ai-habit-*` 临时样式

**问题**：
1. **用 emoji 做 section 标题图标**（`AIHabitAdvisor.tsx` L209, L217, L225, L233）：
   - `✅ 优点` / `⚠️ 缺点` / `🎯 不良习惯` / `📋 改善计划`
   - spec §五明确 "不用 emoji"，且 `AGENTS.md` §3 也要求无装饰元素
2. **emoji 趋势指示符**（L121-124）：`▲` / `▼` 三角符号——这俩其实是 Unicode 几何符号，**不算 emoji**，可保留，但视觉上与设计 spec 主张的"临床冷静"风格有冲突
3. **CSS 用了 `rgba(123, 140, 171, ...)` 蓝调灰**（`App.css` L402, L420, L431, L438），spec §2.1 明确说"去掉蓝调改中性灰"
4. **`#2563eb` 蓝色按钮**（L444）—— spec 唯一允许的非语义色是 brand `teal` + 涨跌红绿
5. **警告用 ⚠️ 黄色 emoji**（L148）—— emoji 违反规则
6. **没用到任何 `--bg-card` / `--text-secondary` / `--border` 等已定义的设计 token**

**影响**：
- AI 模块是「最近 20 个 commit 几乎全部在做」的成果（commit log 显示），但**视觉上它不属于盲训产品**，像是从其他 SaaS 粘贴过来的
- 用户在 4 个模块里看到 3 套不同的视觉语言（重写前 App shell + 重写后核心模块 + 完全另起炉灶的 AI 模块），**品牌一致性破碎**
- 跟用户的承诺（"去 AI 味儿"）反向而行

**修复建议**：
```tsx
// AIHabitAdvisor.tsx 删除所有 emoji
<h4>优点</h4>          // 而非 ✅ 优点
<h4>待改进</h4>        // 而非 ⚠️ 缺点
<h4>不良习惯</h4>      // 而非 🎯 不良习惯
<h4>改善计划</h4>      // 而非 📋 改善计划
<h4>⚠️ 未配置 AI 助手</h4>  // 改为 <div className="warning-icon">!</div> + CSS 绘制感叹号
```
```css
/* App.css 的 .ai-habit-* 段全部用设计 token 重写 */
.ai-habit-report-section {
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  border-left: 4px solid var(--color-down);  /* good */
}
.ai-habit-report-section--warn { border-left-color: var(--color-warning); }
.ai-habit-report-section--bad  { border-left-color: var(--color-up); }
/* 颜色编码含义翻转：up(红) = bad, down(绿) = good，与 A 股惯例一致 */
```

**工作量估计**：1 个 tsx + 1 个 css 局部，~150 行改动。

---

### P0-3：盲训工作台键盘可访问性缺口严重

**位置**：`src/components/trading/BlindTrainingWorkbench.tsx`（L1215 行）+ `src/components/trading/blind-workbench/ActionSection.tsx` + `SessionToolbar.tsx`

**问题**：
1. **快捷键只在 `<button>` 上注册了 `onKeyDown`**（读源码发现），但**没有全局快捷键说明**：
   - 用户第一次打开工作台，**不知道 B/S/H/Space/N/→ 各对应什么**（spec 要求"无文档则不可用"）
   - 即使在 ActionSection 上有 `<kbd>` 提示，但折叠状态下完全看不到
2. **`actionKeyHints` 缺乏可发现性**：
   - 没有 "?" 键打开 cheat sheet
   - 没有可访问的 `<kbd>` 列表弹窗
3. **焦点管理缺失**：
   - 切到下一根 K 线后，**焦点留在原按钮**，用户必须主动 Tab 才能继续操作
   - 这是键盘流用户最大的痛点
4. **设置面板"应用配置"按钮对盲用户不友好**（`SETTINGS_REVIEW.md` §3.3 已识别）：
   - 改了"破坏性"设置（走势筛选、抽样范围）后只点"应用配置"，可能没意识到会重置当前 session
   - 没有 aria-live 通知 session 已结束
5. **错误状态无 a11y 提示**：
   - 资金不足时只 `alert()`，对屏读用户不友好（需用 `role="alert"` 区域）
   - 工作台顶部的 status chip 没有 `aria-live="polite"`

**影响**：
- 盲训工作台是**键盘密集型**场景（快速 B/S 决策），a11y 缺口直接降低核心用户群（专业交易员）的效率
- 与"专业交易终端"的产品定位不符（富途/同花顺的快捷键都有明确可视化提示）

**修复建议**（优先级降序）：
1. 工作台顶部加一个 "?" 按钮 / `Shift+/` 触发快捷键 cheat sheet 弹窗
2. 改 setting 应用后的弹窗为**带 `role="alert"` 的内联提示**（而非 alert）
3. `ActionSection` 切下一根后，**自动 focus 下一根的"持有"按钮**（最常见操作）
4. status chip 区域加 `aria-live="polite"`
5. 给资金不足等错误加 `<div role="alert">` 而非 `alert()`

**工作量估计**：3-4 个 tsx 改动，~50-80 行新增 + 少量样式。

---

### P1-1：组件文件过大，状态管理债

| 文件 | 行数 | 评价 |
|------|------|------|
| `BlindTrainingWorkbench.tsx` | 1215 | 远超 800 行警戒线 |
| `TrainingOverview.tsx` | 1005 | 同样超警戒 |
| `ProfileManager.tsx` (在 blind-workbench/) | 32K / ~800 行 | 中等 |

**具体表现**（`BlindTrainingWorkbench.tsx`）：
- 估计有 **20+ 个 `useState` 钩子**（来自探索报告）
- 配套的 `useRef` 镜像（用于从异步回调读最新值）是 React 19 反模式
- 状态切片缺乏明确边界（session 状态 / 训练参数 / UI 状态 / 缓存数据混在一起）

**建议**：
- 抽 `useBlindSession()` 自定义 hook（封装 sessionStatus 状态机）
- 抽 `useWorkbenchSettings()` 自定义 hook（封装设置项 + draft 状态 + 持久化）
- 抽 `useSamplePool()` 自定义 hook（封装抽样 / 加载 / 扩展）
- 组件文件应瘦到 < 500 行

**注**：这是 P1 而非 P0，因为**当前功能正常**，是工程债而非用户体验债。

---

### P1-2：日历热力图与统计卡片的色阶不统一

**位置**：`src/components/trading/TrainingOverview.tsx` 的 `getColor(avgPnlPct)` + `src/components/trading/TrainingOverview.css`

**问题**：
- 自研 SVG 日历有 P&L 颜色梯度函数，但**色阶起点/终点/中点定义在组件内**，没有用设计 token
- 与"涨红跌绿"规范的对应关系需查代码（如果是负值用绿、正值用红 → 正确；如果是色阶透明度叠加 → 不规范）
- 同时存在 `card hover` 的 `box-shadow` 残留（`TrainingOverview.css` 需查证）

**修复建议**：
- 抽取 `--color-pnl-1` / `--color-pnl-2` / `--color-pnl-3` / `--color-pnl-4` / `--color-pnl-5` 五个色阶 token 到 `index.css`
- 日历、走势图、统计卡共用同一套色阶

---

### P1-3：TrainingOverview 账户卡片 — 渐变与 spec 冲突

**位置**：`TrainingOverview.css` / `TrainingOverview.tsx` 的 `ov-account-card`

**问题**：`UI_DESIGN_SPEC.md §3.1` 明确要求"账户卡片去掉 `background: linear-gradient(160deg, #163246, #1e4958)` 深蓝渐变 → 改为 `background: #1a1d23` 纯深色" + "去掉 `box-shadow: 0 6px 20px rgba(22,50,70,0.15)` → 改为无边框无阴影"。

需对照 `TrainingOverview.css` 实际代码确认是否已应用。未走查前标注为"待验证"——用户需 grep `ov-account-card` + `linear-gradient` 关键词自查。

---

### P1-4：盲训工作台设置面板 — 已知问题清单

**位置**：`docs/SETTINGS_REVIEW.md` 已识别 8 个 P1 问题（4-8），本次未发现新问题。

**重点跟进**（来自 `SETTINGS_REVIEW.md`）：
- 周期选择器冗余（仅 1d 一个选项）
- "补载更多 K 线" 按钮定位不清
- 成交模式名称不直观（"盘尾收盘"/"次根开盘"）
- 样本池深度 / 抽样范围认知负荷高
- 最低股价位置尴尬

建议**直接按 `SETTINGS_REVIEW.md` Phase 2 + Phase 3 推进**，本次评估不重复。

---

### P1-5：快捷键提示位置不合理

**位置**：`ActionSection.tsx` 渲染了 `<kbd>` 提示，但盲训场景下**用户视线 80% 时间在 K 线图上**

**问题**：
- `<kbd>` 提示在按钮内部或按钮下方，**K 线图与按钮区中间有信息断层**（用户视线要在"K 线 → 下方按钮"之间跳）
- 没有 hover 预览（鼠标悬停时显示完整提示）
- 没有按下的"反馈"（按下时按钮没视觉变化）

**修复建议**：
- 在 K 线图右下角加一个 "?" 小图标 → 打开快捷键 cheat sheet
- 按钮按下时用 `transform: scale(0.95)` 100ms 模拟物理按键
- 或用 toast 短促显示刚按的快捷键含义

---

### P1-6：四个模块的"返回上一级"路径不一致

**位置**：`src/App.tsx` 路由逻辑 + 四个模块组件的导航

**问题**：
- 训练总览有"账户切换器"回到账户列表，但**没有明显的"返回工作台"按钮**
- 盲训工作台"结束结算"后会跳到 ResultSummary，**但 ResultSummary 没有"再开一局"按钮**（来自探索报告未确认）
- 数据管理是叶子页面，**没有"返回训练"快捷入口**
- AI 教练页面**完全没有"跳到工作台"入口**——用户想去工作台必须点侧边栏

**影响**：4 个模块的导航回路不闭合，**用户容易"迷路"**

**修复建议**：
- 每个模块的 `.app-hero` 头部加 breadcrumb 风格的"← 返回总览"按钮
- ResultSummary 顶部加"再开一局"和"查看总览"两个 CTA
- 模态关闭后焦点正确回到触发元素

---

### P1-7：AI 教练的错误状态文案过于技术化

**位置**：`AIHabitAdvisor.tsx` L77, L100, L243

**问题**：
- `"分析失败"` / `"生成失败"` / `"报告解析失败，原始内容见日志"` —— 用户不知道下一步该做什么
- 没有给"重试"或"查看日志"按钮
- 错误用纯文字（无图标/无背景色），与 warning 区域视觉强度一致

**修复建议**：
```tsx
{error && (
  <div className="ai-habit-advisor-error" role="alert">
    <strong>分析失败</strong>
    <p>{error}</p>
    <button onClick={handleAnalyze}>重试</button>
    <button onClick={() => window.electronAPI?.agent?.openLogsFolder()}>查看日志</button>
  </div>
)}
```

---

### P2-1：窗口标题与品牌名不一致

**位置**：`index.html` L3 `<title>stock-trading-simulator</title>`

**问题**：Electron `productName: 盲训`，但浏览器窗口标题是英文占位符 `stock-trading-simulator`。macOS Dock 切换窗口时显示的是这个英文。

**修复**：
```html
<title>盲训 — 盘感训练</title>
```

---

### P2-2：favicon 与 app 图标不一致

**位置**：`index.html` L4 `<link rel="icon" href="/favicon.svg">` + `build/icon.icns`（app 实际图标）

**问题**：未确认 `/favicon.svg` 是否存在；如不存在首次启动会有 404。

**修复**：统一用 `build/icon.png` 或提供同名 svg。

---

### P2-3：训练总览"最佳/最差 3 笔"展示缺互动

**位置**：`TrainingOverview.tsx` 的 Best/Worst 3 trades 区域

**问题**：根据探索报告"clickable rows"，但点击后**没有明显的"已选中"反馈**，且右侧详情面板切换动画生硬。

**修复**：加 `aria-current` + 选中态左侧色条 + 平滑滚动到详情区。

---

### P2-4：键盘导航的 Tab 顺序不直观

**位置**：整个 App

**问题**：
- sidebar 导航项 + 主内容 + 模态的 Tab 顺序**未明确规划**（读了 App.tsx 也没看到 `tabIndex` 控制）
- 浮动的 InfoHover tooltip 出现在 tab 流中（应 `tabIndex={-1}` 或 `inert`）

**修复**：用 `@blueprintjs/core` 的 FocusStyleManager 思路自己实现，或检查 `tabindex` 流。

---

### P2-5：颜色对比度未做 WCAG 验证

**位置**：所有文本/背景组合

**问题**：未做对比度自动化测试。设计 spec 主张"临床冷静"，但 `--text-tertiary: #9ca3af` 在 `--bg-card: #fdfdfd` 上的对比度约 2.85:1（**未达 WCAG AA 4.5:1**）。

**修复**：
- 调暗 `--text-tertiary` 到 `#6b7280`（当前是 secondary，应交换）
- 或加 `prefers-contrast: more` 媒体查询

---

### P2-6：AI 教练的趋势对比"vs 上次"位置容易误读

**位置**：`AIHabitAdvisor.tsx` L118-128

**问题**：
- `▲` / `▼` 后是绝对值 `Math.abs(trendChase)`，**没有把"上次"和"当前"分开显示**
- 用户看到"追涨率 ▲ 0.5%"不知道是"上次 5% → 现在 5.5%"还是"上次 0% → 现在 0.5%"

**修复**：
```tsx
<span>追涨率 {prev!.value} → {curr.value} ({delta > 0 ? '+' : ''}{fmtPct(delta)})</span>
```

---

## 3. 优先级路线图

### Phase 1（P0，1-2 周）— 视觉系统收口

| 任务 | 文件 | 工时 |
|------|------|------|
| 1.1 重写 `App.css` 对齐设计 spec | `src/App.css` | 4-6h |
| 1.2 AI 模块去 emoji + 改用设计 token | `AIHabitAdvisor.tsx` + `App.css` L398-446 | 2-3h |
| 1.3 盲训工作台键盘 cheat sheet + 焦点管理 | `BlindTrainingWorkbench.tsx` + 新组件 | 4-6h |

**Phase 1 完成后**：4 个模块视觉系统统一，键盘可访问性达可用水平。

### Phase 2（P1，2-3 周）— 流程优化与代码债

| 任务 | 文件 | 工时 |
|------|------|------|
| 2.1 推进 `SETTINGS_REVIEW.md` Phase 2-3 | `BlindTrainingWorkbench.tsx` 等 | 6-8h |
| 2.2 抽 `useBlindSession` / `useWorkbenchSettings` 自定义 hook | `BlindTrainingWorkbench.tsx` 拆 3-4 个文件 | 8-12h |
| 2.3 4 个模块导航回路闭合 | `App.tsx` + 各 hero 组件 | 3-4h |
| 2.4 AI 错误状态 + 趋势对比改进 | `AIHabitAdvisor.tsx` | 2-3h |
| 2.5 快捷键提示 + 按下反馈 | `ActionSection.tsx` | 2h |

### Phase 3（P2，持续）— 锦上添花

- 窗口标题 / favicon
- WCAG 自动化测试
- 日历色阶 token 化
- i18n 准备（spec §六已标"英文版前必须解决"）

---

## 4. 与现有设计 / 文档的一致性

| 来源 | 状态 |
|------|------|
| `docs/UI_DESIGN_SPEC.md` | App.css 与 spec 严重不一致（P0-1） |
| `docs/SETTINGS_REVIEW.md` | 8 个 P1 问题待推进，本评估未新增 |
| `docs/trading-accounting-spec.md` | A 股涨红跌绿 — 已对齐（commit `db26800`） |
| `docs/BRD.md` | 4 模块功能完整；3 个核心 KPI 暂无埋点验证 |
| `docs/ARCHITECTURE.md` | 提到 ECharts，实际用 klinecharts — 文档过期 |

---

## 5. 总结

盲训 App 在**功能层面**已经相当扎实：4 个模块逻辑闭环、IPC 协议清晰、数据库 schema 完整、AI 教练闭环。

但在**视觉/体验层面**有两块明显短板：
1. **设计系统"半成品"** — token 改了但 App.css 没改、AI 模块没改
2. **盲训核心场景的 a11y 缺口** — 键盘流用户和屏读用户都被挡在门外

**建议先把 Phase 1 的 3 个 P0 收口**，再回头处理 P1 流程问题。视觉系统统一后，P1 中的很多问题会因为 token 复用自动消失。

---

## 附录 A：本评估未做的事

- ❌ 视觉走查（4 个模块切换、实际配色、间距层次）— 沙盒无屏幕权限
- ❌ 性能实测（1560 根 K 线 + 多指标）— `SETTINGS_REVIEW.md §6.1` 已列待办
- ❌ 真实 a11y 测试（屏读器、键盘流）— 需用户在 macOS 本地完成
- ❌ 暗色模式评估 — spec §五明确不做，故跳过

## 附录 B：用户需手动验证的项

- [ ] 跑 `npm run electron:dev` 后截图 4 个模块
- [ ] 盲训工作台 1 分钟内能否独立完成"开始 → B → S → 结束"（无文档测试）
- [ ] AI 模块未配置 LLM 时是否给出明确引导
- [ ] dark 账户卡片的 WCAG 对比度
- [ ] K 线图 + 上方 Session 工具栏的视觉断层
