import type { Role } from "../../permissions";
import { ASSIGNED_CHECKS_LOADING_MESSAGE } from "../../services/checkService";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import { AssignedCheckActionRow } from "../checks/AssignedCheckActionRow";
import { AnimatedCard } from "../animation/AnimatedCard";
import {
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
  role?: Role;
  cardIndex?: number;
};

export function DashboardThingsToDoSection({
  assignedAudits,
  drafts,
  scheduleMetaByAuditId,
  onOpenAudit,
  loading = false,
  role = "Manager",
  cardIndex = 3,
}: DashboardThingsToDoSectionProps) {
  const sortedChecks = sortAssignedChecksForAction(assignedAudits, drafts);

  return (
    <AnimatedCard as="section" index={cardIndex} className={DASHBOARD_CARD}>
      <h2 className="text-lg font-black text-slate-900">Things to do</h2>
      {loading && sortedChecks.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">{ASSIGNED_CHECKS_LOADING_MESSAGE}</p>
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
