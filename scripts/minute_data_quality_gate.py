#!/usr/bin/env python3
"""Quality gate checks for minute-level market data coverage and integrity."""

import argparse
import json
import os
import sqlite3
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON_DIR = os.path.join(ROOT_DIR, "python")
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

from trading_trainer.db_path import get_primary_db_path  # noqa: E402


@dataclass
class GateConfig:
    period: str
    lookback_days: int
    min_covered_stocks: int
    target_covered_stocks: int
    min_median_trading_days: int
    min_bars_per_day: int
    max_low_bars_ratio: float
    max_lag_trading_days: int
    output_dir: str


def _safe_float(value: float) -> float:
    try:
        value = float(value)
    except Exception:
        return 0.0
    return value if value == value else 0.0


def _pct(value: float) -> float:
    return round(_safe_float(value) * 100.0, 2)


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    if pct <= 0:
        return float(min(values))
    if pct >= 100:
        return float(max(values))
    sorted_values = sorted(float(v) for v in values)
    rank = (pct / 100.0) * (len(sorted_values) - 1)
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    if low == high:
        return sorted_values[low]
    weight = rank - low
    return sorted_values[low] * (1.0 - weight) + sorted_values[high] * weight


def _resolve_db_path(raw_db_path: str) -> str:
    if raw_db_path and raw_db_path != "auto":
        return raw_db_path
    return get_primary_db_path()


def _query_scalar(conn: sqlite3.Connection, sql: str, params: Tuple = ()) -> int:
    row = conn.execute(sql, params).fetchone()
    if not row:
        return 0
    return int(row[0] or 0)


def _build_gate(value, threshold, passed: bool, description: str) -> Dict[str, object]:
    return {
        "value": value,
        "threshold": threshold,
        "pass": bool(passed),
        "description": description,
    }


