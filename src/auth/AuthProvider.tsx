import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";

function hasGoogleIdentity(session: Session) {
  const metadata = session.user.app_metadata;
  return (
    metadata.provider === "google" ||
    (Array.isArray(metadata.providers) && metadata.providers.includes("google"))
  );
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  error: string;
}
const AuthContext = createContext<AuthState>({
  session: null,
  loading: false,
  error: "",
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let changed = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      changed = true;
      if (next && !hasGoogleIdentity(next)) {
        setSession(null);
        setLoading(false);
        setError("本站仅支持 Google 登录，请使用 Google 账号继续。");
        // SDK callbacks run inside its auth lock; defer sign-out to avoid a deadlock.
        window.setTimeout(() => {
          void supabase?.auth.signOut({ scope: "local" });
        }, 0);
        return;
      }
      setSession(next);
      setLoading(false);
      if (next) setError("");
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
          setSession(
            data.session && hasGoogleIdentity(data.session)
              ? data.session
              : null,
          );
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
    // Failed OAuth callbacks must leave Google login usable without exposing URL contents.
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    if (query.has("error") || hash.has("error")) {
      setError("Google 登录未完成，请重新尝试登录。");
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
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
