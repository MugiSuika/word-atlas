import type { Accent } from "../atlas/types";
import type { CardState, Grade } from "./srs";
export type QuizKind = "meaning" | "picture" | "listen" | "spell";
export type Step =
  | { id: string; kind: "intro" }
  | { id: string; kind: QuizKind; retry?: boolean; options?: string[] };

export interface ActiveSession {
  id: string;
  started: number;
  steps: Step[];
  index: number;
  /** First-attempt grade per word; retries never change it. */
  graded: Record<string, Grade>;
  newIds: string[];
  reviewIds: string[];
  /** Answer shown but not yet continued; survives reload without double counting. */
  pending?: { correct: boolean; value: string };
  finished?: number;
}

export interface DayStat {
  n: number; // new words met
  r: number; // graded reviews (first attempts)
  c: number; // correct first attempts
  t: number; // active seconds
}

export interface TypingRound {
  at: number;
  mode: "word" | "sentence" | "dictation";
  items: number;
  wpm: number;
  accuracy: number;
}

export interface Progress {
  version: 2;
  datasetId: string;
  cards: Record<string, CardState>;
  bookmarks: string[];
  days: Record<string, DayStat>;
  typing: TypingRound[];
  session: ActiveSession | null;
  /** Rolling list of recent mistakes, newest first. */
  mistakes: string[];
}

export interface Settings {
  accent: Accent;
  autoplay: boolean;
  dailyNew: number;
  retention: number;
  theme: "system" | "light" | "dark";
  sfx: boolean;
  spell: boolean;
  startLevel: number;
  onboarded: boolean;
  dataset: "open" | "private";
  ambience:
    "off" | "stars" | "rain" | "sea" | "forest" | "fire" | "voyage" | "cafe";
  ambienceVolume: number;
  splash: boolean;
  atlasView: "grid" | "list" | "galaxy";
}

export const defaultSettings: Settings = {
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

export const emptyProgress = (datasetId: string): Progress => ({
  version: 2,
  datasetId,
  cards: {},
  bookmarks: [],
  days: {},
  typing: [],
  session: null,
  mistakes: [],
});

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- validation (backups and stored data are untrusted) ---------- */

export const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo = -Infinity, hi = Infinity) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

export function validCard(v: unknown): v is CardState {
  return (
    isObj(v) &&
    num(v.due, 0) &&
    num(v.s, 0) &&
    num(v.d, 0, 11) &&
    num(v.el, 0) &&
    num(v.sd, 0) &&
    num(v.ls, 0) &&
    num(v.reps, 0) &&
    num(v.lapses, 0) &&
    [0, 1, 2, 3].includes(v.st as number) &&
    (v.last === undefined || num(v.last, 0)) &&
    num(v.seen, 0)
  );
}

export function sanitizeProgress(v: unknown, datasetId: string): Progress {
  const out = emptyProgress(datasetId);
  if (!isObj(v) || v.version !== 2) return out;
  if (isObj(v.cards))
    for (const [k, c] of Object.entries(v.cards))
      if (validId(k) && validCard(c)) out.cards[k] = c;
  if (Array.isArray(v.bookmarks))
    out.bookmarks = v.bookmarks
      .filter((x): x is string => typeof x === "string" && validId(x))
      .slice(0, 20000);
  if (Array.isArray(v.mistakes))
    out.mistakes = v.mistakes
      .filter((x): x is string => typeof x === "string" && validId(x))
      .slice(0, 300);
  if (isObj(v.days))
    for (const [k, d] of Object.entries(v.days))
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(k) &&
        isObj(d) &&
        num(d.n, 0) &&
        num(d.r, 0) &&
        num(d.c, 0) &&
        num(d.t, 0)
      )
        out.days[k] = {
          n: d.n as number,
          r: d.r as number,
          c: d.c as number,
          t: d.t as number,
        };
  if (Array.isArray(v.typing))
    out.typing = v.typing
      .filter(
        (t): t is TypingRound =>
          isObj(t) &&
          num(t.at, 0) &&
          ["word", "sentence", "dictation"].includes(t.mode as string) &&
          num(t.items, 0) &&
          num(t.wpm, 0, 400) &&
          num(t.accuracy, 0, 100),
      )
      .slice(-500);
  const s = v.session;
  if (validSession(s)) out.session = s as unknown as ActiveSession;
  return out;
}

