# 账号数据后端与上线顺序

当前分支已实现共享账号状态、按 UID 隔离的 IndexedDB 缓存、增量同步与冲突选择、v3 全量备份和 v2 导入确认、头像编辑及导航菜单。数据只保留原始记录，统计、热力图和复习预测继续派生计算。

2026-10-27 已对生产项目 `eteemgopnhkxkgdezpsh` 应用扩展迁移和私有头像策略，结构检查通过；真实 REST GET 已从 `PGRST205` 恢复为 200，未提供用户身份的账号 RPC 返回 401。针对用户当前已有 Google 身份执行四个接口的真实数据库读写并全部回滚，前后行摘要一致；随后用户确认生产浏览器修改昵称、保存及刷新保持成功。

管理令牌按用户授权仅在执行进程内临时使用，没有写入源码、日志或持久环境变量。迁移并非只能通过管理 API 执行，也可走获准的 PostgreSQL 连接；当前云环境没有该 TCP 通道，因此本次使用 Management API。

发布顺序仍为：**数据库与 Storage 权限 → 当前真实账号读写 → 前端测试、构建及发布**。后端与真实浏览器门槛现已满足；本文件更新时新前端尚在发布前最终核对中。

## 应用与验证

后续管理操作应通过云环境设置安全配置 `SUPABASE_ACCESS_TOKEN` 并应用。不要提交到仓库、填入 `VITE_*`，或发到聊天。执行器仅接受该管理令牌，不把服务密钥或数据库密码当成替代通道；不打印响应正文或个人数据。

```bash
# 全部都是显式指定项目；check 只检查结构，不修改数据。
npm run backend:account -- check --project-ref=eteemgopnhkxkgdezpsh
npm run test:db

# 应用前检查项目与迁移内容；这是 expand 阶段，保留旧昵称编辑器兼容性。
npm run backend:account -- apply --project-ref=eteemgopnhkxkgdezpsh

# 使用已有 Google 身份执行四个 RPC，真实写入后全部 ROLLBACK。
# 多个 Google 身份时必须追加 --verify-user-id=<当前账号的 UUID>。
npm run backend:account -- verify --project-ref=eteemgopnhkxkgdezpsh
```

需要环境代理/系统 CA 时，在命令前设置 `NODE_USE_ENV_PROXY=1 NODE_USE_SYSTEM_CA=1`。工具不会自动重试可能已经执行的修改。请求中断后先运行 `check` 并核对数据库状态。

也可通过已登录的 Supabase SQL Editor 执行 **`supabase/migrations/20261027000000_account_data.sql` 整份文件**。脚本自带事务并刷新 PostgREST 缓存；兼容资料表缺失、原始昵称表及重复执行。已有结构或数据不兼容时整次回滚，不截断昵称或清空记录。原始 `20261026000000_profiles.sql` 是历史迁移，已存在表时不要再次单独执行它。已有部署未登记迁移历史时，不要直接对生产运行会重放历史脚本的 `supabase db push`。

`verify` 的写入使用真实数据库和 `authenticated` 角色，所有写入回滚，并检查账号行摘要未变；它不创建认证用户，不上传测试头像。它**不等于真实浏览器 OAuth 会话验证**。发布前还需：在生产域名 Google 登录，使用本人会话读取/保存资料，验证 REST 能识别新 RPC 和表，并检查另一账号/匿名访问被拒绝。不要把 service_role 请求当成 RLS 验证。

若持续 `PGRST205`，核对实际生产的 URL/项目、`public.profiles` 存在性、暴露的 `public` schema 和表权限，再执行 `NOTIFY pgrst, 'reload schema'`；不要用前端重试掩盖缺表。

## 数据模型

仍只有一张业务表 `public.profiles`，主键引用 `auth.users.id`。身份和令牌由 Supabase Auth 管理。

| 字段 | 含义 |
| --- | --- |
| `display_name`, `avatar_path` | 站内昵称与私有头像对象路径；NULL 路径使用 Google 头像 |
| `profile_revision`, `updated_at` | 资料版本、资料修改时间 |
| `learning_data` | `{settings, datasets}`，包含全部词库原始学习状态 |
| `data_initialized` | 是否已明确完成首次设备迁移/选择空白开始 |
| `data_revision`, `data_updated_at` | 独立的学习版本、学习修改时间 |

