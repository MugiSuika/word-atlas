import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { store } from "../store/store";
import { accountCache } from "../store/account-cache";
import { AccountSync } from "../store/sync";
import { accountApi } from "./account-api";
import { useAuth } from "./AuthProvider";
import { ProfileEditor } from "./ProfileEditor";
import { SyncNotice } from "./SyncNotice";
const sync = new AccountSync(store, accountCache);
if (import.meta.hot) import.meta.hot.dispose(() => sync.dispose());
const EditContext = createContext({ openEditor: () => undefined as void });
export function AccountDataProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const [edit, setEdit] = useState(false);
  const previousUid = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (loading) return;
    if (previousUid.current !== (session?.user.id ?? null)) setEdit(false);
    previousUid.current = session?.user.id ?? null;
    void sync.connect(session ? accountApi(session) : null);
  }, [session?.user.id, session?.access_token, loading]);
  useEffect(() => {
    const online = () => void sync.refresh(),
      offline = () => sync.offline();
    const visible = () => {
      if (document.visibilityState === "visible") void sync.refresh();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return (
    <EditContext.Provider value={{ openEditor: () => setEdit(true) }}>
      {children}
      <SyncNotice />
      {edit && session && (
        <ProfileEditor key={session.user.id} onClose={() => setEdit(false)} />
      )}
    </EditContext.Provider>
  );
}
export function useAccountData() {
  const state = useSyncExternalStore(sync.subscribe, sync.get, sync.get);
  return { ...state, ...useContext(EditContext), sync };
}
export { sync as accountSync };
