# Google 登录、Supabase 与 Vercel

「我的」只提供 Google OAuth 登录、退出、会话恢复和昵称编辑。邮箱注册、密码登录与密码重置入口已移除；旧的纯邮箱会话会在本机退出。首次 Google 登录由 Supabase 自动建立账号，不需要用户在本站设置密码。访客仍可学习。学习进度保存在本机，尚未实现跨设备同步。

前端限制不等于后台认证方式已关闭：**生产 Supabase 必须启用 Google，并关闭 Email 提供商**，才能在服务端禁止邮箱注册与密码登录。保留全局“允许新用户注册”，否则首次 Google 登录也会被阻止。现有用户无需删除。

## 1. 创建 Google OAuth Web 客户端

在自己的 Google Cloud 项目中打开 [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)，完成应用信息与受众配置，创建类型为 **Web application** 的 OAuth 客户端：

- Authorized JavaScript origins：`https://word-atlas.vidu8.online`
- Authorized redirect URIs：`https://eteemgopnhkxkgdezpsh.supabase.co/auth/v1/callback`
- 登录只使用 `openid email profile` 基本身份范围。

Client ID 是公开标识；Client Secret 只能填入 Supabase 后台 Google 提供商的安全设置，不可放入 `VITE_*`、源码或聊天。Google 应用处于测试模式时，需将登录者加入测试用户；公开使用前按 Google 控制台完成发布。

Google Cloud 的回调是 **Supabase 的 `/auth/v1/callback`**，不是本站 `?auth_callback=1`；两者属于 OAuth 流程的不同阶段。

## 2. 设置 Supabase 登录方式

通过 Vercel 的 `word-atlas-users` 资源使用单点登录进入 Supabase 项目 `eteemgopnhkxkgdezpsh`。

1. Authentication → Sign In / Providers → Google：填入 Google Client ID、Client Secret，启用并保存。
2. 在同一提供商列表中关闭 Email，保存。不配置其他登录提供商。
3. Authentication → URL Configuration：
   - Site URL：`https://word-atlas.vidu8.online`
   - Redirect URLs：加入 `https://word-atlas.vidu8.online/?auth_callback=1`
   - 旧的公开 Vercel 域名会转到新域名，避免 PKCE 登录从一个域名开始、回到另一个域名。
4. 需要本地登录时，加入 `http://localhost:5188/?auth_callback=1`；预览地址逐个添加，避免开放整个公共域名的通配符。

Google 按钮直接发起标准 OAuth 授权，不依赖额外的 `/auth/v1/settings` 检测请求，不会因检测网络失败或浏览器缺少 `AbortSignal.timeout` 而锁死按钮。Supabase 后台仍必须启用 Google；后台启用后无需重新构建前端。

要由自动化修改这些服务端设置，需要可用的 Supabase 管理授权；Vercel 的登录授权和项目 service_role key 不能直接替代 Supabase 管理 API 的凭据。

## 3. 单张资料表

在 Supabase SQL Editor 执行 `supabase/migrations/20261026000000_profiles.sql`，或使用已授权的 Supabase CLI 执行 `supabase db push`。脚本只创建一张业务表 `public.profiles`，引用 `auth.users.id`，启用 RLS，让每个用户只能读取和修改自己的昵称。密码和 OAuth 身份由 Supabase Auth 管理，不存入该表。

## 构建与部署

Vercel 项目是 `wnnw/word-atlas`，已连接 `MugiSuika/word-atlas`。`vercel.json` 使用 Vite、`npm ci`、`npm run build` 和 `dist`。根路径部署不需要 `ATLAS_BASE`。

