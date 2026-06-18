# 数据精简脚本（PWA 迁移 · 阶段 1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从现有 735MB 种子库导出符合筛选规则的股票，生成分层数据包（内置包 100 只 / 首启包 500 只 / 全量包 4772 只），为 PWA 迁移提供 Web 端可加载的轻量数据。

**Architecture:** 单一 Python 脚本 `scripts/shrink_seed_for_web.py`，纯标准库（`sqlite3` + `urllib` + `json`），无第三方依赖（与现有 `generate_seed.py` 风格一致）。输入 `data/blind-seed.db`，输出到 `data/web-packs/` 目录：每个包是一个 VACUUM 压缩过的 `.sqlite` 文件 + 同名 `.meta.json`（记录股票数、K 线数、筛选规则、生成时间）。筛选规则集中在一个 `FILTER_SQL` 常量里，便于后续调整。

**Tech Stack:** Python 3.14（标准库 `sqlite3`），SQLite 3。

**关联文档：** [docs/superpowers/specs/2026-06-18-electron-to-pwa-migration-design.md](../specs/2026-06-18-electron-to-pwa-migration-design.md) §6（数据策略）、§6.6（筛选规则）

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `scripts/shrink_seed_for_web.py` | 主脚本：筛选股票、导出分层包、生成 meta | 创建 |
| `scripts/test_shrink_seed.py` | 脚本的单元测试（用临时小库验证筛选/导出逻辑） | 创建 |
| `data/web-packs/builtin-100.sqlite` | 内置包（100 只最活跃股，随 App 打包） | 脚本产出 |
| `data/web-packs/builtin-100.meta.json` | 内置包元数据 | 脚本产出 |
| `data/web-packs/starter-500.sqlite` | 首启包（500 只精选，首次下载） | 脚本产出 |
| `data/web-packs/starter-500.meta.json` | 首启包元数据 | 脚本产出 |
| `data/web-packs/full-4772.sqlite` | 全量包（可选下载） | 脚本产出 |
| `data/web-packs/full-4772.meta.json` | 全量包元数据 | 脚本产出 |
| `.gitignore` | 排除 `data/web-packs/*.sqlite`（产物不入库） | 修改 |

**设计说明：**
- 脚本纯函数化：`filter_codes()`、`export_pack()`、`write_meta()` 三个核心函数，各自可独立测试。
- 筛选规则集中在 `FILTER_SQL` 常量，避免散落多处。
- meta.json 给 PWA 端读取，用于显示"本包含多少股票、生成于何时"。

---

## Task 1: 搭建脚本骨架 + 筛选常量

**Files:**
- Create: `scripts/shrink_seed_for_web.py`

- [ ] **Step 1: 创建脚本骨架，定义筛选常量和包配置**

写入 `scripts/shrink_seed_for_web.py`：

