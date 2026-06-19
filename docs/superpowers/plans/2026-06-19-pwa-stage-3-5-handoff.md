# PWA 迁移 · 阶段 3-5 工作文档（新 session 接续用）

> 本文档面向在新 session 里接续 PWA 工作的同学。阶段 1-2 已完成，本文档覆盖剩余的阶段 3（完善 webApi）、阶段 4（完整横竖屏 UI）、阶段 5（部署）。
>
> **关联文档**：
> - 总设计：`docs/superpowers/specs/2026-06-18-electron-to-pwa-migration-design.md`
> - 已完成的 plan：`docs/superpowers/plans/2026-06-19-pwa-*.md`（5 份）
> - 当前分支：`mobile`（worktree 目录 `/Users/xudan/Documents/trae_projects/blind-trainer-mobile`）

---

## 0. 当前状态（截至 2026-06-19）

### 0.1 已完成

| 阶段 | 产出 | 状态 |
| --- | --- | --- |
| 1. 数据精简 | `scripts/shrink_seed_for_web.py` + 3 个分层包（builtin-100 / starter-500 / full-3744） | ✅ |
| 2a. PWA 骨架 | sql.js + IndexedDB + vite-plugin-pwa，数据探针验证 | ✅ |
| 2b-1. 盲训库 | `blindDb.ts`（sessions/actions/trained_stocks + 持久化）+ `sampler.ts`（零重复抽签） | ✅ |
| 2b-2. 工作台接入 | `webApi.ts`（对齐 preload 签名）+ `BlindTrainingWorkbench` 接入 mobileAPI + 基础横竖屏 CSS | ✅ |

**验证基线**：`npx vitest run` 全过（55 个测试），`npx tsc -b --noEmit` 通过，`npm run build` 成功产出 PWA（含 sql-wasm.wasm + builtin-100.sqlite + sw.js）。

### 0.2 当前 PWA 能做什么

- 从 builtin-100（100 只精选股票）随机抽签，排除已训练股（零重复）
- 加载 K 线、显示工作台、模拟买卖、结算保存到盲训库
- 基础横竖屏响应式布局

### 0.3 关键文件清单（新 session 必读）

| 文件 | 职责 |
| --- | --- |
| `src/web/dbLoader.ts` | 只读行情库（builtin-100.sqlite）管理 + 查询 |
| `src/web/blindDb.ts` | 可写盲训库（sessions/actions/trained_stocks）+ IndexedDB 持久化 |
| `src/web/sampler.ts` | 零重复抽签（行情库选股 + 盲训库排除） |
| `src/web/sampleAdapter.ts` | 样本格式转换（date→timestamp） |
| `src/web/webApi.ts` | webApi 抽象层（对齐 preload 接口签名） |
| `src/web/idb.ts` | IndexedDB 封装（存取 Uint8Array snapshot） |
| `src/main.tsx` | 启动时挂载 mobileAPI（无 electronAPI 时） |
| `src/components/trading/BlindTrainingWorkbench.tsx` | 工作台组件（已用 mobileAPI） |
| `src/stores/platformStore.ts` | zustand store（已用 mobileAPI） |
| `public/data/builtin-100.sqlite` | 内置包（100 只，17MB，随 App 打包） |

### 0.4 协作约定

- **main 分支**：另一个 agent 在 `blind-trainer/` 维护 macOS Electron 版
- **mobile 分支**：PWA 版，在 `blind-trainer-mobile/` worktree 独立工作
- 两个目录隔离，commit 共享同一个 .git
- **新 session 请在 `blind-trainer-mobile/` 目录工作**：`cd /Users/xudan/Documents/trae_projects/blind-trainer-mobile`

---

## 阶段 3：完善 webApi（补全 stub 接口）

**目标**：把 webApi 里当前返回 null/空数组的 stub 接口补全为真实实现，让训练后的复盘、多账户、样本补载都能工作。

**预估**：3-4 天

### 3.1 当前 stub 接口清单（需补全）

在 `src/web/webApi.ts` 里，以下接口是 stub：

