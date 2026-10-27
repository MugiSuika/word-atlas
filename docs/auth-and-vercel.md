# Google 登录、Supabase 与 Vercel

「我的」当前提供 Google OAuth 登录、退出、会话恢复和昵称编辑。邮箱注册、密码登录与密码重置入口已移除；旧纯邮箱会话在本机退出。访客仍可学习，当前生产的学习记录仍保存在本机。

用户已确认实际 Google 登录成功。2026-10-27 已应用生产资料表和 Storage 策略迁移，GET 已返回 200，用户确认实际 Google 会话可以修改昵称并在刷新后保留。账号同步、完整备份与头像菜单的实现和发布记录见 [账号数据后端与上线顺序](account-data.md)。不要把之前的登录按钮修复当作资料表或跨设备同步已经完成。

## Google OAuth 配置

Google Cloud [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) 使用 Web application 客户端：

- Authorized JavaScript origins：`https://word-atlas.vidu8.online`
- Authorized redirect URIs：`https://eteemgopnhkxkgdezpsh.supabase.co/auth/v1/callback`
- 仅使用 `openid email profile` 身份范围。

Client ID 是公开标识。Client Secret 只填入 Supabase 后台 Google 提供商的安全设置，不放入 `VITE_*`、源码或聊天。测试模式需添加测试用户；公开使用前按 Google 控制台完成发布。

Google Cloud 的回调是 Supabase 的 `/auth/v1/callback`，本站的 `?auth_callback=1` 是随后一步的应用回跳，两者不同。

## Supabase 配置

项目 `eteemgopnhkxkgdezpsh`，Vercel Marketplace 资源为 `word-atlas-users`（免费实例，新加坡 `sin1`），可通过 Vercel 资源的单点登录进入后台。

1. Authentication → Sign In / Providers → Google：正确填写 Client ID/Secret，启用并保存。
2. 关闭 Email 提供商；不启用其他登录提供商。保留“允许新用户注册”，让首次 Google 登录能创建身份。现有用户无需删除。
3. Authentication → URL Configuration：Site URL 为 `https://word-atlas.vidu8.online`；Redirect URLs 包含 `https://word-atlas.vidu8.online/?auth_callback=1`。
4. 本地登录按需加入 `http://localhost:5188/?auth_callback=1`；预览地址逐个添加，不开放公共域名通配符。

前端 Google 按钮直接发起标准 PKCE OAuth，不依赖 `/auth/v1/settings` 预检，也不因浏览器缺少 `AbortSignal.timeout` 锁死按钮。服务端仍需通过提供商配置限制 Google-only；前端隐藏入口不能代替服务端配置。

新的数据库迁移是 `supabase/migrations/20261027000000_account_data.sql`，包含缺表修复、单张 profiles 业务表扩展、RLS、四个账号 RPC 与私有头像 Storage 权限。不要在已有表时重放旧的 `20261026000000_profiles.sql`。生产管理 API 需要独立 `SUPABASE_ACCESS_TOKEN`，Vercel 登录和 service_role key 均不等于管理授权。

## 构建与部署

Vercel 项目 `wnnw/word-atlas`，仓库 `MugiSuika/word-atlas`，工作分支 `codex/supabase-auth-vercel`。默认分支尚未合并此前账号功能，不应使用旧默认分支覆盖生产版本。

`vercel.json` 使用 Vite、`npm ci`、`npm run build` 与 `dist`；根路径部署无需 `ATLAS_BASE`。浏览器只使用公开 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`（或旧 `VITE_SUPABASE_ANON_KEY`）；Vite 兼容集成注入的公开 `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_*` 配置。service_role、`sb_secret_*`、数据库密码、Google Client Secret 和管理令牌不得进入浏览器变量或提交仓库。`.env.local`、`.vercel` 已忽略。

生产地址 `https://word-atlas.vidu8.online/` 已绑定并由 Vercel 验证，DNS CNAME 检查无误。旧公开 `word-atlas-gules.vercel.app` 的域名级 308 以及仓库的旧主机跳转保留路径与查询参数，避免 PKCE 跨域。旧域名浏览器本机进度只能通过备份迁移。

最近一次应用发布为登录按钮修复，部署 ID `dpl_7BWQoMgQGCyMPQ5gd3Yi4b8SFMEr`、状态 `READY`。账号数据新版的发布记录见账号数据文档；保留此前发布 ID 仅供回溯。当前任务的代理仍可能拒绝自定义域名；环境配置草稿已保存所需精确域名规则，保存草稿不等于运行环境已应用。

## 验证

```bash
npm test
npm run test:auth
npm run test:db
npm run check:atlas
npm run build
```

`test:auth` 使用真实 Chromium 与模拟 Supabase 响应，检查 Google-only 入口、OAuth PKCE 回跳、会话恢复、昵称保存、退出与旧邮箱会话清理、提供商预检不可达和旧浏览器能力回退、浅深主题手机/桌面布局。默认 `/usr/bin/chromium`，支持 `CHROME_PATH`。不创建真实认证用户，不替代生产 OAuth 验证。

`test:db` 在本地 PostgreSQL 引擎中验证迁移、版本冲突、隔离和全量替换；详细边界与发布前的真实账号检查见 [账号数据后端文档](account-data.md)。
