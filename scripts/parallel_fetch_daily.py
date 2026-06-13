"""
Parallel daily kline backfill using baostock.
Splits 5148 stocks into N chunks and runs them in parallel processes.
Defaults to the repo-local work DB at data/trading.db and bootstraps it from
data/seed.db if needed. Refuses to touch the Electron userData DB unless
--allow-user-data-db is passed explicitly.
Usage: PYTHONPATH=python python3 scripts/parallel_fetch_daily.py --workers 5
"""
import argparse
import os
import sys
import time
import sqlite3
import shutil
from datetime import datetime
from pathlib import Path
from multiprocessing import Process, Queue, Value

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

REPO_ROOT = Path(__file__).resolve().parents[1]
SEED_DB_PATH = REPO_ROOT / "data" / "seed.db"
WORK_DB_PATH = REPO_ROOT / "data" / "trading.db"
# TODO: 跨平台路径支持 — 当前仅适配 macOS，需要新增 Windows (APPDATA) 和 Linux (~/.config)
APP_DB_PATH = Path.home() / "Library" / "Application Support" / "stock-trading-simulator" / "stock-trading.db"


def _normalize_path(path: str | os.PathLike[str]) -> Path:
    return Path(path).expanduser().resolve(strict=False)


def _is_app_user_data_db(path: Path) -> bool:
    return _normalize_path(path) == _normalize_path(APP_DB_PATH)


def _resolve_target_db_path(raw_db: str | None) -> Path:
    if raw_db and str(raw_db).strip():
        return _normalize_path(raw_db)
    return _normalize_path(WORK_DB_PATH)


def _bootstrap_work_db(target_path: Path) -> None:
    if target_path == _normalize_path(SEED_DB_PATH) or target_path == _normalize_path(APP_DB_PATH):
        return

    if target_path.exists() and target_path.stat().st_size > 0:
        return

    if not SEED_DB_PATH.exists():
        raise FileNotFoundError(f"Seed database not found: {SEED_DB_PATH}")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SEED_DB_PATH, target_path)
    print(f"  Bootstrapped work DB from seed: {SEED_DB_PATH} -> {target_path}", flush=True)


def writer_loop(db_path: str, queue: Queue, worker_count: int):
    """Owns the only write connection to the target SQLite database."""
    conn = sqlite3.connect(db_path, timeout=120)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=120000")

    inserted = 0
    finished_workers = 0
    while finished_workers < worker_count:
        item = queue.get()
        if item is None:
            finished_workers += 1
            continue

        code, rows = item
        if not rows:
            continue

        conn.executemany(
            "INSERT OR REPLACE INTO kline_daily (code, trade_date, open, high, low, close, volume, amount) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
        inserted += len(rows)
        print(f"  Writer: {code} +{len(rows)} bars (total +{inserted})", flush=True)

    conn.close()
    print(f"Writer done: {inserted} bars inserted", flush=True)


def fetch_chunk(worker_id: int, codes: list[str], queue: Queue, counter: Value, total: int, start_date: str = "2020-01-01"):
    """Workers only fetch network data; the writer process is the single DB writer."""
    import baostock as bs

    bs.login()
    inserted = 0
    failed = 0

    for i, code in enumerate(codes):
        # baostock uses sh.600000 / sz.000001 format
        if code.startswith("6"):
            bs_code = f"sh.{code}"
        elif code.startswith("0") or code.startswith("3"):
            bs_code = f"sz.{code}"
        else:
            continue

        try:
            rs = bs.query_history_k_data_plus(
                bs_code,
                "date,open,high,low,close,volume,amount",
                start_date=start_date,
                end_date=datetime.now().strftime("%Y-%m-%d"),
                frequency="d",
                adjustflag="2",  # qfq
            )
            rows = []
            while rs.error_code == "0" and rs.next():
                row = rs.get_row_data()
                if row[0] and row[2] and row[3] and row[4]:
                    rows.append((
                        code,
                        row[0],       # date
                        float(row[1] or 0),  # open
                        float(row[2] or 0),  # high
                        float(row[3] or 0),  # low
                        float(row[4] or 0),  # close
                        float(row[5] or 0),  # volume
                        float(row[6] or 0),  # amount
                    ))

            if rows:
                queue.put((code, rows))
                inserted += len(rows)

            with counter.get_lock():
                counter.value += 1
                done = counter.value
            if (i + 1) % 20 == 0 or i == 0:
                print(f"  Worker {worker_id}: [{done}/{total}] {code} +{len(rows)} bars (total +{inserted})")

        except Exception as e:
            failed += 1
            if failed <= 5:
                print(f"  Worker {worker_id}: ERROR {code}: {e}")
            time.sleep(0.5)

    queue.put(None)
    bs.logout()
    print(f"Worker {worker_id} done: {inserted} bars fetched, {failed} failed, {len(codes)} stocks processed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--start-idx", type=int, default=0, help="Start index in stock list")
    parser.add_argument("--end-idx", type=int, default=-1, help="End index (-1 = all)")
    parser.add_argument("--start-date", type=str, default="2020-01-01", help="Start date for daily kline (default: 2020-01-01)")
    parser.add_argument("--db", type=str, default=None, help="Target SQLite path. Defaults to data/trading.db.")
    parser.add_argument(
        "--allow-user-data-db",
        action="store_true",
        help="Allow writing to the Electron userData DB path. This is disabled by default.",
    )
    args = parser.parse_args()

    db_path = _resolve_target_db_path(args.db)
    if _is_app_user_data_db(db_path) and not args.allow_user_data_db:
        raise SystemExit(
            "Refusing to write the Electron userData database by default. "
            "Use --allow-user-data-db only when you intentionally want to target the live app DB."
        )

    _bootstrap_work_db(db_path)

    conn = sqlite3.connect(db_path)
    codes = [r[0] for r in conn.execute(
        "SELECT code FROM stock_list WHERE code NOT LIKE 'sh0%' AND code NOT LIKE 'sz39%' ORDER BY code"
    ).fetchall()]
    conn.close()

    if args.end_idx > 0:
        codes = codes[args.start_idx:args.end_idx]
    else:
        codes = codes[args.start_idx:]

    total = len(codes)
    chunk_size = (total + args.workers - 1) // args.workers
    chunks = [codes[i:i + chunk_size] for i in range(0, total, chunk_size)]

    print(f"Fetching daily klines for {total} stocks with {args.workers} workers ({len(chunks)} chunks)")
    print(f"DB: {db_path}")
    print(f"Date range: {args.start_date} ~ {datetime.now().strftime('%Y-%m-%d')}, QFQ adjusted")
    print()

    counter = Value("i", 0)
    write_queue = Queue(maxsize=args.workers * 2)
    writer = Process(target=writer_loop, args=(db_path, write_queue, len(chunks)))
    writer.start()

    processes = []
    for wid, chunk in enumerate(chunks):
        p = Process(target=fetch_chunk, args=(wid, chunk, write_queue, counter, total, args.start_date))
        p.start()
        processes.append(p)

    for p in processes:
        p.join()
    writer.join()

    # Summary
    conn = sqlite3.connect(db_path)
    result = conn.execute(
        "SELECT COUNT(*), COUNT(DISTINCT code), MIN(trade_date), MAX(trade_date) FROM kline_daily WHERE code != 'sh000001'"
    ).fetchone()
    conn.close()
    print(f"\nDone! Total daily bars: {result[0]}, Stocks: {result[1]}, Range: {result[2]} ~ {result[3]}")


if __name__ == "__main__":
    main()
