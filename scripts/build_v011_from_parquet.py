"""
Build v011 features from existing v010 parquet + SQLite raw klines.

Reads the v010 train/valid/test parquets, extracts (code, bar_timestamp) pairs,
loads raw klines from SQLite, computes v011-only new factors via FeatureBuilder,
and saves the augmented parquets.
"""
import os
import sys
import sqlite3
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from trading_trainer.features.specs import V011_FEATURE_SPEC
from trading_trainer.db_path import get_primary_db_path

DATASET_DIR = "features/ds_e5768966645c4321"
SRC_SPEC = "feature_spec_v010"
DST_SPEC = f"feature_spec_{V011_FEATURE_SPEC.version}"


def load_klines_for_code(conn, code, period="1d"):
    if period in ("15m", "15min"):
        table = "kline_15m"
        query = f"SELECT trade_date, trade_time, open, high, low, close, volume FROM {table} WHERE code=? ORDER BY trade_date, trade_time"
    else:
        table = "kline_daily"
        query = f"SELECT trade_date, open, high, low, close, volume FROM {table} WHERE code=? ORDER BY trade_date"
    rows = conn.execute(query, (code,)).fetchall()
    if not rows:
        return pd.DataFrame()

    if period in ("15m", "15min"):
        df = pd.DataFrame(rows, columns=["trade_date", "trade_time", "open", "high", "low", "close", "volume"])
        df["date"] = df["trade_date"]
    else:
        df = pd.DataFrame(rows, columns=["trade_date", "open", "high", "low", "close", "volume"])
        df["date"] = df["trade_date"]

    for c in ["open", "high", "low", "close", "volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def compute_v011_factors(working):
    """Compute v011-only new factors from OHLCV working dataframe."""
    from trading_trainer.labeling.trend_indicators import (
        compute_adx, find_swing_points,
        get_nearest_swing_high, get_nearest_swing_low,
    )

    result = {}

    # ADX trend strength
    adx_df = compute_adx(working)
    result["adx"] = adx_df["adx"].fillna(0)
    result["plus_di"] = adx_df["plus_di"].fillna(0)
    result["minus_di"] = adx_df["minus_di"].fillna(0)
    result["adx_slope_5d"] = (result["adx"] - result["adx"].shift(5)).fillna(0)

    # Trend efficiency
    close_diff = working["close"].diff()
    abs_path = close_diff.abs().rolling(20, min_periods=5).sum()
    net_displacement = (working["close"] - working["close"].shift(20)).abs()
    result["efficiency_ratio"] = (net_displacement / abs_path.replace(0, np.nan)).fillna(0)

    gain_14 = working["close"].diff().clip(lower=0)
    loss_14 = (-working["close"].diff()).clip(lower=0)
    result["chande_cmo_14"] = (
        100 * (gain_14.rolling(14, min_periods=14).sum() - loss_14.rolling(14, min_periods=14).sum())
        / (gain_14.rolling(14, min_periods=14).sum() + loss_14.rolling(14, min_periods=14).sum()).replace(0, np.nan)
    ).fillna(0)

    low_20 = working["close"].rolling(20, min_periods=10).min()
    high_20 = working["close"].rolling(20, min_periods=10).max()
    result["price_percentile_20d"] = (
        (working["close"] - low_20) / (high_20 - low_20).replace(0, np.nan) * 100
    ).fillna(50)

    # Pullback quality
    high_20d_max = working["high"].rolling(20, min_periods=5).max()
    result["pullback_depth_pct"] = (
        (working["low"] - high_20d_max) / high_20d_max.replace(0, np.nan) * 100
    ).clip(upper=0).fillna(0)

    vol_max_5d = working["volume"].rolling(5, min_periods=3).max()
    result["pullback_vol_shrink"] = (working["volume"] / vol_max_5d.replace(0, np.nan)).fillna(1)

    returns_1d = working["close"].pct_change().fillna(0)
    decline_5d = returns_1d.rolling(5, min_periods=3).sum().clip(upper=0)
    recovery_3d = returns_1d.rolling(3, min_periods=2).sum().clip(lower=0)
    result["pullback_recovery_ratio"] = (
        (-recovery_3d / decline_5d.replace(0, np.nan)).clip(lower=-10, upper=10)
    ).fillna(0)

    is_bull_vol = working["volume"].where(working["close"] > working["close"].shift(1), 0)
    result["bull_vol_ratio_10d"] = (
        is_bull_vol.rolling(10, min_periods=5).sum() / working["volume"].rolling(10, min_periods=5).sum().replace(0, np.nan)
    ).fillna(0.5)

    # Swing structure
    is_new_high = (working["high"] > high_20d_max.shift(1)).astype(float)
    result["higher_high_count_20d"] = is_new_high.rolling(20, min_periods=1).sum().fillna(0)

    swings = find_swing_points(working["high"], working["low"], left=5, right=3)
    n_rows = len(working)
    sh_dist = np.zeros(n_rows)
    sl_dist = np.zeros(n_rows)
    if not swings.empty:
        for i in range(n_rows):
            sh = get_nearest_swing_high(swings, i, before=True)
            sl = get_nearest_swing_low(swings, i, before=True)
            close_val = working["close"].iloc[i]
            if close_val > 0:
                sh_dist[i] = (close_val - sh) / sh * 100 if sh and sh > 0 else 0
                sl_dist[i] = (close_val - sl) / sl * 100 if sl and sl > 0 else 0
    result["swing_high_dist_pct"] = sh_dist
    result["swing_low_dist_pct"] = sl_dist

    is_up_day = (working["close"] > working["close"].shift(1)).astype(float)
    result["trend_persistence_20d"] = is_up_day.rolling(20, min_periods=5).mean().fillna(0.5)

    # A-share limit-up features
    prev_close = working["close"].shift(1)
    result["is_limit_up"] = (working["close"] >= prev_close * 1.0995).astype(int).fillna(0)
    result["limit_up_freq_20d"] = result["is_limit_up"].rolling(20, min_periods=1).sum().fillna(0)
    result["near_20d_high"] = (working["close"] >= high_20 * 0.97).astype(int).fillna(0)

    # MA convergence/divergence
    ma_5 = working["close"].rolling(5, min_periods=1).mean()
    ma_10 = working["close"].rolling(10, min_periods=1).mean()
    ma_20 = working["close"].rolling(20, min_periods=1).mean()
    ma_60 = working["close"].rolling(60, min_periods=1).mean()

    result["ma20_vs_ma60_pct"] = ((ma_20 - ma_60) / working["close"].replace(0, np.nan) * 100).fillna(0)
    ma_max = pd.concat([ma_5, ma_10, ma_20], axis=1).max(axis=1)
    ma_min = pd.concat([ma_5, ma_10, ma_20], axis=1).min(axis=1)
    result["ma_convergence"] = ((ma_max - ma_min) / working["close"].replace(0, np.nan) * 100).fillna(0)
    ma20_slope_5 = ma_20.pct_change(5) * 100
    ma20_slope_10 = ma_20.pct_change(10) * 100
    result["ma_slope_accel"] = (ma20_slope_5 - ma20_slope_10).fillna(0)
    result["ma_ribbon_width"] = (
        pd.concat([ma_5, ma_10, ma_20, ma_60], axis=1).std(axis=1) / working["close"].replace(0, np.nan) * 100
    ).fillna(0)

    # Volume structure
    result["force_index_1d"] = returns_1d * working["volume"]
    vol_avg_20 = working["volume"].rolling(20, min_periods=5).mean()
    result["dry_up_volume"] = (working["volume"] < vol_avg_20 * 0.5).astype(int).fillna(0)
    atr_14 = working["close"].rolling(14, min_periods=1).apply(
        lambda s: _compute_atr(s), raw=False
    )
    atr_pct = atr_14 / working["close"].replace(0, np.nan) * 100
    result["volume_climax"] = (
        (working["volume"] > vol_max_5d * 1.5) &
        ((working["high"] - working["low"]) / working["close"].replace(0, np.nan) > 3 * atr_pct / 100)
    ).astype(int).fillna(0)

    # Money flow
    tp = (working["high"] + working["low"] + working["close"]) / 3
    raw_mf = tp * working["volume"]
    pos_flow = raw_mf.where(tp > tp.shift(1), 0).rolling(14, min_periods=14).sum()
    neg_flow = raw_mf.where(tp < tp.shift(1), 0).rolling(14, min_periods=14).sum()
    mf_ratio = pos_flow / neg_flow.replace(0, np.nan)
    result["money_flow_index"] = (100 - 100 / (1 + mf_ratio)).fillna(50)

    hl_range = working["high"] - working["low"]
    ad_raw = ((working["close"] - working["low"]) - (working["high"] - working["close"]))
    ad_scaled = (ad_raw / hl_range.replace(0, np.nan) * working["volume"]).fillna(0)
    result["ad_line"] = ad_scaled.cumsum().diff(5).fillna(0)

    mid_price = (working["high"] + working["low"]) / 2
    box_ratio = working["volume"] / hl_range.replace(0, np.nan) / 10000
    result["ease_of_movement"] = ((mid_price - mid_price.shift(1)) / box_ratio.replace(0, np.nan)).fillna(0)

    # Volatility structure
    # Use simple ATR approximation
    high_low = working["high"] - working["low"]
    high_close = (working["high"] - working["close"].shift(1)).abs()
    low_close = (working["low"] - working["close"].shift(1)).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr_simple = tr.rolling(14, min_periods=1).mean()
    result["atr_expansion_5d"] = (atr_simple / atr_simple.shift(5).replace(0, np.nan)).fillna(1.0)

    running_max_14 = working["close"].rolling(14, min_periods=5).max()
    drawdown_pct = (working["close"] - running_max_14) / running_max_14.replace(0, np.nan) * 100
    result["ulcer_index_14d"] = np.sqrt((drawdown_pct ** 2).rolling(14, min_periods=5).mean()).fillna(0)

    vol_20d = returns_1d.rolling(20, min_periods=10).std()
    vol_60d = returns_1d.rolling(60, min_periods=20).std()
    vol_ratio_regime = (vol_20d / vol_60d.replace(0, np.nan)).fillna(1)
    result["volatility_regime"] = (
        (vol_ratio_regime > 2.0).astype(int) * 3 +
        ((vol_ratio_regime > 1.3) & (vol_ratio_regime <= 2.0)).astype(int) * 2 +
        ((vol_ratio_regime >= 0.6) & (vol_ratio_regime <= 1.3)).astype(int) * 1
    ).fillna(1)

    # K-line patterns
    result["doji_tendency"] = ((working["open"] - working["close"]).abs() / hl_range.replace(0, np.nan)).fillna(0.5)
    oc_max = pd.concat([working["open"], working["close"]], axis=1).max(axis=1)
    result["upper_shadow_pct"] = ((working["high"] - oc_max) / hl_range.replace(0, np.nan)).fillna(0)
    oc_min = pd.concat([working["open"], working["close"]], axis=1).min(axis=1)
    result["lower_shadow_pct"] = ((oc_min - working["low"]) / hl_range.replace(0, np.nan)).fillna(0)

    # Multi-timeframe consensus
    is_up_5 = (working["close"].pct_change(5) > 0).astype(int)
    is_up_10 = (working["close"].pct_change(10) > 0).astype(int)
    is_up_20 = (working["close"].pct_change(20) > 0).astype(int)
    is_up_60 = (working["close"] > ma_60).astype(int)
    result["multi_tf_consensus"] = is_up_5.fillna(0) + is_up_10.fillna(0) + is_up_20.fillna(0) + is_up_60.fillna(0)

    rsi_14 = compute_rsi(working["close"], 14)
    result["rsi_structure"] = (rsi_14 - rsi_14.shift(5)).fillna(0)

    high_20d_vt = working["high"].rolling(20, min_periods=10).max()
    vol_20d_max = working["volume"].rolling(20, min_periods=10).max()
    price_near_high = (working["close"] >= high_20d_vt * 0.98).astype(float)
    vol_far_low = (working["volume"] < vol_20d_max * 0.6).astype(float)
    result["volume_trend_divergence"] = (price_near_high * vol_far_low).fillna(0)

    return pd.DataFrame(result)


def compute_rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def _compute_atr(series):
    if len(series) < 2:
        return 0.0
    high_low = float(series.iloc[-1]) - float(series.iloc[-2])
    return abs(high_low)


def main():
    db_path = get_primary_db_path()
    conn = sqlite3.connect(db_path)

    # Detect period from data
    sample = pd.read_parquet(os.path.join(DATASET_DIR, SRC_SPEC, "train.parquet"), columns=["period"])
    period_mode = sample["period"].mode().iloc[0] if "period" in sample.columns else "1d"
    print(f"Detected period: {period_mode}")

    os.makedirs(os.path.join(DATASET_DIR, DST_SPEC), exist_ok=True)

    for split in ["train", "valid", "test"]:
        print(f"\n{'='*60}")
        print(f"Processing {split}...")
        df = pd.read_parquet(os.path.join(DATASET_DIR, SRC_SPEC, f"{split}.parquet"))
        print(f"  Loaded {len(df)} rows, {df['code'].nunique()} stocks")

        codes = df["code"].unique()
        new_factors_list = []
        failed_codes = []

        for i, code in enumerate(codes):
            if (i + 1) % 50 == 0 or i == 0:
                print(f"  [{i+1}/{len(codes)}] Processing {code}...")

            kline = load_klines_for_code(conn, code, period_mode)
            if kline.empty or len(kline) < 60:
                failed_codes.append(code)
                continue

            # Compute v011 new factors on full kline history
            try:
                new_factors = compute_v011_factors(kline)
            except Exception as e:
                print(f"    ERROR computing factors for {code}: {e}")
                failed_codes.append(code)
                continue

            # Match by date
            if period_mode in ("15m", "15min"):
                kline["match_key"] = kline["trade_date"].astype(str) + "_" + kline["trade_time"].astype(str)
                df_subset = df[df["code"] == code].copy()
                df_subset["match_key"] = df_subset["date"].astype(str)
                # For 15m, match by bar_timestamp
                new_factors["code"] = code
                new_factors["bar_timestamp"] = kline["trade_date"].apply(
                    lambda d: int(pd.Timestamp(d).timestamp() * 1000) if pd.notna(d) else 0
                )
                new_factors_subset = new_factors[new_factors.index.isin(range(len(kline)))]
            else:
                new_factors["code"] = code
                new_factors["date"] = kline["date"].values

            new_factors_list.append(new_factors)

        if failed_codes:
            print(f"  Warning: {len(failed_codes)} codes failed or insufficient data")

        # Merge new factors with original data
        all_new = pd.concat(new_factors_list, ignore_index=True)
        print(f"  Computed factors: {all_new.shape}")

        # Merge on (code, date) for daily or (code, bar_timestamp) for 15m
        if period_mode in ("15m", "15min"):
            merge_cols = ["code"]
            if "date" in df.columns and "date" in all_new.columns:
                merge_cols.append("date")
            merged = df.merge(all_new, on=merge_cols, how="left", suffixes=("", "_v011"))
        else:
            merged = df.merge(all_new, on=["code", "date"], how="left", suffixes=("", "_v011"))

        # Fill any missing new columns with 0
        v011_only_cols = set(V011_FEATURE_SPEC.columns) - set(df.columns)
        for col in v011_only_cols:
            if col in merged.columns:
                merged[col] = merged[col].replace([np.inf, -np.inf], np.nan).fillna(0)

        # Reorder columns: meta first, then spec columns, then any extras
        meta_cols = [c for c in ["code", "date", "bar_timestamp", "period", "label", "label_type"] if c in merged.columns]
        feature_cols = [c for c in V011_FEATURE_SPEC.columns if c in merged.columns]
        other_cols = [c for c in merged.columns if c not in meta_cols and c not in feature_cols]
        merged = merged[meta_cols + feature_cols + other_cols]

        out_path = os.path.join(DATASET_DIR, DST_SPEC, f"{split}.parquet")
        merged.to_parquet(out_path, index=False)
        print(f"  Saved {out_path}: {merged.shape}")

    # Copy manifest with updated spec version
    import json
    manifest_src = os.path.join(DATASET_DIR, SRC_SPEC, "manifest.json")
    manifest_dst = os.path.join(DATASET_DIR, DST_SPEC, "manifest.json")
    if os.path.exists(manifest_src):
        with open(manifest_src) as f:
            manifest = json.load(f)
        manifest["spec_version"] = V011_FEATURE_SPEC.version
        manifest["feature_columns"] = V011_FEATURE_SPEC.columns
        with open(manifest_dst, "w") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print(f"\nSaved manifest to {manifest_dst}")

    conn.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
