# Vercel 与 Supabase 用户认证

「我的」提供邮箱注册、登录、退出、密码重置，以及刷新页面后的会话恢复。账号认证使用 Supabase Auth。「我的」可编辑昵称，额外使用一张 `public.profiles` 表。访客可以继续使用词库；学习进度仍保存在本机，**本次没有实现跨设备进度同步**。浏览器不需要 service_role key。

## 通过 Vercel 创建 Supabase 项目

1. 在有权限的 Vercel 账号或团队下创建项目，导入此仓库。框架为 Vite，安装 `npm ci`，构建 `npm run build`，输出 `dist`；根目录的 `vercel.json` 已配置。
2. 从 Vercel Marketplace 安装 Supabase 集成，将新 Supabase 项目连接到这个 Vercel 项目。选择自己的组织、区域和符合预算的套餐；若提供商要求确认计费，在控制台完成该步骤。
3. 在 Supabase 的 Connect / Project Settings → API 中找到 Project URL 和 **publishable key**（或旧版 anon key）。在 Vercel 项目 Environment Variables 中设置：

   ```text
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key>
   ```

   旧项目可使用 `VITE_SUPABASE_ANON_KEY` 替代 publishable key。构建配置也支持集成自动注入的 `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` 及对应的 `NEXT_PUBLIC_` 变量；显式 `VITE_` 配置优先。若集成已注入这些公开值，无需重复填写。**不要**将 `SUPABASE_SERVICE_ROLE_KEY`、`sb_secret_*`、数据库密码或管理令牌映射到 `VITE_*`。这些变量会公开打包到浏览器。
4. 在 Supabase SQL Editor 执行 `supabase/migrations/20261026000000_profiles.sql`（一次），或用已授权的 Supabase CLI 执行 `supabase db push`。脚本创建唯一一张业务表 `profiles`，引用 `auth.users.id`，启用 RLS，用户只能读取、创建和修改自己的昵称。没有公开用户列表，不存储密码；新用户首次保存昵称时创建记录。
5. Supabase Authentication → Providers 启用 Email，保留邮箱验证。生产使用请配置 SMTP；内置邮件服务有收件人限制和发送限额。
6. Authentication → URL Configuration：Site URL 设置为生产 HTTPS 域名；Redirect URLs 加入 `https://<生产域名>/?auth_callback=1`。如果使用 Preview，再逐个加入需要测试的预览域名。PKCE 验证和密码重置邮件应在发起请求的同一个浏览器中打开。
7. 设置变量后重新部署，因为 Vite 在**构建时**读取变量。根路径部署无需 `ATLAS_BASE`。若使用子路径，邮件回调地址也须包含该路径。

未配置公开变量时，网页会说明账号服务暂未开放，学习功能仍可使用；这不代表线上认证已部署成功。

## 本地开发与检查

复制 `.env.example` 到被忽略的 `.env.local`，填入项目公开配置，运行 `npm ci` 和 `npm run dev`。在 Supabase Redirect URLs 中加入 `http://localhost:5188/?auth_callback=1`。Supabase 服务自身仍使用 HTTPS。

```bash
npm test
npm run check:atlas
npm run build
npm run test:auth
```

`test:auth` 启动独立测试端口，在真实 Chromium 中拦截 Supabase 请求验证交互、错误、会话恢复、退出和密码重置。它不向真实项目注册账号，不替代部署后的真实邮件与认证检查。默认 Chromium 路径为 `/usr/bin/chromium`，可通过 `CHROME_PATH` 指定。其他系统先运行 `npx playwright install chromium` 并设置浏览器路径。

## 发布

在 Vercel 登录授权后，可用 `vercel link` 连接项目，设置公开构建变量，再执行 `vercel --prod`。不要把访问令牌写入仓库。项目内 `.vercelignore` 排除了本地环境文件、缓存、开发数据和文档；运行所需的 `public/atlas` 媒体保留。构建输出约 717 MB，实际发布受所选 Vercel 套餐的部署体积和文件数限制；若平台拒绝，需先选择合适套餐或另行规划媒体存储。

上线后使用真实邮箱检查：注册 → 验证邮件 → 登录 → 刷新保持登录 → 退出 → 发送重置邮件 → 保存新密码 → 用新密码登录，并确认旧密码无法登录。验证完成前不能将真实 Supabase 登录或邮件投递标记为通过。再用两个真实账号检查昵称能保存，并直接请求 REST API 确认账号 A 无法读取或修改账号 B 的资料，匿名请求无法读写任何资料。

## 当前部署记录

- Vercel 项目：`wnnw/word-atlas`，已连接 `MugiSuika/word-atlas` GitHub 仓库。
- 生产地址： https://word-atlas-gules.vercel.app
- 部署 ID：`dpl_DauBSxkeaPE96KEM7vRFRLayYErc`，Vercel 返回 `READY`，生产别名已分配。
- Supabase 资源：`word-atlas-users`，免费套餐，`sin1`（新加坡）；项目 ref：`eteemgopnhkxkgdezpsh`。
- Supabase 已通过 Vercel Marketplace 连接，公开的 `VITE_SUPABASE_*` 构建变量已自动注入。管理密钥和数据库凭据仅保留在受忽略的本地配置以及 Vercel 环境设置中。
- 尚未完成：向真实 Supabase 执行 profiles 迁移、配置生产邮件回调，以及线上注册/邮件/资料读写验证。当前云任务的网络策略拒绝新生产域名和 Supabase 域名，所需精确规则已保存到环境配置草稿，尚待应用。不能把 Vercel 的 `READY` 当作这些业务检查已通过。

部署源来自当前工作区，账号功能已提交到 `codex/supabase-auth-vercel` 分支。GitHub 自动部署已经连接，但默认分支尚未包含这些改动；在合并此分支前，请勿从旧分支重新部署覆盖本次生产版本。

本项目的 Vercel 团队登录保护已关闭（`ssoProtection: null`），公开站点使用应用内 Supabase 账号认证。
