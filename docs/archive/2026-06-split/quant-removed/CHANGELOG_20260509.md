# 更新日志 - 2026-05-09

## 一、信号推理修复

### CatBoost 模型信号扫描支持
- **问题**：CatBoost 模型无法用于信号扫描，报错 `artifact_schema_invalid`
- **原因**：TypeScript 信号推理服务只支持 LightGBM 和线性模型，CatBoost 产物没有 `weights` 和 `tree_dump`
- **修复**：CatBoost 模型回退到 Python CLI 批量预测（`runPredictBatchCli`），每批 40 只股票

### 阈值下限保护
- **问题**：模型产物 `threshold=0.15` 导致几乎所有股票被判为买点
- **原因**：CatBoost 训练器阈值优化从 0.1 开始搜索，对宽松打标数据 F1 最优点在 0.15
- **修复**：
  - 训练器：`np.arange(0.1, ...)` → `np.arange(0.5, ...)`（catboost_trainer.py + lightgbm_trainer.py）
  - TS 推理：`Math.max(0.5, rawThreshold)`（modelSignalInferenceService.ts）
  - Python 推理：`max(0.5, threshold)`（predict_live.py）
- **清理**：删除 125 条 `threshold < 0.5` 的错误信号

## 二、数据泄露排查报告

### 排查结论
- **特征工程**：130+ 特征全部向后看，无 `shift(-N)`、`center=True`、`bfill`，仅 swing point 确认延迟 3 bar（低风险）
- **训练/测试集划分**：严格时间序列切分（70/10/20），无随机打乱
- **回测引擎**：对 CatBoost v004 模型，口径与信号推理基本一致
- **高胜率原因**：宽松打标策略 + CatBoost 强拟合 + 训练测试期市场自相关，非数据泄露

### 回测与信号推理口径差异
| 维度 | 回测引擎 | 信号推理(CatBoost CLI) |
|------|---------|---------------------|
| 特征来源 | 预计算 parquet | 实时从 kline 计算 |
| 特征工程 | 完整 spec | 完整 spec（v004一致，v005+缺失横截面） |
| 阈值 | 函数参数 | `max(0.5, artifact.threshold)` |

## 三、推荐复盘页面改进

### 删除股票汇总表
- 移除「股票汇总」表格，保留「模型汇总」

### 技术指标筛选
- MA20 均线向上 / MA5 > MA20 / 收盘价 > MA20（可选，默认不启用）
- 服务端计算，基于信号日 K 线

### 股价和成交额筛选
- 最低价（默认 5 元）/ 最高价（默认 100 元）
- 最低成交额（默认 3000 万）

### 市场板块筛选
- 沪市主板(60x) / 深市主板(000/001) / 创业板(300) / 科创板(688) / 北交所(8x)
- 默认勾选沪深+创业板（科创板和北交所默认不选）

### 置信度阈值筛选
- 最低置信度百分比输入框

### 股票名称列
- SQL JOIN stock_list 获取 stock_name
- 明细表新增「名称」列

### 数据来源筛选
- 新增 `source` 筛选：全部 / 回测验证 / 实时扫描

### UI 简化
- 删除「重新评估」按钮（筛选条件变化时自动触发）
- 扫描信号后台运行提示

## 四、model_recommendations 表（回测结果落库）

### 新增表结构
```sql
model_recommendations (
  id, model_id, model_name, code, stock_name, signal_date, period,
  probability, threshold, signal_type, confidence,
  trade_executed, entry_price, exit_close, exit_high,
  actual_return, best_return, skip_reason,
  source, backtest_id, spec_version, created_at
)
```

### 数据流
- 回测引擎执行后自动落库（source=backtest）
- 信号扫描结果同时写入（source=realtime）
- 推荐复盘页面统一查此表

### 当前数据
- 已导入回测结果 371 条（2026-01~04，阈值 0.5）
- 保守胜率 91.6%，Sharpe 21.95

## 五、CatBoost 可配置正则化参数

### 新增 CLI 参数
- `--max-depth`：树最大深度上限（建议 4~6 防过拟合）
- `--min-l2 / --max-l2`：L2 正则化范围
- `--min-leaf / --max-leaf`：叶节点样本数范围

### 使用示例
```bash
python3 -m trading_trainer.cli model train \
  --engine catboost --dataset <id> --spec v004 \
  --max-depth 5 --min-l2 5.0 --max-l2 100.0 --min-leaf 50
```

## 六、大盘指数数据

### 独立数据库
- 路径：`~/Library/Application Support/stock-trading-simulator/index_data.db`
- 表：`index_daily`（code, trade_date, OHLCV）+ `index_meta`

### 已获取数据
- sh000001 上证指数：1,535 根日 K（2020 至今）
- sz399001 深证成指：1,535 根日 K

### 数据同步脚本
- `scripts/sync_index_daily.py`
- 支持增量同步，6 个主要指数
- 后续可通过 UI 按钮触发

### IPC 接口
- `data:getIndexKline(code, startDate?, endDate?)`
- `data:getIndexMeta()`

## 涉及文件清单

| 文件 | 改动 |
|------|------|
| src/main/db.ts | 新增 model_recommendations 表 |
| src/main/ipc/backtest.ts | 回测结果自动落库 |
| src/main/ipc/data.ts | 指数数据 IPC handler |
| src/main/ipc/modelSignalInferenceService.ts | CatBoost 批量扫描 + 阈值下限 + 推荐落库 |
| src/main/ipc/modelSignalRetrainingIpc.ts | 推荐复盘统一查 model_recommendations |
| src/components/trading/model/RecommendationReviewTab.tsx | 筛选功能 + 来源筛选 + 股票名称 |
| src/preload/index.ts | 新增 IPC 接口 |
| src/types/global.d.ts | 新增类型定义 |
| python/trading_trainer/models/catboost_trainer.py | 可配置正则化参数 |
| python/trading_trainer/cli.py | 正则化 CLI 参数 |
| python/trading_trainer/predict_live.py | 阈值下限保护 |
| scripts/sync_index_daily.py | 指数数据同步脚本（新增） |
