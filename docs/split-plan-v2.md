# 拆分方案 v2 — 两个独立 App + 共享 data-foundation 包

> 取代 [monorepo-init.md](monorepo-init.md) 和 [menu-bar-app-spec.md](menu-bar-app-spec.md)。
> 生成日期：2026-06-13。

---

## 0. 一句话

把"盲训工作台"从现有 macOS 平台型 App 中**拆出为独立的 macOS App**（面向 C 端散户），
原 App 保留为"量化研究"工具（面向研究员）。两者通过 **data-foundation npm 包共享代码**，
但**各自维护独立的 SQLite 数据文件**，不共享数据。

---

## 1. 为什么拆

| 维度 | 盲训 | 量化 |
| --- | --- | --- |
| 目标用户 | 个人交易者（散户） | 研究型用户（懂编程/因子） |
| 核心价值 | 盘感训练 + 结构化复盘 | 因子挖掘 + 模型训练 |
| 分发渠道 | 小红书 / 即刻（社交传播） | GitHub / HackerNews（技术圈） |
| 使用频率 | 高频短时（每天练盘） | 低频长时（周末跑模型） |
| 数据需求 | 日线（~500MB） | 日线 + 5m/15m（~8GB） |

依据：[BRD.md](BRD.md) §4 明确"两个子系统业务上相对独立"；
[blind.ts](../src/main/ipc/blind.ts) 全文不读量化表；盲训是一个完整闭环。

---

## 2. 架构

```
data-foundation (npm 包，代码共享)
├── schema/           建表 SQL + migration 数组
├── sync/             同步逻辑（syncDaily / sync15m）
│   └── sources/      sina / tencent / baostock
└── db/               连接管理（connect / WAL / busy_timeout）

盲训 App (blind-trainer)          量化 App (quant-researcher)
Electron + React                   Electron + React
~/Library/.../blind-trainer/       ~/Library/.../quant-researcher/
  blind.db                           stock-trading.db
  ├── stock_list                     ├── stock_list
  ├── kline_daily                    ├── kline_daily
  ├── training_sessions              ├── kline_5m / kline_15m
  ├── trade_actions                  ├── 14 张量化表
  ├── session_reviews                └── ...
  ├── training_profiles
  └── behavior_event
```

**关键原则**：包提供"做什么"（schema + 同步逻辑），App 决定"何时做"（触发时机）。

---

## 3. data-foundation 包的职责边界

| 在包里（代码共享） | 不在包里（各自独立） |
| --- | --- |
| `schema/kline_daily.sql` 建表定义 | 实际 .db 文件 |
| `migrations/` 迁移数组 | migration 执行时机 |
| `syncDaily(db, { codes, since })` | 是否定时触发 |
| `syncSources/sina.ts` 数据源适配 | 用户偏好（哪些股票） |
| `db.connect(path, { readonly })` | 路径配置 |
| `syncDaily` 的种子数据生成脚本 | 种子数据文件本身 |

---

## 4. 存储选型：继续 SQLite

不换 DuckDB / Parquet / Postgres。理由：

- K 线查询模式（按 code+date 范围扫描 + 偶尔批量写入）SQLite + WAL + 复合索引完全够用
- 已有 schema / 索引 / 同步代码，零迁移成本
- 换 DB 是"为不存在的问题做工程"

两个 .db 文件**完全独立**，不共享、不互锁、不冲突。

---

## 5. 盲训 App 种子数据策略

### 5.1 出地带种子（方案 A）

| 项 | 值 |
| --- | --- |
| 种子范围 | 2021-01 ~ 2026-06（5.5 年，覆盖一个完整牛熊周期） |
| 周期 | 仅日线 |
| 行数 | ~625 万行（5000 股 × 250 天 × 5 年） |
| 原始大小 | ~420MB |
| LZ4 压缩包 | ~180MB（App 内下载或打包进 Resources） |
| 覆盖行情 | 2021 见顶 → 2021-2024 调整熊 → 2024.9 V 反弹 → 2025-2026 修复 |

打包位置：
```
blind-trainer.app/Contents/Resources/seed/blind-seed.db.lz4
```

