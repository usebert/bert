/** Users tab column definitions — shared without circular imports. */
export const USERS_TAB = "Users";

export const USERS_TAB_REQUIRED_COLUMNS = [
  "Email",
  "Name",
  "Role",
  "AccessLevel",
  "CompanyAreas",
  "Status",
  "PasswordHash",
  "PasswordUpdatedAt",
  "LastLoginAt",
  "InvitedAt",
  "CreatedAt",
  "UpdatedAt",
];

export const USERS_TAB_COLUMNS = [
  "User ID",
  "Company ID",
  ...USERS_TAB_REQUIRED_COLUMNS,
  "Full Name",
  "Created By",
  "Updated By",
  "Sync Status",
  "Sync Attempts",
  "Last Sync Error",
  "Remote Row ID",
  "Schema Version",
];

export const USERS_TAB_MINIMUM_HEADERS = [
  "Email",
  "Name",
  "Role",
  "AccessLevel",
  "Status",
  "CompanyAreas",
  "PasswordHash",
  "CreatedAt",
  "UpdatedAt",
];
