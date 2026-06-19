"""shrink_seed_for_web.py 的单元测试。

用临时内存库构造小样本数据，验证筛选规则正确排除 ST/低价/金融红利/新股。
运行：python3 scripts/test_shrink_seed.py
"""

import os
import json
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shrink_seed_for_web import filter_codes, detect_new_stocks, select_packs, export_pack


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
    # 正常股 ×3（应被保留）；元组：(code, name, 早期K线日期, 最新K线日期, 收盘价)
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
        ('600200', '新股科技', '20240601', '20240601', 20.0),  # 新股（K线起点2024，早期日期也是2024）
    ]
    for code, name, early_date, latest_date, close in stocks:
        conn.execute('INSERT INTO stock_list VALUES (?,?,?,?,?,0)',
                     (code, name, 'SH', '', ''))
        # 造 K 线：早期一条 + 最新一条（新股可能只有一条，跳过重复）
        conn.execute('INSERT INTO kline_daily (code,trade_date,open,high,low,close,volume,amount,change_pct) '
                     'VALUES (?,?,?,?,?,?,?,?,?)',
                     (code, early_date, close, close, close, close, 1000, 1000*close, 0))
        if latest_date != early_date:
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
            conn.execute('INSERT INTO stock_list VALUES (?,?,?,?,?,0)', (code, 'X', 'SH', '', ''))
            conn.execute('INSERT INTO kline_daily (code,trade_date,open,high,low,close,volume,amount,change_pct) VALUES (?,?,?,?,?,?,?,?,?)',
                         (code, '20260101', 10, 10, 10, 10, amount/10, amount, 0))
        conn.commit()
        conn.close()

        result = select_packs(['A001', 'A002'], db_path, size=1, sort='activity')
        assert result == ['A001'], f'活跃度 TOP1 应是 A001，实际 {result}'
        print('✓ test_select_packs_activity_sort 通过')


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


if __name__ == '__main__':
    test_detect_new_stocks()
    test_filter_codes_excludes_st_lowprice_finance()
    test_select_packs()
    test_select_packs_activity_sort()
    test_export_pack_and_meta()
    print('\n全部测试通过')