```python
"""
数据精简脚本（PWA 迁移 · 阶段 1）

从 data/blind-seed.db 导出符合筛选规则的股票，生成分层数据包：
  - builtin-100:  100 只最活跃股（随 App 打包）
  - starter-500:  500 只精选（首次启动下载）
  - full-ALL:     筛选后全量（可选下载）

用法：
  python3 scripts/shrink_seed_for_web.py [--src PATH] [--out DIR]

无第三方依赖，仅用 Python 标准库（与 generate_seed.py 风格一致）。
"""

import argparse
import json
import os
import sqlite3
import sys
import time

DEFAULT_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'blind-seed.db')
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'web-packs')

# 筛选规则（来自 design §6.6）
# 排除：ST、低价(<3元最新收盘)、银行/券商/保险/红利
# 注意：list_date 字段为空，新股用 K 线最早日期 > 2023-01-01 识别（见 detect_new_stocks）
FILTER_SQL = """
name NOT LIKE '%ST%'
AND name NOT LIKE '%*ST%'
AND name NOT LIKE '%银行%'
AND name NOT LIKE '%证券%'
AND name NOT LIKE '%保险%'
AND name NOT LIKE '%红利%'
"""

# 新股判定：K 线最早日期晚于此阈值视为新股，排除
NEW_STOCK_DATE_THRESHOLD = '20230101'

# 分层包配置
PACKS = [
    {'name': 'builtin-100', 'size': 100, 'sort': 'activity', 'desc': '内置包·最活跃100只'},
    {'name': 'starter-500', 'size': 500, 'sort': 'activity', 'desc': '首启包·精选500只'},
    {'name': 'full-ALL', 'size': None, 'sort': None, 'desc': '全量包·筛选后全部'},
]


def main():
    parser = argparse.ArgumentParser(description='为 PWA 生成精简数据包')
    parser.add_argument('--src', default=DEFAULT_SRC, help='源数据库路径')
    parser.add_argument('--out', default=DEFAULT_OUT, help='输出目录')
    args = parser.parse_args()

    if not os.path.exists(args.src):
        print(f'错误：源数据库不存在：{args.src}', file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    print(f'源库：{args.src}')
    print(f'输出：{args.out}')
    print('（骨架已就绪，筛选与导出逻辑在后续 task 实现）')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: 运行脚本验证骨架可执行**

Run: `python3 scripts/shrink_seed_for_web.py`
Expected: 打印源库路径、输出路径，正常退出（退出码 0）。

- [ ] **Step 3: 提交**

```bash
git add scripts/shrink_seed_for_web.py
git commit -m "feat(scripts): PWA 数据精简脚本骨架 + 筛选常量"
```

---

## Task 2: 实现筛选函数 `filter_codes()`（TDD）

**Files:**
- Modify: `scripts/shrink_seed_for_web.py`
- Create: `scripts/test_shrink_seed.py`

- [ ] **Step 1: 先写测试——构造一个迷你测试库，验证筛选逻辑**

写入 `scripts/test_shrink_seed.py`：

```python
"""shrink_seed_for_web.py 的单元测试。

用临时内存库构造小样本数据，验证筛选规则正确排除 ST/低价/金融红利/新股。
运行：python3 scripts/test_shrink_seed.py
"""

import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shrink_seed_for_web import filter_codes, detect_new_stocks


def build_test_db(path):
    """构造迷你测试库：3 只正常股 + ST + 低价 + 银行 + 新股各 1 只。"""
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE stock_list (
            code TEXT PRIMARY KEY, name TEXT, market TEXT,
            industry TEXT, list_date TEXT, updated_at INTEGER
        );
        CREATE TABLE kline_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, trade_date TEXT,
            open REAL, high REAL, low REAL, close REAL,
            volume REAL, amount REAL, change_pct REAL,
            UNIQUE(code, trade_date)
        );
        CREATE INDEX idx_daily_code_date ON kline_daily(code, trade_date);
    """)
    # 正常股 ×3（应被保留）
    stocks = [
        ('600001', '测试科技', '20200101', '20240101', 15.0),  # 老股，中价
        ('600002', '测试消费', '20190101', '20240101', 8.0),   # 老股，中低价
        ('600003', '测试医药', '20180101', '20240101', 45.0),  # 老股，高价
    ]
    # 应被排除的
    stocks += [
        ('600099', 'ST退市', '20200101', '20240101', 5.0),     # ST
        ('600098', '仙股', '20200101', '20240101', 1.5),       # 低价 <3
        ('600100', '测试银行', '20190101', '20240101', 10.0),  # 银行
        ('600200', '新股科技', '20240601', '20240601', 20.0),  # 新股（K线起点2024）
    ]
    for code, name, _, latest_date, close in stocks:
        conn.execute('INSERT INTO stock_list VALUES (?,?,?,?,?,0)',
                     (code, name, 'SH', '', '', 0))
        # 造两条 K 线：一条早期、一条最新（用于低价判定和新股判定）
        conn.execute('INSERT INTO kline_daily (code,trade_date,open,high,low,close,volume,amount,change_pct) '
                     'VALUES (?,?,?,?,?,?,?,?,?)',
                     (code, '20200101', close, close, close, close, 1000, 1000*close, 0))
        conn.execute('INSERT INTO kline_daily (code,trade_date,open,high,low,close,volume,amount,change_pct) '
                     'VALUES (?,?,?,?,?,?,?,?,?)',
                     (code, latest_date, close, close, close, close, 1000, 1000*close, 0))
    conn.commit()
    conn.close()


def test_filter_codes_excludes_st_lowprice_finance():
    with tempfile.TemporaryDirectory() as td:
        db_path = os.path.join(td, 'test.db')
        build_test_db(db_path)

        new_stocks = detect_new_stocks(db_path, '20230101')
        codes = filter_codes(db_path, new_stocks)

        assert '600001' in codes, f'正常股应保留，实际 {codes}'
        assert '600002' in codes, f'正常股应保留，实际 {codes}'
        assert '600003' in codes, f'正常股应保留，实际 {codes}'
        assert '600099' not in codes, f'ST应排除，实际 {codes}'
        assert '600098' not in codes, f'低价股应排除，实际 {codes}'
        assert '600100' not in codes, f'银行应排除，实际 {codes}'
        assert '600200' not in codes, f'新股应排除，实际 {codes}'
        print(f'✓ test_filter_codes_excludes_st_lowprice_finance 通过（保留 {len(codes)} 只）')


def test_detect_new_stocks():
    with tempfile.TemporaryDirectory() as td:
        db_path = os.path.join(td, 'test.db')
        build_test_db(db_path)

        new_stocks = detect_new_stocks(db_path, '20230101')
        assert '600200' in new_stocks, f'2024上市的新股应被识别，实际 {new_stocks}'
        assert '600001' not in new_stocks, f'老股不应被识别为新股，实际 {new_stocks}'
        print(f'✓ test_detect_new_stocks 通过（识别 {len(new_stocks)} 只新股）')


if __name__ == '__main__':
    test_detect_new_stocks()
    test_filter_codes_excludes_st_lowprice_finance()
    print('\n全部测试通过')
```

- [ ] **Step 2: 运行测试，验证它因函数未实现而失败**

Run: `python3 scripts/test_shrink_seed.py`
Expected: FAIL，报 `ImportError: cannot import name 'filter_codes'` 或 `AttributeError`。

- [ ] **Step 3: 实现 `detect_new_stocks()` 和 `filter_codes()`**

在 `scripts/shrink_seed_for_web.py` 的 `main()` 函数之前插入：

```python
def detect_new_stocks(db_path, threshold_date):
    """识别新股：K 线最早日期晚于 threshold_date（YYYYMMDD）的股票。

    list_date 字段为空（实测 5148 只全空），改用 K 线最早日期替代。
    返回新股 code 集合。
    """
    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT code, MIN(trade_date) AS first_date
        FROM kline_daily
        GROUP BY code
        HAVING first_date > ?
    """, (threshold_date,)).fetchall()
    conn.close()
    return {code for code, _ in rows}


