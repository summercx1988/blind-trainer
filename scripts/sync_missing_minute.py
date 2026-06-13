#!/usr/bin/env python3
"""Sync missing A-share minute bars into local SQLite (idempotent, resume-safe).

Usage examples:
  # Single process
  PYTHONPATH=python python3 scripts/sync_missing_minute.py --period 15 --db auto

  # 4 parallel processes (partition 0..3 of 4)
  PYTHONPATH=python python3 scripts/sync_missing_minute.py --period 15 --db auto --partition 0 --total-partitions 4 &
  PYTHONPATH=python python3 scripts/sync_missing_minute.py --period 15 --db auto --partition 1 --total-partitions 4 &
  PYTHONPATH=python python3 scripts/sync_missing_minute.py --period 15 --db auto --partition 2 --total-partitions 4 &
  PYTHONPATH=python python3 scripts/sync_missing_minute.py --period 15 --db auto --partition 3 --total-partitions 4 &
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "python") not in sys.path:
    sys.path.insert(0, str(ROOT / "python"))

import scripts.data_fetcher as data_fetcher  # noqa: E402
from trading_trainer.db_path import get_primary_db_path  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync missing minute bars for A-shares.")
    parser.add_argument("--db", default="auto", help="SQLite path or auto.")
    parser.add_argument("--period", default="15", choices=["5", "15", "30", "60"], help="Minute period.")
    parser.add_argument("--codes", default="", help="Optional comma-separated stock codes to process explicitly.")
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on missing codes for one run.")
    parser.add_argument("--start-after", default="", help="Only process codes greater than this code.")
    parser.add_argument("--sleep", type=float, default=0.08, help="Sleep seconds between codes.")
    parser.add_argument("--log-every", type=int, default=20, help="Print progress every N codes.")
    parser.add_argument("--fetch-retries", type=int, default=3, help="Retries per code when fetch/insert fails.")
    parser.add_argument("--retry-backoff", type=float, default=0.8, help="Base backoff seconds for retries.")
    parser.add_argument("--query-timeout", type=int, default=45, help="Per-code baostock query timeout seconds.")
    parser.add_argument("--max-consecutive-errors", type=int, default=80, help="Circuit-break threshold for consecutive errors.")
    parser.add_argument("--quiet", action="store_true", help="Suppress internal fetcher logs.")
    parser.add_argument("--checkpoint-every", type=int, default=50, help="WAL checkpoint every N successful codes.")
    parser.add_argument("--partition", type=int, default=0, help="Partition index (0-based) for parallel runs.")
    parser.add_argument("--total-partitions", type=int, default=1, help="Total number of partitions for parallel runs.")
    return parser.parse_args()


def resolve_db_path(db_arg: str) -> str:
    raw = str(db_arg or "").strip().lower()
    if raw in ("", "auto", "default"):
        return get_primary_db_path()
    return str(db_arg)


def parse_explicit_codes(raw_codes: str) -> List[str]:
    normalized = []
    seen = set()
    for item in str(raw_codes or "").split(","):
      code = item.strip()
      if len(code) != 6 or not code.isdigit() or code in seen:
          continue
      seen.add(code)
      normalized.append(code)
    return normalized


def fetch_missing_codes(conn: sqlite3.Connection, period: str, start_after: str = "",
                        limit: int = 0, partition: int = 0, total_partitions: int = 1) -> List[str]:
    table = f"kline_{period}m"
    if total_partitions > 1:
        base_sql = f"""
            WITH numbered AS (
                SELECT s.code, ROW_NUMBER() OVER (ORDER BY s.code) AS rn
                FROM stock_list s
                LEFT JOIN (SELECT DISTINCT code FROM {table}) k ON s.code = k.code
                WHERE k.code IS NULL
        """
        params: list = []
        if start_after:
            base_sql += " AND s.code > ?"
            params.append(start_after)
        base_sql += f"""
            )
            SELECT code FROM numbered WHERE ((rn - 1) % ?) = ?
        """
        params.extend([total_partitions, partition])
        base_sql += " ORDER BY code"
        if limit and limit > 0:
            base_sql += " LIMIT ?"
            params.append(int(limit))
    else:
        base_sql = f"""
            SELECT s.code
            FROM stock_list s
            LEFT JOIN (SELECT DISTINCT code FROM {table}) k ON s.code = k.code
            WHERE k.code IS NULL
        """
        params = []
        if start_after:
            base_sql += " AND s.code > ?"
            params.append(start_after)
        base_sql += " ORDER BY s.code"
        if limit and limit > 0:
            base_sql += " LIMIT ?"
            params.append(int(limit))

    rows = conn.execute(base_sql, params).fetchall()
    return [str(row[0]) for row in rows]


def select_explicit_codes(codes: List[str], start_after: str = "", limit: int = 0,
                          partition: int = 0, total_partitions: int = 1) -> List[str]:
    filtered = sorted(code for code in codes if not start_after or code > start_after)
    if total_partitions > 1:
        filtered = [code for index, code in enumerate(filtered) if index % total_partitions == partition]
    if limit and limit > 0:
        filtered = filtered[:int(limit)]
    return filtered


def insert_with_retry(conn: sqlite3.Connection, rows, table: str, retries: int = 6, backoff: float = 0.8) -> int:
    last_error = None
    for i in range(retries):
        try:
            return int(data_fetcher.insert_minute_rows(conn, rows, table))
        except sqlite3.OperationalError as error:
            last_error = error
            if "locked" not in str(error).lower() and "busy" not in str(error).lower():
                raise
            time.sleep(backoff * (i + 1))
    if last_error:
        raise last_error
    return 0


def is_transient_fetch_error(error: Exception) -> bool:
    msg = str(error or "").lower()
    keywords = [
        "broken pipe",
        "connection reset",
        "timed out",
        "timeout",
        "network",
        "socket",
        "errno 32",
        "errno 54",
        "接收数据异常",
        "请稍后再试",
    ]
    return any(keyword in msg for keyword in keywords)


def checkpoint(conn: sqlite3.Connection, partition_id: str) -> None:
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception as e:
        print(f"  [{partition_id}] checkpoint warning: {e}", flush=True)


def main() -> int:
    args = parse_args()
    db_path = resolve_db_path(args.db)
    period = str(args.period)
    table = f"kline_{period}m"
    partition = int(args.partition)
    total_partitions = max(1, int(args.total_partitions))
    if partition < 0 or partition >= total_partitions:
        print(
            f"invalid_partition: partition={partition}, total_partitions={total_partitions} "
            f"(expected 0 <= partition < total_partitions)",
            flush=True,
        )
        return 2
    partition_id = f"P{partition}" if total_partitions > 1 else "main"

    data_fetcher.DB_PATH = db_path
    if args.quiet:
        data_fetcher.log = lambda *_args, **_kwargs: None
        data_fetcher.log_progress = lambda *_args, **_kwargs: None

    conn = sqlite3.connect(db_path, timeout=120)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"PRAGMA busy_timeout=120000")
    conn.row_factory = sqlite3.Row

    explicit_codes = parse_explicit_codes(args.codes)
    if explicit_codes:
        target_codes = select_explicit_codes(explicit_codes, args.start_after, args.limit, partition, total_partitions)
    else:
        target_codes = fetch_missing_codes(conn, period, args.start_after, args.limit,
                                           partition, total_partitions)
    total = len(target_codes)
    print(f"[{partition_id}] db_path={db_path}", flush=True)
    print(f"[{partition_id}] period={period}m table={table}", flush=True)
    print(
        f"[{partition_id}] partition={partition}/{total_partitions} "
        f"{'explicit_codes' if explicit_codes else 'missing_codes'}={total}",
        flush=True,
    )
    if total == 0:
        print(f"[{partition_id}] nothing_to_do", flush=True)
        conn.close()
        return 0

    started_at = time.time()
    success = 0
    no_data = 0
    errors = 0
    consecutive_errors = 0
    inserted_rows = 0
    last_code = ""
    last_error_message = ""
    codes_since_checkpoint = 0
    checkpoint_every = max(1, int(args.checkpoint_every))

    try:
        for idx, code in enumerate(target_codes, start=1):
            last_code = code
            code_done = False
            successful_code = False
            for attempt in range(max(1, int(args.fetch_retries))):
                try:
                    rows = data_fetcher.fetch_minute_kline_baostock(
                        code,
                        period,
                        retries=max(1, int(args.fetch_retries)),
                        retry_backoff=max(0.1, float(args.retry_backoff)),
                        query_timeout=max(10, int(args.query_timeout)),
                    )
                    if not rows:
                        rows = data_fetcher.fetch_minute_kline_sina(code, period, 5000)

                    if rows:
                        inserted_rows += insert_with_retry(conn, rows, table)
                        success += 1
                        successful_code = True
                    else:
                        no_data += 1
                    consecutive_errors = 0
                    code_done = True
                    break
                except KeyboardInterrupt:
                    raise
                except Exception as error:
                    last_error_message = str(error)
                    transient = is_transient_fetch_error(error)
                    if transient:
                        try:
                            data_fetcher._bs_logout()
                        except Exception:
                            pass
                    if attempt + 1 < max(1, int(args.fetch_retries)):
                        wait_sec = max(0.1, float(args.retry_backoff)) * (attempt + 1)
                        time.sleep(wait_sec)
                        continue
                    errors += 1
                    consecutive_errors += 1
                    code_done = True
                    break

            if not code_done:
                errors += 1
                consecutive_errors += 1

            if successful_code:
                codes_since_checkpoint += 1
                if codes_since_checkpoint >= checkpoint_every:
                    checkpoint(conn, partition_id)
                    codes_since_checkpoint = 0

            if consecutive_errors >= max(1, int(args.max_consecutive_errors)):
                try:
                    data_fetcher._bs_logout()
                except Exception:
                    pass
                print(
                    f"[{partition_id}] circuit_break=true consecutive_errors={consecutive_errors} "
                    f"last_code={last_code} last_error={last_error_message}",
                    flush=True,
                )
                time.sleep(max(3.0, float(args.retry_backoff) * 6))
                consecutive_errors = 0

            if args.sleep > 0:
                time.sleep(args.sleep)

            if idx % max(1, int(args.log_every)) == 0 or idx == total:
                elapsed = max(time.time() - started_at, 1e-9)
                speed = idx / elapsed
                eta_sec = (total - idx) / speed if speed > 0 else 0.0
                print(
                    f"[{partition_id}] progress={idx}/{total} success={success} no_data={no_data} "
                    f"errors={errors} rows={inserted_rows} last={last_code} "
                    f"eta={eta_sec / 60:.1f}m elapsed={elapsed / 60:.1f}m",
                    flush=True,
                )
    except KeyboardInterrupt:
        print(f"[{partition_id}] interrupted", flush=True)
    finally:
        # Final checkpoint before exit
        checkpoint(conn, partition_id)
        try:
            data_fetcher._bs_logout()
        except Exception:
            pass
        conn.close()

    check_conn = sqlite3.connect(db_path, timeout=30)
    check_row = check_conn.execute(f"SELECT COUNT(*), COUNT(DISTINCT code) FROM {table}").fetchone()
    check_conn.close()
    print(
        f"[{partition_id}] done total_rows={int(check_row[0])} total_stocks={int(check_row[1])} "
        f"processed={success}+{no_data}+{errors} last_error={last_error_message}",
        flush=True,
    )
    print(f"[{partition_id}] resume_from={last_code}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
