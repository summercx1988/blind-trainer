# 股票波段趋势分割与标注算法

**版本：** v1.0  
**状态：** 已落地（首版）  
**日期：** 2026-05-02  
**目标模块：** 趋势波段识别 / 上升波段标注  
**依赖模块：** `trend_indicators.py` / `swing_labeler.py` / `swing_signal_detector.py`

---

## 1. 背景与目标

### 1.1 现状

当前项目的波段识别采用 **Swing Point 窗口极值法**（`find_swing_points`，left=5, right=5），配合 MA/ADX 趋势过滤，通过贪心扫描生成 buy-sell 交易对。这套体系已在 `swing_labeler.py` 中实现，功能完整但存在以下局限：

| 局限 | 说明 |
|------|------|
| 窗口固定 | left/right 参数固定，无法自适应不同波动率环境 |
| 波段粒度单一 | 只有一种粒度的峰谷检测，无法区分大波段与小波段 |
| 缺少全局波浪结构 | 没有将价格序列完整分割为交替的上升/下降波段 |
| 无 ZigZag 降噪 | 对小幅震荡噪音没有百分比阈值过滤 |

### 1.2 目标

构建一套**多层次波段趋势分割算法**，能够：

1. 将价格序列完整分割为交替的 **上升波段** 和 **下降波段**
2. 识别所有满足条件的上升趋势波段，标注起止点和属性
3. 支持多粒度（大波段 / 中波段 / 小波段）
4. 与现有趋势指标体系（ADX/MA/趋势方向/趋势阶段）无缝集成
5. 输出结构化的波段数据，供下游 ML 标签生成和因子计算使用

---

## 2. 算法选型

经过调研，确定采用 **ZigZag + 变化点检测（PELT）双引擎** 的组合方案：

| 引擎 | 角色 | 理由 |
|------|------|------|
| **ZigZag 之字转向** | 主分割引擎 | 天然输出峰谷序列，直观可解释，参数少（仅需百分比阈值） |
| **PELT 变化点检测** | 辅助验证引擎 | 数学基础扎实，检测统计特性变化点，交叉验证 ZigZag 分割质量 |
| **现有趋势指标** | 方向与强度过滤 | 复用 ADX/MA/趋势方向/趋势阶段，过滤无效波段 |

为什么不选其他方案：

| 方案 | 不选原因 |
|------|----------|
| Elliott 波浪理论 | 规则主观性强，自动化困难，边界模糊 |
| DTW 模式匹配 | 需要预定义模板，适合形态识别而非波段分割 |
| 纯 Swing Point | 已有实现，粒度单一，无法自适应 |

---

## 3. 整体架构

```
输入: OHLCV 日线数据
      │
      ▼
┌──────────────────────────────────┐
│  Step 1: ZigZag 转向点检测        │
│  → 输出: 峰/谷转折点序列           │
│  → 多阈值: 大(8%) / 中(5%) / 小(3%) │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Step 2: 波段方向标注              │
│  → 谷→峰 = 上升波段 (UP)          │
│  → 峰→谷 = 下降波段 (DOWN)        │
│  → 计算波段属性                    │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Step 3: 趋势强度过滤             │
│  → 复用 ADX / MA / 趋势方向       │
│  → 过滤横盘/弱势波段              │
│  → 标注趋势阶段                   │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Step 4: PELT 交叉验证 (可选)     │
│  → 检测变化点                     │
│  → 与 ZigZag 分割对比             │
│  → 合并/调整分割边界              │
└──────────────┬───────────────────┘
               │
               ▼
输出: 结构化波段数据
  - 波段列表 [{type, start_idx, end_idx, start_price, end_price, ...}]
  - 上升波段集合 (用于 ML 标签)
  - 波段属性 (涨幅/持续时间/回撤/量价配合)
```

---

## 4. 算法详细设计与伪码

### 4.1 Step 1: ZigZag 转向点检测

#### 4.1.1 算法原理

ZigZag 算法从左到右扫描价格序列，维护当前趋势方向和极值点。当价格从当前极值点反向变动超过设定阈值时，确认一个转折点并切换方向。

