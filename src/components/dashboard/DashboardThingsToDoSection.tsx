import type { Role } from "../../permissions";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import { AssignedCheckActionRow } from "../checks/AssignedCheckActionRow";
import { AnimatedCard } from "../animation/AnimatedCard";
import {
  filterAssignedChecksForThingsToDo,
  sortAssignedChecksForAction,
  type AssignedCheckScheduleMeta,
} from "../../utils/assignedCheckDisplay";
import { DASHBOARD_CARD } from "./RoleDashboardPrimitives";

type DashboardThingsToDoSectionProps = {
  assignedAudits: Audit[];
  drafts: Record<string, AuditDraft>;
  scheduleMetaByAuditId: Record<string, AssignedCheckScheduleMeta>;
  onOpenAudit: (auditId: string) => void;
  loading?: boolean;
  loadError?: string;
  loadErrorDetail?: string;
  onRetry?: () => void;
  role?: Role;
  cardIndex?: number;
};

export function DashboardThingsToDoSection({
  assignedAudits,
  drafts,
  scheduleMetaByAuditId,
  onOpenAudit,
  loading = false,
  loadError,
  loadErrorDetail,
  onRetry,
  role = "Manager",
  cardIndex = 3,
}: DashboardThingsToDoSectionProps) {
  const dueChecks = filterAssignedChecksForThingsToDo(assignedAudits, drafts, scheduleMetaByAuditId);
  const sortedChecks = sortAssignedChecksForAction(dueChecks, drafts);

  return (
    <AnimatedCard as="section" index={cardIndex} className={DASHBOARD_CARD}>
      <h2 className="text-lg font-black text-slate-900">Things to do</h2>
      <p className="mt-1 text-sm text-slate-600">Checks that are due, overdue, or in progress.</p>
      {loading && sortedChecks.length === 0 && !loadError ? (
        <ul className="mt-4 space-y-3" aria-busy="true" aria-label="Loading checks">
          {[0, 1, 2].map((placeholder) => (
            <li key={placeholder} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </ul>
      ) : loadError && sortedChecks.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
          <p className="text-sm font-semibold text-rose-900">Could not load your checks</p>
          <p className="mt-2 text-sm text-rose-800">{loadError}</p>
          {loadErrorDetail ? (
            <p className="mt-2 break-all font-mono text-xs text-rose-700">{loadErrorDetail}</p>
          ) : null}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-xl bg-rose-900 px-3 py-2 text-xs font-semibold text-white"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : sortedChecks.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No checks due right now.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sortedChecks.slice(0, 8).map((audit) => (
            <AssignedCheckActionRow
              key={audit.id}
              audit={audit}
              drafts={drafts}
              scheduleMeta={scheduleMetaByAuditId[audit.id]}
              onOpenAudit={onOpenAudit}
              themeRole={role}
            />
          ))}
        </ul>
      )}
    </AnimatedCard>
  );
}
