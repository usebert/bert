import type { ActionItem } from "../../types/reportsScreenProps";

export function ActionActivityTimeline({ action }: { action: ActionItem }) {
  const events = [
    action.createdAt ? { label: "Created", value: action.createdAt } : null,
    action.dueDate ? { label: "Due", value: action.dueDate } : null,
    action.closedAt ? { label: "Closed", value: action.closedAt } : null,
    action.verificationNotes ? { label: "Verification notes", value: action.verificationNotes } : null,
    action.comments ? { label: "Comments", value: action.comments } : null,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry?.value));

  if (events.length === 0) return null;

  return (
    <section aria-label="Activity history" className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--ui-text-primary)]">Activity history</h3>
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.label} className="rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">{event.label}</p>
            <p className="mt-1 text-sm text-[var(--ui-text-secondary)]">{event.value}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
