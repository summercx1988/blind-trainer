# Pipeline 模块化改造路线图

**版本：** v1.4  
**日期：** 2026-05-21  
**状态：** 执行中（Phase 1/2/3/4/5/6/7 已完成，Phase 8 待实施）
**前置文档：** `LABELING_STRATEGY_PIPELINE_ASSESSMENT.md`、`ARCHITECTURE.md`、`ROADMAP.md`

---

## 0. 改造目标

将 ML pipeline 的五个核心节点（候选生成、标签验收、数据集构建、特征构建、模型评估）统一为 Registry + Contract 模式，使"新增一种标签策略"从当前"改 6+ 文件"降为"1 个 Python 文件 + 可选 1 个前端组件"。

改造完成后：

| 指标 | 当前 | 目标 |
|---|---:|---:|
| 新增训练引擎所需文件数 | 1 文件（已达成） | 1 文件 |
| 新增标签策略所需文件数 | 6+ 文件 | 1-2 文件 |
| Pipeline 节点可替换性 | 45% | 85% |
| TS/Python 双实现风险 | 已消除推理侧 | 全链路消除 |

---

## 1. 已完成工作基线

### 1.1 Phase 1：训练器 + 推理 Registry（已完成 ✅）

**改动范围：**

| 文件 | 改动 |
|---|---|
| `python/trading_trainer/models/registry.py` | 新建，`@register_trainer` / `@register_inference` 装饰器 |
| `python/trading_trainer/models/trainer.py` | 加 `@register_trainer("baseline")` + `@register_inference("baseline")`，补充 `model_type: "baseline"` |
| `python/trading_trainer/models/lightgbm_trainer.py` | 加 `@register_trainer("lightgbm")` + `@register_inference("lightgbm")` |
| `python/trading_trainer/models/catboost_trainer.py` | 加 `@register_trainer("catboost")` + `@register_inference("catboost")` |
| `python/trading_trainer/models/trainer_utils.py` | `predict_with_artifact` 改为 `get_inference()` 查表 |
| `python/trading_trainer/cli.py` | 训练分发改为 `get_trainer(engine)` 查表，构造器统一签名消除 if/elif |
| `python/trading_trainer/models/__init__.py` | 显式 import 触发注册，导出 registry API |
| `python/trading_trainer/models/walk_forward.py` | `_fit_predict` 改为 `get_trainer()` + `fit_window()` 统一训练，`get_inference()` 统一推理，消除 if/elif |

**成果：** 新增训练引擎 = 1 个新文件 + 装饰器注册，不改动其他文件。构造器签名统一为 `(spec_version, **kwargs)`。

### 1.2 推理链路统一（已完成 ✅）

| 修复项 | 内容 |
|---|---|
| TS 侧推理 → Python CLI | 所有模型类型统一走 `runPredictBatchCli` / `runPredictLiveCli` |
| Confidence 公式统一 | `min(1.0, \|score - threshold\| / max(threshold, 1 - threshold))` |
| Spec 版本 | 从硬编码 `'v004'` 改为读取 `runtime.specVersion` |
| 默认置信度 | 0.6 → 0.85 |
| 信号扫描双模式 | `latest_snapshot` + `historical_replay` |
| DB 迁移防御性检查 | `PRAGMA table_info` 先检后 ALTER |
| 推荐复盘 `readBars` | 不传日期范围，加载全量 K 线 |

### 1.3 已知死代码（已全部清理 ✅）

| 位置 | 死代码 | 状态 |
|---|---|---|
| `modelFeatureCalculator.ts` | `buildLatestFeatureValues` 函数 | ✅ Phase 5 已删除 |
| `modelSignalInferenceService.ts` | `predictLightGBM` / `predictTree` 函数 | ✅ Phase 5 已删除 |
| `modelFeatureCalculator.ts` | `KlineFeatureRow`, `mean`, `std`, `quantile`, `windowSlice`, `pctChange`, `rollingMean`, `rollingStd`, `calcRsi14`, `calcAtr14`, `corrWindow` | ✅ Phase 6 已删除 |

---

## 2. 后续 Phase 规划

### Phase 2：Labeler Registry（Python 侧）

**目标：** 新增标签策略 = 1 个 Python 文件 + 装饰器注册。

**当前问题：**

