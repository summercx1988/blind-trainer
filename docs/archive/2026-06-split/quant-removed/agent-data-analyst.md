# AI Agent 工作模式调研与落地

> 状态：v0.1
> 范围：项目级 AI 协作规约 + data_analyst 角色 + 行为事件分析工具
> 结论：**AGENTS.md（项目级）+ agents/<role>/AGENT.md（角色级）+ Python 脚本（工具）** 三层组合
> 落地文件：[AGENTS.md](../AGENTS.md) / [agents/data_analyst/AGENT.md](../agents/data_analyst/AGENT.md) / [agents/data_analyst/scripts/](../agents/data_analyst/scripts/)

---

## 0. 用户原话

> "按 AI Agent 的方式开发，开发一些分析损益的数据分析脚本工具，按专业的方式给 agent 配置好 soul.md，或者其他的 prompt，你可以调研一下。"

拆解：

- **范式**：把 AI agent 当作开发协作的一员（不是补全器）
- **工具**：分析损益的数据分析脚本（行为事件 → 决策习惯好差）
- **配置**：agent 的人格 / system prompt 怎么放、放哪

---

## 1. 业界 agent 配置文件对比

| 名称                  | 位置           | 性质                                     | 适用场景                                       |
| --------------------- | -------------- | ---------------------------------------- | ---------------------------------------------- |
| **AGENTS.md**         | 项目根         | 项目级指令（架构 / 规范 / 不做什么）     | 给所有 AI 工具（Claude / Cursor / Aider / Trae） |
| **CLAUDE.md**         | 项目根         | Claude Code 专用上下文                    | 仅 Claude Code                                  |
| **.cursorrules**      | 项目根         | Cursor 专用配置                          | 仅 Cursor                                       |
| **.aider.conf.yml**   | 项目根         | Aider 专用配置                           | 仅 Aider                                         |
| **SOUL.md**           | `~/.config/...` 或项目内 | **跨项目跟随**的 agent 人格/身份/语气/avoid | 想让同一个 agent 跨多个项目保持一致人格        |
| **.github/copilot-instructions.md** | 项目根 | GitHub Copilot 专用                       | 仅 Copilot                                      |
| **AGENT.md（角色级）** | `agents/<role>/AGENT.md` | 单个 agent 角色的人设 + 工具清单 | 多角色项目（按需扩展）                          |
| **SKILL.md**（Anthropic）| `.claude/skills/<name>/SKILL.md` | 能力插件（带 frontmatter） | Claude Skills 生态                              |

### 1.1 取舍

- **项目级**用 **AGENTS.md**（最广，跨工具兼容）
- **角色级**用 `agents/<role>/AGENT.md`（项目自定，不锁死具体工具）
- **跨项目人格**（可选）：`~/.config/ai-agents/SOUL.md`，每个 agent 启动时 import 一次
- **本项目 v0.1 不引入 SOUL.md**（单项目，未到"跨项目跟随人格"需求）

### 1.2 AGENTS.md vs SOUL.md 不是互斥

- AGENTS.md = **项目事实**（"这个项目用什么栈、什么约定、什么不做"）
- SOUL.md = **agent 人格**（"你怎么说话、怎么思考、怎么出错"）

一个项目可以有：

- 0 个 SOUL.md（用工具默认语气）
- 1 个项目根 AGENTS.md（强烈推荐）
- N 个 `agents/<role>/AGENT.md`（按需）

---

## 2. 本项目落地的三层

```
project-root/
├── AGENTS.md                                # ① 项目级
├── agents/
│   └── data_analyst/
│       ├── AGENT.md                         # ② 角色级（= "soul.md" 在本项目的等价物）
│       ├── README.md
│       ├── requirements.txt
│       ├── scripts/
│       │   ├── __init__.py
│       │   └── behavior_summary.py          # ③ 工具脚本
│       └── tests/
│           ├── __init__.py
│           └── test_behavior_summary.py
└── docs/
    └── agent-data-analyst.md                # 调研 + 落地说明（本文件）
```

