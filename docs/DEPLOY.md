# PWA 部署指南

## 前置条件

- 已 push mobile 分支到 GitHub（已完成）
- Vercel 账号（免费）
- 一台能跑命令行的机器

## 方式 1：Vercel CLI 一键部署（推荐）

```bash
# 在项目根目录
cd /path/to/blind-trainer-mobile

# 1. 安装 Vercel CLI（首次）
npm i -g vercel

# 2. 登录（会打开浏览器）
vercel login

# 3. 部署到生产
vercel --prod
```

按提示操作（首次会问是否创建 project → 选 yes；git 链接选 yes）。完成后会输出 `https://blind-trainer-xxx.vercel.app`。

## 方式 2：Vercel GitHub 集成（零配置）

1. 登录 https://vercel.com
2. New Project → Import `summercx1988/blind-trainer` 仓库
3. **重要设置**：
   - Framework Preset: **Other**（不是 Vite，因为这是 PWA + sql.js 复杂配置）
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Root Directory: 留空（mobile 分支是项目根）
4. 点 Deploy
5. 部署后：Settings → Git → Production Branch 设为 `mobile`
6. 以后 `git push origin mobile` 自动部署

## 部署后验证清单

### 1. 基础健康

- [ ] 打开部署 URL（Vercel 提供的 https://xxx.vercel.app）
- [ ] DevTools → Network 看到 `manifest.webmanifest` 200 + `Content-Type: application/manifest+json`
- [ ] DevTools → Application → Manifest 显示 3 个 icons（192/512/SVG）+ name="盲训工作台"
- [ ] DevTools → Application → Service Workers 看到 sw.js activated

### 2. PWA 首次加载

- [ ] 浏览器加载主页面后，DevTools → Network → 看到 `builtin-100.sqlite` (17MB) 下载完成
- [ ] IndexedDB 写入：`blind-trainer` 库的 `db-snapshots` 对象存储有 `builtin-db` 和 `blind-db` 两个条目
- [ ] 关闭网络（DevTools → Network → Offline），刷新页面 → 仍能正常打开（service worker 缓存）

### 3. iOS Safari（PWA 完整链路）

1. 手机 Safari 打开部署 URL
2. 分享按钮 → 添加到主屏幕
3. 主屏出现"盲训"图标（紫色"盲"字 on 黑色背景）
4. 点击图标进入，全屏（无地址栏），title "盲训工作台"
5. 验证训练流程：抽签 → K 线（带 MA5/MA10）→ 进度条 → 快捷份额按钮 → 买入/卖出
6. 关闭 WiFi，重新打开 → 仍能训练（service worker + IndexedDB）
7. 横竖屏切换：竖屏固定底部动作栏；横屏右侧 160px 操作面板

### 4. Android Chrome

1. Chrome 打开部署 URL
2. 菜单 → "安装应用" / "添加到主屏幕"
3. 主屏图标 → 启动后全屏
4. 同 iOS 验证：MA 均线、进度条、快捷份额、横滑日志、横竖屏

### 5. 已知风险

| 风险 | 缓解 |
| --- | --- |
| iOS Safari PWA 后台行为不稳定 | 训练工具"打开即用"，不依赖后台同步 |
| 首次加载 17MB 较慢 | builtin-100 是最小精选包（17MB）；未来可拆更小（starter-500 70MB） |
| Vercel 国内访问可能慢 | 备选 Cloudflare Pages 或国内 CDN |
| iOS IndexedDB 配额 | 64GB 设备约 4-6GB；当前 588MB 最大，安全 |
| Vercel 默认 region | 美区（iad1）国内 ping 100-200ms，可改 hkg1 |

## 监控

部署后建议：

- Vercel Dashboard → Project → Analytics 看访问
- DevTools → Application → Storage 监控 IndexedDB 占用
- 用户反馈"训练一局后刷新页面，历史还在"是关键验收点
