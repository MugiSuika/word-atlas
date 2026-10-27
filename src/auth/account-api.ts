import { createClient, type Session } from "@supabase/supabase-js";
import { publicAuthConfig } from "./config";
import { validLearning, type LearningData } from "../store/model";
import type { LearningChange } from "../store/changes";
export interface AccountProfile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  profile_revision: number;
  updated_at: string;
}
export interface CloudAccount extends AccountProfile {
  learning_data: LearningData;
  data_initialized: boolean;
  data_revision: number;
  data_updated_at: string;
}
export class AccountError extends Error {
  constructor(
    public code: string,
    message = "账号服务暂时无法连接，请稍后重试。",
  ) {
    super(message);
  }
}
export interface AccountApi {
  uid: string;
  read(signal: AbortSignal): Promise<CloudAccount>;
  patch(
    revision: number,
    changes: LearningChange[],
    signal: AbortSignal,
  ): Promise<{ data_revision: number; data_updated_at: string }>;
  replace(
    revision: number,
    data: LearningData,
    signal: AbortSignal,
  ): Promise<{ data_revision: number; data_updated_at: string }>;
  saveProfile(
    revision: number,
    name: string,
    path: string | null,
    signal: AbortSignal,
  ): Promise<AccountProfile>;
  upload(path: string, blob: Blob): Promise<void>;
  remove(path: string): Promise<void>;
  avatar(path: string): Promise<string>;
}
export function accountApi(session: Session): AccountApi {
  const config = publicAuthConfig(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  if (!config) throw new AccountError("config");
  // Bind every request to this identity's JWT, including requests already in flight
  // when the shared auth client's session switches to a different account.
  const client = createClient(config.url, config.key, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<T> => {
    const { data, error } = await client.rpc(name, args).abortSignal(signal);
    if (error)
      throw new AccountError(
        error.code ?? "network",
        error.code === "PGRST205" || error.code === "PGRST202"
          ? "账号数据库尚未就绪，请保留本机备份并稍后重试。"
          : undefined,
      );
    return data as T;
  };
  const storage = client.storage.from("word-atlas-avatars");
  return {
    uid: session.user.id,
    async read(signal) {
      const v = await rpc<CloudAccount>("ensure_my_account", {}, signal);
      if (
        v.id !== session.user.id ||
        !validLearning(v.learning_data) ||
        !Number.isSafeInteger(v.data_revision) ||
        !Number.isSafeInteger(v.profile_revision) ||
        typeof v.data_initialized !== "boolean"
      )
        throw new AccountError(
          "invalid_response",
          "账号数据校验失败，已停止同步。",
        );
      return v;
    },
    patch: (revision, changes, signal) =>
      rpc(
        "apply_my_learning_changes",
        { p_expected_revision: revision, p_changes: changes },
        signal,
      ),
    replace: (revision, data, signal) =>
      rpc(
        "replace_my_learning_data",
        { p_expected_revision: revision, p_learning_data: data },
        signal,
      ),
    saveProfile: (revision, name, path, signal) =>
      rpc(
        "save_my_profile",
        {
          p_expected_revision: revision,
          p_display_name: name,
          p_avatar_path: path,
        },
        signal,
      ),
    async upload(path, blob) {
      const { error } = await storage.upload(path, blob, {
        contentType: "image/webp",
        upsert: false,
      });
      if (error)
        throw new AccountError("avatar_upload", "头像上传失败，原资料未改变。");
    },
    async remove(path) {
      const { error } = await storage.remove([path]);
      if (error) throw new AccountError("avatar_cleanup");
    },
    async avatar(path) {
      const { data, error } = await storage.createSignedUrl(path, 600);
      if (error || !data.signedUrl) throw new AccountError("avatar_read");
      return data.signedUrl;
    },
  };
}
