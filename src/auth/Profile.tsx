import { Avatar } from "./Avatar";
import { useAccountData } from "./AccountDataProvider";
export function Profile() {
  const { profile, openEditor, uid } = useAccountData();
  return (
    <div className="account-profile-summary">
      <Avatar key={uid ?? "guest"} large />
      <div>
        <strong>{profile?.display_name || "Google 账号"}</strong>
        <button
          className="btn btn-ghost"
          disabled={!profile}
          onClick={openEditor}
        >
          编辑资料
        </button>
      </div>
    </div>
  );
}
