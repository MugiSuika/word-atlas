import { useSyncExternalStore } from "react";
import {
  defaultSettings,
  emptyLearning,
  emptyProgress,
  sanitizeProgress,
  sanitizeSettings,
  validId,
  dayKey,
  type DayStat,
  type LearningData,
  type Progress,
  type Settings,
} from "./model";
import { serializeBackup } from "./backup";
export * from "./model";
const SETTINGS_KEY = "word-atlas:settings";
const progressKey = (id: string) => `word-atlas:v2:${id}`;
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function readGuest(): LearningData {
  const data = emptyLearning();
  data.settings = sanitizeSettings(read(SETTINGS_KEY));
  try {
    if (!isViewStored()) {
      const view = localStorage.getItem("word-atlas:view");
      if (view === "grid" || view === "list" || view === "galaxy")
        data.settings.atlasView = view;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("word-atlas:v2:")) {
        const id = key.slice("word-atlas:v2:".length);
        if (validId(id)) data.datasets[id] = sanitizeProgress(read(key), id);
      }
    }
  } catch {
    /* SSR or unavailable browser storage */
  }
  return data;
}
function isViewStored() {
  const v = read(SETTINGS_KEY);
  return !!v && typeof v === "object" && "atlasView" in v;
}
interface State {
  progress: Progress;
  settings: Settings;
  saveError: boolean;
  locked: boolean;
  owner: string | null;
}
let data = readGuest();
let guest = data;
let state: State = {
  progress: emptyProgress("word-atlas-open"),
  settings: data.settings,
  saveError: false,
  locked: false,
  owner: null,
};
const listeners = new Set<() => void>();
const changes = new Set<(data: LearningData) => void>();
let dirty = false;
let legacyError = false,
  cacheError = false;
function updateSaveError() {
  const saveError = legacyError || cacheError;
  if (saveError !== state.saveError) {
    state = { ...state, saveError };
    emit();
  }
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const emit = () => listeners.forEach((f) => f());
function assign(next: LearningData) {
  // Word IDs such as constructor are ordinary keys, never inherited properties.
  Object.setPrototypeOf(next.datasets, null);
  for (const p of Object.values(next.datasets)) {
    Object.setPrototypeOf(p.cards, null);
    Object.setPrototypeOf(p.days, null);
    if (p.session) Object.setPrototypeOf(p.session.graded, null);
  }
  data = next;
  if (!state.owner) guest = next;
  state = {
    ...state,
    settings: next.settings,
    progress:
      next.datasets[state.progress.datasetId] ??
      emptyProgress(state.progress.datasetId),
  };
  emit();
}
function changed(next: LearningData) {
  assign(next);
  changes.forEach((f) => f(next));
  if (!state.owner) {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }
}
export function flush() {
  clearTimeout(saveTimer);
  if (!dirty || state.owner) return;
  dirty = false;
  try {
    // IndexedDB is authoritative after a transactional import; these preserve legacy guest compatibility.
    const keep = new Set(Object.keys(data.datasets).map(progressKey));
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("word-atlas:v2:") && !keep.has(k)) remove.push(k);
    }
    for (const k of remove) localStorage.removeItem(k);
    for (const [id, p] of Object.entries(data.datasets))
      localStorage.setItem(progressKey(id), JSON.stringify(p));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.settings));
    legacyError = false;
    updateSaveError();
  } catch {
    legacyError = true;
    updateSaveError();
  }
}
export const store = {
  get: () => state,
  learning: () => data,
  guest: () => guest,
  subscribe(f: () => void) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  onChange(f: (data: LearningData) => void) {
    changes.add(f);
    return () => changes.delete(f);
  },
  useDataset(id: string) {
    if (validId(id)) {
      state = { ...state, progress: data.datasets[id] ?? emptyProgress(id) };
      emit();
    }
  },
  progress(fn: (p: Progress) => Progress) {
    if (!state.locked) {
      const p = fn(state.progress);
      if (p !== state.progress)
        changed({ ...data, datasets: { ...data.datasets, [p.datasetId]: p } });
    }
  },
  settings(patch: Partial<Settings>) {
    if (!state.locked)
      changed({ ...data, settings: { ...data.settings, ...patch } });
  },
  adopt(next: LearningData) {
    assign(next);
  },
  replace(next: LearningData) {
    assign(next);
    if (!state.owner) {
      dirty = true;
      flush();
    }
  },
  owner(uid: string | null) {
    flush();
    if (uid) legacyError = false;
    cacheError = false;
    state = { ...state, owner: uid, locked: !!uid, saveError: false };
    assign(uid ? emptyLearning() : guest);
  },
  lock(locked: boolean) {
    state = { ...state, locked };
    emit();
  },
  saveError(failed: boolean) {
    cacheError = failed;
    updateSaveError();
  },
};
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(state),
    () => select(state),
  );
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (
      state.owner ||
      state.locked ||
      !event.key ||
      !(event.key === SETTINGS_KEY || event.key.startsWith("word-atlas:v2:"))
    )
      return;
    const incoming = readGuest();
    assign(incoming);
    changes.forEach((fn) => fn(incoming));
  });
  window.addEventListener("pagehide", flush);
  document.addEventListener(
    "visibilitychange",
    () => document.visibilityState === "hidden" && flush(),
  );
}
export function bumpDay(p: Progress, patch: Partial<DayStat>): Progress {
  const k = dayKey(),
    d = p.days[k] ?? { n: 0, r: 0, c: 0, t: 0 };
  return {
    ...p,
    days: {
      ...p.days,
      [k]: {
        n: d.n + (patch.n ?? 0),
        r: d.r + (patch.r ?? 0),
        c: d.c + (patch.c ?? 0),
        t: d.t + (patch.t ?? 0),
      },
    },
  };
}
export function toggleBookmark(id: string) {
  store.progress((p) => ({
    ...p,
    bookmarks: p.bookmarks.includes(id)
      ? p.bookmarks.filter((x) => x !== id)
      : [id, ...p.bookmarks],
  }));
}
export function exportBackup() {
  return serializeBackup(data);
}
export function resetProgress() {
  store.progress((p) => emptyProgress(p.datasetId));
}
export { defaultSettings };