Vercel Marketplace 已连接 Supabase 免费实例 `word-atlas-users`（新加坡 `sin1`）。构建需要公开的 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`（或旧版 `VITE_SUPABASE_ANON_KEY`）。Vite 也兼容集成注入的公开 `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_*` 配置。

**禁止**将 service_role、`sb_secret_*`、数据库密码、Google Client Secret、管理访问令牌放入浏览器变量或提交仓库。本地 `.env.local` 和 `.vercel` 已忽略。

生产地址：https://word-atlas.vidu8.online

代码分支：`codex/supabase-auth-vercel`。默认分支尚未合并此功能，不应使用旧默认分支覆盖当前生产版本。本项目的 Vercel 团队登录保护已关闭；站点账号认证由 Supabase 承担。

## 验证

```bash
npm test
npm run test:auth
npm run check:atlas
npm run build
```

`test:auth` 使用真实 Chromium 和拦截的 Supabase 响应，验证：仅显示 Google、OAuth PKCE 与回跳、Google 会话恢复、昵称保存、退出保留学习进度、旧邮箱会话退出、提供商检测不可达和浏览器缺少 `AbortSignal.timeout` 时仍能发起授权，以及浅色/深色的手机与桌面布局。不会创建真实邮箱账号，也不替代真实 Google OAuth 检查。默认浏览器为 `/usr/bin/chromium`，可用 `CHROME_PATH` 指定。

真实验证应在 Google/Supabase 配置完成后执行：点击 Google 登录 → Google 授权 → 回到本站「我的」→ 刷新保持会话 → 修改昵称 → 退出。确认 Supabase `/auth/v1/settings` 中 `external.google` 为 true、`external.email` 为 false，并验证不同账号的资料隔离。

## 当前外部配置状态

- 已通过实际链接验证，默认 Site URL 与显式回跳已指向正确生产站点。
- 最新生产变量仍指向 Supabase 项目 `eteemgopnhkxkgdezpsh`。重新请求公开设置得到 Google 未启用、Email 仍启用；Google 授权端点返回 HTTP 400，需要核对该项目的提供商配置是否已保存并生效。
- 新前端已只保留 Google；服务端 Google 登录、关闭 Email 及真实 Google 授权验证仍待完成，不能宣称真实 Google 登录已可用。
- 已通过真实 REST 元数据请求确认 `profiles` 表及 `id`、`display_name`、`updated_at` 字段存在。RLS 已在本地 PostgreSQL 引擎中验证；不同真实账号的权限隔离仍待 Google 登录启用后验证。

Google-only 页面已发布到生产，功能部署 ID：`dpl_4jior2qvjUSQzwPJ9tgUgC11rvtD`，该部署已验证 Vercel 状态 `READY`、旧生产地址 HTTP 200。已核对线上 JavaScript 与本地通过测试的构建完全一致，包含 Google 入口且不含旧的邮箱注册、重置密码按钮文案。24 项单元测试与 8 项模拟认证浏览器测试通过；真实 Google OAuth 仍未配置和验证。

## 当前生产域名

`https://word-atlas.vidu8.online/` 已在 Vercel 项目 `word-atlas` 中绑定并通过域名验证。页面 canonical、Open Graph / Twitter 分享地址和文档使用该域名。`vercel.json` 将旧的两个公开 Vercel 主机重定向到该域名，保留路径与查询参数。Google Cloud 的授权回调仍为 Supabase 的 `/auth/v1/callback`，不随网站域名变更。

当前云任务的 HTTP 代理拒绝新域名，所需精确域名规则已保存到环境配置草稿，须应用后才能从本任务完成新域名 HTTPS 与实际 Google 登录的完整验证。

新域名版本部署 ID：`dpl_3LT9dWEkDvpzLcbC4v16LusTyWr5`，Vercel 返回 `READY`，生产域名为 `word-atlas.vidu8.online`。Vercel DNS 检查为 `configuredBy=CNAME`、`misconfigured=false`。旧公开域名 `word-atlas-gules.vercel.app` 另已设置 Vercel 域名级 308 跳转，实际请求确认路径和查询参数完整保留。

截图确认 Google Cloud Web 客户端已创建，JavaScript 来源和 Supabase 回调 URI 均正确；Supabase Site URL / Redirect URL 也填写正确。但对最新生产变量指向的项目做无缓存请求，仍读到 `external.google=false`、`external.email=true`，实际 Google 授权请求返回 HTTP 400：`Unsupported provider: provider is not enabled`。下一步应检查 Supabase Google 提供商中的 Client ID / Client Secret、启用开关与保存状态，而不是重新创建 Google 客户端或更改这四个正确的 URL。

登录按钮修复已上线：`dpl_7BWQoMgQGCyMPQ5gd3Yi4b8SFMEr`，状态 `READY`，生产地址 `https://word-atlas.vidu8.online`。移除了会因额外检测请求失败而禁用按钮的逻辑，改为直接发起 Google OAuth。新增回归用例覆盖检测接口不可达、浏览器缺少 `AbortSignal.timeout` 的情况；24 项单元测试、7 项浏览器测试、词库校验和构建通过。发布后的真实提供商检查仍为 Google 关闭、Email 开启，实际 Google 授权仍返回 HTTP 400 `Unsupported provider: provider is not enabled`，需完成 Supabase Google 提供商配置。未将按钮修复宣称为真实 Google 登录已验证成功。
