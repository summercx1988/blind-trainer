# Menu Bar 同步进程规格 v0.1

> **⚠️ 已废弃（superseded）**：menu-bar 同步进程方案已被砍掉。
> 原因：盲训 App 拆分后自带种子数据，不需要后台同步进程；量化 App 保留 App 内定时同步即可。
> 详见 [split-plan-v2.md](split-plan-v2.md) §6/§8。
> 本文档仅作历史参考保留。

> 状态：草案 v0.1
> 目标：从 macOS 平台型 App 内嵌的 auto-sync 抽离为独立 Menu Bar App，承担"每日 15:15 定时同步 + 实时状态展示"职责
> 现状参考：[src/main/services/auto-sync.ts](src/main/services/auto-sync.ts) / [src/main/services/market-data.ts](src/main/services/market-data.ts) / [src/main/marketDb.ts](src/main/marketDb.ts)

---

## 0. 目的与范围

| 维度     | 现状（嵌在 Electron 主 App 内）                                                    | 目标（独立 Menu Bar App）                                       |
| -------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 触发时机 | 主 App 打开后才启动（[src/main/index.ts:225](src/main/index.ts#L225)）              | 用户登录 macOS 后即驻留                                         |
| 单实例   | 进程内单例（`timer` 变量）                                                         | macOS 单实例锁（`requestSingleInstanceLock`）                   |
| 跨进程   | 不存在                                                                              | 量化 App / 盲训 App 都能通过 HTTP+SSE 订阅状态                 |
| 写锁     | 无                                                                                 | `flock(2)` 写锁协调三进程                                       |
| 通知     | 主 App `BrowserWindow` webContents.send（[auto-sync.ts:246-248](src/main/services/auto-sync.ts#L246-L248)） | 系统通知 + Tray 菜单 + SSE 推送                                |

**不**做：

- 不做 UI 主窗口（仅 Tray）
- 不做 Web 服务对外暴露
- 不替代量化 App 的 UI 行为（信号展示、回测、模型训练）

---

## 1. 进程模型

### 1.1 启动序列

```ts
// apps/menu-bar/src/main/index.ts
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => rebuildTrayMenu())

app.whenReady().then(async () => {
  app.dock?.hide()                       // 隐藏 Dock 图标
  app.setLoginItemSettings({ openAtLogin: true })  // 开机启动

  const gotLock = await acquireDbWriteLock()       // flock(2) 写锁
  if (!gotLock) {
    rebuildTrayMenu({ status: 'error', reason: 'lock_busy' })
    return
  }

  startHttpServer({ port: 47821, host: '127.0.0.1' })
  createTray()
  startAutoSync()                              // 沿用 [auto-sync.ts](src/main/services/auto-sync.ts) 逻辑
})

app.on('window-all-closed', (e: Electron.Event) => e.preventDefault())
```

### 1.2 关键模块

| 模块                  | 职责                                                  | 现状对应                                          |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `tray.ts`             | 构建 Tray 菜单、显示状态图标                          | [auto-sync.ts:236-249](src/main/services/auto-sync.ts#L236-L249) |
| `lock.ts`             | `flock(2)` 写锁、锁过期检测                           | **新增**                                          |
| `http/server.ts`      | 暴露 `/status`、`/sync`、`/events` 路由              | **新增**                                          |
| `http/sse.ts`         | Server-Sent Events 推送同步状态                       | **新增**                                          |
| `scheduler/auto-sync.ts` | 5min tick + 15:15-15:20 窗口触发                  | [auto-sync.ts:1-249](src/main/services/auto-sync.ts) |
| `services/market-data.ts` | 重用现有 MarketDataService（移到 packages/data-foundation） | [market-data.ts](src/main/services/market-data.ts) |
| `db.ts`               | 重用 db.ts（移到 packages/data-foundation）          | [src/main/db.ts](src/main/db.ts)                  |

### 1.3 与量化 App / 盲训 App 的协作

- 量化 App 与盲训 App **不**直接调 SQLite 写 DB；都通过 Menu Bar App 的 HTTP API 触发同步、读取状态
- 量化 App 在主窗口显示行情数据时，仍可走 `readonly: true` 打开 DB（参考 [marketDb.ts:79](src/main/marketDb.ts#L79)）
- 盲训 App（Web 版）通过 HTTP 调同步

---

## 2. 状态展示矩阵

Tray 菜单第一层（用户可见）：

| 全局状态 | Tray 图标            | 标题文字               | 菜单项                                                         |
| -------- | -------------------- | ---------------------- | -------------------------------------------------------------- |
| `idle`   | 灰色圆点             | `行情同步 · 空闲`      | 立即同步 / 打开量化 App / 打开盲训 App / 退出                  |
| `syncing`| 蓝色圆点 + 旋转      | `行情同步 · 进行中`    | 同步详情（股票 X/Y）/ 取消同步 / 打开量化 App / 退出            |
| `ok`     | 绿色圆点             | `行情同步 · 已完成`    | 上次同步：YYYY-MM-DD HH:mm / 立即同步 / 打开量化 App / 退出      |
| `error`  | 红色圆点             | `行情同步 · 异常`      | 错误信息（最近一次失败的 message）/ 立即同步 / 查看日志 / 退出  |

子菜单"同步详情"（debug 模式）：

- 当前队列：股票代码列表 + 已完成/总数
- 上次同步耗时
- 上次同步 API 成功率（按 source 拆：sina / tencent / baostock）
- 错误日志前 20 条

---

## 3. HTTP 接口契约

监听 `127.0.0.1:47821`（**默认端口；可通过环境变量 `MENU_BAR_HTTP_PORT` 覆盖；仅本机绑定**）。所有响应为 JSON，错误统一为 `{"error": "code", "message": "..."}`。

> 端口 47821 选自 "MBar" (Menu Bar) 的 T9 映射（4=M/7=P/8=B/2=A/1=R 不通；选用一个易记且未被 IANA 注册冲突的端口）。

### 3.1 `GET /api/v1/status`

返回当前全局状态：

```json
{
  "status": "syncing",
  "scope": "market",
  "lastOkAt": 1717382400,
  "lastRunAt": 1717382500,
  "currentJob": {
    "type": "incremental",
    "total": 5000,
    "done": 1234,
    "startedAt": 1717382500
  },
  "nextWindowAt": 1717425300
}
```

### 3.2 `POST /api/v1/sync/trigger`

手动触发一次同步：

```json
// request
{ "type": "incremental" | "full" | "backfill_15m", "codes": ["000001.SZ"] }

// response
{ "jobId": "job_1717382500_xxxx", "acceptedAt": 1717382500 }
```

### 3.3 `GET /api/v1/sync/jobs/:id`

查询任务进度：

```json
{ "jobId": "...", "status": "running|ok|error", "done": 1234, "total": 5000, "errorMessage": null }
```

### 3.4 `GET /api/v1/events` （SSE）

订阅实时事件流：

```
event: sync.started
data: {"jobId":"job_xxx","type":"incremental","total":5000}

event: sync.progress
data: {"jobId":"job_xxx","done":1234,"total":5000}

event: sync.completed
data: {"jobId":"job_xxx","stocks":5000,"daily":4980,"m15":4800}

event: sync.failed
data: {"jobId":"job_xxx","errorMessage":"sina rate limit"}
```

### 3.5 `GET /api/v1/health`

健康检查（量化 App 启动时调用）：

```json
{ "ok": true, "uptimeSec": 86400, "version": "0.1.0" }
```

### 3.6 鉴权

- 监听 `127.0.0.1`（不暴露 `0.0.0.0`）
- 启动时生成随机 token，写入 `<userData>/menu-bar.token`
- HTTP header：`X-Menu-Bar-Token: <token>`
- 量化 App 启动时读 token 文件

---

## 4. 文件结构（推荐）

```
apps/menu-bar/
├── package.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts                  # 入口：单实例 + tray + http + scheduler
│   │   ├── tray.ts
│   │   ├── lock.ts                   # flock(2) 包装
│   │   ├── http/
│   │   │   ├── server.ts
│   │   │   ├── sse.ts
│   │   │   ├── routes/
│   │   │   │   ├── status.ts
│   │   │   │   ├── sync.ts
│   │   │   │   ├── events.ts
│   │   │   │   └── health.ts
│   │   │   └── auth.ts
│   │   ├── scheduler/
│   │   │   └── auto-sync.ts          # 从 [auto-sync.ts](src/main/services/auto-sync.ts) 抽出
│   │   └── logger.ts
│   └── preload/
│       └── index.ts                  # 给"控制面板"窗口用（可选）
└── assets/
    ├── tray-idle.png
    ├── tray-syncing.png
    ├── tray-ok.png
    └── tray-error.png
```

---

## 5. 与现状的对照（关键代码片段）

### 5.1 启动入口（从 [src/main/index.ts:204-226](src/main/index.ts#L204-L226) 抽出）

```ts
// 现状：主 App 启动后才跑 auto-sync
app.whenReady().then(async () => {
  const { needed, reason } = needsSeedUpgrade()
  if (!needed) getDb()
  registerIpcHandlers()
  createWindow()
  if (needed) { /* seed upgrade */ }
  startAutoSync()
})

// 目标：Menu Bar App 独立启动
app.whenReady().then(async () => {
  app.dock?.hide()
  if (!(await acquireDbWriteLock())) { rebuildTrayMenu({ status: 'error' }); return }
  startHttpServer({ port: 47821, host: '127.0.0.1' })
  createTray()
  startAutoSync()
  loadSeedIfNeeded()                // 同样的 seed 升级逻辑
})
```

### 5.2 同步调度（沿用 [auto-sync.ts:6-9, 117-167](src/main/services/auto-sync.ts#L6-L9)）

```ts
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const SYNC_HOUR = 15
const SYNC_MINUTE = 15
// 5min tick + 15:15-15:20 窗口检测，逻辑零修改
```

### 5.3 状态推送（替代 [auto-sync.ts:236-249](src/main/services/auto-sync.ts#L236-L249) 的 webContents.send）

```ts
function notifySyncComplete(type: string, stocks: number, daily: number, m15: number) {
  pushSseEvent('sync.completed', { type, stocks, daily, m15 })   // 替代 webContents.send
  new Notification({ title: '同步完成', body: `${stocks} 只股票` }).show()  // 沿用
  rebuildTrayMenu({ status: 'ok', summary: { stocks, daily, m15 } })
}
```

### 5.4 写锁（新增）

```ts
import { open as openLock } from 'proper-lockfile'

export async function acquireDbWriteLock(): Promise<boolean> {
  const lockFile = path.join(getUserDataRoot(), '.locks', 'stock-trading.db.lock')
  try {
    const release = await openLock(lockFile, {
      retries: { retries: 0, factor: 1, minTimeout: 100, maxTimeout: 100 },
      stale: 30_000
    })
    setLockRelease(() => release)
    return true
  } catch (err) {
    log.warn('failed to acquire db lock:', err)
    return false
  }
}
```

---

## 6. 4 阶段迁移路径

| 阶段 | 内容                                                                  | 验证                                                                 |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| M0   | 创建 `apps/menu-bar` 工程，引用 `packages/data-foundation`           | `npm run dev` 能启动；Tray 出现；`GET /api/v1/health` 返回 ok       |
| M1   | 把 [auto-sync.ts](src/main/services/auto-sync.ts) + [market-data.ts](src/main/services/market-data.ts) 移到 `apps/menu-bar` | 15:15 触发同步，DB 数据正常                                         |
| M2   | 量化 App 启动时改为读 `readonly: true`（参考 [marketDb.ts:79](src/main/marketDb.ts#L79)）；通过 HTTP 触发同步 | 量化 App 不再写 DB；同步仍能跑                                       |
| M3   | 盲训 App 引入"消费追踪 + 行为事件"（参考 [behavior-event-design.md](behavior-event-design.md)），同样走 HTTP 触发同步 | 三个进程并发跑不冲突；rollback 测试通过                              |

每一阶段完成后跑：

- `npx tsc -b --noEmit`（项目规则硬要求）
- `npm run lint`
- 安全网回退演练：`./scripts/safe-refactor.sh rollback`

---

## 7. 错误处理

| 场景                        | 行为                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| Menu Bar App 拿不到写锁     | Tray 红色 + 提示"已有进程在同步"，不抢锁                                          |
| 同步过程中 Menu Bar 崩溃   | 锁 30s 后自动释放（`stale: 30_000`）；其他进程接管时扫描 `dataset_policy_evaluations.id = 'auto_sync_meta'` 上次成功时间 |
| 量化 App 启动时 Menu Bar 未运行 | 走降级：自己执行 1d 增量同步；写锁失败则 `readonly: true` 打开                   |
| Web 盲训 App 跨网络调用     | 暂不支持（要求同一台机器）；后续 v0.2 加 reverse proxy + 鉴权                    |
| token 泄露                  | 重启 Menu Bar 重新生成；旧 token 立即失效                                          |

---

## 8. 安全与权限

- 仅监听 `127.0.0.1`（不暴露 LAN）
- token 每次启动轮换
- SSE 连接数限制：单进程最多 5 个并发订阅
- 日志脱敏：HTTP 请求体中不打印 `codes` 全量（仅打印前 10 个 + 总数）
- macOS 沙盒：v0.1 暂不申请 sandbox entitlement（保持现有 `Apple Events` / `Network` 自由访问）

---

## 9. 相关链接

- 拆分总览：[docs/monorepo-init.md](monorepo-init.md)
- Schema 契约：[docs/data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md)
- 行为事件表：[docs/behavior-event-design.md](behavior-event-design.md)
- 安全网脚本：[scripts/safe-refactor.sh](scripts/safe-refactor.sh)
