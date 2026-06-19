import type { ActionItem } from "../types/reportsScreenProps";

export function isOverdue(action: ActionItem) {
  return action.status !== "Closed" && action.dueHours < 0;
}

export function isEscalated(action: ActionItem) {
  if (action.escalated !== undefined) {
    return action.escalated;
  }
  return isOverdue(action) && Math.abs(action.dueHours) > 24;
}

export function isStuck(action: ActionItem) {
  if (action.isStuck !== undefined) {
    return action.isStuck;
  }
  return action.status === "Awaiting Verification" && action.dueHours < -24;
}
