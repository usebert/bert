import type { ActionListItem } from "../types";
import type { SearchNavigateTarget } from "../../presentation/searchPresentation";
import { BertRecordLink } from "../../components/navigation/BertRecordLink";
import { ActionPriorityBadge } from "./ActionPriorityBadge";
import { ActionStatusBadge } from "./ActionStatusBadge";

export function ActionDetailHeader({
  item,
  onNavigateToTarget,
}: {
  item: ActionListItem;
  onNavigateToTarget?: (target: SearchNavigateTarget, route?: string) => void;
}) {
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
          {[item.sourceLabel, item.area, item.assignee, item.dueLabel].filter(Boolean).join(" • ")}
        </p>
        {item.sourceLink && onNavigateToTarget ? (
          <p className="mt-2 text-sm">
            <BertRecordLink
              route={item.sourceLink.route}
              navigate={item.sourceLink.navigate}
              onNavigate={onNavigateToTarget}
              showChevron
              className="font-medium text-[var(--ui-text-primary)]"
            >
              {item.sourceLink.sourceLabel || item.sourceReference}
            </BertRecordLink>
          </p>
        ) : item.sourceReference ? (
          <p className="mt-2 text-sm text-[var(--ui-text-secondary)]">{item.sourceReference}</p>
        ) : null}
      </div>
    </div>
  );
}