**关键参数：**

| 参数 | 含义 | 建议值 |
|------|------|--------|
| `threshold_pct` | 最小价格变动百分比 | 股票: 3%~8%, 期货: 2%~3% |
| `use_high_low` | 是否使用 H/L 而非 Close | True (推荐) |
| `min_bars` | 两个转折点之间最少 K 线数 | 3 |

#### 4.1.2 伪码

```
function zigzag_detect(high, low, close, threshold_pct, min_bars=3):
    """
    ZigZag 转向点检测
    
    输入:
      high, low, close: 价格序列
      threshold_pct: 最小价格变动百分比 (如 5.0 表示 5%)
      min_bars: 两个转折点之间最少K线数
    
    输出:
      pivots: List[Pivot] 其中 Pivot = {index, price, type: 'peak' | 'valley'}
    """
    n = len(close)
    if n < 3:
        return []
    
    pivots = []
    
    # --- 初始化: 找到第一个显著方向 ---
    # 从第0根K线开始，寻找第一个超过阈值的变动方向
    current_idx = 0
    if use_high_low:
        current_price = high[0]   # 先假设向上
    else:
        current_price = close[0]
    
    direction = NONE  # NONE / UP / DOWN
    
    # 寻找初始方向
    for i in range(1, n):
        rise_pct = (high[i] / current_price - 1) * 100
        fall_pct = (1 - low[i] / current_price) * 100
        
        if rise_pct >= threshold_pct:
            direction = UP
            # 第一个点是谷
            pivots.append(Pivot(index=0, price=low[0], type='valley'))
            current_price = high[i]
            current_idx = i
            break
        elif fall_pct >= threshold_pct:
            direction = DOWN
            # 第一个点是峰
            pivots.append(Pivot(index=0, price=high[0], type='peak'))
            current_price = low[i]
            current_idx = i
            break
    
    if direction == NONE:
        return []  # 整个序列波动不足
    
    # --- 主循环: 沿方向扫描，检测转向 ---
    for i in range(current_idx + 1, n):
        if direction == UP:
            # 上升趋势中，持续更新最高点
            if high[i] > current_price:
                current_price = high[i]
                current_idx = i
            
            # 检查是否回落超过阈值 → 转向
            fall_pct = (1 - low[i] / current_price) * 100
            if fall_pct >= threshold_pct and (i - last_pivot_bar(pivots)) >= min_bars:
                pivots.append(Pivot(index=current_idx, price=current_price, type='peak'))
                direction = DOWN
                current_price = low[i]
                current_idx = i
        
        elif direction == DOWN:
            # 下降趋势中，持续更新最低点
            if low[i] < current_price:
                current_price = low[i]
                current_idx = i
            
            # 检查是否反弹超过阈值 → 转向
            rise_pct = (high[i] / current_price - 1) * 100
            if rise_pct >= threshold_pct and (i - last_pivot_bar(pivots)) >= min_bars:
                pivots.append(Pivot(index=current_idx, price=current_price, type='valley'))
                direction = UP
                current_price = high[i]
                current_idx = i
    
    # 最后一个未确认的极值点也加入（标记为 tentative）
    if direction == UP:
        pivots.append(Pivot(index=current_idx, price=current_price, type='peak', tentative=True))
    elif direction == DOWN:
        pivots.append(Pivot(index=current_idx, price=current_price, type='valley', tentative=True))
    
    return pivots
```

#### 4.1.3 多粒度策略

为捕获不同级别的波段，使用 3 个阈值并行检测，然后合并：

| 级别 | 阈值 | 含义 | 波段特征 |
|------|------|------|----------|
| L1 大波段 | 8% | 主要趋势波段 | 持续数周到数月 |
| L2 中波段 | 5% | 趋势中的主要回调/反弹 | 持续1~4周 |
| L3 小波段 | 3% | 短线波动 | 持续数天到2周 |

