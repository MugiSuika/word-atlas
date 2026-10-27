import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sheet } from "../ui/Sheet";
import { useAccountData } from "./AccountDataProvider";
import { useAuth } from "./AuthProvider";
import { Avatar } from "./Avatar";
import { prepareAvatar } from "./avatar-image";
import { AccountError } from "./account-api";
export function ProfileEditor({ onClose }: { onClose: () => void }) {
  const { profile, sync, uid } = useAccountData();
  const { session } = useAuth();
  const [name, setName] = useState(
    profile?.display_name ?? session?.user.user_metadata.full_name ?? "",
  );
  const [blob, setBlob] = useState<Blob | null>(null),
    [preview, setPreview] = useState("");
  const [reset, setReset] = useState(false),
    [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
  const serial = useRef(0),
    active = useRef(true);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      serial.current++;
    };
  }, []);
  useEffect(() => {
    if (!blob) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const select = async (f: File) => {
    const at = ++serial.current;
    setPreparing(true);
    setError("");
    try {
      const image = await prepareAvatar(f);
      if (active.current && at === serial.current) {
        setBlob(image);
        setReset(false);
      }
    } catch (e) {
      if (active.current && at === serial.current)
        setError(e instanceof Error ? e.message : "图片无法读取。");
    } finally {
      if (active.current && at === serial.current) setPreparing(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const api = sync.transport();
    if (!api || !uid || busy || preparing || !profile) return;
    const original = profile.avatar_path;
    let path = reset ? null : original;
    let uploaded = false;
    setBusy(true);
    setError("");
    try {
      if (blob) {
        path = `${uid}/${crypto.randomUUID()}.webp`;
        await api.upload(path, blob);
        uploaded = true;
      }
      if (sync.get().uid !== uid)
        throw new AccountError(
          "account_changed",
          "账号已切换，请重新打开资料编辑。",
        );
      await sync.saveProfile(name, path);
      if (active.current) onClose();
      if (original && original !== path)
        void api.remove(original).catch(() => undefined);
    } catch (e) {
      // An uncertain network outcome may already have committed the new reference.
      // Only delete a newly uploaded object when the server explicitly rejected it.
      if (
        uploaded &&
        path &&
        e instanceof AccountError &&
        ["PT422", "profile_conflict"].includes(e.code)
      )
        void api.remove(path).catch(() => undefined);
      if (active.current)
        setError(e instanceof Error ? e.message : "资料未能保存，请稍后重试。");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      label="编辑资料"
    >
      <h2>编辑资料</h2>
      <p className="muted">昵称和头像仅在本站使用，不会修改 Google 账号。</p>
      <form
        className="account-form profile-editor"
        aria-label="个人资料"
        onSubmit={save}
      >
        <div className="avatar-preview">
          {preview ? (
            <img src={preview} alt="新头像预览" />
          ) : reset ? (
            <Avatar large googleOnly />
          ) : (
            <Avatar large />
          )}
        </div>
        <div className="data-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => file.current?.click()}
            disabled={busy || preparing}
          >
            上传头像
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || preparing}
            onClick={() => {
              serial.current++;
              setBlob(null);
              setReset(true);
            }}
          >
            恢复 Google 头像
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void select(f);
          }}
        />
        <small className="muted">
          JPG、PNG、WebP，最大 5 MB。将居中裁成方形并压缩至 512 × 512。
        </small>
        <label>
          昵称
          <input
            name="display-name"
            autoComplete="nickname"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy || preparing}
          />
        </label>
        {error && (
          <p role="alert" className="warn-text">
            {error}
          </p>
        )}
        <div className="data-actions">
          <button
            className="btn btn-primary"
            disabled={busy || preparing || !profile}
          >
            {preparing ? "正在处理头像…" : busy ? "正在保存…" : "保存资料"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </form>
    </Sheet>
  );
}
