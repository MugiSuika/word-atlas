import {
  isObj,
  MAX_BACKUP_BYTES,
  validSettings,
  validLearning,
  validProgress,
  summarize,
  type LearningData,
} from "./model";
export interface Backup {
  data: LearningData;
  exported: string;
  legacy: boolean;
  summary: ReturnType<typeof summarize>;
}
export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error("备份超过 30 MB 限制。");
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
  if (
    !isObj(v) ||
    v.app !== "word-atlas" ||
    ![2, 3].includes(v.version as number) ||
    typeof v.exported !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(v.exported) ||
    !Number.isFinite(Date.parse(v.exported))
  )
    throw new Error("这不是有效的词光学习备份。");
  let data: unknown;
  const legacy = v.version === 2;
  if (legacy) {
    if (
      Object.keys(v).some(
        (k) =>
          !["app", "version", "exported", "progress", "settings"].includes(k),
      ) ||
      !isObj(v.progress) ||
      typeof v.progress.datasetId !== "string" ||
      !validProgress(v.progress, v.progress.datasetId) ||
      !isObj(v.settings)
    )
      throw new Error("v2 备份的学习记录或任务结构不完整。");
    if (
      !validSettings({
        ...v.settings,
        atlasView: v.settings.atlasView ?? "grid",
      })
    )
      throw new Error("v2 备份的设置无效。");
    data = {
      settings: { ...v.settings, atlasView: v.settings.atlasView ?? "grid" },
      datasets: { [v.progress.datasetId]: v.progress },
    };
  } else {
    if (
      Object.keys(v).some(
        (k) => !["app", "version", "exported", "data"].includes(k),
      )
    )
      throw new Error("备份含有不支持的字段。");
    data = v.data;
  }
  if (!validLearning(data))
    throw new Error("备份的学习记录、未完成任务或设置不完整。");
  return { data, exported: v.exported, legacy, summary: summarize(data) };
}
export function serializeBackup(data: LearningData) {
  if (!validLearning(data))
    throw new Error("当前学习数据校验失败，请保留本机缓存后重试。");
  const text = JSON.stringify(
    { app: "word-atlas", version: 3, exported: new Date().toISOString(), data },
    null,
    1,
  );
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error("备份超过 30 MB 限制。");
  return text;
}
