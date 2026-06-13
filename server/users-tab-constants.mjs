/** Users tab column definitions — shared without circular imports. */
export const USERS_TAB = "Users";

/** Canonical column order — Company cols match workbook company context. */
export const USERS_TAB_CORE_COLUMNS = [
  "Email",
  "Name",
  "Company",
  "CompanyId",
  "CompanyFolderId",
  "Role",
  "AccessLevel",
  "Status",
  "CompanyAreas",
  "PasswordHash",
  "CreatedAt",
  "UpdatedAt",
];

export const USERS_TAB_REQUIRED_COLUMNS = [...USERS_TAB_CORE_COLUMNS];

export const USERS_TAB_MINIMUM_HEADERS = [...USERS_TAB_CORE_COLUMNS];

export const USERS_TAB_COLUMNS = [
  ...USERS_TAB_CORE_COLUMNS,
  "PasswordUpdatedAt",
  "LastLoginAt",
  "InvitedAt",
  "User ID",
  "Company ID",
  "Full Name",
  "Created By",
  "Updated By",
  "Sync Status",
  "Sync Attempts",
  "Last Sync Error",
  "Remote Row ID",
  "Schema Version",
];
