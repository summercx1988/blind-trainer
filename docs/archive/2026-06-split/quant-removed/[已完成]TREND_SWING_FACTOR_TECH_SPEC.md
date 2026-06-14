# 趋势/波段量化因子技术规格

> 版本：v2.0  
> 日期：2026-04-27  
> 状态：**第一期+第二期完成（打标系统 + v011 因子接入 feature spec）**

---

## 1. 概述

本文档记录趋势/波段交易策略的量化因子体系设计与实施计划。

**目标**：在现有 v010 特征体系（142 个因子）基础上，新增趋势/波段专用因子，支撑右侧趋势交易与波段交易的买点/卖点模型训练。

**适用场景**：
- A 股市场
- 短线波段（持仓 1-5 天）和中线波段（持仓 5-20 天）
- 右侧趋势交易（趋势确认后跟随，不抄底逃顶）

---

## 2. 已完成工作（第一期）

### 2.1 新建文件

| 文件 | 说明 |
|------|------|
| `python/trading_trainer/labeling/trend_indicators.py` | 趋势指标引擎（ADX、Swing Point、趋势阶段等） |
| `python/trading_trainer/labeling/swing_signal_detector.py` | 波段信号检测器（TPB/BB/TRB/TBS/DS/LHS 六大信号） |
| `python/trading_trainer/labeling/swing_labeler.py` | 波段标注管线（日线前瞻窗口 + 质量门控） |

### 2.2 修改文件

| 文件 | 变更 |
|------|------|
| `python/trading_trainer/labeling/indicators.py` | RSI 从 SMA 改为 Wilder's Smoothing |
| `python/trading_trainer/labeling/stock_filter.py` | 新增 `filter_stocks_for_swing()`（动态流动性+波动率过滤） |
| `python/trading_trainer/labeling/labeler.py` | 新增 `--swing` 参数支持波段标注模式 |

### 2.3 趋势指标详情

`trend_indicators.py` 提供的函数和类：

```
compute_wilder_rsi(close, period=14)       → Series  # 标准 RSI
compute_adx(df, period=14)                 → DataFrame  # 含 adx/plus_di/minus_di/atr
compute_ma_slope(close, ma_period, slope)  → Series  # MA 斜率
assess_trend_direction(close, idx, ...)    → str     # 5级方向
detect_trend_phase(close, volume, idx)     → str     # 4级阶段
find_swing_points(high, low, left, right)  → DataFrame  # 波段高低点
detect_volume_price_divergence(...)        → str|None  # 量价背离
compute_volatility_regime(close, idx)      → (str, float)  # 波动分位
build_trend_context(df, idx)              → TrendContext  # 综合趋势快照
compute_all_trend_indicators(df)           → DataFrame  # 全量趋势指标
```

`TrendContext` 数据类字段：

```python
direction: str       # strong_up / up / neutral / down / strong_down
adx: float           # ADX 值
phase: str           # acceleration / steady / exhaustion / reversal / range
ma_slope_pct: float  # MA20 斜率百分比
price_vs_ma20: float # 偏离 MA20 百分比
price_vs_ma60: float # 偏离 MA60 百分比
volatility_regime: str  # low / normal / high / extreme
atr_pct: float       # ATR / Close %
```

### 2.4 波段信号详情

`swing_signal_detector.py` 的 6 个信号：

| 信号 | 类型 | 条件摘要 | confidence |
|------|------|---------|------------|
| TPB | buy | 趋势向上 + 回调至 MA10/20/60 + 缩量 + 反转K线 | 0.7-0.85 |
| BB | buy | 趋势向上 + 放量突破前波高点(Swing High) | 0.75-0.9 |
| TRB | buy | 趋势向上 + 回调后止跌 + 放量阳线恢复 | 0.7-0.85 |
| TBS | sell | 跌破 MA20/MA60 + 趋势转弱 | 0.75-0.9 |
| DS | sell | 放量滞涨 / 长上影 / 量价顶背离 | 0.7-0.8 |
| LHS | sell | 低高点 + 跌破前低 | 0.75-0.85 |