合并规则：
- L1 波段边界优先级最高
- L2 波段嵌套在 L1 波段内部
- L3 波段嵌套在 L2 波段内部
- 输出层级关系: `L1_segment → [L2_segments] → [L3_segments]`

---

### 4.2 Step 2: 波段方向标注与属性计算

#### 4.2.1 算法原理

ZigZag 输出的转折点是交替的峰/谷。将相邻转折点连接即得到波段：
- **谷 → 峰** = 上升波段 (UP)
- **峰 → 谷** = 下降波段 (DOWN)

#### 4.2.2 伪码

```
function build_segments(pivots, df):
    """
    从 ZigZag 转折点构建波段
    
    输入:
      pivots: ZigZag 输出的转折点列表
      df: OHLCV DataFrame
    
    输出:
      segments: List[Segment]
    """
    segments = []
    
    for i in range(len(pivots) - 1):
        p1 = pivots[i]
        p2 = pivots[i + 1]
        
        # 确定方向
        if p1.type == 'valley' and p2.type == 'peak':
            seg_type = 'UP'
        elif p1.type == 'peak' and p2.type == 'valley':
            seg_type = 'DOWN'
        else:
            continue  # 异常: 连续同类型
        
        # 计算波段属性
        start_idx = p1.index
        end_idx = p2.index
        duration = end_idx - start_idx
        
        start_price = p1.price
        end_price = p2.price
        change_pct = (end_price / start_price - 1) * 100
        
        # 波段内最大回撤 (仅对上升波段有意义)
        if seg_type == 'UP':
            intraday_low = min(df['low'][start_idx:end_idx+1])
            max_drawdown_pct = (1 - intraday_low / start_price) * 100
            intraday_high = max(df['high'][start_idx:end_idx+1])
            max_gain_pct = (intraday_high / start_price - 1) * 100
        else:
            intraday_high = max(df['high'][start_idx:end_idx+1])
            max_drawdown_pct = (intraday_high / start_price - 1) * 100  # 下降中反向最大涨幅
            max_gain_pct = 0
        
        # 量价属性
        seg_volume = df['volume'][start_idx:end_idx+1]
        avg_volume = seg_volume.mean()
        vol_vs_ma20 = avg_volume / df['volume'].rolling(20).mean().iloc[end_idx] if end_idx >= 20 else 1.0
        
        # 量价配合: 上升波段中上涨日放量、下跌日缩量
        if seg_type == 'UP':
            up_days = df['close'][start_idx:end_idx+1].diff() > 0
            down_days = df['close'][start_idx:end_idx+1].diff() < 0
            up_vol_ratio = df.loc[up_days, 'volume'].mean() / avg_volume if up_days.sum() > 0 else 1.0
            down_vol_ratio = df.loc[down_days, 'volume'].mean() / avg_volume if down_days.sum() > 0 else 1.0
            volume_health = up_vol_ratio / down_vol_ratio if down_vol_ratio > 0 else 2.0
        else:
            volume_health = 1.0
        
        segments.append(Segment(
            type=seg_type,
            level=level,            # L1/L2/L3
            start_idx=start_idx,
            end_idx=end_idx,
            start_price=start_price,
            end_price=end_price,
            duration=duration,
            change_pct=change_pct,
            max_drawdown_pct=max_drawdown_pct,
            max_gain_pct=max_gain_pct,
            avg_volume=avg_volume,
            vol_vs_ma20=vol_vs_ma20,
            volume_health=volume_health,
            tentative=p2.tentative,  # 最后一个波段可能未确认
        ))
    
    return segments
```

#### 4.2.3 输出数据结构

