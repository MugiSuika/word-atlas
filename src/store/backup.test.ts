import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBackup, serializeBackup } from "./backup";
import { emptyLearning, emptyProgress, validLearning } from "./model";
import { learningChanges } from "./changes";
const task = () => ({
  id: "s123",
  started: 123,
  steps: [{ id: "apple", kind: "spell" as const }],
  index: 0,
  graded: { apple: 3 as const },
  newIds: ["apple"],
  reviewIds: [],
  pending: { correct: true, value: "apple" },
});
function sample() {
  const d = emptyLearning();
  d.datasets.open = {
    ...emptyProgress("open"),
    bookmarks: ["apple"],
    session: task(),
  };
  d.datasets.private = emptyProgress("private");
  return d;
}
test("v3 preserves every dataset, setting and unfinished task while excluding profile/auth", () => {
  const d = sample();
  d.settings.atlasView = "list";
  const v = parseBackup(serializeBackup(d));
  assert.deepEqual(v.data, d);
  assert.equal(v.summary.sessions, 1);
  assert.deepEqual(v.summary.datasets, ["open", "private"]);
  assert.equal(v.legacy, false);
  const raw = JSON.parse(serializeBackup(d));
  assert.deepEqual(Object.keys(raw), ["app", "version", "exported", "data"]);
});
test("v2 converts one full dataset without inventing omitted datasets", () => {
  const d = sample(),
    settings = { ...d.settings } as Record<string, unknown>;
  delete settings.atlasView;
  const v = parseBackup(
    JSON.stringify({
      app: "word-atlas",
      version: 2,
      exported: new Date().toISOString(),
      progress: d.datasets.open,
      settings,
    }),
  );
  assert.equal(v.legacy, true);
  assert.deepEqual(Object.keys(v.data.datasets), ["open"]);
  assert.equal(v.data.settings.atlasView, "grid");
  assert.deepEqual(v.data.datasets.open.session, task());
});
test("invalid backup parsing is non-mutating and rejects task corruption or hidden fields", () => {
  const d = sample();
  const before = JSON.stringify(d);
  for (const mutate of [
    (v: any) => (v.data.datasets.open.session.index = 20),
    (v: any) => (v.data.datasets.open.session.graded = {}),
    (v: any) => (v.data.datasets.open.session.steps[0].kind = null),
    (v: any) => (v.data.settings.theme = null),
    (v: any) =>
      (v.data.datasets.open.days["2026-02-31"] = { n: 0, r: 0, c: 0, t: 0 }),
    (v: any) => (v.profile = { display_name: "must not import" }),
    (v: any) => (v.data.token = "must not import"),
  ]) {
    const v = JSON.parse(serializeBackup(d));
    mutate(v);
    assert.throws(() => parseBackup(JSON.stringify(v)));
  }
  assert.equal(JSON.stringify(d), before);
});
test("incremental changes address individual cards/days/settings and absolute session state", () => {
  const a = sample(),
    b = structuredClone(a);
  b.settings.theme = "light";
  b.datasets.open.days["2026-10-27"] = { n: 1, r: 1, c: 1, t: 12 };
  b.datasets.open.session = null;
  delete b.datasets.private;
  const delta = learningChanges(a, b);
  assert.deepEqual(
    delta.map((c) => c.path),
    [
      ["settings", "theme"],
      ["datasets", "private"],
      ["datasets", "open", "days", "2026-10-27"],
      ["datasets", "open", "session"],
    ],
  );
  assert.equal(delta[2].op, "set");
  assert.deepEqual(learningChanges(b, structuredClone(b)), []);
});
test("prototype-shaped unsafe IDs are rejected but ordinary word names remain valid", () => {
  const d = sample();
  d.datasets.open.bookmarks = ["constructor", "prototype"];
  assert.equal(validLearning(d), true);
  d.datasets.open.bookmarks = ["__proto__"];
  assert.equal(validLearning(d), false);
});

test("v2 settings are validated before conversion, rather than silently dropping invalid values", () => {
  const d = sample();
  const v = {
    app: "word-atlas",
    version: 2,
    exported: new Date().toISOString(),
    progress: d.datasets.open,
    settings: { ...d.settings, theme: "invalid" },
  };
  assert.throws(() => parseBackup(JSON.stringify(v)));
  assert.equal(d.settings.theme, "dark");
});

test("optional in-memory session fields serialize consistently with the database JSON contract", () => {
  const d = sample();
  const s = d.datasets.open.session!;
  s.finished = undefined;
  s.steps[0] = { id: "apple", kind: "spell", options: undefined };
  assert.equal(validLearning(d), true);
  const restored = parseBackup(serializeBackup(d));
  assert.deepEqual(restored.data.datasets.open.session, task());
  assert.equal(
    Object.hasOwn(restored.data.datasets.open.session!, "finished"),
    false,
  );
});
