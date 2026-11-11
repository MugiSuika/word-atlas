import assert from "node:assert/strict";
import { test } from "node:test";
import type { Atlas, WordRef } from "../atlas/types";
import {
  dayKey,
  defaultSettings,
  emptyProgress,
  type ActiveSession,
  type Progress,
  type Settings,
} from "./model";
import type { CardState } from "./srs";
import { alignSession, buildSession, sessionMatchesLevel } from "./session";

function atlas(rows: [string, number][]): Atlas {
  const words: WordRef[] = rows.map(([id, cefr], order) => ({
    id,
    word: id,
    zh: `${id} 义`,
    ipa: "",
    cefr,
    topic: 0,
    media: 0,
    order,
  }));
  return {
    id: "word-atlas-open",
    name: "test",
    kind: "open",
    count: words.length,
    examples: 0,
    illustrated: 0,
    topics: [],
    cefr: ["A1", "A2", "B1", "B2", "C1", "C2"],
    words,
    byId: new Map(words.map((word) => [word.id, word])),
    entry: async () => {
      throw new Error("unused");
    },
    peek: () => undefined,
    img: () => null,
    audio: () => null,
  };
}

const words = atlas([
  ["a1", 0],
  ["a2", 0],
  ["b1", 2],
  ["b2", 2],
  ["due", 4],
]);

function settings(startLevel: number, dailyNew = 2): Settings {
  return { ...defaultSettings, startLevel, dailyNew, onboarded: true };
}

function progress(session: ActiveSession | null = null, extra: Partial<Progress> = {}): Progress {
  return { ...emptyProgress("word-atlas-open"), session, ...extra };
}

const card: CardState = {
  due: Date.now() + 86_400_000,
  s: 1,
  d: 5,
  el: 0,
  sd: 1,
  ls: 0,
  reps: 1,
  lapses: 0,
  st: 1,
  seen: 1,
};

test("a journey built at B1 is replaced by A1 words when the level changes", () => {
  const b1 = settings(2);
  const started = progress(buildSession(words, progress(), b1));
  assert.deepEqual(started.session?.newIds, ["b1", "b2"]);
  assert.equal(sessionMatchesLevel(words, started, b1, started.session!), true);

  const a1 = settings(0);
  assert.equal(sessionMatchesLevel(words, started, a1, started.session!), false);
  const next = alignSession(words, started, a1);
  assert.notEqual(next, started);
  assert.deepEqual(next.session?.newIds, ["a1", "a2"]);
  assert.equal(next.session?.id === started.session?.id, false);
  assert.equal(sessionMatchesLevel(words, next, a1, next.session!), true);
  assert.equal(alignSession(words, next, a1), next);
});

test("raising the level replaces an in-progress A1 journey with B1 words", () => {
  const started = progress(buildSession(words, progress(), settings(0)));
  assert.deepEqual(started.session?.newIds, ["a1", "a2"]);
  const next = alignSession(words, started, settings(2));
  assert.deepEqual(next.session?.newIds, ["b1", "b2"]);
});

test("a matching journey is kept, including when lower levels are already learned", () => {
  const learned = progress(null, { cards: { a1: card, a2: card } });
  const started = progress(
    buildSession(words, learned, settings(0)),
    { cards: learned.cards },
  );
  assert.deepEqual(started.session?.newIds, ["b1", "b2"]);
  assert.equal(sessionMatchesLevel(words, started, settings(0), started.session!), true);
  assert.equal(alignSession(words, started, settings(0)), started);
  assert.equal(alignSession(words, started, settings(2)), started);
});

test("answered words stay saved and the new level still fills today's quota", () => {
  const started = progress(buildSession(words, progress(), settings(2)));
  const answered = progress(started.session, {
    cards: { b1: card, b2: card },
    days: { [dayKey()]: { n: 2, r: 2, c: 2, t: 10 } },
  });
  const next = alignSession(words, answered, settings(0));
  assert.equal(next.cards.b1, card);
  assert.equal(next.cards.b2, card);
  assert.deepEqual(next.session?.newIds, ["a1", "a2"]);
  assert.equal(sessionMatchesLevel(words, next, settings(0), next.session!), true);
});

test("review-only and finished journeys are not rebuilt", () => {
  const reviews = buildSession(words, progress(), settings(2), { reviewOnly: true });
  const reviewProgress = progress(reviews, {
    cards: { due: { ...card, due: 0 } },
  });
  const rebuilt = buildSession(words, reviewProgress, settings(2), {
    reviewOnly: true,
  });
  const saved = progress(rebuilt);
  assert.deepEqual(saved.session?.newIds, []);
  assert.ok(saved.session?.reviewIds.includes("due"));
  assert.equal(alignSession(words, saved, settings(0)), saved);

  const finished = progress({ ...rebuilt, finished: Date.now() });
  assert.equal(alignSession(words, finished, settings(0)), finished);
});
