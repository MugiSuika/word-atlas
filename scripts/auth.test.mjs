import assert from "node:assert/strict";
import { test, before, after } from "node:test";
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
  });
  t.after(() => context.close());
  const legacyUser = {
    ...googleUser,
    app_metadata: { provider: "email", providers: ["email"] },
  };
  await context.addInitScript(
    ({ legacy }) => {
      localStorage.setItem(
        "word-atlas:settings",
        JSON.stringify({
          onboarded: true,
          splash: false,
          ambience: "off",
          sfx: false,
        }),
      );
      if (legacy)
        localStorage.setItem(
          "sb-word-atlas-auth-test-auth-token",
          JSON.stringify(legacy),
        );
    },
    { legacy: options.legacyEmail ? session(legacyUser) : null },
  );
  let googleEnabled = options.googleEnabled !== false;
  let savedName = "词光学员";
  const requests = [],
    errors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route(`${authOrigin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      data = request.postDataJSON();
    requests.push({
      path: url.pathname,
      query: url.searchParams,
      method: request.method(),
      data,
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
    if (url.pathname === "/auth/v1/settings")
      return options.settingsError
        ? reply({}, 503)
        : reply({ external: { google: googleEnabled, email: false } });
    if (url.pathname === "/auth/v1/authorize")
      return route.fulfill({
        status: 302,
        headers: { location: `${base}/?auth_callback=1&code=mock-google-code` },
      });
    if (url.pathname === "/auth/v1/token") return reply(session());
    if (url.pathname === "/auth/v1/user")
      return reply(options.legacyEmail ? legacyUser : googleUser);
    if (url.pathname === "/auth/v1/logout")
      return route.fulfill({ status: 204 });
    if (url.pathname === "/rest/v1/profiles") {
      if (request.method() === "GET")
        return options.profileError
          ? reply({ message: "unavailable" }, 404)
          : reply([{ display_name: savedName }]);
      savedName = data.display_name;
      return route.fulfill({ status: 201 });
    }
    errors.push(`Unexpected auth request: ${request.method()} ${url.pathname}`);
    return route.abort();
  });
  await page.goto(`${base}/#/me`);
  await page.getByRole("button", { name: "使用 Google 登录" }).waitFor();
  return {
    page,
    requests,
    errors,
    enableGoogle: () => {
      googleEnabled = true;
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
  await page.getByLabel("昵称", { exact: true }).fill("新昵称");
  await page.getByRole("button", { name: "保存昵称" }).click();
  await page.getByRole("status").filter({ hasText: "昵称已保存" }).waitFor();
  const save = requests.find(
    (r) => r.path === "/rest/v1/profiles" && r.method === "POST",
  );
  assert.equal(save.data.id, userId);
  assert.equal(save.data.display_name, "新昵称");
  await page.reload();
  await page.getByRole("button", { name: "退出登录" }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[name="display-name"]')?.value === "新昵称",
  );
  assert.ok(
    requests
      .filter((r) => r.path === "/rest/v1/profiles" && r.method === "GET")
      .every((r) => r.query.get("id") === `eq.${userId}`),
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
test("keeps guests usable while Google is disabled and can retry after it is enabled", async (t) => {
  const { page, requests, errors, enableGoogle } = await fixture(t, {
    googleEnabled: false,
  });
  await page
    .getByRole("status")
    .filter({ hasText: "Google 登录暂未开放" })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "使用 Google 登录" }).isDisabled(),
    true,
  );
  assert.equal(
    requests.filter((r) => r.path === "/auth/v1/authorize").length,
    0,
  );
  enableGoogle();
  await page.getByRole("button", { name: "重试连接" }).click();
  await login(page);
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
    .filter({ hasText: "暂时无法读取个人资料" })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "退出登录" }).isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
});
test("reports a provider-settings network failure without starting OAuth", async (t) => {
  const { page, requests, errors } = await fixture(t, { settingsError: true });
  await page
    .getByRole("alert")
    .filter({ hasText: "暂时无法连接登录服务" })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "使用 Google 登录" }).isDisabled(),
    true,
  );
  assert.equal(
    requests.filter((r) => r.path === "/auth/v1/authorize").length,
    0,
  );
  assert.deepEqual(errors, []);
});
