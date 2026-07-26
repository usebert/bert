/**
 * Protected demo environment configuration (Midlands Precast Concrete Ltd).
 * Safe for scripts and server — never logs passwords.
 *
 * Dovecote Manufacturing Ltd remains on shared/demo-company-seed.mjs and is untouched here.
 */
import { sanitizeCompanyFolderId, sanitizeGoogleSpreadsheetId } from "./google-drive-id.mjs";

export const MIDLANDS_DEMO_COMPANY_NAME = "Midlands Precast Concrete Ltd";
export const MIDLANDS_DEMO_COMPANY_SLUG = "midlands-precast-concrete-ltd";

export const DEMO_ENVIRONMENT_ENABLED_ENV = "DEMO_ENVIRONMENT_ENABLED";
export const DEMO_COMPANY_NAME_ENV = "BERT_DEMO_COMPANY_NAME";
export const DEMO_COMPANY_FOLDER_ENV = "BERT_DEMO_COMPANY_FOLDER_ID";
export const DEMO_COMPANY_SPREADSHEET_ENV = "BERT_DEMO_COMPANY_SPREADSHEET_ID";
/** @deprecated Use BERT_DEMO_COMPANY_SPREADSHEET_ID — kept for script compatibility. */
export const DEMO_COMPANY_WORKBOOK_ENV = "BERT_DEMO_COMPANY_WORKBOOK_ID";
export const DEMO_MASTER_EMAIL_ENV = "BERT_DEMO_MASTER_EMAIL";
export const DEMO_DEFAULT_PASSWORD_ENV = "BERT_DEMO_DEFAULT_PASSWORD";
export const DEMO_COMPANY_SEED_CONFIRM_ENV = "DEMO_COMPANY_SEED_CONFIRM";

export const DEMO_FORBIDDEN_COMPANY_NAMES = new Set([
  "testco",
  "blank company",
  "bert master templates",
  "candidate",
  "demo company",
  "dovecote manufacturing ltd",
  "dovecote studio",
]);

/** Stable site IDs for Midlands Precast. */
export const MIDLANDS_SITE_RUGBY_ID = "midlands-site-rugby";
export const MIDLANDS_SITE_COVENTRY_ID = "midlands-site-coventry";

/**
 * Six switch personas — Master is platform operator only (not Users tab).
 * Company users use BERT_DEMO_DEFAULT_PASSWORD when seeded.
 */
export const MIDLANDS_SWITCH_PERSONAS = [
  {
    key: "master",
    email: "demo.midlands.master@usebert.co.uk",
    name: "Master Demo Operator",
    role: "Master",
    title: "Platform Master (demo)",
    siteIds: "",
    departmentIds: "",
    areaIds: "",
    usersTab: false,
  },
  {
    key: "admin",
    email: "demo.midlands.admin@usebert.co.uk",
    username: "demo.midlands.admin",
    name: "Olivia Bennett",
    role: "Admin",
    title: "Company Administrator",
    siteIds: "",
    departmentIds: "",
    areaIds: "",
    usersTab: true,
  },
  {
    key: "rugby-manager",
    email: "demo.midlands.rugby.manager@usebert.co.uk",
    username: "demo.midlands.rugby.manager",
    name: "Marcus Reed",
    role: "Manager",
    title: "Rugby Site Manager",
    siteIds: MIDLANDS_SITE_RUGBY_ID,
    departmentIds: "",
    areaIds: "",
    usersTab: true,
  },
  {
    key: "coventry-manager",
    email: "demo.midlands.coventry.manager@usebert.co.uk",
    username: "demo.midlands.coventry.manager",
    name: "Sarah Collins",
    role: "Manager",
    title: "Coventry Site Manager",
    siteIds: MIDLANDS_SITE_COVENTRY_ID,
    departmentIds: "",
    areaIds: "",
    usersTab: true,
  },
  {
    key: "rugby-auditor",
    email: "demo.midlands.rugby.auditor@usebert.co.uk",
    username: "demo.midlands.rugby.auditor",
    name: "Chloe Martin",
    role: "Auditor",
    title: "Rugby Auditor",
    siteIds: MIDLANDS_SITE_RUGBY_ID,
    departmentIds: "",
    areaIds: "",
    usersTab: true,
  },
  {
    key: "coventry-auditor",
    email: "demo.midlands.coventry.auditor@usebert.co.uk",
    username: "demo.midlands.coventry.auditor",
    name: "Jack Turner",
    role: "Auditor",
    title: "Coventry Auditor",
    siteIds: MIDLANDS_SITE_COVENTRY_ID,
    departmentIds: "",
    areaIds: "",
    usersTab: true,
  },
];

