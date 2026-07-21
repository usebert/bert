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

const VIEWPORT_PADDING = 12;
const MENU_GAP = 8;
const DEFAULT_MENU_WIDTH = 288;

function buildMeasureStyle(trigger: DOMRect): CSSProperties {
  return {
    position: "fixed",
    visibility: "hidden",
    top: trigger.bottom + MENU_GAP,
    left: Math.max(
      VIEWPORT_PADDING,
      Math.min(
        trigger.right - DEFAULT_MENU_WIDTH,
        window.innerWidth - DEFAULT_MENU_WIDTH - VIEWPORT_PADDING,
      ),
    ),
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "calc(100dvh - 24px)",
    overflowY: "auto",
  };
}

function useAccountMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    let raf = 0;

    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menuEl = menuRef.current;
      if (!trigger) return;

      if (!menuEl) {
        setStyle(buildMeasureStyle(trigger));
        return;
      }

      const menuWidth = menuEl.getBoundingClientRect().width;
      if (menuWidth <= 0) {
        setStyle(buildMeasureStyle(trigger));
        return;
      }

      const menuHeight = menuEl.getBoundingClientRect().height;

      let left = trigger.right - menuWidth;
      left = Math.max(
        VIEWPORT_PADDING,
        Math.min(left, window.innerWidth - menuWidth - VIEWPORT_PADDING),
      );

      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      let top = trigger.bottom + MENU_GAP;
      const fitsBelow = top + menuHeight <= viewportHeight - VIEWPORT_PADDING;
      if (!fitsBelow && menuHeight > 0) {
        const aboveTop = trigger.top - menuHeight - MENU_GAP;
        if (aboveTop >= VIEWPORT_PADDING) {
          top = aboveTop;
        } else {
          top = Math.max(
            VIEWPORT_PADDING,
            Math.min(top, viewportHeight - menuHeight - VIEWPORT_PADDING),
          );
        }
      }

      setStyle({
        position: "fixed",
        top,
        left,
        visibility: "visible",
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "calc(100dvh - 24px)",
        overflowY: "auto",
      });
    };

    update();
    raf = window.requestAnimationFrame(update);

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);

    const resizeObserver =
      menuRef.current && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => update())
        : null;
    if (menuRef.current && resizeObserver) {
      resizeObserver.observe(menuRef.current);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
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
  const resolvedMenuStyle =
    menuStyle ??
    (open && triggerRef.current
      ? buildMeasureStyle(triggerRef.current.getBoundingClientRect())
      : undefined);

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
          style={resolvedMenuStyle}
          className="z-[71] w-[min(18rem,calc(100vw-24px))] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-2 shadow-xl motion-reduce:transition-none"
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