```python
@dataclass
class Segment:
    type: str               # 'UP' / 'DOWN'
    level: str              # 'L1' / 'L2' / 'L3'
    start_idx: int          # 起始K线索引
    end_idx: int            # 结束K线索引
    start_price: float      # 起始价格
    end_price: float        # 结束价格
    duration: int           # 持续K线数
    change_pct: float       # 涨跌幅百分比
    max_drawdown_pct: float # 波段内最大回撤
    max_gain_pct: float     # 波段内最大涨幅
    avg_volume: float       # 波段内平均成交量
    vol_vs_ma20: float      # 波段均量 vs MA20量比
    volume_health: float    # 量价健康度 (上升波段: 涨日量/跌日量)
    tentative: bool         # 是否未确认 (最后一个波段)
    
    # 以下字段由 Step 3 填充
    trend_direction: str = ''     # 'strong_up'/'up'/'neutral'/'down'/'strong_down'
    trend_phase: str = ''         # 'acceleration'/'steady'/'exhaustion'/'reversal'
    adx: float = 0.0
    ma_slope_pct: float = 0.0
    volatility_regime: str = ''   # 'low'/'normal'/'high'/'extreme'
    score: float = 0.0            # 综合评分
```

---

### 4.3 Step 3: 趋势强度过滤

#### 4.3.1 算法原理

复用现有 `trend_indicators.py` 中的函数，对每个波段进行趋势质量评估，过滤掉不符合要求的波段。

#### 4.3.2 伪码

```
function filter_and_score_segments(segments, df):
    """
    对波段进行趋势质量评估和过滤
    
    输入:
      segments: Step 2 输出的波段列表
      df: 已计算趋势指标的 OHLCV DataFrame
    
    输出:
      filtered_segments: 过滤后的有效上升波段
      all_scored: 所有波段的评分结果
    """
    # 预计算全量趋势指标
    df = compute_all_trend_indicators(df)
    
    for seg in segments:
        # 取波段中点作为趋势评估点
        mid_idx = (seg.start_idx + seg.end_idx) // 2
        
        # 复用现有趋势评估函数
        trend_ctx = build_trend_context(df, mid_idx)
        
        seg.trend_direction = trend_ctx.direction
        seg.trend_phase = trend_ctx.phase
        seg.adx = trend_ctx.adx
        seg.ma_slope_pct = trend_ctx.ma_slope_pct
        seg.volatility_regime = trend_ctx.volatility_regime
        
        # --- 综合评分 (仅对上升波段) ---
        if seg.type == 'UP':
            seg.score = compute_segment_score(seg, trend_ctx)
    
    # --- 过滤: 只保留高质量上升波段 ---
    filtered = []
    for seg in segments:
        if seg.type != 'UP':
            continue
        if not pass_quality_gate(seg):
            continue
        filtered.append(seg)
    
    return filtered, segments


function compute_segment_score(seg, trend_ctx):
    """
    上升波段综合评分 (0~100)
    
    评分维度:
      1. 涨幅空间 (30分)
      2. 趋势强度 (25分)
      3. 量价配合 (20分)
      4. 趋势阶段 (15分)
      5. 持续性 (10分)
    """
    score = 0.0
    
    # 1. 涨幅空间 (30分)
    if seg.change_pct >= 20:
        score += 30
    elif seg.change_pct >= 10:
        score += 20
    elif seg.change_pct >= 5:
        score += 12
    elif seg.change_pct >= 3:
        score += 5
    
    # 2. 趋势强度 (25分)
    if trend_ctx.direction == 'strong_up' and trend_ctx.adx > 30:
        score += 25
    elif trend_ctx.direction in ('strong_up', 'up') and trend_ctx.adx > 25:
        score += 18
    elif trend_ctx.direction == 'up':
        score += 10
    elif trend_ctx.direction == 'neutral':
        score += 3
    
    # 3. 量价配合 (20分)
    if seg.volume_health >= 1.5:
        score += 20
    elif seg.volume_health >= 1.2:
        score += 14
    elif seg.volume_health >= 1.0:
        score += 8
    
    # 4. 趋势阶段 (15分)
    if trend_ctx.phase == 'acceleration':
        score += 15
    elif trend_ctx.phase == 'steady':
        score += 12
    elif trend_ctx.phase == 'exhaustion':
        score += 5
    
    # 5. 持续性 (10分)
    if seg.duration >= 15:
        score += 10
    elif seg.duration >= 8:
        score += 7
    elif seg.duration >= 5:
        score += 4
    
    return score


function pass_quality_gate(seg):
    """
    上升波段质量门控
    
    硬性条件 (任一不满足则淘汰):
      1. 涨幅 >= min_rise_pct (L1:8%, L2:5%, L3:3%)
      2. 持续时间 >= min_duration (L1:10, L2:5, L3:3)
      3. ADX >= 15 (至少有趋势特征)
      4. 波段内最大回撤 <= 涨幅的 50%
      5. 不能是 tentative 波段 (最后一个未确认波段)
    """
    min_rise = {'L1': 8.0, 'L2': 5.0, 'L3': 3.0}[seg.level]
    min_dur = {'L1': 10, 'L2': 5, 'L3': 3}[seg.level]
    
    if seg.tentative:
        return False
    if seg.change_pct < min_rise:
        return False
    if seg.duration < min_dur:
        return False
    if seg.adx < 15:
        return False
    if seg.max_drawdown_pct > seg.change_pct * 0.5:
        return False
    
    return True
```

