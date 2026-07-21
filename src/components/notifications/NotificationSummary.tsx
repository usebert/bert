type Props = {
  total: number;
  unreadCount: number;
};

export function NotificationSummary({ total, unreadCount }: Props) {
  return (
    <p className="text-xs text-[var(--ui-text-secondary)]">
      {total === 0
        ? "No active notifications"
        : `${total} notification${total === 1 ? "" : "s"} · ${unreadCount} unread`}
    </p>
  );
}