新账号使用 Google `full_name` / `name`，缺省为邮箱前缀，最长 60 字。迁移保留已有昵称。`ensure_my_account` 为后来的登录者建资料，不在 `auth.users` 上增加会阻断 Google 登录的触发器。

`settings` 包含当前 `Settings` 的所有字段，并补充原先单独保存的 `atlasView`（`grid` / `list` / `galaxy`）。每个 `datasets[id]` 为完整 v2 `Progress`：`version, datasetId, cards, bookmarks, days, typing, session, mistakes`。`session` 完整保存 steps/index/graded/pending/newIds/reviewIds/finished；pending 必须已登记当前题评分，完成状态与 index 一致。统计、热力图和预测由原始记录派生，不另外入库。导航开关、弹窗、缓存资源、公共词库素材不属于数据模型。

完整 payload 不超过 30 MiB；枚举、字段白名单、有限数值范围、真实日历日期、词条 ID、成绩与未完成任务结构均在数据库校验。非法数据返回 `PT422`。特殊词条 `constructor`、`prototype` 可正常保存；`__proto__` 等不符合词条 ID 规则的路径被拒绝。

## 四个接口

所有接口是 `SECURITY DEFINER`、固定空 `search_path`，只从 `auth.uid()` 获取身份，不接受用户 ID。函数内部验证身份仍存在。仅 `authenticated` 具有执行权限；内部 `_wa_*` 函数不可由客户端执行。资料表启用 RLS，并增加 restrictive 归属策略，防止已有宽松策略暴露其他账号。

| RPC | 参数 | 结果 |
| --- | --- | --- |
| `ensure_my_account()` | 无 | 本人资料、全部学习数据、初始化标记、两套版本和时间 |
| `save_my_profile(...)` | `p_expected_revision`, `p_display_name`, `p_avatar_path` | 保存后的资料与资料版本 |
| `apply_my_learning_changes(...)` | `p_expected_revision`, `p_changes` | 学习版本与修改时间 |
| `replace_my_learning_data(...)` | `p_expected_revision`, `p_learning_data` | 学习版本与修改时间 |

修改在锁定本人行后比较版本；冲突返回 `PT409`：`profile_revision_conflict` / `data_revision_conflict`。未先读取初始化账号返回 `account_not_initialized`。首次学习迁移必须整份替换，不能隐式增量写入未初始化数据。只有内容变化时递增对应版本；重复提交相同状态不会重复计分。时间均由数据库生成。

增量 `p_changes` 是操作数组，例如：

```json
[
  {"op":"set","path":["datasets","word-atlas-open","days","2026-10-27"],"value":{"n":1,"r":1,"c":1,"t":12}},
  {"op":"set","path":["settings","theme"],"value":"light"}
]
```

允许的路径：

- `settings` 或 `settings/<已知设置>`：仅 set，必须形成完整有效设置。
- `datasets/<id>`：set 完整词库进度或 remove 该词库。
- `datasets/<id>/cards/<word>`、`datasets/<id>/days/<日期>`：set / remove 单条。
- `datasets/<id>/bookmarks|mistakes|typing|session`：set 相应值。

词库不存在时必须先用完整进度创建，不能静默丢弃子路径写入。提交绝对值，不使用计数器加法。一次请求所有操作同成同败。完整替换没有合并：替换整份 `learning_data`，清除未包含的词库，设置初始化标记，**不修改昵称、头像、资料版本或 Google 身份**。

## 头像权限与兼容窗口

专用桶 `word-atlas-avatars` 为私有，5 MiB，上线文件 MIME 只接受 `image/webp`。前端后续需校验原 JPG/PNG/WebP ≤5 MiB，再方形裁切/压缩到最大 512×512 WebP。对象路径为 `<auth.uid()>/<randomUUID>.webp`；数据库只保存路径，不存签名 URL。资料接口会检查路径归属和对象存在性。

Storage CRUD 策略仅允许本人目录；restrictive guard 即便遇到旧宽松策略也拒绝匿名及跨账号访问本桶。其他桶的权限保持原样。后续头像保存顺序：上传新对象 → 资料 CAS 保存 → 更新共享状态 → 清理旧对象；资料保存失败时保留原引用并清理未引用新对象。签名 URL 短期生成，加载失败显示默认头像。

