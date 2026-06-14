# 大级别反转 / 反弹买点打标算法技术方案

**版本：** v0.3  
**日期：** 2026-05-02  
**状态：** Phase 0-c 已完成（全链路已接入：Python + IPC + 前端）  
**目标模块：** 模型训练 / 标签生成 / 标签审查 / 数据集冻结

## 1. 背景与目标

当前模型训练页的标签入口叫“贪心打标”，实际实现已经不是简单贪心：`greedy_uptrend_segment_v1` 在 [python/trading_trainer/labeling/swing_labeler.py](../python/trading_trainer/labeling/swing_labeler.py) 中使用趋势段、Swing Low/High、周线锚、L1 trend filter、候选评分和 beam search 来标注上涨趋势中的回调/突破交易对。

这套标签更适合学习“上涨趋势内的顺势波段”，不适合覆盖以下机会：

1. 连续下跌后的大级别反转。
2. 熊市或弱势中的大级别反弹。
3. 底部构造完成后的第一段趋势恢复。

本方案目标是新增一套并列算法，而不是覆盖现有趋势波段算法：

```text
trend_swing_pair_v1 / greedy_uptrend_segment_v1
  -> 顺势上涨段标签

reversal_rebound_segment_v1
  -> 大级别反转 / 大级别反弹标签
```

## 2. 调研结论

### 2.1 指标类方法

单一指标不适合作为最终标签，但适合作为候选过滤和解释：

1. 趋势背景：MA20/60/120/250 排列、MA 斜率、ADX、DI+/DI-。
2. 超跌程度：RSI14/RSI6、价格相对 MA60/MA120 偏离、BOLL 下轨偏离、ATR 归一化跌幅。
3. 止跌结构：长下影、缩量横盘、放量反包、突破短期平台、MACD 柱体收敛 / 底背离。
4. 量价验证：放量阳线、地量后温和放量、成交额下限、涨停/跌停可交易性。
5. 市场环境：指数日线/周线是否止跌，个股是否显著弱于/强于市场。

指标类方法的问题是噪声大、参数敏感、容易把“下跌中继”误标为反转。因此新算法不应靠某个指标触发，而应把指标放进“结构事件搜索 + 未来路径验收”的框架。

### 2.2 K 线序列搜索方法

更适合本任务的方法：

1. 多尺度 Swing / ZigZag / Directional Change
   先用百分比或 ATR 阈值提取重要低点和高点，再判断“创新低后不再创新低”“突破前一反弹高点”等结构事件。
2. L1 Trend Filtering
   当前系统已实现 L1 分段趋势过滤。它能把价格序列拟合成分段线性趋势，拐点可解释为趋势斜率变化事件。适合作为大级别低点候选来源。
3. Trend Scanning
   对候选日期之后多个窗口做收益回归，选择 t 值显著为正、持续性最强的窗口，避免只看单日反弹。
4. Triple Barrier
   用止盈、止损、时间三重障碍验收候选点，输出是否“先达到止盈而不是止损”，适合把标签转成可训练监督目标。
5. 技术形态自动化
   Lo、Mamaysky、Wang 的技术分析自动化思想说明，主观形态需要被转成明确算法和统计检验。对本系统而言，形态只做可解释 reason，不作为不可验证黑箱。

参考资料：

