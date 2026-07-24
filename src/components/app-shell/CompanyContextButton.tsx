import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/Icon";

export type CompanySwitcherOption = {
  id: string;
  name: string;
};

type Props = {
  companyName: string;
  showSwitcher: boolean;
  options: CompanySwitcherOption[];
  selectedId: string;
  loading?: boolean;
  error?: string | null;
  onSelect: (companyId: string) => void;
  onRetry?: () => void;
  platformScope?: boolean;
};

const MENU_GAP = 8;
const VIEWPORT_PADDING = 12;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "B";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function buildMenuStyle(trigger: DOMRect): CSSProperties {
  const width = Math.min(320, window.innerWidth - VIEWPORT_PADDING * 2);
  const left = Math.min(
    Math.max(VIEWPORT_PADDING, trigger.left),
    window.innerWidth - VIEWPORT_PADDING - width,
  );
  return {
    position: "fixed",
    top: trigger.bottom + MENU_GAP,
    left,
    width,
    maxHeight: "calc(100dvh - 24px)",
    overflowY: "auto",
  };
}

export function CompanyContextButton({
  companyName,
  showSwitcher,
  options,
  selectedId,
  loading = false,
  error = null,
  onSelect,
  onRetry,
  platformScope = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const ignoreOutsideCloseRef = useRef(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.name.toLowerCase().includes(q));
  }, [options, query]);

  const label = platformScope ? "All workspaces" : companyName || "No company selected";

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    setMenuStyle(buildMenuStyle(trigger));
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuStyle(null);
    setQuery("");
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[company-switcher] resolved workspaces", {
      count: options.length,
      selectedId,
      options: options.map((option) => ({ id: option.id, name: option.name })),
    });
  }, [options, selectedId]);

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
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
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
      setQuery("");
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
        setQuery("");
      }
      return next;
    });
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (open) {
      closeMenu();
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (trigger) {
      setMenuStyle(buildMenuStyle(trigger));
    }
    setOpen(true);
  };

  const stopPanelPropagation = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  if (!showSwitcher) {
    return (
      <div className="hidden min-w-0 max-w-[10rem] items-center gap-2 sm:flex" title={label}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ui-bg-muted)] text-xs font-semibold text-[var(--ui-text-secondary)]">
          {initials(label)}
        </span>
        <span className="truncate text-xs font-semibold text-[var(--ui-text-secondary)]">{label}</span>
      </div>
    );
  }

  const menu =
    open && menuStyle && typeof document !== "undefined" ? (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[100] cursor-default bg-transparent"
          aria-label="Close company switcher"
          tabIndex={-1}
          onClick={closeMenu}
        />
        <div
          ref={menuRef}
          role="listbox"
          data-testid="company-switcher-panel"
          style={menuStyle}
          className="z-[101] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-3 shadow-xl motion-reduce:transition-none"
          aria-label="Switch company"
          onClick={stopPanelPropagation}
          onMouseDown={stopPanelPropagation}
        >
          <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">Switch company</p>
          {options.length > 6 ? (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search companies"
              className="mb-2 min-h-11 w-full rounded-xl border border-[var(--ui-border)] px-3 text-sm"
            />
          ) : null}
          {loading ? <p className="px-2 py-3 text-sm text-[var(--ui-text-secondary)]">Loading companies…</p> : null}
          {error ? (
            <div className="space-y-2 px-2 py-2">
              <p className="text-sm text-[var(--ui-text-primary)]">Companies could not be loaded.</p>
              {onRetry ? (
                <button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-2 text-sm font-semibold underline">
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {!loading && !error ? (
            <div className="max-h-[min(50dvh,18rem)] space-y-1 overflow-y-auto">
              {filtered.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === selectedId}
                  onClick={() => {
                    onSelect(option.id);
                    closeMenu();
                  }}
                  className={[
                    "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium",
                    option.id === selectedId
                      ? "bg-[var(--ui-accent-subtle)] text-[var(--ui-text-primary)]"
                      : "hover:bg-[var(--ui-bg-muted)]",
                  ].join(" ")}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ui-bg-muted)] text-[10px] font-bold">
                    {initials(option.name)}
                  </span>
                  <span className="truncate">{option.name}</span>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-sm text-[var(--ui-text-secondary)]">No companies match your search.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </>
    ) : null;

  return (
    <div className="relative hidden min-w-0 sm:block">
      <button
        ref={triggerRef}
        type="button"
        data-testid="company-switcher-trigger"
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        className="inline-flex min-h-11 max-w-[12rem] items-center gap-2 rounded-full border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ui-text-primary)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch company, current: ${label}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ui-bg-muted)] text-[10px] font-bold">
          {initials(label)}
        </span>
        <span className="truncate">{label}</span>
        <Icon size="sm" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </Icon>
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
