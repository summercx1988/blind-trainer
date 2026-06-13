import sqlite3
import os
import time
import akshare as ak

DB_DIR = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "stock-trading-simulator")
DB_PATH = os.path.join(DB_DIR, "index_data.db")

MAJOR_INDICES = {
    "sh000001": "上证指数",
    "sz399001": "深证成指",
    "sz399006": "创业板指",
    "sh000300": "沪深300",
    "sh000905": "中证500",
    "sh000016": "上证50",
}

def ensure_db():
    os.makedirs(DB_DIR, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("""
        CREATE TABLE IF NOT EXISTS index_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            amount REAL,
            UNIQUE(code, trade_date)
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_index_daily_code_date ON index_daily(code, trade_date)")
    db.execute("""
        CREATE TABLE IF NOT EXISTS index_meta (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            last_sync TEXT,
            bar_count INTEGER DEFAULT 0
        )
    """)
    db.commit()
    return db

def fetch_index_daily(code, start_date="20200101", end_date=None):
    if end_date is None:
        end_date = time.strftime("%Y%m%d")
    try:
        df = ak.stock_zh_index_daily_em(symbol=code, start_date=start_date, end_date=end_date)
        if df is None or df.empty:
            return None
        col_map = {}
        for c in df.columns:
            cl = c.lower().strip()
            if cl in ("date", "日期", "trade_date"):
                col_map[c] = "trade_date"
            elif cl in ("open", "开盘"):
                col_map[c] = "open"
            elif cl in ("high", "最高"):
                col_map[c] = "high"
            elif cl in ("low", "最低"):
                col_map[c] = "low"
            elif cl in ("close", "收盘"):
                col_map[c] = "close"
            elif cl in ("volume", "成交量"):
                col_map[c] = "volume"
            elif cl in ("amount", "成交额"):
                col_map[c] = "amount"
        df = df.rename(columns=col_map)
        if "trade_date" not in df.columns:
            return None
        df["trade_date"] = df["trade_date"].astype(str).str[:10]
        return df
    except Exception as e:
        print(f"  Error fetching {code}: {e}")
        return None

def sync_index(db, code, name, start_date="20200101"):
    existing = db.execute("SELECT MAX(trade_date) FROM index_daily WHERE code=?", (code,)).fetchone()[0]
    fetch_start = start_date
    if existing:
        from datetime import datetime, timedelta
        ed = datetime.strptime(existing, "%Y-%m-%d")
        fetch_start = (ed + timedelta(days=1)).strftime("%Y%m%d")

    df = fetch_index_daily(code, start_date=fetch_start)
    if df is None:
        print(f"  {code} {name}: no new data")
        return 0

    inserted = 0
    for _, row in df.iterrows():
        try:
            db.execute("""
                INSERT OR REPLACE INTO index_daily (code, trade_date, open, high, low, close, volume, amount)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                code, str(row["trade_date"]),
                float(row.get("open", 0) or 0),
                float(row.get("high", 0) or 0),
                float(row.get("low", 0) or 0),
                float(row.get("close", 0) or 0),
                float(row.get("volume", 0) or 0),
                float(row.get("amount", 0) or 0),
            ))
            inserted += 1
        except Exception:
            pass

    total = db.execute("SELECT COUNT(*) FROM index_daily WHERE code=?", (code,)).fetchone()[0]
    db.execute("""
        INSERT OR REPLACE INTO index_meta (code, name, last_sync, bar_count)
        VALUES (?, ?, ?, ?)
    """, (code, name, time.strftime("%Y-%m-%d %H:%M:%S"), total))
    db.commit()
    print(f"  {code} {name}: +{inserted} bars (total {total})")
    return inserted

def main():
    print(f"Index DB: {DB_PATH}")
    db = ensure_db()

    total_new = 0
    for code, name in MAJOR_INDICES.items():
        print(f"Syncing {code} {name}...")
        n = sync_index(db, code, name, start_date="20200101")
        total_new += n

    print(f"\nDone. Total new bars: {total_new}")

    print("\nSummary:")
    for row in db.execute("SELECT code, name, bar_count, last_sync FROM index_meta ORDER BY code").fetchall():
        print(f"  {row[0]} {row[1]}: {row[2]} bars, last sync {row[3]}")

    db.close()

if __name__ == "__main__":
    main()
