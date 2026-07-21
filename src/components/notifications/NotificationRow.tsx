import type { BertNotification, BertNotificationType } from "../../presentation/notificationPresentation";
import { StatusBadge, statusToBadgeVariant } from "../ui/StatusBadge";
import { Icon, IconAlert, IconCheck, IconInbox } from "../ui/Icon";

function NotificationTypeIcon({ type }: { type: BertNotificationType }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-secondary)]">
      {type === "sync" || type === "safety" ? (
        <IconAlert size="sm" />
      ) : type === "action" || type === "audit" ? (
        <IconCheck size="sm" />
      ) : type === "briefing" ? (
        <IconInbox size="sm" />
      ) : (
        <Icon size="sm">
          <path d="M7 4h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" />
        </Icon>
      )}
    </span>
  );
}

function formatAgeLabel(item: BertNotification): string | undefined {
  if (item.status?.toLowerCase().includes("overdue")) return item.status;
  if (item.status === "Due today") return "Due today";
  if (item.dueAt) return item.dueAt;
  return item.status;
}

type Props = {
  item: BertNotification & { isUnread: boolean };
  onOpen: () => void;
  onToggleRead: () => void;
};

export function NotificationRow({ item, onOpen, onToggleRead }: Props) {
  const location = [item.siteName, item.areaName].filter(Boolean).join(" · ");
  const meta = [location, formatAgeLabel(item), item.description].filter(Boolean).join(" · ");

  return (
    <article
      className={[
        "rounded-2xl border px-3 py-3 transition motion-reduce:transition-none",
        item.isUnread
          ? "border-[color-mix(in_srgb,var(--ui-accent)_35%,var(--ui-border))] bg-[var(--ui-accent-subtle)]"
          : "border-[var(--ui-border)] bg-[var(--ui-bg-surface)] hover:bg-[var(--ui-bg-muted)]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <NotificationTypeIcon type={item.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={onOpen}
              className="min-h-11 flex-1 text-left"
              aria-label={`Open notification: ${item.title}`}
            >
              <p className="text-sm font-semibold text-[var(--ui-text-primary)]">{item.title}</p>
              {meta ? <p className="mt-1 text-xs text-[var(--ui-text-secondary)]">{meta}</p> : null}
            </button>
            {item.isUnread ? (
              <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--bert-signal-orange)]" aria-label="Unread" />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.status ? (
              <StatusBadge variant={statusToBadgeVariant(item.status)} dot={false}>
                {item.status}
              </StatusBadge>
            ) : null}
            <button
              type="button"
              onClick={onToggleRead}
              className="min-h-11 rounded-lg px-2 text-xs font-medium text-[var(--ui-text-secondary)] underline-offset-2 hover:underline"
              aria-label={item.isUnread ? "Mark notification as read" : "Mark notification as unread"}
            >
              {item.isUnread ? "Mark read" : "Mark unread"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