### 2.5 使用方式

```bash
# 波段标注（生成日线级别的训练标签）
PYTHONPATH=python python3 -m trading_trainer.labeling.labeler \
    --db ~/Library/Application\ Support/stock-trading-simulator/stock-trading.db \
    --swing \
    --forward-days 10 \
    --adx-threshold 20.0 \
    --start 2024-01-01 \
    --end 2026-04-01 \
    --save-db \
    --strategy swing_trend_v1

# 或独立 CLI
PYTHONPATH=python python3 -m trading_trainer.labeling.swing_labeler \
    --db ~/Library/Application\ Support/stock-trading-simulator/stock-trading.db \
    --codes 000001,600036 \
    --forward-days 10 \
    --save-db
```

---

## 3. 待实施工作（第二期）：v011 因子接入 feature spec

### 3.1 目标

将趋势/波段专用因子接入 `python/trading_trainer/features/specs.py`，创建 **v011** 版本，使这些因子可在模型训练中使用。

### 3.2 新增因子清单（~42 个）

#### P0 因子（15 个）— 核心差异因子

**ADX 趋势强度族（4 个）**：

| 列名 | 公式 | 依赖 |
|------|------|------|
| `adx` | Wilder's ADX(14) | `trend_indicators.compute_adx()` |
| `plus_di` | +DI(14) | 同上 |
| `minus_di` | -DI(14) | 同上 |
| `adx_slope_5d` | adx - adx.shift(5) | 自算 |

**趋势效率族（3 个）**：

| 列名 | 公式 | 
|------|------|
| `efficiency_ratio` | abs(close - close.shift(20)) / sum(abs(delta), 20) |
| `chande_cmo_14` | 100 * (gain_sum - loss_sum) / (gain_sum + loss_sum), 14 日 |
| `price_percentile_20d` | (close - 20d_min) / (20d_max - 20d_min) * 100 |

**回调质量族（4 个）**：

| 列名 | 公式 |
|------|------|
| `pullback_depth_pct` | (low - 20d_max_high) / 20d_max_high * 100 |
| `pullback_vol_shrink` | volume / 5d_max_volume（近5日缩量比例） |
| `pullback_recovery_ratio` | 近3日涨幅 / abs(前5日跌幅) |
| `bull_vol_ratio_10d` | sum(阳线vol, 10) / sum(总vol, 10) |

**波段结构族（4 个）**：

| 列名 | 公式 |
|------|------|
| `higher_high_count_20d` | 20日内创新高次数 |
| `swing_high_dist_pct` | (close - nearest_swing_high) / nearest_swing_high * 100 |
| `swing_low_dist_pct` | (close - nearest_swing_low) / nearest_swing_low * 100 |
| `trend_persistence_20d` | 20日内上涨天数 / 20 |

#### P1 因子（13 个）— A股特色 + 资金流向

**涨跌停相关（3 个）**：

| 列名 | 公式 |
|------|------|
| `is_limit_up` | close >= prev_close * 1.0995（主板）/ 1.1995（创业板） |
| `limit_up_freq_20d` | 20日内涨停次数 |
| `near_20d_high` | close >= 20d_max_high * 0.97 |

**均线收敛发散（4 个）**：

| 列名 | 公式 |
|------|------|
| `ma20_vs_ma60_pct` | (ma20 - ma60) / close * 100 |
| `ma_convergence` | (max(ma5,10,20) - min(ma5,10,20)) / close * 100 |
| `ma_slope_accel` | ma20_slope_5d - ma20_slope_10d |
| `ma_ribbon_width` | std(ma5, ma10, ma20, ma60) / close * 100 |

**量能结构族（3 个）**：

| 列名 | 公式 |
|------|------|
| `force_index_1d` | (close - prev_close) * volume |
| `dry_up_volume` | volume < 20d_vol_avg * 0.5 的布尔 |
| `volume_climax` | volume > 5d_max_vol * 1.5 AND (high-low)/close > 3*atr_pct |