1. [Lo, Mamaysky, Wang, Foundations of Technical Analysis](https://www.mit.edu/~wangj/pap/LoMamayskyWang00.pdf)
2. [Kim, Koh, Boyd, Gorinevsky, L1 Trend Filtering](https://web.stanford.edu/~boyd/papers/l1_trend_filter.html)
3. [Mlfin.py Data Labelling: Triple-Barrier and Trend Scanning](https://mlfinpy.readthedocs.io/en/stable/Labelling.html)
4. [Directional-Change Events Approach for Studying Financial Time Series](https://papers.ssrn.com/sol3/Delivery.cfm/2011-28.pdf?abstractid=1973471&mirid=1)
5. [Brock, Lakonishok, LeBaron, Simple Technical Trading Rules](https://ideas.repec.org/a/bla/jfinan/v47y1992i5p1731-64.html)

## 3. 标签定义

### 3.1 标签对象

一条有效标签仍然是一组完整 `buy-sell` 交易对：

1. `buy`：大级别反转/反弹的可交易确认点，不追求最低点。
2. `sell`：目标反弹/反转波段兑现后的可交易退出点。
3. `pair`：满足收益、回撤、持仓、可交易约束的完整样本。

原因：模型训练需要明确的正样本目标，不能只标“疑似底部”。只标底部会混入大量失败反弹，且无法对齐后续收益。

### 3.2 买点类别

建议在 `payload.label_family` 中区分：

1. `major_reversal`
   长期下跌趋势结束，后续出现趋势恢复。典型条件是周线或日线大级别低点后，突破前一反弹高点或站回 MA60/MA120。
2. `major_rebound`
   大级别下跌后的强反弹，不要求长期趋势翻多。典型条件是深跌、缩量/恐慌释放后，出现放量反包或平台突破。
3. `base_breakout`
   底部横盘整理后向上突破。典型条件是波动收敛、低点抬高、突破箱体上沿并有量能确认。

### 3.3 正样本硬约束

候选买点必须同时满足：

1. 前置跌幅：过去 `60-180` 日区间高点到候选附近低点跌幅达到阈值，默认 `>= 18%`。
2. 大级别低位：候选低点接近 `120` 日低点或 L1 / ZigZag 大级别低点。
3. 止跌确认：候选点不是继续创新低当天，至少满足放量阳线、长下影反包、突破短期平台、站回 MA10/MA20 中的一类。
4. 后续验收：`forward_days` 内先触发止盈障碍，而不是先触发止损障碍。
5. 空间要求：反弹/反转最大收益默认 `>= 10%-15%`。
6. 风险要求：买入后最大不利波动默认 `>= -8%`，极端下跌不作为高质量正样本。
7. 持仓要求：最短 `5` 日，最长 `45-60` 日。
8. 可交易要求：过滤一字涨停买点、跌停不可卖、成交额不足、新股历史不足、停牌/零成交。

## 4. 算法设计

### 4.1 总体流程

```text
读取单只股票日线
  -> 补充日线 + 周线指标
  -> 提取多尺度关键低点/高点
  -> 识别下跌背景与底部候选
  -> 生成买点候选并打分
  -> 用未来路径做 Triple Barrier / Trend Scanning 验收
  -> 寻找可交易卖点
  -> 非重叠交易对选择
  -> 写入 signal_candidates
```

### 4.2 指标预计算

在现有 `compute_all_trend_indicators` 基础上增加。按实现优先级分三级：

#### P0（必须实现，依赖少）

1. `ma120`、`ma250`、对应斜率与价格偏离。
2. `drawdown_60/120/180`：相对区间高点回撤。
3. `low_rank_120`：候选低点在 120 日区间内的低位分位。

#### P1（增强，有一定实现量）

4. `boll_width`、`boll_zscore`：用于底部收敛和极端偏离。
5. `weekly_ma5/10/20`、周线低点/高点、周线反包。
6. `macd_hist_slope`：MACD 柱体斜率（简化版，不做底背离检测）。

#### P2（可选，实现复杂）

7. `macd_bottom_divergence`：MACD 底背离检测。实现复杂度高——需要定义"前一个 MACD 低点"、"当前 MACD 低点"、"价格新低但 MACD 不新低"的精确规则，边界模糊，参数敏感。建议用简化版替代：`macd_histogram 连续 N 日收敛`。
8. 可选市场过滤：指数 `index_daily` 的 MA20/60、近 20 日收益和风险状态。需要引入指数行情数据源。

### 4.2.1 ZigZag 前置依赖

§4.3 中的 `zigzag_low` 候选源依赖 ZigZag 算法。当前代码库中**没有 ZigZag 实现**。

**决策：ZigZag 作为本项目 Phase 0-a 阶段同步实现**（约 80~120 行核心代码），不作为独立前置依赖。理由：

1. ZigZag 核心算法简单（单次遍历 O(n)），实现成本低
2. 与 `TREND_SEGMENTATION_ALGORITHM.md` 规划的 ZigZag 共享同一实现，放在 `pivot_detection.py` 模块中
3. 两个标签器（趋势波段 + 反转反弹）都依赖 ZigZag，放在公共模块避免重复

**实现位置**：`python/trading_trainer/labeling/pivot_detection.py`

**依赖关系**：

```text
pivot_detection.py (新建)
  ├── zigzag_detect()         # ZigZag 转向点检测
  ├── build_segments()        # 波段构建
  └── merge_multilevel_pivots()  # 多粒度合并

reversal_rebound_labeler.py (新建)
  └── 使用 pivot_detection.zigzag_detect() 生成 zigzag_low 候选

swing_labeler.py (现有)
  └── 未来可迁移到 pivot_detection.zigzag_detect() 替代现有 find_swing_points
```

### 4.3 多尺度结构搜索

建议并行生成三类结构候选，最后合并去重：

1. `l1_pivot_low`
   复用 `_apply_l1_trend_filter` 和 `_build_l1_pivots`，但使用更大的 `lambda` 或更高 `min_gap_bars`，只保留大级别拐点。
2. `zigzag_low`
   用 `max(pct_threshold, atr_multiple * atr_pct)` 做阈值，只有从高点回撤达到阈值后再反弹达到阈值，才确认一个重要低点。
3. `base_breakout`
   搜索 `20-60` 日箱体：振幅收敛、低点不再明显下移、收盘突破箱体上沿，并满足成交量确认。

候选确认点不一定是低点当天。推荐买点为：

1. 低点后第一个放量阳线确认日。
2. 低点后第一次站回 MA10/MA20 的收盘日。
3. 低点后突破前一个局部反弹高点的收盘日。
4. 箱体突破日。

#### 4.3.1 多源候选合并去重规则

三类候选源可能指向同一个底部区域的不同日期，需要合并去重。

**"同一底部区域"定义**：如果两个候选的买点日期差 <= `merge_window_days`（默认 5 日），视为同一底部区域。

```text
function merge_candidates(candidates_from_all_sources, merge_window_days=5):
    """
    多源候选合并去重
    
    输入:
      candidates_from_all_sources: 所有来源的候选列表，
        每个候选 = {buy_idx, buy_price, source, score, ...}
      merge_window_days: 合并窗口天数
    
    输出:
      merged: 去重后的候选列表
    """
    # Step 1: 按买点日期排序
    sorted_candidates = sort_by(candidates_from_all_sources, key='buy_idx')
    
    # Step 2: 贪心合并
    merged = []
    used = set()
    
    for c in sorted_candidates:
        if c.buy_idx in used:
            continue
        
        # 找到同一区域内的所有候选
        cluster = [c]
        for other in sorted_candidates:
            if other.buy_idx in used:
                continue
            if abs(other.buy_idx - c.buy_idx) <= merge_window_days:
                cluster.append(other)
        
        # Step 3: 在同一区域内选择评分最高的
        best = max(cluster, key=lambda x: x.score)
        
        # Step 4: 记录所有来源（用于 consistency 评分）
        best.merged_sources = list(set([x.source for x in cluster]))
        
        # Step 5: 标记已使用
        for x in cluster:
            used.add(x.buy_idx)
        
        merged.append(best)
    
    return merged
```

**合并后的候选保留以下信息**：

```json
{
  "buy_idx": 245,
  "buy_price": 18.35,
  "source": "l1_pivot_low",
  "merged_sources": ["l1_pivot_low", "zigzag_low"],
  "original_candidates": [
    {"source": "l1_pivot_low", "buy_idx": 245, "score": 68.2},
    {"source": "zigzag_low", "buy_idx": 247, "score": 55.0}
  ]
}
```

### 4.4 候选评分

候选分数用于排序和 Beam Search 路径选择，不直接决定标签真值（真值由 Triple Barrier 验收决定）。

#### 4.4.1 评分公式

总分 0~100，由 7 个维度加权求和：

```text
candidate_score =
    depth_score     * 25      # 前置跌幅深度 (0~25)
  + position_score  * 20      # 低位分位 (0~20)
  + confirm_score   * 20      # 右侧确认K线强度 (0~20)
  + consistency     * 15      # L1/ZigZag 低点一致性 (0~15)
  + momentum_score  * 10      # RSI/BOLL 极端修复 (0~10)
  + volume_score    * 10      # 量价配合 (0~10)
  - penalty                  # 各类惩罚项
```

#### 4.4.2 各维度计算规则

**depth_score (0~25): 前置跌幅深度**

```text
pre_drawdown = (区间高点 / 候选低点 - 1) * 100

if pre_drawdown >= 40:  depth_score = 25
elif pre_drawdown >= 30:  depth_score = 20
elif pre_drawdown >= 25:  depth_score = 15
elif pre_drawdown >= 18:  depth_score = 8
else:                     depth_score = 0
```

**position_score (0~20): 低位分位**

```text
low_rank_120 = 候选低点在 120 日窗口中的排名 / 120
# 0 = 最低, 1 = 最高

if low_rank_120 <= 0.05:   position_score = 20    # 120日最低5%
elif low_rank_120 <= 0.10: position_score = 16
elif low_rank_120 <= 0.20: position_score = 12
elif low_rank_120 <= 0.30: position_score = 6
else:                      position_score = 0
```

**confirm_score (0~20): 右侧确认K线强度**

确认类型分值（取多种确认的最高分）：

| 确认类型 | 条件 | 分值 |
|----------|------|------|
| 放量阳线反包 | 阳线实体吞没前阴线 + 量比>1.5 | 20 |
| 站回 MA20 | 收盘 > MA20 + 量比>1.2 | 16 |
| 站回 MA10 | 收盘 > MA10 + 量比>1.2 | 12 |
| 突破短期平台 | 突破近10日高点 + 量比>1.3 | 18 |
| 长下影反包 | 下影线 > 实体*2 | 10 |
| 仅止跌不创新低 | 最低点后>=3日未创新低 | 5 |

**consistency (0~15): L1/ZigZag 低点一致性**

```text
sources = candidate_sources 中包含的低点来源数量
# l1_pivot_low, zigzag_low, base_breakout 三种

if sources >= 3:  consistency = 15
elif sources >= 2:  consistency = 10
elif sources >= 1:  consistency = 5
else:               consistency = 0
```

**momentum_score (0~10): RSI/BOLL 极端修复**

```text
rsi14 = 候选日的 RSI14 值

if rsi14 <= 25:   momentum_score = 10   # 极度超卖
elif rsi14 <= 30: momentum_score = 7
elif rsi14 <= 35: momentum_score = 4
else:             momentum_score = 0

# 如果有 BOLL zscore 且 zscore <= -2.0，额外 +3（上限10）
```

**volume_score (0~10): 量价配合**

```text
# 低点附近成交量特征
if 地量后温和放量 (vol_ratio 从 <0.5 回升至 >1.0):  volume_score = 10
elif 低点日缩量 (vol_ratio < 0.7):                   volume_score = 7
elif 确认日放量 (vol_ratio > 1.5):                    volume_score = 5
else:                                                 volume_score = 0
```

**penalty: 惩罚项**

| 惩罚条件 | 扣分 |
|----------|------|
| 买点为跳空涨停（不可交易） | -15 |
| 市场指数仍在 MA60 下方且近 20 日跌 > 5% | -10 |
| 候选低点后 3 日内又创新低 | -20 |
| 成交额 < 2000 万 | -10 |

#### 4.4.3 reason 字段

候选 reason 应包含可审查解释：

```json
{
  "label_family": "major_rebound",
  "candidate_sources": ["l1_pivot_low", "zigzag_low"],
  "pre_drawdown_pct": -31.4,
  "pre_drawdown_days": 87,
  "pre_drawdown_start_date": "2025-06-15",
  "low_rank_120": 0.03,
  "confirm_type": "ma20_reclaim_volume_expand",
  "barrier_result": "take_profit_first",
  "candidate_score": 72.5,
  "score_breakdown": {
    "depth_score": 20,
    "position_score": 20,
    "confirm_score": 16,
    "consistency": 10,
    "momentum_score": 7,
    "volume_score": 5,
    "penalty": -5.5
  }
}
```

### 4.5 未来路径验收

新标签可以使用未来数据做"标签定义"，但训练特征必须只使用买点之前的数据。

#### 4.5.1 Triple Barrier 与 Trend Scanning 的关系

- **Triple Barrier**: 硬验收，决定标签是否生成（二值判定）
- **Trend Scanning**: 软评分，作为候选排序因子和卖点选择的辅助依据

只有 Triple Barrier 通过（先触发止盈）的候选才进入后续流程。

#### 4.5.2 Triple Barrier 精确规则

```text
function triple_barrier_evaluate(buy_idx, buy_price, df, config):
    """
    三重障碍验收
    
    输入:
      buy_idx: 买入日K线索引
      buy_price: 买入价格 (确认日收盘价)
      df: OHLCV DataFrame
      config: 障碍参数
    
    输出:
      result: {
        outcome: 'take_profit' | 'stop_loss' | 'expired',
        hit_idx: 触发日的K线索引,
        hit_price: 触发价格,
        hold_days: 持仓天数,
        max_profit_pct: 期间最大浮盈,
        max_drawdown_pct: 期间最大不利波动,
      }
    """
    # --- 计算三个障碍位 ---
    
    # 止盈障碍: 固定百分比（相对买入价）
    tp_price = buy_price * (1 + config.take_profit_pct / 100)
    
    # 止损障碍: max(固定百分比, ATR倍数)，取绝对值更小（更宽松）的那个
    # 但不超过 max_stop_loss_pct 硬上限
    atr_val = df['atr'].iloc[buy_idx]
    atr_stop = atr_val * config.stop_loss_atr_multiple    # 如 1.5 * ATR
    pct_stop = buy_price * config.stop_loss_pct / 100      # 如 -7%
    # 取两者中更宽的（绝对值更小 = 离买入价更近）
    sl_distance = min(abs(pct_stop), abs(atr_stop))
    # 但不超过硬上限
    sl_distance = min(sl_distance, buy_price * config.max_stop_loss_pct / 100)
    sl_price = buy_price - sl_distance
    
    # 垂直障碍: 最大持仓天数
    max_exit_idx = buy_idx + config.vertical_barrier_days
    
    # --- 逐日扫描，判断哪个障碍先被触发 ---
    peak_price = buy_price
    trough_price = buy_price
    
    for i in range(buy_idx + 1, min(max_exit_idx + 1, len(df))):
        day_high = df['high'].iloc[i]
        day_low = df['low'].iloc[i]
        
        # 更新期间极值
        if day_high > peak_price:
            peak_price = day_high
        if day_low < trough_price:
            trough_price = day_low
        
        # 边界情况: 跳空高开超过止盈 → 用开盘价触发
        # 边界情况: 跳空低开超过止损 → 用开盘价触发
        day_open = df['open'].iloc[i]
        
        # 检查止盈
        if day_open >= tp_price:
            return {outcome: 'take_profit', hit_idx: i, hit_price: day_open, ...}
        if day_high >= tp_price:
            # 日内触发，用 tp_price 作为触发价（可近似）
            return {outcome: 'take_profit', hit_idx: i, hit_price: tp_price, ...}
        
        # 检查止损
        if day_open <= sl_price:
            return {outcome: 'stop_loss', hit_idx: i, hit_price: day_open, ...}
        if day_low <= sl_price:
            return {outcome: 'stop_loss', hit_idx: i, hit_price: sl_price, ...}
    
    # 垂直障碍到期
    return {outcome: 'expired', hit_idx: max_exit_idx, ...}
```

#### 4.5.3 参数预设

| 参数 | coverage | balanced | precision |
|------|----------|----------|-----------|
| `take_profit_pct` | 10% | 12% | 15% |
| `stop_loss_pct` | -8% | -7% | -6% |
| `stop_loss_atr_multiple` | 1.5 | 1.5 | 2.0 |
| `max_stop_loss_pct` | -12% | -10% | -8% |
| `vertical_barrier_days` | 60 | 45 | 45 |

#### 4.5.4 到期未触发的处理

**到期淘汰**：如果垂直障碍到期时既没触发止盈也没触发止损，该候选**直接淘汰**，不生成标签。

理由：
1. 引入 `weak_rebound` 标签类型会让标签体系变复杂，增加训练时的类别不均衡
2. "到期未触发"意味着反弹力度不足，不是模型应该学习的正样本
3. 需要统计到期淘汰的占比——如果超过 30%，说明参数需要调宽

#### 4.5.5 Trend Scanning 作为评分因子

Trend Scanning 在候选通过 Triple Barrier 后执行，用于辅助排序：

```text
function trend_scanning_score(buy_idx, df, windows=[10, 20, 30, 45]):
    """
    对候选买点做多窗口收益回归，返回最佳窗口的 t 值
    
    只作为评分因子使用，不决定标签是否生成
    """
    best_t = 0
    best_window = 0
    
    for w in windows:
        if buy_idx + w >= len(df):
            continue
        segment = df['close'].iloc[buy_idx:buy_idx + w + 1]
        returns = (segment / segment.iloc[0] - 1).values
        t = np.arange(len(returns))
        # OLS: returns = a + b * t
        slope, intercept, r_value, p_value, std_err = linregress(t, returns)
        # t 值 = slope / std_err，要求显著为正
        if slope > 0 and (std_err > 0):
            t_stat = slope / std_err
            if t_stat > best_t:
                best_t = t_stat
                best_window = w
    
    return {t_stat: best_t, window: best_window}
```

Trend Scanning 的结果写入 `payload.trend_scan_t` 和 `payload.trend_scan_window`，可供审查和训练时参考。

### 4.6 卖点规则

卖点不追求最高点，按可执行退出选择：

1. 达到止盈后跌破 MA5/MA10。
2. 达到止盈后阶段高点回撤 `35%-45%`。
3. 放量长上影 / 高位滞涨。
4. 趋势扫描最佳窗口结束日。
5. 达到最大持仓日仍未退出，则选择最后一个可交易日。

### 4.7 非重叠交易对选择策略

#### 4.7.1 设计原则

反转/反弹标签天然可能重叠——同一只股票在大级别反转内部可能包含多个小级别反弹。但交易对之间不允许重叠（一个交易对的卖出日必须早于下一个交易对的买入日）。

**不允许嵌套**：如果两个交易对的持仓区间有交集，只能保留一个。理由：
1. 标签用于训练"买入/不买入"的二元分类，嵌套会让同一时间段有多个正样本
2. 实际交易中不可能同时持有同一只股票的两个不同头寸

#### 4.7.2 选择算法：评分优先贪心

采用与现有 `swing_labeler.py` 的 Beam Search（`_select_pairs_with_beam`）相同的框架，但调整评分函数。

```text
function select_non_overlapping_pairs(candidate_pairs, beam_width=3):
    """
    从候选交易对中选择非重叠的最优子集
    
    输入:
      candidate_pairs: List[{buy_idx, sell_idx, pair_score, label_family, ...}]
        所有通过 Triple Barrier 验收的候选交易对
      beam_width: Beam Search 宽度
    
    输出:
      selected_pairs: 最优的非重叠交易对列表
    """
    # Step 1: 按 buy_idx 排序
    sorted_pairs = sort_by(candidate_pairs, key='buy_idx')
    
    # Step 2: Beam Search
    # 每条路径 = {pairs: [...], score: total_score, last_sell_idx: int}
    paths = [{pairs: [], score: 0, last_sell_idx: -1}]
    
    for pair in sorted_pairs:
        expanded = []
        for path in paths:
            # 检查是否重叠: 新买点必须在上一笔卖出之后
            if pair.buy_idx > path.last_sell_idx:
                new_path = {
                    pairs: path.pairs + [pair],
                    score: path.score + pair.pair_score,
                    last_sell_idx: pair.sell_idx
                }
                expanded.append(new_path)
        
        # 合并旧路径和扩展路径，保留 top beam_width
        all_paths = paths + expanded
        # 去重: 相同 pairs 数量时只保留最高分
        all_paths = deduplicate(all_paths)
        paths = sort_by(all_paths, key='score', reverse=True)[:beam_width]
    
    # Step 3: 返回得分最高路径的交易对
    return max(paths, key=lambda p: p.score).pairs
```

#### 4.7.3 pair_score 评分

每个交易对的综合得分，用于 Beam Search 排序：

```text
pair_score = 
    profit_pct * 2.0            # 收益权重最高
  + risk_reward * 1.0           # 风险收益比
  + candidate_score * 0.3       # 买点候选评分（来自 §4.4）
  + trend_scan_t * 0.5          # Trend Scanning t 值（来自 §4.5.5）
  - max_drawdown_pct * 0.5      # 惩罚持仓期间最大回撤
  + label_family_weight         # 类别加权
```

**label_family_weight**：

| label_family | weight | 理由 |
|-------------|--------|------|
| `major_reversal` | +5 | 大级别反转最稀缺、最有价值 |
| `base_breakout` | +3 | 底部突破有结构确认 |
| `major_rebound` | +1 | 大级别反弹较常见 |

#### 4.7.4 与现有趋势标签的重叠处理

反转/反弹标签与现有趋势波段标签（`greedy_uptrend_segment_v1`）可能存在时间重叠。处理方式：

1. **不在本算法内处理**：两种标签通过 `source_strategy` 严格隔离，各自独立选择
2. **在数据集冻结时处理**：如果同一时间段同时有趋势标签和反转标签，由数据集构建逻辑决定使用哪个（推荐优先使用反转标签，因为更稀缺）
3. **在训练时处理**：独立训练反转模型和趋势模型，不做混训

## 5. 系统接入方案

### 5.1 Python 模块

新增文件：

1. `python/trading_trainer/labeling/pivot_detection.py`
   ZigZag 转向点检测公共模块。被 `reversal_rebound_labeler.py` 和未来的趋势波段分割模块共同使用。
2. `python/trading_trainer/labeling/reversal_rebound_labeler.py`
3. `python/tests/test_pivot_detection.py`
4. `python/tests/test_reversal_rebound_labeler.py`

复用文件：

1. `python/trading_trainer/labeling/trend_indicators.py`
2. `python/trading_trainer/labeling/swing_labeler.py` 中的可交易过滤、L1 trend filter、DB 保存结构可抽公共 helper。

建议先做最小拆分：

1. 第一期允许少量 helper 复制，降低对现有趋势标注器的回归风险。
2. 第二期再抽 `tradability.py`、`db_writer.py`、`pivot_detection.py`。

### 5.2 CLI 与 IPC

新增 CLI：

```bash
python3 -m trading_trainer.labeling.reversal_rebound_labeler \
  --market-db <path> \
  --label-db <path> \
  --save-db \
  --strategy reversal_rebound_segment_v1 \
  --quality-preset balanced
```

Main 层建议新增通用打标 runner，而不是继续把所有算法塞进 `runSwingLabelGenerateCli`：

```text
modeling:generateStrategyLabels
  params.algorithm = trend_swing | reversal_rebound
```

为减少第一期改动，也可以先新增：

```text
modeling:generateReversalReboundLabels
```

后续再合并成统一入口。

### 5.3 前端页面

当前 `LabelingDatasetTab` 中“贪心打标”建议改为“策略打标”，下面拆两个算法卡片：

1. `上涨趋势波段`
   对应现有 `greedy_uptrend_segment_v1`。
2. `大级别反转/反弹`
   对应新增 `reversal_rebound_segment_v1`。

抽样审核页无需大改，只要读取 `payload.label_family`、`payload.candidate_sources`、`payload.barrier_result` 并展示即可。

### 5.4 数据写入

继续写入 `signal_candidates`：

1. `source_strategy = reversal_rebound_segment_v1`
2. `factor_type = ReversalReboundBuy` / `ReversalReboundSell`
3. `payload.label_family` 区分反转、反弹、底部突破。
4. `payload.run_meta` 写入所有参数、marketDb、labelDb、runId。

重跑覆盖范围沿用现有逻辑：同策略 + 同股票范围先解除 `dataset_items.candidate_id` 引用，再删除旧候选并写入新候选。

## 6. 对系统的影响

### 6.1 数据层影响

无需新增表。主要影响是 `signal_candidates.payload` 的字段扩展。

需要注意：

1. 冻结数据集仍通过 `dataset_items` 保存标签样本，不应因重跑候选被删除。
2. 新旧策略必须通过 `source_strategy` 严格隔离，避免数据集冻结时混入不同标签口径。
3. marketDb 与特征构建 DB 必须一致或可追溯，否则标签与训练特征可能来自不同行情源。

### 6.2 训练影响

新标签与趋势上涨标签的分布差异很大：

1. 正样本更少，类别不均衡更严重。
2. 特征需要覆盖下跌末端和底部修复，而不只是上升趋势因子。
3. 评估不能只看 AUC，应增加命中后收益、最大回撤、平均持仓、时间切分稳定性。
4. 推荐单独训练 `reversal_rebound` 模型，再与趋势模型做 ensemble，不建议一开始混训。

### 6.3 业务影响

新增算法会让标签入口从单一“贪心打标”变成多算法标签中心。建议文案统一：

1. “贪心打标”改为“策略打标”。
2. “贪心上涨段”改为“上涨趋势波段”。
3. 新增“大级别反转/反弹”。

## 7. 开发风险

1. 未来函数风险
   标签可用未来路径验收，但特征构建必须严格只取买点前数据。需要在 feature audit 中加入反转标签数据集专项检查。
2. 参数过拟合风险
   大级别反弹样本稀疏，阈值容易贴合历史。必须做时间切分和跨年份复核。
3. 下跌中继误标风险
   单日放量反包、RSI 超跌很容易失败。必须以 Triple Barrier 的先止盈/先止损结果做硬验收。
4. 行情源不一致风险
   marketDb 分离后，标签与特征可能不来自同一数据源。run_meta 必须记录 DB 路径，训练页需要展示数据源。
5. 样本覆盖不足风险
   严格反转标签可能太少，不够训练。需要 `coverage/balanced/precision` 三档预设，并把低置信样本默认排除训练。
6. 现有标签审查兼容风险
   审查页当前偏趋势波段字段。新增 payload 字段要保持向后兼容，不应要求旧标签也有 `label_family`。
7. 性能风险
   全市场多尺度搜索 + trend scanning 比现有算法更重。需要通过参数和按钮控制运行规模，支持正式版链路下的降载运行。

## 8. 实施计划

### Phase 0-a: 最小可验证闭环

目标：单只股票跑通全流程，可视化验证算法正确性。

1. 新建 `pivot_detection.py`，实现 ZigZag 转向点检测（~100 行）。
2. 在 `trend_indicators.py` 中增加 P0 级指标：`ma120/250`、`drawdown`、`low_rank_120`。
3. 新建 `reversal_rebound_labeler.py` 骨架，实现：
   - L1 pivot 候选（复用 `_apply_l1_trend_filter`）
   - ZigZag 候选（调用 `pivot_detection.py`）
   - 简化版确认规则（仅放量阳线反包 + 站回 MA10/MA20）
   - Triple Barrier 验收（完整实现）
   - 简化版卖点（MA5 跌破 + 最大持仓天数）
4. 可视化验证：对 5~10 只已知反转股票绘图，人工确认分割是否合理。

**交付物**：Jupyter notebook 或脚本，可视化展示候选买点、Triple Barrier 结果、买卖配对。

### Phase 0-b: 接入正式版链路

1. 加入 base_breakout 候选 + 多源合并去重。
2. 实现完整评分公式和 pair_score。
3. 实现 Beam Search 非重叠选择。
4. 实现 Trend Scanning 评分因子。
5. 写入 `signal_candidates`，沿用现有覆盖清理机制。
6. CLI 入口：`python -m trading_trainer.labeling.reversal_rebound_labeler --save-db ...`

**交付物**：CLI 可运行，结果写入 label DB。

### Phase 0-c: 前端接入

1. Main 接入 `modeling:generateReversalReboundLabels` IPC handler。
2. 前端 `LabelingDatasetTab` 新增"大级别反转/反弹"算法卡片，提供参数预设。
3. 抽样审查页展示 `label_family`、`candidate_sources`、`barrier_result`、`score_breakdown`。

### P1: 增强与降载

1. 增加 P1 级指标：BOLL、周线指标、MACD histogram 斜率。
2. 支持"全市场 / 指定股票数 / 指定日期范围 / 指定历史窗口"四类运行规模控制。
3. 提供 coverage / balanced / precision 三档预设。
4. CLI / IPC 返回统一运行评估卡：样本数、先止盈率、平均收益、平均最大回撤、持仓天数、失败原因分布。
5. 保留中止任务能力。

### P2: 训练闭环与模型对比

1. 冻结单独反转/反弹数据集。
2. 构建特征并训练独立模型。
3. 与趋势波段模型做 Walk-Forward 对比。
4. 在部署页做独立阈值和 ensemble 权重。

## 9. 验收标准

1. 正式版链路（UI -> IPC -> Python -> 入库 -> 审查）一次跑通，且支持参数化规模控制。
2. 全量运行不污染 `greedy_uptrend_segment_v1` 标签。
3. 每个正样本都有完整买卖配对和 `barrier_result`。
4. 反转标签数据集的冻结、特征构建、训练流程完整跑通。
5. 时间切分验证中，至少报告交易次数、胜率、盈亏比、最大回撤、平均持仓、失效场景。
6. 人工抽样审核与规模化运行都通过后，进入正式训练集。

## 10. 当前结论

大级别反转/反弹标签不应被设计成“某指标金叉即买入”。更稳的路线是：

```text
大级别下跌背景
  + 多尺度结构低点
  + 右侧确认 K 线
  + Triple Barrier / Trend Scanning 未来路径验收
  + 可交易买卖配对
```

它与现有上涨趋势波段标签是互补关系，推荐作为独立 `source_strategy`、独立数据集、独立模型先上线，再做集成。

## 11. 实施记录

### Phase 0-a（已完成 2026-05-02）

| 交付物 | 文件 | 说明 |
|--------|------|------|
| ZigZag 转向点检测 | `pivot_detection.py` | zigzag_detect + build_segments + merge_multilevel_pivots |
| 反转/反弹标签器 | `reversal_rebound_labeler.py` | L1+ZigZag候选、确认规则、Triple Barrier、Beam Search |
| 趋势指标扩展 | `trend_indicators.py` | MA120/250、drawdown_60/120/180、low_rank_120 |
| 单元测试 | `test_pivot_detection.py` | 16 个测试 |
| 验证脚本 | `verify_reversal_rebound.py` | 合成数据全链路验证 |

### Phase 0-b（已完成 2026-05-02）

| 交付物 | 说明 |
|--------|------|
| base_breakout 候选 | 30日箱体突破检测 |
| Trend Scanning | 多窗口 OLS 趋势强度评分 |
| pair_score 集成 | Trend Scanning t 值加入评分公式和 payload |

### Phase 0-c（已完成 2026-05-02）

| 交付物 | 文件 | 说明 |
|--------|------|------|
| IPC CLI runner | `modelCliRunner.ts` | runReversalReboundLabelCli + cancelReversalReboundLabelCli |
| IPC handler | `modelDatasetIpc.ts` | modeling:generateReversalReboundLabels + cancel |
| Preload API | `preload/index.ts` | generateReversalReboundLabels + cancelReversalReboundLabelGeneration |
| 前端 UI | `LabelingDatasetTab.tsx` | 新增"大级别反转/反弹"子 tab + 参数预设 + 执行按钮 |

验证结果：172 个 Python 测试通过，TypeScript 编译零错误。
