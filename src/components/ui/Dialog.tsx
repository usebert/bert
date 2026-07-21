import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../styles/ui-foundation";
import { lockDialogScroll } from "./dialogScrollLock";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** When false, Escape does not close (e.g. destructive in-progress). */
  closeOnEscape?: boolean;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  size?: "md" | "lg" | "xl";
};

const sizeClasses = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Dialog({
  open,
  onClose,
  children,
  closeOnEscape = true,
  labelledBy,
  describedBy,
  className,
  size = "lg",
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const defaultTitleId = useId();

  useEffect(() => {
    if (!open) return;
    const unlock = lockDialogScroll();
    const previousFocus = document.activeElement as HTMLElement | null;
    const timer = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(timer);
      document.removeEventListener("keydown", onKeyDown);
      unlock();
      previousFocus?.focus?.();
    };
  }, [open, closeOnEscape, onClose]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--ui-z-dialog)] flex items-end justify-center p-3 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-slate-950/45"
        onClick={closeOnEscape ? onClose : undefined}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || defaultTitleId}
        aria-describedby={describedBy}
        className={cn(
          "bert-ui-dialog-enter relative flex max-h-[min(100dvh,920px)] w-full flex-col overflow-hidden rounded-[var(--ui-radius-lg)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] shadow-[var(--ui-shadow-lg)]",
          sizeClasses[size],
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        "shrink-0 border-b border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-4 py-3 sm:px-5",
        className,
      )}
    >
      {children}
    </header>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5", className)}>
      {children}
    </div>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <footer
      className={cn(
        "shrink-0 border-t border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="flex flex-wrap justify-end gap-2">{children}</div>
    </footer>
  );
}

export function DialogTitle({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  const generatedId = useId();
  const resolvedId = id || generatedId;
  return (
    <h2 id={resolvedId} className={cn("text-lg font-semibold text-[var(--ui-text-primary)]", className)}>
      {children}
    </h2>
  );
}
