#!/usr/bin/env python3
"""Compare two walk-forward reports with stability diagnostics."""

import argparse
import json
import os
from datetime import datetime, timezone
from typing import Dict, List


def _safe_float(value: float) -> float:
    try:
        value = float(value)
    except Exception:
        return 0.0
    return value if value == value else 0.0


def _calc_stability_from_windows(windows: List[Dict[str, object]]) -> Dict[str, float]:
    valid = [w for w in windows if "error" not in w]
    if not valid:
        return {
            "valid_window_count": 0,
            "max_positive_return_window_share": 0.0,
            "max_abs_return_window_share": 0.0,
            "max_trade_window_share": 0.0,
        }

    window_returns = [
        _safe_float(w.get("metrics_conservative", {}).get("cumulative_return", 0.0))
        for w in valid
    ]
    window_trades = [int(w.get("executed_trade_count", 0)) for w in valid]

    positive = [value for value in window_returns if value > 0]
    positive_sum = float(sum(positive)) if positive else 0.0
    max_positive_share = (max(positive) / positive_sum) if positive_sum > 0 else 0.0

    abs_returns = [abs(value) for value in window_returns]
    abs_sum = float(sum(abs_returns)) if abs_returns else 0.0
    max_abs_share = (max(abs_returns) / abs_sum) if abs_sum > 0 else 0.0

    trade_sum = int(sum(window_trades))
    max_trade_share = (max(window_trades) / trade_sum) if trade_sum > 0 else 0.0

    return {
        "valid_window_count": len(valid),
        "max_positive_return_window_share": round(_safe_float(max_positive_share), 6),
        "max_abs_return_window_share": round(_safe_float(max_abs_share), 6),
        "max_trade_window_share": round(_safe_float(max_trade_share), 6),
    }


def _load_report(path: str) -> Dict[str, object]:
    with open(path, "r", encoding="utf-8") as handle:
        report = json.load(handle)
    windows = report.get("windows", [])
    stability = report.get("stability_summary")
    if not isinstance(stability, dict):
        stability = _calc_stability_from_windows(windows if isinstance(windows, list) else [])
    return {
        "path": os.path.abspath(path),
        "dataset_id": str(report.get("dataset_id", "")),
        "spec_version": str(report.get("spec_version", "")),
        "avg_auc": _safe_float(report.get("avg_auc", 0.0)),
        "avg_f1": _safe_float(report.get("avg_f1", 0.0)),
        "windows_total": int(report.get("windows_total", 0)),
        "windows_valid": int(report.get("windows_valid", 0)),
        "oos_executed_trade_count": int(report.get("oos_executed_trade_count", 0)),
        "oos_cumulative_return": _safe_float(
            (report.get("oos_portfolio") or {}).get("cumulative_return", 0.0)
        ),
        "oos_win_rate": _safe_float(
            (report.get("oos_portfolio") or {}).get("win_rate", 0.0)
        ),
        "oos_sharpe": _safe_float(
            (report.get("oos_portfolio") or {}).get("sharpe_ratio", 0.0)
        ),
        "stability_summary": stability,
    }


def _diff(left: Dict[str, object], right: Dict[str, object], key: str) -> float:
    return _safe_float(right.get(key, 0.0)) - _safe_float(left.get(key, 0.0))


def compare_reports(left_path: str, right_path: str) -> Dict[str, object]:
    left = _load_report(left_path)
    right = _load_report(right_path)

    comparison = {
        "generated_at": _utc_now_iso(),
        "left": left,
        "right": right,
        "delta": {
            "avg_auc": round(_diff(left, right, "avg_auc"), 6),
            "avg_f1": round(_diff(left, right, "avg_f1"), 6),
            "oos_cumulative_return": round(_diff(left, right, "oos_cumulative_return"), 6),
            "oos_win_rate": round(_diff(left, right, "oos_win_rate"), 6),
            "oos_sharpe": round(_diff(left, right, "oos_sharpe"), 6),
            "oos_executed_trade_count": int(right["oos_executed_trade_count"] - left["oos_executed_trade_count"]),
            "max_positive_return_window_share": round(
                _safe_float(right["stability_summary"].get("max_positive_return_window_share", 0.0))
                - _safe_float(left["stability_summary"].get("max_positive_return_window_share", 0.0)),
                6,
            ),
            "max_trade_window_share": round(
                _safe_float(right["stability_summary"].get("max_trade_window_share", 0.0))
                - _safe_float(left["stability_summary"].get("max_trade_window_share", 0.0)),
                6,
            ),
        },
    }
    return comparison


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare two walk-forward JSON reports.")
    parser.add_argument("--left", required=True, help="Baseline report path.")
    parser.add_argument("--right", required=True, help="New report path.")
    parser.add_argument("--output", default="", help="Optional output JSON path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = compare_reports(args.left, args.right)
    if args.output:
        output_path = os.path.abspath(args.output)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
        result["output_path"] = output_path
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
