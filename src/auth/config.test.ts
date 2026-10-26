import assert from "node:assert/strict";
import { test } from "node:test";
import { authMessage, publicAuthConfig } from "./config";

const jwt = (role: string) => `e30.${btoa(JSON.stringify({ role }))}.signature`;
test("auth remains optional and invalid endpoints do not initialize a client", () => {
  for (const url of [
    undefined,
    "",
    "http://project.supabase.co",
    "https://user:pass@project.supabase.co",
    "https://project.supabase.co/path",
    "https://project.supabase.co?token=hidden",
    "garbage",
  ]) {
    assert.equal(publicAuthConfig(url, "sb_publishable_public"), null);
  }
  assert.equal(publicAuthConfig("https://project.supabase.co", ""), null);
});
test("only public publishable and legacy anon keys are accepted", () => {
  assert.deepEqual(
    publicAuthConfig(
      " https://project.supabase.co/ ",
      " sb_publishable_public ",
    ),
    { url: "https://project.supabase.co", key: "sb_publishable_public" },
  );
  assert.equal(
    publicAuthConfig("https://project.supabase.co", jwt("anon"))?.key,
    jwt("anon"),
  );
  for (const key of [
    "sb_secret_private",
    jwt("service_role"),
    jwt("authenticated"),
    "broken-key",
  ]) {
    assert.equal(publicAuthConfig("https://project.supabase.co", key), null);
  }
});
test("auth errors give actionable messages without exposing remote error details", () => {
  assert.match(authMessage({ code: "invalid_credentials" }), /邮箱或密码/);
  assert.match(authMessage({ code: "email_not_confirmed" }), /验证邮箱/);
  assert.match(authMessage({ status: 429 }), /频繁/);
  assert.match(authMessage({ code: "database-secret-error" }), /重试/);
  assert.match(authMessage(null), /网络/);
});