| 接口 | 当前返回 | 应实现什么 | 优先级 |
| --- | --- | --- | --- |
| `db.getSessionReview(sessionId)` | `null` | 计算并返回 SessionReview（胜率/回撤/持仓天数等） | 高（复盘必需） |
| `db.getSessionActions(sessionId)` | `[]` | 从盲训库 trade_actions 表查该 session 的所有动作 | 高（复盘必需） |
| `db.listSessions()` | `[]` | 从盲训库 training_sessions 表查历史 session 列表 | 中 |
| `db.finishSession(...)` | 只返回 success，**没写库** | 在 training_sessions 表 UPDATE finished_at/final_capital/realized_pnl | 高（结算必需） |
| `db.saveTradeAction(...)` | 只返回 id，**没写库** | INSERT 到 trade_actions 表 | 高（动作持久化必需） |
| `profile.getActive()` | 固定返回默认账户 | 从盲训库查/创建真实 profile，反映训练后的资金/胜率变化 | 中 |
| `data.getCandles(code)` | `[]` | 从行情库查该股全量 K 线（样本走到末尾时补载） | 低（影响"次根开盘"模式） |

### 3.2 实现要点

#### 3.2.1 blindDb 补充写操作

当前 `blindDb.ts` 只有 `saveSession` + `markTrained` + `getTrainedCodes`。需要补充：

```typescript
// 参考签名（具体实现参考 main 版 src/main/blindDb.ts）
export async function finishSession(sessionId: string, finalCapital: number, realizedPnl: number, totalTrades: number, winningTrades: number): Promise<void>
export async function saveTradeAction(action: {...}): Promise<void>
export async function getSessionActions(sessionId: string): Promise<SessionActionRecord[]>
export async function getSessionReview(sessionId: string): Promise<SessionReview | null>
export async function listSessions(profileId?: string): Promise<SessionSummary[]>
```

**关键**：每个写操作后调用 `persist()`（已封装，把盲训库 snapshot 存 IndexedDB）。

#### 3.2.2 SessionReview 计算（最复杂）

main 版的 `getSessionReview` 计算了 13 个指标（trade_win_rate / max_drawdown_pct / avg_holding_bars / win_hold_efficiency 等）。参考实现：

- main 版 SQL + 计算逻辑：`src/main/blindDb.ts`（搜 `getSessionReview`）
- 类型定义：`src/types/ipc.ts` 的 `SessionReview` 接口
- 算法：遍历该 session 的 trade_actions，计算每笔交易的盈亏、持仓时长、胜率，再聚合

**建议**：先把 SessionReview 的计算逻辑抽成一个纯函数 `calculateSessionReview(actions: TradeAction[])`，单独写单元测试（TDD），再在 blindDb 里调用。

#### 3.2.3 多账户

当前 `profile.getActive` 永远返回固定 `DEFAULT_PROFILE`。要支持多账户：

- blindDb 需要一张 `profiles` 表（参考 main 版 `blindDb.ts`）
- webApi 的 `profile.getActive/create/list/load/delete/resetCapital` 改为查盲训库
- 工作台的 `ProfileManager` 组件（已用 mobileAPI）会自动生效

**注意**：main 版的 profile 表存 current_capital 等字段，每次 finishSession 后要更新这些字段（UPDATE profiles SET current_capital = ? WHERE id = ?）。

#### 3.2.4 测试策略

每个新接口都用 TDD：
- 在 `src/web/blindDb.test.ts` 或新建 `webApi.test.ts` 追加测试
- 测试用真实 builtin-100 数据 + fake-indexeddb
- 参考现有测试的 `locateFile = () => 'file://${WASM_PATH}'` 模式（jsdom 下绕过 fetch）

### 3.3 阶段 3 完成标准

- [ ] 训练一局后，`getSessionReview` 返回非 null 的复盘报告
- [ ] `getSessionActions` 返回该 session 的所有买卖动作
- [ ] `listSessions` 返回历史 session 列表
- [ ] `finishSession` 真正写库（UPDATE training_sessions）
- [ ] `saveTradeAction` 真正写库（INSERT trade_actions）
- [ ] 刷新页面后，历史 session 和复盘数据仍在（IndexedDB 持久化）
- [ ] `npx vitest run` 全过，`npx tsc -b --noEmit` 通过

