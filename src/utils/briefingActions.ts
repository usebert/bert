import type { BriefingRecipientRecord, BriefingRecipientStatus } from "../types/briefings";

export type BriefingActionKind = "open" | "read" | "acknowledge" | "sign" | "reply";

export type BriefingActionExtras = {
  signatureName?: string;
  replyText?: string;
};

/** Whether open is still required for this recipient. */
export function briefingOpenPending(item: BriefingRecipientRecord): boolean {
  return !item.openedAt;
}

/** Whether a briefing action is still required for this recipient. */
export function briefingActionPending(item: BriefingRecipientRecord, action: BriefingActionKind): boolean {
  const briefing = item.briefing;
  if (!briefing) {
    return false;
  }
  if (action === "open") {
    return briefingOpenPending(item);
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

/** Mirror server recipientNeedsAction for optimistic UI. */
export function briefingRecipientNeedsAction(item: BriefingRecipientRecord): boolean {
  const briefing = item.briefing;
  if (!briefing) {
    return false;
  }
  if (briefing.requiresRead && !item.readAt) {
    return true;
  }
  if (briefing.requiresAcknowledgement && !item.acknowledgedAt) {
    return true;
  }
  if (briefing.requiresSignature && !item.signedAt) {
    return true;
  }
  if (briefing.requiresReply && !item.replyAt) {
    return true;
  }
  if (!briefing.requiresRead && !briefing.requiresAcknowledgement && !briefing.requiresSignature && !briefing.requiresReply) {
    return briefingOpenPending(item);
  }
  return false;
}

export function briefingIsComplete(item: BriefingRecipientRecord): boolean {
  return !briefingRecipientNeedsAction(item);
}

function computeOptimisticRecipientStatus(item: BriefingRecipientRecord): BriefingRecipientStatus {
  const briefing = item.briefing;
  const dueDate = briefing?.dueDate?.trim();
  const overdue =
    Boolean(dueDate) &&
    briefingRecipientNeedsAction(item) &&
    Date.parse(`${dueDate}T23:59:59.999Z`) < Date.now();

  if (overdue) {
    return "Overdue";
  }
  if (briefingIsComplete(item)) {
    return "Complete";
  }
  if (briefing?.requiresReply && item.replyAt) {
    return "Replied";
  }
  if (briefing?.requiresSignature && item.signedAt) {
    return "Signed";
  }
  if (briefing?.requiresAcknowledgement && item.acknowledgedAt) {
    return "Acknowledged";
  }
  if (briefing?.requiresRead && item.readAt) {
    return "Read";
  }
  if (item.openedAt) {
    return "Opened";
  }
  return "New";
}

/** Build an optimistic recipient patch after a user action. */
export function buildOptimisticBriefingPatch(
  action: BriefingActionKind,
  item: BriefingRecipientRecord,
  extras: BriefingActionExtras = {},
): Partial<BriefingRecipientRecord> {
  const now = new Date().toISOString();
  const briefing = item.briefing;
  const next: BriefingRecipientRecord = { ...item };

  if (action === "open" && !next.openedAt) {
    next.openedAt = now;
  }
  if (action === "read" && briefing?.requiresRead && !next.readAt) {
    next.readAt = now;
    if (!next.openedAt) next.openedAt = now;
  }
  if (action === "acknowledge" && briefing?.requiresAcknowledgement && !next.acknowledgedAt) {
    if (briefing.requiresRead && !next.readAt) {
      next.readAt = now;
    }
    next.acknowledgedAt = now;
    if (!next.openedAt) next.openedAt = now;
  }
  if (action === "sign" && briefing?.requiresSignature && !next.signedAt) {
    if (briefing.requiresRead && !next.readAt) {
      next.readAt = now;
    }
    next.signedAt = now;
    next.signatureName = extras.signatureName?.trim() || next.signatureName;
    if (!next.openedAt) next.openedAt = now;
  }
  if (action === "reply" && briefing?.requiresReply && !next.replyAt) {
    if (briefing.requiresRead && !next.readAt) {
      next.readAt = now;
    }
    next.replyAt = now;
    next.replyText = extras.replyText?.trim() || next.replyText;
    if (!next.openedAt) next.openedAt = now;
  }

  const status = computeOptimisticRecipientStatus(next);
  return {
    openedAt: next.openedAt,
    readAt: next.readAt,
    acknowledgedAt: next.acknowledgedAt,
    signedAt: next.signedAt,
    signatureName: next.signatureName,
    replyAt: next.replyAt,
    replyText: next.replyText,
    status,
    needsAction: briefingRecipientNeedsAction(next),
  };
}

/** Next action label in workflow order: open → read → acknowledge → sign → reply. */
export function briefingActionLabel(item: BriefingRecipientRecord): string {
  if (briefingIsComplete(item)) {
    return "Complete";
  }
  const briefing = item.briefing;
  if (!briefing) {
    return "Open";
  }
  if (briefingOpenPending(item) && !briefingHasPendingActions(item)) {
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
  if (briefingOpenPending(item)) {
    return "Open";
  }
  return "Complete";
}

/** Human-readable summary for completed briefings. */
export function briefingCompletionSummary(item: BriefingRecipientRecord): string {
  if (!briefingIsComplete(item)) {
    return briefingActionLabel(item);
  }
  const briefing = item.briefing;
  if (!briefing) {
    return "Complete";
  }
  const parts: string[] = [];
  if (briefing.requiresRead && item.readAt) {
    parts.push("Read");
  }
  if (briefing.requiresAcknowledgement && item.acknowledgedAt) {
    parts.push("acknowledged");
  }
  if (briefing.requiresSignature && item.signedAt) {
    parts.push("signed");
  }
  if (briefing.requiresReply && item.replyAt) {
    parts.push("replied");
  }
  if (parts.length === 0) {
    return "Complete";
  }
  if (parts.length === 1) {
    const single = parts[0];
    return single.charAt(0).toUpperCase() + single.slice(1);
  }
  const last = parts.pop();
  return `${parts.join(", ")} and ${last}`;
}

export function briefingHasPendingActions(item: BriefingRecipientRecord): boolean {
  return (
    briefingActionPending(item, "read") ||
    briefingActionPending(item, "acknowledge") ||
    briefingActionPending(item, "sign") ||
    briefingActionPending(item, "reply")
  );
}

export function briefingActionInFlightKey(briefingId: string, action: BriefingActionKind): string {
  return `${briefingId}::${action}`;
}
