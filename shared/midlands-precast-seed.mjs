/**
 * Midlands Precast Concrete Ltd — Phase 1 demo seed (structure + users + validation templates/schedules).
 * Dovecote remains in shared/demo-company-seed.mjs and is not modified here.
 */
import { getUkTodayKey } from "./uk-date-time.mjs";
import {
  MIDLANDS_DEMO_COMPANY_NAME,
  MIDLANDS_DEMO_COMPANY_SLUG,
  MIDLANDS_SITE_COVENTRY_ID,
  MIDLANDS_SITE_RUGBY_ID,
  MIDLANDS_SWITCH_PERSONAS,
} from "./demo-environment.mjs";

export const MIDLANDS_REQUIRED_TABS = [
  "Config",
  "Users",
  "Sites",
  "Departments",
  "Areas",
  "AuditTemplates",
  "AreaAudits",
  "UserAuditAccess",
  "Schedules",
  "AuditResults",
  "AuditFindings",
  "Actions",
  "Evidence",
  "Reports",
  "CompanyFolders",
  "GoogleFormTemplates",
  "SyncLog",
  "Documents",
  "DocumentAcknowledgements",
  "Briefings",
  "BriefingRecipients",
  "NCRs",
  "Invites",
  "Incidents",
];

export const MIDLANDS_SITES = [
  { SiteId: MIDLANDS_SITE_RUGBY_ID, SiteName: "Rugby Batching & Precast Plant", Status: "Active" },
  { SiteId: MIDLANDS_SITE_COVENTRY_ID, SiteName: "Coventry Precast Yard", Status: "Active" },
];

const DEPT_DEFS = [
  { id: "midlands-dept-batching", name: "Batching", site: MIDLANDS_SITE_RUGBY_ID },
  { id: "midlands-dept-production", name: "Precast Production", site: MIDLANDS_SITE_RUGBY_ID },
  { id: "midlands-dept-quality", name: "Quality Assurance", site: MIDLANDS_SITE_RUGBY_ID },
  { id: "midlands-dept-maintenance-rugby", name: "Maintenance", site: MIDLANDS_SITE_RUGBY_ID },
  { id: "midlands-dept-hs", name: "Health & Safety", site: "" },
  { id: "midlands-dept-logistics-rugby", name: "Logistics", site: MIDLANDS_SITE_RUGBY_ID },
  { id: "midlands-dept-admin-rugby", name: "Administration", site: MIDLANDS_SITE_RUGBY_ID },
  { id: "midlands-dept-yard", name: "Yard Operations", site: MIDLANDS_SITE_COVENTRY_ID },
  { id: "midlands-dept-finishing", name: "Finishing", site: MIDLANDS_SITE_COVENTRY_ID },
  { id: "midlands-dept-dispatch", name: "Dispatch", site: MIDLANDS_SITE_COVENTRY_ID },
  { id: "midlands-dept-maintenance-coventry", name: "Maintenance", site: MIDLANDS_SITE_COVENTRY_ID },
  { id: "midlands-dept-admin-coventry", name: "Administration", site: MIDLANDS_SITE_COVENTRY_ID },
];

export const MIDLANDS_DEPARTMENTS = DEPT_DEFS.map((dept) => ({
  DepartmentId: dept.id,
  DepartmentName: dept.name,
  Status: "Active",
}));

const RUGBY_AREAS = [
  ["midlands-area-rugby-batching", "Batching Plant", "midlands-dept-batching"],
  ["midlands-area-rugby-silos", "Cement Silos", "midlands-dept-batching"],
  ["midlands-area-rugby-aggregates", "Aggregate Bays", "midlands-dept-batching"],
  ["midlands-area-rugby-mixer", "Mixer Platform", "midlands-dept-batching"],
  ["midlands-area-rugby-conveyor", "Conveyor System", "midlands-dept-production"],
  ["midlands-area-rugby-precast", "Precast Production", "midlands-dept-production"],
  ["midlands-area-rugby-mould", "Mould Preparation", "midlands-dept-production"],
  ["midlands-area-rugby-washout", "Concrete Washout", "midlands-dept-production"],
  ["midlands-area-rugby-workshop", "Maintenance Workshop", "midlands-dept-maintenance-rugby"],
  ["midlands-area-rugby-lab", "Quality Laboratory", "midlands-dept-quality"],
  ["midlands-area-rugby-loading", "Loading Yard", "midlands-dept-logistics-rugby"],
  ["midlands-area-rugby-offices", "Offices and Welfare", "midlands-dept-admin-rugby"],
];

