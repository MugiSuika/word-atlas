import {
  AccountError,
  type AccountApi,
  type CloudAccount,
  type AccountProfile,
} from "../auth/account-api";
import type { CachedLearning, LearningCache } from "./account-cache";
import { learningChanges } from "./changes";
import { emptyLearning, summarize, type LearningData } from "./model";
export type SyncStatus =
  | "local"
  | "loading"
  | "syncing"
  | "synced"
  | "offline"
  | "error"
  | "migration"
  | "conflict";
export interface SyncState {
  uid: string | null;
  status: SyncStatus;
  profile: AccountProfile | null;
  cloud: CloudAccount | null;
  message: string;
  modifiedAt: string;
  revision: number;
}
export interface LearningPort {
  learning(): LearningData;
  guest(): LearningData;
  owner(uid: string | null): void;
  adopt(data: LearningData): void;
  replace(data: LearningData): void;
  lock(locked: boolean): void;
  saveError(failed: boolean): void;
  onChange(fn: (data: LearningData) => void): () => void;
}
export interface ImportPermit {
  uid: string | null;
  generation: number;
  revision: number;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const now = () => new Date().toISOString();
const docOf = (
  data: LearningData,
  revision = 0,
  base = data,
  dirty = false,
): CachedLearning => ({ data, base, revision, dirty, modifiedAt: now() });
export class AccountSync {
  private state: SyncState = {
    uid: null,
    status: "local",
    profile: null,
    cloud: null,
    message: "",
    modifiedAt: now(),
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private api: AccountApi | null = null;
  private doc: CachedLearning;
  private generation = 0;
  private abort = new AbortController();
  private disk: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | null = null;
  private paused = false;
  private loaded = false;
  private localSerial = 0;
  private unsubscribe: () => void;
  constructor(
    private port: LearningPort,
    private cache: LearningCache,
    private online = () => typeof navigator === "undefined" || navigator.onLine,
  ) {
    this.doc = docOf(port.learning());
    this.unsubscribe = port.onChange((data) => {
      this.localSerial++;
      this.doc = {
        ...this.doc,
        data,
        dirty: !!this.state.uid,
        modifiedAt: now(),
      };
      this.set({
        modifiedAt: this.doc.modifiedAt,
        ...(this.state.uid &&
        !["conflict", "migration", "loading"].includes(this.state.status)
          ? {
              status: this.online()
                ? ("syncing" as const)
                : ("offline" as const),
            }
          : {}),
      });
      void this.persist().then(
        () => this.schedule(),
        () => undefined,
      );
    });
  }
  dispose() {
    this.generation++;
    this.unsubscribe();
    this.abort.abort();
    clearTimeout(this.timer);
    this.listeners.clear();
  }
  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private current(g: number) {
    return g === this.generation;
  }
  private key() {
    return this.state.uid ? `user:${this.state.uid}` : "guest";
  }
  private persist(doc = this.doc) {
    const key = this.key(),
      g = this.generation;
    const task = this.disk
      .catch(() => undefined)
      .then(() => this.cache.write(key, doc));
    this.disk = task;
    task.then(
      () => {
        if (this.current(g)) this.port.saveError(false);
      },
      () => {
        if (this.current(g)) {
          this.port.saveError(true);
          this.set({
            status: "error",
            message: "无法保存离线缓存，请导出本机副本。",
          });
        }
      },
    );
    return task;
  }
  async connect(api: AccountApi | null) {
    if (this.loaded && api?.uid === this.api?.uid) {
      this.api = api;
      return;
    }
    const g = ++this.generation;
    this.abort.abort();
    this.abort = new AbortController();
    clearTimeout(this.timer);
    this.api = api;
    this.paused = false;
    this.flight = null;
    this.loaded = false;
    this.port.owner(api?.uid ?? null);
    this.doc = docOf(this.port.learning());
    this.set({
      uid: api?.uid ?? null,
      status: api ? "loading" : "local",
      profile: null,
      cloud: null,
      message: "",
      revision: 0,
      modifiedAt: now(),
    });
    const serial = this.localSerial;
    try {
      await this.disk.catch(() => undefined);
      const cached = await this.cache.read(this.key());
      if (!this.current(g)) return;
      if (cached && serial === this.localSerial) {
        const data = api
          ? cached.data
          : {
              ...cached.data,
              datasets: {
                ...this.port.guest().datasets,
                ...cached.data.datasets,
              },
            };
        this.doc = { ...cached, data };
        this.port.adopt(data);
      }
      this.loaded = true;
      if (!api) {
        this.port.lock(false);
        if (!cached) await this.persist();
        return;
      }
      if (cached) this.port.lock(false);
      if (!this.online()) {
        this.set({
          status: "offline",
          message: cached
            ? "离线修改将在联网后同步。"
            : "请联网后读取账号数据。",
        });
        return;
      }
      await this.refresh(g);
    } catch (error) {
      if (this.current(g)) this.fail(error);
    }
  }
  private fail(error: unknown) {
    this.set({
      status: this.online() ? "error" : "offline",
      message:
        error instanceof AccountError
          ? error.message
          : "同步未完成，本机记录已保留，请重试。",
    });
  }
  async refresh(g = this.generation) {
    const api = this.api;
    if (!api || !this.online()) {
      if (api) this.set({ status: "offline" });
      return;
    }
    if (this.flight) {
      await this.flight;
      if (!this.current(g)) return;
    }
    try {
      const cloud = await api.read(this.abort.signal);
      if (!this.current(g)) return;
      this.set({ profile: cloud, revision: cloud.data_revision });
      if (!cloud.data_initialized) {
        const local = this.doc.dirty ? this.doc.data : this.port.guest();
        this.doc = docOf(local, cloud.data_revision, cloud.learning_data, true);
        this.port.adopt(local);
        this.port.lock(true);
        this.set({
          status: "migration",
          cloud,
          message: "云端尚无学习记录，请选择是否迁移当前设备。",
        });
        return;
      }
      if (
        this.doc.dirty &&
        this.doc.revision !== cloud.data_revision &&
        !same(this.doc.data, cloud.learning_data)
      ) {
        this.set({
          status: "conflict",
          cloud,
          message: "云端已有更新，请选择要保留的记录。",
        });
        this.port.lock(false);
        return;
      }
      if (
        this.doc.dirty &&
        this.doc.revision === cloud.data_revision &&
        !same(this.doc.data, cloud.learning_data)
      ) {
        this.set({ status: "syncing", cloud: null });
        this.port.lock(false);
        this.schedule();
        return;
      }
      await this.adopt(cloud, g);
    } catch (error) {
      if (this.current(g)) this.fail(error);
    }
  }
  private async adopt(cloud: CloudAccount, g: number) {
    this.port.lock(true);
    const next = docOf(cloud.learning_data, cloud.data_revision);
    await this.persist(next);
    if (!this.current(g)) return;
    this.doc = next;
    this.port.replace(next.data);
    this.port.lock(false);
    this.set({
      status: "synced",
      profile: cloud,
      cloud: null,
      revision: cloud.data_revision,
      modifiedAt: cloud.data_updated_at,
      message: "",
    });
  }
  private schedule() {
    clearTimeout(this.timer);
    if (
      !this.api ||
      this.paused ||
      ["migration", "conflict", "loading"].includes(this.state.status)
    )
      return;
    if (!this.online()) {
      this.set({
        status: "offline",
        message: "离线待同步，联网后会自动重试。",
      });
      return;
    }
    this.set({ status: "syncing", message: "" });
    this.timer = setTimeout(() => void this.flush(), 500);
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.flight) return this.flight;
    if (
      !this.api ||
      this.paused ||
      !this.doc.dirty ||
      ["migration", "conflict", "loading"].includes(this.state.status)
    )
      return;
    if (!this.online()) {
      this.set({ status: "offline" });
      return;
    }
    const promise = this.upload();
    this.flight = promise;
    await promise;
    if (this.flight === promise) this.flight = null;
  }
  private async upload() {
    const g = this.generation,
      api = this.api!;
    try {
      await this.persist();
      if (!this.current(g)) return;
      const sent = this.doc,
        changes = learningChanges(sent.base, sent.data);
      if (!changes.length) {
        this.doc = { ...sent, dirty: false };
        await this.persist();
        this.set({ status: "synced" });
        return;
      }
      this.set({ status: "syncing" });
      const result = await api.patch(sent.revision, changes, this.abort.signal);
      if (!this.current(g)) return;
      this.doc = {
        ...this.doc,
        base: sent.data,
        revision: result.data_revision,
        dirty: !same(this.doc.data, sent.data),
      };
      await this.persist();
      if (!this.current(g)) return;
      this.set({
        revision: result.data_revision,
        status: this.doc.dirty ? "syncing" : "synced",
        modifiedAt: this.doc.modifiedAt,
        message: "",
      });
      if (this.doc.dirty) this.schedule();
    } catch (error) {
      if (!this.current(g)) return;
      if (error instanceof AccountError && error.code === "PT409") {
        try {
          const cloud = await api.read(this.abort.signal);
          if (this.current(g))
            this.set({
              status: "conflict",
              cloud,
              message: "云端已有更新，上传已暂停。",
            });
        } catch (e) {
          if (this.current(g)) this.fail(e);
        }
      } else this.fail(error);
    }
  }
  async choose(source: "local" | "cloud" | "empty") {
    const g = this.generation,
      api = this.api,
      cloud = this.state.cloud;
    if (!api || !cloud || !this.online())
      throw new AccountError("offline", "请联网后选择要保留的数据。");
    if (source === "cloud") {
      const latest = await api.read(this.abort.signal);
      if (this.current(g)) await this.adopt(latest, g);
      return;
    }
    const data = source === "empty" ? emptyLearning() : this.doc.data;
    this.port.lock(true);
    this.set({ status: "syncing" });
    try {
      const result = await api.replace(
        cloud.data_revision,
        data,
        this.abort.signal,
      );
      if (!this.current(g)) return;
      const next = docOf(data, result.data_revision);
      await this.persist(next);
      if (!this.current(g)) return;
      this.doc = next;
      this.port.replace(data);
      this.set({
        status: "synced",
        cloud: null,
        revision: result.data_revision,
        message: "",
      });
    } catch (error) {
      if (this.current(g)) {
        this.fail(error);
        await this.refresh(g);
      }
    } finally {
      if (this.current(g)) this.port.lock(false);
    }
  }
  async reserveImport(): Promise<ImportPermit> {
    this.paused = true;
    clearTimeout(this.timer);
    await this.flight;
    const g = this.generation;
    if (this.api) {
      if (!this.online())
        throw new AccountError("offline", "登录账号导入备份需要联网。");
      if (["migration", "conflict", "loading"].includes(this.state.status))
        throw new AccountError("not_ready", "请先完成数据迁移或处理同步冲突。");
      const cloud = await this.api.read(this.abort.signal);
      if (!this.current(g))
        throw new AccountError(
          "account_changed",
          "账号已切换，请重新选择文件。",
        );
      return {
        uid: this.state.uid,
        generation: g,
        revision: cloud.data_revision,
      };
    }
    return { uid: null, generation: g, revision: 0 };
  }
  releaseImport() {
    this.paused = false;
    if (this.doc.dirty) this.schedule();
  }
  async import(data: LearningData, permit: ImportPermit) {
    const g = this.generation;
    if (permit.generation !== g || permit.uid !== this.state.uid)
      throw new AccountError("account_changed", "账号已切换，请重新确认导入。");
    this.port.lock(true);
    let committed = false;
    let cacheFailed = false;
    try {
      let revision = 0;
      if (this.api) {
        if (!this.online())
          throw new AccountError("offline", "登录账号导入备份需要联网。");
        const result = await this.api.replace(
          permit.revision,
          data,
          this.abort.signal,
        );
        revision = result.data_revision;
        committed = true;
      }
      if (!this.current(g))
        throw new AccountError(
          "account_changed",
          "账号已切换，当前账号的数据未改变。",
        );
      const next = docOf(data, revision);
      if (committed) this.doc = next;
      try {
        await this.persist(next);
      } catch (error) {
        cacheFailed = committed;
        throw error;
      }
      if (!this.current(g)) throw new AccountError("account_changed");
      this.doc = next;
      this.port.replace(data);
      this.set({
        status: this.api ? "synced" : "local",
        revision,
        cloud: null,
        message: "",
      });
    } catch (error) {
      if (committed && this.current(g))
        this.set({
          status: "error",
          message: "云端已替换，但本机缓存写入失败，请重试连接以读取云端。",
        });
      throw error;
    } finally {
      if (this.current(g) && !cacheFailed) this.port.lock(false);
    }
  }
  async saveProfile(name: string, path: string | null) {
    const g = this.generation,
      api = this.api,
      p = this.state.profile;
    if (!api || !p || !this.online())
      throw new AccountError("offline", "请联网后保存个人资料。");
    try {
      const saved = await api.saveProfile(
        p.profile_revision,
        name,
        path,
        this.abort.signal,
      );
      if (!this.current(g))
        throw new AccountError("account_changed", "账号已切换。");
      this.set({ profile: saved });
      return saved;
    } catch (error) {
      if (
        error instanceof AccountError &&
        error.code === "PT409" &&
        this.current(g)
      ) {
        const latest = await api.read(this.abort.signal);
        if (this.current(g)) this.set({ profile: latest });
        throw new AccountError(
          "profile_conflict",
          "资料已在其他设备更新，请核对后再次保存。",
        );
      }
      throw error;
    }
  }
  transport() {
    return this.api;
  }
  localSummary() {
    return summarize(this.port.learning());
  }
  offline() {
    if (this.api)
      this.set({
        status: "offline",
        message: "离线待同步，联网后会自动重试。",
      });
  }
}
