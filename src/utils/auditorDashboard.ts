import type { AuditDraft } from "../types/dashboardScreenProps";
import type { Audit } from "../types/reportsScreenProps";
import { getAuditTrafficStatus } from "./dashboardHealth";

export function rankAuditorAudit(audit: Audit, hasDraft: boolean) {
  if (hasDraft) return 0;
  if (audit.dueHours < 0) return 1;
  if (getAuditTrafficStatus(audit.dueHours) === "amber") return 2;
  if (audit.dueHours <= 24) return 3;
  return 4;
}

export function pickNextAuditorAudit(audits: Audit[], drafts: Record<string, AuditDraft>) {
  return (
    [...audits].sort((a, b) => {
      const rankDiff = rankAuditorAudit(a, Boolean(drafts[a.id])) - rankAuditorAudit(b, Boolean(drafts[b.id]));
      if (rankDiff !== 0) return rankDiff;
      return a.dueHours - b.dueHours;
    })[0] ?? null
  );
}
