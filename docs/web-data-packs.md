# Web 端数据包（PWA 迁移 · 阶段 1 产物）

> 关联：[Electron→PWA 迁移设计](superpowers/specs/2026-06-18-electron-to-pwa-migration-design.md) §6

## 生成

```bash
python3 scripts/shrink_seed_for_web.py
```

从 `data/blind-seed.db`（735MB）生成三个分层包到 `data/web-packs/`：

| 包 | 股票数 | 体积 | 用途 |
| --- | --- | --- | --- |
| builtin-100 | 100 | ~17MB | 随 App 打包，首次启动秒开 |
| starter-500 | 500 | ~82MB | 首次启动下载，gzip 后 ~23MB |
| full-3744 | ~3700 | ~588MB | 用户主动下载（全量包） |

每个包含 `.sqlite`（数据，gitignore）+ `.meta.json`（元数据，`git add -f` 入库）。

## 筛选规则

排除：ST、最新收盘 < ¥3、银行/券商/保险/红利、新股（K 线最早日期 > 2023-01-01）。
源码见 `scripts/shrink_seed_for_web.py` 的 `FILTER_SQL` 常量。

实测（2026-06-19）：5148 只 → 排除 ST/低价/金融/新股 1080 只 → 保留 3744 只。

## 验证

```bash
python3 scripts/test_shrink_seed.py
```

5 个测试覆盖：新股识别、筛选排除、分层选取、活跃度排序、导出结构。

## PWA 端加载方式

（阶段 2 实现）通过 sql.js 加载 .sqlite 文件到 IndexedDB，按 design §6 的四层架构调度。
