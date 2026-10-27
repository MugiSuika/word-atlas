# 安全与隐私 / Security and privacy

## 数据去哪里

学习进度只保存在当前浏览器的 localStorage，可以在「我的」里导出为 JSON 备份。导入备份时会逐字段校验，畸形数据会被丢弃。可选账号功能仅提供 Google OAuth，由 Google 和 Supabase Auth 处理身份验证，本站不收集或设置密码。认证会话由 SDK 保存在本机并自动刷新。前端移除了邮箱注册、密码登录和密码重置；Supabase 后台也需关闭 Email 提供商，才能禁止这些 API 认证方式。登录不会上传或同步学习进度。用户保存的昵称存于 Supabase `public.profiles` 表，按用户 ID 配置行级安全策略（RLS），只有本人可读写。退出会清除当前浏览器的认证会话，学习备份与本机进度独立保留。

Progress lives in the browser's localStorage and can be exported as JSON. Optional accounts use Google OAuth through Supabase Auth with persisted sessions. The app has no email registration or password login UI; the Supabase Email provider must also be disabled to enforce that restriction on the server. Learning progress is not uploaded or synchronized. Imported backups are validated field by field.

## 凭据 / Credentials

访客学习不需要 API key。账号功能需要公开的 Supabase Project URL 和 publishable / anon key；它们可以公开，不能替换成管理密钥。只有 `scripts/atlas/` 中的内容生成脚本需要调用模型服务，它们从环境变量（`SUB2_BASE_URL`、`SUB2_API_KEY`、`ELEVENLABS_API_KEY`）或仓库外的目录（`ATLAS_SECRETS`）读取凭据，不会写入仓库。

- `VITE_*` 会被打包进浏览器，只能存放公开配置。绝不能放入 Supabase service_role、sb_secret、数据库密码、Vercel token 等私密凭据。部署与认证配置见 [docs/auth-and-vercel.md](docs/auth-and-vercel.md)。
- 公开前运行 `npm run pack:public`，它会按白名单导出并扫描凭据和个人路径。扫描是辅助手段，不能替代人工检查。
- 如果凭据意外泄露，请立刻在服务商处吊销或轮换。

## 报告问题 / Reporting

发现安全问题请通过 GitHub 私密漏洞报告（Security → Report a vulnerability）联系维护者，不要公开贴出细节。
