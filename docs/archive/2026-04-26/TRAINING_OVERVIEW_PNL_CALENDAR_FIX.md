# 训练总览收益口径与训练日历可读性修复记录

**日期：** 2026-04-26

## 问题现象

1. `训练总览` 顶部深色汇总区显示亏损，但 `训练成果` 区域显示盈利（或相反），两者口径不一致。
2. `训练日历` 的方块偏小、对比不强；并且最近训练日期落在最右侧，扫读不方便。
3. 在中国时区下，日历日期有潜在“偏一天”的风险（使用 UTC 日期 key 会触发）。

## 根因

这是典型的“同一业务事实被多套派生字段维护”的问题：

1. `training_profiles.current_capital` 代表资金曲线的当前值（应当由最新会话 `final_capital` 决定）。
2. `training_profiles.total_pnl` 与 `训练成果` 过去更偏向“已实现盈亏累加”的口径（`SUM(realized_pnl)`），历史修复和复算后可能与资金曲线脱钩。
3. 历史上存在 `session_reviews.realized_pnl` 被复算更新，但 `training_sessions.final_capital` 没有同步更新的情况，导致“明细（复盘）”和“资金曲线/汇总”天然分叉。

## 修复

### 1) 后端：把资金曲线口径设为唯一真相

1. `recomputeAndSaveSessionReview` 在复算 review 后，会同步回写 `training_sessions.final_capital = initial_capital + recomputed_realized_pnl`，避免历史会话复算导致 `realized_pnl` 与 `final_capital` 不一致。  
   文件：`src/main/ipc/blind.ts`
2. `rebuildProfileAggregate` 的 `total_pnl` 统一改为 `current_capital - initial_capital`（资金曲线口径），避免 “账户卡片看资金曲线、盈亏标签看 realized 累加” 的冲突。  
   文件：`src/main/ipc/blind.ts`

### 2) 前端：所有汇总展示统一到资金曲线口径

1. 顶部深色汇总区的“盈亏”与 `训练成果` 的“累计盈亏”，统一使用 `activeProfile.current_capital - activeProfile.initial_capital`。
2. 会话列表、日历聚合等按每场会话收益时，优先使用 `final_capital - initial_capital` 计算收益/收益率（没有 `final_capital` 时才回退到原字段）。
   文件：`src/components/trading/TrainingOverview.tsx`

### 3) 日历：更易扫读 + 避免时区偏移

1. 周序列改为“最近在左”，避免最新训练落在最右下角不易观察。
2. 方块加大、描边增强、hover 提示更明显。
3. 日期 key 改用本地日期（而非 `toISOString()` 的 UTC），避免日历活动落在错误的日期格子上。
   文件：`src/components/trading/TrainingOverview.tsx`、`src/components/trading/TrainingOverview.css`

## 验证

1. `训练总览` 顶部汇总的盈亏与 `训练成果` 的累计盈亏一致（同一口径：资金曲线）。
2. 账户 `total_pnl` 与 `current_capital - initial_capital` 一致。
3. `训练日历` 最近日期出现在左侧，方块更清晰；本地时区下日期不偏移。