---

## 3. 各层详细说明

### 3.1 `AGENTS.md`（项目级）

位置：项目根

职责：

- 项目一句话
- 项目结构速查
- 硬性约束（数据库、Python 权威、代码风格、拆分期规则）
- "不做什么"（红线）
- agent 角色注册表
- 工作流建议
- 工具与环境

不负责：

- 不写 agent 的人设语气（角色级管）
- 不写 SQL 模板（工具脚本管）
- 不写每次任务的 prompt（那是 LLM 交互层的事）

### 3.2 `agents/<role>/AGENT.md`（角色级 = "soul.md 的现代版"）

位置：`agents/<role>/AGENT.md`

职责（参考 [agents/data_analyst/AGENT.md](../agents/data_analyst/AGENT.md)）：

- **Identity**：agent 是谁、做什么
- **Style**：语言、格式、引用习惯
- **Defaults**：模糊情况下怎么表现
- **Avoid**：明确不做的事
- **Capabilities**：能调用的工具
- **Inputs / Outputs**：契约
- **Working loop**：推荐工作循环
- **Examples**：典型问答
- **Failure modes**：已知失败模式

这就是"soul"在工具化时代的体现——不是一份空泛的"我是谁"哲学文档，而是一份**给 LLM 用的可执行规约**。

### 3.3 `agents/<role>/scripts/`（工具脚本）

位置：`agents/<role>/scripts/<tool>.py`

职责：

- 实现可重复执行的分析（不靠 LLM 每次重新造 SQL）
- 输出**稳定 JSON schema**（v0.1.0）
- 内置错误码（`DB_NOT_FOUND` / `INPUT_INVALID` / `EMPTY_DATA`）
- 配套 `tests/` 用 pytest

为什么用 Python 而非 TypeScript？

- 项目 `python/` 子工程已经在跑 lightgbm / optuna
- 数据分析场景 Python 标准库 + pandas 足够
- 与 Electron 主进程解耦（agent 是只读分析师，不写库）

---

## 4. soul.md 的兼容性

如果将来用户从"按 AI Agent 方式"演进到"跨项目灵魂 agent"，可以这样组织：

```
~/.config/ai-agents/
├── SOUL.md                # 跨项目人格（语气、风格、默认行为）
└── skills/
    ├── data-analysis/
    │   └── SKILL.md       # "如何做行为数据分析"的能力包
    └── stock-trading/
        └── SKILL.md
```

每个项目的 `AGENTS.md` 顶部加一句：

```markdown
> 跨项目人格：见 `~/.config/ai-agents/SOUL.md`
> 当前 agent 角色：data_analyst（见 [agents/data_analyst/AGENT.md](agents/data_analyst/AGENT.md)）
```

v0.1 不落地此层（用户未要求跨项目）。

---

## 5. 与拆分方案的衔接

| 拆分阶段 | 配套落地                                              |
| -------- | ----------------------------------------------------- |
| P0       | 写本文 + AGENTS.md + agents/data_analyst/ 骨架 + 调研 |
| P1       | 路径参数化前置（让 behavior_summary.py 能跑隔离库）   |
| P2       | init monorepo；agents/ 进 monorepo 的 `tools/agents/` |
| P3       | 抽 menu-bar；agents 不动                              |
| P4       | quant-desktop 改只读；data_analyst 仍读盲库           |
| **P5**   | 引入 `behavior_event` 表 + `behavior:track` IPC + 跑 `behavior_summary.py` 验证数据 |
| P6       | blind-desktop 独立；data_analyst 仍能用                |
| P7       | blind-web；data_analyst 路径不变（读盲库）             |

---

## 6. 工具脚本契约

### 6.1 第一个工具：`behavior_summary.py`

输入：

- `--db <path>` 或 `BLIND_DB_PATH` 环境变量（必填）
- `--output <path>` 或 `-`（stdout；默认 stdout）

