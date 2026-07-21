import type { AuditListItem } from "../types";
import { Button } from "../../components/ui/Button";
import { Card, CardContent } from "../../components/ui/Card";
import { AuditStatusBadge } from "./AuditStatusBadge";

export function AuditListCard({ item, onOpenAudit }: { item: AuditListItem; onOpenAudit: (auditId: string) => void }) {
  return (
    <li>
      <Card variant="interactive" className="p-0">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-words text-base font-semibold text-[var(--ui-text-primary)]">{item.name}</p>
              <AuditStatusBadge status={item.status} />
            </div>
            <p className="mt-1 break-words text-sm text-[var(--ui-text-secondary)]">
              {[item.area, item.dueLabel, item.scheduleName].filter(Boolean).join(" • ")}
            </p>
            {item.progressLabel ? <p className="mt-1 text-xs text-[var(--ui-text-muted)]">{item.progressLabel}</p> : null}
          </div>
          <Button variant="primary" size="sm" className="min-h-[44px] shrink-0" onClick={() => onOpenAudit(item.id)}>
            {item.actionLabel}
          </Button>
        </CardContent>
      </Card>
    </li>
  );
}
