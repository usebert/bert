import { useMemo, useState } from "react";
import type { Role } from "../../permissions";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import type { BriefingRecipientRecord, BriefingTeamSummary } from "../../types/briefings";
import { AnimatedCard } from "../animation/AnimatedCard";
import { buildDashboardToDoItems, groupDashboardToDoItems } from "../../utils/dashboardToDo";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { DASHBOARD_CARD } from "./RoleDashboardPrimitives";

type DashboardToDoSectionProps = {
  assignedAudits: Audit[];
  drafts: Record<string, AuditDraft>;
  scheduleMetaByAuditId: Record<string, AssignedCheckScheduleMeta>;
  briefingItems?: BriefingRecipientRecord[];
  onOpenAudit: (auditId: string) => void;
  onOpenBriefing?: (briefingId: string) => void;
  onViewAllBriefings?: () => void;
  loading?: boolean;
  briefingLoading?: boolean;
  loadError?: string;
  loadErrorDetail?: string;
  onRetry?: () => void;
  role?: Role;
  cardIndex?: number;
  teamSummary?: BriefingTeamSummary | null;
  showTeamSummary?: boolean;
};

const PREVIEW_LIMIT = 5;

function ToDoRow({
  title,
  typeLabel,
  dueLabel,
  statusLabel,
  actionLabel,
  onAction,
}: {
  title: string;
  typeLabel: string;
  dueLabel?: string;
  statusLabel?: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{typeLabel}</span>
          {statusLabel ? <span>{statusLabel}</span> : null}
          {dueLabel ? <span>Due {dueLabel}</span> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
      >
        {actionLabel}
      </button>
    </li>
  );
}

export function DashboardToDoSection({
  assignedAudits,
  drafts,
  scheduleMetaByAuditId,
  briefingItems = [],
  onOpenAudit,
  onOpenBriefing,
  onViewAllBriefings,
  loading = false,
  briefingLoading = false,
  loadError,
  loadErrorDetail,
  onRetry,
  role = "Manager",
  cardIndex = 0,
  teamSummary,
  showTeamSummary = false,
}: DashboardToDoSectionProps) {
  void role;
  const [expanded, setExpanded] = useState(false);

  const allItems = useMemo(
    () =>
      buildDashboardToDoItems({
        assignedAudits,
        drafts,
        scheduleMetaByAuditId,
        briefingItems,
      }),
    [assignedAudits, drafts, scheduleMetaByAuditId, briefingItems],
  );

  const grouped = useMemo(() => groupDashboardToDoItems(allItems), [allItems]);
  const previewItems = expanded ? allItems : allItems.slice(0, PREVIEW_LIMIT);
  const previewGrouped = expanded ? grouped : groupDashboardToDoItems(previewItems);
  const isLoading = (loading || briefingLoading) && allItems.length === 0 && !loadError;

  return (
    <AnimatedCard as="section" index={cardIndex} className={[DASHBOARD_CARD, "max-h-[28vh] min-h-[12rem] overflow-hidden"].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">To Do</h2>
          <p className="mt-1 text-sm text-slate-600">Everything you need to deal with right now.</p>
        </div>
        {allItems.length > PREVIEW_LIMIT ? (
          <button
            type="button"
            onClick={() => {
              if (onViewAllBriefings && !expanded) {
                onViewAllBriefings();
                return;
              }
              setExpanded((value) => !value);
            }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
          >
            {expanded ? "Show less" : "View all"}
          </button>
        ) : null}
      </div>

      {showTeamSummary && teamSummary ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          {typeof teamSummary.overdueChecks === "number" ? (
            <span className="rounded-full bg-rose-50 px-2 py-1 text-rose-800">{teamSummary.overdueChecks} overdue checks</span>
          ) : null}
          {typeof teamSummary.unsignedDocuments === "number" ? (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-900">{teamSummary.unsignedDocuments} unsigned</span>
          ) : null}
          {typeof teamSummary.unreadBriefings === "number" ? (
            <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-900">{teamSummary.unreadBriefings} unread briefings</span>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <ul className="mt-4 space-y-3" aria-busy="true" aria-label="Loading to-do items">
          {[0, 1, 2].map((placeholder) => (
            <li key={placeholder} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </ul>
      ) : loadError && allItems.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
          <p className="text-sm font-semibold text-rose-900">Could not load your to-do list</p>
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
      ) : allItems.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">You&apos;re all caught up.</p>
      ) : (
        <div className="mt-4 space-y-4 overflow-y-auto pr-1" style={{ maxHeight: "calc(28vh - 5rem)" }}>
          {previewGrouped.map((section) => (
            <div key={section.group}>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{section.label}</h3>
              <ul className="mt-2 space-y-2">
                {section.items.map((item) => (
                  <ToDoRow
                    key={item.id}
                    title={item.title}
                    typeLabel={item.typeLabel}
                    dueLabel={item.dueLabel}
                    statusLabel={item.statusLabel}
                    actionLabel={item.actionLabel}
                    onAction={() => {
                      if (item.kind === "briefing" && item.briefingId) {
                        onOpenBriefing?.(item.briefingId);
                        return;
                      }
                      if (item.auditId) {
                        onOpenAudit(item.auditId);
                      }
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </AnimatedCard>
  );
}
