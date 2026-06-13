# 行为事件表设计 v0.1

> 状态：草案 v0.1
> 目的：在盲训库新增 `behavior_event` 表，记录用户训练过程中的细粒度行为，用于"分析用户交易习惯的好与差"
> 范围：盲训子系统（macOS 平台型内嵌 + 未来 Web 版）
> 设计原则：可降级、可回放、隐私可脱敏

---

## 0. 背景与目标

用户原话："盲训工作台后续的工作重点在于分析用户的交易习惯的好与差。"

现状盲训库只记录：

- `trade_actions`：用户实际下单（buy/sell/hold/skip）
- `session_reviews`：会话结束后的统计指标（胜率、收益率、回撤等）

**缺什么**：

- 用户**何时**打开决策面板（停留多久）
- 用户**是否**反复查看某根 K 线（犹豫）
- 用户**是否**回退到历史（向前看）
- 用户**如何**缩放图表（注意力热点）
- 用户的**键鼠偏好**（键盘流 vs 鼠标流）

有了 `behavior_event`，才能回答"决策习惯的好与差"，而不只是"结果的好与差"。

---

## 1. 数据流

```
[Renderer: BlindTrainingWorkbench]
  ↓ useBehaviorTracker() hook
[Preload: window.electronAPI.behavior.track(event)]
  ↓ IPC invoke
[Main: behavior Ipc]
  ↓ 批量写（每 5s flush）
[盲库 behavior_event 表]
  ↓ 离线分析（v0.2 Web Dashboard）
```

约束：

- 行为上报**不影响**主流程性能（异步、批量、错误吞掉）
- **失败可降级**：上报失败不阻塞用户操作
- **可关闭**：用户可在偏好里关闭"行为采集"开关

---

## 2. 表 schema

```sql
CREATE TABLE IF NOT EXISTS behavior_event (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  profile_id          TEXT NOT NULL DEFAULT 'default',
  bar_index           INTEGER,                        -- 行为发生时的 K 线索引（盲训世界）
  event_type          TEXT NOT NULL,                  -- session / decide / view / review / control / profile / lifecycle
  event_subtype       TEXT,                           -- view_open / confirm / cancel / zoom_in ...
  occurred_at_ms      INTEGER NOT NULL,               -- 客户端时间戳（毫秒）
  server_received_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  duration_ms         INTEGER,                        -- 持续时长（ms），session.start 不填
  input_source        TEXT,                           -- keyboard | mouse | shortcut | auto | system
  payload_json        TEXT NOT NULL DEFAULT '{}',
  client_seq          INTEGER,                        -- 客户端事件序号（用于乱序检测）
  app_version         TEXT,                           -- 盲训模块版本
  created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (session_id) REFERENCES training_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_behavior_session_time
  ON behavior_event(session_id, occurred_at_ms);

CREATE INDEX IF NOT EXISTS idx_behavior_profile_type_time
  ON behavior_event(profile_id, event_type, occurred_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_behavior_session_subtype
  ON behavior_event(session_id, event_subtype, occurred_at_ms);

CREATE INDEX IF NOT EXISTS idx_behavior_type_subtype_time
  ON behavior_event(event_type, event_subtype, occurred_at_ms DESC);
```

### 2.1 字段说明

