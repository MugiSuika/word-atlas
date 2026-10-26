import { LogIn, LogOut, Mail, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase, authRedirect } from "./client";
import { authMessage } from "./config";
import { useAuth } from "./AuthProvider";
import { Profile } from "./Profile";

type Mode = "login" | "signup" | "reset";

export function Account() {
  const { session, loading, error: sessionError } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const changeMode = (next: Mode) => {
    setMode(next);
    setPassword("");
    setConfirmPassword("");
    setError("");
    setNotice("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    setError("");
    setNotice("");
    if (mode === "signup" && password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: authRedirect() },
        );
        if (error) setError(authMessage(error));
        else
          setNotice(
            "如果该邮箱已注册，你将收到重置密码的邮件，请在当前浏览器中打开链接。",
          );
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirect() },
        });
        if (error) setError(authMessage(error));
        else {
          setPassword("");
          setConfirmPassword("");
          setNotice(
            data.session
              ? "注册成功，已登录。"
              : "请检查邮箱，并在当前浏览器中打开验证链接，然后登录。",
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) setError(authMessage(error));
        else {
          setPassword("");
          setConfirmPassword("");
        }
      }
    } catch {
      setError(authMessage(null));
    } finally {
      setBusy(false);
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
      else {
        setPassword("");
        setConfirmPassword("");
        setNotice("已退出登录。");
      }
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
        登录可管理账号。学习进度保存在当前浏览器中，可通过备份迁移到其他设备。
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
            <span className="chip">已登录</span>
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
        <>
          <div
            className="segmented account-tabs"
            role="group"
            aria-label="账号操作"
          >
            <button
              type="button"
              aria-pressed={mode === "login"}
              className={mode === "login" ? "is-on" : ""}
              onClick={() => changeMode("login")}
              disabled={busy}
            >
              登录
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              className={mode === "signup" ? "is-on" : ""}
              onClick={() => changeMode("signup")}
              disabled={busy}
            >
              注册
            </button>
          </div>
          <form
            className="account-form"
            onSubmit={submit}
            aria-label={
              mode === "reset"
                ? "重置密码"
                : mode === "signup"
                  ? "注册账号"
                  : "邮箱登录"
            }
          >
            <label>
              邮箱
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </label>
            {mode !== "reset" && (
              <>
                <label>
                  密码
                  <input
                    name="password"
                    aria-describedby={
                      mode === "signup" ? "account-password-hint" : undefined
                    }
                    type="password"
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    required
                    minLength={mode === "signup" ? 8 : 1}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                </label>
                {mode === "signup" && (
                  <small id="account-password-hint" className="muted">
                    至少 8 位，建议包含字母、数字和符号。
                  </small>
                )}
              </>
            )}
            {mode === "signup" && (
              <label>
                确认密码
                <input
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <div className="data-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <LogIn size={18} />
                {busy
                  ? "正在处理…"
                  : mode === "reset"
                    ? "发送重置邮件"
                    : mode === "signup"
                      ? "创建账号"
                      : "登录账号"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => changeMode(mode === "reset" ? "login" : "reset")}
                disabled={busy}
              >
                {mode === "reset" ? "返回登录" : "忘记密码？"}
              </button>
            </div>
          </form>
        </>
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

export function PasswordRecovery() {
  const { session, recovery, finishRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const open = recovery && !!session;
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  if (!open) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setError(authMessage(error));
      else {
        setPassword("");
        setConfirmPassword("");
        finishRecovery();
      }
    } catch {
      setError(authMessage(null));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="account-recovery"
      aria-labelledby="recovery-title"
      aria-describedby="recovery-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) finishRecovery();
      }}
    >
      <section className="panel">
        <h2 id="recovery-title">设置新密码</h2>
        <p className="muted" id="recovery-description">
          邮箱验证已完成，为你的账号设置新密码。
        </p>
        <form className="account-form" onSubmit={submit}>
          <label>
            新密码
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="warn-text">
              {error}
            </p>
          )}
          <div className="data-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "正在保存…" : "保存新密码"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={finishRecovery}
            >
              取消
            </button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