const COVENTRY_AREAS = [
  ["midlands-area-coventry-storage", "Precast Storage Yard", "midlands-dept-yard"],
  ["midlands-area-coventry-finishing", "Finishing Area", "midlands-dept-finishing"],
  ["midlands-area-coventry-remedial", "Remedial and Repair Area", "midlands-dept-finishing"],
  ["midlands-area-coventry-crane", "Crane Operations", "midlands-dept-yard"],
  ["midlands-area-coventry-forklift", "Forklift Routes", "midlands-dept-dispatch"],
  ["midlands-area-coventry-dispatch", "Dispatch and Loading", "midlands-dept-dispatch"],
  ["midlands-area-coventry-vehicles", "Vehicle Holding Area", "midlands-dept-dispatch"],
  ["midlands-area-coventry-maintenance", "Maintenance Bay", "midlands-dept-maintenance-coventry"],
  ["midlands-area-coventry-offices", "Offices and Welfare", "midlands-dept-admin-coventry"],
];

export const MIDLANDS_AREAS = [
  ...RUGBY_AREAS.map(([areaId, areaName, departmentId]) => ({
    AreaId: areaId,
    AreaName: areaName,
    SiteId: MIDLANDS_SITE_RUGBY_ID,
    DepartmentId: departmentId,
    Status: "Active",
  })),
  ...COVENTRY_AREAS.map(([areaId, areaName, departmentId]) => ({
    AreaId: areaId,
    AreaName: areaName,
    SiteId: MIDLANDS_SITE_COVENTRY_ID,
    DepartmentId: departmentId,
    Status: "Active",
  })),
];

/** Switch personas + additional credible staff (Users tab only). */
export const MIDLANDS_PEOPLE = [
  ...MIDLANDS_SWITCH_PERSONAS.filter((persona) => persona.usersTab !== false).map((persona) => ({
    id: `midlands-user-${persona.key}`,
    name: persona.name,
    title: persona.title,
    role: persona.role,
    email: persona.email,
    username: persona.username || persona.email.split("@")[0],
    siteIds: persona.siteIds || "",
    departmentIds: persona.departmentIds || "",
    areaIds: persona.areaIds || "",
  })),
  {
    id: "midlands-user-hs-manager",
    name: "Priya Sharma",
    title: "Health & Safety Manager",
    role: "Manager",
    email: "demo.midlands.hs.manager@usebert.co.uk",
    username: "demo.midlands.hs.manager",
    siteIds: `${MIDLANDS_SITE_RUGBY_ID},${MIDLANDS_SITE_COVENTRY_ID}`,
    departmentIds: "midlands-dept-hs",
    areaIds: "",
  },
  {
    id: "midlands-user-rugby-qa",
    name: "Daniel Hughes",
    title: "Quality Technician",
    role: "Auditor",
    email: "demo.midlands.rugby.qa@usebert.co.uk",
    username: "demo.midlands.rugby.qa",
    siteIds: MIDLANDS_SITE_RUGBY_ID,
    departmentIds: "midlands-dept-quality",
    areaIds: "midlands-area-rugby-lab",
  },
  {
    id: "midlands-user-rugby-batching",
    name: "Emma Walsh",
    title: "Batching Plant Operator",
    role: "User",
    email: "demo.midlands.rugby.batching@usebert.co.uk",
    username: "demo.midlands.rugby.batching",
    siteIds: MIDLANDS_SITE_RUGBY_ID,
    departmentIds: "midlands-dept-batching",
    areaIds: "midlands-area-rugby-batching,midlands-area-rugby-mixer",
  },
  {
    id: "midlands-user-rugby-maintenance",
    name: "Tom Fletcher",
    title: "Maintenance Fitter",
    role: "User",
    email: "demo.midlands.rugby.maintenance@usebert.co.uk",
    username: "demo.midlands.rugby.maintenance",
    siteIds: MIDLANDS_SITE_RUGBY_ID,
    departmentIds: "midlands-dept-maintenance-rugby",
    areaIds: "midlands-area-rugby-workshop",
  },
  {
    id: "midlands-user-coventry-supervisor",
    name: "Liam O'Connor",
    title: "Yard Supervisor",
    role: "Manager",
    email: "demo.midlands.coventry.supervisor@usebert.co.uk",
    username: "demo.midlands.coventry.supervisor",
    siteIds: MIDLANDS_SITE_COVENTRY_ID,
    departmentIds: "midlands-dept-yard",
    areaIds: "midlands-area-coventry-storage,midlands-area-coventry-crane",
  },
  {
    id: "midlands-user-coventry-dispatch",
    name: "Hannah Price",
    title: "Dispatch Coordinator",
    role: "User",
    email: "demo.midlands.coventry.dispatch@usebert.co.uk",
    username: "demo.midlands.coventry.dispatch",
    siteIds: MIDLANDS_SITE_COVENTRY_ID,
    departmentIds: "midlands-dept-dispatch",
    areaIds: "midlands-area-coventry-dispatch,midlands-area-coventry-vehicles",
  },
  {
    id: "midlands-user-coventry-finishing",
    name: "Ryan Patel",
    title: "Finishing Operative",
    role: "User",
    email: "demo.midlands.coventry.finishing@usebert.co.uk",
    username: "demo.midlands.coventry.finishing",
    siteIds: MIDLANDS_SITE_COVENTRY_ID,
    departmentIds: "midlands-dept-finishing",
    areaIds: "midlands-area-coventry-finishing",
  },
];