---

## 阶段 4：完整横竖屏 UI（design §7）

**目标**：把 design §7 的完整布局落地——6 处优化（MA 均线/快捷份额/4 指标条等）+ 完整的横竖屏自适应。

**预估**：4-5 天

### 4.1 当前 UI 状态

阶段 2b-2 只做了**基础响应式框架**（`BlindTrainingWorkbench.css` 末尾的 3 个 @media 块）：
- 移动端取消 max-width，全宽铺满
- 竖屏上下堆叠 + 底部固定动作区
- 横屏左右分栏

但 design §7.3 的 **6 处优化都还没做**：

| # | 优化 | 当前状态 | 实现位置 |
| --- | --- | --- | --- |
| ① | 顶部进度条（训练进度可视化） | 未实现 | 工作台 JSX + CSS |
| ② | 4 指标信息条（资金/浮盈/仓位%/胜率%） | 部分有（profile-bar 显示资金/盈亏） | 工作台 JSX |
| ③ | K 线加 MA5/MA10 均线（黄/紫） | 未实现 | klinecharts 配置 |
| ④ | 当前价格标签（图左上角实时显示） | 未实现 | K 线图组件 |
| ⑤ | 持仓卡片 + 横滑日志 | 未实现 | 工作台 JSX + CSS |
| ⑥ | 快捷份额 + 按钮带数量 | 未实现 | 工作台 JSX |

### 4.2 实现要点

#### 4.2.1 MA 均线（③）

klinecharts 原生支持 MA。在工作台的 K 线图初始化处加：

```typescript
// 参考写法（具体 API 看 klinecharts 文档）
chart.createIndicator('MA', false, { id: 'candle_pane' })
// 配置 MA5（黄）+ MA10（紫）
```

需要在 K 线数据里带上计算 MA 所需的历史数据（当前 sampler 已返回足够长的 K 线，260 根够算 MA10）。

#### 4.2.2 快捷份额（⑥）

工作台的买入按钮区，加一排份额选择按钮（25%/50%/75%/全仓）。点击后计算具体股数，按钮文字显示"买入 500 股"。

参考 design §7.1 的布局图。需要改 `BlindTrainingWorkbench.tsx` 的 JSX + 加 state（selectedRatio）。

#### 4.2.3 横竖屏布局完善

当前的基础 CSS 可能和工作台的实际 JSX 结构不完全匹配。需要：

1. 读 `BlindTrainingWorkbench.tsx` 确认实际的 DOM 结构和 class 名
2. 针对实际的 class 写精确的横竖屏样式
3. 手机 DevTools 切换设备实测

**关键**：design §7.4 的桌面特性迁移（hover→长按、左侧栏→底部 Tab、多栏→堆叠）也要处理。

### 4.3 阶段 4 完成标准

- [ ] K 线图显示 MA5/MA10 均线
- [ ] 买入区有快捷份额选择（25/50/75/全），按钮显示具体股数
- [ ] 4 指标信息条（资金/浮盈/仓位%/胜率%）显示完整
- [ ] 顶部有训练进度条
- [ ] 手机 DevTools 切换横竖屏，布局正确自适应
- [ ] `npx tsc -b --noEmit` 通过，`npm run build` 成功

---

## 阶段 5：部署 + 手机测试

**目标**：把 PWA 部署到 HTTPS，手机上"添加到主屏幕"，真实环境验证。

**预估**：1-2 天

### 5.1 部署选项

| 平台 | 费用 | 特点 |
| --- | --- | --- |
| **Vercel**（推荐） | 免费 | `vercel` 一键部署，自动 HTTPS，CDN |
| Cloudflare Pages | 免费 | 类似 Vercel，国内访问稍好 |
| GitHub Pages | 免费 | 但 builtin-100.sqlite 17MB 可能超限 |
| 自有服务器 + nginx | 看情况 | 完全可控 |

**推荐 Vercel**：

```bash
cd /Users/xudan/Documents/trae_projects/blind-trainer-mobile
npm i -g vercel
vercel  # 按提示操作，选默认即可
```