1. `swing_labeler.py`（2076 行）和 `reversal_rebound_labeler.py`（975 行）是两个完全独立模块，各自有独立的 CLI `__main__` 入口
2. `reversal_rebound_labeler.py` 已经依赖 `swing_labeler.py` 的 9 个内部函数（`_apply_l1_trend_filter` 等），耦合度高但无抽象
3. 标签输出字段不统一：`payload` 是半结构化 JSON，不同标签器字段不同
4. `specs.py` 中 `get_feature_spec()` 使用 if/elif 链（v001-v011），违反 Registry 原则

**改造步骤：**

#### 2a. 建立 Labeler 基类与 Registry

新建文件：

```
python/trading_trainer/labeling/
├── base.py          # LabelerBase 抽象基类
├── registry.py      # @register_labeler + get_labeler() 查表
```

`base.py` 定义：

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class LabelerInfo:
    name: str                    # "swing", "reversal_rebound", "overnight"
    display_name: str            # "趋势波段", "反转反弹", "隔夜"
    supported_presets: List[str] # ["coverage", "balanced", "precision"]
    default_strategy: str        # 写入 signal_candidates 的 source_strategy
    description: str

class LabelerBase(ABC):
    @classmethod
    @abstractmethod
    def info(cls) -> LabelerInfo: ...

    @abstractmethod
    def label_batch(self, db_path: str, codes: List[str],
                    strategy: str, quality_preset: str, **kwargs) -> Dict: ...

    @abstractmethod
    def get_presets(self) -> Dict[str, Dict]: ...
```

`registry.py` 定义：

```python
_LABELERS: Dict[str, Type[LabelerBase]] = {}

def register_labeler(name: str):
    def decorator(cls):
        _LABELERS[name] = cls
        return cls
    return decorator

def get_labeler(name: str) -> Type[LabelerBase]:
    if name not in _LABELERS:
        raise ValueError(f"Unknown labeler: '{name}'. Available: {list_labelers()}")
    return _LABELERS[name]

def list_labelers() -> List[str]:
    return sorted(_LABELERS.keys())