def filter_codes(db_path, exclude_codes=None):
    """筛选符合训练条件的股票 code 列表。

    排除规则（design §6.6）：
      - ST 股（name 含 ST/*ST）
      - 低价股（最新收盘价 < 3 元）
      - 银行/券商/保险/红利（name 匹配）
      - 新股（由调用方传入 exclude_codes）
    返回按 code 升序排列的列表。
    """
    exclude_codes = exclude_codes or set()
    conn = sqlite3.connect(db_path)

    # 取每只股票的最新收盘价（用于低价判定）
    latest = conn.execute("""
        SELECT code, close FROM kline_daily
        WHERE (code, trade_date) IN (
            SELECT code, MAX(trade_date) FROM kline_daily GROUP BY code
        )
    """).fetchall()
    latest_close = {code: close for code, close in latest}

    # name 筛选
    placeholders = []
    rows = conn.execute(f"""
        SELECT code, name FROM stock_list WHERE {FILTER_SQL}
    """).fetchall()
    conn.close()

    codes = []
    for code, name in rows:
        if code in exclude_codes:
            continue
        if latest_close.get(code, 999) < 3:  # 低价股排除
            continue
        codes.append(code)
    return sorted(codes)
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `python3 scripts/test_shrink_seed.py`
Expected: 打印两个 `✓` 和 `全部测试通过`。

- [ ] **Step 5: 提交**

```bash
git add scripts/shrink_seed_for_web.py scripts/test_shrink_seed.py
git commit -m "feat(scripts): 实现股票筛选 filter_codes + 新股识别（TDD）"
```

---

## Task 3: 实现分层包选取 `select_packs()`

**Files:**
- Modify: `scripts/shrink_seed_for_web.py`
- Modify: `scripts/test_shrink_seed.py`

- [ ] **Step 1: 更新测试文件的 import，并追加测试**

先把 `scripts/test_shrink_seed.py` 顶部的 import 行改为（加入 `select_packs`）：

```python
from shrink_seed_for_web import filter_codes, detect_new_stocks, select_packs
```

然后在 `scripts/test_shrink_seed.py` 末尾的 `if __name__` 之前追加：

