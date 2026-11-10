import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import { useAccountData } from "./AccountDataProvider";
import { useAuth } from "./AuthProvider";

export function Profile({ children }: { children?: ReactNode }) {
  const { profile, uid } = useAccountData();
  const { session } = useAuth();
  const email = session?.user.email;
  return (
    <div className="account-profile-summary">
      <Avatar key={uid ?? "guest"} large />
      <div className="account-profile-copy">
        <strong className="account-name">
          {profile?.display_name || "Google 账号"}
        </strong>
        {email ? <p className="account-email">{email}</p> : null}
        {children}
      </div>
    </div>
  );
}
