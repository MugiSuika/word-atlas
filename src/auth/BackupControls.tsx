import { Download, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccountData } from "./AccountDataProvider";
import { AccountError } from "./account-api";
import { parseBackup, type Backup } from "../store/backup";
import { MAX_BACKUP_BYTES, resetProgress, useStore } from "../store/store";
import type { ImportPermit } from "../store/sync";
import { Sheet } from "../ui/Sheet";
import { toast } from "../ui/Toast";
import { downloadLocal } from "./SyncNotice";
export function BackupControls() {
  const { sync, uid, status } = useAccountData(),
    saveError = useStore((s) => s.saveError),
    locked = useStore((s) => s.locked);
  const input = useRef<HTMLInputElement>(null),
    selection = useRef(0);
  const [pending, setPending] = useState<{
    backup: Backup;
    filename: string;
    permit: ImportPermit;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    selection.current++;
    setPending(null);
    setError("");
    setBusy(false);
    sync.releaseImport();
  }, [uid, sync]);
  const cancel = () => {
    if (!busy) {
      selection.current++;
      setPending(null);
      setError("");
      sync.releaseImport();
    }
  };
  const read = async (file: File) => {
    const serial = ++selection.current;
    setBusy(true);
    setError("");
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error("备份超过 30 MB 限制。");
      const backup = parseBackup(await file.text());
      if (serial !== selection.current) return;
      const permit = await sync.reserveImport();
      if (serial !== selection.current) {
        sync.releaseImport();
        return;
      }
      setPending({ backup, filename: file.name, permit });
    } catch (e) {
      if (serial === selection.current) {
        toast(e instanceof Error ? e.message : "无法读取备份文件。", "warn");
        sync.releaseImport();
      }
    } finally {
      if (serial === selection.current) setBusy(false);
    }
  };
  const commit = async () => {
    if (!pending || busy) return;
    const serial = selection.current;
    setBusy(true);
    setError("");
    try {
      await sync.import(pending.backup.data, pending.permit);
      if (serial !== selection.current) return;
      setPending(null);
      sync.releaseImport();
      toast("全部词库的学习记录与设置已替换。", "ok");
    } catch (e) {
      if (serial !== selection.current) return;
      if (e instanceof AccountError && e.code === "PT409") {
        try {
          const permit = await sync.reserveImport();
          if (serial === selection.current) {
            setPending({ ...pending, permit });
            setError(
              "云端记录刚刚发生变化，本次未替换。请重新核对后确认替换。",
            );
          }
        } catch {
          setError("云端记录已变化，暂时无法核对。请取消后重新导入。");
        }
      } else
        setError(
          e instanceof Error
            ? e.message
            : "替换失败，未显示为成功。请保留备份后重试。",
        );
    } finally {
      if (serial === selection.current) setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h3 className="eyebrow">数据</h3>
      <p className="muted">
        备份包含全部词库的进度、收藏、统计、练习记录、错词、未完成任务和设置。昵称、头像和
        Google 身份不在备份中。
      </p>
      {saveError && (
        <p className="warn-text" role="alert">
          浏览器拒绝保存离线缓存，请尽快导出备份。
        </p>
      )}
      <div className="data-actions">
        <button
          className="btn btn-ghost"
          onClick={() => {
            try {
              downloadLocal();
            } catch (e) {
              toast(e instanceof Error ? e.message : "无法导出备份。", "warn");
            }
          }}
        >
          <Download size={18} />
          导出备份
        </button>
        <button
          className="btn btn-ghost"
          disabled={
            busy ||
            locked ||
            ["conflict", "migration", "loading"].includes(status)
          }
          onClick={() => input.current?.click()}
        >
          <Upload size={18} />
          {busy ? "正在读取备份…" : "导入备份"}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void read(f);
          }}
        />
        <button
          className="btn btn-ghost btn-danger"
          disabled={locked}
          onClick={() => {
            if (
              confirm(
                "确定清空这个词库的全部学习记录？此操作无法撤销，建议先导出备份。",
              )
            ) {
              resetProgress();
              toast("当前词库记录已清空。");
            }
          }}
        >
          <RotateCcw size={18} />
          清空记录
        </button>
      </div>
      <Sheet open={!!pending} onClose={cancel} label="确认全量替换">
        <h2>确认替换全部学习数据</h2>
        {pending && (
          <>
            <dl className="backup-summary">
              <dt>文件</dt>
              <dd>{pending.filename}</dd>
              <dt>备份时间</dt>
              <dd>{new Date(pending.backup.exported).toLocaleString()}</dd>
              <dt>包含词库</dt>
              <dd>
                {pending.backup.summary.datasets.join("、") || "无词库记录"}
              </dd>
              <dt>记录数量</dt>
              <dd>
                {pending.backup.summary.cards} 条记忆 ·{" "}
                {pending.backup.summary.bookmarks} 个收藏 ·{" "}
                {pending.backup.summary.reviews} 次答题 ·{" "}
                {pending.backup.summary.sessions} 个未完成任务
              </dd>
            </dl>
            {pending.backup.legacy && (
              <p className="warn-text">这是 v2 单词库备份。</p>
            )}
            <p className="warn-text">
              确认后将全量替换所有词库的学习记录与设置，其他未包含在文件中的词库记录也会清除。不会合并，昵称、头像和
              Google 登录身份会保留。
            </p>
            {uid && (
              <p className="muted">
                此操作将替换当前账号的云端数据，需要保持联网。
              </p>
            )}
            {error && (
              <p role="alert" className="warn-text">
                {error}
              </p>
            )}
            <div className="data-actions">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void commit()}
              >
                {busy ? "正在替换…" : "确认全量替换"}
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={cancel}
              >
                取消
              </button>
            </div>
          </>
        )}
      </Sheet>
    </section>
  );
}