```python
def test_select_packs():
    with tempfile.TemporaryDirectory() as td:
        db_path = os.path.join(td, 'test.db')
        build_test_db(db_path)

        new_stocks = detect_new_stocks(db_path, '20230101')
        all_codes = filter_codes(db_path, new_stocks)

        # builtin-100: 只取活跃度 TOP 100（这里样本少，取 TOP 2）
        builtin = select_packs(all_codes, db_path, size=2, sort='activity')
        assert len(builtin) == 2, f'内置包应取2只，实际 {len(builtin)}'

        # starter-500: 取活跃度 TOP 500（这里取全部3只）
        starter = select_packs(all_codes, db_path, size=500, sort='activity')
        assert len(starter) == 3, f'首启包应取3只，实际 {len(starter)}'

        # full-ALL: 全量，不截断
        full = select_packs(all_codes, db_path, size=None, sort=None)
        assert set(full) == set(all_codes), f'全量包应等于筛选全集，实际 {full}'
        print(f'✓ test_select_packs 通过（builtin={len(builtin)} starter={len(starter)} full={len(full)}）')


def test_select_packs_activity_sort():
    """验证活跃度排序：成交额大的排前面。"""
    with tempfile.TemporaryDirectory() as td:
        db_path = os.path.join(td, 'test.db')
        # 构造两只股，一只成交额大一只小
        conn = sqlite3.connect(db_path)
        conn.executescript("""
            CREATE TABLE stock_list (code TEXT PRIMARY KEY, name TEXT, market TEXT, industry TEXT, list_date TEXT, updated_at INTEGER);
            CREATE TABLE kline_daily (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, trade_date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, amount REAL, change_pct REAL, UNIQUE(code, trade_date));
            CREATE INDEX idx_daily_code_date ON kline_daily(code, trade_date);
        """)
        for code, amount in [('A001', 1000000), ('A002', 100)]:  # A001 活跃，A002 冷门
            conn.execute('INSERT INTO stock_list VALUES (?,?,?,?,?,0)', (code, 'X', 'SH', '', '', 0))
            conn.execute('INSERT INTO kline_daily (code,trade_date,open,high,low,close,volume,amount,change_pct) VALUES (?,?,?,?,?,?,?,?,?)',
                         (code, '20240101', 10, 10, 10, 10, amount/10, amount, 0))
        conn.commit()
        conn.close()

        result = select_packs(['A001', 'A002'], db_path, size=1, sort='activity')
        assert result == ['A001'], f'活跃度 TOP1 应是 A001，实际 {result}'
        print('✓ test_select_packs_activity_sort 通过')
```

并在 `if __name__ == '__main__':` 块里追加两个调用：

```python
    test_select_packs()
    test_select_packs_activity_sort()
```

- [ ] **Step 2: 运行测试，验证新测试失败**

Run: `python3 scripts/test_shrink_seed.py`
Expected: FAIL，报 `ImportError: cannot import name 'select_packs' from 'shrink_seed_for_web'`。

- [ ] **Step 3: 实现 `select_packs()`**

在 `scripts/shrink_seed_for_web.py` 的 `filter_codes()` 之后插入：

```python
def select_packs(all_codes, db_path, size=None, sort=None):
    """从筛选全集中选取一个分层包。

    Args:
        all_codes: filter_codes() 返回的筛选全集
        db_path: 源库路径（用于查活跃度）
        size: None 表示全量；数字表示截断到前 N 只
        sort: 'activity' 按近一年日均成交额降序；None 不排序（按 all_codes 原序）
    返回 code 列表。
    """
    if sort == 'activity':
        conn = sqlite3.connect(db_path)
        # 近一年日均成交额（amount 越大越活跃）
        placeholders = ','.join('?' * len(all_codes))
        rows = conn.execute(f"""
            SELECT code, AVG(amount) AS avg_amount
            FROM kline_daily
            WHERE code IN ({placeholders})
              AND trade_date >= date('now', '-1 year')
            GROUP BY code
            ORDER BY avg_amount DESC
        """, all_codes).fetchall()
        conn.close()
        sorted_codes = [code for code, _ in rows]
        # 补上近一年无数据的老股（按原序追加到末尾）
        rest = [c for c in all_codes if c not in set(sorted_codes)]
        sorted_codes = sorted_codes + rest
    else:
        sorted_codes = list(all_codes)

    if size is None:
        return sorted_codes
    return sorted_codes[:size]
```

- [ ] **Step 4: 运行测试，验证全部通过**

Run: `python3 scripts/test_shrink_seed.py`
Expected: 打印四个 `✓` 和 `全部测试通过`。

