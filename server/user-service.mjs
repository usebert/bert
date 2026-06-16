/**
 * userService — canonical alias for company workbook Users tab operations.
 * All People, schedule-assignees, Godmode users, and dropdowns use listActiveUsers.
 */
export {
  readUsersTab,
  listActiveUsers,
  listActiveCompanyMembers,
  syncAndListActiveUsers,
  getAssignableUsers,
  getCompanyUsers,
  writeUserRow,
  repairUsersTabSchema,
  rebuildUserCacheFromSheet,
} from "./company-user-service.mjs";
