import type { Role, RoleTaskPermissions } from "../permissions";
import type { ActionItem, ActionStatus } from "../types/reportsScreenProps";

export type RecordKind = "action" | "audit" | "ncr" | "incident";

/**
 * Short “what happens next” copy for record/detail views.
 */
export function getRecordNextStepText(kind: RecordKind, status: string, role: Role, context?: { evidenceRequired?: boolean; evidenceCount?: number }): string {
  if (kind === "action") {
    const st = status as ActionStatus;
    const needsEvidence = Boolean(context?.evidenceRequired && (context?.evidenceCount ?? 0) === 0);
    if (st === "Open") {
      return "Next step: assign or pick up the work, add notes or photos if required, then move it to In progress when you start the fix.";
    }
    if (st === "In Progress") {
      if (needsEvidence) {
        return "Next step: upload the required photo evidence, then submit for verification.";
      }
      return "Next step: finish the corrective work, attach any proof, then submit for verification.";
    }
    if (st === "Awaiting Verification") {
      const canVerify = role === "Manager" || role === "Admin" || role === "Master";
      if (canVerify) {
        return "Next step: review evidence and notes, then verify and close—or reject with clear feedback.";
      }
      return "Next step: wait for a manager to verify. You will only need to act again if it is rejected.";
    }
    if (st === "Closed") {
      return "Next step: none — this action is closed. Keep the audit record for your history.";
    }
    if (st === "Rejected") {
      return "Next step: read the rejection notes, update evidence or the fix, and resubmit when ready.";
    }
  }
  if (kind === "audit") {
    return "Next step: work through questions in order, capture evidence where required, then submit the audit.";
  }
  if (kind === "ncr") {
    return "Next step: complete the investigation fields, attach evidence, then mark complete when root cause and corrective action are agreed.";
  }
  if (kind === "incident") {
    return "Next step: record facts, assign ownership, and close the loop when containment and verification are done.";
  }
  return "Next step: review the record and follow your workspace procedure.";
}

export type ActionPrimaryCtaKind = "start" | "uploadEvidence" | "submitVerification" | "verifyClose" | "none";

export function getActionPrimaryCTA(action: ActionItem, permissions: RoleTaskPermissions): {
  kind: ActionPrimaryCtaKind;
  label: string;
} {
  if (action.status === "Closed" || action.status === "Rejected") {
    return { kind: "none", label: "" };
  }
  if (action.status === "Open") {
    return { kind: "start", label: "Start work" };
  }
  if (action.status === "In Progress") {
    if (action.evidenceRequired && action.evidenceCount === 0) {
      return { kind: "uploadEvidence", label: "Upload evidence" };
    }
    return { kind: "submitVerification", label: "Mark ready for review" };
  }
  if (action.status === "Awaiting Verification") {
    if (permissions.canVerifyActions) {
      return { kind: "verifyClose", label: "Verify & close" };
    }
    return { kind: "none", label: "" };
  }
  return { kind: "none", label: "" };
}