export const MIDLANDS_AUDIT_TEMPLATES = [
  { id: "midlands-aud-001", name: "Daily batching plant inspection", formNumber: "MPC-AUD-001", revision: 1, site: "rugby", frequency: "Daily" },
  { id: "midlands-aud-002", name: "Mixer pre-start check", formNumber: "MPC-AUD-002", revision: 1, site: "rugby", frequency: "Daily" },
  { id: "midlands-aud-003", name: "Cement silo inspection", formNumber: "MPC-AUD-003", revision: 1, site: "rugby", frequency: "Weekly" },
  { id: "midlands-aud-004", name: "Weekly conveyor guarding inspection", formNumber: "MPC-AUD-004", revision: 1, site: "rugby", frequency: "Weekly" },
  { id: "midlands-aud-005", name: "Concrete washout environmental inspection", formNumber: "MPC-AUD-005", revision: 1, site: "rugby", frequency: "Weekly" },
  { id: "midlands-aud-006", name: "Loader pre-use inspection", formNumber: "MPC-AUD-006", revision: 1, site: "rugby", frequency: "Daily" },
  { id: "midlands-aud-007", name: "Forklift pre-use inspection", formNumber: "MPC-AUD-007", revision: 1, site: "coventry", frequency: "Daily" },
  { id: "midlands-aud-008", name: "Monthly workplace inspection", formNumber: "MPC-AUD-008", revision: 1, site: "both", frequency: "Monthly" },
  { id: "midlands-aud-009", name: "Crane and lifting area inspection", formNumber: "MPC-AUD-009", revision: 1, site: "coventry", frequency: "Weekly" },
  { id: "midlands-aud-010", name: "Dispatch yard inspection", formNumber: "MPC-AUD-010", revision: 1, site: "coventry", frequency: "Daily" },
];