---

### 4.4 Step 4: PELT 变化点交叉验证 (可选)

#### 4.4.1 算法原理

使用 `ruptures` 库的 PELT (Pruned Exact Linear Time) 算法，在价格序列上检测统计特性变化点。将 PELT 检测到的变化点与 ZigZag 转折点进行对比，调整分割边界以提高鲁棒性。

#### 4.4.2 伪码

```
function pelt_cross_validate(close, zigzag_pivots, penalty=10):
    """
    PELT 变化点检测 + 与 ZigZag 对比
    
    输入:
      close: 收盘价序列
      zigzag_pivots: ZigZag 检测到的转折点
      penalty: PELT 惩罚项 (越大则变化点越少)
    
    输出:
      validated_pivots: 交叉验证后的转折点
      consistency_score: ZigZag 与 PELT 的一致性得分
    """
    import ruptures as rpt
    
    # PELT 检测变化点
    signal = close.values.reshape(-1, 1)
    algo = rpt.Pelt(model="rbf", min_size=5).fit(signal)
    pelt_change_points = algo.predict(pen=penalty)
    # ruptures 返回的是 end index (即 [0, cp1) 是第一段)
    pelt_indices = [cp - 1 for cp in pelt_change_points if cp < len(close)]
    
    # 对比 ZigZag 与 PELT
    zigzag_indices = [p.index for p in zigzag_pivots]
    
    # 计算一致性: 在 tolerance 范围内匹配
    tolerance = 5  # 允许 ±5 根K线的偏差
    matched = 0
    for zi in zigzag_indices:
        for pi in pelt_indices:
            if abs(zi - pi) <= tolerance:
                matched += 1
                break
    
    total = max(len(zigzag_indices), len(pelt_indices))
    consistency_score = matched / total if total > 0 else 0.0
    
    # 合并策略:
    # 1. ZigZag 和 PELT 都检测到的点 → 高置信度
    # 2. 仅 ZigZag 检测到的点 → 中置信度
    # 3. 仅 PELT 检测到的点 → 低置信度 (需人工确认)
    
    validated = []
    used_pelt = set()
    
    for p in zigzag_pivots:
        match = find_nearest(pelt_indices, p.index, tolerance)
        if match is not None:
            # 取两者平均位置
            adjusted_idx = (p.index + match) // 2
            validated.append(Pivot(
                index=adjusted_idx,
                price=p.price,
                type=p.type,
                confidence='high'
            ))
            used_pelt.add(match)
        else:
            validated.append(Pivot(
                index=p.index,
                price=p.price,
                type=p.type,
                confidence='medium'
            ))
    
    return validated, consistency_score
```

#### 4.4.3 使用建议

- **首次应用时**：对少量样本执行 PELT 交叉验证，观察一致性得分
- **一致性 > 0.7**：PELT 验证效果好，可考虑自动合并
- **一致性 < 0.5**：PELT 参数需要调优，或仅作为参考
- **生产环境**：PELT 计算量较大，建议离线预计算，不放入实时链路

---

### 4.5 完整流程伪码