- [ ] **Step 5: 提交**

```bash
git add scripts/shrink_seed_for_web.py scripts/test_shrink_seed.py
git commit -m "feat(scripts): 实现分层包选取 select_packs（活跃度排序+截断）"
```

---

## Task 4: 实现导出 `export_pack()` + 元数据 `write_meta()`

**Files:**
- Modify: `scripts/shrink_seed_for_web.py`
- Modify: `scripts/test_shrink_seed.py`

- [ ] **Step 1: 更新测试文件的 import，并追加测试**

先把 `scripts/test_shrink_seed.py` 顶部的 import 行改为（加入 `export_pack`）：

```python
from shrink_seed_for_web import filter_codes, detect_new_stocks, select_packs, export_pack
```

然后在 `scripts/test_shrink_seed.py` 中追加：

```python
def test_export_pack_and_meta():
    with tempfile.TemporaryDirectory() as td:
        src_db = os.path.join(td, 'test.db')
        out_dir = os.path.join(td, 'out')
        build_test_db(src_db)
        os.makedirs(out_dir)

        new_stocks = detect_new_stocks(src_db, '20230101')
        all_codes = filter_codes(src_db, new_stocks)
        codes = select_packs(all_codes, src_db, size=2, sort='activity')

        pack_path = export_pack(src_db, out_dir, 'test-pack', codes)
        assert os.path.exists(pack_path), f'导出文件应存在：{pack_path}'
        assert pack_path.endswith('test-pack.sqlite'), f'文件名应以 .sqlite 结尾：{pack_path}'

        # 验证导出库结构：只有选中的股票
        conn = sqlite3.connect(pack_path)
        exported_codes = {r[0] for r in conn.execute('SELECT DISTINCT code FROM kline_daily').fetchall()}
        conn.close()
        assert exported_codes == set(codes), f'导出的股票集应匹配，实际 {exported_codes}，期望 {set(codes)}'

        # 验证 meta.json
        meta_path = pack_path.replace('.sqlite', '.meta.json')
        assert os.path.exists(meta_path), f'meta 文件应存在：{meta_path}'
        with open(meta_path) as f:
            meta = json.load(f)
        assert meta['name'] == 'test-pack'
        assert meta['stock_count'] == len(codes)
        assert meta['kline_count'] > 0
        assert 'generated_at' in meta
        print(f'✓ test_export_pack_and_meta 通过（{meta["stock_count"]}只，{meta["kline_count"]}根K线）')
```

在 `if __name__ == '__main__':` 块里追加：

```python
    test_export_pack_and_meta()
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `python3 scripts/test_shrink_seed.py`
Expected: FAIL，报 `ImportError: cannot import name 'export_pack' from 'shrink_seed_for_web'`。

- [ ] **Step 3: 实现 `export_pack()` 和 `write_meta()`**

在 `scripts/shrink_seed_for_web.py` 的 `select_packs()` 之后插入：

```python
def export_pack(src_db_path, out_dir, pack_name, codes):
    """导出一个精简包到 out_dir/<pack_name>.sqlite，并生成同名 meta.json。

    包含 kline_daily + stock_list 两张表（仅选中股票的数据），带索引，VACUUM 压缩。
    返回导出文件路径。
    """
    pack_path = os.path.join(out_dir, f'{pack_name}.sqlite')
    if os.path.exists(pack_path):
        os.remove(pack_path)

    src = sqlite3.connect(src_db_path)
    dst = sqlite3.connect(pack_path)

    # 建表 + 索引（与种子库 schema 一致）
    dst.executescript("""
        CREATE TABLE kline_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, trade_date TEXT,
            open REAL, high REAL, low REAL, close REAL,
            volume REAL, amount REAL, change_pct REAL
        );
        CREATE TABLE stock_list (
            code TEXT PRIMARY KEY, name TEXT, market TEXT,
            industry TEXT, list_date TEXT, updated_at INTEGER
        );
        CREATE INDEX idx_kline_code ON kline_daily(code);
        CREATE INDEX idx_kline_date ON kline_daily(code, trade_date);
    """)

    placeholders = ','.join('?' * len(codes))
    # 导数据
    for row in src.execute(f'SELECT * FROM kline_daily WHERE code IN ({placeholders})', codes):
        dst.execute('INSERT INTO kline_daily VALUES (?,?,?,?,?,?,?,?,?,?)', row)
    for row in src.execute(f'SELECT * FROM stock_list WHERE code IN ({placeholders})', codes):
        dst.execute('INSERT INTO stock_list VALUES (?,?,?,?,?,?)', row)
    dst.commit()
    dst.execute('VACUUM')
    dst.close()
    src.close()

    # 写 meta
    write_meta(pack_path, pack_name, codes)
    return pack_path


