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
    case "invalid_credentials":
      return "邮箱或密码不正确，请重试。";
    case "email_not_confirmed":
      return "请先点击邮件里的链接验证邮箱，再登录。";
    case "user_already_exists":
      return "该邮箱已注册，请登录或重置密码。";
    case "weak_password":
      return "密码强度不足，请使用更长且包含不同字符的密码。";
    case "same_password":
      return "新密码不能与原密码相同。";
    case "otp_expired":
      return "邮件链接已过期，请重新发送。";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "操作过于频繁，请稍后再试。";
    case "signup_disabled":
      return "暂时未开放注册，请联系站点管理员。";
    default:
      return error?.status === 429
        ? "操作过于频繁，请稍后再试。"
        : "暂时无法完成操作，请检查网络后重试。";
  }
}