```

#### 2b. 重构现有 Labeler

| 文件 | 改动 |
|---|---|
| `swing_labeler.py` | 加 `@register_labeler("swing")`，将 `label_batch_swing` 包装为 `LabelerBase.label_batch` 实现 |
| `reversal_rebound_labeler.py` | 加 `@register_labeler("reversal_rebound")`，将核心函数包装为 `LabelerBase.label_batch` 实现 |
| `overnight_labeler.py`（如已有） | 加 `@register_labeler("overnight")` |
| `labeling/__init__.py` | 显式 import 触发注册 |
| `cli.py` | 新增 `label generate` 统一子命令：`trainer label generate --labeler swing --preset balanced` |

**共性函数提取：** 将 `reversal_rebound_labeler.py` 从 `swing_labeler.py` 导入的 9 个函数移到 `indicators.py` 或 `labeling/utils.py`，消除跨 labeler 内部依赖。

#### 2c. 统一标签输出 Contract

定义标准 `signal_candidates` payload 字段：

```json
{
  "label_family": "swing",
  "candidate_sources": ["trend_filter", "swing_low"],
  "validator": "triple_barrier",
  "entry_rule_version": "v1",
  "label_policy_version": "v1",
  "market_data_fingerprint": "<db_path_mtime>",
  "feature_time": "2025-01-15",
  "signal_time": "2025-01-15",
  "run_meta": {
    "run_id": "...",
    "labeler": "swing",
    "preset": "balanced",
    "spec_version": "v1"
  }
}
```

**验收条件：**

- [ ] `get_labeler("swing")` 返回 `SwingLabeler` 类
- [ ] `get_labeler("reversal_rebound")` 返回 `ReversalReboundLabeler` 类
- [ ] `cli.py label generate --labeler swing` 可执行
- [ ] 标签输出包含统一的 contract 字段
- [ ] 跨 labeler 共性函数已提取到公共模块

**涉及文件：**

| 文件 | 操作 |
|---|---|
| `python/trading_trainer/labeling/base.py` | 新建 |
| `python/trading_trainer/labeling/registry.py` | 新建 |
| `python/trading_trainer/labeling/swing_labeler.py` | 修改 |
| `python/trading_trainer/labeling/reversal_rebound_labeler.py` | 修改 |
| `python/trading_trainer/labeling/__init__.py` | 修改 |
| `python/trading_trainer/cli.py` | 修改 |
| `python/trading_trainer/labeling/indicators.py` 或新建 `utils.py` | 修改 |

---

### Phase 3：Labeler 前端泛化

**目标：** 新增标签策略不要求改动前端代码（参数兼容时），或仅增加 1 个参数描述文件（新参数类型时）。

**当前问题：**

1. `LabelingDatasetTab.tsx` 有两套独立面板：`subView === 'labeling'`（~100 行 Swing）和 `subView === 'reversal'`（~100 行 Reversal），硬编码策略名和 IPC 通道
2. IPC 层有 4 个独立通道：`generateSwingLabels` / `cancelSwingLabelGeneration` / `generateReversalReboundLabels` / `cancelReversalReboundLabelGeneration`
3. `modelCliRunner.ts` 有两个独立函数：`runSwingLabelGenerateCli` / `runReversalReboundLabelCli`，各自管理独立进程
4. `preload/index.ts` 和 `global.d.ts` 需要为每个标签器新增 API 声明

**改造步骤：**

#### 3a. 统一 IPC 通道

将 4 个通道合并为 2 个通用通道：

| 旧通道 | 新通道 |
|---|---|
| `modeling:generateSwingLabels` | `modeling:generateLabels`（参数含 `labeler: "swing"`） |
| `modeling:generateReversalReboundLabels` | `modeling:generateLabels`（参数含 `labeler: "reversal_rebound"`） |
| `modeling:cancelSwingLabelGeneration` | `modeling:cancelLabelGeneration` |
| `modeling:cancelReversalReboundLabelGeneration` | `modeling:cancelLabelGeneration` |

#### 3b. 统一 CLI Runner

将 `runSwingLabelGenerateCli` 和 `runReversalReboundLabelCli` 合并为 `runLabelGenerateCli`：

```ts
function runLabelGenerateCli(params: {
  labeler: string;        // "swing" | "reversal_rebound" | ...
  strategy: string;
  qualityPreset: string;
  codes?: string[];
  dbPath: string;
  marketDbPath: string;
}): Promise<...>
```

内部调用 `python -m trading_trainer.cli label generate --labeler <name> ...`。

#### 3c. 动态标签面板

`LabelingDatasetTab.tsx` 改为：

1. 启动时调用 `modeling:listLabelers` 获取可用标签器列表及其元信息（`display_name`、`supported_presets`、`description`）
2. 动态渲染标签器选择下拉框
3. 根据选中标签器的 `supported_presets` 动态渲染预设选择
4. 生成/取消调用统一的 `modeling:generateLabels` / `modeling:cancelLabelGeneration`

保留 `review` 和 `dataset` 子视图不变（它们是策略无关的）。

#### 3d. Preload / Type 声明更新

`preload/index.ts` 和 `global.d.ts` 新增：

```ts
generateLabels(params: { labeler: string; strategy: string; qualityPreset: string; ... }): Promise<...>
cancelLabelGeneration(): Promise<...>
listLabelers(): Promise<LabelerInfo[]>
```

旧的 `generateSwingLabels` / `generateReversalReboundLabels` 标记为 deprecated，一个版本后移除。

**验收条件：**

- [ ] `LabelingDatasetTab.tsx` 不再硬编码 Swing/Reversal 面板
- [ ] 新增一个 Python labeler 后，前端自动出现在下拉框中（无需改 TS 代码）
- [ ] 统一的 IPC 通道可同时处理所有标签器类型
- [ ] 旧的 Swing/Reversal 独立通道仍可工作（向后兼容）

**涉及文件：**

| 文件 | 操作 |
|---|---|
| `src/components/trading/model/LabelingDatasetTab.tsx` | 重构 |
| `src/main/ipc/modelDatasetIpc.ts` | 修改 |
| `src/main/ipc/modelCliRunner.ts` | 修改 |
| `src/main/ipc/model.ts` | 修改 |
| `src/preload/index.ts` | 修改 |
| `src/types/global.d.ts` | 修改 |

---

### Phase 4：Feature Spec Registry

**目标：** 特征版本从 if/elif 链改为声明式注册表，支持按标签族配置不同 spec。

**当前问题：**

1. `specs.py` 的 `get_feature_spec()` 使用 11 层 if/elif（v001-v011）
2. `builder.py` 的 `_compute_feature_frame()` 使用 `if self.spec.version >= "v002"` 累加式分支，1280 行单文件
3. 所有标签策略共享同一套 feature spec，无法为"反转反弹"和"趋势延续"配置不同特征集

**改造步骤：**

#### 4a. Spec 注册表

将 `get_feature_spec()` 改为字典查表：

```python
_SPECS: Dict[str, FeatureSpec] = {}

