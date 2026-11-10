/** Parameters Supabase may place on the OAuth return URL. */
export interface AuthCallback {
  code: string | null;
  flowId: string | null;
  /** True when the URL carries an OAuth error, ignoring hash-router paths such as `#/me`. */
  oauthError: boolean;
  /** True when this URL is an OAuth return that should be cleaned up after handling. */
  pending: boolean;
}

/**
 * Read a PKCE callback without treating the app's hash route as an OAuth error.
 * Supabase can return the authorization code in the query and an error in either
 * the query or the fragment of the same URL; the code has to survive that.
 */
export function readAuthCallback(href: string): AuthCallback {
  const url = new URL(href);
  const hashIsRoute = url.hash.startsWith("#/");
  const hashParams = new URLSearchParams(hashIsRoute ? "" : url.hash.slice(1));
  const code = url.searchParams.get("code") ?? hashParams.get("code");
  const flowId =
    url.searchParams.get("sb_flow_id") ?? hashParams.get("sb_flow_id");
  const oauthError =
    url.searchParams.has("error") ||
    hashParams.has("error") ||
    hashParams.has("error_code") ||
    hashParams.has("error_description");
  return {
    code,
    flowId,
    oauthError,
    pending:
      oauthError || Boolean(code) || url.searchParams.has("auth_callback"),
  };
}

/** Drop the one-time callback parameters and land on the account page. */
export function callbackReturnUrl(href: string): string {
  const url = new URL(href);
  for (const key of [
    "error",
    "error_code",
    "error_description",
    "auth_callback",
    "code",
    "sb_flow_id",
  ])
    url.searchParams.delete(key);
  if (!url.hash.startsWith("#/")) url.hash = "/me";
  return url.href;
}