部署后会得到一个 `https://xxx.vercel.app` 地址。

### 5.2 部署前检查清单

- [ ] `npm run build` 成功，`dist/` 含 sql-wasm.wasm + builtin-100.sqlite + sw.js
- [ ] `vite.config.ts` 的 `base` 配置正确（如果部署到子路径需要改）
- [ ] `manifest.webmanifest` 的 `start_url` 和 `icons` 路径正确
- [ ] service worker 的 `maximumFileSizeToCacheInBytes` ≥ 30MB（已配）

### 5.3 手机测试步骤

#### iOS（Safari）
1. 手机 Safari 打开部署地址
2. 分享 → 添加到主屏幕
3. 桌面出现"盲训"图标，点击进入（无地址栏，全屏）
4. 验证：能抽签、K 线渲染、买卖、结算
5. 关闭 WiFi/4G，再次打开 → 验证离线可用（service worker 缓存）

#### Android（Chrome）
1. Chrome 打开部署地址
2. 菜单 → 添加到主屏幕 / 安装应用
3. 同上验证

#### 关键验证点
- [ ] 首次加载：下载 builtin-100.sqlite（17MB）+ wasm，显示加载进度
- [ ] 二次加载：从 IndexedDB 秒开（不再下载）
- [ ] 离线可用：断网后仍能训练
- [ ] 横竖屏切换布局正确
- [ ] iOS Safari 的 IndexedDB 配额未超（64GB 设备约 4-6GB，当前最大 588MB，安全）

### 5.4 已知风险与处理

| 风险 | 处理 |
| --- | --- |
| iOS Safari PWA 后台行为不稳定 | 训练工具"打开即用"，不依赖后台 |
| 首次加载 17MB 较慢 | 加 loading 动画；后续可考虑分包（builtin-100 拆更小） |
| Vercel 国内访问可能慢 | 备选 Cloudflare Pages 或国内 CDN |

### 5.5 阶段 5 完成标准

- [ ] PWA 部署到 HTTPS，可公开访问
- [ ] iOS + Android 都能"添加到主屏幕"
- [ ] 手机上能完整训练一局
- [ ] 离线可用
- [ ] 横竖屏布局正确

---

## 附：新 session 快速启动检查

新 session 开始时，依次执行确认环境：

```bash
cd /Users/xudan/Documents/trae_projects/blind-trainer-mobile

# 1. 确认在 mobile 分支
git branch --show-current  # 应输出 mobile

# 2. 确认工作区干净
git status --short  # 应为空

# 3. 拉最新（如果远程有更新）
git pull --rebase 2>/dev/null || echo "远程同步失败（网络问题，可忽略，本地已是最新）"

# 4. 验证基线
npx vitest run 2>&1 | tail -4   # 应全过（55+ 测试）
npx tsc -b --noEmit; echo "tsc: $?"  # 应为 0

# 5. 本地验证 PWA 能跑
npm run dev
# 浏览器打开 http://localhost:5173，确认工作台渲染
```

如果以上都正常，按本文档的「阶段 3」开始工作。

---

## 附：相关文档索引

| 文档 | 位置 |
| --- | --- |
| 总设计（PWA 迁移） | `docs/superpowers/specs/2026-06-18-electron-to-pwa-migration-design.md` |
| 阶段 1 plan（数据精简） | `docs/superpowers/plans/2026-06-18-pwa-data-shrink-plan.md` |
| 阶段 2a plan（骨架+sql.js） | `docs/superpowers/plans/2026-06-19-pwa-skeleton-sqljs-plan.md` |
| 阶段 2b-1 plan（盲训库+抽签） | `docs/superpowers/plans/2026-06-19-pwa-blinddb-sampler-plan.md` |
| 阶段 2b-2 plan（webApi+工作台） | `docs/superpowers/plans/2026-06-19-pwa-webapi-workbench-plan.md` |
| main 版参考（盲训库/复盘逻辑） | `src/main/blindDb.ts`、`src/main/ipc/data.ts` |
| IPC 类型定义 | `src/types/ipc.ts` |
| 数据包说明 | `docs/web-data-packs.md` |
