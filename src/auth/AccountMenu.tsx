import { LogOut, Pencil, UserRound } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useAuth } from "./AuthProvider";
import { useAccountData } from "./AccountDataProvider";
import { Avatar } from "./Avatar";
import { supabase } from "./client";
import { toast } from "../ui/Toast";
export function AccountMenu() {
  const { session } = useAuth(),
    { profile, openEditor, uid } = useAccountData();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    hovering = useRef(false),
    pendingFocus = useRef("");
  useEffect(() => {
    setOpen(false);
    setBusy(false);
  }, [uid]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const keyboard = (e: KeyboardEvent) => {
    const options = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
      const focus = () => {
        const items = options.length
          ? options
          : Array.from(
              root.current?.querySelectorAll<HTMLElement>(
                '[role="menuitem"]',
              ) ?? [],
            );
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : (i + (e.key === "ArrowUp" ? -1 : 1) + items.length) %
                items.length
        ]?.focus();
      };
      if (options.length) focus();
      else {
        pendingFocus.current = e.key;
      }
    }
  };
  useLayoutEffect(() => {
    if (!open || !pendingFocus.current) return;
    const items = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    items[
      pendingFocus.current === "ArrowUp" || pendingFocus.current === "End"
        ? items.length - 1
        : 0
    ]?.focus();
    pendingFocus.current = "";
  }, [open]);
  if (!session)
    return (
      <a href="#/me" className="icon-btn" aria-label="Google 登录">
        <Avatar key="guest" />
      </a>
    );
  return (
    <div
      className="account-menu"
      ref={root}
      onKeyDown={keyboard}
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch" && matchMedia("(hover: hover)").matches) {
          hovering.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={(e) => {
        hovering.current = false;
        if (
          e.pointerType !== "touch" &&
          !root.current?.contains(document.activeElement)
        )
          setOpen(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="icon-btn avatar-trigger"
        aria-label="账号菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-dropdown"
        onClick={(e) => {
          if (e.detail > 0 && hovering.current) setOpen(true);
          else setOpen((v) => !v);
        }}
      >
        <Avatar key={session?.user.id ?? "guest"} />
      </button>
      {open && (
        <div
          className="account-dropdown"
          id="account-dropdown"
          role="menu"
          aria-label="账号操作"
        >
          <p>
            {profile?.display_name ||
              session.user.user_metadata.full_name ||
              "Google 账号"}
          </p>
          <a role="menuitem" href="#/me" onClick={() => setOpen(false)}>
            <UserRound size={17} />
            个人中心
          </a>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              openEditor();
            }}
            disabled={!profile}
          >
            <Pencil size={17} />
            编辑资料
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await supabase!.auth.signOut({
                scope: "local",
              });
              if (error) toast("退出未完成，请重试。", "warn");
              setBusy(false);
              setOpen(false);
            }}
          >
            <LogOut size={17} />
            {busy ? "正在退出…" : "退出登录"}
          </button>
        </div>
      )}
    </div>
  );
}
