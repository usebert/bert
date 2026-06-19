/** @deprecated Import from schedule-assignees.mjs — re-exported for backward compatibility. */
export {
  normalize,
  parseCompanyAreasList,
  isActiveUser,
  isActiveCompanyUser,
  canCompleteAudit,
  isAuditorUser,
  belongsToCurrentCompany,
  parseRoleForClient,
  matchesScheduleAreaFilter,
  buildScheduleAssigneeDiagnostics,
  buildScheduleAuditorDiagnostics,
  buildAvailableScheduleAssigneesFromUsers,
  buildAvailableScheduleAuditorsFromUsers,
  findPendingAssigneeInvites,
  findPendingAuditorInvites,
  inviteAccessLevelForRole,
} from "./schedule-assignees.mjs";
