import type { Role } from "../../permissions";
import { getRoleTheme } from "../../config/roleTheme";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import {
  assignedCheckDetailLine,
  assignedCheckStatusLabel,
  type AssignedCheckScheduleMeta,
} from "../../utils/assignedCheckDisplay";

type AssignedCheckActionRowProps = {
  audit: Audit;
  drafts: Record<string, AuditDraft>;
  scheduleMeta?: AssignedCheckScheduleMeta;
  onOpenAudit: (auditId: string) => void;
  themeRole?: Role;
  completedForCurrentDue?: boolean;
};

export function AssignedCheckActionRow({
  audit,
  drafts,
  scheduleMeta,
  onOpenAudit,
  themeRole = "Auditor",
  completedForCurrentDue = false,
}: AssignedCheckActionRowProps) {
  const inProgress = Boolean(drafts[audit.id]);
  const theme = getRoleTheme(themeRole);
  const status = assignedCheckStatusLabel(audit, inProgress, completedForCurrentDue);
  const isCompleted = completedForCurrentDue && !inProgress;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-4 shadow-sm sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-slate-900">{audit.name}</p>
        <p className="mt-1 text-sm text-slate-600">
          {status} · {assignedCheckDetailLine(audit, scheduleMeta)}
        </p>
        {isCompleted && audit.lastCompletedAt !== "Not yet completed" ? (
          <p className="mt-1 text-xs text-emerald-700">Completed {audit.lastCompletedAt}</p>
        ) : null}
      </div>
      {isCompleted ? (
        <span className="min-h-[2.75rem] shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-semibold text-emerald-800">
          Completed
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onOpenAudit(audit.id)}
          className={[
            "min-h-[2.75rem] shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition active:scale-[0.98]",
            theme.primaryButton,
            theme.primaryButtonHover,
          ].join(" ")}
        >
          {inProgress ? "Continue" : "Start"}
        </button>
      )}
    </li>
  );
}
