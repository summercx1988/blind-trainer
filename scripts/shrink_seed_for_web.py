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
              AND trade_date >= strftime('%Y%m%d', 'now', '-1 year')
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
