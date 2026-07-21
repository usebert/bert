import type { ActionListItem } from "../types";
import { ActionPriorityBadge } from "./ActionPriorityBadge";
import { ActionStatusBadge } from "./ActionStatusBadge";

export function ActionDetailHeader({ item }: { item: ActionListItem }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActionStatusBadge status={item.status} />
        <ActionPriorityBadge priority={item.priority} />
        {item.urgency !== "Normal" ? (
          <span className="rounded-full bg-[var(--ui-bg-muted)] px-3 py-1 text-xs font-semibold text-[var(--ui-text-primary)]">
            {item.urgency}
          </span>
        ) : null}
      </div>
      <div>
        <h2 className="break-words text-xl font-semibold text-[var(--ui-text-primary)]">{item.title}</h2>
        <p className="mt-1 text-sm text-[var(--ui-text-secondary)]">
          {[item.sourceLabel, item.sourceReference, item.area, item.assignee, item.dueLabel].filter(Boolean).join(" • ")}
        </p>
      </div>
    </div>
  );
}
