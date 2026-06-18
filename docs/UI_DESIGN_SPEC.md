# 盲训 App UI 设计稿 — 去除 AI 味儿

> 基于 [Guidelines for AI](https://guidelines.sh/)、[7个技巧去除AI味儿](https://juejin.cn/post/7600967006892490761)、[Style Guide Method](https://www.developersdigest.tech/blog/create-beautiful-ui-claude-code) 联网调研，针对金融桌面工具定制。

---

## 一、设计理念

**定位**：专业 A 股盘感训练工具，不是 SaaS Landing Page。

**关键词**：Dense（信息密集）、Clinical（精确冷静）、Functional（功能至上）

**参考气质**：富途牛牛 / 同花顺 PC 客户端 / TradingView Desktop —— 不是 Stripe / Linear / Vercel。

---

## 二、CSS 变量设计系统

### 2.1 配色（去纯化、降饱和）

| 变量 | 当前值 | 新值 | 说明 |
|---|---|---|---|
| `--bg-page` | `#f4f7fb` | `#f0f1f3` | 页面底色，偏中性灰，去掉蓝调 |
| `--bg-card` | `#ffffff` | `#fdfdfd` | 卡片背景，非纯白 |
| `--bg-card-hover` | — | `#f8f9fa` | 卡片 hover |
| `--bg-input` | `#ffffff` | `#ffffff` | 输入框保持纯白（可读性） |
| `--text-primary` | `#142033` | `#1a1d23` | 主文字，非纯黑 |
| `--text-secondary` | `#5a6c82` | `#6b7280` | 次文字，降蓝调改中性灰 |
| `--text-tertiary` | — | `#9ca3af` | 三级文字（占位、提示） |
| `--border` | `#e0e0e0` | `#e5e7eb` | 边框统一 |
| `--border-light` | — | `#f0f1f3` | 浅边框（分割线） |
| `--color-up` | `#e74c3c` | `#dc2626` | A 股涨色（降一档饱和度） |
| `--color-down` | `#27ae60` | `#16a34a` | A 股跌色 |
| `--color-brand` | `#0e7d63` | `#0f766e` | 品牌色（teal，降饱和） |
| `--color-brand-bg` | — | `#f0fdfa` | 品牌色浅底 |
| `--color-warning` | — | `#d97706` | 警告色 |
| `--color-warning-bg` | — | `#fffbeb` | 警告浅底 |

> 涨跌色统一为 A 股惯例（涨红跌绿）。K 线蜡烛色、买卖标记、REGIME 趋势色、训练趋势图散点均对齐 `--color-up`/`--color-down`。完整口径见 [trading-accounting-spec.md §5](./trading-accounting-spec.md)。

### 2.2 圆角（收紧）

| 元素 | 当前 | 新值 | 原则 |
|---|---|---|---|
| 卡片 | `8px / 10px` | `6px` | 统一，专业工具不夸张 |
| 按钮 | `6px` | `5px` | 微圆角 |
| 输入框 | `6px` | `5px` | 与按钮一致 |
| 标签/badge | `6px` | `4px` | 信息元素更紧凑 |
| 模态框 | `14px / 18px` | `10px` | 模态可以稍大但不夸张 |
| 空状态卡片 | `18px` | `10px` | 去掉"AI 大圆角"感 |

### 2.3 阴影（从"喊"到"低语"）

| 层级 | 当前 | 新值 | 用途 |
|---|---|---|---|
| 卡片默认 | `0 2px 8px rgba(0,0,0,0.08)` | **无阴影，用边框** | 日常卡片 |
| 卡片 hover | `0 4px 12px rgba()` | `0 1px 3px rgba(0,0,0,0.06)` | 微弱提升 |
| 模态/弹窗 | `0 8px 30px rgba()` | `0 4px 12px rgba(0,0,0,0.08)` | 弹层 |
| 按钮焦点 | `0 0 0 2px rgba(52,152,219,0.15)` | `0 0 0 2px rgba(15,118,110,0.15)` | 焦点环，用品牌色 |

### 2.4 间距（信息密集化）

| 元素 | 当前 | 新值 | 原则 |
|---|---|---|---|
| 卡片内 padding | `20px` | `14px 16px` | 金融工具需要密度 |
| 区块间距 gap | `12px` | `10px` | 稍微紧凑 |
| 统计卡 padding | `16px 20px` | `12px 14px` | 紧凑 |
| 按钮内 padding | `0.5rem 0.85rem` | `6px 12px` | 精确控制 |
| 页面外 padding | `2rem` | `20px` | 统一 px 单位 |

### 2.5 字体（数字等宽）

| 用途 | 当前 | 新值 | 说明 |
|---|---|---|---|
| 正文字体 | Noto Sans SC | 不变 | 中文正文 |
| 数字/代码 | `tabular-nums` | `font-family: var(--font-mono); tabular-nums` | 金额、百分比、价格 |
| 字号基准 | `rem` 混用 | 统一 `px` | 桌面端不需要 rem 响应式 |

---

## 三、各页面改造清单

### 3.1 训练总览（TrainingOverview）

| 改造项 | 具体操作 |
|---|---|
| 空状态卡片 | 去掉 `border-radius: 18px`、`background: linear-gradient(...)`、`padding: 3rem` → 改为 `border-radius: 10px`、纯色背景、`padding: 32px` |
| 账户卡片 | 去掉 `background: linear-gradient(160deg, #163246, #1e4958)` 深蓝渐变 → 改为 `background: #1a1d23` 纯深色 |
| 账户卡片阴影 | 去掉 `box-shadow: 0 6px 20px rgba(22,50,70,0.15)` → 改为无边框无阴影（深色卡片自带对比） |
| 统计卡片 | 去掉 `box-shadow` → 改为 `border: 1px solid var(--border)` |
| 数字显示 | 所有金额、百分比加 `font-family: var(--font-mono)` |
| 数据提示框 | 去掉 `linear-gradient(135deg, #fff8e1, #fff3cd)` → 改为 `background: var(--color-warning-bg)` |

### 3.2 盲训工作台（BlindTrainingWorkbench）

| 改造项 | 具体操作 |
|---|---|
| Session 头部 | 去掉 `border-radius: 10px` → `6px` |
| K 线区容器 | 保持，K 线本身不需要改造 |
| 操作按钮 | `border-radius: 6px` → `5px`，减小 padding |
| 按钮颜色 | 买入红 `#e74c3c` → `#dc2626`，卖出绿 `#27ae60` → `#16a34a` |
| 设置面板 | 去掉 `background: #f7f9fb`（蓝调）→ 改为 `#f8f9fa`（中性灰） |
| kbd 快捷键 | `border-radius: 4px` 保持 ✓ |
| 信息标签 | `border-radius: 6px` → `4px` |
| 结果摘要 | 去掉 `border-radius: 20px`（过大圆角）→ `10px` |

### 3.3 存档管理（ProfileManager）

| 改造项 | 具体操作 |
|---|---|
| 弹窗圆角 | `border-radius: 14px` → `10px` |
| 深色背景 | 保持深色（`#1a1d23`），但去掉渐变 |
| 统计数字 | 加等宽字体 |
| 日历格子 | 保持 `border-radius: 3px` ✓ |

### 3.4 全局（index.css）

| 改造项 | 具体操作 |
|---|---|
| 背景 | `#f4f7fb` → `#f0f1f3` |
| 文字色 | `#142033` → `#1a1d23` |
| 新增 CSS 变量 | 将上述 `--bg-*`、`--text-*`、`--border-*`、`--color-*` 全部定义在 `:root` |

---

## 四、实施顺序

```
Phase 1: 全局 CSS 变量（index.css）→ 影响所有页面
Phase 2: 训练总览（TrainingOverview.css）→ 首屏体验
Phase 3: 盲训工作台（BlindTrainingWorkbench.css）→ 核心功能
Phase 4: 存档管理（ProfileManager 相关 CSS）→ 补充
```

每个 Phase 独立提交，可随时回退。

---

## 五、不做什么（Anti-list）

- ❌ 不引入动画库（Framer Motion 等），桌面工具用 CSS transition 足够
- ❌ 不做毛玻璃效果（glassmorphism），金融工具需要清晰
- ❌ 不引入彩色渐变背景
- ❌ 不用 emoji（已在 P0 清除）
- ❌ 不做大幅 hover 缩放动画（`scale(1.05)` 是 AI 味儿典型）
- ❌ 不用 Tailwind（已有自己的 CSS 系统）
- ❌ 不做 dark mode 切换（金融工具默认浅色，深色仅用于账户卡片）

---

## 六、预期效果

改造后，App 视觉从"通用 SaaS Landing"变为"专业交易终端"：
- 配色更冷静（中性灰为主，红绿仅用于涨跌）
- 布局更紧凑（信息密度提升 ~20%）
- 数字更专业（等宽字体对齐）
- 阴影更克制（几乎无感）
- 圆角更统一（不再混合 8/10/14/18/20px）