const SWITCH_EMAILS = new Set(
  MIDLANDS_SWITCH_PERSONAS.map((persona) => normalizeDemoEmail(persona.email)).filter(Boolean),
);

const USERS_TAB_EMAILS = new Set(
  MIDLANDS_SWITCH_PERSONAS.filter((persona) => persona.usersTab !== false).map((persona) =>
    normalizeDemoEmail(persona.email),
  ),
);

function readEnv(env = process.env) {
  return env || process.env;
}

export function normalizeDemoEmail(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isDemoEnvironmentEnabled(env = process.env) {
  const raw = String(readEnv(env)[DEMO_ENVIRONMENT_ENABLED_ENV] || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function readDemoCompanyName(env = process.env) {
  return String(readEnv(env)[DEMO_COMPANY_NAME_ENV] || MIDLANDS_DEMO_COMPANY_NAME).trim();
}

export function readDemoCompanyFolderId(env = process.env) {
  return sanitizeCompanyFolderId(readEnv(env)[DEMO_COMPANY_FOLDER_ENV] || "");
}

export function readDemoCompanySpreadsheetId(env = process.env) {
  const envRef = readEnv(env);
  return sanitizeGoogleSpreadsheetId(
    envRef[DEMO_COMPANY_SPREADSHEET_ENV] || envRef[DEMO_COMPANY_WORKBOOK_ENV] || "",
  );
}

export function readDemoMasterEmail(env = process.env) {
  return normalizeDemoEmail(
    readEnv(env)[DEMO_MASTER_EMAIL_ENV] || "demo.midlands.master@usebert.co.uk",
  );
}

export function readDemoDefaultPassword(env = process.env) {
  return String(readEnv(env)[DEMO_DEFAULT_PASSWORD_ENV] || "").trim();
}

export function isMidlandsDemoCompanyName(name = "") {
  return (
    String(name || "")
      .trim()
      .toLowerCase() === MIDLANDS_DEMO_COMPANY_NAME.toLowerCase()
  );
}

export function isDemoCompanyFolderId(folderId = "", env = process.env) {
  const configured = readDemoCompanyFolderId(env);
  const candidate = sanitizeCompanyFolderId(folderId);
  return Boolean(configured && candidate && configured === candidate);
}

export function resolveDemoWorkspaceIdMode(input = {}, env = process.env) {
  const envRef = input.env || env;
  const companyFolderId = sanitizeCompanyFolderId(
    input.companyFolderId || input.folderId || readDemoCompanyFolderId(envRef),
  );
  const masterSheetId = sanitizeGoogleSpreadsheetId(
    input.masterSheetId || input.spreadsheetId || input.workbookId || readDemoCompanySpreadsheetId(envRef),
  );
  const hasFolder = Boolean(companyFolderId);
  const hasSpreadsheet = Boolean(masterSheetId);

  if (!hasFolder && !hasSpreadsheet) {
    return { ok: true, mode: "provision" };
  }
  if (hasFolder && hasSpreadsheet) {
    return { ok: true, mode: "resume", companyFolderId, masterSheetId };
  }
  if (hasFolder && !hasSpreadsheet) {
    return {
      ok: false,
      error: `Both ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_SPREADSHEET_ENV} are required to resume an existing demo workspace. Folder ID was supplied without a workbook/spreadsheet ID.`,
    };
  }
  return {
    ok: false,
    error: `Both ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_SPREADSHEET_ENV} are required to resume an existing demo workspace. Workbook/spreadsheet ID was supplied without a folder ID.`,
  };
}

export function isAllowedDemoUser(email = "", env = process.env) {
  const normalized = normalizeDemoEmail(email);
  if (!normalized) {
    return false;
  }
  if (SWITCH_EMAILS.has(normalized)) {
    return true;
  }
  if (normalized.startsWith("demo.midlands.") && normalized.endsWith("@usebert.co.uk")) {
    return true;
  }
  const configuredMaster = readDemoMasterEmail(env);
  return configuredMaster === normalized;
}

export function isDemoCompanyEmail(email = "", env = process.env) {
  const normalized = normalizeDemoEmail(email);
  if (!normalized) {
    return false;
  }
  if (isAllowedDemoUser(normalized, env)) {
    return true;
  }
  return normalized.startsWith("demo.midlands.") && normalized.endsWith("@usebert.co.uk");
}

export function assertDemoCompanyAllowed(input = {}, env = process.env) {
  const name = String(input.companyName || input.name || readDemoCompanyName(env)).trim();
  const requireWorkspaceIds = input.requireWorkspaceIds !== false;
  const folderId = sanitizeCompanyFolderId(
    input.companyFolderId || input.folderId || readDemoCompanyFolderId(env),
  );
  const spreadsheetId = sanitizeGoogleSpreadsheetId(
    input.masterSheetId || input.spreadsheetId || input.workbookId || readDemoCompanySpreadsheetId(env),
  );

  if (!name) {
    return { ok: false, error: "Demo company name is required." };
  }
  const normalizedName = name.toLowerCase();
  if (DEMO_FORBIDDEN_COMPANY_NAMES.has(normalizedName)) {
    return { ok: false, error: `Refusing forbidden demo company name: ${name}` };
  }
  if (!isMidlandsDemoCompanyName(name)) {
    return {
      ok: false,
      error: `Demo environment only allows "${MIDLANDS_DEMO_COMPANY_NAME}". Got: ${name}`,
    };
  }
  if (requireWorkspaceIds) {
    if (!folderId) {
      return { ok: false, error: `${DEMO_COMPANY_FOLDER_ENV} is required for live demo operations.` };
    }
    if (input.requireSpreadsheet !== false && !spreadsheetId) {
      return {
        ok: false,
        error: `${DEMO_COMPANY_SPREADSHEET_ENV} (or ${DEMO_COMPANY_WORKBOOK_ENV}) is required for live demo operations.`,
      };
    }
    const configuredFolder = readDemoCompanyFolderId(env);
    if (configuredFolder && folderId !== configuredFolder) {
      return {
        ok: false,
        error: `Company folder ID does not match ${DEMO_COMPANY_FOLDER_ENV}.`,
      };
    }
    const configuredSheet = readDemoCompanySpreadsheetId(env);
    if (spreadsheetId && configuredSheet && spreadsheetId !== configuredSheet) {
      return {
        ok: false,
        error: `Workbook/spreadsheet ID does not match ${DEMO_COMPANY_SPREADSHEET_ENV}.`,
      };
    }
  }
  return {
    ok: true,
    companyName: name,
    companyFolderId: folderId,
    masterSheetId: spreadsheetId,
  };
}

export function assertAllowedDemoSwitchTarget(email = "", env = process.env) {
  const normalized = normalizeDemoEmail(email);
  if (!normalized) {
    return { ok: false, error: "Switch target email is required." };
  }
  if (!isAllowedDemoUser(normalized, env)) {
    return { ok: false, error: "Email is not on the demo switch allowlist." };
  }
  if (!USERS_TAB_EMAILS.has(normalized) && normalized !== readDemoMasterEmail(env)) {
    return { ok: false, error: "Switch target must be a seeded demo persona." };
  }
  return { ok: true, email: normalized };
}

export function listDemoSwitchPersonas(env = process.env) {
  return MIDLANDS_SWITCH_PERSONAS.map((persona) => ({
    ...persona,
    email: normalizeDemoEmail(persona.email),
    masterEmail: readDemoMasterEmail(env),
  }));
}

export function shouldSuppressDemoOutboundEmail({
  companyFolderId = "",
  companyName = "",
  toEmail = "",
  channel = "email",
  env = process.env,
} = {}) {
  if (!isDemoEnvironmentEnabled(env)) {
    return false;
  }
  if (isDemoCompanyFolderId(companyFolderId, env)) {
    return true;
  }
  if (isMidlandsDemoCompanyName(companyName)) {
    return true;
  }
  if (isDemoCompanyEmail(toEmail, env)) {
    return true;
  }
  return false;
}

export function logSuppressedDemoEmail(channel = "email", meta = {}) {
  const safe = { channel: String(channel || "email").trim() || "email" };
  if (meta.companyFolderId) {
    safe.companyFolderId = sanitizeCompanyFolderId(meta.companyFolderId);
  }
  if (meta.toEmail) {
    safe.toEmail = normalizeDemoEmail(meta.toEmail);
  }
  if (meta.reason) {
    safe.reason = String(meta.reason);
  }
  console.log("[demo-email] suppressed outbound email", safe);
}