export function sanitizeSettings(v: unknown): Settings {
  const s = { ...defaultSettings };
  if (!isObj(v)) return s;
  if (v.accent === "uk" || v.accent === "us") s.accent = v.accent;
  if (typeof v.autoplay === "boolean") s.autoplay = v.autoplay;
  if (num(v.dailyNew, 0, 100)) s.dailyNew = Math.round(v.dailyNew as number);
  if (num(v.retention, 0.7, 0.97)) s.retention = v.retention as number;
  if (v.theme === "system" || v.theme === "light" || v.theme === "dark")
    s.theme = v.theme;
  if (typeof v.sfx === "boolean") s.sfx = v.sfx;
  if (typeof v.spell === "boolean") s.spell = v.spell;
  if (num(v.startLevel, 0, 5))
    s.startLevel = Math.round(v.startLevel as number);
  if (typeof v.onboarded === "boolean") s.onboarded = v.onboarded;
  if (v.dataset === "open" || v.dataset === "private") s.dataset = v.dataset;
  if (
    [
      "off",
      "stars",
      "rain",
      "sea",
      "forest",
      "fire",
      "voyage",
      "cafe",
    ].includes(v.ambience as string)
  )
    s.ambience = v.ambience as Settings["ambience"];
  if (num(v.ambienceVolume, 0, 1))
    s.ambienceVolume = v.ambienceVolume as number;
  if (typeof v.splash === "boolean") s.splash = v.splash;
  if (["grid", "list", "galaxy"].includes(v.atlasView as string))
    s.atlasView = v.atlasView as Settings["atlasView"];
  return s;
}

export interface LearningData {
  settings: Settings;
  datasets: Record<string, Progress>;
}
export const emptyLearning = (): LearningData => ({
  settings: { ...defaultSettings },
  datasets: {},
});
export const MAX_BACKUP_BYTES = 30 * 1024 * 1024;
export const validId = (x: unknown): x is string =>
  typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(x);
const keys = (v: unknown, allowed: string[]): v is Record<string, unknown> =>
  isObj(v) && Object.keys(v).every((k) => allowed.includes(k));
const required = (v: Record<string, unknown>, names: string[]) =>
  names.every((k) => Object.hasOwn(v, k));
const int = (v: unknown, hi = Number.MAX_SAFE_INTEGER) =>
  num(v, 0, hi) && Number.isInteger(v);