**资金流向代理（3 个）**：

| 列名 | 公式 |
|------|------|
| `money_flow_index` | MFI(14): 100 - 100/(1 + pos_flow/neg_flow) |
| `ad_line` | Chaikin A/D 线: cumsum(((C-L)-(H-C))/(H-L)*vol) 的 5 日差分 |
| `ease_of_movement` | EMV: ((H+L)/2 - prev(H+L)/2) / (vol/(H-L)) |

#### P2 因子（9 个）— 增强

**波动率结构（3 个）**：

| 列名 | 公式 |
|------|------|
| `atr_expansion_5d` | ATR(14) / ATR(14).shift(5) |
| `ulcer_index_14d` | sqrt(mean(max_drawdown_from_peak^2, 14)) * 100 |
| `volatility_regime` | 0=low, 1=normal, 2=high, 3=extreme（来自 trend_indicators） |

**K线形态（3 个）**：

| 列名 | 公式 |
|------|------|
| `doji_tendency` | abs(open - close) / (high - low) |
| `upper_shadow_pct` | 上影线/(high-low)（多头中反映抛压） |
| `lower_shadow_pct` | 下影线/(high-low)（空头中反映支撑） |

**多周期确认（3 个）**：

| 列名 | 公式 |
|------|------|
| `multi_tf_consensus` | [5d_up, 10d_up, 20d_up, 60d_up] 一致性计数 0-4 |
| `rsi_structure` | rsi14 - rsi14.shift(5)（RSI 的斜率变化） |
| `volume_trend_divergence` | 价格新高但量能新低的程度（标准化） |

#### P3 因子（5 个）— 后续迭代

| 列名 | 公式 | 数据依赖 |
|------|------|---------|
| `northbound_flow` | 北向资金净买卖代理 | 需北向数据 |
| `margin_balance_pct` | 融资余额变化率 | 需融资数据 |
| `composite_trend_score` | P0+P1 因子加权 | 训练后确定权重 |
| `swing_setup_score` | 波段条件的综合 | 同上 |
| `sector_rotation_signal` | 行业轮动强度 | 已有 sector 数据 |

### 3.3 实施步骤

**Step 1**：在 `builder.py` 中添加因子计算逻辑

```python
# builder.py 的 _compute_feature_frame() 中添加 v011 分支

if spec_version >= 11:
    from trading_trainer.labeling.trend_indicators import (
        compute_all_trend_indicators, find_swing_points,
        get_nearest_swing_high, get_nearest_swing_low,
        compute_adx, compute_wilder_rsi
    )
    
    # 1. ADX 族（已实现）
    adx_df = compute_adx(df)
    features['adx'] = adx_df['adx']
    features['plus_di'] = adx_df['plus_di']
    features['minus_di'] = adx_df['minus_di']
    features['adx_slope_5d'] = adx_df['adx'] - adx_df['adx'].shift(5)
    
    # 2. 趋势效率族
    close_diff = df['close'].diff()
    features['efficiency_ratio'] = (
        abs(df['close'] - df['close'].shift(20)) /
        close_diff.abs().rolling(20).sum()
    )
    # ... 其余因子
    
    # 3. Swing Point 相关
    swings = find_swing_points(df['high'], df['low'], left=5, right=3)
    # ... 计算 swing_high_dist_pct, swing_low_dist_pct
```

**Step 2**：在 `specs.py` 中添加 v011 FeatureSpec

