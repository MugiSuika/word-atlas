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
        detectSessionInUrl: true,
      },
    })
  : null;

export function authRedirect() {
  return new URL(
    `${import.meta.env.BASE_URL}?auth_callback=1`,
    window.location.origin,
  ).href;
}

/** Check the public provider settings before sending users to OAuth. */
export async function googleLoginAvailable(): Promise<boolean> {
  if (!config) return false;
  const response = await fetch(`${config.url}/auth/v1/settings`, {
    headers: { apikey: config.key },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Login service unavailable");
  const settings = (await response.json()) as {
    external?: { google?: boolean };
  };
  return settings.external?.google === true;
}
