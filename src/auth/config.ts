/** Only public browser credentials belong in Vite configuration. */
export function publicAuthConfig(
  url?: string,
  key?: string,
): { url: string; key: string } | null {
  if (!url?.trim() || !key?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      return null;
    const publicKey = key.trim();
    if (publicKey.startsWith("sb_secret_")) return null;
    if (!publicKey.startsWith("sb_publishable_")) {
      const payload = JSON.parse(
        atob(publicKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (payload.role !== "anon") return null;
    }
    return { url: parsed.origin, key: publicKey };
  } catch {
    return null;
  }
}

export function authMessage(
  error: { code?: string; status?: number } | null,
): string {
  switch (error?.code) {
    case "access_denied":
      return "Google 登录已取消，请重试。";
    case "provider_disabled":
    case "oauth_provider_not_supported":
      return "Google 登录暂未开放，请稍后重试。";
    case "over_request_rate_limit":
      return "操作过于频繁，请稍后再试。";
    default:
      return error?.status === 429
        ? "操作过于频繁，请稍后再试。"
        : "暂时无法完成操作，请检查网络后重试。";
  }
}
