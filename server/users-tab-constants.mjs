/** Users tab column definitions — shared without circular imports. */
export const USERS_TAB = "Users";

/** Identity columns every company workbook Users tab must have (BERT Master Sheet cols A–I). */
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

/** Extended metadata columns (BERT Master Sheet cols J–V). */
export const USERS_TAB_EXTENDED_COLUMNS = [
  "User ID",
  "Company ID",
  "PasswordUpdatedAt",
  "LastLoginAt",
  "InvitedAt",
  "Full Name",
  "Created By",
  "Updated By",
  "Sync Status",
  "Sync Attempts",
  "Last Sync Error",
  "Remote Row ID",
  "Schema Version",
];

/** Company context columns appended on wide workbooks (BERT Master Sheet cols W–Y). */
export const USERS_TAB_COMPANY_COLUMNS = ["Company", "CompanyId", "CompanyFolderId"];

/** Full BERT Master Sheet Users tab column order — ground truth from company workbook template. */
export const USERS_TAB_COLUMNS = [
  ...USERS_TAB_MINIMUM_HEADERS,
  ...USERS_TAB_EXTENDED_COLUMNS,
  ...USERS_TAB_COMPANY_COLUMNS,
];

/** Alias for template-order columns (legacy name). */
export const USERS_TAB_CORE_COLUMNS = [...USERS_TAB_COLUMNS];

export const USERS_TAB_REQUIRED_COLUMNS = [...USERS_TAB_MINIMUM_HEADERS];
