import sys
import json
import time
import sqlite3
import os
import subprocess
import signal
import logging
from datetime import datetime, timedelta

logger = logging.getLogger('data_fetcher')

os.environ["HTTP_PROXY"] = ""
os.environ["HTTPS_PROXY"] = ""
os.environ["http_proxy"] = ""
os.environ["https_proxy"] = ""
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

import requests
_original_requests_get = requests.get

def _patched_get(url, params=None, **kwargs):
    try:
        return _original_requests_get(url, params=params, **kwargs)
    except Exception:
        timeout = kwargs.get("timeout", 15)
        full_url = url
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            full_url = f"{url}?{qs}" if "?" not in url else f"{url}&{qs}"
        result = subprocess.run(
            ["curl", "-s", "--noproxy", "*", "-m", str(timeout),
             "-H", "User-Agent: Mozilla/5.0",
             full_url],
            capture_output=True, text=True, timeout=timeout + 5
        )
        if result.returncode == 0 and result.stdout.strip():
            class CurlResponse:
                status_code = 200
                text = result.stdout
                def json(self_inner):
                    return json.loads(self_inner.text)
                def raise_for_status(self_inner):
                    pass
            return CurlResponse()
        raise requests.ConnectionError(f"curl fallback failed with exit={result.returncode}")

requests.get = _patched_get

import akshare as ak

SINA_KLINE_URL = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"

DB_PATH = None

