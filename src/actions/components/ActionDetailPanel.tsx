import { useTranslation } from "react-i18next";
import type { Role } from "../../permissions";
import { getRolePermissions } from "../../permissions";
import type { ActionItem, ActionStatus } from "../../types/reportsScreenProps";
import { ArchiveRecordButton } from "../../components/archive/ArchiveRecordButton";
import { MetaPill } from "../../components/dashboard/DashboardPrimitives";
import { Card, CardContent } from "../../components/ui/Card";
import { Section } from "../../components/ui/PageLayout";
import { getRecordNextStepText } from "../../utils/recordNextStep";
import type { ActionListItem } from "../types";
import { ActionActivityTimeline } from "./ActionActivityTimeline";
import { ActionCompletionReview, actionReadyForCompletionReview } from "./ActionCompletionReview";
import { ActionDetailHeader } from "./ActionDetailHeader";
import { ActionUpdateComposer } from "./ActionUpdateComposer";
import { ActionVerificationPanel } from "./ActionVerificationPanel";

export function ActionDetailPanel({
  item,
  role,
  canReviewSuggestions,
  availableAuditors,
  syncQueued = false,
  offlineMode = false,
  onAdvanceAction,
  onAssignAction,
  onAddEvidence,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion,
  archiveCompanyFolderId,
  archiveMasterSheetId,
  archiveOffline,
  canArchiveAction,
  onActionArchived,
  onArchiveError,
  onArchiveSuccess,
  onNavigateToTarget,
}: {
  item: ActionListItem;
  role: Role;
  canReviewSuggestions: boolean;
  availableAuditors: string[];
  syncQueued?: boolean;
  offlineMode?: boolean;
  onAdvanceAction: (actionId: string, nextStatus?: ActionStatus) => void;
  onAssignAction: (actionId: string, assignee: string) => void;
  onAddEvidence: (actionId: string, files: FileList) => void;
  onAcceptSuggestion: (actionId: string) => void;
  onEditSuggestion: (actionId: string) => void;
  onIgnoreSuggestion: (actionId: string) => void;
  archiveCompanyFolderId?: string;
  archiveMasterSheetId?: string;
  archiveOffline?: boolean;
  canArchiveAction?: boolean;
  onActionArchived?: (actionId: string) => void | Promise<void>;
  onArchiveError?: (message: string) => void;
  onArchiveSuccess?: () => void;
  onNavigateToTarget?: (target: import("../../presentation/searchPresentation").SearchNavigateTarget, route?: string) => void;
}) {
  const { t } = useTranslation();
  const action = item.action;
  const permissions = getRolePermissions(role);
  const nextStep = getRecordNextStepText("action", action.status, role, {
    evidenceRequired: action.evidenceRequired,
    evidenceCount: action.evidenceCount,
  });

  return (
    <div className="space-y-4">
      <Card className="p-0">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ActionDetailHeader item={item} onNavigateToTarget={onNavigateToTarget} />
            {canArchiveAction && archiveCompanyFolderId && onActionArchived ? (
              <ArchiveRecordButton
                recordType="action"
                recordId={action.id}
                companyFolderId={archiveCompanyFolderId}
                masterSheetId={archiveMasterSheetId}
                offlineMode={archiveOffline}
                canArchive={canArchiveAction}
                label={t("actions.archiveAction")}
                extraMessage="It will be hidden from active views and can be restored from Archive."
                onArchived={() => onActionArchived(action.id)}
                onError={onArchiveError}
                onSuccess={onArchiveSuccess}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Section title="Action required">
        <p className="text-sm leading-relaxed text-[var(--ui-text-secondary)]">{action.questionText}</p>
        <p className="mt-3 rounded-xl border border-sky-100 bg-sky-50/90 px-3 py-2 text-sm text-slate-800">
          <span className="font-semibold text-slate-900">Next step. </span>
          {nextStep.replace(/^Next step:\s*/i, "")}
        </p>
        {action.status !== "Closed" && action.evidenceRequired && action.evidenceCount === 0 ? (
          <p className="mt-2 text-xs font-semibold text-amber-800">Photos are still required before this can be verified.</p>
        ) : null}
      </Section>

      <Section title="Background / source">
        <p className="text-sm text-[var(--ui-text-secondary)]">{action.sourceAnswer}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {action.nonConformanceId ? <MetaPill icon="warningTriangle" label={`NCR ${action.nonConformanceId}`} /> : null}
          {action.auditName ? <MetaPill icon="clipboard" label={action.auditName} /> : null}
          <MetaPill icon="spark" label={action.severity} />
          <MetaPill icon="clipboard" label={action.riskCategory} />
          {action.siteArea ? <MetaPill icon="clipboard" label={action.siteArea} /> : null}
        </div>
      </Section>

      <Section title="Ownership and due date">
        {permissions.canAssignActions ? (
          <select
            value={action.assignedToName}
            onChange={(event) => onAssignAction(action.id, event.target.value)}
            className="min-h-[44px] w-full max-w-md rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-4 text-sm"
            aria-label="Assign action"
          >
            {[action.assignedToName, ...availableAuditors]
              .filter((value, index, list) => value && list.indexOf(value) === index)
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        ) : (
          <p className="text-sm text-[var(--ui-text-secondary)]">Assigned to {action.assignedToName}</p>
        )}
        <p className="mt-2 text-sm text-[var(--ui-text-secondary)]">Due {action.dueDate || action.dueLabel}</p>
      </Section>

      {canReviewSuggestions ? (
        <ActionVerificationPanel
          action={action}
          onAcceptSuggestion={onAcceptSuggestion}
          onEditSuggestion={onEditSuggestion}
          onIgnoreSuggestion={onIgnoreSuggestion}
        />
      ) : null}

      {action.correctiveAction?.trim() && action.suggestionStatus && action.suggestionStatus !== "suggested" ? (
        <Section title="Corrective action">
          <p className="text-sm text-[var(--ui-text-secondary)]">{action.correctiveAction}</p>
        </Section>
      ) : null}

      <ActionUpdateComposer
        action={action}
        role={role}
        permissions={permissions}
        syncQueued={syncQueued}
        onAdvanceAction={onAdvanceAction}
        onAddEvidence={(files) => onAddEvidence(action.id, files)}
      />

      {actionReadyForCompletionReview(item, role) ? (
        <ActionCompletionReview item={item} offlineMode={offlineMode} />
      ) : null}

      <ActionActivityTimeline action={action} />

      {(action.rootCause || action.preventiveAction) && (
        <Section title="Related records">
          {action.rootCause ? <p className="text-sm text-[var(--ui-text-secondary)]">Root cause: {action.rootCause}</p> : null}
          {action.preventiveAction ? (
            <p className="mt-2 text-sm text-[var(--ui-text-secondary)]">Preventive action: {action.preventiveAction}</p>
          ) : null}
        </Section>
      )}
    </div>
  );
}
