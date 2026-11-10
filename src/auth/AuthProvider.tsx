import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { callbackReturnUrl, readAuthCallback } from "./callback";
import { supabase } from "./client";

function hasGoogleIdentity(session: Session) {
  const metadata = session.user?.app_metadata ?? {};
  if (
    metadata.provider === "google" ||
    (Array.isArray(metadata.providers) && metadata.providers.includes("google"))
  )
    return true;
  return (session.user?.identities ?? []).some(
    (identity) => identity.provider === "google",
  );
}

// One exchange per page load. React Strict Mode re-runs the effect, and the
// authorization code can be redeemed only once. The callback is remembered
// because the first pass may rewrite the URL before the second pass reads it.
let callbackExchange: Promise<{
  data: { session: Session | null };
  error: { message?: string } | null;
}> | null = null;
let rememberedCallback: ReturnType<typeof readAuthCallback> | null = null;

function exchangeCallbackCode(code: string, flowId: string | null) {
  if (!supabase) return Promise.reject(new Error("auth client missing"));
  callbackExchange ??= supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  return callbackExchange;
}

function pageCallback() {
  rememberedCallback ??= readAuthCallback(location.href);
  return rememberedCallback;
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
    const auth = supabase;
    let active = true;
    let changed = false;
    let established = false;
    let rejected = false;
    const callback = pageCallback();
    // Show the account page while the code is exchanged, without removing the
    // code from the URL until the exchange has finished.
    if (callback.pending && !location.hash.startsWith("#/")) {
      const url = new URL(location.href);
      url.hash = "/me";
      history.replaceState(null, "", url);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    const {
      data: { subscription },
    } = auth.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      // The empty initial session arrives before the code exchange. Keep the
      // loading state until that exchange settles.
      if (!next && callback.code && !established) return;
      changed = true;
      if (next && !hasGoogleIdentity(next)) {
        established = false;
        rejected = true;
        setSession(null);
        setLoading(false);
        setError("本站仅支持 Google 登录，请使用 Google 账号继续。");
        // SDK callbacks run inside its auth lock; defer sign-out to avoid a deadlock.
        window.setTimeout(() => {
          void auth.auth.signOut({ scope: "local" });
        }, 0);
        return;
      }
      established = Boolean(next);
      setSession(next);
      setLoading(false);
      if (next) setError("");
    });
    const settle = (
      next: Session | null,
      sessionError: { message?: string } | null,
    ) => {
      if (!active) return;
      const google = next && hasGoogleIdentity(next) ? next : null;
      if (google && !established) {
        established = true;
        setSession(google);
        setLoading(false);
        setError("");
      } else if (!changed) {
        established = Boolean(google);
        setSession(google);
        setLoading(false);
      }
      if (callback.pending) {
        const url = callbackReturnUrl(location.href);
        if (url !== location.href) {
          history.replaceState(null, "", url);
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      }
      if (rejected) return;
      if (!established && (callback.oauthError || callback.code))
        setError("Google 登录未完成，请重新尝试登录。");
      else if (!established && sessionError)
        setError("登录状态无法恢复，请重新登录。");
    };
    // Capture the code before rewriting the URL. The exchange reads it from
    // this value, so a later history update cannot drop the login.
    const pending = callback.code
      ? exchangeCallbackCode(callback.code, callback.flowId)
      : Promise.resolve({
          data: { session: null as Session | null },
          error: null,
        });
    pending
      .then(() => auth.auth.getSession())
      .then(({ data, error: sessionError }) => {
        settle(data.session, sessionError);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        if (callback.oauthError || callback.code)
          setError("Google 登录未完成，请重新尝试登录。");
        else setError("登录状态无法恢复，请检查网络后重试。");
        if (callback.pending && active) {
          const url = callbackReturnUrl(location.href);
          if (url !== location.href) {
            history.replaceState(null, "", url);
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          }
        }
      });
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