MAJOR_A_SHARES = [
    {"code": "000001", "name": "平安银行", "industry": "银行"},
    {"code": "000002", "name": "万科A", "industry": "房地产"},
    {"code": "000063", "name": "中兴通讯", "industry": "通信"},
    {"code": "000100", "name": "TCL科技", "industry": "电子"},
    {"code": "000333", "name": "美的集团", "industry": "家电"},
    {"code": "000338", "name": "潍柴动力", "industry": "机械"},
    {"code": "000425", "name": "徐工机械", "industry": "机械"},
    {"code": "000538", "name": "云南白药", "industry": "医药"},
    {"code": "000568", "name": "泸州老窖", "industry": "白酒"},
    {"code": "000596", "name": "古井贡酒", "industry": "白酒"},
    {"code": "000625", "name": "长安汽车", "industry": "汽车"},
    {"code": "000651", "name": "格力电器", "industry": "家电"},
    {"code": "000725", "name": "京东方A", "industry": "电子"},
    {"code": "000768", "name": "中航西飞", "industry": "航空"},
    {"code": "000776", "name": "广发证券", "industry": "券商"},
    {"code": "000858", "name": "五粮液", "industry": "白酒"},
    {"code": "000876", "name": "新希望", "industry": "农业"},
    {"code": "000938", "name": "紫光股份", "industry": "IT"},
    {"code": "000977", "name": "浪潮信息", "industry": "IT"},
    {"code": "001979", "name": "招商蛇口", "industry": "房地产"},
    {"code": "002001", "name": "新和成", "industry": "化工"},
    {"code": "002007", "name": "华兰生物", "industry": "医药"},
    {"code": "002027", "name": "分众传媒", "industry": "传媒"},
    {"code": "002049", "name": "紫光国微", "industry": "芯片"},
    {"code": "002120", "name": "韵达股份", "industry": "物流"},
    {"code": "002142", "name": "宁波银行", "industry": "银行"},
    {"code": "002230", "name": "科大讯飞", "industry": "AI"},
    {"code": "002241", "name": "歌尔股份", "industry": "电子"},
    {"code": "002271", "name": "东方雨虹", "industry": "建材"},
    {"code": "002304", "name": "洋河股份", "industry": "白酒"},
    {"code": "002352", "name": "顺丰控股", "industry": "物流"},
    {"code": "002415", "name": "海康威视", "industry": "安防"},
    {"code": "002460", "name": "赣锋锂业", "industry": "锂电"},
    {"code": "002475", "name": "立讯精密", "industry": "电子"},
    {"code": "002493", "name": "荣盛石化", "industry": "化工"},
    {"code": "002555", "name": "三七互娱", "industry": "游戏"},
    {"code": "002594", "name": "比亚迪", "industry": "汽车"},
    {"code": "002709", "name": "天赐材料", "industry": "锂电"},
    {"code": "002714", "name": "牧原股份", "industry": "农业"},
    {"code": "002736", "name": "国信证券", "industry": "券商"},
    {"code": "002812", "name": "恩捷股份", "industry": "锂电"},
    {"code": "002841", "name": "视源股份", "industry": "电子"},
    {"code": "003816", "name": "中国广核", "industry": "核电"},
    {"code": "600000", "name": "浦发银行", "industry": "银行"},
    {"code": "600009", "name": "上海机场", "industry": "交通"},
    {"code": "600016", "name": "民生银行", "industry": "银行"},
    {"code": "600019", "name": "宝钢股份", "industry": "钢铁"},
    {"code": "600025", "name": "华能水电", "industry": "电力"},
    {"code": "600028", "name": "中国石化", "industry": "石化"},
    {"code": "600029", "name": "南方航空", "industry": "航空"},
    {"code": "600030", "name": "中信证券", "industry": "券商"},
    {"code": "600031", "name": "三一重工", "industry": "机械"},
    {"code": "600036", "name": "招商银行", "industry": "银行"},
    {"code": "600048", "name": "保利发展", "industry": "房地产"},
    {"code": "600050", "name": "中国联通", "industry": "通信"},
    {"code": "600061", "name": "国投资本", "industry": "金融"},
    {"code": "600085", "name": "同仁堂", "industry": "医药"},
    {"code": "600089", "name": "特变电工", "industry": "电气"},
    {"code": "600104", "name": "上汽集团", "industry": "汽车"},
    {"code": "600109", "name": "国金证券", "industry": "券商"},
    {"code": "600111", "name": "北方稀土", "industry": "稀土"},
    {"code": "600115", "name": "东方航空", "industry": "航空"},
    {"code": "600150", "name": "中国船舶", "industry": "造船"},
    {"code": "600176", "name": "中国巨石", "industry": "建材"},
    {"code": "600196", "name": "复星医药", "industry": "医药"},
    {"code": "600276", "name": "恒瑞医药", "industry": "医药"},
    {"code": "600309", "name": "万华化学", "industry": "化工"},
    {"code": "600340", "name": "华夏幸福", "industry": "房地产"},
    {"code": "600346", "name": "恒力石化", "industry": "化工"},
    {"code": "600406", "name": "国电南瑞", "industry": "电气"},
    {"code": "600436", "name": "片仔癀", "industry": "医药"},
    {"code": "600519", "name": "贵州茅台", "industry": "白酒"},
    {"code": "600570", "name": "恒生电子", "industry": "金融IT"},
    {"code": "600585", "name": "海螺水泥", "industry": "建材"},
    {"code": "600588", "name": "用友网络", "industry": "IT"},
    {"code": "600690", "name": "海尔智家", "industry": "家电"},
    {"code": "600745", "name": "闻泰科技", "industry": "半导体"},
    {"code": "600809", "name": "山西汾酒", "industry": "白酒"},
    {"code": "600837", "name": "海通证券", "industry": "券商"},
    {"code": "600845", "name": "宝信软件", "industry": "IT"},
    {"code": "600887", "name": "伊利股份", "industry": "乳业"},
    {"code": "600893", "name": "航发动力", "industry": "航空"},
    {"code": "600900", "name": "长江电力", "industry": "电力"},
    {"code": "600905", "name": "三峡能源", "industry": "新能源"},
    {"code": "601006", "name": "大秦铁路", "industry": "铁路"},
    {"code": "601012", "name": "隆基绿能", "industry": "光伏"},
    {"code": "601066", "name": "中信建投", "industry": "券商"},
    {"code": "601088", "name": "中国神华", "industry": "煤炭"},
    {"code": "601111", "name": "中国国航", "industry": "航空"},
    {"code": "601138", "name": "工业富联", "industry": "电子"},
    {"code": "601166", "name": "兴业银行", "industry": "银行"},
    {"code": "601211", "name": "国泰君安", "industry": "券商"},
    {"code": "601225", "name": "陕西煤业", "industry": "煤炭"},
    {"code": "601228", "name": "广州农商行", "industry": "银行"},
    {"code": "601236", "name": "红塔证券", "industry": "券商"},
    {"code": "601288", "name": "农业银行", "industry": "银行"},
    {"code": "601318", "name": "中国平安", "industry": "保险"},
    {"code": "601328", "name": "交通银行", "industry": "银行"},
    {"code": "601336", "name": "新华保险", "industry": "保险"},
    {"code": "601390", "name": "中国中铁", "industry": "基建"},
    {"code": "601398", "name": "工商银行", "industry": "银行"},
    {"code": "601601", "name": "中国太保", "industry": "保险"},
    {"code": "601628", "name": "中国人寿", "industry": "保险"},
    {"code": "601633", "name": "长城汽车", "industry": "汽车"},
    {"code": "601668", "name": "中国建筑", "industry": "基建"},
    {"code": "601669", "name": "中国电建", "industry": "基建"},
    {"code": "601688", "name": "华泰证券", "industry": "券商"},
    {"code": "601728", "name": "中国电信", "industry": "通信"},
    {"code": "601766", "name": "中国中车", "industry": "轨交"},
    {"code": "601788", "name": "光大证券", "industry": "券商"},
    {"code": "601799", "name": "星宇股份", "industry": "汽车"},
    {"code": "601816", "name": "京沪高铁", "industry": "铁路"},
    {"code": "601857", "name": "中国石油", "industry": "石油"},
    {"code": "601881", "name": "中国银河", "industry": "券商"},
    {"code": "601888", "name": "中国中免", "industry": "免税"},
    {"code": "601899", "name": "紫金矿业", "industry": "矿业"},
    {"code": "601919", "name": "中远海控", "industry": "航运"},
    {"code": "601939", "name": "建设银行", "industry": "银行"},
    {"code": "601985", "name": "中国核电", "industry": "核电"},
    {"code": "601988", "name": "中国银行", "industry": "银行"},
    {"code": "601989", "name": "中国重工", "industry": "造船"},
    {"code": "603259", "name": "药明康德", "industry": "医药"},
    {"code": "603288", "name": "海天味业", "industry": "食品"},
    {"code": "603501", "name": "韦尔股份", "industry": "芯片"},
    {"code": "603799", "name": "华友钴业", "industry": "锂电"},
    {"code": "603986", "name": "兆易创新", "industry": "芯片"},
    {"code": "605117", "name": "德业股份", "industry": "光伏"},
    {"code": "688981", "name": "中芯国际", "industry": "芯片"},
    {"code": "688012", "name": "中微公司", "industry": "半导体"},
]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    ensure_tables(conn)
    return conn