def write_meta(pack_path, pack_name, codes):
    """生成 <pack_name>.meta.json，记录包的元信息。"""
    conn = sqlite3.connect(pack_path)
    kline_count = conn.execute('SELECT COUNT(*) FROM kline_daily').fetchone()[0]
    conn.close()

    size_bytes = os.path.getsize(pack_path)
    meta = {
        'name': pack_name,
        'stock_count': len(codes),
        'kline_count': kline_count,
        'size_bytes': size_bytes,
        'size_mb': round(size_bytes / 1024 / 1024, 1),
        'codes': codes,
        'generated_at': int(time.time()),
        'filter_rules': {
            'exclude_st': True,
            'exclude_low_price_lt': 3,
            'exclude_finance': ['银行', '证券', '保险', '红利'],
            'exclude_new_stock_after': NEW_STOCK_DATE_THRESHOLD,
        },
    }
    meta_path = pack_path.replace('.sqlite', '.meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
```

- [ ] **Step 4: 运行测试，验证全部通过**

Run: `python3 scripts/test_shrink_seed.py`
Expected: 打印五个 `✓` 和 `全部测试通过`。

- [ ] **Step 5: 提交**

```bash
git add scripts/shrink_seed_for_web.py scripts/test_shrink_seed.py
git commit -m "feat(scripts): 实现数据包导出 export_pack + 元数据 write_meta"
```

---

## Task 5: 串联 main() + 在真实种子库上跑通

**Files:**
- Modify: `scripts/shrink_seed_for_web.py`

- [ ] **Step 1: 完善 main()，串联筛选→选取→导出全流程**

替换 `scripts/shrink_seed_for_web.py` 里现有的 `main()` 函数：

```python
def main():
    parser = argparse.ArgumentParser(description='为 PWA 生成精简数据包')
    parser.add_argument('--src', default=DEFAULT_SRC, help='源数据库路径')
    parser.add_argument('--out', default=DEFAULT_OUT, help='输出目录')
    args = parser.parse_args()

    if not os.path.exists(args.src):
        print(f'错误：源数据库不存在：{args.src}', file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    print(f'源库：{args.src}')
    print(f'输出：{args.out}')

    # 1. 识别新股
    print('\n[1/3] 识别新股（K线最早日期 > {}）...'.format(NEW_STOCK_DATE_THRESHOLD))
    new_stocks = detect_new_stocks(args.src, NEW_STOCK_DATE_THRESHOLD)
    print(f'  识别新股 {len(new_stocks)} 只')

    # 2. 筛选全集
    print('\n[2/3] 筛选符合训练条件的股票 ...')
    all_codes = filter_codes(args.src, new_stocks)
    print(f'  筛选后保留 {len(all_codes)} 只（排除 ST/低价/金融/新股）')

    # 3. 生成分层包
    print('\n[3/3] 生成分层数据包 ...')
    for pack in PACKS:
        # full-ALL 的 size 字段是 None（全量），其他取实际数值
        size = pack['size'] if pack['name'] != 'full-ALL' else len(all_codes)
        # 实际包名带上股票数，便于 PWA 端识别
        actual_name = pack['name'] if pack['name'] != 'full-ALL' else f'full-{len(all_codes)}'
        codes = select_packs(all_codes, args.src, size=min(size, len(all_codes)), sort=pack['sort'])
        pack_path = export_pack(args.src, args.out, actual_name, codes)
        size_mb = os.path.getsize(pack_path) / 1024 / 1024
        print(f'  ✓ {pack["desc"]} → {actual_name}.sqlite（{len(codes)}只，{size_mb:.1f}MB）')

    print('\n完成。所有数据包位于：', args.out)


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: 在真实种子库上运行（全量数据，首次较慢）**

Run: `python3 scripts/shrink_seed_for_web.py`
Expected: 依次打印新股识别数、筛选后保留数（约 4700+）、三个包的生成结果，每个包含股票数和体积（builtin-100 ~14MB / starter-500 ~66MB / full-XXXXX ~640MB）。退出码 0。

> ⚠️ 这一步会读写 735MB 源库并导出 ~700MB 数据，预计耗时 1-3 分钟。耐心等待。

- [ ] **Step 3: 验证产出的数据包结构**

Run: `sqlite3 data/web-packs/builtin-100.sqlite "SELECT COUNT(DISTINCT code) FROM kline_daily; SELECT COUNT(*) FROM kline_daily; SELECT COUNT(*) FROM stock_list;"`
Expected: 三个数字——100（股票数）、约 11-12 万（K 线数）、100（stock_list 行数）。

Run: `cat data/web-packs/builtin-100.meta.json | python3 -c "import sys,json; m=json.load(sys.stdin); print(f'股票数:{m[\"stock_count\"]} K线:{m[\"kline_count\"]} 体积:{m[\"size_mb\"]}MB')"`
Expected: 打印股票数 100、K 线数、体积 MB。

- [ ] **Step 4: 配置 .gitignore，排除产出的 sqlite 包（太大不入库）**

读取 `.gitignore`，在末尾追加：

```
# PWA 数据包产物（由 shrink_seed_for_web.py 生成，体积大，不入库）
data/web-packs/*.sqlite
```

> 注：`data/web-packs/*.meta.json` 保留入库——体积小（KB 级），可供 PWA 端预览包信息。

- [ ] **Step 5: 提交**

```bash
git add scripts/shrink_seed_for_web.py .gitignore data/web-packs/*.meta.json
git commit -m "feat(scripts): 串联数据精简全流程 + 在真实种子库跑通三个分层包"
```

---

## Task 6: 更新 docs，记录数据包使用方式

**Files:**
- Create: `docs/web-data-packs.md`

- [ ] **Step 1: 写数据包使用说明文档**

写入 `docs/web-data-packs.md`：

```markdown
# Web 端数据包（PWA 迁移 · 阶段 1 产物）

> 关联：[Electron→PWA 迁移设计](superpowers/specs/2026-06-18-electron-to-pwa-migration-design.md) §6

## 生成

\`\`\`bash
python3 scripts/shrink_seed_for_web.py
\`\`\`

从 \`data/blind-seed.db\`（735MB）生成三个分层包到 \`data/web-packs/\`：

| 包 | 股票数 | 体积 | 用途 |
| --- | --- | --- | --- |
| builtin-100 | 100 | ~14MB | 随 App 打包，首次启动秒开 |
| starter-500 | 500 | ~66MB | 首次启动下载，gzip 后 ~23MB |
| full-ALL | ~4700 | ~640MB | 用户主动下载（全量包） |

每个包含 \`.sqlite\`（数据，gitignore）+ \`.meta.json\`（元数据，入库）。

## 筛选规则

排除：ST、最新收盘 < ¥3、银行/券商/保险/红利、新股（K 线最早日期 > 2023-01-01）。
源码见 \`scripts/shrink_seed_for_web.py\` 的 \`FILTER_SQL\` 常量。

## 验证

\`\`\`bash
python3 scripts/test_shrink_seed.py
\`\`\`

## PWA 端加载方式

（阶段 2 实现）通过 sql.js 加载 .sqlite 文件到 IndexedDB，按 design §6 的四层架构调度。
```

- [ ] **Step 2: 提交**

```bash
git add docs/web-data-packs.md
git commit -m "docs: Web 端数据包使用说明"
```

---

## 完成标准（Definition of Done）

- [ ] `python3 scripts/test_shrink_seed.py` 全部通过（5 个测试）
- [ ] `python3 scripts/shrink_seed_for_web.py` 在真实种子库上跑通，产出 3 个 `.sqlite` + 3 个 `.meta.json`
- [ ] `data/web-packs/builtin-100.sqlite` 包含正好 100 只股票
- [ ] `.gitignore` 排除了 `data/web-packs/*.sqlite`
- [ ] `npx tsc -b --noEmit` 仍通过（本阶段不碰 TS，应为无影响）
- [ ] 所有改动已 commit

---

## 后续阶段（单独的 plan）

本计划完成后，进入：

- **阶段 2**：PWA 骨架 + sql.js 接入 + IndexedDB 持久化
- **阶段 3**：webApi.ts 抽象层（照搬 preload 接口签名）
- **阶段 4**：组件层迁移 + 横竖屏布局
- **阶段 5**：部署 + 手机测试

每个阶段单独成 plan，前置阶段完成后编写。