def register_spec(version: str):
    def decorator(spec_cls_or_instance):
        _SPECS[version] = spec_cls_or_instance
        return spec_cls_or_instance
    return decorator

def get_feature_spec(version: str) -> FeatureSpec:
    if version not in _SPECS:
        raise ValueError(f"Unknown spec: '{version}'. Available: {list_specs()}")
    return _SPECS[version]
```

每个版本定义为独立常量或 dataclass 实例：

```python
@register_spec("v011")
SPEC_V011 = FeatureSpec(
    version="v011",
    interval="1d",
    lookbackBars=60,
    columns=[...179 个特征列名...],
)
```

#### 4b. Builder 函数提取

将 `builder.py` 中按版本累加的特征计算逻辑拆分为可组合的 compute 函数：

```python
_FEATURE_COMPUTORS: Dict[str, Callable] = {}

def register_feature_group(group_name: str):
    def decorator(fn):
        _FEATURE_COMPUTORS[group_name] = fn
        return fn
    return decorator

@register_feature_group("basic_price")
def compute_basic_price(df): ...

@register_feature_group("overnight_decomposition")
def compute_overnight(df): ...
```

`_compute_feature_frame` 改为：

```python
def _compute_feature_frame(self, df, code):
    spec = self.spec
    for group in spec.feature_groups:
        df = _FEATURE_COMPUTORS[group](df, ...)
    return df[spec.columns]
