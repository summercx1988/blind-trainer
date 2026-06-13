# Trading Trainer Docs

本目录仅保留当前生效文档。

## 当前代码对应的前台模块

1. `训练总览`
2. `盲训工作台`
3. `训练复盘`
4. `模型训练`
5. `模型部署`
6. `数据管理`
7. `Alpha 研究`

## 当前有效文档

1. `BRD.md`
   业务目标、双子系统边界、核心 KPI。
2. `PRD.md`
   主 PRD 总览索引。
3. `ARCHITECTURE.md`
   当前代码对应的系统架构真相文档，说明分层、模块边界、关键数据流和维护约定。
4. `ALPHA_RESEARCH_PLATFORM_ARCHITECTURE.md`
   Alpha 研究平台架构设计，说明因子研究、策略验证、生产运营三引擎。
5. `PRD-blind-training.md`
   盲训子系统执行版 PRD。
6. `PRD-model-training.md`
   模型训练子系统执行版 PRD。
7. `CORE_TECH_SOLUTION.md`
   并行架构、当前代码结构与技术债清单。
8. `ROADMAP.md`
   按周执行路线图与每周验收清单。
9. `[已完成]ML_MODEL_TRAINING.md`
   模型、标签、特征、回测口径和实验记录的技术主文档。
10. `MODEL_TRAIN_PREDICT_USER_MANUAL.md`
   模型训练与预测的用户手册（操作流程、页面说明、验收标准、常见问题）。
11. `[已归档]QUANT_OPTIMIZATION_RUNBOOK.md`
   当下量化优化执行手册（数据质量 gate、walk-forward 稳定性、版本对比）。
12. `WF_EXPERIMENT_LOG_TEMPLATE.md`
   walk-forward 实验记录模板（统一记录口径和对比结论）。
13. `GREEDY_UPTREND_LABEL_AND_BENCHMARK_PLAN.md`
   上涨趋势波段标签与经典策略 benchmark 的分工方案。
14. `REVERSAL_REBOUND_LABELING_TECH_SPEC.md`
   大级别反转 / 反弹买点标签算法设计、系统影响和开发风险。
15. `LABELING_STRATEGY_PIPELINE_ASSESSMENT.md`
   标签策略扩展与 pipeline 模块化评估，维护高胜率 / 高覆盖打标方法清单和待办。
16. `[已废弃]FEATURE_EXPLORATION_FACTOR_MINING_TECH_SPEC.md`
   已废弃的特征探索 / 因子挖掘孪生研究页面方案。
17. `archive/2026-04-26/MULTI_SESSION_SYNC_BUG.md`
   盲训多会话资金同步问题的现象、根因、修复和验证记录。
18. `archive/2026-04-26/TRAINING_OVERVIEW_PNL_CALENDAR_FIX.md`
   训练总览收益口径（资金曲线）统一 + 训练日历可读性修复记录。

## 使用顺序建议

1. 先读 `BRD.md` 对齐业务边界。
2. 再读 `ARCHITECTURE.md` 理解当前系统分层和代码边界。
3. 若要看 Alpha/研究平台演进计划，再读 `ALPHA_RESEARCH_PLATFORM_ARCHITECTURE.md`。
4. 然后读 `PRD.md` 进入产品范围。
5. 研发按 `PRD-blind-training.md` 和 `PRD-model-training.md` 分线执行。
6. 技术实现与历史背景补充参考 `CORE_TECH_SOLUTION.md`。
7. 模型训练、回测收益和标签口径问题优先查 `[已完成]ML_MODEL_TRAINING.md`。
8. 产品/运营按页面执行流程时，优先查 `MODEL_TRAIN_PREDICT_USER_MANUAL.md`。
9. 迭代排期和验收以 `ROADMAP.md` 为准，但需以当前代码实况为最终依据。
10. 当天执行实验时，可参考 `[已归档]QUANT_OPTIMIZATION_RUNBOOK.md` 并填写 `WF_EXPERIMENT_LOG_TEMPLATE.md`。
11. 开发上涨趋势波段标签时，读 `GREEDY_UPTREND_LABEL_AND_BENCHMARK_PLAN.md`。
12. 开发大级别反转 / 反弹标签时，读 `REVERSAL_REBOUND_LABELING_TECH_SPEC.md`。
13. 设计新打标策略或改造 pipeline 模块化时，读 `LABELING_STRATEGY_PIPELINE_ASSESSMENT.md`。

## 历史文档归档

旧版文档、阶段性方案和旧 specs 已归档到：

1. `docs/archive/2026-04-05/`
   早期架构稿、历史 specs。
2. `docs/archive/2026-04-23/`
   已完成或已被主文档吸收的阶段性方案：
   `DATA_LAYER_UNIFICATION.md`、`UX_IMPROVEMENT_PLAN.md`、`LABEL_INSPECTION_PLAN.md`
3. `docs/archive/2026-04-26/`
   盲训与训练总览相关问题修复记录：
   `MULTI_SESSION_SYNC_BUG.md`、`TRAINING_OVERVIEW_PNL_CALENDAR_FIX.md`
