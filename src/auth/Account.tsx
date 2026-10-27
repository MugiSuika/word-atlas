import { LogIn, LogOut, Mail, UserRound } from "lucide-react";
import { useState } from "react";
import { supabase, authRedirect } from "./client";
import { authMessage } from "./config";
import { useAuth } from "./AuthProvider";
import { Profile } from "./Profile";

export function Account() {
  const { session, loading, error: sessionError } = useAuth();
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

  return (
    <section className="panel account-panel" aria-labelledby="account-title">
      <div className="account-heading">
        <UserRound size={22} />
        <h2 id="account-title">我的账号</h2>
      </div>
      <p className="muted">
        使用 Google
        账号登录并管理个人资料。学习进度保存在当前浏览器中，可通过备份迁移到其他设备。
      </p>
      {!supabase ? (
        <p role="status" className="muted">
          账号服务暂未开放，你可以继续学习和保存本机进度。
        </p>
      ) : loading ? (
        <p role="status">正在恢复登录状态…</p>
      ) : session ? (
        <div className="account-profile">
          <div className="account-identity">
            <Mail size={18} />
            <span>{session.user.email}</span>
            <span className="chip">Google 已登录</span>
          </div>
          <Profile key={session.user.id} userId={session.user.id} />
          <div className="data-actions">
            <button className="btn btn-ghost" onClick={signOut} disabled={busy}>
              <LogOut size={18} />
              {busy ? "正在退出…" : "退出登录"}
            </button>
          </div>
        </div>
      ) : (
        <div className="account-google">
          <button className="btn btn-primary" onClick={signIn} disabled={busy}>
            <LogIn size={18} />
            {busy ? "正在前往 Google…" : "使用 Google 登录"}
          </button>
          <p className="muted">首次使用 Google 登录时会自动建立账号。</p>
        </div>
      )}
      {(error || sessionError) && (
        <p className="warn-text" role="alert">
          {error || sessionError}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
