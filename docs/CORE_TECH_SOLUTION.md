# 盲训 App 核心技术方案

**版本：** v2.0（拆分后重写）
**状态：** 当前实现对应方案
**日期：** 2026-06-14

## 0. 关于本文档

本文档服务于**盲训独立 App**（仓库 [summercx1988/blind-trainer](https://github.com/summercx1988/blind-trainer)）。

历史归档见 [archive/](archive/)。

---

## 1. 设计原则

1. **信息遮蔽** — Renderer 永远拿不到"未来 K 线"
2. **不自动同步** — 行情库只跟用户手动
3. **本地优先** — 所有数据本地 SQLite，不上云
4. **可复现** — 给定起点 + K 线序列，结果可重放
5. **可量化** — 每个动作 / 收益可被记录与统计

## 2. 关键技术决策

### 2.1 渲染层 K 线分片传输

**问题**：如果把整段 K 线（比如 1530 根）一次传给 Renderer，前端 store 缓存后就能"偷看"未来。

**方案**：
- Main 端维护 `current_bar_index`
- 每次 `advanceBar` IPC，Main 返回**当前及之前**的 K 线数组
- 复盘阶段（`endSession`）才返回 `current_idx+1..end` 段
- Renderer 端 **store 不缓存未揭示 K 线**

**代码**：[src/main/ipc/blind.ts](../src/main/ipc/blind.ts) `advanceBar` / `endSession` handler。

### 2.2 行情库种子加载

**问题**：用户首次启动时数据库是空的，需要拉数据。如果走网络同步会非常慢（几千只股票 × 5 年日线）。

**方案**：
- 打包 `data/blind-seed.db`（735MB，597 万行日线）
- 首次启动检测到 seed + userData 空 → 直接复制 seed 到 userData
- 复制过程约 30 秒（SSD），远比网络拉取快

**代码**：[src/main/services/seed-loader.ts](../src/main/services/seed-loader.ts)。

### 2.3 关闭 auto-sync

**问题**：自动同步行情会污染"训练中的 K 线边界"。

**方案**：
- 注释掉 [src/main/index.ts](../src/main/index.ts) 中的 `startAutoSync()`
- 用户需要更新行情时，进入「数据管理」页手动点击

**commit**：`2a93311 refactor: 关闭盲训 App auto-sync`

### 2.4 数据隔离

**方案**：
- 盲训 `package.json` name = `blind-trainer`
- userData 路径 = `~/Library/Application Support/blind-trainer/`
- 行情库 = userData + `/stock-trading.db`
- 与其他 App 的 userData 隔离（路径由 `name` 决定）

### 2.5 随机起点抽取

**问题**：怎么保证起点是真随机？避免用户"刷出好牌"。

**方案**：
- 起点 = (随机 code, 随机 start_date)
- code 从 `stock_list` 等概率抽
- start_date 从 [2020-01-02, 2026-04-28] 等概率抽
- 后续 60 个交易日作为训练区间
- 服务端不记忆用户偏好（每次都是独立随机）

**代码**：[src/main/ipc/blind.ts](../src/main/ipc/blind.ts) `startSession` handler。

## 3. 性能要点

| 场景 | 性能要求 | 实现方式 |
| --- | --- | --- |
| 首次启动 + 种子加载 | < 60s | 直接复制 SQLite 文件 + WAL 模式 |
| 行情查询（单股全段） | < 100ms | `(code, trade_date)` 复合主键 + 索引 |
| 训练会话启动 | < 500ms | 内存预热 stock_list，K 线 lazy 加载 |
| 推进一根 K 线 | < 50ms | 只查 [start, current] 段 |
| 复盘 | < 200ms | 一次性查后续段，前端图表渲染 |

## 4. 安全 / 边界

| 维度 | 边界 |
| --- | --- |
| **网络访问** | 行情同步（手动触发） |
| **文件系统** | 仅 userData + `data/blind-seed.db` |
| **数据库写入** | 仅 Main 进程可写，Renderer 只读 |
| **跨进程** | 严格走 `contextBridge`，不暴露 node 模块 |
| **用户数据** | 一切本地，不上云 |

## 5. 已知约束 / 后续优化

| 约束 | 现状 | 后续方向 |
| --- | --- | --- |
| K 线只有日线 | 无 15m / 5m | 训练节奏允许后续扩展 |
| 单机本地 | 无多端同步 | 暂不需要（"盲"训是单兵训练） |
| 行情库只手动同步 | 风险：忘记更新 | 后续加"启动时提示数据陈旧度" |
| 不支持多用户档案 | 单用户 | 待产品验证后增加 |

## 6. 历史

历史背景（早期归档）见 [archive/](archive/)。

## 7. 相关文档

- 业务：[BRD.md](BRD.md)
- 架构：[ARCHITECTURE.md](ARCHITECTURE.md)
- 数据 schema：[data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md)
- 行为事件表：[behavior-event-design.md](behavior-event-design.md)
- AI 协作规约：[AGENTS.md](../AGENTS.md)
