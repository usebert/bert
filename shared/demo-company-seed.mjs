/**
 * Dovecote Manufacturing Ltd — repeatable demo company seed definition.
 * Source people list: Demo Organisational Chart.xlsx (encoded here so seeding does not require xlsx).
 * Pure data + row builders. Live writes happen in scripts/seed-demo-company.mjs.
 */

import { getUkTodayKey } from "./uk-date-time.mjs";

export const DEMO_COMPANY_NAME = "Dovecote Manufacturing Ltd";
export const DEMO_COMPANY_SLUG = "dovecote-manufacturing-ltd";
export const DEMO_COMPANY_EMAIL_DOMAIN = "usebert.co.uk";
export const DEMO_COMPANY_EMAIL_PREFIX = "bert.demo";
export const DEMO_COMPANY_SHARED_PASSWORD = "BertDemo123!";
export const DEMO_COMPANY_SEED_CONFIRM_ENV = "DEMO_COMPANY_SEED_CONFIRM";
export const DEMO_COMPANY_FOLDER_ENV = "BERT_DEMO_COMPANY_FOLDER_ID";
export const DEMO_COMPANY_WORKBOOK_ENV = "BERT_DEMO_COMPANY_WORKBOOK_ID";

/** Required tabs for the demo workbook (matches SETUP_REQUIRED_TABS + Incidents). */
export const DEMO_REQUIRED_TABS = [
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

export const DEMO_FORBIDDEN_NAMES = new Set([
  "testco",
  "blank company",
  "bert master templates",
  "candidate",
  "demo company",
]);

export function demoEmail(slug) {
  const local = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${DEMO_COMPANY_EMAIL_PREFIX}+${local}@${DEMO_COMPANY_EMAIL_DOMAIN}`;
}

/** Demo login username = emailSlug (e.g. joe.jones). */
export function demoUsername(slug) {
  return String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

export function isDemoCompanyName(name = "") {
  return String(name || "").trim().toLowerCase() === DEMO_COMPANY_NAME.toLowerCase();
}

export function assertDemoCompanyAllowed(name = "") {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return { ok: false, error: "Company name is required." };
  if (DEMO_FORBIDDEN_NAMES.has(normalized)) {
    return { ok: false, error: `Refusing to seed forbidden company name: ${name}` };
  }
  if (!isDemoCompanyName(name)) {
    return {
      ok: false,
      error: `Seeder only targets "${DEMO_COMPANY_NAME}". Got: ${name}`,
    };
  }
  return { ok: true };
}

/** Stable structure IDs */
export const DEMO_SITES = [
  { SiteId: "demo-site-1", SiteName: "Site 1", Status: "Active" },
  { SiteId: "demo-site-2", SiteName: "Site 2", Status: "Active" },
];

export const DEMO_DEPARTMENTS = [
  "HR",
  "Operations",
  "Sales",
  "Commercial",
  "Accounts",
  "Production",
  "Batching",
  "Factory",
  "Health & Safety",
  "Quality",
  "Maintenance",
  "Warehouse / Stores",
].map((name) => ({
  DepartmentId: `demo-dept-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  DepartmentName: name,
  Status: "Active",
}));

