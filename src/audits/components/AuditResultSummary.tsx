import { Button } from "../../components/ui/Button";
import { Card, CardContent } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/StatusBadge";

export function AuditResultSummary({
  auditName,
  queued,
  resultLabel,
  findingsCount,
  ncrCount,
  syncMessage,
  onReturn,
  onViewCompleted,
}: {
  auditName: string;
  queued: boolean;
  resultLabel?: string;
  findingsCount?: number;
  ncrCount?: number;
  syncMessage?: string;
  onReturn: () => void;
  onViewCompleted?: () => void;
}) {
  return (
    <Card className="max-w-xl">
      <CardContent className="space-y-4 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">
            {queued ? "Queued for sync" : "Audit completed"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-[var(--ui-text-primary)]">{auditName}</h2>
        </div>
        {resultLabel ? (
          <StatusBadge variant={resultLabel.toLowerCase().includes("fail") ? "danger" : "success"}>{resultLabel}</StatusBadge>
        ) : null}
        <ul className="space-y-1 text-sm text-[var(--ui-text-secondary)]">
          {typeof findingsCount === "number" ? <li>{findingsCount} finding(s)</li> : null}
          {typeof ncrCount === "number" ? <li>{ncrCount} NCR(s)</li> : null}
          {syncMessage ? <li>{syncMessage}</li> : null}
          {queued ? <li>Your answers are saved on this device and will upload when you are back online.</li> : null}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onReturn}>
            Return to My Audits
          </Button>
          {onViewCompleted ? (
            <Button variant="outline" onClick={onViewCompleted}>
              View completed audit
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
