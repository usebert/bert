import { forwardRef } from "react";
import { IconBell } from "../ui/Icon";

type Props = {
  unreadCount: number;
  open: boolean;
  onClick: () => void;
};

function formatBadgeCount(count: number): string {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

export const NotificationButton = forwardRef<HTMLButtonElement, Props>(function NotificationButton(
  { unreadCount, open, onClick },
  ref,
) {
  const badge = formatBadgeCount(unreadCount);
  const label =
    unreadCount > 0
      ? `Notifications, ${unreadCount > 99 ? "99 plus" : unreadCount} unread`
      : "Notifications";

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={[
        "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition motion-reduce:transition-none",
        open
          ? "border-[var(--ui-accent)] bg-[var(--ui-accent-subtle)] text-[var(--ui-text-primary)]"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
      ].join(" ")}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
    >
      <IconBell size="sm" />
      {badge ? (
        <span className="absolute -top-1 -right-1 inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-[var(--bert-signal-orange)] px-1 text-[10px] font-bold text-[var(--qms-navy-950)]">
          {badge}
        </span>
      ) : null}
    </button>
  );
});
