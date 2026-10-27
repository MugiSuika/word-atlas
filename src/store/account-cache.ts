import { validLearning, type LearningData } from "./model";
export interface CachedLearning {
  data: LearningData;
  base: LearningData;
  revision: number;
  dirty: boolean;
  modifiedAt: string;
}
export interface LearningCache {
  read(uid: string): Promise<CachedLearning | null>;
  write(uid: string, value: CachedLearning): Promise<void>;
}
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined")
      return reject(new Error("浏览器不支持离线数据保存。"));
    const req = indexedDB.open("word-atlas-accounts", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("learning");
    req.onsuccess = () => {
      req.result.onversionchange = () => {
        req.result.close();
        database = undefined;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      database = undefined;
      reject(new Error("无法打开离线缓存，请检查浏览器存储权限。"));
    };
    req.onblocked = () =>
      reject(new Error("离线缓存被其他页面占用，请关闭旧页面后重试。"));
  }));
}
export const accountCache: LearningCache = {
  async read(uid) {
    const db = await open();
    const stored = await new Promise<CachedLearning | undefined>(
      (resolve, reject) => {
        const tx = db.transaction("learning", "readonly"),
          req = tx.objectStore("learning").get(uid);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error("无法读取离线缓存。"));
      },
    );
    if (!stored) return null;
    // Match the JSON representation used by backups and the database. Older
    // IndexedDB records may preserve optional fields with explicit undefined.
    const value = JSON.parse(JSON.stringify(stored)) as CachedLearning;
    if (
      !validLearning(value.data) ||
      !validLearning(value.base) ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      typeof value.dirty !== "boolean" ||
      !Number.isFinite(Date.parse(value.modifiedAt))
    )
      throw new Error("离线缓存校验失败，请保留当前页面并导出本机副本。");
    return value;
  },
  async write(uid, value) {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("learning", "readwrite");
      tx.objectStore("learning").put(JSON.parse(JSON.stringify(value)), uid);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error("浏览器拒绝保存离线数据，请导出本机副本。"));
      tx.onabort = () =>
        reject(new Error("离线数据保存未完成，请导出本机副本。"));
    });
  },
};