def ensure_tables(conn):
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS stock_list (
            code TEXT PRIMARY KEY,
            name TEXT,
            market TEXT DEFAULT '',
            industry TEXT,
            list_date TEXT DEFAULT '',
            updated_at INTEGER
        )
    """)
    cursor.execute("""
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
            UNIQUE(code, trade_date)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS kline_15m (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            trade_time TEXT,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            amount REAL,
            UNIQUE(code, trade_date, trade_time)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS kline_5m (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            trade_time TEXT,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            amount REAL,
            UNIQUE(code, trade_date, trade_time)
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_kline_daily_code_date ON kline_daily(code, trade_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_kline_15m_code_date ON kline_15m(code, trade_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_kline_5m_code_date ON kline_5m(code, trade_date)")
    conn.commit()
    _ensure_schema_compat(conn)


def _ensure_schema_compat(conn):
    """确保已有表的 schema 与 Electron 兼容（添加缺失列）。"""
    cursor = conn.cursor()
    # stock_list 添加缺失列
    cols = [r[1] for r in cursor.execute("PRAGMA table_info(stock_list)").fetchall()]
    if 'market' not in cols:
        cursor.execute("ALTER TABLE stock_list ADD COLUMN market TEXT DEFAULT ''")
    if 'list_date' not in cols:
        cursor.execute("ALTER TABLE stock_list ADD COLUMN list_date TEXT DEFAULT ''")
    conn.commit()


def log(msg):
    print(json.dumps({"type": "log", "message": msg}), flush=True)


def log_progress(current, total, phase="sync"):
    print(json.dumps({"type": "progress", "phase": phase, "current": current, "total": total}), flush=True)


def log_result(data):
    print(json.dumps({"type": "result", **data}), flush=True)


def fetch_stock_list():
    log("Fetching stock list from akshare...")
    try:
        df = ak.stock_zh_a_spot_em()
        stocks = []
        for _, row in df.iterrows():
            code = str(row.get("代码", "")).strip()
            name = str(row.get("名称", "")).strip()
            if not code or len(code) != 6:
                continue
            stocks.append({
                "code": code,
                "name": name,
                "industry": str(row.get("行业", "")).strip(),
            })
        log(f"Fetched {len(stocks)} stocks from akshare")
        return stocks
    except Exception as e:
        log(f"akshare stock list API unavailable: {e}")
        return []


def sync_stock_list(conn, stocks):
    cursor = conn.cursor()
    count = 0
    for s in stocks:
        cursor.execute("""
            INSERT OR IGNORE INTO stock_list (code, name, industry, updated_at)
            VALUES (?, ?, ?, ?)
        """, (s["code"], s["name"], s.get("industry", ""), int(time.time())))
        if cursor.rowcount > 0:
            count += 1
    conn.commit()
    log(f"Inserted {count} new stocks, total {len(stocks)} processed")
    return count


def _sina_symbol(code):
    if code.startswith(("6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def fetch_daily_kline_sina(code, data_len=1200):
    symbol = _sina_symbol(code)
    url = f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen={data_len}"
    try:
        s = requests.Session()
        s.trust_env = False
        resp = s.get(url, timeout=15)
        items = json.loads(resp.text)
        rows = []
        for item in items:
            rows.append({
                "code": code,
                "trade_date": str(item.get("day", ""))[:10],
                "open": float(item.get("open", 0)),
                "high": float(item.get("high", 0)),
                "low": float(item.get("low", 0)),
                "close": float(item.get("close", 0)),
                "volume": float(item.get("volume", 0)),
                "amount": 0.0,
            })
        return rows
    except Exception as e:
        log(f"Sina daily fetch failed for {code}: {e}")
        return []


def fetch_daily_kline(code, start_date=None, end_date=None):
    rows = fetch_daily_kline_sina(code, 1200)
    if rows:
        if start_date:
            rows = [r for r in rows if r["trade_date"] >= start_date]
        if end_date:
            rows = [r for r in rows if r["trade_date"] <= end_date]
        return rows
    log(f"Sina API failed for {code}, trying akshare...")
    try:
        start = start_date or (datetime.now() - timedelta(days=365)).strftime("%Y%m%d")
        end = end_date or datetime.now().strftime("%Y%m%d")
        df = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start, end_date=end, adjust="qfq")
        rows = []
        for _, row in df.iterrows():
            rows.append({
                "code": code,
                "trade_date": str(row.get("日期", ""))[:10],
                "open": float(row.get("开盘", 0)),
                "high": float(row.get("最高", 0)),
                "low": float(row.get("最低", 0)),
                "close": float(row.get("收盘", 0)),
                "volume": float(row.get("成交量", 0)),
                "amount": float(row.get("成交额", 0)),
            })
        return rows
    except Exception as e:
        log(f"akshare daily also failed for {code}: {e}")
        return []


def _sina_scale(period):
    return {"5": "5", "15": "15", "30": "30", "60": "60"}.get(str(period), "5")


def fetch_minute_kline_sina(code, period="5", data_len=2000):
    symbol = _sina_symbol(code)
    scale = _sina_scale(period)
    url = f"{SINA_KLINE_URL}?symbol={symbol}&scale={scale}&ma=no&datalen={data_len}"
    try:
        s = requests.Session()
        s.trust_env = False
        resp = s.get(url, timeout=15)
        items = json.loads(resp.text)
        rows = []
        for item in items:
            day_str = str(item.get("day", ""))
            if " " in day_str:
                trade_date, trade_time = day_str.split(" ", 1)
            else:
                trade_date = day_str[:10]
                trade_time = day_str[11:] if len(day_str) > 10 else "00:00"
            rows.append({
                "code": code,
                "trade_date": trade_date[:10],
                "trade_time": trade_time[:5],
                "open": float(item.get("open", 0)),
                "high": float(item.get("high", 0)),
                "low": float(item.get("low", 0)),
                "close": float(item.get("close", 0)),
                "volume": float(item.get("volume", 0)),
                "amount": 0.0,
            })
        return rows
    except Exception as e:
        return []


def _bs_prefix(code):
    return f"{'sh' if code.startswith('6') else 'sz'}.{code}"


_bs_logged_in = False


class _TimeoutGuard:
    def __init__(self, seconds):
        self.seconds = int(seconds or 0)
        self._enabled = hasattr(signal, "SIGALRM") and self.seconds > 0
        self._old_handler = None

    def _handle_timeout(self, _signum, _frame):
        raise TimeoutError(f"operation timeout after {self.seconds}s")

    def __enter__(self):
        if self._enabled:
            self._old_handler = signal.getsignal(signal.SIGALRM)
            signal.signal(signal.SIGALRM, self._handle_timeout)
            signal.alarm(self.seconds)
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        if self._enabled:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, self._old_handler)
        return False


def _is_bs_transient_error(error):
    msg = str(error or "").lower()
    transient_keywords = [
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
    return any(keyword in msg for keyword in transient_keywords)


def _bs_ensure_login(force_reconnect=False):
    global _bs_logged_in
    import baostock as bs
    if force_reconnect and _bs_logged_in:
        try:
            bs.logout()
        except Exception:
            pass
        _bs_logged_in = False
    if not _bs_logged_in:
        with _TimeoutGuard(15):
            result = bs.login()
        if getattr(result, "error_code", "0") != "0":
            _bs_logged_in = False
            raise RuntimeError(f"baostock login failed: {result.error_code} {getattr(result, 'error_msg', '')}")
        _bs_logged_in = True


def _bs_logout():
    global _bs_logged_in
    import baostock as bs
    if not _bs_logged_in:
        return
    try:
        bs.logout()
    except Exception:
        pass
    finally:
        _bs_logged_in = False


def fetch_minute_kline_baostock(code, period="15", retries=3, retry_backoff=0.8, query_timeout=45, start_date="2021-01-01"):
    import baostock as bs
    max_retries = max(1, int(retries))
    last_error = None
    for attempt in range(max_retries):
        try:
            _bs_ensure_login(force_reconnect=attempt > 0)
            with _TimeoutGuard(query_timeout):
                rs = bs.query_history_k_data_plus(
                    _bs_prefix(code),
                    "date,time,open,high,low,close,volume,amount",
                    start_date=start_date,
                    end_date=datetime.now().strftime("%Y-%m-%d"),
                    frequency=period,
                    adjustflag="2",
                )
            if getattr(rs, "error_code", "0") != "0":
                raise RuntimeError(f"baostock query failed: {rs.error_code} {getattr(rs, 'error_msg', '')}")

            rows = []
            with _TimeoutGuard(query_timeout):
                while (rs.error_code == "0") and rs.next():
                    r = rs.get_row_data()
                    time_raw = str(r[1] or "")
                    if len(time_raw) < 12:
                        continue
                    rows.append({
                        "code": code,
                        "trade_date": r[0],
                        "trade_time": f"{time_raw[8:10]}:{time_raw[10:12]}",
                        "open": float(r[2]),
                        "high": float(r[3]),
                        "low": float(r[4]),
                        "close": float(r[5]),
                        "volume": float(r[6]),
                        "amount": float(r[7]),
                    })
            log(f"  baostock returned {len(rows)} bars for {code} {period}m")
            return rows
        except Exception as e:
            last_error = e
            _bs_logout()
            if attempt + 1 < max_retries and _is_bs_transient_error(e):
                wait_sec = retry_backoff * (attempt + 1)
                log(f"  baostock transient error for {code} {period}m, retry {attempt + 2}/{max_retries} in {wait_sec:.1f}s: {e}")
                time.sleep(wait_sec)
                continue
            log(f"  baostock failed for {code} {period}m: {e}")
            return []

    if last_error:
        log(f"  baostock failed for {code} {period}m: {last_error}")
    return []


def fetch_minute_kline(code, period="15"):
    # baostock first — 5 years of 15min history (~20000 bars)
    rows = fetch_minute_kline_baostock(code, period)
    if rows:
        return rows
    # Fallback to Sina (~5000 bars)
    rows = fetch_minute_kline_sina(code, period, 5000)
    if rows:
        log(f"  Sina fallback returned {len(rows)} bars for {code} {period}m")
    return rows


def insert_daily_rows(conn, rows):
    if not rows:
        return 0
    cursor = conn.cursor()
    count = 0
    for r in rows:
        if not r["trade_date"]:
            continue
        cursor.execute("""
            INSERT OR REPLACE INTO kline_daily (code, trade_date, open, high, low, close, volume, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (r["code"], r["trade_date"], r["open"], r["high"], r["low"], r["close"], r["volume"], r["amount"]))
        if cursor.rowcount > 0:
            count += 1
    conn.commit()
    return count


def insert_minute_rows(conn, rows, table):
    if not rows:
        return 0
    cursor = conn.cursor()
    count = 0
    for r in rows:
        if not r["trade_date"] or not r["trade_time"]:
            continue
        cursor.execute(f"""
            INSERT OR REPLACE INTO {table} (code, trade_date, trade_time, open, high, low, close, volume, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (r["code"], r["trade_date"], r["trade_time"], r["open"], r["high"], r["low"], r["close"], r["volume"], r["amount"]))
        if cursor.rowcount > 0:
            count += 1
    conn.commit()
    return count


def select_stocks_for_sync(conn, count):
    cursor = conn.cursor()
    cursor.execute("""
        SELECT code, name FROM stock_list
        WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%'
        ORDER BY RANDOM() LIMIT ?
    """, (count,))
    return [dict(row) for row in cursor.fetchall()]


def cmd_init(db_path):
    global DB_PATH
    DB_PATH = db_path
    conn = get_db()

    stocks = fetch_stock_list()
    if not stocks:
        log("akshare stock list API unavailable, using built-in major A-share list")
        stocks = MAJOR_A_SHARES

    stock_count = sync_stock_list(conn, stocks)

    log(f"Fetching daily kline for top {min(len(stocks), 30)} stocks...")
    top_stocks = stocks[:30]
    total_daily = 0
    for i, s in enumerate(top_stocks):
        log_progress(i + 1, len(top_stocks), "daily")
        log(f"Fetching daily kline for {s['code']} ({s.get('name', '')}) [{i + 1}/{len(top_stocks)}]")
        rows = fetch_daily_kline(s["code"])
        inserted = insert_daily_rows(conn, rows)
        total_daily += inserted
        log(f"  -> {inserted} bars inserted for {s['code']}")
        time.sleep(0.3)

    conn.close()

    log_result({
        "stocksFetched": len(stocks),
        "stocksInserted": stock_count,
        "dailyBarsInserted": total_daily,
    })


def cmd_sync(db_path, count, periods):
    global DB_PATH
    DB_PATH = db_path
    conn = get_db()
    count = max(5, min(int(count), 100))

    stocks = select_stocks_for_sync(conn, count)
    if not stocks:
        online_stocks = fetch_stock_list()
        if online_stocks:
            sync_stock_list(conn, online_stocks)
        else:
            sync_stock_list(conn, MAJOR_A_SHARES)
        stocks = select_stocks_for_sync(conn, count)

    log(f"Selected {len(stocks)} stocks for sync")

    total_daily = 0
    total_15m = 0
    total_5m = 0

    for i, s in enumerate(stocks):
        code = s["code"]
        log_progress(i + 1, len(stocks), "sync")
        log(f"Syncing {code} ({s.get('name', '')}) [{i + 1}/{len(stocks)}]")

        if "daily" in periods:
            rows = fetch_daily_kline(code)
            total_daily += insert_daily_rows(conn, rows)
            time.sleep(0.3)

        if "15m" in periods:
            rows = fetch_minute_kline(code, "15")
            total_15m += insert_minute_rows(conn, rows, "kline_15m")
            time.sleep(0.3)

        if "5m" in periods:
            rows = fetch_minute_kline(code, "5")
            total_5m += insert_minute_rows(conn, rows, "kline_5m")
            time.sleep(0.3)

    conn.close()

    log_result({
        "stocksSynced": len(stocks),
        "dailyBarsInserted": total_daily,
        "m15BarsInserted": total_15m,
        "m5BarsInserted": total_5m,
    })


def cmd_sync_5m(db_path, code, start_date, end_date):
    global DB_PATH
    DB_PATH = db_path
    conn = get_db()
    rows = fetch_minute_kline(code, "5")
    inserted = insert_minute_rows(conn, rows, "kline_5m")
    conn.close()
    log_result({"code": code, "m5BarsInserted": inserted})


def cmd_sync_list(db_path):
    global DB_PATH
    DB_PATH = db_path
    conn = get_db()
    stocks = fetch_stock_list()
    if not stocks:
        stocks = MAJOR_A_SHARES
    count = sync_stock_list(conn, stocks)
    conn.close()
    log_result({"stocksInserted": count})


def select_stocks_by_daily_count(conn, count):
    cursor = conn.cursor()
    cursor.execute("""
        SELECT k.code, COALESCE(s.name, '') as name, COUNT(*) as bar_count
        FROM kline_daily k
        LEFT JOIN stock_list s ON k.code = s.code
        GROUP BY k.code
        HAVING bar_count >= 60
        ORDER BY bar_count DESC
        LIMIT ?
    """, (count,))
    return [dict(row) for row in cursor.fetchall()]


def cmd_sync_5m_batch(db_path, count=120):
    global DB_PATH
    DB_PATH = db_path
    conn = get_db()

    stocks = select_stocks_by_daily_count(conn, count)
    if not stocks:
        log("No stocks with sufficient daily data found, falling back to built-in list")
        codes = [s["code"] for s in MAJOR_A_SHARES[:count]]
    else:
        codes = [s["code"] for s in stocks]

    log(f"Batch syncing 5min data for {len(codes)} stocks")
    total_inserted = 0
    total_failed = 0

    for i, code in enumerate(codes):
        log_progress(i + 1, len(codes), "5m_batch")
        log(f"Fetching 5m for {code} [{i + 1}/{len(codes)}]")
        rows = fetch_minute_kline(code, "5")
        if rows:
            inserted = insert_minute_rows(conn, rows, "kline_5m")
            total_inserted += inserted
            log(f"  -> {inserted} 5m bars inserted for {code}")
        else:
            total_failed += 1
            log(f"  -> no 5m data for {code}")
        time.sleep(0.3)

    conn.close()
    log_result({
        "stocksAttempted": len(codes),
        "stocksFailed": total_failed,
        "m5BarsInserted": total_inserted,
    })


def cmd_sync_minute_batch(db_path, period="15", count=120):
    global DB_PATH
    DB_PATH = db_path
    table = f"kline_{period}m"
    conn = get_db()

    cursor = conn.cursor()
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {table} (
            code TEXT, trade_date TEXT, trade_time TEXT,
            open REAL, high REAL, low REAL, close REAL,
            volume REAL, amount REAL,
            UNIQUE(code, trade_date, trade_time)
        )
    """)
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_code ON {table}(code)")
    conn.commit()

    stocks = select_stocks_by_daily_count(conn, count)
    if not stocks:
        codes = [s["code"] for s in MAJOR_A_SHARES[:count]]
    else:
        codes = [s["code"] for s in stocks]

    log(f"Batch syncing {period}min data for {len(codes)} stocks")
    total_inserted = 0
    total_failed = 0

    for i, code in enumerate(codes):
        log_progress(i + 1, len(codes), f"{period}m_batch")
        log(f"Fetching {period}m for {code} [{i + 1}/{len(codes)}]")
        rows = fetch_minute_kline(code, period)
        if rows:
            inserted = insert_minute_rows(conn, rows, table)
            total_inserted += inserted
            log(f"  -> {inserted} {period}m bars inserted for {code}")
        else:
            total_failed += 1
            log(f"  -> no {period}m data for {code}")
        time.sleep(0.3)

    conn.close()
    _bs_logout()
    log_result({
        "stocksAttempted": len(codes),
        "stocksFailed": total_failed,
        "barsInserted": total_inserted,
    })


def cmd_sync_minute_extended(db_path, period="15", limit=500):
    global DB_PATH
    DB_PATH = db_path
    table = f"kline_{period}m"
    conn = get_db()

    cursor = conn.cursor()
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {table} (
            code TEXT, trade_date TEXT, trade_time TEXT,
            open REAL, high REAL, low REAL, close REAL,
            volume REAL, amount REAL,
            UNIQUE(code, trade_date, trade_time)
        )
    """)
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_code ON {table}(code)")
    conn.commit()

    # Find stocks with existing minute data but fewer than 3000 bars
    cursor.execute(f"""
        SELECT code, COUNT(*) as bar_count
        FROM {table}
        GROUP BY code
        HAVING bar_count < 3000
        ORDER BY bar_count ASC
        LIMIT ?
    """, (limit,))
    short_stocks = cursor.fetchall()

    if not short_stocks:
        log("All existing stocks have >= 3000 bars. Nothing to extend.")
        conn.close()
        log_result({"extended": 0, "stocksAttempted": 0})
        return

    log(f"Found {len(short_stocks)} stocks with < 3000 {period}m bars to extend")

    total_before = 0
    total_after = 0
    total_failed = 0

    for i, (code, before_count) in enumerate(short_stocks):
        log_progress(i + 1, len(short_stocks), f"{period}m_ext")
        log(f"Extending {code} [{i+1}/{len(short_stocks)}] (current: {before_count} bars)")
        total_before += before_count

        rows = fetch_minute_kline(code, period)
        if rows:
            inserted = insert_minute_rows(conn, rows, table)
            cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE code = ?", (code,))
            after_count = cursor.fetchone()[0]
            total_after += after_count
            log(f"  -> {code}: {before_count} -> {after_count} bars (+{after_count - before_count})")
        else:
            total_failed += 1
            total_after += before_count
            log(f"  -> {code}: no data returned")

        time.sleep(0.5)

    conn.close()
    _bs_logout()
    log_result({
        "stocksAttempted": len(short_stocks),
        "stocksFailed": total_failed,
        "barsBefore": total_before,
        "barsAfter": total_after,
        "barsGained": total_after - total_before,
    })


def resolve_db_path(arg_path):
    if arg_path and arg_path != "auto":
        return arg_path
    # Use unified path resolution (same as Electron)
    from trading_trainer.db_path import get_primary_db_path
    return get_primary_db_path()


def main():
    if len(sys.argv) < 2:
        print("Usage: python data_fetcher.py <command> [db_path] [args...]")
        print("Commands: init, sync, sync_5m, sync_list, sync_5m_batch, sync_minute_batch, sync_minute_extended")
        print("db_path: 'auto' (default) or explicit path")
        sys.exit(1)

    command = sys.argv[1]
    db_path = resolve_db_path(sys.argv[2] if len(sys.argv) > 2 else "auto")

    if command == "init":
        cmd_init(db_path)
    elif command == "sync":
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        periods = sys.argv[4].split(",") if len(sys.argv) > 4 else ["daily", "15m"]
        cmd_sync(db_path, count, periods)
    elif command == "sync_5m":
        code = sys.argv[3] if len(sys.argv) > 3 else ""
        start_date = sys.argv[4] if len(sys.argv) > 4 else ""
        end_date = sys.argv[5] if len(sys.argv) > 5 else ""
        cmd_sync_5m(db_path, code, start_date, end_date)
    elif command == "sync_list":
        cmd_sync_list(db_path)
    elif command == "sync_5m_batch":
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 120
        cmd_sync_5m_batch(db_path, count)
    elif command == "sync_minute_batch":
        period = sys.argv[3] if len(sys.argv) > 3 else "15"
        count = int(sys.argv[4]) if len(sys.argv) > 4 else 120
        cmd_sync_minute_batch(db_path, period, count)
    elif command == "sync_minute_extended":
        period = sys.argv[3] if len(sys.argv) > 3 else "15"
        limit = int(sys.argv[4]) if len(sys.argv) > 4 else 500
        cmd_sync_minute_extended(db_path, period, limit)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
