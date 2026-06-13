# 标注数据修复与可视化检查方案

> 日期: 2026-04-23
> 状态: 已完成（2026-04-23，当日落地并归档）

## 背景

v009 模型回测 Sharpe 高达 20.69（LightGBM）、累计收益 +294%，远超合理范围。
经排查发现两个根本问题：

1. **标签定义错误**: 标签基于持仓窗口内的理论最高价（max_return），而非实际退出收益。
   模型学会了预测"冲高"，但实际交易无法在最高点卖出。
2. **数据分割**: 当前 70/15/15 切分，需调整为 70/10/20 以加大测试集比例。

此外，缺乏标注数据的可视化检查手段，无法直观验证标签质量。

---

## 实施结果快照

1. 标签默认口径已改为 `exit_return`，CLI/UI 均保留 `max_return` 兼容开关（用于历史对照）。
2. 特征切分已从 `70/15/15` 调整为 `70/10/20`，测试集占比提升。
3. DataTab 已接入“检查标签”按钮，支持打开“标签人工抽样检查”面板。
4. 面板可直接识别 `max_only`：查看 `label_alignment = max_only` 与“冲高但未兑现”统计项。

---

## 问题详解

### 标签问题

**当前逻辑** (`overnight_labeler.py:269`):
```python
label = 1 if max_return_pct >= threshold * 100 else 0
```
- `max_return_pct` = 持仓窗口内最高价相对入场价的涨幅
- 一只股票日内冲高 +3% 但收盘 -1% → 被标为正样本（threshold=1%）
- 回测保守退出用 D+2 收盘价 → 实际亏损 -1%
- **模型训练目标（预测冲高）与回测评估目标（实际退出收益）不一致**

**存储中已有但未使用的字段**:
- `return_pct` (line 266): 实际退出收益 `(exit_price - entry_price) / entry_price * 100`
- `exit_price` (line 265): D+2 10:45 的最后 bar 收盘价

### 过拟合验证

v009 在同一数据集上表现过于完美，需要:
- 修复标签定义后重新训练
- 用 70/10/20 分割加大测试集
- 引入 walk-forward 验证（远期）

---

## 任务列表

### T1: 修复标签定义

**难度**: ★☆☆ 简单
**文件**: `python/trading_trainer/labeling/overnight_labeler.py`
**预计改动**: ~20 行

**具体改动**:

1. `generate_overnight_labels_for_stock` (line 269):
   - 改为 `label = 1 if return_pct >= threshold * 100 else 0`
   - 保留 `max_return_pct` 字段供参考

2. `generate_overnight_labels_daily` (line 376):
   - 同上，改为用 `return_pct` 判断标签

3. CLI 新增参数 (`cli.py`):
   - `--label-method` 选择: `exit_return`(默认，新逻辑) / `max_return`(旧逻辑)
   - 传入 labeler 函数，控制使用哪个收益字段判断标签

4. `OvernightLabel` dataclass 保持不变（字段已够用）

**验收标准**:
- `--label-method exit_return` 生成的标签中，正样本比例应明显下降
- `--label-method max_return` 行为与旧版一致（向后兼容）

---

### T2: 训练/测试分割调整为 70/10/20

**难度**: ★☆☆ 简单
**文件**: `python/trading_trainer/features/builder.py`
**预计改动**: ~10 行

**具体改动**:

`_split_dataset` 方法 (line 817):
```python
# 当前
train_len = max(1, int(total_len * 0.7))
valid_len = max(1, int(total_len * 0.15))

# 改为
train_len = max(1, int(total_len * 0.7))
valid_len = max(1, int(total_len * 0.1))
# test 自然获得剩余 ~20%
```

可选: 在 `FeatureBuilder.__init__` 或 `build_features` 中添加 `split_ratio` 参数。

**验收标准**:
- 新构建的特征目录中，test.parquet 样本数约为总量的 20%
- 训练后回测在更大的测试集上运行

---

### T3: 新增 Python IPC — 查询数据集标签详情

**难度**: ★★☆ 中等
**文件**: `python/trading_trainer/cli.py`, `src/main/ipc/modelDatasetIpc.ts`, `src/preload/index.ts`, `src/types/global.d.ts`
**预计改动**: ~80 行

**具体改动**:

