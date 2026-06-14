#!/usr/bin/env python3
"""
盲训 App 种子数据生成脚本

从完整行情库导出日线 + 股票列表到 blind-seed.db。
用法：
  python scripts/generate-seed.py --source <full.db> --output data/blind-seed.db
"""
import argparse
import os
import sqlite3
import sys


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS stock_list (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    market TEXT,
    industry TEXT,
    list_date TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS kline_daily (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL,
    amount REAL,
    change_pct REAL,
    UNIQUE(code, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_kline_daily_code_date ON kline_daily(code, trade_date);

"""



def generate_seed(source_path: str, output_path: str):
    if not os.path.exists(source_path):
        print(f"ERROR: source db not found: {source_path}", file=sys.stderr)
        sys.exit(1)

    if os.path.exists(output_path):
        os.remove(output_path)

    print(f"Creating seed db: {output_path}")
    out = sqlite3.connect(output_path)
    out.executescript(SCHEMA_SQL)

    print("Copying stock_list...")
    src = sqlite3.connect(source_path)
    src.row_factory = sqlite3.Row
    rows = src.execute(
        "SELECT code, name, market, industry, list_date, updated_at FROM stock_list"
    ).fetchall()
    out.executemany(
        "INSERT OR REPLACE INTO stock_list (code, name, market, industry, list_date, updated_at) VALUES (?,?,?,?,?,?)",
        [(r["code"], r["name"], r["market"], r["industry"], r["list_date"], r["updated_at"]) for r in rows],
    )
    print(f"  {len(rows)} stocks")

    print("Copying kline_daily...")
    cursor = src.execute(
        "SELECT code, trade_date, open, high, low, close, volume, amount, change_pct FROM kline_daily ORDER BY code, trade_date"
    )
    batch = []
    total = 0
    while True:
        rows = cursor.fetchmany(10000)
        if not rows:
            break
        batch = [
            (None, r["code"], r["trade_date"], r["open"], r["high"], r["low"], r["close"], r["volume"], r["amount"], r["change_pct"])
            for r in rows
        ]
        out.executemany(
            "INSERT OR REPLACE INTO kline_daily (id, code, trade_date, open, high, low, close, volume, amount, change_pct) VALUES (?,?,?,?,?,?,?,?,?,?)",
            batch,
        )
        total += len(batch)
        if total % 100000 == 0:
            print(f"  {total} rows...")
    print(f"  {total} kline rows")

    min_date = out.execute("SELECT MIN(trade_date) FROM kline_daily").fetchone()[0]
    max_date = out.execute("SELECT MAX(trade_date) FROM kline_daily").fetchone()[0]
    stock_count = out.execute("SELECT COUNT(*) FROM stock_list").fetchone()[0]
    print(f"Seed range: {min_date} ~ {max_date}, {stock_count} stocks, {total} kline rows")

    out.isolation_level = None
    out.execute("VACUUM")
    out.close()
    src.close()

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"Done. Seed db size: {size_mb:.1f} MB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate blind-trainer seed database")
    parser.add_argument("--source", required=True, help="Path to full stock-trading.db")
    parser.add_argument("--output", default="data/blind-seed.db", help="Output path")
    args = parser.parse_args()
    generate_seed(args.source, args.output)