| 字段                  | 必填 | 说明                                                                                  |
| --------------------- | ---- | ------------------------------------------------------------------------------------- |
| `id`                  | ✓    | UUID 字符串                                                                          |
| `session_id`          | ✓    | 关联 [blindDb.ts:11-27](src/main/blindDb.ts#L11-L27) `training_sessions.id`            |
| `profile_id`          | ✓    | 关联 `training_profiles.id`，方便多 profile 横向对比                                  |
| `bar_index`           | △    | 行为发生时的 K 线索引；非训练中的事件（如 `lifecycle.app_start`）留空                 |
| `event_type`          | ✓    | 7 种枚举：`session` / `decide` / `view` / `review` / `control` / `profile` / `lifecycle` |
| `event_subtype`       | △    | 自由文本；推荐用下划线分隔的命名（`view_open` / `confirm` / `zoom_in`）               |
| `occurred_at_ms`      | ✓    | 客户端时间戳（毫秒）                                                                  |
| `server_received_at`  | ✓    | 服务端落库时间（秒）；可与客户端对比检测时钟漂移                                      |
| `duration_ms`         | △    | 该事件的持续时长（面板打开到关闭、缩放按下到松开）                                    |
| `input_source`        | △    | 触达该事件的输入通道                                                                  |
| `payload_json`        | ✓    | 自由 JSON；按 event_subtype 约定字段                                                  |
| `client_seq`          | △    | 客户端单调递增序号；用于检测漏报与重排                                                |
| `app_version`         | △    | 写库时的应用版本；方便后续按版本切片分析                                              |

### 2.2 命名约定

延续 [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md)：

- `snake_case`
- TEXT PK / INTEGER 时间
- JSON 走 `*_json` 后缀
- 枚举走 CHECK（v0.1 暂不写 CHECK，方便新增 subtype；v0.2 收紧）
- 索引 `idx_behavior_<scope>_<col1>[_<col2>...]`

---

## 3. MVP 6 个事件

> v0.1 只采这 6 个；其余放进 v0.2 backlog

| #   | event_type | event_subtype | 触发时机                                       | 关键 payload 字段                                   |
| --- | ---------- | ------------- | ---------------------------------------------- | --------------------------------------------------- |
| 1   | `session`  | `start`       | 新建 session（与 `db:saveSession` 同处）       | `{ sampleId, stockCode, intervalType }`            |
| 2   | `session`  | `finish`      | `finishSession` 完成                           | `{ reason: 'manual' \| 'auto_end' \| 'latest_end' \| 'skip' \| 'switch', finalPnl, totalActions }` |
| 3   | `decide`   | `view_open`   | 决策面板打开（用户进入"看 K 线 → 下决定"区间） | `{ barIndex, panelType: 'buy' \| 'sell' \| 'hold' }` |
| 4   | `decide`   | `confirm`     | 决策确认（按 B/S/H 键 / 点确认按钮）           | `{ barIndex, actionType, hesitationMs }`            |
| 5   | `view`     | `zoom_in`     | 图表放大（按键 `+` / 滚轮）                    | `{ fromCount, toCount, barIndex }`                  |
| 6   | `view`     | `zoom_out`    | 图表缩小                                        | `{ fromCount, toCount, barIndex }`                  |

### 3.1 关键 hook 点（参考 [BlindTrainingWorkbench.tsx](src/components/trading/BlindTrainingWorkbench.tsx)）

| 事件             | 现有代码锚点                                                |
| ---------------- | ----------------------------------------------------------- |
| `session.start`  | 跟随 [BlindTrainingWorkbench.tsx:689-780](src/components/trading/BlindTrainingWorkbench.tsx#L689-L780) `runAction` 的 session 启动 |
| `session.finish` | [BlindTrainingWorkbench.tsx:403-504](src/components/trading/BlindTrainingWorkbench.tsx#L403-L504) `finishSession` |
| `decide.view_open` | 决策面板挂载 `useEffect` mount/unmount                      |
| `decide.confirm` | `runAction(actionType)` 调用点                              |
| `view.zoom_in/out` | [BlindTrainingWorkbench.tsx:1151-1152](src/components/trading/BlindTrainingWorkbench.tsx#L1151-L1152) `setVisibleCount` |

### 3.2 关键 payload 字段解释

- `hesitationMs`（`decide.confirm` 必带）：从 `view_open` 到 `confirm` 的毫秒数；用于识别"果断" vs "犹豫"
- `fromCount` / `toCount`（`view.zoom_*`）：可见 K 线根数变化；用于识别注意力焦点

---

## 4. 上报 payload 模板

### 4.1 `decide.view_open` 模板

```json
{
  "id": "evt_uuid",
  "session_id": "sess_xxx",
  "profile_id": "default",
  "bar_index": 42,
  "event_type": "decide",
  "event_subtype": "view_open",
  "occurred_at_ms": 1717382500123,
  "input_source": "auto",
  "payload_json": {
    "panelType": "buy",
    "trigger": "auto_reach_decision_bar"
  }
}
```

### 4.2 `decide.confirm` 模板

```json
{
  "id": "evt_uuid",
  "session_id": "sess_xxx",
  "profile_id": "default",
  "bar_index": 42,
  "event_type": "decide",
  "event_subtype": "confirm",
  "occurred_at_ms": 1717382507123,
  "duration_ms": 7000,
  "input_source": "keyboard",
  "payload_json": {
    "actionType": "buy",
    "hesitationMs": 7000,
    "keyboardKey": "B",
    "shares": 100,
    "price": 12.34
  },
  "client_seq": 17
}
```

---

## 5. 5 个分析 SQL 样例

> 这些 SQL 是 v0.2 Web Dashboard 的核心 query；v0.1 在文档里先固化逻辑

### 5.1 决策犹豫分布

```sql
-- 统计每个 session 的"从面板打开到确认"的耗时分布
SELECT
  session_id,
  MIN(hesitation) AS min_hesitation_ms,
  AVG(hesitation) AS avg_hesitation_ms,
  MAX(hesitation) AS max_hesitation_ms,
  COUNT(*) AS total_decisions
FROM (
  SELECT
    open.session_id,
    open.bar_index,
    (confirm.occurred_at_ms - open.occurred_at_ms) AS hesitation
  FROM behavior_event open
  JOIN behavior_event confirm
    ON open.session_id = confirm.session_id
   AND open.bar_index = confirm.bar_index
   AND open.event_type = 'decide'
   AND open.event_subtype = 'view_open'
   AND confirm.event_type = 'decide'
   AND confirm.event_subtype = 'confirm'
  WHERE open.session_id = ?
)
GROUP BY session_id
ORDER BY avg_hesitation_ms DESC;
```

### 5.2 误判高发区（开仓即亏损的 K 线区段）

```sql
-- 找出"决策确认后 N 根 K 线就出现反向信号"的 bar_index 段
SELECT
  ta.session_id,
  ta.bar_index AS decision_bar,
  ta.action_type,
  sr.realized_pnl,
  COUNT(CASE WHEN sr.realized_pnl < 0 THEN 1 END) OVER (
    PARTITION BY ta.session_id ORDER BY ta.bar_index
  ) AS loss_streak
FROM trade_actions ta
JOIN session_reviews sr ON sr.session_id = ta.session_id
WHERE ta.action_type IN ('buy', 'sell')
ORDER BY loss_streak DESC
LIMIT 50;
```

### 5.3 训练时间模式

```sql
-- 用户习惯在几点训练、训练多久
SELECT
  strftime('%H', datetime(occurred_at_ms / 1000, 'unixepoch')) AS hour_of_day,
  COUNT(DISTINCT session_id) AS sessions,
  AVG(duration_ms) / 1000.0 AS avg_session_minutes
FROM behavior_event
WHERE event_type = 'session'
  AND event_subtype = 'start'
  AND occurred_at_ms >= strftime('%s','now') - 30 * 86400
GROUP BY hour_of_day
ORDER BY hour_of_day;
```

### 5.4 注意力热点（缩放频次 × 区间收益）

```sql
-- 找出"被放大最多次"的 K 线区间，并对比其实际收益
WITH zoom_spots AS (
  SELECT
    session_id,
    bar_index,
    COUNT(*) AS zoom_count
  FROM behavior_event
  WHERE event_type = 'view'
    AND event_subtype IN ('zoom_in', 'zoom_out')
  GROUP BY session_id, bar_index
)
SELECT
  zs.session_id,
  zs.bar_index,
  zs.zoom_count,
  ta.action_type,
  ta.realized_pnl
FROM zoom_spots zs
LEFT JOIN trade_actions ta
  ON ta.session_id = zs.session_id
 AND ta.bar_index BETWEEN zs.bar_index - 2 AND zs.bar_index + 2
ORDER BY zs.zoom_count DESC
LIMIT 100;
```

### 5.5 复盘-实际对比（看用户训练后是否改善）

```sql
-- 同 profile 下，按训练时间分两半，看胜率是否提升
WITH ranked AS (
  SELECT
    session_id,
    started_at,
    NTILE(2) OVER (ORDER BY started_at) AS half
  FROM training_sessions
  WHERE profile_id = ?
),
agg AS (
  SELECT
    r.half,
    AVG(sr.trade_win_rate) AS avg_win_rate,
    AVG(sr.realized_pnl_pct) AS avg_pnl_pct
  FROM ranked r
  JOIN session_reviews sr ON sr.session_id = r.session_id
  GROUP BY r.half
)
SELECT * FROM agg;
```

---

## 6. 与现有 `labels` 表的关系

| 维度       | `labels`                                              | `behavior_event`                                 |
| ---------- | ----------------------------------------------------- | ------------------------------------------------ |
| 写入者     | 决策审核流程（手动 + 模型）                           | 客户端 hook 自动                                 |
| 数据语义   | "这次决策的标签是什么"（buy/sell/hold/no_action）     | "这次决策的过程数据"（犹豫、缩放、停留）        |
| 时间粒度   | 会话级（少量行）                                      | 事件级（数十到数百行/session）                   |
| 写库       | 走 `db:saveLabel`（盲库，[modelDbLabelingIpc.ts:32-58](src/main/ipc/modelDbLabelingIpc.ts#L32-L58)） | 新增 `behavior:track` 写盲库     |
| 读库       | 量化候选审核                                          | 行为分析 v0.2                                    |

两表不重复；`labels` 表达"结果"，`behavior_event` 表达"过程"。

---

## 7. 隐私与脱敏

- **可选开关**：在 `app_preferences` 新增 `behavior_tracking_enabled`（默认 `1`）
- **不存**：股票代码对应的实际股票名称盲训前已经脱敏（[samples.anonymize_level](src/main/db.ts#L391-L405)）；`behavior_event` 不再额外打码
- **本地存储**：行为数据全在用户本地，不上传
- **导出**：v0.2 提供"导出我的行为数据"功能（CSV），用户可自决
- **删除**：在偏好里"清空行为数据"按钮 = `DELETE FROM behavior_event WHERE profile_id = ?`

---

## 8. 性能与存储

### 8.1 容量估算

- 假设每个 session 100 个事件 × 200 字节 = 20KB
- 1000 个 session ≈ 20MB
- 10 万 session ≈ 2GB

### 8.2 写入性能

- 批量写：每 5s flush 一次（积攒的事件合并成一次 INSERT）
- 失败重试：最多 3 次，写不进去就丢到本地日志
- 索引开销：`idx_behavior_session_time` / `idx_behavior_profile_type_time` 在百万行下 INSERT 约 5ms 内

### 8.3 读取性能

- 95% 查询命中 `idx_behavior_session_time`（session 内按时间范围）
- 5% 查询命中 `idx_behavior_profile_type_time`（跨 session 同类型）
- v0.2 Web 端聚合查询走预计算（定时物化 `behavior_daily_agg` 表）

---

## 9. 上线节奏

| 周次  | 内容                                                                          |
| ----- | ----------------------------------------------------------------------------- |
| W0    | 文档 review（本文）                                                          |
| W1    | `behavior_event` 表 + migration 加到盲库；schema 文档同步                     |
| W2    | 客户端 `useBehaviorTracker` hook 写完，绑定 6 个事件点                       |
| W3    | `behavior:track` IPC + 批量 flush 写库；开关埋点                              |
| W4    | 内测 1 周：盲训 50 个 session 跑通                                            |
| W5    | 5 个分析 SQL 写成 view / 物化表；Web Dashboard 雏形                            |
| W6    | 用户文档：行为分析与复盘对照表发布                                            |

---

## 10. 相关链接

- 拆分总览：[docs/monorepo-init.md](monorepo-init.md)
- Schema 契约：[docs/data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md)
- Menu Bar 规格：[docs/menu-bar-app-spec.md](menu-bar-app-spec.md)
- 项目规则：[.trae/rules/project_rules.md](.trae/rules/project_rules.md)
- 盲训工作台入口：[src/components/trading/BlindTrainingWorkbench.tsx](src/components/trading/BlindTrainingWorkbench.tsx)
