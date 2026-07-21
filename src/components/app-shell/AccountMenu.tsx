import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { resolveHeaderRoleLabel } from "../../utils/headerCompanyContext";
import type { Role } from "../../permissions";
import { Icon } from "../ui/Icon";

type Props = {
  displayName: string;
  email?: string;
  role: Role;
  companyName?: string;
  photoUrl?: string;
  initials: string;
  showCompanySwitcher?: boolean;
  onOpenAccount?: () => void;
  onOpenCompanySwitcher?: () => void;
  onHelp?: () => void;
  onSignOut: () => void;
};

function useAccountMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setStyle(null);
      return;
    }

    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger) return;

      const menuWidth = Math.min(288, window.innerWidth - 16);
      const left = Math.min(Math.max(8, trigger.right - menuWidth), window.innerWidth - menuWidth - 8);
      const gap = 8;
      let top = trigger.bottom + gap;
      if (menu && top + menu.height > window.innerHeight - gap) {
        top = Math.max(gap, trigger.top - menu.height - gap);
      }
      setStyle({
        position: "fixed",
        top,
        left,
        width: menuWidth,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, triggerRef, menuRef]);

  return style;
}

export function AccountMenu({
  displayName,
  email,
  role,
  companyName,
  photoUrl,
  initials,
  showCompanySwitcher = false,
  onOpenAccount,
  onOpenCompanySwitcher,
  onHelp,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuStyle = useAccountMenuPosition(open, triggerRef, menuRef);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const menu =
    open && typeof document !== "undefined" ? (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[70] cursor-default"
          aria-label="Close account menu"
          onClick={() => setOpen(false)}
        />
        <div
          ref={menuRef}
          role="menu"
          style={menuStyle ?? { position: "fixed", top: -9999, left: -9999, width: Math.min(288, window.innerWidth - 16) }}
          className="z-[71] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-2 shadow-xl motion-reduce:transition-none"
        >
            <div className="border-b border-[var(--ui-border)] px-3 py-3">
              <p className="truncate text-sm font-semibold text-[var(--ui-text-primary)]">{displayName}</p>
              {email ? <p className="truncate text-xs text-[var(--ui-text-secondary)]">{email}</p> : null}
              <p className="mt-1 text-[11px] font-medium text-[var(--ui-text-muted)]">{resolveHeaderRoleLabel(role)}</p>
              {companyName ? <p className="truncate text-xs text-[var(--ui-text-secondary)]">{companyName}</p> : null}
            </div>
            <div className="py-1">
              {onOpenAccount ? (
                <button type="button" role="menuitem" className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium hover:bg-[var(--ui-bg-muted)]" onClick={() => { setOpen(false); onOpenAccount(); }}>
                  Account
                </button>
              ) : null}
              {showCompanySwitcher && onOpenCompanySwitcher ? (
                <button type="button" role="menuitem" className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium hover:bg-[var(--ui-bg-muted)]" onClick={() => { setOpen(false); onOpenCompanySwitcher(); }}>
                  Switch company
                </button>
              ) : null}
              {onHelp ? (
                <button type="button" role="menuitem" className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium hover:bg-[var(--ui-bg-muted)]" onClick={() => { setOpen(false); onHelp(); }}>
                  Help
                </button>
              ) : null}
            </div>
            <div className="border-t border-[var(--ui-border)] pt-1">
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
              >
                <Icon size="sm" aria-hidden>
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </Icon>
                Sign out
              </button>
            </div>
          </div>
        </>
    ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-white"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-[var(--bert-signal-orange)] text-[10px] font-semibold text-[var(--qms-navy-950)]">
            {initials}
          </span>
        )}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
