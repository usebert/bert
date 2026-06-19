/**
 * Schedule builder assignee loading — delegates to scheduleService.listSchedulerAssignees.
 */
import { listSchedulerAssignees } from "./schedule-service.mjs";

export async function getScheduleAssigneesForCompany(auth, deps, input = {}) {
  return listSchedulerAssignees(auth, deps, input);
}
