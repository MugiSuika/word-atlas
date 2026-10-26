import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const base = "http://127.0.0.1:5190";
const authOrigin = "https://word-atlas-auth-test.supabase.co";
const userId = "11111111-1111-4111-8111-111111111111";
const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "learner@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  identities: [],
};
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test-signature`;
const session = () => ({
  access_token: token,
  refresh_token: "mock-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
});
let server;
let browser;
let serverOutput = "";
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
  await context.addInitScript(() => {
    localStorage.setItem(
      "word-atlas:settings",
      JSON.stringify({
        onboarded: true,
        splash: false,
        ambience: "off",
        sfx: false,
      }),
    );
  });
  const requests = [];
  const errors = [];
  let savedName = "词光学员";
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route(`${authOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const data = request.postDataJSON();
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
    if (url.pathname === "/auth/v1/token") {
      if (
        options.invalidLogin &&
        url.searchParams.get("grant_type") === "password"
      )
        return reply(
          { code: "invalid_credentials", msg: "Invalid login credentials" },
          400,
        );
      return reply(session());
    }
    if (url.pathname === "/auth/v1/user") return reply(user);
    if (url.pathname === "/auth/v1/logout")
      return route.fulfill({ status: 204 });
    if (url.pathname === "/auth/v1/signup")
      return reply({ user, session: null });
    if (url.pathname === "/auth/v1/recover") return reply({});
    if (url.pathname === "/rest/v1/profiles") {
      if (request.method() === "GET")
        return options.profileError
          ? reply({ message: "unavailable" }, 503)
          : reply([{ display_name: savedName }]);
      savedName = data.display_name;
      return route.fulfill({ status: 201 });
    }
    errors.push(`Unexpected auth request: ${request.method()} ${url.pathname}`);
    return route.abort();
  });
  await page.goto(`${base}/#/me`);
  await page.getByRole("form", { name: "邮箱登录" }).waitFor();
  return { page, requests, errors };
}
async function login(page) {
  const form = page.getByRole("form", { name: "邮箱登录" });
  await form.getByLabel("邮箱", { exact: true }).fill(user.email);
  await form.getByLabel("密码", { exact: true }).fill("safe-test-password");
  await form.getByRole("button", { name: "登录账号" }).click();
  await page.getByRole("button", { name: "退出登录" }).waitFor();
}

test("registers by email, validates matching passwords, and requests a PKCE email callback", async (t) => {
  const { page, requests, errors } = await fixture(t);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  const form = page.getByRole("form", { name: "注册账号" });
  await form.getByLabel("邮箱", { exact: true }).fill(user.email);
  await form.getByLabel("密码", { exact: true }).fill("safe-test-password");
  await form.getByLabel("确认密码", { exact: true }).fill("different-password");
  await form.getByRole("button", { name: "创建账号" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "两次输入的密码不一致" })
    .waitFor();
  assert.equal(requests.filter((r) => r.path.endsWith("/signup")).length, 0);
  await form.getByLabel("确认密码", { exact: true }).fill("safe-test-password");
  await form.getByRole("button", { name: "创建账号" }).click();
  await page.getByRole("status").filter({ hasText: "请检查邮箱" }).waitFor();
  const request = requests.find((r) => r.path.endsWith("/signup"));
  assert.equal(request.data.email, user.email);
  assert.ok(request.data.code_challenge);
  assert.equal(request.query.get("redirect_to"), `${base}/?auth_callback=1`);
  assert.deepEqual(errors, []);
});

test("reports invalid credentials and keeps login usable", async (t) => {
  const { page, errors } = await fixture(t, { invalidLogin: true });
  await page.getByLabel("邮箱", { exact: true }).fill(user.email);
  await page.getByLabel("密码", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "登录账号" }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /邮箱或密码不正确/);
  assert.equal(
    await page.getByRole("button", { name: "登录账号" }).isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
});

test("restores sessions, saves the own-user profile, and logs out without erasing learning data", async (t) => {
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
  await page.getByRole("form", { name: "邮箱登录" }).waitFor();
  assert.deepEqual(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("word-atlas:v2:word-atlas-open"))
          .bookmarks,
    ),
    ["library"],
  );
  await page.reload();
  await page.getByRole("form", { name: "邮箱登录" }).waitFor();
  assert.deepEqual(errors, []);
});

test("allows a signed-in user to recover from a profile service error", async (t) => {
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

test("handles a recovery email callback and updates the password using the recovery session", async (t) => {
  const { page, requests, errors } = await fixture(t);
  await page.getByRole("button", { name: "忘记密码？" }).click();
  const form = page.getByRole("form", { name: "重置密码" });
  await form.getByLabel("邮箱", { exact: true }).fill(user.email);
  await form.getByRole("button", { name: "发送重置邮件" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "如果该邮箱已注册" })
    .waitFor();
  const reset = requests.find((r) => r.path.endsWith("/recover"));
  assert.ok(reset.data.code_challenge);
  assert.equal(reset.query.get("redirect_to"), `${base}/?auth_callback=1`);
  await page.goto(`${base}/?auth_callback=1&code=mock-recovery-code`);
  const dialog = page.getByRole("dialog", { name: "设置新密码" });
  await dialog.waitFor();
  await dialog.getByLabel("新密码", { exact: true }).fill("updated-password");
  await dialog
    .getByLabel("确认新密码", { exact: true })
    .fill("different-password");
  await dialog.getByRole("button", { name: "保存新密码" }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "两次输入的密码不一致" })
    .waitFor();
  await dialog
    .getByLabel("确认新密码", { exact: true })
    .fill("updated-password");
  await dialog.getByRole("button", { name: "保存新密码" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    requests.find((r) => r.path === "/auth/v1/user" && r.method === "PUT").data
      .password,
    "updated-password",
  );
  assert.ok(!page.url().includes("code="));
  assert.deepEqual(errors, []);
});

test("expired email links show a clear error and return to login", async (t) => {
  const { page, errors } = await fixture(t);
  await page.goto(
    `${base}/?auth_callback=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`,
  );
  await page.getByRole("alert").filter({ hasText: "验证链接已失效" }).waitFor();
  await page.getByRole("form", { name: "邮箱登录" }).waitFor();
  assert.ok(!page.url().includes("error="));
  assert.deepEqual(errors, []);
});
