import { useState, type ReactNode } from "react";
import { supabase, authRedirect } from "./client";
import { authMessage } from "./config";
import { useAuth } from "./AuthProvider";
import { Profile } from "./Profile";
import { useAccountData } from "./AccountDataProvider";
import { SYNC_LABELS } from "./SyncNotice";

function GoogleMark() {
  return (
    <svg
      className="google-mark"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function Account() {
  const { session, loading, error: sessionError } = useAuth();
  const account = useAccountData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const signIn = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    let navigating = false;
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: authRedirect(),
          scopes: "openid email profile",
          queryParams: { prompt: "select_account" },
          skipBrowserRedirect: true,
        },
      });
      if (error) setError(authMessage(error));
      else if (!data.url) setError("暂时无法打开 Google 登录，请稍后重试。");
      else {
        window.location.assign(data.url);
        navigating = true;
      }
    } catch {
      setError(authMessage(null));
    } finally {
      if (!navigating) setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) setError(authMessage(error));
      else setNotice("已退出登录。");
    } catch {
      setError(authMessage(null));
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (!supabase) {
    body = (
      <p role="status" className="account-note">
        账号服务暂未开放，你可以继续学习和保存本机进度。
      </p>
    );
  } else if (loading) {
    body = (
      <p role="status" className="account-note">
        正在恢复登录状态…
      </p>
    );
  } else if (session) {
    body = (
      <Profile>
        <p className="sync-status" role="status">
          {SYNC_LABELS[account.status]}
        </p>
        {account.message && (
          <p className="warn-text" role="alert">
            {account.message}
          </p>
        )}
        <div className="account-actions">
          <button
            className="btn btn-ghost"
            disabled={!account.profile}
            onClick={account.openEditor}
          >
            编辑资料
          </button>
          {["error", "offline"].includes(account.status) && (
            <button
              className="btn btn-ghost"
              onClick={() => void account.sync.refresh()}
            >
              重试同步
            </button>
          )}
          <button className="btn btn-ghost" onClick={signOut} disabled={busy}>
            {busy ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </Profile>
    );
  } else {
    body = (
      <>
        <p className="eyebrow">同步</p>
        <p className="account-note">同步可选，离线照常学习，联网后继续。</p>
        <button
          className="btn btn-google"
          onClick={signIn}
          disabled={busy}
          aria-busy={busy}
        >
          <GoogleMark />
          {busy ? "正在前往 Google…" : "使用 Google 继续"}
        </button>
      </>
    );
  }

  return (
    <section
      className={`panel account-panel${session ? "" : " account-signin"}`}
      aria-label={session ? "个人资料" : "同步"}
    >
      {body}
      {(error || sessionError) && (
        <p className="warn-text" role="alert">
          {error || sessionError}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
