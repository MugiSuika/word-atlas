import { toast } from "../ui/Toast";
import { useAccountData } from "./AccountDataProvider";
import { Sheet } from "../ui/Sheet";
import { exportBackup } from "../store/store";
import { summarize, type LearningData } from "../store/model";
export const SYNC_LABELS = {
  local: "仅保存在本机",
  loading: "正在读取云端",
  syncing: "同步中",
  synced: "已同步",
  offline: "离线待同步",
  error: "同步失败",
  migration: "等待迁移选择",
  conflict: "同步冲突",
};
export function downloadLocal() {
  const url = URL.createObjectURL(
    new Blob([exportBackup()], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `word-atlas-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Summary({ data }: { data: LearningData }) {
  const s = summarize(data);
  return (
    <p>
      {s.datasets.length} 个词库 · {s.cards} 条记忆 · {s.reviews} 次答题 ·{" "}
      {s.sessions} 个未完成任务
    </p>
  );
}
export function SyncNotice() {
  const { status, cloud, modifiedAt, sync } = useAccountData();
  const decision = status === "migration" || status === "conflict";
  if (!decision || !cloud) return null;
  return (
    <Sheet
      open
      onClose={() => undefined}
      label={status === "migration" ? "迁移本机记录" : "处理同步冲突"}
    >
      <h2>
        {status === "migration" ? "把学习记录带到云端" : "选择要保留的学习记录"}
      </h2>
      <p className="muted">
        {status === "migration"
          ? "云端还没有学习记录。你可以迁移当前设备的全部词库与设置，也可以从空白开始；访客原记录仍保留。"
          : "云端和本机都有修改，自动上传已暂停。选择后将用一份完整记录替换另一份。"}
      </p>
      <div className="sync-comparison">
        <section>
          <h3>本机记录</h3>
          <time>{new Date(modifiedAt).toLocaleString()}</time>
          <Summary data={store.learning()} />
        </section>
        <section>
          <h3>云端记录</h3>
          <time>{new Date(cloud.data_updated_at).toLocaleString()}</time>
          <Summary data={cloud.learning_data} />
        </section>
      </div>
      <div className="data-actions">
        <button
          className="btn btn-primary"
          onClick={() =>
            void sync.choose("local").catch((e) => toast(e.message, "warn"))
          }
        >
          {status === "migration" ? "迁移当前设备记录" : "以本机覆盖云端"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() =>
            void sync
              .choose(status === "migration" ? "empty" : "cloud")
              .catch((e) => toast(e.message, "warn"))
          }
        >
          {status === "migration" ? "从空白开始" : "使用云端"}
        </button>
        <button className="btn btn-ghost" onClick={downloadLocal}>
          导出本机副本
        </button>
      </div>
    </Sheet>
  );
}
import { store } from "../store/store";
