import type { ActionListItem } from "../types";
import { Button } from "../../components/ui/Button";
import { Card, CardContent } from "../../components/ui/Card";
import { ActionPriorityBadge } from "./ActionPriorityBadge";
import { ActionStatusBadge } from "./ActionStatusBadge";

export function ActionListCard({
  item,
  onSelect,
}: {
  item: ActionListItem;
  onSelect: (actionId: string) => void;
}) {
  return (
    <li>
      <Card variant="interactive" className="p-0">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-words text-base font-semibold text-[var(--ui-text-primary)]">{item.title}</p>
              <ActionStatusBadge status={item.status} />
              <ActionPriorityBadge priority={item.priority} />
            </div>
            <p className="mt-1 break-words text-sm text-[var(--ui-text-secondary)]">
              {[item.sourceLabel, item.sourceReference, item.area, item.dueLabel].filter(Boolean).join(" • ")}
            </p>
            {item.nextStep ? (
              <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
                <span className="font-semibold">Next:</span> {item.nextStep}
              </p>
            ) : null}
          </div>
          <Button variant="primary" size="sm" className="min-h-[44px] shrink-0" onClick={() => onSelect(item.id)}>
            {item.actionLabel}
          </Button>
        </CardContent>
      </Card>
    </li>
  );
}
