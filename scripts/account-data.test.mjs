import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runAccountBackend } from "./account-backend.mjs";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261027000000_account_data.sql",
    import.meta.url,
  ),
  "utf8",
);
const original = await readFile(
  new URL(
    "../supabase/migrations/20261026000000_profiles.sql",
    import.meta.url,
  ),
  "utf8",
);
const lockdown = await readFile(
  new URL("../supabase/rollout/account_data_lockdown.sql", import.meta.url),
  "utf8",
);
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const avatar = `${A}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
const settings = {
  accent: "uk",
  autoplay: true,
  dailyNew: 10,
  retention: 0.9,
  theme: "dark",
  sfx: true,
  spell: true,
  startLevel: 0,
  onboarded: false,
  dataset: "open",
  ambience: "stars",
  ambienceVolume: 0.45,
  splash: true,
  atlasView: "grid",
};
const blank = (id) => ({
  version: 2,
  datasetId: id,
  cards: {},
  bookmarks: [],
  days: {},
  typing: [],
  session: null,
  mistakes: [],
});
const empty = () => ({ settings: { ...settings }, datasets: {} });
const card = {
  due: 1720000000000,
  s: 1.2,
  d: 5,
  el: 0,
  sd: 1,
  ls: 0,
  reps: 1,
  lapses: 0,
  st: 2,
  last: 1710000000000,
  seen: 1,
};
const progress = () => ({
  ...blank("word-atlas-open"),
  cards: { apple: { ...card } },
  bookmarks: ["apple"],
  days: { "2026-10-27": { n: 1, r: 1, c: 1, t: 12 } },
  session: {
    id: "s1720000000000",
    started: 1720000000000,
    steps: [
      { id: "apple", kind: "spell" },
      { id: "apple", kind: "meaning", retry: true, options: ["apple", "pear"] },
    ],
    index: 0,
    graded: { apple: 3 },
    newIds: ["apple"],
    reviewIds: [],
    pending: { correct: true, value: "apple" },
  },
});
const data = () => ({
  settings: { ...settings },
  datasets: { "word-atlas-open": progress(), private: blank("private") },
});

async function bootstrap() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{"provider":"google","providers":["google"]}', raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to public;
    create table storage.buckets (id text primary key, name text, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key,
      bucket_id text references storage.buckets(id), name text, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    -- Deliberately hostile existing permissive policies: restrictive guards must hold.
    create policy unrelated_storage_all on storage.objects for all to public using (true) with check (true);
  `);
  await db.query(
    "insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3),($4,$5,$6)",
    [
      A,
      "a@example.invalid",
      { full_name: "Google A" },
      B,
      "b@example.invalid",
      { name: "Google B" },
    ],
  );
  return db;
}
async function asUser(db, uid, run, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`); // fixed test role, never user input
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid ?? "",
    ]);
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const q = async (db, sql, values = []) => (await db.query(sql, values)).rows;
const rpc = async (db, uid, name, values = []) =>
  asUser(
    db,
    uid,
    async () =>
      (
        await q(
          db,
          `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as value`,
          values,
        )
      )[0].value,
  );
const account = (db, uid = A) => rpc(db, uid, "ensure_my_account");
const replace = (db, rev, value, uid = A) =>
  rpc(db, uid, "replace_my_learning_data", [rev, value]);
const patch = (db, rev, value, uid = A) =>
  rpc(db, uid, "apply_my_learning_changes", [rev, value]);
const profile = (db, rev, name, path = null, uid = A) =>
  rpc(db, uid, "save_my_profile", [rev, name, path]);
const rejectCode = (promise, code, message) =>
  assert.rejects(
    promise,
    (error) =>
      error.code === code && (!message || error.message.includes(message)),
  );

test("account database contract (real local PostgreSQL, no production test users)", async (t) => {
  const db = await bootstrap();
  try {
    await t.test(
      "repairs an absent profiles table and backfills Google names",
      async () => {
        await db.exec(migration);
        const a = await account(db);
        assert.equal(a.display_name, "Google A");
        assert.equal(a.data_revision, 0);
        assert.equal(a.data_initialized, false);
        assert.deepEqual(a.learning_data, empty());
        assert.equal((await account(db, B)).display_name, "Google B");
      },
    );
    await t.test(
      "initialize/read is idempotent and creates later Google identities",
      async () => {
        await db.query(
          "insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)",
          [C, "c@example.invalid", { name: "New Google" }],
        );
        assert.equal((await account(db, C)).display_name, "New Google");
        assert.deepEqual(await account(db), await account(db));
      },
    );
    await t.test("anonymous access and a missing JWT are denied", async () => {
      await rejectCode(
        asUser(db, null, () => q(db, "select * from public.profiles"), "anon"),
        "42501",
      );
      await rejectCode(
        asUser(
          db,
          null,
          () => q(db, "select public.ensure_my_account()"),
          "anon",
        ),
        "42501",
      );
      await rejectCode(account(db, null), "PT401");
      await rejectCode(
        account(db, "44444444-4444-4444-8444-444444444444"),
        "PT401",
      );
    });
    await t.test(
      "RLS isolates accounts even with a preexisting broad policy",
      async () => {
        await db.exec(
          "create policy hostile_all on public.profiles for all to authenticated using (true) with check (true)",
        );
        const rows = await asUser(db, A, () =>
          q(db, "select id from public.profiles"),
        );
        assert.deepEqual(rows, [{ id: A }]);
        const changed = await asUser(db, A, () =>
          q(
            db,
            "update public.profiles set display_name=$1 where id=$2 returning id",
            ["hacked", B],
          ),
        );
        assert.deepEqual(changed, []);
        assert.equal((await account(db, B)).display_name, "Google B");
      },
    );
    await t.test(
      "legacy upserts work during expand but cannot alter learning data",
      async () => {
        await asUser(db, A, () =>
          q(
            db,
            `insert into public.profiles (id,display_name,updated_at) values ($1,$2,now())
        on conflict (id) do update set id=excluded.id,display_name=excluded.display_name,updated_at=excluded.updated_at`,
            [A, "Legacy A"],
          ),
        );
        assert.equal((await account(db)).profile_revision, 1);
        await rejectCode(
          asUser(db, A, () =>
            q(db, "update public.profiles set learning_data='{}' where id=$1", [
              A,
            ]),
          ),
          "42501",
        );
        await rejectCode(
          asUser(db, A, () =>
            q(
              db,
              "insert into public.profiles (id,display_name) values ($1,$2)",
              [B, "fake"],
            ),
          ),
          "42501",
        );
        await rejectCode(
          asUser(db, A, () =>
            q(db, "select public._wa_learning($1)", [empty()]),
          ),
          "42501",
        );
      },
    );
    await t.test(
      "first use requires a migration decision, not an incremental write",
      async () => {
        await rejectCode(
          patch(db, 0, [
            { op: "set", path: ["settings", "theme"], value: "light" },
          ]),
          "PT409",
          "not_initialized",
        );
        await replace(db, 0, data());
        const a = await account(db);
        assert.equal(a.data_revision, 1);
        assert.equal(a.data_initialized, true);
        assert.deepEqual(a.learning_data, data());
      },
    );
    await t.test(
      "whole import clears omitted datasets but preserves profile and avatar",
      async () => {
        await asUser(db, A, () =>
          q(db, "insert into storage.objects (bucket_id,name) values ($1,$2)", [
            "word-atlas-avatars",
            avatar,
          ]),
        );
        const saved = await profile(db, 1, " Custom A ", avatar);
        assert.equal(saved.display_name, "Custom A");
        const before = await account(db);
        await replace(db, 1, {
          settings: { ...settings, theme: "light" },
          datasets: { "word-atlas-open": progress() },
        });
        const after = await account(db);
        for (const field of [
          "id",
          "display_name",
          "avatar_path",
          "profile_revision",
          "updated_at",
        ])
          assert.deepEqual(after[field], before[field]);
        assert.deepEqual(Object.keys(after.learning_data.datasets), [
          "word-atlas-open",
        ]);
        assert.equal(after.data_revision, 2);
        assert.equal(after.learning_data.settings.theme, "light");
      },
    );
    await t.test(
      "stale profile/import/patch revisions fail without changing either domain",
      async () => {
        const before = await account(db);
        await rejectCode(
          profile(db, 0, "Wrong"),
          "PT409",
          "profile_revision_conflict",
        );
        await rejectCode(
          replace(db, 1, empty()),
          "PT409",
          "data_revision_conflict",
        );
        await rejectCode(
          patch(db, 1, [
            { op: "set", path: ["settings", "theme"], value: "dark" },
          ]),
          "PT409",
          "data_revision_conflict",
        );
        assert.deepEqual(await account(db), before);
      },
    );
    await t.test(
      "incremental absolute updates preserve other fields and session grading",
      async () => {
        const before = await account(db);
        const sess = progress().session;
        const changes = [
          {
            op: "set",
            path: ["datasets", "word-atlas-open", "cards", "pear"],
            value: card,
          },
          {
            op: "set",
            path: ["datasets", "word-atlas-open", "days", "2026-10-28"],
            value: { n: 1, r: 1, c: 0, t: 5 },
          },
          { op: "set", path: ["settings", "theme"], value: "dark" },
          {
            op: "set",
            path: ["datasets", "word-atlas-open", "session"],
            value: sess,
          },
        ];
        const result = await patch(db, before.data_revision, changes);
        assert.equal(result.data_revision, 3);
        const after = await account(db);
        assert.equal(after.profile_revision, before.profile_revision);
        assert.deepEqual(
          after.learning_data.datasets["word-atlas-open"].session,
          sess,
        );
        assert.deepEqual(
          after.learning_data.datasets["word-atlas-open"].cards.pear,
          card,
        );
        // Lost network response + identical retry never applies counts twice.
        await rejectCode(patch(db, 2, changes), "PT409");
        await patch(db, 3, changes);
        assert.deepEqual(await account(db), after);
      },
    );
    await t.test(
      "a multi-operation validation error rolls back all changes",
      async () => {
        const before = await account(db);
        await rejectCode(
          patch(db, before.data_revision, [
            { op: "set", path: ["settings", "theme"], value: "light" },
            { op: "set", path: ["display_name"], value: "Bad" },
          ]),
          "PT422",
        );
        assert.deepEqual(await account(db), before);
        await rejectCode(
          asUser(db, A, async () => {
            await q(db, "select public.replace_my_learning_data($1,$2)", [
              before.data_revision,
              empty(),
            ]);
            await q(db, "select 1/0");
          }),
          "22012",
        );
        assert.deepEqual(await account(db), before);
      },
    );
    await t.test(
      "malformed tasks, null enums, impossible dates and hidden identity fields fail atomically",
      async () => {
        const mutations = [
          (d) => {
            d.settings.theme = null;
          },
          (d) => {
            d.settings.atlasView = null;
          },
          (d) => {
            delete d.settings.splash;
          },
          (d) => {
            d.settings.autoplay = "yes";
          },
          (d) => {
            d.settings.dailyNew = 1.5;
          },
          (d) => {
            d.auth = { token: "forbidden" };
          },
          (d) => {
            d.datasets["word-atlas-open"].datasetId = null;
          },
          (d) => {
            d.datasets["word-atlas-open"].days["2026-02-31"] = {
              n: 0,
              r: 0,
              c: 0,
              t: 0,
            };
          },
          (d) => {
            d.datasets["word-atlas-open"].session.index = 100;
          },
          (d) => {
            d.datasets["word-atlas-open"].session.steps[0].kind = null;
          },
          (d) => {
            d.datasets["word-atlas-open"].session.graded.apple = 9;
          },
          (d) => {
            d.datasets["word-atlas-open"].session.graded.missing = 3;
          },
          (d) => {
            d.datasets["word-atlas-open"].session.pending.correct = "yes";
          },
          (d) => {
            d.datasets["word-atlas-open"].session.graded = {};
          },
          (d) => {
            d.datasets["word-atlas-open"].session.finished = 1720000000000;
          },
          (d) => {
            d.datasets["word-atlas-open"].session.steps[0].options = [
              "__proto__",
            ];
          },
          (d) => {
            d.datasets["word-atlas-open"].typing = [
              { at: 1, mode: null, items: 1, wpm: 1, accuracy: 100 },
            ];
          },
          (d) => {
            d.datasets["word-atlas-open"].cards.apple.reps = -1;
          },
          (d) => {
            d.datasets["word-atlas-open"].cards.apple.due =
              Number.MAX_SAFE_INTEGER + 1;
          },
        ];
        const before = await account(db);
        for (const mutate of mutations) {
          const bad = data();
          mutate(bad);
          await rejectCode(replace(db, before.data_revision, bad), "PT422");
        }
        assert.deepEqual(await account(db), before);
      },
    );
    await t.test(
      "patch whitelist rejects profile, prototype, missing-parent and invalid removal paths",
      async () => {
        const before = await account(db);
        for (const change of [
          { op: "set", path: ["settings", "display_name"], value: "Bad" },
          {
            op: "set",
            path: ["datasets", "__proto__"],
            value: blank("__proto__"),
          },
          { op: "set", path: ["datasets", "absent", "session"], value: null },
          {
            op: "set",
            path: ["datasets", "word-atlas-open", "version"],
            value: 9,
          },
          {
            op: "set",
            path: ["datasets", "word-atlas-open", "days", "2026-02-31"],
            value: { n: 0, r: 0, c: 0, t: 0 },
          },
          { op: "remove", path: ["settings", "theme"] },
          { op: "set", path: ["settings", "theme"] },
          { op: "remove", path: ["datasets", "word-atlas-open"], value: null },
          { op: null, path: [] },
          { op: "set", path: ["settings", null], value: "dark" },
        ])
          await rejectCode(patch(db, before.data_revision, [change]), "PT422");
        assert.deepEqual(await account(db), before);
      },
    );
    await t.test(
      "legitimate word keys constructor and prototype remain valid",
      async () => {
        const d = data();
        d.datasets["word-atlas-open"].cards.constructor = card;
        d.datasets["word-atlas-open"].cards.prototype = card;
        const before = await account(db);
        await replace(db, before.data_revision, d);
        assert.deepEqual(
          (await account(db)).learning_data.datasets["word-atlas-open"].cards
            .constructor,
          card,
        );
      },
    );
    await t.test(
      "profile writes validate length, owned object paths, reset and independent revisions",
      async () => {
        const before = await account(db);
        await rejectCode(
          profile(db, before.profile_revision, "x".repeat(61)),
          "PT422",
        );
        await rejectCode(
          profile(
            db,
            before.profile_revision,
            "Name",
            `${B}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`,
          ),
          "PT422",
        );
        await rejectCode(
          profile(
            db,
            before.profile_revision,
            "Name",
            `${A}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`,
          ),
          "PT422",
        );
        await profile(db, before.profile_revision, "Google restored", null);
        const after = await account(db);
        assert.equal(after.avatar_path, null);
        assert.deepEqual(after.learning_data, before.learning_data);
        assert.equal(after.data_revision, before.data_revision);
      },
    );
    await t.test(
      "private avatars resist other users, anonymous reads and broad storage policies",
      async () => {
        assert.equal(
          (
            await q(
              db,
              "select public from storage.buckets where id='word-atlas-avatars'",
            )
          )[0].public,
          false,
        );
        assert.equal(
          (await asUser(db, A, () => q(db, "select name from storage.objects")))
            .length,
          1,
        );
        assert.deepEqual(
          await asUser(db, B, () => q(db, "select name from storage.objects")),
          [],
        );
        assert.deepEqual(
          await asUser(
            db,
            null,
            () => q(db, "select name from storage.objects"),
            "anon",
          ),
          [],
        );
        await rejectCode(
          asUser(db, B, () =>
            q(
              db,
              "insert into storage.objects (bucket_id,name) values ($1,$2)",
              [
                "word-atlas-avatars",
                `${A}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`,
              ],
            ),
          ),
          "42501",
        );
        await rejectCode(
          asUser(db, A, () =>
            q(
              db,
              "insert into storage.objects (bucket_id,name) values ($1,$2)",
              ["word-atlas-avatars", `${A}/../bad.webp`],
            ),
          ),
          "42501",
        );
        assert.deepEqual(
          await asUser(db, B, () =>
            q(db, "delete from storage.objects returning name"),
          ),
          [],
        );
        assert.deepEqual(
          await asUser(db, B, () =>
            q(db, "update storage.objects set name=$1 returning name", [
              `${B}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`,
            ]),
          ),
          [],
        );
      },
    );
    await t.test(
      "migration reruns without changing existing profile or learning data",
      async () => {
        const before = await account(db);
        await db.exec(migration);
        assert.deepEqual(await account(db), before);
      },
    );
    await t.test(
      "operator SQL executes all four RPCs and rolls back an actual account probe",
      async () => {
        const before = await account(db);
        const messages = [];
        const code = await runAccountBackend({
          args: [
            "verify",
            "--project-ref=abcdefghijklmnopqrst",
            `--verify-user-id=${A}`,
          ],
          env: { SUPABASE_ACCESS_TOKEN: "local-test-only" },
          log: (m) => messages.push(m),
          request: async (url, options) => {
            const results = await db.exec(JSON.parse(options.body).query);
            return new Response(JSON.stringify(results.at(-1)?.rows ?? []), {
              status: 200,
            });
          },
        });
        assert.equal(code, 0);
        assert.deepEqual(await account(db), before);
        assert.match(messages[0], /all probe writes rolled back/);
      },
    );
    await t.test(
      "contract lockdown removes legacy writes and leaves RPCs operational",
      async () => {
        await db.exec(lockdown);
        await rejectCode(
          asUser(db, A, () =>
            q(db, "update public.profiles set display_name=$1 where id=$2", [
              "Blocked",
              A,
            ]),
          ),
          "42501",
        );
        const before = await account(db);
        const saved = await profile(db, before.profile_revision, "RPC only");
        assert.equal(saved.display_name, "RPC only");
        await rejectCode(
          asUser(db, A, () =>
            q(
              db,
              "insert into public.profiles (id,display_name) values ($1,$2)",
              [A, "Blocked"],
            ),
          ),
          "42501",
        );
        await db.exec(migration);
        await rejectCode(
          asUser(db, A, () =>
            q(db, "update public.profiles set display_name=$1 where id=$2", [
              "Still blocked",
              A,
            ]),
          ),
          "42501",
        );
        assert.equal((await account(db)).display_name, "RPC only");
      },
    );
  } finally {
    await db.close();
  }
});

test("upgrade preserves the original production schema and nickname", async () => {
  const db = await bootstrap();
  try {
    await db.exec(original);
    await db.query(
      "insert into public.profiles (id,display_name) values ($1,$2)",
      [A, "Existing nickname"],
    );
    await db.exec(migration);
    assert.equal((await account(db)).display_name, "Existing nickname");
  } finally {
    await db.close();
  }
});

test("incompatible existing data aborts the entire migration without partial DDL", async () => {
  const db = await bootstrap();
  try {
    await db.exec(
      "create table public.profiles (id uuid primary key, display_name text, updated_at timestamptz default now())",
    );
    await db.query(
      "insert into public.profiles (id,display_name) values ($1,$2)",
      [A, "x".repeat(61)],
    );
    await assert.rejects(db.exec(migration), /incompatible_profile_data/);
    await db.exec("rollback");
    assert.equal(
      (await q(db, "select display_name from public.profiles"))[0].display_name
        .length,
      61,
    );
    assert.deepEqual(
      await q(
        db,
        "select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='learning_data'",
      ),
      [],
    );
  } finally {
    await db.close();
  }
});

test("disabled managed Storage RLS aborts migration instead of altering platform ownership", async () => {
  const db = await bootstrap();
  try {
    await db.exec("alter table storage.objects disable row level security");
    await assert.rejects(db.exec(migration), /storage_rls_disabled/);
    await db.exec("rollback");
    assert.equal(
      (await q(db, "select to_regclass('public.profiles') as relation"))[0]
        .relation,
      null,
    );
  } finally {
    await db.close();
  }
});
