import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";

interface AuthState {
  session: Session | null;
  loading: boolean;
  recovery: boolean;
  error: string;
  finishRecovery: () => void;
}
const AuthContext = createContext<AuthState>({
  session: null,
  loading: false,
  recovery: false,
  error: "",
  finishRecovery: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let changed = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      changed = true;
      setSession(next);
      setLoading(false);
      if (next) setError("");
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
      if (next && new URLSearchParams(location.search).has("auth_callback")) {
        const url = new URL(location.href);
        url.searchParams.delete("auth_callback");
        url.searchParams.delete("code");
        url.hash = "/me";
        // Let the application's hash router observe completion of the email callback.
        history.replaceState(null, "", url);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (!changed) {
          setSession(data.session);
          setLoading(false);
        }
        if (sessionError) setError("登录状态无法恢复，请重新登录。");
      })
      .catch(() => {
        if (active && !changed) {
          setLoading(false);
          setError("登录状态无法恢复，请检查网络后重试。");
        }
      });
    // Failed email callbacks must leave a usable login form without exposing URL contents.
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    if (query.has("error") || hash.has("error")) {
      setError("验证链接已失效，请重新发送验证邮件或重置密码。");
      const url = new URL(location.href);
      for (const key of [
        "error",
        "error_code",
        "error_description",
        "auth_callback",
        "code",
      ])
        url.searchParams.delete(key);
      url.hash = "/me";
      history.replaceState(null, "", url);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        recovery,
        error,
        finishRecovery: () => setRecovery(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
