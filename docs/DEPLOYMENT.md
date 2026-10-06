# 发布映界 AURA TV

此项目发布为静态 PWA 和 Windows 启动 ZIP，不是原生 EXE。发布记录以实际 GitHub Actions 和 Release 结果为准；不能把推送代码视为部署成功。

## 自动流程

`.github/workflows/publish.yml` 使用固定提交版本的 GitHub 官方 Actions：

1. 安装锁定依赖，执行单元测试及 Chrome/FFmpeg 浏览器测试。流水线使用 Ubuntu 24.04 预装的 Google Chrome，并先验证 H.264/AAC 支持，避免开源 Chromium 构建缺少编解码器。
2. 构建根路径应用，验证 PWA、图标、离线壳、许可证和作用域，生成 Windows 启动包及 SHA-256。
3. 用 `APP_BASE_PATH=/<仓库名>/` 构建 GitHub Pages，再执行生产验证。
4. `main` 分支通过构建后部署 Pages；`v*` 标签通过构建后创建带 ZIP 附件的 GitHub 预览版 Release。

两个发布动作均在验证成功后执行。Release 使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需把个人令牌放进源码。

## Pages 首次设置

在仓库 Settings → Pages → Build and deployment 中选择 **GitHub Actions**。官方 `configure-pages` 动作不能仅靠默认 `GITHUB_TOKEN` 为仓库首次开启 Pages；仓库管理员或具备对应权限的管理 API 需要完成此设置。

设置完成后，可以在 Actions 中重跑 main 分支的 `Validate and publish AURA TV` 工作流。实际网页地址以部署 job 的 `page_url` 输出为准。

## 本地发布验证

```bash
npm ci
npm test
npm run test:e2e
npm run build
node scripts/verify-pages.mjs
python3 scripts/package-release.py

APP_BASE_PATH=/-/ npm run build
APP_BASE_PATH=/-/ node scripts/verify-pages.mjs
```

再次运行 `npm run build` 可恢复 Windows 本地启动使用的根路径产物。

`scripts/verify-pages.mjs` 为已有 dist 启动临时本地 HTTP 服务并使用 Chromium 验证，结束后关闭所启动服务；它不关闭 TLS 验证，也不假设公网电视可用。

## 仍需区分的限制

- 生产/PWA 检查与公开频道实播是两件事；电视源、CORS、地区与订阅情况参见 SOURCES.md 和 TVBOX.md。
- 云环境对 GitHub API/Pages 域名的访问需要对应网络设置生效。配置草稿保存不等于网络生效或站点发布。
- Windows 下载包需要 Node.js 24；目前尚未在真实 Windows 系统执行启动脚本。