首次启动流程：
1. 检查 `~/Library/.../blind-trainer/blind.db` 是否存在
2. 不存在 → 解压种子到 userData
3. 跑一次 `syncDaily(db, { since: seedLastDate })` 补到最新
4. 存在 → 跳过

### 5.2 扩展历史数据（按年配置）

设置页 → 数据管理：

```
当前数据范围：2021 ~ 2026
┌─────────────────────────────────────┐
│  扩展历史数据                        │
│                                     │
│  年份：  ☑ 2020  ☑ 2019            │
│         ☑ 2018  ☐ 2017            │
│         ☐ 2016  ☐ 2015  ☐ 2014    │
│                                     │
│  预计下载：~80MB（2 年）             │
│  [开始扩展]                         │
└─────────────────────────────────────┘

[同步到最新]  增量同步到今天
```

数据源：baostock（免费、覆盖到 2014）。
扩展过程在后台跑，完成后弹通知，不打断训练。

---

## 6. 同步触发策略

| 触发方式 | 盲训 App | 量化 App |
| --- | --- | --- |
| 手动（设置页按钮） | ✅ 主力 | ✅ 辅助 |
| 启动检查 + 提示 | ✅ ">3 天未更新，是否刷新？" | ❌ |
| App 内定时 | ❌ C 端不需要 | ✅ 保留 auto-sync（15:15） |
| launchd / menu-bar 后台 | ❌ 砍掉 | ❌ 砍掉 |

**砍掉 menu-bar 的理由**：盲训独立后自带种子数据，不需要后台同步进程；量化保留现有 [auto-sync.ts](../src/main/services/auto-sync.ts) 内部定时即可。

---

## 7. 拆分路线图（精简 4 步）

| 步骤 | 内容 | 验证 |
| --- | --- | --- |
| **S0** | DB 减肥 + 切分支 + 复制 DB | `./scripts/safe-refactor.sh start`；主库 20G→8G |
| **S1** | 抽 data-foundation 包 + 路径参数化 | 包能独立 `npm publish`；两个 App 都能引用 |
| **S2** | 创建 blind-trainer 工程 | 裁掉所有 `model/*`；盲训闭环能跑；行为事件表就位 |
| **S3** | 种子数据生成 + 打包 | `blind-seed.db.lz4` 产出；首次启动解压 + 增量同步正常 |

后续（暂缓，等产品验证）：
- 盲训独立后的 behavior_event 表（在盲训 App 内部实现，不进 data-foundation 包）
- 量化打标对照（用户反馈驱动再加，走 HTTP API 而非耦合 DB）
- Web 版 / iOS 版（复杂度超出当前需求，暂缓）

---

## 8. 砍掉的东西（相比 v1 方案）

| 砍掉 | 原因 |
| --- | --- |
| menu-bar 同步进程 | 盲训自带种子不需要；量化保留 App 内定时 |
| 完整 monorepo（pnpm workspaces + Turbo） | 两个独立 git repo + 一个共享 npm 包更简单 |
| Web 版 | 复杂度超出当前需求 |
| 跨进程 flock 写锁 | 各自独立 .db 文件，不需要跨进程互斥 |
| behavior_event 进 data-foundation 包 | 放盲训 App 内部，不污染共享包 |
| 6 事件 5 SQL 的完整行为分析工具 | 盲训 App 内部按需建，先验证产品价值 |

---

## 9. 相关文档

- [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md) — 数据底座 schema（仍有效，§5/§6 已按独立 App 调整）
- [behavior-event-design.md](behavior-event-design.md) — 行为事件表设计（仍有效，在盲训 App 内实现）
- [safe-refactor.sh](../scripts/safe-refactor.sh) — 重构安全网脚本
- [agent-data-analyst.md](agent-data-analyst.md) — data-analyst agent 调研
- ~~[monorepo-init.md](monorepo-init.md)~~ — **已废弃**，被本文档取代
- ~~[menu-bar-app-spec.md](menu-bar-app-spec.md)~~ — **已废弃**，menu-bar 已砍掉
