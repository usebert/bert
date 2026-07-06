import type { BriefingRecipientRecord } from "../types/briefings";

export type BriefingActionKind = "read" | "acknowledge" | "sign" | "reply";

/** Whether a briefing action is still required for this recipient. */
export function briefingActionPending(item: BriefingRecipientRecord, action: BriefingActionKind): boolean {
  const briefing = item.briefing;
  if (!briefing) {
    return false;
  }
  if (action === "read") {
    return briefing.requiresRead && !item.readAt;
  }
  if (action === "acknowledge") {
    return briefing.requiresAcknowledgement && !item.acknowledgedAt;
  }
  if (action === "sign") {
    return briefing.requiresSignature && !item.signedAt;
  }
  if (action === "reply") {
    return briefing.requiresReply && !item.replyAt;
  }
  return false;
}

/** Next action label in workflow order: read → acknowledge → sign → reply. */
export function briefingActionLabel(item: BriefingRecipientRecord): string {
  const briefing = item.briefing;
  if (!briefing) {
    return "Open";
  }
  if (briefing.requiresRead && !item.readAt) {
    return "Read";
  }
  if (briefing.requiresAcknowledgement && !item.acknowledgedAt) {
    return "Acknowledge";
  }
  if (briefing.requiresSignature && !item.signedAt) {
    return "Sign";
  }
  if (briefing.requiresReply && !item.replyAt) {
    return "Reply";
  }
  if (!item.openedAt) {
    return "Open";
  }
  return "Open";
}

export function briefingHasPendingActions(item: BriefingRecipientRecord): boolean {
  return (
    briefingActionPending(item, "read") ||
    briefingActionPending(item, "acknowledge") ||
    briefingActionPending(item, "sign") ||
    briefingActionPending(item, "reply")
  );
}