expand 迁移只为当前生产编辑器保留 `id/display_name/updated_at` 的列级 insert/upsert 权限，其写入仍受 RLS 和版本触发器约束；不能直接写学习 JSON、头像或版本。新前端通过 RPC 验证并部署后，再执行 `supabase/rollout/account_data_lockdown.sql` 撤销兼容写入。该文件故意不放进 migrations，避免提前封死旧编辑器。锁定后的 restrictive 标记阻止重复 expand 时重新开放旧写入。

## 已实现的前端接入

以下功能已在当前分支实现，并通过本地测试：

1. 共享账号 store，统一个人中心/头像菜单/学习页面；账号切换使进行中响应失效，IndexedDB 按 UID 隔离，访客原记录保留。
2. 云端已初始化优先读取云端；未初始化询问迁移或空白开始。离线变化先落缓存，合并增量并自动重试；显示同步中/已同步/离线待同步/失败。
3. CAS 冲突暂停上传，展示双方时间与摘要，允许保留云端/本机覆盖/导出本机副本。未知提交结果先重读版本再决定，不能直接把请求标为成功。
4. v3 备份导出所有词库、设置与未完成任务；剔除认证、个人资料和公共素材。v2 单词库兼容转换。先全文件校验，再弹窗列文件/时间/词库/记录数，明确提示未包含词库也会清除。确认后一次 replace RPC，成功后原子替换本机缓存和 UI；已登录需在线，版本变化重新确认。
5. 共用资料编辑器支持昵称、自定义头像/恢复 Google 头像。导航头像菜单固定“个人中心、编辑资料、退出登录”，支持 hover、触摸点击、键盘、外部点击/Escape。
6. 浏览器验证首次迁移、跨设备任务接续不重复计分、离线重试、切换账号、导入取消/v2/全量清除、头像失败回退、菜单及手机/桌面浅深主题。通过后才发布 `word-atlas.vidu8.online`。

旧域名的浏览器本机记录无法由新域名读取，需备份文件迁移。

## 本地验证

```bash
npm run test:db
npm test
npm run test:auth
npm run check:atlas
npm run build
```

`test:db` 使用 PGlite 的真实 PostgreSQL 引擎，构造本地 Auth/Storage 表与角色，不触及生产。覆盖缺表修复、旧表保留、初始化、本人读写、跨账号/匿名隔离、已有宽松策略、独立版本冲突、导入保留资料、全量清除、未完成任务、请求重放、事务回滚、畸形数据、头像路径、重复迁移和兼容窗口锁定。另测管理工具拒绝缺少凭据、显式项目校验、只读检查、脱敏失败和回滚核对。Storage 服务实际上传的端到端检查仍需真实浏览器；本地浏览器已验证原图限制、方形 WebP 编码、上传顺序、保存与恢复。生产真实昵称读写已由用户完成，不能将模拟 Google OAuth 测试表述为自动完成了真实 Google 授权。

## 验证记录与实现位置

- 单元测试覆盖备份校验、增量差异、离线重试、切换账号、并发编辑、导入提交及缓存失败后的恢复。
- 浏览器测试覆盖 Google-only 会话、首次迁移、v2/v3 导入取消/全量替换/冲突重确认、离线导出与重连、双浏览器任务接续不重复计分、账号隔离、头像裁切/压缩/恢复和菜单的触摸/hover/键盘交互。
- 浅色与深色、375px 与 1280px 的资料弹窗经过实际截图和溢出/背景色检查。
- 生产构建、词库检查通过；词库保留 24 个既有内容警告，构建保留既有的大包提示。

主要实现位于 `src/store/model.ts`、`backup.ts`、`changes.ts`、`account-cache.ts`、`sync.ts`，以及 `src/auth/AccountDataProvider.tsx`、`account-api.ts`、`ProfileEditor.tsx`、`BackupControls.tsx`、`AccountMenu.tsx`。账号请求使用创建该请求时的身份 JWT，账号切换使旧响应失效。普通更改先持久到缓存再合并提交。数据库已提交但缓存写入失败时锁定旧视图并提示从云端恢复，不显示导入成功。

Supabase 托管的 `storage.objects` 已启用 RLS，但由平台角色拥有。迁移只核对该开关并创建目录策略，不再尝试 ALTER 托管表的 RLS；本地回归测试覆盖开关未启用时整次迁移回滚。

兼容昵称编辑窗口仍保留。`supabase/rollout/account_data_lockdown.sql` 尚未执行，应在新前端部署及旧客户端过渡后再收紧；当前权限仍由列级授权、本人 RLS 和服务端版本触发器保护。
