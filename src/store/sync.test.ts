import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountSync, type LearningPort } from "./sync";
import {
  AccountError,
  type AccountApi,
  type CloudAccount,
} from "../auth/account-api";
import { emptyLearning, emptyProgress, type LearningData } from "./model";
import type { CachedLearning, LearningCache } from "./account-cache";
class Port implements LearningPort {
  data = emptyLearning();
  guestData = emptyLearning();
  uid: string | null = null;
  locked = false;
  error = false;
  listeners = new Set<(d: LearningData) => void>();
  learning = () => this.data;
  guest = () => this.guestData;
  owner(uid: string | null) {
    if (!this.uid) this.guestData = this.data;
    this.uid = uid;
    this.data = uid ? emptyLearning() : this.guestData;
    this.locked = !!uid;
  }
  adopt(d: LearningData) {
    this.data = d;
  }
  replace(d: LearningData) {
    this.data = d;
  }
  lock(v: boolean) {
    this.locked = v;
  }
  saveError(v: boolean) {
    this.error = v;
  }
  onChange(fn: (d: LearningData) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  edit(d: LearningData) {
    assert.equal(this.locked, false);
    this.data = d;
    for (const fn of this.listeners) fn(d);
  }
}
function fixture(initialized = true) {
  const p = new Port(),
    values = new Map<string, CachedLearning>(),
    events: string[] = [];
  let fail = false,
    online = true;
  const cache: LearningCache = {
    async read(uid) {
      return structuredClone(values.get(uid) ?? null);
    },
    async write(uid, d) {
      events.push(`cache:${uid}`);
      if (fail) throw new Error("disk full");
      values.set(uid, structuredClone(d));
    },
  };
  const cloud: CloudAccount = {
    id: "A",
    display_name: "Google A",
    avatar_path: null,
    profile_revision: 0,
    updated_at: new Date().toISOString(),
    learning_data: emptyLearning(),
    data_initialized: initialized,
    data_revision: 0,
    data_updated_at: new Date().toISOString(),
  };
  const api: AccountApi = {
    uid: "A",
    async read() {
      events.push("read");
      return structuredClone(cloud);
    },
    async patch(rev, changes) {
      events.push("patch");
      if (rev !== cloud.data_revision) throw new AccountError("PT409");
      const d = structuredClone(cloud.learning_data) as any;
      for (const change of changes) {
        let node = d;
        for (const k of change.path.slice(0, -1)) node = node[k];
        const last = change.path.at(-1)!;
        if (change.op === "set") node[last] = structuredClone(change.value);
        else delete node[last];
      }
      cloud.learning_data = d;
      cloud.data_revision++;
      return {
        data_revision: cloud.data_revision,
        data_updated_at: cloud.data_updated_at,
      };
    },
    async replace(rev, d) {
      events.push("replace");
      if (rev !== cloud.data_revision) throw new AccountError("PT409");
      cloud.learning_data = structuredClone(d);
      cloud.data_initialized = true;
      cloud.data_revision++;
      return {
        data_revision: cloud.data_revision,
        data_updated_at: cloud.data_updated_at,
      };
    },
    async saveProfile() {
      throw new Error("not used");
    },
    async upload() {},
    async remove() {},
    async avatar() {
      return "";
    },
  };
  const sync = new AccountSync(p, cache, () => online);
  return {
    p,
    sync,
    api,
    cloud,
    values,
    events,
    offline() {
      online = false;
      sync.offline();
    },
    online() {
      online = true;
    },
    failDisk(v: boolean) {
      fail = v;
    },
    async close() {
      await sync.connect(null);
    },
  };
}
const edited = (d: LearningData) => ({
  ...d,
  settings: { ...d.settings, theme: "light" as const },
});
test("initialized cloud wins over guest; first cloud initialization requires explicit migration", async () => {
  const f = fixture();
  f.p.data.datasets.guest = emptyProgress("guest");
  await f.sync.connect(f.api);
  assert.deepEqual(f.p.data.datasets, {});
  assert.ok(f.p.guestData.datasets.guest);
  await f.close();
  const first = fixture(false);
  first.p.data.datasets.guest = emptyProgress("guest");
  await first.sync.connect(first.api);
  assert.equal(first.sync.get().status, "migration");
  assert.equal(first.cloud.data_initialized, false);
  await first.sync.choose("local");
  assert.ok(first.cloud.learning_data.datasets.guest);
  assert.equal(first.sync.get().status, "synced");
  await first.close();
});
test("local edits persist by user before incremental upload, offline changes survive reconnect", async () => {
  const f = fixture();
  await f.sync.connect(f.api);
  f.offline();
  f.p.edit(edited(f.p.data));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.sync.get().status, "offline");
  assert.equal(f.values.get("user:A")?.dirty, true);
  assert.equal(f.cloud.learning_data.settings.theme, "dark");
  f.online();
  await f.sync.refresh();
  await f.sync.flush();
  assert.equal(f.cloud.learning_data.settings.theme, "light");
  assert.equal(f.sync.get().status, "synced");
  assert.ok(f.events.lastIndexOf("cache:user:A") > f.events.indexOf("patch"));
  await f.close();
});
test("conflict pauses upload and replacement requires a fresh cloud revision", async () => {
  const f = fixture();
  await f.sync.connect(f.api);
  f.p.edit(edited(f.p.data));
  f.cloud.data_revision++;
  f.cloud.learning_data.settings.dailyNew = 30;
  await f.sync.flush();
  assert.equal(f.sync.get().status, "conflict");
  assert.equal(f.cloud.learning_data.settings.theme, "dark");
  f.cloud.data_revision++;
  await f.sync.choose("local");
  assert.equal(f.sync.get().status, "conflict");
  assert.equal(f.cloud.learning_data.settings.theme, "dark");
  await f.sync.choose("local");
  assert.equal(f.cloud.learning_data.settings.theme, "light");
  await f.close();
});
test("a late account response cannot populate a switched account or cache", async () => {
  const f = fixture();
  let release!: (d: CloudAccount) => void;
  const wait = new Promise<CloudAccount>((r) => (release = r));
  const opening = f.sync.connect({ ...f.api, read: () => wait });
  await new Promise((r) => setTimeout(r, 0));
  const b = {
    ...f.api,
    uid: "B",
    read: async () => ({
      ...structuredClone(f.cloud),
      id: "B",
      display_name: "Google B",
    }),
  };
  await f.sync.connect(b);
  release(f.cloud);
  await opening;
  assert.equal(f.sync.get().uid, "B");
  assert.equal(f.sync.get().profile?.display_name, "Google B");
  assert.equal(f.values.has("user:A"), false);
  await f.close();
});
test("full import is atomic locally, clears all missing datasets, and preserves profile", async () => {
  const f = fixture();
  await f.sync.connect(f.api);
  const replacement = emptyLearning();
  replacement.datasets.one = emptyProgress("one");
  const beforeProfile = f.sync.get().profile;
  const permit = await f.sync.reserveImport();
  f.cloud.data_revision++;
  await assert.rejects(
    f.sync.import(replacement, permit),
    (e: any) => e.code === "PT409",
  );
  assert.deepEqual(f.p.data.datasets, {});
  const fresh = await f.sync.reserveImport();
  await f.sync.import(replacement, fresh);
  assert.deepEqual(Object.keys(f.p.data.datasets), ["one"]);
  assert.deepEqual(f.sync.get().profile, beforeProfile);
  f.sync.releaseImport();
  await f.close();
});
test("failed guest cache transaction does not partially replace local state", async () => {
  const f = fixture();
  await f.sync.connect(null);
  const permit = await f.sync.reserveImport(),
    before = f.p.data;
  f.failDisk(true);
  await assert.rejects(f.sync.import(edited(before), permit));
  assert.deepEqual(f.p.data, before);
  f.failDisk(false);
  f.sync.releaseImport();
  await f.close();
});

