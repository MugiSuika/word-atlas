import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./client";

/** The parent keys this component by authenticated user ID to isolate account state. */
export function Profile({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (!active) return;
          if (error) setError("暂时无法读取个人资料，请稍后重试。");
          else
            setName(
              typeof data?.display_name === "string" ? data.display_name : "",
            );
          setLoading(false);
        },
        () => {
          if (active) {
            setLoading(false);
            setError("暂时无法读取个人资料，请检查网络后重试。");
          }
        },
      );
    return () => {
      active = false;
    };
  }, [userId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || saving || loading) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error } = await supabase.from("profiles").upsert(
        {
          id: userId,
          display_name: name.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) setError("个人资料未能保存，请稍后重试。");
      else {
        setName(name.trim());
        setNotice("昵称已保存。");
      }
    } catch {
      setError("个人资料未能保存，请检查网络后重试。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="account-form account-profile-form"
      onSubmit={save}
      aria-label="个人资料"
    >
      <label>
        昵称
        <input
          name="display-name"
          autoComplete="nickname"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={loading || saving}
          placeholder="你希望我们怎么称呼你"
        />
      </label>
      {error && (
        <p role="alert" className="warn-text">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div>
        <button
          type="submit"
          className="btn btn-ghost"
          disabled={loading || saving}
        >
          {loading ? "正在读取资料…" : saving ? "正在保存…" : "保存昵称"}
        </button>
      </div>
    </form>
  );
}