function shiftUkDate(days, now = Date.now()) {
  const today = getUkTodayKey(now);
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function accessLevelForRole(role = "") {
  const normalized = String(role || "").trim();
  if (normalized === "Admin") return "full";
  if (normalized === "Manager") return "operational";
  return "standard";
}

export function buildMidlandsPrecastSeed({
  now = new Date(),
  passwordHash = "",
  companyFolderId = `demo-folder-${MIDLANDS_DEMO_COMPANY_SLUG}`,
  masterSheetId = `demo-workbook-${MIDLANDS_DEMO_COMPANY_SLUG}`,
} = {}) {
  const iso = now.toISOString();
  const today = getUkTodayKey(now);
  const adminEmail = "demo.midlands.admin@usebert.co.uk";

  const users = MIDLANDS_PEOPLE.map((person) => ({
    "User ID": person.id,
    Email: person.email,
    Username: person.username,
    Name: person.name,
    "Full Name": person.name,
    Role: person.role,
    AccessLevel: accessLevelForRole(person.role),
    Status: "ACTIVE",
    Title: person.title,
    SiteIds: person.siteIds || "",
    DepartmentIds: person.departmentIds || "",
    AreaIds: person.areaIds || "",
    CompanyAreas: person.departmentIds || person.siteIds || "full",
    PasswordHash: passwordHash || "scrypt$demo-placeholder$demo-placeholder",
    PasswordUpdatedAt: iso,
    CreatedAt: iso,
    UpdatedAt: iso,
    Company: MIDLANDS_DEMO_COMPANY_NAME,
    CompanyId: companyFolderId,
    CompanyFolderId: companyFolderId,
    "Company ID": companyFolderId,
    Archived: "false",
    ArchivedAt: "",
    ArchivedBy: "",
    ArchiveReason: "",
    "Schema Version": "3.0.0",
    "Sync Status": "Synced",
  }));

  const audits = MIDLANDS_AUDIT_TEMPLATES.map((template) => ({
    "Audit ID": template.id,
    "Audit Name": template.name,
    Category: "Audits",
    Status: "active",
    "Default Frequency": template.frequency,
    "Created At": iso,
    "Google Form ID": "",
    "Google Form Template Status": "Audit Builder",
    Language: "en-GB",
    "Default Language": "en-GB",
    "Translation Status": "Approved",
    "Form Number": template.formNumber,
    "Revision Number": String(template.revision),
    "Revision ID": `${template.formNumber}-REV-${template.revision}`,
    "Supersedes Revision ID": "",
    "Superseded By Revision ID": "",
    "Revision Reason": "Initial issue",
    "Copy Reason": "",
    Archived: "false",
    ArchivedAt: "",
    ArchivedBy: "",
    ArchiveReason: "",
  }));

  const auditById = Object.fromEntries(audits.map((row) => [row["Audit ID"], row]));

  const scheduleDefs = [
    { id: "midlands-sch-001", auditId: "midlands-aud-001", name: "Rugby — Daily batching plant inspection", assignee: "demo.midlands.rugby.manager@usebert.co.uk", assigneeName: "Marcus Reed", role: "Manager", frequency: "Daily" },
    { id: "midlands-sch-002", auditId: "midlands-aud-002", name: "Rugby — Mixer pre-start check", assignee: "demo.midlands.rugby.batching@usebert.co.uk", assigneeName: "Emma Walsh", role: "User", frequency: "Daily" },
    { id: "midlands-sch-003", auditId: "midlands-aud-003", name: "Rugby — Cement silo inspection", assignee: "demo.midlands.rugby.auditor@usebert.co.uk", assigneeName: "Chloe Martin", role: "Auditor", frequency: "Weekly" },
    { id: "midlands-sch-004", auditId: "midlands-aud-004", name: "Rugby — Conveyor guarding inspection", assignee: "demo.midlands.rugby.auditor@usebert.co.uk", assigneeName: "Chloe Martin", role: "Auditor", frequency: "Weekly" },
    { id: "midlands-sch-005", auditId: "midlands-aud-005", name: "Rugby — Washout environmental inspection", assignee: "demo.midlands.hs.manager@usebert.co.uk", assigneeName: "Priya Sharma", role: "Manager", frequency: "Weekly" },
    { id: "midlands-sch-006", auditId: "midlands-aud-006", name: "Rugby — Loader pre-use inspection", assignee: "demo.midlands.rugby.batching@usebert.co.uk", assigneeName: "Emma Walsh", role: "User", frequency: "Daily" },
    { id: "midlands-sch-007", auditId: "midlands-aud-007", name: "Coventry — Forklift pre-use inspection", assignee: "demo.midlands.coventry.dispatch@usebert.co.uk", assigneeName: "Hannah Price", role: "User", frequency: "Daily" },
    { id: "midlands-sch-008", auditId: "midlands-aud-008", name: "Midlands — Monthly workplace inspection", assignee: "demo.midlands.admin@usebert.co.uk", assigneeName: "Olivia Bennett", role: "Admin", frequency: "Monthly" },
    { id: "midlands-sch-009", auditId: "midlands-aud-009", name: "Coventry — Crane and lifting area inspection", assignee: "demo.midlands.coventry.auditor@usebert.co.uk", assigneeName: "Jack Turner", role: "Auditor", frequency: "Weekly" },
    { id: "midlands-sch-010", auditId: "midlands-aud-010", name: "Coventry — Dispatch yard inspection", assignee: "demo.midlands.coventry.manager@usebert.co.uk", assigneeName: "Sarah Collins", role: "Manager", frequency: "Daily" },
  ];

  const schedules = scheduleDefs.map((item) => {
    const audit = auditById[item.auditId];
    return {
      "Schedule ID": item.id,
      "Company Folder ID": companyFolderId,
      "Schedule Name": item.name,
      "Template Name": audit["Audit Name"],
      "Audit ID": audit["Audit ID"],
      Frequency: item.frequency,
      "Days Of Week": item.frequency === "Weekly" ? "Mon" : "",
      "Start Date": today,
      "End Date": "",
      Continuous: "true",
      "Due Window": "06:00-18:00",
      "Assigned User Emails": item.assignee,
      "Assigned User Names": item.assigneeName,
      "Assigned User Roles": item.role,
      Status: "ACTIVE",
      "Created By": adminEmail,
      "Created At": iso,
      "Updated At": iso,
      Auditors: item.assigneeName,
      "Auditor Emails": item.assignee,
      "Assigned Auditors": item.assignee,
      "Completion Mode": "individual",
      FormNumber: audit["Form Number"],
      RevisionNumber: audit["Revision Number"],
      RevisionId: audit["Revision ID"],
      Archived: "false",
      ArchivedAt: "",
      ArchivedBy: "",
      ArchiveReason: "",
    };
  });

  const roleBreakdown = users.reduce((acc, user) => {
    const role = String(user.Role || "User");
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  return {
    companyName: MIDLANDS_DEMO_COMPANY_NAME,
    companyFolderId,
    masterSheetId,
    requiredTabs: MIDLANDS_REQUIRED_TABS,
    sites: MIDLANDS_SITES.map((row) => ({ ...row, CreatedAt: iso, UpdatedAt: iso })),
    departments: MIDLANDS_DEPARTMENTS.map((row) => ({ ...row, CreatedAt: iso, UpdatedAt: iso })),
    areas: MIDLANDS_AREAS.map((row) => ({ ...row, CreatedAt: iso, UpdatedAt: iso })),
    users,
    audits,
    schedules,
    switchPersonas: MIDLANDS_SWITCH_PERSONAS,
    masterOperator: MIDLANDS_SWITCH_PERSONAS.find((persona) => persona.key === "master"),
    loginSummary: users
      .filter((user) => String(user.Status).toUpperCase() === "ACTIVE")
      .slice(0, 6)
      .map((user) => ({
        name: user.Name,
        email: user.Email,
        role: user.Role,
      })),
    counts: {
      users: users.length,
      activeUsers: users.filter((u) => String(u.Status).toUpperCase() === "ACTIVE").length,
      sites: MIDLANDS_SITES.length,
      departments: MIDLANDS_DEPARTMENTS.length,
      areas: MIDLANDS_AREAS.length,
      auditTemplates: audits.length,
      schedules: schedules.length,
      roles: roleBreakdown,
      switchPersonas: MIDLANDS_SWITCH_PERSONAS.length,
    },
    generatedAt: iso,
    phaseNote: "Phase 1 — structure, users, validation templates/schedules only (no operational history).",
  };
}

export function summarizeMidlandsSeed(seed) {
  return {
    companyName: seed.companyName,
    companyFolderId: seed.companyFolderId,
    masterSheetId: seed.masterSheetId,
    counts: seed.counts,
    loginSummary: seed.loginSummary,
    requiredTabs: seed.requiredTabs,
    switchPersonas: seed.switchPersonas?.map((persona) => ({
      key: persona.key,
      email: persona.email,
      name: persona.name,
      role: persona.role,
      usersTab: persona.usersTab !== false,
    })),
    generatedAt: seed.generatedAt,
    phaseNote: seed.phaseNote,
  };
}
