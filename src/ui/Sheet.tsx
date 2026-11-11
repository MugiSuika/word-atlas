import { X } from "lucide-react";
import { useEffect, useRef } from "react";

let openSheets = 0;

/** Accessible dialog: centered panel on desktop, bottom sheet on phones. */
export function Sheet({
  open,
  onClose,
  label,
  children,
  wide = false,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    openSheets++;
    document.documentElement.classList.add("is-locked");
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener("keydown", onKey);
      openSheets--;
      if (!openSheets) document.documentElement.classList.remove("is-locked");
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="sheet-root"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        className={`sheet ${wide ? "sheet-wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <span className="sheet-grip" aria-hidden="true" />
        <button
          className="icon-btn sheet-close"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}
