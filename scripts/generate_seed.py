import sqlite3
import json
import time
import sys
import os
import ssl

try:
    import urllib.request
    import urllib.error
except ImportError:
    pass

ssl._create_default_https_context = ssl._create_unverified_context

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'seed.db')

def fetch_json(url, timeout=10):
    req = urllib.request.Request(url, headers={
        'Accept': 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0'
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8', errors='replace'))

def fetch_text(url, timeout=10):
    req = urllib.request.Request(url, headers={
        'Accept': 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0'
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='replace')

def ensure_tables(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS stock_list (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            market TEXT,
            industry TEXT,
            list_date TEXT,
            updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS kline_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            amount REAL,
            change_pct REAL,
            UNIQUE(code, trade_date)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_code_date ON kline_daily(code, trade_date);
        CREATE TABLE IF NOT EXISTS kline_15m (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            trade_time TEXT NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            amount REAL,
            UNIQUE(code, trade_date, trade_time)
        );
        CREATE INDEX IF NOT EXISTS idx_15m_code_date ON kline_15m(code, trade_date);
        CREATE TABLE IF NOT EXISTS kline_5m (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            trade_time TEXT NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            amount REAL,
            UNIQUE(code, trade_date, trade_time)
        );
        CREATE INDEX IF NOT EXISTS idx_5m_code_date ON kline_5m(code, trade_date);
    """)

def sina_symbol(code):
    c = str(code).strip()
    if c.startswith('6') or c.startswith('5') or c.startswith('9'):
        return f'sh{c}'
    if c.startswith('8') or c.startswith('4'):
        return f'bj{c}'
    return f'sz{c}'

def fetch_stock_list():
    all_stocks = []
    page = 1
    page_size = 80
    while True:
        url = f'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page={page}&num={page_size}&sort=changepercent&asc=0&node=hs_a'
        try:
            items = fetch_json(url, 12)
        except Exception as e:
            print(f'  page {page} fetch failed: {e}')
            break
        if not isinstance(items, list) or len(items) == 0:
            break
        for item in items:
            code = str(item.get('code', '')).strip()
            name = str(item.get('name', '')).strip()
            symbol = str(item.get('symbol', '')).strip()
            if not code or not name:
                continue
            market = 'SH' if symbol.startswith('sh') else 'SZ' if symbol.startswith('sz') else 'BJ' if symbol.startswith('bj') else ''
            all_stocks.append({'code': code, 'name': name, 'market': market})
        print(f'  page {page}: got {len(items)} stocks, total {len(all_stocks)}')
        if len(items) < page_size:
            break
        page += 1
        time.sleep(0.1)
    return all_stocks

def fetch_daily_kline(code, data_len=250):
    symbol = sina_symbol(code)
    url = f'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen={data_len}'
    try:
        items = fetch_json(url, 10)
    except:
        return []
    if not isinstance(items, list):
        return []
    rows = []
    for item in items:
        day = str(item.get('day', '')).strip()
        if not day:
            continue
        try:
            o = float(item['open'])
            h = float(item['high'])
            l = float(item['low'])
            c = float(item.get('close', item.get('price', 0)))
            v = float(item['volume'])
            if o > 0 and h > 0 and l > 0 and c > 0:
                rows.append((code, day, o, h, l, c, v))
        except:
            continue
    return rows

def main():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f'Removed old {DB_PATH}')

    db = sqlite3.connect(DB_PATH)
    db.execute('PRAGMA journal_mode=WAL')
    ensure_tables(db)

    print('Fetching A-share stock list from Sina...')
    stocks = fetch_stock_list()
    print(f'Total stocks: {len(stocks)}')

    if len(stocks) == 0:
        print('ERROR: No stocks fetched, aborting.')
        db.close()
        sys.exit(1)

    upsert_stock = db.prepare if hasattr(db, 'prepare') else None
    stock_count = 0
    for stock in stocks:
        try:
            db.execute(
                'INSERT OR REPLACE INTO stock_list (code, name, market, updated_at) VALUES (?, ?, ?, strftime("%s","now"))',
                (stock['code'], stock['name'], stock['market'])
            )
            stock_count += 1
        except Exception as e:
            print(f'  insert stock {stock["code"]} failed: {e}')
    db.commit()
    print(f'Inserted {stock_count} stocks into stock_list')

    print('Fetching daily klines...')
    total_bars = 0
    success = 0
    failed = 0
    total = len(stocks)

    for i, stock in enumerate(stocks):
        code = stock['code']
        name = stock['name']
        try:
            rows = fetch_daily_kline(code, 250)
            if len(rows) > 0:
                db.executemany(
                    'INSERT OR REPLACE INTO kline_daily (code, trade_date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    rows
                )
                db.commit()
                total_bars += len(rows)
                success += 1
            else:
                failed += 1
        except Exception as e:
            print(f'  {code} {name} failed: {e}')
            failed += 1

        if (i + 1) % 100 == 0 or (i + 1) == total:
            print(f'  [{i+1}/{total}] success={success} failed={failed} total_bars={total_bars}')

        time.sleep(0.05)

    print(f'\nSeed DB generated: {DB_PATH}')
    print(f'  Stocks: {stock_count}')
    print(f'  Daily bars: {total_bars}')
    print(f'  Success: {success}, Failed: {failed}')

    cur = db.execute('SELECT COUNT(DISTINCT code) FROM kline_daily WHERE (SELECT COUNT(*) FROM kline_daily kd WHERE kd.code = kline_daily.code) >= 115')
    usable = cur.fetchone()[0]
    print(f'  Usable stocks (>=115 bars): {usable}')

    db.execute('PRAGMA journal_mode=DELETE')
    db.close()
    size_mb = os.path.getsize(DB_PATH) / (1024 * 1024)
    print(f'  File size: {size_mb:.1f} MB')

if __name__ == '__main__':
    main()
