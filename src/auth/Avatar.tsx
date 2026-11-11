import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useAccountData } from "./AccountDataProvider";
const safeImage = (url: unknown) => {
  try {
    return typeof url === "string" && new URL(url).protocol === "https:"
      ? url
      : "";
  } catch {
    return "";
  }
};
export function Avatar({
  large = false,
  googleOnly = false,
}: {
  large?: boolean;
  googleOnly?: boolean;
}) {
  const { session } = useAuth();
  const { profile, sync, uid } = useAccountData();
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl("");
    setFailed(false);
    const load = () => {
      if (!googleOnly && profile?.avatar_path) {
        void sync
          .transport()
          ?.avatar(profile.avatar_path)
          .then(
            (next) => {
              if (active) {
                setUrl(next);
                setFailed(false);
              }
            },
            () => {
              if (active) setFailed(true);
            },
          );
      } else
        setUrl(
          safeImage(
            session?.user.user_metadata.avatar_url ??
              session?.user.user_metadata.picture,
          ),
        );
    };
    load();
    const timer = setInterval(load, 8 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    uid,
    profile?.avatar_path,
    session?.user.id,
    session?.user.user_metadata.avatar_url,
    sync,
    googleOnly,
  ]);
  return (
    <span className={`account-avatar ${large ? "avatar-large" : ""}`}>
      {url && !failed ? (
        <img
          src={url}
          alt="用户头像"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <UserRound aria-hidden="true" size={large ? 36 : 21} />
      )}
    </span>
  );
}