```
function trend_segmentation(df, config):
    """
    完整的波段趋势分割流程
    
    输入:
      df: OHLCV DataFrame (至少包含 open/high/low/close/volume)
      config: 分割配置
    
    输出:
      result: {
        'all_segments': List[Segment],        # 所有波段
        'up_segments': List[Segment],          # 上升波段
        'quality_up_segments': List[Segment],  # 高质量上升波段
        'pivots': List[Pivot],                 # 转折点
        'consistency_score': float,            # PELT 一致性
      }
    """
    # ---- Step 0: 预计算趋势指标 ----
    df = compute_all_trend_indicators(df)
    
    # ---- Step 1: ZigZag 多粒度检测 ----
    all_pivots = {}
    for level, threshold in config.thresholds.items():
        pivots = zigzag_detect(
            high=df['high'], low=df['low'], close=df['close'],
            threshold_pct=threshold,
            min_bars=config.min_bars
        )
        all_pivots[level] = pivots
    
    # 合并多粒度转折点 (L1 优先)
    merged_pivots = merge_multilevel_pivots(all_pivots)
    
    # ---- Step 2: 构建波段 ----
    all_segments = []
    for level in ['L1', 'L2', 'L3']:
        segments = build_segments(all_pivots[level], df)
        for seg in segments:
            seg.level = level
        all_segments.extend(segments)
    
    # ---- Step 3: 趋势过滤与评分 ----
    quality_up_segments, all_scored = filter_and_score_segments(all_segments, df)
    
    # ---- Step 4: PELT 交叉验证 (可选) ----
    if config.use_pelt_validation:
        validated, score = pelt_cross_validate(
            df['close'], merged_pivots, penalty=config.pelt_penalty
        )
    else:
        score = -1  # 未执行
    
    return {
        'all_segments': all_scored,
        'up_segments': [s for s in all_scored if s.type == 'UP'],
        'quality_up_segments': quality_up_segments,
        'pivots': merged_pivots,
        'consistency_score': score,
    }
```

---

## 5. 配置设计

```python
@dataclass
class TrendSegmentationConfig:
    # ZigZag 阈值 (多粒度)
    thresholds: dict = field(default_factory=lambda: {
        'L1': 8.0,   # 大波段: 8% 阈值
        'L2': 5.0,   # 中波段: 5% 阈值
        'L3': 3.0,   # 小波段: 3% 阈值
    })
    min_bars: int = 3                      # 转折点间最少K线数
    use_high_low: bool = True              # 使用 H/L 而非 Close
    
    # 趋势过滤
    min_adx: float = 15.0                  # 最低 ADX 阈值
    min_rise_pct: dict = field(default_factory=lambda: {
        'L1': 8.0, 'L2': 5.0, 'L3': 3.0
    })
    min_duration: dict = field(default_factory=lambda: {
        'L1': 10, 'L2': 5, 'L3': 3
    })
    max_drawdown_ratio: float = 0.5        # 最大回撤占涨幅比例
    
    # PELT 交叉验证
    use_pelt_validation: bool = False      # 是否启用 PELT 验证
    pelt_penalty: float = 10.0             # PELT 惩罚项
    pelt_model: str = "rbf"                # PELT 成本模型
    pelt_tolerance: int = 5                # 匹配容忍度 (K线数)
    
    # 评分阈值
    quality_score_threshold: float = 40.0  # 高质量波段最低分
```

---

## 6. 与现有系统的集成方案

### 6.1 新增文件

| 文件 | 说明 |
|------|------|
| `trend_segmentation.py` | 核心算法: ZigZag 检测 + 波段构建 + 过滤评分 |
| `test_trend_segmentation.py` | 单元测试 |

### 6.2 依赖关系

```
trend_segmentation.py
  ├── 依赖: trend_indicators.py
  │     ├── compute_all_trend_indicators()
  │     ├── build_trend_context()
  │     └── TrendContext
  ├── 依赖: zigzag (外部库, pip install zigzag) 或自行实现
  └── 可选依赖: ruptures (pip install ruptures)
```

### 6.3 与 swing_labeler.py 的关系