test("edits made during an upload remain pending and are sent in the following revision", async () => {
  const f = fixture();
  await f.sync.connect(f.api);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    waiting = new Promise<void>((r) => (started = r));
  const original = f.api.patch;
  let first = true;
  f.api.patch = async (...args) => {
    if (first) {
      first = false;
      started();
      await gate;
    }
    return original(...args);
  };
  f.p.edit(edited(f.p.data));
  const saving = f.sync.flush();
  await waiting;
  f.p.edit({ ...f.p.data, settings: { ...f.p.data.settings, dailyNew: 30 } });
  release();
  await saving;
  assert.equal(f.cloud.learning_data.settings.dailyNew, 10);
  await f.sync.flush();
  assert.equal(f.cloud.learning_data.settings.dailyNew, 30);
  await f.close();
});
test("a committed import with failed local cache remains locked until cloud recovery", async () => {
  const f = fixture();
  await f.sync.connect(f.api);
  const before = f.p.data,
    permit = await f.sync.reserveImport();
  f.failDisk(true);
  await assert.rejects(f.sync.import(edited(before), permit));
  assert.equal(f.cloud.learning_data.settings.theme, "light");
  assert.equal(f.p.data.settings.theme, "dark");
  assert.equal(f.p.locked, true);
  f.failDisk(false);
  await f.sync.refresh();
  assert.equal(f.p.data.settings.theme, "light");
  assert.equal(f.p.locked, false);
  f.sync.releaseImport();
  await f.close();
});
test("a failed offline write prevents upload until the cache is writable again", async () => {
  const f = fixture();
  await f.sync.connect(f.api);
  f.failDisk(true);
  f.p.edit(edited(f.p.data));
  await f.sync.flush();
  assert.equal(f.events.includes("patch"), false);
  assert.equal(f.cloud.learning_data.settings.theme, "dark");
  f.failDisk(false);
  await f.sync.refresh();
  await f.sync.flush();
  assert.equal(f.cloud.learning_data.settings.theme, "light");
  assert.equal(f.p.error, false);
  await f.close();
});
