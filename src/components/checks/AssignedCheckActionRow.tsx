import type { Role } from "../../permissions";
import { getRoleTheme } from "../../config/roleTheme";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import {
  assignedCheckCardStatus,
  assignedCheckDueWindowLine,
  assignedCheckFrequencyLine,
  assignedCheckStatusTone,
  type AssignedCheckScheduleMeta,
} from "../../utils/assignedCheckDisplay";
import { shouldHideAssignedCheckAfterCompletion } from "../../utils/assignedCheckCompletion";

type AssignedCheckActionRowProps = {
  audit: Audit;
  drafts: Record<string, AuditDraft>;
  scheduleMeta?: AssignedCheckScheduleMeta;
  onOpenAudit: (auditId: string) => void;
  themeRole?: Role;
};

const statusToneClasses = {
  danger: "border-rose-200 bg-rose-50 text-rose-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
} as const;

export function AssignedCheckActionRow({
  audit,
  drafts,
  scheduleMeta,
  onOpenAudit,
  themeRole = "Auditor",
}: AssignedCheckActionRowProps) {
  const inProgress = Boolean(drafts[audit.id]);
  const theme = getRoleTheme(themeRole);
  const completedForCurrentDue = scheduleMeta?.completedForCurrentDue === true;
  const hideAfterCompletion = shouldHideAssignedCheckAfterCompletion(scheduleMeta?.completionMode);
  const isOncePerPeriodComplete = completedForCurrentDue && hideAfterCompletion;
  const isRepeatableComplete = completedForCurrentDue && !hideAfterCompletion;
  const status = assignedCheckCardStatus(
    audit,
    inProgress,
    completedForCurrentDue,
    scheduleMeta?.completionMode,
  );
  const statusTone = assignedCheckStatusTone(status);
  const frequencyLine = assignedCheckFrequencyLine(scheduleMeta);
  const dueWindowLine = assignedCheckDueWindowLine(audit, scheduleMeta);
  const actionLabel = inProgress ? "Continue check" : isRepeatableComplete ? "Start check" : "Start check";

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-4 shadow-sm sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold text-slate-900">{audit.name}</p>
          <span
            className={[
              "inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
              statusToneClasses[statusTone],
            ].join(" ")}
          >
            {status}
          </span>
        </div>
        {frequencyLine ? <p className="mt-1 text-sm text-slate-600">{frequencyLine}</p> : null}
        <p className="mt-1 text-sm text-slate-600">{dueWindowLine}</p>
        {scheduleMeta?.scheduleName ? (
          <p className="mt-1 text-xs text-slate-500">{scheduleMeta.scheduleName}</p>
        ) : null}
        {isOncePerPeriodComplete && audit.lastCompletedAt !== "Not yet completed" ? (
          <p className="mt-1 text-xs text-emerald-700">Completed {audit.lastCompletedAt}</p>
        ) : isRepeatableComplete && audit.lastCompletedAt !== "Not yet completed" ? (
          <p className="mt-1 text-xs text-slate-600">Last completed {audit.lastCompletedAt}</p>
        ) : null}
      </div>
      {isOncePerPeriodComplete && !inProgress ? (
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
          {actionLabel}
        </button>
      )}
    </li>
  );
}
