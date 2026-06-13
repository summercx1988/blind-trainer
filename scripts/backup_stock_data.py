#!/usr/bin/env python3
"""Stock data backup utility.

Backs up the primary SQLite database (including WAL data) to data_backup/.
Usage:
    python scripts/backup_stock_data.py              # Full backup
    python scripts/backup_stock_data.py --verify      # Backup + verify row counts
"""

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime


def get_primary_db_path():
    if sys.platform == "darwin":
        return os.path.expanduser(
            "~/Library/Application Support/stock-trading-simulator/stock-trading.db"
        )
    elif sys.platform == "win32":
        return os.path.join(os.environ.get("APPDATA", ""), "stock-trading-simulator", "stock-trading.db")
    else:
        return os.path.expanduser("~/.config/stock-trading-simulator/stock-trading.db")


def get_project_root():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(script_dir)


def backup_database(src_path, dst_path):
    src = sqlite3.connect(src_path)
    dst = sqlite3.connect(dst_path)
    src.backup(dst)
    dst.close()
    src.close()
    return os.path.getsize(dst_path)


def verify_backup(dst_path):
    conn = sqlite3.connect(dst_path)
    tables = ["kline_daily", "kline_15m", "kline_5m", "stock_list"]
    results = {}
    for table in tables:
        try:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            results[table] = count
        except sqlite3.OperationalError:
            results[table] = -1
    conn.close()
    return results


def main():
    parser = argparse.ArgumentParser(description="Backup stock K-line data")
    parser.add_argument("--verify", action="store_true", help="Verify row counts after backup")
    parser.add_argument("--output", default=None, help="Custom output path")
    args = parser.parse_args()

    src_path = get_primary_db_path()
    if not os.path.exists(src_path):
        print(f"Error: Primary database not found at {src_path}")
        sys.exit(1)

    project_root = get_project_root()
    backup_dir = os.path.join(project_root, "data_backup")
    os.makedirs(backup_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if args.output:
        dst_path = args.output
    else:
        dst_path = os.path.join(backup_dir, f"stock-trading-full.db")

    print(f"Source: {src_path}")
    print(f"Backup: {dst_path}")

    size = backup_database(src_path, dst_path)
    print(f"Backup complete: {size / 1024 / 1024:.1f} MB")

    if args.verify:
        results = verify_backup(dst_path)
        print("\nVerification:")
        for table, count in results.items():
            if count >= 0:
                print(f"  {table}: {count:,} rows")
            else:
                print(f"  {table}: (not found)")

    print(f"\nTo restore, copy the backup to: {src_path}")


if __name__ == "__main__":
    main()
