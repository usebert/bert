import { NOTIFICATION_FILTERS, type NotificationFilterId } from "../../presentation/notificationPresentation";

type Props = {
  activeFilter: NotificationFilterId;
  availableFilterIds: Set<NotificationFilterId>;
  onChange: (filter: NotificationFilterId) => void;
};

export function NotificationFilters({ activeFilter, availableFilterIds, onChange }: Props) {
  const options = NOTIFICATION_FILTERS.filter((option) => availableFilterIds.has(option.id));

  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Notification filters">
      {options.map((option) => {
        const active = option.id === activeFilter;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={[
              "shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition motion-reduce:transition-none",
              active
                ? "border-[var(--ui-accent)] bg-[var(--ui-accent-subtle)] text-[var(--ui-text-primary)]"
                : "border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-surface)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
