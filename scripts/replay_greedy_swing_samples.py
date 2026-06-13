import json
from pathlib import Path

from trading_trainer.labeling.swing_labeler import (
    TrendSwingPairConfig,
    find_trend_swing_pairs,
    load_kline_daily,
)
from trading_trainer.labeling.trend_indicators import compute_all_trend_indicators


DB_PATH = "data/trading.db"
SAMPLE_CODES = [
    "000001",
    "000002",
    "000008",
    "000063",
    "000333",
    "002594",
    "300750",
    "600036",
    "600519",
    "601318",
]


def build_cfg(mode: str, use_l1: bool = True) -> TrendSwingPairConfig:
    if mode == "loose":
        return TrendSwingPairConfig(
            adx_trend_threshold=14.0,
            min_profit_pct=6.0,
            min_hold_days=4,
            max_hold_days=35,
            swing_left=3,
            swing_right=2,
            pullback_tolerance_pct=6.0,
            forward_days=35,
            min_lookback=60,
            lookback_bars=1250,
            min_required_bars=180,
            require_ma20_slope_positive=True,
            ma20_slope_consecutive_days=2,
            min_daily_amount_wan=2000.0,
            max_consecutive_limit_up=2,
            min_listing_days=60,
            max_drawdown_exit_pct=40.0,
            require_tradability_filter=True,
            beam_width=3,
            pending_buy_limit=4,
            segment_min_days=5,
            segment_min_rise_pct=6.0,
            max_gap_days=3,
            use_weekly_anchor=True,
            weekly_min_weeks=2,
            weekly_max_gap_weeks=1,
            weekly_two_bar_min_rise_pct=3.5,
            weekly_segment_min_rise_pct=6.0,
            weekly_lower_shadow_ratio=0.35,
            weekly_recover_min_rise_pct=0.3,
            weekly_ma5_slope_min=-0.1,
            use_l1_filter=use_l1,
            l1_lambda=14.0 if use_l1 else 0.0,
            l1_irls_iters=4,
            l1_cg_iters=80,
            l1_eps=1e-4,
            l1_min_slope_pct=0.04,
            l1_min_gap_bars=2,
        )
    return TrendSwingPairConfig(
        adx_trend_threshold=18.0,
        min_profit_pct=8.0,
        min_hold_days=5,
        max_hold_days=30,
        swing_left=3,
        swing_right=2,
        pullback_tolerance_pct=5.0,
        forward_days=30,
        min_lookback=60,
        lookback_bars=1250,
        min_required_bars=180,
        require_ma20_slope_positive=True,
        ma20_slope_consecutive_days=3,
        min_daily_amount_wan=3000.0,
        max_consecutive_limit_up=2,
        min_listing_days=60,
        max_drawdown_exit_pct=35.0,
        require_tradability_filter=True,
        beam_width=3,
        pending_buy_limit=3,
        segment_min_days=5,
        segment_min_rise_pct=8.0,
        max_gap_days=2,
        use_weekly_anchor=True,
        weekly_min_weeks=2,
        weekly_max_gap_weeks=1,
        weekly_two_bar_min_rise_pct=4.0,
        weekly_segment_min_rise_pct=8.0,
        weekly_lower_shadow_ratio=0.4,
        weekly_recover_min_rise_pct=0.5,
        weekly_ma5_slope_min=0.0,
        use_l1_filter=use_l1,
        l1_lambda=18.0 if use_l1 else 0.0,
        l1_irls_iters=4,
        l1_cg_iters=80,
        l1_eps=1e-4,
        l1_min_slope_pct=0.05,
        l1_min_gap_bars=3,
    )


def replay_code(code: str, cfg: TrendSwingPairConfig) -> dict:
    df = load_kline_daily(DB_PATH, code, lookback_bars=cfg.lookback_bars)
    df = compute_all_trend_indicators(df)
    pairs = find_trend_swing_pairs(df, code, cfg)

    pair_summaries = []
    for pair in pairs:
        pair_summaries.append({
            "buy_date": pair["buy_date"],
            "sell_date": pair["sell_date"],
            "buy_price": round(float(pair["buy_price"]), 2),
            "sell_price": round(float(pair["sell_price"]), 2),
            "profit_pct": round(float(pair["profit_pct"]), 2),
            "hold_days": int(pair["hold_days"]),
            "exit_reason": pair["exit_reason"],
        })

    avg_profit = round(sum(p["profit_pct"] for p in pair_summaries) / len(pair_summaries), 2) if pair_summaries else 0.0
    avg_hold = round(sum(p["hold_days"] for p in pair_summaries) / len(pair_summaries), 2) if pair_summaries else 0.0
    return {
        "code": code,
        "bars": len(df),
        "start": df["trade_date"].iloc[0] if len(df) else "",
        "end": df["trade_date"].iloc[-1] if len(df) else "",
        "pair_count": len(pair_summaries),
        "avg_profit_pct": avg_profit,
        "avg_hold_days": avg_hold,
        "pairs": pair_summaries,
    }


def main() -> None:
    modes = {
        "strict_base": build_cfg("strict", use_l1=False),
        "strict_l1": build_cfg("strict", use_l1=True),
        "loose_base": build_cfg("loose", use_l1=False),
        "loose_l1": build_cfg("loose", use_l1=True),
    }
    mode_results = {}
    for mode_name, cfg in modes.items():
        mode_results[mode_name] = {
            "config": {
                "adx_trend_threshold": cfg.adx_trend_threshold,
                "min_profit_pct": cfg.min_profit_pct,
                "min_hold_days": cfg.min_hold_days,
                "max_hold_days": cfg.max_hold_days,
                "lookback_bars": cfg.lookback_bars,
                "beam_width": cfg.beam_width,
                "pending_buy_limit": cfg.pending_buy_limit,
                "use_weekly_anchor": cfg.use_weekly_anchor,
                "weekly_min_weeks": cfg.weekly_min_weeks,
                "weekly_two_bar_min_rise_pct": cfg.weekly_two_bar_min_rise_pct,
                "weekly_segment_min_rise_pct": cfg.weekly_segment_min_rise_pct,
                "use_l1_filter": cfg.use_l1_filter,
                "l1_lambda": cfg.l1_lambda,
                "l1_min_slope_pct": cfg.l1_min_slope_pct,
                "l1_min_gap_bars": cfg.l1_min_gap_bars,
            },
            "results": [replay_code(code, cfg) for code in SAMPLE_CODES],
        }
    out = mode_results
    out_path = Path("artifacts/greedy_swing_sample_replay.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