const ids = (v: unknown, max = 20000): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every(validId);
export function validDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith("0000")) return false;
  const date = new Date(`${v}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
  );
}
export function validSession(v: unknown): v is ActiveSession | null {
  if (v === null) return true;
  const names = [
    "id",
    "started",
    "steps",
    "index",
    "graded",
    "newIds",
    "reviewIds",
  ];
  if (
    !keys(v, [...names, "pending", "finished"]) ||
    !required(v, names) ||
    !validId(v.id) ||
    !num(v.started, 0, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(v.steps) ||
    !int(v.index, v.steps.length) ||
    !isObj(v.graded) ||
    !ids(v.newIds) ||
    !ids(v.reviewIds)
  )
    return false;
  const wordIds = new Set<string>();
  for (const step of v.steps) {
    if (
      !keys(step, ["id", "kind", "retry", "options"]) ||
      !required(step, ["id", "kind"]) ||
      !validId(step.id) ||
      !["intro", "meaning", "picture", "listen", "spell"].includes(
        step.kind as string,
      ) ||
      (step.retry !== undefined &&
        (typeof step.retry !== "boolean" || step.kind === "intro")) ||
      (step.options !== undefined && !ids(step.options))
    )
      return false;
    wordIds.add(step.id);
  }
  if (
    !Object.entries(v.graded).every(
      ([id, grade]) =>
        validId(id) &&
        wordIds.has(id) &&
        num(grade, 1, 4) &&
        Number.isInteger(grade),
    )
  )
    return false;
  const at = v.index as number;
  if (v.pending !== undefined) {
    const p = v.pending,
      step = v.steps[at];
    if (
      !keys(p, ["correct", "value"]) ||
      !required(p, ["correct", "value"]) ||
      typeof p.correct !== "boolean" ||
      typeof p.value !== "string" ||
      !step ||
      step.kind === "intro" ||
      !Object.hasOwn(v.graded, step.id)
    )
      return false;
  }
  if (
    v.finished !== undefined &&
    (!num(v.finished, 0, Number.MAX_SAFE_INTEGER) ||
      at !== v.steps.length ||
      v.pending !== undefined)
  )
    return false;
  return true;
}
export function validSettings(v: unknown): v is Settings {
  const names = Object.keys(defaultSettings);
  if (!keys(v, names) || !required(v, names)) return false;
  if (
    !["autoplay", "sfx", "spell", "onboarded", "splash"].every(
      (k) => typeof v[k] === "boolean",
    )
  )
    return false;
  return (
    ["uk", "us"].includes(v.accent as string) &&
    ["system", "light", "dark"].includes(v.theme as string) &&
    ["open", "private"].includes(v.dataset as string) &&
    [
      "off",
      "stars",
      "rain",
      "sea",
      "forest",
      "fire",
      "voyage",
      "cafe",
    ].includes(v.ambience as string) &&
    ["grid", "list", "galaxy"].includes(v.atlasView as string) &&
    int(v.dailyNew, 100) &&
    int(v.startLevel, 5) &&
    num(v.retention, 0.7, 0.97) &&
    num(v.ambienceVolume, 0, 1)
  );
}
export function validProgress(v: unknown, id: string): v is Progress {
  const names = [
    "version",
    "datasetId",
    "cards",
    "bookmarks",
    "days",
    "typing",
    "session",
    "mistakes",
  ];
  if (
    !validId(id) ||
    !keys(v, names) ||
    !required(v, names) ||
    v.version !== 2 ||
    v.datasetId !== id ||
    !isObj(v.cards) ||
    !isObj(v.days) ||
    !ids(v.bookmarks) ||
    !ids(v.mistakes, 300) ||
    !Array.isArray(v.typing) ||
    v.typing.length > 500 ||
    !validSession(v.session)
  )
    return false;
  if (
    !Object.entries(v.cards).every(
      ([id, c]) =>
        validId(id) &&
        keys(c, [
          "due",
          "s",
          "d",
          "el",
          "sd",
          "ls",
          "reps",
          "lapses",
          "st",
          "last",
          "seen",
        ]) &&
        validCard(c) &&
        [c.due, c.s, c.el, c.sd, c.seen, c.last ?? 0].every((n) =>
          num(n, 0, Number.MAX_SAFE_INTEGER),
        ) &&
        [c.ls, c.reps, c.lapses].every((n) => int(n)),
    )
  )
    return false;
  if (
    !Object.entries(v.days).every(
      ([date, d]) =>
        validDate(date) &&
        keys(d, ["n", "r", "c", "t"]) &&
        required(d, ["n", "r", "c", "t"]) &&
        [d.n, d.r, d.c, d.t].every((n) => int(n)) &&
        Number(d.n) <= Number(d.r) &&
        Number(d.c) <= Number(d.r),
    )
  )
    return false;
  return v.typing.every(
    (t) =>
      keys(t, ["at", "mode", "items", "wpm", "accuracy"]) &&
      required(t, ["at", "mode", "items", "wpm", "accuracy"]) &&
      num(t.at, 0, Number.MAX_SAFE_INTEGER) &&
      ["word", "sentence", "dictation"].includes(t.mode as string) &&
      int(t.items) &&
      num(t.wpm, 0, 400) &&
      num(t.accuracy, 0, 100),
  );
}
export function validLearning(v: unknown): v is LearningData {
  return (
    keys(v, ["settings", "datasets"]) &&
    required(v, ["settings", "datasets"]) &&
    validSettings(v.settings) &&
    isObj(v.datasets) &&
    Object.entries(v.datasets).every(([id, p]) => validProgress(p, id))
  );
}
export function summarize(data: LearningData) {
  const all = Object.values(data.datasets);
  return {
    datasets: Object.keys(data.datasets),
    cards: all.reduce((n, p) => n + Object.keys(p.cards).length, 0),
    bookmarks: all.reduce((n, p) => n + p.bookmarks.length, 0),
    reviews: all.reduce(
      (n, p) => n + Object.values(p.days).reduce((s, d) => s + d.r, 0),
      0,
    ),
    sessions: all.filter((p) => p.session && !p.session.finished).length,
  };
}