```python
@register_spec(version=11)
def _build_v011_spec() -> FeatureSpec:
    base = _build_v010_spec()
    swing_factors = [
        # P0 (15)
        'adx', 'plus_di', 'minus_di', 'adx_slope_5d',
        'efficiency_ratio', 'chande_cmo_14', 'price_percentile_20d',
        'pullback_depth_pct', 'pullback_vol_shrink', 'pullback_recovery_ratio',
        'bull_vol_ratio_10d',
        'higher_high_count_20d', 'swing_high_dist_pct', 'swing_low_dist_pct',
        'trend_persistence_20d',
        # P1 (13)
        'is_limit_up', 'limit_up_freq_20d', 'near_20d_high',
        'ma20_vs_ma60_pct', 'ma_convergence', 'ma_slope_accel', 'ma_ribbon_width',
        'force_index_1d', 'dry_up_volume', 'volume_climax',
        'money_flow_index', 'ad_line', 'ease_of_movement',
        # P2 (9)
        'atr_expansion_5d', 'ulcer_index_14d', 'volatility_regime',
        'doji_tendency', 'upper_shadow_pct', 'lower_shadow_pct',
        'multi_tf_consensus', 'rsi_structure', 'volume_trend_divergence',
    ]
    return FeatureSpec(
        version=11,
        interval='1d',
        lookback_bars=60,
        columns=base.columns + swing_factors,
    )
```

**Step 3**：运行同步脚本

```bash
node scripts/sync_feature_specs.mjs
```

生成 `featureSpecRegistry.generated.ts`。

**Step 4**：验证

```bash
PYTHONPATH=python python3 -c "
from trading_trainer.features.builder import build_features
build_features(dataset_id='xxx', spec_version=11, output_dir='./features_test')
"
```

### 3.4 向后兼容

- v001-v010 不受任何影响
- v011 是纯增量（追加列）
- 旧模型训练任务继续使用已有 spec 版本
- 新模型可选择 v011

---

## 4. 后续可能的扩展（第三期）

1. **北向资金因子**：需接入沪港通/深港通日度资金流数据
2. **融资融券因子**：需接入两融余额日变数据
3. **行业轮动因子**：已有的 sector 数据可做行业动量/轮动
4. **因子质量评估**：用 `feature_selector.py` 对新增因子做 IC/IR/稳定性评估
5. **15分钟实时因子**：把 v010 的收盘盘口因子扩展到 TypeScript 端的实时计算

---

## 5. 文件索引

| 文件路径 | 状态 |
|---------|------|
| `python/trading_trainer/labeling/trend_indicators.py` | ✅ 已实现 |
| `python/trading_trainer/labeling/swing_signal_detector.py` | ✅ 已实现 |
| `python/trading_trainer/labeling/swing_labeler.py` | ✅ 已实现 |
| `python/trading_trainer/labeling/indicators.py` | ✅ 已修改（RSI 修复） |
| `python/trading_trainer/labeling/stock_filter.py` | ✅ 已修改（新增 swing 过滤器） |
| `python/trading_trainer/labeling/labeler.py` | ✅ 已修改（新增 --swing） |
| `python/trading_trainer/features/specs.py` | ✅ 已添加 v011（179 列） |
| `python/trading_trainer/features/builder.py` | ✅ 已添加 v011 计算（37 新因子） |
| `scripts/sync_feature_specs.mjs` | ✅ 已同步（11 specs） |
| `src/main/ipc/modelFeatureCalculator.ts` | 暂不修改（实时推理暂用旧因子） |

---

## 6. 快速恢复指南

下次继续工作时的检查清单：

```bash
# 1. 验证第一期成果
PYTHONPATH=python python3 -c "
from trading_trainer.labeling.trend_indicators import compute_all_trend_indicators
from trading_trainer.labeling.swing_signal_detector import detect_all_swing_signals
from trading_trainer.labeling.swing_labeler import label_batch_swing
print('All modules OK')
"

# 2. 查看现有 spec 最新版本
PYTHONPATH=python python3 -c "
from trading_trainer.features.specs import get_feature_spec
for v in range(15):
    try:
        spec = get_feature_spec(f'v{str(v).zfill(3)}')
        print(f'v{str(v).zfill(3)}: {len(spec.columns)} columns')
    except:
        pass
"

# 3. 开始第二期工作
# - 编辑 builder.py 添加因子计算
# - 编辑 specs.py 添加 v011
# - 运行 node scripts/sync_feature_specs.mjs
# - 构建验证
```