```

`FeatureSpec` 新增 `feature_groups: List[str]` 字段，声明该版本需要哪些计算组。

#### 4c. 按标签族配置 Feature Spec

允许不同标签族使用不同的 spec 版本：

```python
LABELER_SPEC_MAP = {
    "swing": "v011",
    "reversal_rebound": "v011",
    "overnight": "v008",
}
```

训练和推理时根据标签族选择对应 spec。

**验收条件：**

- [ ] `get_feature_spec()` 不含 if/elif
- [ ] 新增 feature group = 1 个函数 + 注册，不改动 builder.py
- [ ] 不同标签族可配置不同 spec 版本
- [ ] 现有训练/推理链路无回归

**涉及文件：**

| 文件 | 操作 |
|---|---|
| `python/trading_trainer/features/specs.py` | 重构 |
| `python/trading_trainer/features/builder.py` | 重构 |
| `python/trading_trainer/features/__init__.py` | 修改 |

---

### Phase 5：TS 侧死代码清理（已完成 ✅）

**目标：** 移除推理链路统一后遗留的 TS 侧独立实现，消除未来误用风险。

**清理清单：**

| 文件 | 清理内容 |
|---|---|
| `src/main/ipc/modelFeatureCalculator.ts` | 删除 `buildLatestFeatureValues` 函数及其专属数学工具函数（Phase 5）+ 11 个无外部消费者导出（Phase 6） |
| `src/main/ipc/modelSignalInferenceService.ts` | 删除 `predictTree` 和 `predictLightGBM` 函数 |

**验收结果：**

- [x] `buildLatestFeatureValues` 不存在于任何 TS 文件中
- [x] `predictTree` / `predictLightGBM` 不存在于任何 TS 文件中
- [x] `KlineFeatureRow`, `mean`, `std`, `quantile`, `windowSlice`, `pctChange`, `rollingMean`, `rollingStd`, `calcRsi14`, `calcAtr14`, `corrWindow` 不存在于任何 TS 文件中
- [x] `npx tsc -b --noEmit` 无新增错误

**涉及文件：**

| 文件 | 操作 |
|---|---|
| `src/main/ipc/modelFeatureCalculator.ts` | 精简 |
| `src/main/ipc/modelSignalInferenceService.ts` | 精简 |
| `src/main/ipc/model.ts` | 修改 import |

---

### Phase 6：Dataset Builder 增强（已完成 ✅）

**目标：** 数据集冻结时保存完整的 label policy 快照，支持实验复现和溯源。

**实际改动：**

| 文件 | 改动 |
|---|---|
| `src/main/db.ts` | Migration v7：`dataset_versions` 新增 `label_policy_json TEXT`，`dataset_items` 新增 `sample_role TEXT NOT NULL DEFAULT 'candidate_buy'` |
| `src/main/ipc/model.ts` | `freezeDataset` 增强：收集 dataset_items 关联的 strategy/factor/label/period 分布统计，写入 `label_policy_json` 快照 |
| `python/trading_trainer/models/walk_forward.py` | 训练 if/elif 替换为 `trainer_cls.fit_window()` 统一调用 |
| `python/trading_trainer/models/trainer.py` | 新增 `BaselineModelTrainer.fit_window()` 静态方法 |
| `python/trading_trainer/models/lightgbm_trainer.py` | 新增 `LightGBMTrainer.fit_window()` 静态方法 |
| `python/trading_trainer/models/catboost_trainer.py` | 新增 `CatBoostTrainer.fit_window()` 静态方法 |
| `src/main/ipc/modelFeatureCalculator.ts` | 清理 11 个无外部消费者的死代码导出 |

**验收结果：**

- [x] 冻结数据集时 label_policy_json 完整写入
- [x] `sample_role` 列存在且非空
- [x] 可查询某数据集的 label policy 并验证与训练时一致
- [x] walk_forward.py 无 if/elif 训练分支
- [x] modelFeatureCalculator.ts 无死代码导出

**涉及文件：**

| 文件 | 操作 |
|---|---|
| `src/main/db.ts` | 新增 migration v7 |
| `src/main/ipc/model.ts` | 修改冻结逻辑 |
| `python/trading_trainer/models/walk_forward.py` | 重构训练逻辑 |
| `python/trading_trainer/models/trainer.py` | 新增 fit_window |
| `python/trading_trainer/models/lightgbm_trainer.py` | 新增 fit_window |
| `python/trading_trainer/models/catboost_trainer.py` | 新增 fit_window |
| `src/main/ipc/modelFeatureCalculator.ts` | 清理死代码 |

---

### Phase 7：新标签策略实现

**目标：** 基于 Phase 2-4 的 Registry 基础，快速实现 2 个高价值新标签策略。

**优先级排序：**

#### 7a. `classic_signal_meta_label_v1`（P1）

- **定位：** 验证模型是否能在经典规则候选中筛选出真正值得做的信号
- **候选来源：** MA/MACD/BOLL/Breakout（已有 `classic_signals.py`）
- **真值验收：** Triple Barrier
- **价值：** 最适合验证"规则 + 模型"范式的有效性

实现步骤：
1. 新建 `python/trading_trainer/labeling/classic_meta_labeler.py`
2. 加 `@register_labeler("classic_meta")`
3. 复用 `classic_signals.py` 生成候选
4. 复用 `reversal_rebound_labeler.py` 的 Triple Barrier 评估
5. 前端自动出现新选项（Phase 3 完成后）

#### 7b. `cross_sectional_rank_top_v1`（P1）

- **定位：** 高覆盖训练底座，适合排序模型
- **候选来源：** 全市场每日所有股票
- **真值验收：** 未来 N 日收益横截面排名 Top 10%-20%
- **价值：** 提供大量训练样本，减少过拟合风险

实现步骤：
1. 新建 `python/trading_trainer/labeling/cross_sectional_labeler.py`
2. 加 `@register_labeler("cross_sectional_rank")`
3. 需要全市场日收益数据（已有 `stock_filter.py` + 截面排名逻辑）

**验收条件：**

- [ ] 两个新标签器可通过 CLI 独立运行
- [ ] 产出标签可写入 `signal_candidates` 并在审核台查看
- [ ] 前端可选择新标签器并触发生成

**涉及文件：**

| 文件 | 操作 |
|---|---|
| `python/trading_trainer/labeling/classic_meta_labeler.py` | 新建 |
| `python/trading_trainer/labeling/cross_sectional_labeler.py` | 新建 |

---

### Phase 8：Pipeline 集成与组合

**目标：** 多标签策略独立训练后，通过 ensemble/gating 合并信号，用 walk-forward 验证稳定性。

**改造步骤：**

#### 8a. 多模型 Gating

为每个标签策略训练独立模型后，构建 gating 网络：

1. 输入：多个模型的 score
2. 输出：最终信号 + 置信度
3. 训练：在验证集上学习权重

#### 8b. Walk-Forward 多策略支持

当前 `walk_forward.py` 只支持单一模型。扩展为：

1. 每个窗口独立训练多个标签策略的模型
2. 每个窗口用 gating 合并信号
3. 输出各策略和组合策略的 walk-forward 稳定性报告

#### 8c. 策略 Benchmark 自动化

为每个标签策略自动生成 benchmark 报告：

1. 纯规则 benchmark（不含模型）
2. 模型筛选后 benchmark
3. 差值 = 模型增量价值

**验收条件：**

- [ ] 支持 2+ 标签策略的独立训练和联合推理
- [ ] Walk-forward 报告包含各策略独立和组合表现
- [ ] 策略对比面板可展示模型 vs 纯规则增量

---

## 3. Phase 依赖关系

```text
Phase 1 ✅ (已完成)
  ├── Phase 2 ✅: Labeler Registry (Python)
  │     ├── Phase 3 ✅: Labeler 前端泛化
  │     └── Phase 7 ✅: 新标签策略实现
  ├── Phase 4 ✅: Feature Spec Registry
  │     └── Phase 6 ✅: Dataset Builder 增强
  └── Phase 5 ✅: TS 死代码清理
        └── Phase 8: Pipeline 集成 (依赖 2,3,4,7)
