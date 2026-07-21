import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
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

const MENU_GAP = 8;
const VIEWPORT_PADDING = 12;

function buildMenuStyle(trigger: DOMRect): CSSProperties {
  return {
    position: "fixed",
    top: trigger.bottom + MENU_GAP,
    right: Math.max(VIEWPORT_PADDING, window.innerWidth - trigger.right),
    width: "min(320px, calc(100vw - 24px))",
    maxHeight: "calc(100dvh - 24px)",
    overflowY: "auto",
  };
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const ignoreOutsideCloseRef = useRef(false);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    setMenuStyle(buildMenuStyle(trigger));
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuStyle(null);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", updatePosition);
    viewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      viewport?.removeEventListener("resize", updatePosition);
      viewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ignoreOutsideCloseRef.current) return;
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setMenuStyle(null);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    ignoreOutsideCloseRef.current = true;
    window.setTimeout(() => {
      ignoreOutsideCloseRef.current = false;
    }, 0);
    setOpen((current) => {
      const next = !current;
      if (next) {
        const trigger = triggerRef.current?.getBoundingClientRect();
        if (trigger) {
          setMenuStyle(buildMenuStyle(trigger));
        }
      } else {
        setMenuStyle(null);
      }
      return next;
    });
  };

  const stopPanelPropagation = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const menu =
    open && menuStyle && typeof document !== "undefined" ? (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[100] cursor-default bg-transparent"
          aria-label="Close account menu"
          tabIndex={-1}
          onClick={closeMenu}
        />
        <div
          ref={menuRef}
          role="menu"
          data-testid="account-menu-panel"
          style={menuStyle}
          className="z-[101] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-2 shadow-xl motion-reduce:transition-none"
          onClick={stopPanelPropagation}
          onMouseDown={stopPanelPropagation}
        >
          <div className="border-b border-[var(--ui-border)] px-3 py-3">
            <p className="truncate text-sm font-semibold text-[var(--ui-text-primary)]">{displayName}</p>
            {email ? <p className="truncate text-xs text-[var(--ui-text-secondary)]">{email}</p> : null}
            <p className="mt-1 text-[11px] font-medium text-[var(--ui-text-muted)]">{resolveHeaderRoleLabel(role)}</p>
            {companyName ? <p className="truncate text-xs text-[var(--ui-text-secondary)]">{companyName}</p> : null}
          </div>
          <div className="py-1">
            {onOpenAccount ? (
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium hover:bg-[var(--ui-bg-muted)]"
                onClick={() => {
                  closeMenu();
                  onOpenAccount();
                }}
              >
                Account
              </button>
            ) : null}
            {showCompanySwitcher && onOpenCompanySwitcher ? (
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium hover:bg-[var(--ui-bg-muted)]"
                onClick={() => {
                  closeMenu();
                  onOpenCompanySwitcher();
                }}
              >
                Switch company
              </button>
            ) : null}
            {onHelp ? (
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium hover:bg-[var(--ui-bg-muted)]"
                onClick={() => {
                  closeMenu();
                  onHelp();
                }}
              >
                Help
              </button>
            ) : null}
          </div>
          <div className="border-t border-[var(--ui-border)] pt-1">
            <button
              type="button"
              role="menuitem"
              data-testid="account-menu-sign-out"
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              onClick={() => {
                closeMenu();
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
        data-testid="account-menu-trigger"
        onClick={handleTriggerClick}
        onMouseDown={(event) => event.stopPropagation()}
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