1. **Python CLI** (`cli.py`):
   - 新增命令 `label inspect`:
   ```
   python -m trading_trainer.cli label inspect \
     --dataset ds_xxx \
     --code sh600000 \
     --limit 50
   ```
   - 查询 `dataset_items` + 关联 `kline_daily` 获取 OHLC
   - 返回 JSON: `[{entry_date, entry_price, exit_date, exit_price, return_pct, max_return_pct, label, bar_timestamp, d1_open, d1_high, d2_high, d2_close}]`

2. **IPC Handler** (`modelDatasetIpc.ts`):
   - 新增 `labeling:getLabelDetails(datasetId, code, limit)` handler
   - spawn Python CLI 命令，解析 JSON 输出

3. **Preload** (`preload/index.ts`):
   - 新增 `labelingGetLabelDetails(datasetId: string, code: string, limit: number)` 方法

4. **类型声明** (`global.d.ts`):
   - 新增接口声明

**验收标准**:
- 前端可调用 `window.electronAPI.labeling.getLabelDetails(...)` 获取指定股票的标签列表
- 返回数据包含 entry/exit 价格和收益信息

---

### T4: 前端标签可视化组件

**难度**: ★★★ 较难
**文件**: 新建 `src/components/trading/model/LabelInspectPanel.tsx` + `LabelInspectPanel.css`
**预计改动**: ~300 行

**功能描述**:

1. **输入区域**:
   - 数据集选择（下拉框，从已有数据集列表）
   - 股票代码输入（支持搜索）
   - 日期范围过滤（可选）
   - "加载" 按钮

2. **K线图表**:
   - 复用 `BaseKlineChart` 组件
   - 数据源: 调用 `data.getKline(code, '1d')` 获取日K
   - 标记叠加:
     - 正样本 (label=1): 绿色上三角，标注在 entry_date 的K线上方
     - 负样本 (label=0): 红色下三角，标注在 entry_date 的K线下方
   - 点击标记弹出 tooltip: entry_price, exit_price, return_pct, max_return_pct

3. **统计面板**:
   - 正/负样本数量和比例
   - 平均 return_pct vs 平均 max_return_pct
   - return_pct 分布直方图（可选）

4. **列表视图**（可选）:
   - 表格展示所有标签，按日期排序
   - 支持排序和过滤

**验收标准**:
- 选择数据集和股票后，K线图上正确显示买卖标记
- 点击标记可查看详细收益信息
- 统计面板显示正确的正负比例

---

### T5: 前端标签可视化 — 接入 DataTab

**难度**: ★★☆ 中等
**文件**: `src/components/trading/model/DataTab.tsx`
**预计改动**: ~50 行

**具体改动**:

1. 在数据集列表的每行操作按钮中，添加"检查标签"按钮
2. 点击后展开或弹窗显示 `LabelInspectPanel`
3. 自动传入当前 dataset_id
4. 用户只需输入股票代码即可查看

**验收标准**:
- DataTab 中数据集行可见"检查标签"按钮
- 点击后能正常加载并显示标签可视化

---

### T6: Walk-forward 验证框架（远期，暂不执行）

**难度**: ★★★ 较难
**文件**: `python/trading_trainer/features/builder.py` 或新模块 `walk_forward.py`

**概述**:
- 滚动窗口: 用前 6 个月训练，下 1 个月测试，窗口向前滑动
- 每个窗口独立训练+回测
- 汇总 OOS (out-of-sample) 夏普比率和累计收益
- 作为模型真实表现的度量标准

**优先级**: 低。待 T1-T5 完成且标签修复后验证效果再决定。

---

## 执行顺序与并行策略

```
阶段1 (可并行):
  Agent A: T1 (修复标签定义) + T2 (70/10/20分割)
  → 完成后: 重新生成标签 → 重新构建特征 → 重新训练 → 回测验证

阶段2 (依赖阶段1的回测结果验证通过):
  Agent B: T3 (Python IPC)
  Agent C: T4 (前端可视化组件) — 可与T3并行开发，用mock数据

阶段3:
  Agent C: T5 (接入DataTab) — 依赖T3+T4完成
```

## 关键依赖

- T4 依赖 T3 的 IPC 接口（可用 mock 数据先开发）
- T5 依赖 T3 + T4
- T1 + T2 应最先执行，修复后需完整跑一次训练-回测流水线验证效果
- T6 暂不排期
