import type { ActionItem } from "../../types/reportsScreenProps";
import type { RoleTaskPermissions } from "../../permissions";
import type { Role } from "../../permissions";
import { getActionPrimaryCTA } from "../../utils/recordNextStep";
import { Button } from "../../components/ui/Button";
import { ActionEvidencePanel } from "./ActionEvidencePanel";

export function ActionUpdateComposer({
  action,
  role,
  permissions,
  syncQueued,
  onAdvanceAction,
  onAddEvidence,
}: {
  action: ActionItem;
  role: Role;
  permissions: RoleTaskPermissions;
  syncQueued?: boolean;
  onAdvanceAction: (actionId: string, nextStatus?: import("../../types/reportsScreenProps").ActionStatus) => void;
  onAddEvidence: (files: FileList) => void;
}) {
  const cta = getActionPrimaryCTA(action, permissions);

  return (
    <section aria-label="Updates and evidence" className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--ui-text-primary)]">Updates and evidence</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {cta.kind === "uploadEvidence" ? (
          <ActionEvidencePanel
            action={action}
            onAddEvidence={onAddEvidence}
            triggerLabel="Upload evidence"
            primary
            syncQueued={syncQueued}
          />
        ) : cta.kind === "start" ? (
          <Button variant="primary" className="min-h-[44px]" onClick={() => onAdvanceAction(action.id, "In Progress")}>
            {cta.label}
          </Button>
        ) : cta.kind === "submitVerification" ? (
          <Button variant="primary" className="min-h-[44px]" onClick={() => onAdvanceAction(action.id, "Awaiting Verification")}>
            {cta.label}
          </Button>
        ) : cta.kind === "verifyClose" ? (
          <Button variant="primary" className="min-h-[44px]" onClick={() => onAdvanceAction(action.id, "Closed")}>
            {cta.label}
          </Button>
        ) : (
          <p className="text-sm text-[var(--ui-text-secondary)]">No further actions from you on this item.</p>
        )}
        {action.status === "In Progress" && cta.kind === "uploadEvidence" ? (
          <Button variant="outline" className="min-h-[44px]" onClick={() => onAdvanceAction(action.id, "Awaiting Verification")}>
            Mark ready for review
          </Button>
        ) : null}
        {permissions.canVerifyActions && action.status === "Awaiting Verification" ? (
          <Button variant="danger" className="min-h-[44px]" onClick={() => onAdvanceAction(action.id, "Rejected")}>
            Reject with feedback
          </Button>
        ) : null}
      </div>
      {action.status !== "Closed" && cta.kind !== "uploadEvidence" ? (
        <ActionEvidencePanel action={action} onAddEvidence={onAddEvidence} syncQueued={syncQueued} />
      ) : null}
      {syncQueued ? (
        <p className="text-sm text-[var(--ui-text-secondary)]" role="status">
          You are offline or this update is queued. Changes remain on this device until sync completes.
        </p>
      ) : null}
      <p className="sr-only">Role {role}</p>
    </section>
  );
}