export const DEMO_AREAS = [
  ...[
    "Office",
    "Factory",
    "Batching Plant",
    "Production Area",
    "Yard",
    "Stores",
    "Loading Bay",
  ].flatMap((areaName) =>
    DEMO_SITES.map((site) => {
      const siteNum = site.SiteId.endsWith("1") ? "1" : "2";
      const dept =
        areaName.includes("Batching")
          ? DEMO_DEPARTMENTS.find((d) => d.DepartmentName === "Batching")
          : areaName.includes("Production")
            ? DEMO_DEPARTMENTS.find((d) => d.DepartmentName === "Production")
            : areaName.includes("Stores") || areaName.includes("Loading")
              ? DEMO_DEPARTMENTS.find((d) => d.DepartmentName === "Warehouse / Stores")
              : areaName.includes("Factory")
                ? DEMO_DEPARTMENTS.find((d) => d.DepartmentName === "Factory")
                : DEMO_DEPARTMENTS.find((d) => d.DepartmentName === "Operations");
      return {
        AreaId: `demo-area-site-${siteNum}-${areaName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        AreaName: `Site ${siteNum} ${areaName}`,
        SiteId: site.SiteId,
        DepartmentId: dept?.DepartmentId || "",
        Status: "Active",
      };
    }),
  ),
];

/**
 * Org-chart people (23) + one archived example user.
 * Access: blank SiteIds/DepartmentIds/AreaIds = all company access.
 */
export const DEMO_PEOPLE = [
  {
    id: "demo-user-mr-important",
    name: "Mr Important",
    title: "CEO / Managing Director",
    role: "Admin",
    emailSlug: "mr.important",
    siteIds: "",
    departmentIds: "",
    areaIds: "",
  },
  {
    id: "demo-user-bertina-bertison",
    name: "Bertina Bertison",
    title: "HR Director",
    role: "Manager",
    emailSlug: "bertina.bertison",
    siteIds: "",
    departmentIds: "demo-dept-hr",
    areaIds: "",
  },
  {
    id: "demo-user-bert-bertison",
    name: "Bert Bertison",
    title: "Operations Director",
    role: "Manager",
    emailSlug: "bert.bertison",
    siteIds: "demo-site-1,demo-site-2",
    departmentIds: "demo-dept-operations",
    areaIds: "",
  },
  {
    id: "demo-user-derek-trotter",
    name: "Derek Trotter",
    title: "Sales Director",
    role: "Manager",
    emailSlug: "derek.trotter",
    siteIds: "",
    departmentIds: "demo-dept-sales",
    areaIds: "",
  },
  {
    id: "demo-user-ben-richards",
    name: "Ben Richards",
    title: "Commercial Director",
    role: "Manager",
    emailSlug: "ben.richards",
    siteIds: "",
    departmentIds: "demo-dept-commercial,demo-dept-accounts",
    areaIds: "",
  },
  {
    id: "demo-user-sarah-trent",
    name: "Sarah Trent",
    title: "HR Manager",
    role: "Manager",
    emailSlug: "sarah.trent",
    siteIds: "",
    departmentIds: "demo-dept-hr",
    areaIds: "",
  },
  {
    id: "demo-user-dominic-davies",
    name: "Dominic Davies",
    title: "Operations Manager",
    role: "Manager",
    emailSlug: "dominic.davies",
    siteIds: "demo-site-1,demo-site-2",
    departmentIds: "demo-dept-operations",
    areaIds: "",
  },
  {
    id: "demo-user-sally-cinamon",
    name: "Sally Cinamon",
    title: "Sales Manager",
    role: "Manager",
    emailSlug: "sally.cinamon",
    siteIds: "",
    departmentIds: "demo-dept-sales",
    areaIds: "",
  },
  {
    id: "demo-user-deberah-disco",
    name: "Deberah Disco",
    title: "Accounts Manager",
    role: "Manager",
    emailSlug: "deberah.disco",
    siteIds: "",
    departmentIds: "demo-dept-accounts",
    areaIds: "",
  },
  {
    id: "demo-user-mark-bark",
    name: "Mark Bark",
    title: "HR Assistant",
    role: "Auditor",
    emailSlug: "mark.bark",
    siteIds: "",
    departmentIds: "demo-dept-hr",
    areaIds: "",
  },
  {
    id: "demo-user-eric-erikson",
    name: "Eric Erikson",
    title: "Sales Assistant",
    role: "Auditor",
    emailSlug: "eric.erikson",
    siteIds: "",
    departmentIds: "demo-dept-sales",
    areaIds: "",
  },
  {
    id: "demo-user-tracey-racey",
    name: "Tracey Racey",
    title: "Sales Assistant",
    role: "Auditor",
    emailSlug: "tracey.racey",
    siteIds: "",
    departmentIds: "demo-dept-sales",
    areaIds: "",
  },
  {
    id: "demo-user-mary-holland",
    name: "Mary Holland",
    title: "Accounts Assistant",
    role: "Auditor",
    emailSlug: "mary.holland",
    siteIds: "",
    departmentIds: "demo-dept-accounts",
    areaIds: "",
  },
  {
    id: "demo-user-terry-terinson",
    name: "Terry Terinson",
    title: "Factory Manager",
    role: "Manager",
    emailSlug: "terry.terinson",
    siteIds: "demo-site-1",
    departmentIds: "demo-dept-factory",
    areaIds: "",
  },
  {
    id: "demo-user-jane-pain",
    name: "Jane Pain",
    title: "Batching Manager",
    role: "Manager",
    emailSlug: "jane.pain",
    siteIds: "demo-site-1",
    departmentIds: "demo-dept-batching",
    areaIds: "demo-area-site-1-batching-plant",
  },
  {
    id: "demo-user-tony-balony",
    name: "Tony Balony",
    title: "Supervisor",
    role: "Manager",
    emailSlug: "tony.balony",
    siteIds: "demo-site-1",
    departmentIds: "demo-dept-production",
    areaIds: "demo-area-site-1-production-area",
  },
  {
    id: "demo-user-joe-jones",
    name: "Joe Jones",
    title: "Batching Operative",
    role: "Auditor",
    emailSlug: "joe.jones",
    siteIds: "demo-site-1",
    departmentIds: "demo-dept-batching",
    areaIds: "demo-area-site-1-batching-plant",
  },
  {
    id: "demo-user-chris-dim",
    name: "Chris Dim",
    title: "Production Operative",
    role: "Auditor",
    emailSlug: "chris.dim",
    siteIds: "demo-site-1",
    departmentIds: "demo-dept-production",
    areaIds: "demo-area-site-1-production-area",
  },
  {
    id: "demo-user-simon-simple",
    name: "Simon Simple",
    title: "Factory Manager",
    role: "Manager",
    emailSlug: "simon.simple",
    siteIds: "demo-site-2",
    departmentIds: "demo-dept-factory",
    areaIds: "",
  },
  {
    id: "demo-user-fred-red",
    name: "Fred Red",
    title: "Supervisor",
    role: "Manager",
    emailSlug: "fred.red",
    siteIds: "demo-site-2",
    departmentIds: "demo-dept-production",
    areaIds: "demo-area-site-2-production-area",
  },
  {
    id: "demo-user-stu-bert",
    name: "Stu Bert",
    title: "Batching Manager",
    role: "Manager",
    emailSlug: "stu.bert",
    siteIds: "demo-site-2",
    departmentIds: "demo-dept-batching",
    areaIds: "demo-area-site-2-batching-plant",
  },
  {
    id: "demo-user-dave-doubt",
    name: "Dave Doubt",
    title: "Production Operative",
    role: "Auditor",
    emailSlug: "dave.doubt",
    siteIds: "demo-site-2",
    departmentIds: "demo-dept-production",
    areaIds: "demo-area-site-2-production-area",
  },
  {
    id: "demo-user-lisa-little",
    name: "Lisa Little",
    title: "Batching Operative",
    role: "Auditor",
    emailSlug: "lisa.little",
    siteIds: "demo-site-2",
    departmentIds: "demo-dept-batching",
    areaIds: "demo-area-site-2-batching-plant",
  },
];

export const DEMO_ARCHIVED_USER = {
  id: "demo-user-archived-example",
  name: "Archived Example User",
  title: "Former Operative",
  role: "Auditor",
  emailSlug: "archived.example",
  siteIds: "demo-site-1",
  departmentIds: "demo-dept-production",
  areaIds: "",
  archived: true,
};

export const DEMO_AUDIT_TEMPLATES = [
  { id: "demo-aud-001-rev1", name: "Daily Factory Inspection", formNumber: "BERT-AUD-001", revision: 1, status: "superseded" },
  { id: "demo-aud-001-rev2", name: "Daily Factory Inspection", formNumber: "BERT-AUD-001", revision: 2, status: "active", supersedes: "demo-aud-001-rev1" },
  { id: "demo-aud-002", name: "DC H&S Audit", formNumber: "BERT-AUD-002", revision: 1, status: "active" },
  { id: "demo-aud-003", name: "Batching Plant Pre-Start Check", formNumber: "BERT-AUD-003", revision: 1, status: "active" },
  { id: "demo-aud-004", name: "Production Quality Check", formNumber: "BERT-AUD-004", revision: 1, status: "active" },
  { id: "demo-aud-005", name: "Forklift Pre-Use Check", formNumber: "BERT-AUD-005", revision: 1, status: "active" },
  { id: "demo-aud-006", name: "Fire Safety Inspection", formNumber: "BERT-AUD-006", revision: 1, status: "active" },
  { id: "demo-aud-007", name: "PPE Compliance Check", formNumber: "BERT-AUD-007", revision: 1, status: "active" },
  { id: "demo-aud-008", name: "COSHH Storage Check", formNumber: "BERT-AUD-008", revision: 1, status: "active" },
  { id: "demo-aud-009", name: "Housekeeping Audit", formNumber: "BERT-AUD-009", revision: 1, status: "active" },
  { id: "demo-aud-010", name: "Loading Bay Safety Check", formNumber: "BERT-AUD-010", revision: 1, status: "active" },
  { id: "demo-aud-011", name: "Maintenance Workshop Inspection", formNumber: "BERT-AUD-011", revision: 1, status: "active" },
  { id: "demo-aud-012", name: "Yard Safety Walkaround", formNumber: "BERT-AUD-012", revision: 1, status: "active" },
];

function shiftUkDate(days, now = Date.now()) {
  const today = getUkTodayKey(now);
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildDemoCompanySeed({ now = new Date(), passwordHash = "" } = {}) {
  const iso = now.toISOString();
  const today = getUkTodayKey(now);
  const yesterday = shiftUkDate(-1, now);
  const tomorrow = shiftUkDate(1, now);
  const companyFolderId = `demo-folder-${DEMO_COMPANY_SLUG}`;
  const masterSheetId = `demo-workbook-${DEMO_COMPANY_SLUG}`;

  const users = [...DEMO_PEOPLE, DEMO_ARCHIVED_USER].map((person) => {
    const email = demoEmail(person.emailSlug);
    const username = demoUsername(person.emailSlug);
    const archived = person.archived === true;
    return {
      "User ID": person.id,
      Email: email,
      Username: username,
      Name: person.name,
      "Full Name": person.name,
      Role: person.role,
      AccessLevel: person.role === "Admin" ? "full" : person.role === "Manager" ? "operational" : "standard",
      Status: archived ? "INACTIVE" : "ACTIVE",
      Title: person.title,
      SiteIds: person.siteIds || "",
      DepartmentIds: person.departmentIds || "",
      AreaIds: person.areaIds || "",
      CompanyAreas: person.departmentIds || person.siteIds || "full",
      PasswordHash: passwordHash || "scrypt$demo-placeholder$demo-placeholder",
      PasswordUpdatedAt: iso,
      CreatedAt: iso,
      UpdatedAt: iso,
      Company: DEMO_COMPANY_NAME,
      CompanyId: companyFolderId,
      CompanyFolderId: companyFolderId,
      "Company ID": companyFolderId,
      Archived: archived ? "true" : "false",
      ArchivedAt: archived ? iso : "",
      ArchivedBy: archived ? demoEmail("mr.important") : "",
      ArchiveReason: archived ? "Left company — demo archive example" : "",
      "Schema Version": "3.0.0",
      "Sync Status": "Synced",
    };
  });

  const audits = DEMO_AUDIT_TEMPLATES.map((template) => {
    const revisionId = `${template.formNumber}-REV-${template.revision}`;
    const superseded =
      template.status === "superseded"
        ? DEMO_AUDIT_TEMPLATES.find((row) => row.supersedes === template.id)
        : null;
    return {
      "Audit ID": template.id,
      "Audit Name": template.name,
      Category: "Audits",
      Status: template.status,
      "Default Frequency": "Weekly",
      "Created At": iso,
      "Google Form ID": "",
      "Google Form Template Status": "Audit Builder",
      Language: "en-GB",
      "Default Language": "en-GB",
      "Translation Status": "Approved",
      "Form Number": template.formNumber,
      "Revision Number": String(template.revision),
      "Revision ID": revisionId,
      "Supersedes Revision ID": template.supersedes
        ? `${DEMO_AUDIT_TEMPLATES.find((row) => row.id === template.supersedes)?.formNumber}-REV-1`
        : "",
      "Superseded By Revision ID": superseded ? `${template.formNumber}-REV-2` : "",
      "Revision Reason":
        template.status === "superseded"
          ? "Superseded by revised daily factory inspection"
          : template.revision > 1
            ? "Updated extinguisher and egress checks"
            : "Initial issue",
      "Copy Reason": "",
      Archived: template.status === "superseded" ? "true" : "false",
      ArchivedAt: template.status === "superseded" ? iso : "",
      ArchivedBy: template.status === "superseded" ? demoEmail("mr.important") : "",
      ArchiveReason: template.status === "superseded" ? "Superseded by new revision" : "",
    };
  });

  const activeDaily = audits.find((row) => row["Audit ID"] === "demo-aud-001-rev2");
  const batching = audits.find((row) => row["Audit ID"] === "demo-aud-003");
  const production = audits.find((row) => row["Audit ID"] === "demo-aud-004");
  const yard = audits.find((row) => row["Audit ID"] === "demo-aud-012");
  const fire = audits.find((row) => row["Audit ID"] === "demo-aud-006");

  const schedules = [
    {
      id: "demo-sch-today-site1",
      name: "Site 1 Daily Factory Inspection",
      audit: activeDaily,
      frequency: "Daily",
      start: today,
      assignee: demoEmail("tony.balony"),
      assigneeName: "Tony Balony",
      role: "Manager",
    },
    {
      id: "demo-sch-overdue-site2",
      name: "Site 2 Yard Walkaround (overdue)",
      audit: yard,
      frequency: "Weekly",
      start: yesterday,
      assignee: demoEmail("fred.red"),
      assigneeName: "Fred Red",
      role: "Manager",
    },
    {
      id: "demo-sch-tomorrow-batching",
      name: "Site 1 Batching Pre-Start",
      audit: batching,
      frequency: "Daily",
      start: tomorrow,
      assignee: demoEmail("jane.pain"),
      assigneeName: "Jane Pain",
      role: "Manager",
    },
    {
      id: "demo-sch-weekly-production",
      name: "Site 2 Production Quality",
      audit: production,
      frequency: "Weekly",
      start: today,
      assignee: demoEmail("dave.doubt"),
      assigneeName: "Dave Doubt",
      role: "Auditor",
    },
    {
      id: "demo-sch-monthly-fire",
      name: "Monthly Fire Safety Inspection",
      audit: fire,
      frequency: "Monthly",
      start: today,
      assignee: demoEmail("dominic.davies"),
      assigneeName: "Dominic Davies",
      role: "Manager",
    },
    {
      id: "demo-sch-archived",
      name: "Archived Legacy Walk",
      audit: yard,
      frequency: "Weekly",
      start: yesterday,
      assignee: demoEmail("simon.simple"),
      assigneeName: "Simon Simple",
      role: "Manager",
      status: "Archived",
    },
  ].map((item) => ({
    "Schedule ID": item.id,
    "Company Folder ID": companyFolderId,
    "Schedule Name": item.name,
    "Template Name": item.audit["Audit Name"],
    "Audit ID": item.audit["Audit ID"],
    Frequency: item.frequency,
    "Days Of Week": item.frequency === "Weekly" ? "Mon" : "",
    "Start Date": item.start,
    "End Date": "",
    Continuous: "true",
    "Due Window": "08:00-17:00",
    "Assigned User Emails": item.assignee,
    "Assigned User Names": item.assigneeName,
    "Assigned User Roles": item.role,
    Status: item.status || "ACTIVE",
    "Created By": demoEmail("mr.important"),
    "Created At": iso,
    "Updated At": iso,
    Auditors: item.assigneeName,
    "Auditor Emails": item.assignee,
    "Assigned Auditors": item.assignee,
    "Completion Mode": "individual",
    FormNumber: item.audit["Form Number"],
    RevisionNumber: item.audit["Revision Number"],
    RevisionId: item.audit["Revision ID"],
    Archived: item.status === "Archived" ? "true" : "false",
    ArchivedAt: item.status === "Archived" ? iso : "",
    ArchivedBy: item.status === "Archived" ? demoEmail("mr.important") : "",
    ArchiveReason: item.status === "Archived" ? "Demo archived schedule" : "",
  }));

  const actions = [
    { id: "demo-act-open-1", status: "Open", due: tomorrow, evidence: false },
    { id: "demo-act-open-2", status: "Open", due: tomorrow, evidence: false },
    { id: "demo-act-open-3", status: "Open", due: today, evidence: false },
    { id: "demo-act-open-4", status: "Open", due: tomorrow, evidence: false },
    { id: "demo-act-open-5", status: "Open", due: tomorrow, evidence: false },
    { id: "demo-act-overdue-1", status: "Open", due: yesterday, evidence: false },
    { id: "demo-act-overdue-2", status: "Open", due: yesterday, evidence: false },
    { id: "demo-act-overdue-3", status: "Open", due: yesterday, evidence: false },
    { id: "demo-act-evidence-1", status: "Open", due: today, evidence: true },
    { id: "demo-act-evidence-2", status: "Open", due: tomorrow, evidence: true },
    { id: "demo-act-closed-1", status: "Closed", due: yesterday, evidence: false },
    { id: "demo-act-closed-2", status: "Closed", due: yesterday, evidence: false },
    { id: "demo-act-archived-1", status: "Open", due: yesterday, evidence: false, archived: true },
    { id: "demo-act-archived-2", status: "Closed", due: yesterday, evidence: false, archived: true },
  ].map((item, index) => ({
    "Action ID": item.id,
    "Company ID": companyFolderId,
    "Company Folder ID": companyFolderId,
    "Source Audit Name": "Daily Factory Inspection",
    "Source Question Text": `Demo action ${index + 1}`,
    Status: item.status,
    "Due Date": item.due,
    "Assigned To Name": "Tony Balony",
    "Assigned To Email": demoEmail("tony.balony"),
    "Evidence Required": item.evidence ? "true" : "false",
    "Evidence Count": item.evidence ? "0" : "",
    CreatedAt: iso,
    UpdatedAt: iso,
    Archived: item.archived ? "true" : "false",
    ArchivedAt: item.archived ? iso : "",
    ArchivedBy: item.archived ? demoEmail("mr.important") : "",
    ArchiveReason: item.archived ? "Demo archived action" : "",
  }));

  const ncrs = [
    {
      id: "demo-ncr-open-1",
      status: "Open",
      title: "Damaged guard rail — Site 1",
      evidence: false,
      linked: false,
    },
    {
      id: "demo-ncr-open-2",
      status: "Open",
      title: "Missing PPE in batching plant",
      evidence: false,
      linked: false,
    },
    {
      id: "demo-ncr-open-3",
      status: "Open",
      title: "Housekeeping failure — loading bay",
      evidence: false,
      linked: false,
    },
    {
      id: "demo-ncr-linked",
      status: "Open",
      title: "NCR from Daily Factory Inspection",
      evidence: false,
      linked: true,
    },
    {
      id: "demo-ncr-evidence",
      status: "Open",
      title: "Spill with photo evidence",
      evidence: true,
      linked: false,
    },
    {
      id: "demo-ncr-closed",
      status: "Closed",
      title: "Closed COSHH labelling NCR",
      evidence: false,
      linked: false,
    },
    {
      id: "demo-ncr-archived",
      status: "Open",
      title: "Archived duplicate NCR",
      evidence: false,
      linked: false,
      archived: true,
    },
  ].map((item, index) => ({
    "NCR ID": item.id,
    Reference: `NCR-${String(index + 1).padStart(4, "0")}`,
    "Company ID": companyFolderId,
    "Company Folder ID": companyFolderId,
    "Source Audit ID": item.linked ? "demo-aud-001-rev2" : "",
    "Source Audit Name": item.linked ? "Daily Factory Inspection" : "",
    "Source Question ID": item.linked ? "q-guard-rail" : "",
    "Source Question Text": item.linked ? "Guard rails intact?" : "",
    "Selected Answer": item.linked ? "Non-compliant" : "",
    Title: item.title,
    Description: `${item.title} — demo seed`,
    Status: item.status,
    Site: "Site 1",
    "Auditor Name": "Joe Jones",
    "Auditor User ID": "demo-user-joe-jones",
    "Assigned Line Manager": "Tony Balony",
    "Assigned Line Manager Email": demoEmail("tony.balony"),
    "Raised At": iso,
    "Created At": iso,
    "Updated At": iso,
    "Created By": demoEmail("joe.jones"),
    Archived: item.archived ? "true" : "false",
    "Archived At": item.archived ? iso : "",
    "Archived By": item.archived ? demoEmail("mr.important") : "",
    "Archive Reason": item.archived ? "Demo archived NCR" : "",
    "Result ID": item.linked ? "demo-result-001" : "",
    "Local Submission ID": "",
    "Evidence Refs": item.evidence ? "demo-evidence-ncr-1" : "",
    "Evidence Count": item.evidence ? "1" : "0",
  }));

  const incidents = [
    {
      id: "demo-inc-near-miss",
      type: "Near Miss",
      severity: "Low",
      status: "Open",
      description: "Near miss — forklift and pedestrian in Site 1 yard",
    },
    {
      id: "demo-inc-minor",
      type: "Injury",
      severity: "Minor",
      status: "Open",
      description: "Minor cut — Site 2 production operative",
    },
    {
      id: "demo-inc-damage",
      type: "Property Damage",
      severity: "Medium",
      status: "Open",
      description: "Damaged pallet racking — Site 1 stores",
    },
    {
      id: "demo-inc-investigation",
      type: "Near Miss",
      severity: "Medium",
      status: "Investigating",
      description: "Open investigation — batching plant trip hazard",
    },
    {
      id: "demo-inc-closed",
      type: "Injury",
      severity: "Minor",
      status: "Closed",
      description: "Closed incident — first aid administered",
    },
    {
      id: "demo-inc-archived",
      type: "Near Miss",
      severity: "Low",
      status: "Closed",
      description: "Archived historic near miss",
      archived: true,
    },
  ].map((item) => ({
    IncidentId: item.id,
    Status: item.archived ? "Archived" : item.status,
    Priority: "Normal",
    IncidentType: item.type,
    Severity: item.severity,
    IncidentDate: today,
    IncidentTime: "09:30",
    ReporterName: "Chris Dim",
    ReporterEmail: demoEmail("chris.dim"),
    Department: "Production",
    Location: "Site 1",
    Description: item.description,
    ImmediateAction: "Area made safe",
    Witnesses: "",
    EvidenceUrls: "",
    CreatedAt: iso,
    CreatedBy: demoEmail("chris.dim"),
    UpdatedAt: iso,
    NotificationStatus: "Sent",
    AssignedToEmail: demoEmail("terry.terinson"),
    AssignedToName: "Terry Terinson",
    Archived: item.archived ? "true" : "false",
    ArchivedAt: item.archived ? iso : "",
    ArchivedBy: item.archived ? demoEmail("mr.important") : "",
    ArchiveReason: item.archived ? "Demo archived incident" : "",
  }));

  const briefings = [
    {
      id: "demo-brief-unread",
      title: "Unread toolbox talk — PPE",
      requiresSignature: false,
      recipientStatus: "Sent",
    },
    {
      id: "demo-brief-read",
      title: "Read policy update — COSHH",
      requiresSignature: false,
      recipientStatus: "Read",
    },
    {
      id: "demo-brief-signoff",
      title: "Sign-off required — Permit to work",
      requiresSignature: true,
      recipientStatus: "Read",
    },
    {
      id: "demo-brief-signed",
      title: "Signed induction briefing",
      requiresSignature: true,
      recipientStatus: "Signed",
    },
    {
      id: "demo-brief-archived",
      title: "Archived outdated notice",
      requiresSignature: false,
      recipientStatus: "Read",
      archived: true,
    },
  ];

  const briefingRows = briefings.map((item) => ({
    BriefingId: item.id,
    Title: item.title,
    Type: "Toolbox Talk",
    Status: item.archived ? "Archived" : "Sent",
    Priority: "Important",
    CreatedByEmail: demoEmail("bertina.bertison"),
    CreatedByName: "Bertina Bertison",
    CreatedAt: iso,
    SentAt: iso,
    DueDate: tomorrow,
    RequiresRead: "true",
    RequiresAcknowledgement: "true",
    RequiresSignature: item.requiresSignature ? "true" : "false",
    RequiresReply: "false",
    RenewalFrequency: "None",
    RenewalDueDate: "",
    TargetMode: "users",
    TargetRoles: "",
    TargetAreas: "",
    TargetDepartments: "",
    TargetUserEmails: demoEmail("joe.jones"),
    DocumentName: item.title,
    DocumentDriveFileId: "",
    DocumentDriveLink: "",
    Message: `${item.title} — demo seed briefing`,
    RecipientCount: "1",
    OpenedCount: item.recipientStatus === "Sent" ? "0" : "1",
    ReadCount: ["Read", "Signed"].includes(item.recipientStatus) ? "1" : "0",
    AcknowledgedCount: item.recipientStatus === "Signed" ? "1" : "0",
    SignedCount: item.recipientStatus === "Signed" ? "1" : "0",
    ReplyCount: "0",
    OverdueCount: "0",
    Archived: item.archived ? "true" : "false",
    ArchivedAt: item.archived ? iso : "",
    ArchivedBy: item.archived ? demoEmail("mr.important") : "",
    ArchiveReason: item.archived ? "Demo archived briefing" : "",
  }));

  const briefingRecipients = briefings.map((item) => ({
    BriefingId: item.id,
    RecipientEmail: demoEmail("joe.jones"),
    RecipientName: "Joe Jones",
    Role: "Auditor",
    Area: "Site 1 Batching Plant",
    Department: "Batching",
    SentAt: iso,
    OpenedAt: item.recipientStatus === "Sent" ? "" : iso,
    ReadAt: ["Read", "Signed"].includes(item.recipientStatus) ? iso : "",
    AcknowledgedAt: item.recipientStatus === "Signed" ? iso : "",
    SignedAt: item.recipientStatus === "Signed" ? iso : "",
    ReplyAt: "",
    Status: item.recipientStatus,
  }));

  const googleForms = [
    {
      "BERT Template ID": "demo-gf-001-rev2",
      "Template Name": "Visitor Induction Google Form",
      "Source Company ID": companyFolderId,
      "Source Company Name": DEMO_COMPANY_NAME,
      Category: "Google Forms",
      "Google Form ID": "demo-gf-file-001",
      "Google Form Drive File ID": "demo-gf-file-001",
      Status: "active",
      "Sync Status": "linked",
      "Form Number": "BERT-GF-001",
      "Revision Number": "2",
      "Revision ID": "BERT-GF-001-REV-2",
      "Superseded By Revision ID": "",
      Archived: "false",
    },
    {
      "BERT Template ID": "demo-gf-001-rev1",
      "Template Name": "Visitor Induction Google Form",
      "Source Company ID": companyFolderId,
      "Source Company Name": DEMO_COMPANY_NAME,
      Category: "Google Forms",
      "Google Form ID": "demo-gf-file-001-old",
      "Google Form Drive File ID": "demo-gf-file-001-old",
      Status: "superseded",
      "Sync Status": "Archived",
      "Form Number": "BERT-GF-001",
      "Revision Number": "1",
      "Revision ID": "BERT-GF-001-REV-1",
      "Superseded By Revision ID": "BERT-GF-001-REV-2",
      Archived: "true",
      ArchivedAt: iso,
      ArchivedBy: demoEmail("mr.important"),
      ArchiveReason: "Superseded Google Form revision",
    },
    {
      "BERT Template ID": "demo-gf-002",
      "Template Name": "Site Access Request Form",
      "Source Company ID": companyFolderId,
      "Source Company Name": DEMO_COMPANY_NAME,
      Category: "Google Forms",
      "Google Form ID": "demo-gf-file-002",
      "Google Form Drive File ID": "demo-gf-file-002",
      Status: "active",
      "Sync Status": "linked",
      "Form Number": "BERT-GF-002",
      "Revision Number": "1",
      "Revision ID": "BERT-GF-002-REV-1",
      Archived: "false",
    },
  ];

  const roleBreakdown = users.reduce((acc, user) => {
    const role = String(user.Role || "Unknown");
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  const archivedCounts = {
    users: users.filter((row) => String(row.Archived).toLowerCase() === "true").length,
    actions: actions.filter((row) => String(row.Archived).toLowerCase() === "true").length,
    ncrs: ncrs.filter((row) => String(row.Archived).toLowerCase() === "true").length,
    incidents: incidents.filter((row) => String(row.Archived).toLowerCase() === "true").length,
    briefings: briefingRows.filter((row) => String(row.Archived).toLowerCase() === "true").length,
    audits: audits.filter((row) => String(row.Status).toLowerCase() === "superseded").length,
    googleForms: googleForms.filter((row) => String(row.Archived).toLowerCase() === "true").length,
    schedules: schedules.filter((row) => String(row.Archived).toLowerCase() === "true").length,
  };

  return {
    companyName: DEMO_COMPANY_NAME,
    companyFolderId,
    masterSheetId,
    requiredTabs: DEMO_REQUIRED_TABS,
    sites: DEMO_SITES.map((row) => ({ ...row, CreatedAt: iso, UpdatedAt: iso })),
    departments: DEMO_DEPARTMENTS.map((row) => ({ ...row, CreatedAt: iso, UpdatedAt: iso })),
    areas: DEMO_AREAS.map((row) => ({ ...row, CreatedAt: iso, UpdatedAt: iso })),
    users,
    audits,
    schedules,
    actions,
    ncrs,
    incidents,
    briefings: briefingRows,
    briefingRecipients,
    googleForms,
    sharedPassword: DEMO_COMPANY_SHARED_PASSWORD,
    loginSummary: users
      .filter((user) => String(user.Status).toUpperCase() === "ACTIVE")
      .slice(0, 8)
      .map((user) => ({
        name: user.Name,
        email: user.Email,
        role: user.Role,
        password: DEMO_COMPANY_SHARED_PASSWORD,
      })),
    counts: {
      users: users.length,
      activeUsers: users.filter((u) => String(u.Status).toUpperCase() === "ACTIVE").length,
      sites: DEMO_SITES.length,
      departments: DEMO_DEPARTMENTS.length,
      areas: DEMO_AREAS.length,
      auditTemplates: audits.length,
      schedules: schedules.length,
      actions: actions.length,
      ncrs: ncrs.length,
      incidents: incidents.length,
      briefings: briefingRows.length,
      googleForms: googleForms.length,
      archivedTotal: Object.values(archivedCounts).reduce((sum, n) => sum + n, 0),
      archived: archivedCounts,
      roles: roleBreakdown,
    },
    revisionExample: {
      formNumber: "BERT-AUD-001",
      supersededId: "demo-aud-001-rev1",
      activeId: "demo-aud-001-rev2",
    },
    accessExamples: {
      allAccessEmail: demoEmail("mr.important"),
      site1ManagerEmail: demoEmail("terry.terinson"),
      site2ManagerEmail: demoEmail("simon.simple"),
      site1BatchingManagerEmail: demoEmail("jane.pain"),
      site2BatchingManagerEmail: demoEmail("stu.bert"),
    },
    sourceSpreadsheet: "Demo Organisational Chart.xlsx",
    generatedAt: iso,
  };
}

export function summarizeDemoSeed(seed) {
  return {
    companyName: seed.companyName,
    companyFolderId: seed.companyFolderId,
    masterSheetId: seed.masterSheetId,
    counts: seed.counts,
    revisionExample: seed.revisionExample,
    accessExamples: seed.accessExamples,
    loginSummary: seed.loginSummary,
    requiredTabs: seed.requiredTabs,
    generatedAt: seed.generatedAt,
  };
}
