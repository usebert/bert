import type { ActionListItem } from "../types";
import type { Role } from "../../permissions";
import { getRolePermissions } from "../../permissions";
import { Card, CardContent } from "../../components/ui/Card";

export function ActionCompletionReview({
  item,
  offlineMode,
}: {
  item: ActionListItem;
  offlineMode?: boolean;
}) {
  return (
    <Card className="p-0">
      <CardContent className="space-y-2 p-4">
        <h3 className="text-sm font-semibold text-[var(--ui-text-primary)]">Review before completion</h3>
        <p className="text-sm text-[var(--ui-text-secondary)]">{item.nextStep}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--ui-text-secondary)]">
          <li>Required action: {item.title}</li>
          <li>Evidence attached: {item.evidenceCount}</li>
          <li>
            Evidence requirement: {item.evidenceRequired ? "Required before verification" : "Optional"}
          </li>
          <li>Verification required: {item.workflowStatus === "Awaiting Verification" || item.evidenceRequired ? "Yes" : "As per workflow"}</li>
        </ul>
        {offlineMode ? (
          <p className="text-sm font-medium text-amber-800">
            You are offline. Completion will be saved on this device and queued for sync.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function actionReadyForCompletionReview(item: ActionListItem, role: Role): boolean {
  const permissions = getRolePermissions(role);
  return item.workflowStatus === "In Progress" || (item.workflowStatus === "Awaiting Verification" && permissions.canVerifyActions);
}