`swing_labeler.py` 生成的是 **buy-sell 交易对**（用于 ML 标签），而 `trend_segmentation.py` 生成的是 **完整的波段分割**（用于趋势分析和因子计算）。

两者关系：
- `trend_segmentation.py` 输出的上升波段可以作为 `swing_labeler.py` 的**候选区间输入**
- `swing_labeler.py` 在这些候选区间内寻找最优的买卖点
- 两者共享 `trend_indicators.py` 的趋势评估能力

```
trend_segmentation (波段分割)
  → 识别上升波段区间
    → swing_labeler (在区间内找最优买点/卖点)
      → ML 标签
```

---

## 7. 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 上市初期数据不足 | 前 60 根 K 线不进行分割 |
| 一字涨停/跌停 | ZigZag 跳过无波动的K线 |
| 数据中有 NaN | 前向填充，NaN 超过 5% 则放弃该股票 |
| 最后一个波段未确认 | 标记 `tentative=True`，不进入高质量波段 |
| 极端波动 (ATR% > 8%) | 自动调大 ZigZag 阈值: `threshold * 1.5` |
| 长期横盘 (ADX < 10) | 不生成波段，标记为 `range` 区间 |

---

## 8. 性能预估

| 操作 | 时间复杂度 | 说明 |
|------|-----------|------|
| ZigZag 检测 (单阈值) | O(n) | 单次遍历 |
| ZigZag 多粒度 | O(k·n) | k=3 个阈值 |
| 波段构建 | O(m) | m = 转折点数量 << n |
| 趋势过滤 | O(m) | 每波段调用已有函数 |
| PELT (可选) | O(n) ~ O(n²) | 取决于数据特征 |
| **总计 (不含 PELT)** | **O(n)** | 可处理全市场 |
| **总计 (含 PELT)** | **O(n²)** | 建议离线批量 |

预计单只股票 (750 根日K线) 处理时间 < 50ms（不含 PELT），全市场 5000 只股票 < 5 分钟。

---

## 9. 验证方案

### 9.1 可视化验证

对分割结果绘制 K 线图 + ZigZag 线 + 波段标注：
- 上升波段用绿色底色标注
- 下降波段用红色底色标注
- 转折点用三角标记
- PELT 变化点用虚线标记

### 9.2 统计验证

| 指标 | 目标 |
|------|------|
| 上升波段覆盖率 | 占总交易日 30%~50% |
| 上升波段平均涨幅 | L1 > 15%, L2 > 8%, L3 > 5% |
| 波段方向准确率 | 与手动标注对比 > 80% |
| PELT 一致性得分 | > 0.6 |

### 9.3 对比验证

与现有 `swing_labeler.py` 的贪心标注结果对比：
- 上升波段覆盖的交易日重叠率
- 波段起始/结束点偏差分布
- 各自捕获的波段数量对比

---

## 10. 实施计划

| 阶段 | 内容 | 依赖 |
|------|------|------|
| Phase 1 | 实现 ZigZag 核心算法 + 波段构建 | 无外部依赖 |
| Phase 2 | 集成趋势过滤 + 评分 | 依赖 trend_indicators.py |
| Phase 3 | 可视化验证 + 统计验证 | matplotlib |
| Phase 4 | PELT 交叉验证 (可选) | ruptures |
| Phase 5 | 与 swing_labeler 集成 | swing_labeler.py |

---

## 11. 参考资料

| 资料 | 说明 |
|------|------|
| [ZigZag 指标 - Investopedia](https://www.investopedia.com/terms/z/zig_zag_indicator.asp) | ZigZag 定义与公式 |
| [zigzag Python 库](https://github.com/jbn/ZigZag) | `peak_valley_pivots` 实现 |
| [ruptures 文档](https://centre-borelli.github.io/ruptures-docs/) | PELT/BinSeg/Window 算法 |
| [findpeaks 库](https://github.com/erdogant/findpeaks) | 多方法峰谷检测 |
| Truong et al. (2020) "Selective review of offline change point detection methods" | ruptures 论文 |