def run_quality_gate(db_path: str, cfg: GateConfig) -> Dict[str, object]:
    table = f"kline_{cfg.period}m"
    conn = sqlite3.connect(db_path)
    try:
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
            (table,),
        ).fetchone()
        if not table_exists:
            raise RuntimeError(f"table not found: {table}")

        latest_minute_date = conn.execute(f"SELECT MAX(trade_date) FROM {table}").fetchone()[0]
        if not latest_minute_date:
            raise RuntimeError(f"{table} is empty")

        latest_daily_date = conn.execute("SELECT MAX(trade_date) FROM kline_daily").fetchone()[0]
        if not latest_daily_date:
            latest_daily_date = latest_minute_date

        lookback_start = (
            datetime.strptime(str(latest_daily_date), "%Y-%m-%d").date()
            - timedelta(days=max(1, int(cfg.lookback_days)) - 1)
        ).strftime("%Y-%m-%d")

        covered_stocks = _query_scalar(
            conn,
            f"SELECT COUNT(DISTINCT code) FROM {table} WHERE trade_date >= ?",
            (lookback_start,),
        )

        day_count_rows = conn.execute(
            f"""
            SELECT code, COUNT(DISTINCT trade_date) AS day_count
            FROM {table}
            WHERE trade_date >= ?
            GROUP BY code
            """,
            (lookback_start,),
        ).fetchall()
        day_counts = [int(row[1]) for row in day_count_rows]
        median_trading_days = float(statistics.median(day_counts)) if day_counts else 0.0
        p90_trading_days = _percentile(day_counts, 90) if day_counts else 0.0

        day_bar_rows = conn.execute(
            f"""
            SELECT code, trade_date, COUNT(*) AS bar_count
            FROM {table}
            WHERE trade_date >= ?
            GROUP BY code, trade_date
            """,
            (lookback_start,),
        ).fetchall()
        bar_counts = [int(row[2]) for row in day_bar_rows]
        total_code_days = len(day_bar_rows)
        low_bar_days = sum(1 for count in bar_counts if count < cfg.min_bars_per_day)
        low_bar_ratio = (low_bar_days / total_code_days) if total_code_days > 0 else 1.0

        per_stock_low_ratio: Dict[str, List[int]] = {}
        for code, _, bar_count in day_bar_rows:
            per_stock_low_ratio.setdefault(str(code), []).append(int(bar_count))
        stock_low_ratios = [
            sum(1 for value in counts if value < cfg.min_bars_per_day) / max(len(counts), 1)
            for counts in per_stock_low_ratio.values()
        ]
        stocks_low_ratio_gt_20pct = int(sum(1 for ratio in stock_low_ratios if ratio > 0.2))

        max_minute_date = str(latest_minute_date)
        lag_trading_days = _query_scalar(
            conn,
            "SELECT COUNT(DISTINCT trade_date) FROM kline_daily WHERE trade_date > ?",
            (max_minute_date,),
        )

        gates = {
            "covered_stocks": _build_gate(
                covered_stocks,
                f">= {cfg.min_covered_stocks}",
                covered_stocks >= cfg.min_covered_stocks,
                "近 lookback 窗口内有分钟数据的股票数",
            ),
            "median_trading_days": _build_gate(
                round(median_trading_days, 2),
                f">= {cfg.min_median_trading_days}",
                median_trading_days >= cfg.min_median_trading_days,
                "单股票分钟数据覆盖交易日中位数",
            ),
            "low_bar_ratio": _build_gate(
                _pct(low_bar_ratio),
                f"<= {_pct(cfg.max_low_bars_ratio)}%",
                low_bar_ratio <= cfg.max_low_bars_ratio,
                f"code+trade_date 粒度中，bar 数小于 {cfg.min_bars_per_day} 的占比",
            ),
            "data_lag_trading_days": _build_gate(
                lag_trading_days,
                f"<= {cfg.max_lag_trading_days}",
                lag_trading_days <= cfg.max_lag_trading_days,
                "分钟数据相对日线最新交易日的滞后交易日数",
            ),
        }
        overall_pass = all(item["pass"] for item in gates.values())

        gap_to_target = max(0, int(cfg.target_covered_stocks - covered_stocks))
        actions: List[str] = []
        if not gates["covered_stocks"]["pass"]:
            actions.append(
                f"优先扩充分钟数据覆盖股票数，当前 {covered_stocks}，至少补齐到 {cfg.min_covered_stocks}（目标 {cfg.target_covered_stocks}）"
            )
        if not gates["median_trading_days"]["pass"]:
            actions.append(
                f"提高历史深度，中位交易日 {median_trading_days:.1f} < {cfg.min_median_trading_days}"
            )
        if not gates["low_bar_ratio"]["pass"]:
            actions.append(
                f"清洗低完整性交易日，当前低 bar 日占比 {_pct(low_bar_ratio)}% > {_pct(cfg.max_low_bars_ratio)}%"
            )
        if not gates["data_lag_trading_days"]["pass"]:
            actions.append(
                f"补齐最近行情，当前滞后 {lag_trading_days} 个交易日 > {cfg.max_lag_trading_days}"
            )
        if not actions:
            actions.append("数据质量门槛已满足，可进入 walk-forward 与标签实验阶段。")

        report = {
            "type": "minute_data_quality_gate",
            "generated_at": _utc_now_iso(),
            "db_path": db_path,
            "table": table,
            "lookback_start": lookback_start,
            "latest_minute_date": max_minute_date,
            "latest_daily_date": str(latest_daily_date),
            "overall_pass": overall_pass,
            "gates": gates,
            "summary": {
                "covered_stocks": covered_stocks,
                "covered_stocks_target_gap": gap_to_target,
                "median_trading_days": round(median_trading_days, 2),
                "p90_trading_days": round(_safe_float(p90_trading_days), 2),
                "total_code_days": total_code_days,
                "low_bar_days": low_bar_days,
                "low_bar_ratio_pct": _pct(low_bar_ratio),
                "stocks_low_ratio_gt_20pct": stocks_low_ratio_gt_20pct,
                "lag_trading_days": lag_trading_days,
            },
            "recommended_actions": actions,
        }

        os.makedirs(cfg.output_dir, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        report_path = os.path.join(cfg.output_dir, f"minute_quality_{cfg.period}m_{timestamp}.json")
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)

        report["report_path"] = report_path
        return report
    finally:
        conn.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Minute data quality gate for quant model training.")
    parser.add_argument("--db", default="auto", help="SQLite path, or auto (default).")
    parser.add_argument("--period", default="15", choices=["5", "15", "30", "60"], help="Minute period.")
    parser.add_argument("--lookback-days", type=int, default=365, help="Coverage lookback window.")
    parser.add_argument("--min-covered-stocks", type=int, default=300, help="Hard gate for covered stocks.")
    parser.add_argument("--target-covered-stocks", type=int, default=500, help="Target coverage for planning gap.")
    parser.add_argument("--min-median-trading-days", type=int, default=180, help="Hard gate for median stock history depth.")
    parser.add_argument("--min-bars-per-day", type=int, default=14, help="Minimum bars/day considered valid.")
    parser.add_argument("--max-low-bars-ratio", type=float, default=0.05, help="Hard gate for low-bar day ratio.")
    parser.add_argument("--max-lag-trading-days", type=int, default=2, help="Hard gate for data lag (vs kline_daily).")
    parser.add_argument("--output-dir", default=os.path.join("python", "models"), help="Directory for JSON report.")
    return parser.parse_args()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> int:
    args = parse_args()
    cfg = GateConfig(
        period=args.period,
        lookback_days=max(1, int(args.lookback_days)),
        min_covered_stocks=max(1, int(args.min_covered_stocks)),
        target_covered_stocks=max(1, int(args.target_covered_stocks)),
        min_median_trading_days=max(1, int(args.min_median_trading_days)),
        min_bars_per_day=max(1, int(args.min_bars_per_day)),
        max_low_bars_ratio=max(0.0, float(args.max_low_bars_ratio)),
        max_lag_trading_days=max(0, int(args.max_lag_trading_days)),
        output_dir=args.output_dir,
    )
    db_path = _resolve_db_path(args.db)
    report = run_quality_gate(db_path, cfg)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("overall_pass") else 2


if __name__ == "__main__":
    raise SystemExit(main())
