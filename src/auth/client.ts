import { createClient } from "@supabase/supabase-js";
import { publicAuthConfig } from "./config";

const config = publicAuthConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY,
);
export const supabase = config
  ? createClient(config.url, config.key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        // Exchange the PKCE code ourselves. Automatic detection treats any
        // `error` parameter as a failed implicit grant and never exchanges a
        // `code` that arrived on the same URL, so the session is never stored.
        detectSessionInUrl: false,
      },
    })
  : null;

export function authRedirect() {
  return new URL(
    `${import.meta.env.BASE_URL}?auth_callback=1`,
    window.location.origin,
  ).href;
}