输出（JSON schema `0.1.0`）：

```json
{
  "schema_version": "0.1.0",
  "generated_at": "2026-06-02T...",
  "db_path": "/path/to/blind-training.db",
  "summary": { "training_sessions": 0, "trade_actions": 0, "behavior_events": 0, "session_reviews": 0 },
  "sections": [
    { "name": "hesitation", "sql_ref": "docs/behavior-event-design.md §5.1", "rows": [], "truncated": false, "total_rows": 0 }
  ],
  "warnings": []
}
```

错误（exit code `1`）：

```json
{ "error": "DB_NOT_FOUND", "message": "Blind DB not found: ..." }
{ "error": "INPUT_INVALID", "message": "behavior_event table missing; ..." }
```

测试：5 个 pytest 用例（已通过）

- DB 不存在
- DB 无 `behavior_event` 表
- 空库返回有效 report + warnings
- 含数据返回 3 个 sections + hesitation 数学校验
- `--db` 缺失

### 6.2 后续 v0.2+ 工具

| 脚本                       | 职责                                              |
| -------------------------- | ------------------------------------------------- |
| `session_compare.py`       | 两个 session 横向对比                            |
| `profile_aggregate.py`     | 跨 profile 聚合                                  |
| `decision_quality.py`      | 决策质量评分（误判高发 / 复盘-实际对比）          |
| `export_csv.py`            | 导出供 LLM 二次分析                              |
| `train_efficiency.py`      | 训练时长 / 决策数 / 胜率综合效率分                |

---

## 7. 为什么不直接用 .cursorrules

- `.cursorrules` 仅 Cursor 有效
- 用户可能在不同 IDE 切换（Trae / Cursor / VSCode + Copilot）
- AGENTS.md 是社区新事实标准（参考 [agents.md](https://agents.md) 倡议）
- 单文件 + 跨工具 = 更低维护成本

---

## 8. 与 LLM 配合的 pattern

把 `behavior_summary.py` 的输出 + `AGENT.md` 的 Identity 一起喂给 LLM：

```bash
REPORT=$(python -m agents.data_analyst.scripts.behavior_summary --db $DB)
SYSTEM=$(cat agents/data_analyst/AGENT.md)
USER="我最近的盲训习惯如何？"

<your-llm-cli> --system "$SYSTEM" --user "$USER" --context "$REPORT"
```

或单 prompt（更轻）：

```text
[ROLE]
$(cat agents/data_analyst/AGENT.md)

[REPORT]
$(python -m agents.data_analyst.scripts.behavior_summary --db $DB)

[QUESTION]
我最近的盲训习惯如何？给出 3 条具体可执行的改进建议。
```

---

## 9. 风险与回退

| 风险                            | 缓解                                                   |
| ------------------------------- | ------------------------------------------------------ |
| agent 配置文件越来越长         | 角色级拆 `AGENT.md`（已做）；工具脚本拆 `scripts/`     |
| LLM 误读 `data_analyst` 改库   | `AGENT.md` 明确 "Avoid" 段 + Python 脚本只读 SQLite    |
| 测试覆盖不足                    | pytest 5 个用例覆盖 4 个错误路径 + 1 个 happy path     |
| monorepo 拆分时 agents/ 位置    | 计划迁到 `tools/agents/data_analyst/`（P2 阶段）        |

---

## 10. 相关链接

- 项目级规约：[AGENTS.md](../AGENTS.md)
- data_analyst 角色：[agents/data_analyst/AGENT.md](../agents/data_analyst/AGENT.md)
- 行为事件表设计：[docs/behavior-event-design.md](behavior-event-design.md)
- 数据底座契约：[docs/data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md)
- 拆分总览：[docs/monorepo-init.md](monorepo-init.md)
- 安全网脚本：[scripts/safe-refactor.sh](../scripts/safe-refactor.sh)
