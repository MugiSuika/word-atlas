import assert from "node:assert/strict";
import test from "node:test";
import { runAccountBackend } from "./account-backend.mjs";

const projectRef = "abcdefghijklmnopqrst";
const uid = "11111111-1111-4111-8111-111111111111";
const ready = {
  rls: true,
  columns: 9,
  rpcs: 4,
  private_bucket: true,
  storage_policies: 5,
  storage_rls: true,
  owner_guard: true,
};
const env = {
  SUPABASE_ACCESS_TOKEN: "test-management-token-not-a-real-secret",
};
const args = (mode) => [mode, `--project-ref=${projectRef}`];
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

test("missing secure token does not send any requests or attempt another credential", async () => {
  const messages = [];
  const code = await runAccountBackend({
    args: args("apply"),
    env: { SUPABASE_SERVICE_ROLE_KEY: "not-a-management-token" },
    request: () => {
      assert.fail("unexpected request");
    },
    log: (m) => messages.push(m),
  });
  assert.equal(code, 2);
  assert.match(messages.join(""), /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(messages.join(""), /not-a-management-token/);
});
test("requires an explicit project and rejects injection and unsupported commands", async () => {
  for (const input of [
    [],
    ["delete-all"],
    ["apply", "--project-ref=bad';drop table auth.users;--"],
    [...args("verify"), "--verify-user-id=';select 1"],
    [...args("check"), "--sql=select1"],
  ]) {
    await assert.rejects(
      runAccountBackend({
        args: input,
        env,
        request: () => {
          assert.fail("unexpected request");
        },
      }),
    );
  }
});
test("check only inspects metadata and never runs a migration", async () => {
  const calls = [];
  const messages = [];
  const code = await runAccountBackend({
    args: args("check"),
    env,
    request: (url, options) => {
      assert.equal(
        url,
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      );
      assert.equal(
        options.headers.Authorization,
        `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      );
      calls.push(JSON.parse(options.body).query);
      return response([ready]);
    },
    read: () => {
      assert.fail("must not read migration");
    },
    log: (m) => messages.push(m),
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^select/);
  assert.doesNotMatch(calls[0], /\b(insert|update|delete|create|alter)\b/i);
  assert.match(messages[0], /browser/);
});
test("incomplete structure blocks the release gate", async () => {
  assert.equal(
    await runAccountBackend({
      args: args("check"),
      env,
      request: () => response([{ ...ready, rls: false }]),
      log: () => {},
    }),
    3,
  );
});
test("an API rejection is redacted and never claimed as applied", async () => {
  const messages = [];
  await assert.rejects(
    runAccountBackend({
      args: args("apply"),
      env,
      read: async () => "test migration",
      request: () => response({ message: "private database details" }, 401),
      log: (m) => messages.push(m),
    }),
    /HTTP 401/,
  );
  assert.deepEqual(messages, []);
});
test("a network failure does not retry an uncertain mutation", async () => {
  let count = 0;
  await assert.rejects(
    runAccountBackend({
      args: args("apply"),
      env,
      read: async () => "test migration",
      request: () => {
        count++;
        throw new Error("private network payload");
      },
    }),
    /Check state before retrying/,
  );
  assert.equal(count, 1);
});
test("apply sends the repository migration and verifies its structure", async () => {
  const calls = [];
  const messages = [];
  const code = await runAccountBackend({
    args: args("apply"),
    env,
    read: async (url, encoding) => {
      assert.match(url.pathname, /20261027000000_account_data.sql$/);
      assert.equal(encoding, "utf8");
      return "exact repository migration";
    },
    request: (url, options) => {
      calls.push(JSON.parse(options.body).query);
      return response(calls.length === 1 ? [] : [ready]);
    },
    log: (m) => messages.push(m),
  });
  assert.equal(code, 0);
  assert.equal(calls[0], "exact repository migration");
  assert.equal(calls.length, 2);
  assert.match(messages[0], /frontend is unchanged/);
});
test("verification never arbitrarily chooses among multiple Google identities", async () => {
  let count = 0;
  await assert.rejects(
    runAccountBackend({
      args: args("verify"),
      env,
      request: () =>
        response(
          ++count === 1
            ? [ready]
            : [{ id: uid }, { id: "22222222-2222-4222-8222-222222222222" }],
        ),
      log: () => {},
    }),
    /exactly one/,
  );
  assert.equal(count, 2);
});
test("rollback verification checks the same account after the write probe", async () => {
  let digests = 0;
  const calls = [];
  const messages = [];
  const code = await runAccountBackend({
    args: args("verify"),
    env,
    request: (url, options) => {
      const query = JSON.parse(options.body).query;
      calls.push(query);
      if (query.startsWith("select\n")) return response([ready]);
      if (query.startsWith("select id::text")) return response([{ id: uid }]);
      if (query.startsWith("select coalesce")) {
        digests++;
        return response([{ digest: "same-before-and-after" }]);
      }
      assert.match(query, /begin;/);
      assert.match(query, /set local role authenticated/);
      assert.match(query, /rollback;$/);
      return response([]);
    },
    log: (m) => messages.push(m),
  });
  assert.equal(code, 0);
  assert.equal(digests, 2);
  assert.equal(calls.length, 5);
  assert.match(messages[0], /not the browser OAuth session/);
});
test("a rollback digest mismatch fails verification", async () => {
  let digests = 0;
  await assert.rejects(
    runAccountBackend({
      args: args("verify"),
      env,
      request: (url, options) => {
        const query = JSON.parse(options.body).query;
        if (query.startsWith("select\n")) return response([ready]);
        if (query.startsWith("select id::text")) return response([{ id: uid }]);
        if (query.startsWith("select coalesce"))
          return response([{ digest: String(++digests) }]);
        return response([]);
      },
      log: () => {},
    }),
    /Rollback verification mismatch/,
  );
});