```

**推荐执行顺序：**

1. **Phase 5**（TS 死代码清理）— 独立性强，1-2 小时完成，消除技术债
2. **Phase 2**（Labeler Registry）— 后续所有标签工作的基础
3. **Phase 3**（Labeler 前端泛化）— 依赖 Phase 2
4. **Phase 4**（Feature Spec Registry）— 可与 Phase 3 并行
5. **Phase 6**（Dataset Builder 增强）— 依赖 Phase 4
6. **Phase 7a**（classic_signal_meta_label）— 依赖 Phase 2，建议优先
7. **Phase 7b**（cross_sectional_rank）— 依赖 Phase 2
8. **Phase 8**（Pipeline 集成）— 依赖所有前置 Phase

---

## 4. 各 Phase 对 Pipeline 支持度的提升预估

| 环节 | 当前 | Phase 2-3 后 | Phase 4-6 后 | Phase 7-8 后 |
|---|---:|---:|---:|---:|
| 多候选策略并存 | 70% | 90% | 90% | 95% |
| 未来路径验收 | 65% | 70% | 80% | 90% |
| 数据集版本化 | 80% | 80% | 95% | 95% |
| 特征构建 | 65% | 65% | 90% | 90% |
| 模型训练 | 90% | 90% | 90% | 95% |
| 策略 benchmark | 60% | 60% | 70% | 90% |
| 任意节点替换 | 45% | 70% | 80% | 90% |

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| Labeler 重构可能破坏现有打标结果 | 中 | 保留旧 CLI 入口作为 fallback，新入口并行运行验证一致性 |
| 前端泛化后 UI 复杂度增加 | 低 | 动态表单组件化，每个标签器只描述差异部分 |
| Feature Spec 拆分后 builder.py 回归 | 中 | 拆分前后用同一数据集对比特征值一致性 |
| Phase 3 兼容旧 IPC 通道增加维护成本 | 低 | 设定 deprecated 版本周期（1 个版本后移除） |
| 多策略 ensemble 过拟合 | 高 | Walk-forward 严格验证，不做 in-sample ensemble |

---

## 6. 与现有文档的关系

| 文档 | 关系 |
|---|---|
| `ROADMAP.md` | 本文档是 ROADMAP M5 后续方向的细化执行计划 |
| `ARCHITECTURE.md` | 本文档完成后需更新架构文档的"已解决技术债"和"当前主要技术债"章节 |
| `LABELING_STRATEGY_PIPELINE_ASSESSMENT.md` | 本文档的 Phase 2-3 是该评估文档 P0 建议的具体实施计划 |
| `project_rules.md` | Phase 2-4 完成后需更新规则文档，新增 Labeler Registry 和 Feature Spec Registry 规则 |
