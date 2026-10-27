import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const base = "http://127.0.0.1:5190";
const authOrigin = "https://word-atlas-auth-test.supabase.co";
const userId = "11111111-1111-4111-8111-111111111111";
const googleUser = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "learner@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  identities: [],
};
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test-signature`;
const session = (user = googleUser) => ({
  access_token: token,
  refresh_token: "mock-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
});
let server,
  browser,
  serverOutput = "";
before(async () => {
  server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5190",
      "--strictPort",
    ],
    {
      cwd: new URL("..", import.meta.url),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        VITE_SUPABASE_URL: authOrigin,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
        VITE_SUPABASE_ANON_KEY: "",
        ATLAS_BASE: "/",
      },
    },
  );
  server.stdout.on("data", (data) => {
    serverOutput += data;
  });
  server.stderr.on("data", (data) => {
    serverOutput += data;
  });
  const deadline = Date.now() + 30000;
  while (!serverOutput.includes("ready in")) {
    if (server.exitCode !== null || Date.now() > deadline)
      throw new Error(`Auth test server did not start: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    headless: true,
  });
});
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
});

async function fixture(t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: "reduce",
    hasTouch: !!options.touch,
    isMobile: !!options.touch,
  });
  t.after(() => context.close());
  const legacyUser = {
    ...googleUser,
    app_metadata: { provider: "email", providers: ["email"] },
  };
  await context.addInitScript(
    ({ legacy, withoutTimeout, guestDatasets }) => {
      if (withoutTimeout)
        Object.defineProperty(AbortSignal, "timeout", {
          value: undefined,
          configurable: true,
        });
      localStorage.setItem(
        "word-atlas:settings",
        JSON.stringify({
          onboarded: true,
          splash: false,
          ambience: "off",
          sfx: false,
        }),
      );
      for (const [id, p] of Object.entries(guestDatasets ?? {}))
        localStorage.setItem(`word-atlas:v2:${id}`, JSON.stringify(p));
      if (legacy)
        localStorage.setItem(
          "sb-word-atlas-auth-test-auth-token",
          JSON.stringify(legacy),
        );
    },
    {
      legacy: options.legacyEmail ? session(legacyUser) : null,
      withoutTimeout: !!options.withoutTimeout,
      guestDatasets: options.guestDatasets,
    },
  );
  const settings = {
    accent: "uk",
    autoplay: true,
    dailyNew: 10,
    retention: 0.9,
    theme: "dark",
    sfx: false,
    spell: true,
    startLevel: 0,
    onboarded: true,
    dataset: "open",
    ambience: "off",
    ambienceVolume: 0.45,
    splash: false,
    atlasView: "grid",
  };
  let currentUser = googleUser;
  let cloud = options.sharedCloud ?? {
    id: userId,
    display_name: "词光学员",
    avatar_path: null,
    profile_revision: 0,
    updated_at: new Date().toISOString(),
    data_initialized: !options.migration,
    data_revision: 0,
    data_updated_at: new Date().toISOString(),
    learning_data: { settings, datasets: options.datasets ?? {} },
  };
  const requests = [],
    errors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route(`${authOrigin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      data = /application\/json/.test(request.headers()["content-type"] ?? "")
        ? request.postDataJSON()
        : null;
    requests.push({
      path: url.pathname,
      query: url.searchParams,
      method: request.method(),
      data,
      contentType: request.headers()["content-type"],
      bodyBytes: request.postDataBuffer()?.length ?? 0,
    });
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        json: body,
        headers: {
          "x-supabase-api-version": "2024-01-01",
          "access-control-expose-headers": "X-Supabase-Api-Version",
        },
      });
    if (url.pathname === "/auth/v1/settings") return reply({}, 503);
    if (url.pathname === "/auth/v1/authorize")
      return route.fulfill({
        status: 302,
        headers: { location: `${base}/?auth_callback=1&code=mock-google-code` },
      });
    if (url.pathname === "/auth/v1/token") return reply(session());
    if (url.pathname === "/auth/v1/user")
      return reply(options.legacyEmail ? legacyUser : currentUser);
    if (url.pathname === "/auth/v1/logout")
      return route.fulfill({ status: 204 });
    if (url.pathname === "/rest/v1/rpc/ensure_my_account")
      return options.profileError
        ? reply({ code: "PGRST205" }, 404)
        : reply(cloud);
    if (url.pathname === "/rest/v1/rpc/save_my_profile") {
      if (data.p_expected_revision !== cloud.profile_revision)
        return reply({ code: "PT409" }, 409);
      cloud.display_name = data.p_display_name.trim();
      cloud.avatar_path = data.p_avatar_path;
      cloud.profile_revision++;
      return reply({
        id: cloud.id,
        display_name: cloud.display_name,
        avatar_path: cloud.avatar_path,
        profile_revision: cloud.profile_revision,
        updated_at: cloud.updated_at,
      });
    }
    if (url.pathname === "/rest/v1/rpc/replace_my_learning_data") {
      if (options.conflictImport && !cloud.injectedConflict) {
        cloud.injectedConflict = true;
        cloud.data_revision++;
        return reply({ code: "PT409" }, 409);
      }
      if (data.p_expected_revision !== cloud.data_revision)
        return reply({ code: "PT409" }, 409);
      cloud.learning_data = data.p_learning_data;
      cloud.data_revision++;
      cloud.data_initialized = true;
      return reply({
        data_revision: cloud.data_revision,
        data_updated_at: new Date().toISOString(),
      });
    }
    if (url.pathname === "/rest/v1/rpc/apply_my_learning_changes") {
      if (data.p_expected_revision !== cloud.data_revision)
        return reply({ code: "PT409" }, 409);
      for (const op of data.p_changes) {
        let at = cloud.learning_data;
        for (const k of op.path.slice(0, -1)) at = at[k];
        const key = op.path.at(-1);
        if (op.op === "remove") delete at[key];
        else at[key] = op.value;
      }
      cloud.data_revision++;
      return reply({
        data_revision: cloud.data_revision,
        data_updated_at: new Date().toISOString(),
      });
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/"))
      return reply({
        signedURL: "/object/sign/word-atlas-avatars/test.webp?token=mock",
      });
    if (url.pathname.startsWith("/storage/v1/object/"))
      return reply({ Key: "avatar" });
    errors.push(`Unexpected auth request: ${request.method()} ${url.pathname}`);
    return route.abort();
  });
  await page.goto(`${base}/#/me`);
  await page.getByRole("button", { name: "使用 Google 登录" }).waitFor();
  return {
    page,
    requests,
    errors,
    cloud,
    context,
    switchUser: async (nextUser, nextCloud) => {
      currentUser = nextUser;
      cloud = nextCloud;
      const payload = Buffer.from(
        JSON.stringify({
          sub: nextUser.id,
          aud: "authenticated",
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${payload}.local-test-signature`;
      await page.evaluate(
        async ({ access, refresh }) => {
          const { supabase } = await import("/src/auth/client.ts");
          await supabase.auth.setSession({
            access_token: access,
            refresh_token: refresh,
          });
        },
        { access: jwt, refresh: "mock-account-switch" },
      );
    },
  };
}
async function login(page) {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.includes("使用 Google 登录"),
    );
    return b && !b.disabled;
  });
  await page.getByRole("button", { name: "使用 Google 登录" }).click();
  await page.getByRole("button", { name: "退出登录" }).waitFor();
}

test("offers only Google login with no email registration or password forms", async (t) => {
  const { page, requests, errors } = await fixture(t);
  assert.equal(
    await page.getByRole("button", { name: "注册", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.locator('input[type="email"],input[type="password"]').count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "忘记密码？" }).count(),
    0,
  );
  for (const width of [375, 1280])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => document.documentElement.setAttribute("data-theme", theme),
        theme,
      );
      const panel = await page.locator(".account-panel").boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1);
    }
  assert.ok(
    requests.every(
      (r) => !["/auth/v1/signup", "/auth/v1/recover"].includes(r.path),
    ),
  );
  assert.deepEqual(errors, []);
});
test("uses Google OAuth with PKCE and returns to the account page", async (t) => {
  const { page, requests, errors } = await fixture(t);
  await login(page);
  const oauth = requests.find((r) => r.path === "/auth/v1/authorize");
  assert.equal(oauth.query.get("provider"), "google");
  assert.equal(oauth.query.get("redirect_to"), `${base}/?auth_callback=1`);
  assert.equal(oauth.query.get("code_challenge_method"), "s256");
  assert.ok(oauth.query.get("code_challenge"));
  assert.equal(oauth.query.get("prompt"), "select_account");
  assert.ok(
    requests.some(
      (r) =>
        r.path === "/auth/v1/token" && r.query.get("grant_type") === "pkce",
    ),
  );
  assert.equal(new URL(page.url()).hash, "#/me");
  assert.ok(!page.url().includes("code="));
  assert.deepEqual(errors, []);
});
test("restores Google sessions, saves the own-user profile and preserves progress on logout", async (t) => {
  const { page, requests, errors } = await fixture(t);
  await page.evaluate(() =>
    localStorage.setItem(
      "word-atlas:v2:word-atlas-open",
      JSON.stringify({
        version: 2,
        datasetId: "word-atlas-open",
        cards: {},
        bookmarks: ["library"],
        days: {},
        typing: [],
        session: null,
        mistakes: [],
      }),
    ),
  );
  await login(page);
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await page.getByLabel("昵称", { exact: true }).fill("新昵称");
  await page.getByRole("button", { name: "保存资料" }).click();
  await page
    .getByRole("dialog", { name: "编辑资料" })
    .waitFor({ state: "hidden" });
  await page.getByText("新昵称", { exact: true }).waitFor();
  const save = requests.find(
    (r) => r.path === "/rest/v1/rpc/save_my_profile" && r.method === "POST",
  );
  assert.equal(Object.hasOwn(save.data, "id"), false);
  assert.equal(save.data.p_display_name, "新昵称");
  await page.reload();
  await page.getByRole("button", { name: "退出登录" }).waitFor();
  await page.getByText("新昵称", { exact: true }).waitFor();
  assert.ok(requests.some((r) => r.path === "/rest/v1/rpc/ensure_my_account"));
  assert.ok(
    requests
      .filter((r) => r.path.startsWith("/rest/v1/rpc/"))
      .every((r) => !r.data || !Object.hasOwn(r.data, "id")),
  );
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("button", { name: "使用 Google 登录" }).waitFor();
  assert.deepEqual(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("word-atlas:v2:word-atlas-open"))
          .bookmarks,
    ),
    ["library"],
  );
  await page.reload();
  await page.getByRole("button", { name: "使用 Google 登录" }).waitFor();
  assert.deepEqual(errors, []);
});
test("starts OAuth when provider settings are unreachable and AbortSignal.timeout is unavailable", async (t) => {
  const { page, requests, errors } = await fixture(t, { withoutTimeout: true });
  assert.equal(
    await page.getByRole("button", { name: "使用 Google 登录" }).isEnabled(),
    true,
  );
  await login(page);
  assert.equal(
    requests.filter((r) => r.path === "/auth/v1/settings").length,
    0,
  );
  assert.ok(requests.some((r) => r.path === "/auth/v1/authorize"));
  assert.deepEqual(errors, []);
});
test("clears a canceled OAuth callback and presents Google login again", async (t) => {
  const { page, errors } = await fixture(t);
  await page.goto(
    `${base}/?auth_callback=1#error=access_denied&error_description=User+denied+access`,
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Google 登录未完成" })
    .waitFor();
  await page.getByRole("button", { name: "使用 Google 登录" }).waitFor();
  assert.ok(!page.url().includes("error="));
  assert.deepEqual(errors, []);
});
test("signs out legacy email sessions and offers Google login", async (t) => {
  const { page, requests, errors } = await fixture(t, { legacyEmail: true });
  await page
    .getByRole("alert")
    .filter({ hasText: "本站仅支持 Google 登录" })
    .waitFor();
  await page.waitForFunction(
    () => localStorage.getItem("sb-word-atlas-auth-test-auth-token") === null,
  );
  assert.ok(requests.some((r) => r.path === "/auth/v1/logout"));
  assert.equal(await page.getByRole("button", { name: "退出登录" }).count(), 0);
  assert.deepEqual(errors, []);
});
test("keeps account logout usable when profiles are unavailable", async (t) => {
  const { page, errors } = await fixture(t, { profileError: true });
  await login(page);
  await page
    .getByRole("alert")
    .filter({ hasText: "账号数据库尚未就绪" })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "退出登录" }).isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
});

const progress = (id) => ({
  version: 2,
  datasetId: id,
  cards: {},
  bookmarks: [],
  days: {},
  typing: [],
  session: null,
  mistakes: [],
});
const backup = (cloud, datasets = cloud.learning_data.datasets) => ({
  app: "word-atlas",
  version: 3,
  exported: new Date().toISOString(),
  data: { settings: { ...cloud.learning_data.settings }, datasets },
});
async function chooseBackup(page, value, name = "learning-backup.json") {
  await page.locator('.me input[type="file"]').setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await page.getByRole("dialog", { name: "确认全量替换" }).waitFor();
}
async function waitSynced(page) {
  await page.locator(".sync-status").filter({ hasText: "已同步" }).waitFor();
}

test("first login asks before migrating all guest datasets and leaves guest originals intact", async (t) => {
  const guest = {
    one: { ...progress("one"), bookmarks: ["library"] },
    two: progress("two"),
  };
  const f = await fixture(t, { migration: true, guestDatasets: guest });
  await login(f.page);
  const dialog = f.page.getByRole("dialog", { name: "迁移本机记录" });
  await dialog.waitFor();
  assert.equal(f.cloud.data_initialized, false);
  await dialog.getByRole("button", { name: "迁移当前设备记录" }).click();
  await waitSynced(f.page);
  assert.deepEqual(Object.keys(f.cloud.learning_data.datasets).sort(), [
    "one",
    "two",
  ]);
  await f.page.getByRole("button", { name: "退出登录", exact: true }).click();
  await f.page.getByRole("button", { name: "使用 Google 登录" }).waitFor();
  assert.deepEqual(
    await f.page.evaluate(
      () => JSON.parse(localStorage.getItem("word-atlas:v2:one")).bookmarks,
    ),
    ["library"],
  );
  assert.deepEqual(f.errors, []);
});
test("import cancel changes nothing; v2 confirmation clears omitted datasets and preserves profile", async (t) => {
  const f = await fixture(t, {
    datasets: { one: progress("one"), two: progress("two") },
  });
  await login(f.page);
  await waitSynced(f.page);
  const before = structuredClone(f.cloud.learning_data),
    file = backup(f.cloud, { one: progress("one") });
  await chooseBackup(f.page, file);
  const dialog = f.page.getByRole("dialog", { name: "确认全量替换" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(f.cloud.learning_data, before);
  const old = {
    app: "word-atlas",
    version: 2,
    exported: new Date().toISOString(),
    progress: { ...progress("one"), bookmarks: ["library"] },
    settings: file.data.settings,
  };
  await chooseBackup(f.page, old, "legacy-v2.json");
  assert.match(await dialog.innerText(), /v2 单词库/);
  assert.match(
    await dialog.innerText(),
    /其他未包含在文件中的词库记录也会清除/,
  );
  await dialog
    .getByRole("button", { name: "确认全量替换", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(Object.keys(f.cloud.learning_data.datasets), ["one"]);
  assert.equal(f.cloud.display_name, "词光学员");
  assert.equal(f.cloud.avatar_path, null);
  assert.deepEqual(f.errors, []);
});
test("import conflict requires a second confirmation and malformed files do not mutate data", async (t) => {
  const f = await fixture(t, {
    conflictImport: true,
    datasets: { one: progress("one") },
  });
  await login(f.page);
  await waitSynced(f.page);
  const before = structuredClone(f.cloud.learning_data);
  await chooseBackup(f.page, backup(f.cloud, {}));
  const dialog = f.page.getByRole("dialog", { name: "确认全量替换" });
  await dialog
    .getByRole("button", { name: "确认全量替换", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "请重新核对后确认替换" })
    .waitFor();
  assert.deepEqual(f.cloud.learning_data, before);
  await dialog
    .getByRole("button", { name: "确认全量替换", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(f.cloud.learning_data.datasets, {});
  const malformed = backup(f.cloud);
  malformed.data.settings.theme = null;
  await f.page.locator('.me input[type="file"]').setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(malformed)),
  });
  await f.page
    .getByRole("status")
    .filter({ hasText: "备份的学习记录" })
    .waitFor();
  assert.equal(await dialog.count(), 0);
  assert.deepEqual(f.cloud.learning_data.datasets, {});
  assert.deepEqual(f.errors, []);
});
test("offline settings remain pending, export includes them, and reconnect uploads incremental changes", async (t) => {
  const f = await fixture(t);
  await login(f.page);
  await waitSynced(f.page);
  await f.context.setOffline(true);
  await f.page.getByRole("button", { name: "切换到浅色", exact: true }).click();
  await f.page
    .locator(".sync-status")
    .filter({ hasText: "离线待同步" })
    .waitFor();
  assert.equal(f.cloud.learning_data.settings.theme, "dark");
  const downloadEvent = f.page.waitForEvent("download");
  await f.page.getByRole("button", { name: "导出备份", exact: true }).click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.version, 3);
  assert.equal(exported.data.settings.theme, "light");
  assert.equal(Object.hasOwn(exported, "profile"), false);
  await f.context.setOffline(false);
  await waitSynced(f.page);
  assert.equal(f.cloud.learning_data.settings.theme, "light");
  const patch = f.requests.find((r) =>
    r.path.endsWith("/apply_my_learning_changes"),
  );
  assert.ok(
    patch.data.p_changes.some((c) => c.path.join("/") === "settings/theme"),
  );
  assert.deepEqual(f.errors, []);
});
test("avatar menu supports hover, keyboard, touch click, outside click and shared profile editing", async (t) => {
  const f = await fixture(t);
  await login(f.page);
  await waitSynced(f.page);
  await f.page.setViewportSize({ width: 1280, height: 900 });
  const trigger = f.page.getByRole("button", { name: "账号菜单", exact: true }),
    menu = f.page.getByRole("menu", { name: "账号操作" });
  await trigger.hover();
  await menu.waitFor();
  assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), [
    "个人中心",
    "编辑资料",
    "退出登录",
  ]);
  await f.page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await trigger.focus();
  await f.page.keyboard.press("ArrowDown");
  await menu.waitFor();
  assert.equal(
    await f.page.evaluate(() => document.activeElement.textContent),
    "个人中心",
  );
  await f.page.keyboard.press("ArrowDown");
  await f.page.keyboard.press("Enter");
  const editor = f.page.getByRole("dialog", { name: "编辑资料" });
  await editor.waitFor();
  await editor.getByLabel("昵称", { exact: true }).fill("共享昵称");
  await editor.getByRole("button", { name: "保存资料", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await f.page.getByText("共享昵称", { exact: true }).waitFor();
  await f.page.setViewportSize({ width: 375, height: 812 });
  await f.page.mouse.move(0, 0);
  await trigger.click();
  await menu.waitFor();
  await f.page.mouse.click(8, 400);
  await menu.waitFor({ state: "hidden" });
  assert.deepEqual(f.errors, []);
});
test("avatar upload is cropped to square WebP, shared after save, and can restore Google photo", async (t) => {
  const f = await fixture(t);
  await login(f.page);
  await waitSynced(f.page);
  await f.page.getByRole("button", { name: "编辑资料", exact: true }).click();
  const editor = f.page.getByRole("dialog", { name: "编辑资料" });
  const png = await f.page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 600;
    c.getContext("2d").fillRect(0, 0, 800, 600);
    return c.toDataURL("image/png").split(",")[1];
  });
  await editor.locator('input[type="file"]').setInputFiles({
    name: "too-large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await editor
    .getByRole("alert")
    .filter({ hasText: "不能超过 5 MB" })
    .waitFor();
  assert.equal(f.cloud.avatar_path, null);
  await editor.locator('input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await editor.getByAltText("新头像预览").waitFor();
  assert.deepEqual(
    await editor
      .getByAltText("新头像预览")
      .evaluate((img) => [img.naturalWidth, img.naturalHeight]),
    [512, 512],
  );
  await editor.getByRole("button", { name: "保存资料", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.match(
    f.cloud.avatar_path,
    new RegExp(`^${userId}/[0-9a-f-]+\\.webp$`),
  );
  assert.ok(
    f.requests.some(
      (r) =>
        r.path.startsWith("/storage/v1/object/word-atlas-avatars/") &&
        r.method === "POST" &&
        r.bodyBytes > 0,
    ),
  );
  await f.page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await editor
    .getByRole("button", { name: "恢复 Google 头像", exact: true })
    .click();
  await editor.getByRole("button", { name: "保存资料", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(f.cloud.avatar_path, null);
  assert.deepEqual(f.errors, []);
});
test("another browser device reads cloud settings and unfinished work without guest overwrite", async (t) => {
  const p = progress("word-atlas-open");
  p.session = {
    id: "s123",
    started: 123,
    steps: [{ id: "library", kind: "spell" }],
    index: 0,
    graded: { library: 3 },
    newIds: ["library"],
    reviewIds: [],
    pending: { correct: true, value: "library" },
  };
  const first = await fixture(t, { datasets: { "word-atlas-open": p } });
  await login(first.page);
  await waitSynced(first.page);
  await first.page
    .getByRole("button", { name: "切换到浅色", exact: true })
    .click();
  await waitSynced(first.page);
  const second = await fixture(t, {
    sharedCloud: first.cloud,
    guestDatasets: { unrelated: progress("unrelated") },
  });
  await login(second.page);
  await waitSynced(second.page);
  const downloadEvent = second.page.waitForEvent("download");
  await second.page
    .getByRole("button", { name: "导出备份", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile(await (await downloadEvent).path(), "utf8"),
  );
  assert.equal(exported.data.settings.theme, "light");
  assert.deepEqual(
    exported.data.datasets["word-atlas-open"].session,
    p.session,
  );
  assert.equal(Object.hasOwn(exported.data.datasets, "unrelated"), false);
  assert.deepEqual(second.errors, []);
});

test("mobile touch menu and profile/import dialogs fit both themes without horizontal overflow", async (t) => {
  const f = await fixture(t, { touch: true });
  await login(f.page);
  await waitSynced(f.page);
  const trigger = f.page.getByRole("button", { name: "账号菜单", exact: true });
  await trigger.tap();
  const menu = f.page.getByRole("menu", { name: "账号操作" });
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: "编辑资料", exact: true }).tap();
  const editor = f.page.getByRole("dialog", { name: "编辑资料" });
  await editor.waitFor();
  for (const width of [375, 1280])
    for (const theme of ["light", "dark"]) {
      await f.page.setViewportSize({ width, height: 900 });
      await f.page.evaluate(
        (v) => document.documentElement.setAttribute("data-theme", v),
        theme,
      );
      const expectedColor =
        theme === "dark" ? "rgb(13, 17, 32)" : "rgb(246, 241, 231)";
      await f.page.waitForFunction(
        (color) =>
          getComputedStyle(
            document.querySelector('[role="dialog"][aria-label="编辑资料"]'),
          ).backgroundColor === color,
        expectedColor,
      );
      assert.equal(
        await editor.evaluate((el) => getComputedStyle(el).backgroundColor),
        expectedColor,
      );
      await f.page.screenshot({
        path: `/workspace/.cloud-setup/account-ui-${width}-${theme}.png`,
      });
      const bounds = await editor.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert.ok(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await f.page.setViewportSize({ width: 375, height: 812 });
  await chooseBackup(f.page, backup(f.cloud));
  const confirm = f.page.getByRole("dialog", { name: "确认全量替换" });
  const bounds = await confirm.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 376);
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(f.errors, []);
});
test("resuming an already-graded pending question completes without increasing reviews again", async (t) => {
  const p = progress("word-atlas-open"),
    date = new Date().toISOString().slice(0, 10);
  p.cards.library = {
    due: Date.now() + 10000,
    s: 1,
    d: 5,
    el: 0,
    sd: 1,
    ls: 0,
    reps: 1,
    lapses: 0,
    st: 1,
    seen: 123,
  };
  p.days[date] = { n: 1, r: 1, c: 1, t: 5 };
  p.session = {
    id: "s123",
    started: Date.now() - 1000,
    steps: [{ id: "library", kind: "spell" }],
    index: 0,
    graded: { library: 3 },
    newIds: ["library"],
    reviewIds: [],
    pending: { correct: true, value: "library" },
  };
  const f = await fixture(t, { datasets: { "word-atlas-open": p } });
  await login(f.page);
  await waitSynced(f.page);
  await f.page.goto(`${base}/#/learn`);
  await f.page.getByRole("button", { name: /继续/ }).click();
  await f.page.getByText("这一程结束了", { exact: true }).waitFor();
  await f.page.goto(`${base}/#/me`);
  await waitSynced(f.page);
  const saved = f.cloud.learning_data.datasets["word-atlas-open"];
  assert.equal(saved.days[date].r, 1);
  assert.equal(saved.days[date].n, 1);
  assert.equal(saved.cards.library.reps, 1);
  assert.equal(saved.session.index, 1);
  assert.ok(saved.session.finished);
  assert.equal(Object.hasOwn(saved.session, "pending"), false);
  assert.deepEqual(f.errors, []);
});

test("switching accounts isolates pending IndexedDB edits and shared profile state", async (t) => {
  const f = await fixture(t);
  await login(f.page);
  await waitSynced(f.page);
  await f.context.setOffline(true);
  await f.page.getByRole("button", { name: "切换到浅色", exact: true }).click();
  await f.page
    .locator(".sync-status")
    .filter({ hasText: "离线待同步" })
    .waitFor();
  const bUser = {
    ...googleUser,
    id: "22222222-2222-4222-8222-222222222222",
    email: "second@example.invalid",
  };
  const bCloud = {
    ...structuredClone(f.cloud),
    id: bUser.id,
    display_name: "第二账号",
    learning_data: {
      settings: { ...f.cloud.learning_data.settings, theme: "dark" },
      datasets: {},
    },
  };
  await f.switchUser(bUser, bCloud);
  await f.context.setOffline(false);
  await waitSynced(f.page);
  await f.page.getByText("第二账号", { exact: true }).waitFor();
  assert.equal(await f.page.getByText("词光学员", { exact: true }).count(), 0);
  assert.equal(bCloud.learning_data.settings.theme, "dark");
  assert.equal(f.cloud.learning_data.settings.theme, "dark");
  const cached = await f.page.evaluate(async (id) => {
    const req = indexedDB.open("word-atlas-accounts", 1);
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result);
      req.onerror = j;
    });
    const tx = db.transaction("learning", "readonly");
    const row = tx.objectStore("learning").get(`user:${id}`);
    return await new Promise((r, j) => {
      row.onsuccess = () => r(row.result.data.settings.theme);
      row.onerror = j;
    });
  }, userId);
  assert.equal(cached, "light");
  assert.deepEqual(f.errors, []);
});

test("A1 browsing does not award progress; first journey answer persists once through home and reload", async (t) => {
  const f = await fixture(t);
  f.cloud.learning_data.settings.dailyNew = 1;
  f.cloud.learning_data.settings.autoplay = false;
  await login(f.page);
  await waitSynced(f.page);
  await f.page.goto(`${base}/#/`);
  const a1 = f.page.getByRole("button", { name: /^A1 入门，已学 0/ });
  await a1.click();
  await f.page.locator(".tile").first().click();
  const detail = f.page.getByRole("dialog", { name: /词条$/ });
  await detail.waitFor();
  await detail.getByText(/浏览卡片不计学习进度/).waitFor();
  assert.equal(
    Object.keys(f.cloud.learning_data.datasets["word-atlas-open"]?.cards ?? {})
      .length,
    0,
  );
  await detail.getByRole("link", { name: "前往今日旅程完成答题" }).click();
  await f.page.getByRole("button", { name: "开始今天的旅程" }).click();
  await f.page
    .getByRole("button", { name: /下一张初见卡|开始答题/, exact: true })
    .waitFor();
  assert.equal(
    Object.keys(f.cloud.learning_data.datasets["word-atlas-open"]?.cards ?? {})
      .length,
    0,
  );
  await f.page
    .getByRole("button", { name: /下一张初见卡|开始答题/, exact: true })
    .click();
  const option = f.page.locator(".option").first();
  await option.waitFor();
  await option.click();
  await f.page.getByRole("button", { name: "继续", exact: true }).waitFor();
  const memoryBefore = await f.page.evaluate(async () => {
    const { store } = await import("/src/store/store.ts");
    return structuredClone(store.get().progress);
  });
  assert.equal(Object.keys(memoryBefore.cards).length, 1);
  const day = Object.keys(memoryBefore.days)[0];
  assert.equal(memoryBefore.days[day].r, 1);
  assert.equal(memoryBefore.days[day].n, 1);
  // Re-delivering the same answer while its result is pending cannot award another point.
  await f.page.evaluate(async () => {
    const { store } = await import("/src/store/store.ts");
    const { answer } = await import("/src/store/session.ts");
    const p = store.get().progress;
    answer(null, p.session.steps[p.session.index], true, 3, "duplicate");
  });
  await f.page.getByRole("button", { name: "暂停并返回" }).click();
  await f.page.getByRole("button", { name: /^A1 入门，已学 1/ }).waitFor();
  await f.page.goto(`${base}/#/me`);
  await waitSynced(f.page);
  await f.page.reload();
  await waitSynced(f.page);
  await f.page.goto(`${base}/#/`);
  await f.page.getByRole("button", { name: /^A1 入门，已学 1/ }).waitFor();
  const p = f.cloud.learning_data.datasets["word-atlas-open"];
  assert.equal(Object.keys(p.cards).length, 1);
  assert.equal(p.days[day].r, 1);
  assert.equal(p.days[day].n, 1);
  assert.deepEqual(f.errors, []);
});

test("previous IndexedDB snapshots with undefined optional task fields recover on reload", async (t) => {
  const p = progress("word-atlas-open");
  p.session = {
    id: "s123",
    started: 123,
    steps: [{ id: "library", kind: "spell" }],
    index: 0,
    graded: { library: 3 },
    newIds: ["library"],
    reviewIds: [],
    pending: { correct: true, value: "library" },
  };
  const f = await fixture(t, { datasets: { "word-atlas-open": p } });
  await login(f.page);
  await waitSynced(f.page);
  await f.page.evaluate(async (id) => {
    const open = indexedDB.open("word-atlas-accounts", 1);
    const db = await new Promise((r, j) => {
      open.onsuccess = () => r(open.result);
      open.onerror = j;
    });
    await new Promise((r, j) => {
      const tx = db.transaction("learning", "readwrite"),
        store = tx.objectStore("learning"),
        get = store.get(`user:${id}`);
      get.onsuccess = () => {
        const row = get.result;
        for (const data of [row.data, row.base]) {
          const session = data.datasets["word-atlas-open"].session;
          session.finished = undefined;
          session.steps[0].options = undefined;
        }
        store.put(row, `user:${id}`);
      };
      tx.oncomplete = r;
      tx.onabort = j;
    });
    db.close();
  }, userId);
  await f.page.reload();
  await waitSynced(f.page);
  assert.equal(
    await f.page
      .getByRole("alert")
      .filter({ hasText: "离线缓存校验失败" })
      .count(),
    0,
  );
  assert.deepEqual(
    f.cloud.learning_data.datasets["word-atlas-open"].session,
    p.session,
  );
  assert.deepEqual(f.errors, []);
});

test("intro-only activity syncs position with zero stats; the first answer persists before completing a group", async (t) => {
  const f = await fixture(t);
  f.cloud.learning_data.settings.autoplay = false;
  await login(f.page);
  await waitSynced(f.page);
  await f.page.goto(`${base}/#/`);
  await f.page.getByRole("button", { name: "开始今天的旅程" }).click();
  await f.page.getByText("初次见面 · 1/5", { exact: true }).waitFor();
  await f.page
    .getByRole("button", { name: "下一张初见卡", exact: true })
    .click();
  await f.page.getByText("初次见面 · 2/5", { exact: true }).waitFor();
  await f.page.screenshot({
    path: "/workspace/.cloud-setup/intro-position-explanation.png",
  });
  await f.page.getByRole("button", { name: "暂停并返回" }).click();
  await f.page.goto(`${base}/#/me`);
  await waitSynced(f.page);
  const snapshot = () => f.cloud.learning_data.datasets["word-atlas-open"];
  assert.equal(snapshot().session.index, 1);
  assert.equal(Object.keys(snapshot().cards).length, 0);
  assert.equal(Object.keys(snapshot().session.graded).length, 0);
  assert.equal(
    Object.values(snapshot().days).reduce((n, d) => n + d.r, 0),
    0,
  );
  assert.equal(
    await f.page.locator(".stat-strip > div").nth(1).locator("dd").innerText(),
    "0",
  );
  await f.page.getByRole("region", { name: "本轮学习提示" }).waitFor();
  await f.page.reload();
  await waitSynced(f.page);
  assert.equal(snapshot().session.index, 1);
  await f.page.getByRole("link", { name: "继续本轮学习", exact: true }).click();
  await f.page.getByText("初次见面 · 2/5", { exact: true }).waitFor();
  for (let i = 0; i < 3; i++)
    await f.page
      .getByRole("button", { name: "下一张初见卡", exact: true })
      .click();
  await f.page.getByText("初次见面 · 5/5", { exact: true }).waitFor();
  assert.equal(Object.keys(snapshot().cards).length, 0);
  await f.page.getByRole("button", { name: "开始答题", exact: true }).click();
  const word = await f.page.evaluate(async () => {
    const { store } = await import("/src/store/store.ts");
    const s = store.get().progress.session;
    return s.steps[s.index].id;
  });
  await f.page.locator(`[data-option="${word}"]`).click();
  await f.page.getByRole("button", { name: "继续", exact: true }).waitFor();
  await f.page.getByRole("button", { name: "暂停并返回" }).click();
  await f.page.goto(`${base}/#/me`);
  await waitSynced(f.page);
  assert.equal(Object.keys(snapshot().cards).length, 1);
  assert.equal(snapshot().session.finished, undefined);
  assert.equal(snapshot().session.index, 5);
  assert.equal(
    Object.values(snapshot().days).reduce((n, d) => n + d.r, 0),
    1,
  );
  assert.equal(
    await f.page.locator(".stat-strip > div").nth(1).locator("dd").innerText(),
    "1",
  );
  assert.equal(
    await f.page.getByRole("region", { name: "本轮学习提示" }).count(),
    0,
  );
  await f.page.reload();
  await waitSynced(f.page);
  assert.equal(
    await f.page.locator(".stat-strip > div").nth(1).locator("dd").innerText(),
    "1",
  );
  await f.page.goto(`${base}/#/`);
  await f.page.getByRole("button", { name: "继续旅程", exact: true }).click();
  await f.page.getByRole("button", { name: "继续", exact: true }).click();
  await f.page.getByRole("button", { name: "暂停并返回" }).click();
  await f.page.goto(`${base}/#/me`);
  await waitSynced(f.page);
  assert.equal(snapshot().session.index, 6);
  assert.equal(Object.keys(snapshot().cards).length, 1);
  assert.equal(
    Object.values(snapshot().days).reduce((n, d) => n + d.r, 0),
    1,
  );
  assert.deepEqual(f.errors, []);
});

test("a ten-word journey completes both intro groups and saves ten first answers once", async (t) => {
  const f = await fixture(t);
  f.cloud.learning_data.settings.autoplay = false;
  await login(f.page);
  await waitSynced(f.page);
  await f.page.goto(`${base}/#/`);
  await f.page.getByRole("button", { name: "开始今天的旅程" }).click();
  await f.page
    .getByRole("button", { name: "下一张初见卡", exact: true })
    .waitFor();
  for (let i = 0; i < 35; i++) {
    const s = await f.page.evaluate(async () => {
      const { store } = await import("/src/store/store.ts");
      return structuredClone(store.get().progress.session);
    });
    if (s.finished) break;
    const step = s.steps[s.index];
    if (step.kind === "intro")
      await f.page
        .getByRole("button", { name: /下一张初见卡|开始答题/, exact: true })
        .click();
    else if (s.pending)
      await f.page.getByRole("button", { name: "继续", exact: true }).click();
    else await f.page.locator(`[data-option="${step.id}"]`).click();
  }
  await f.page.getByText("这一程结束了", { exact: true }).waitFor();
  await f.page.getByRole("button", { name: "完成", exact: true }).click();
  await f.page.goto(`${base}/#/me`);
  await waitSynced(f.page);
  const p = f.cloud.learning_data.datasets["word-atlas-open"];
  assert.equal(Object.keys(p.cards).length, 10);
  assert.equal(
    Object.values(p.days).reduce((n, d) => n + d.r, 0),
    10,
  );
  assert.equal(
    Object.values(p.days).reduce((n, d) => n + d.n, 0),
    10,
  );
  assert.equal(p.session, null);
  await f.page.reload();
  await waitSynced(f.page);
  assert.equal(
    await f.page.locator(".stat-strip > div").nth(1).locator("dd").innerText(),
    "10",
  );
  assert.deepEqual(f.errors, []);
});
