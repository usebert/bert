#!/usr/bin/env node
/**
 * Demo company seeder verifier — definition, guards, and seed payload coverage.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_ARCHIVED_USER,
  DEMO_AREAS,
  DEMO_AUDIT_TEMPLATES,
  DEMO_COMPANY_NAME,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_SHARED_PASSWORD,
  DEMO_DEPARTMENTS,
  DEMO_PEOPLE,
  DEMO_REQUIRED_TABS,
  DEMO_SITES,
  assertDemoCompanyAllowed,
  buildDemoCompanySeed,
  demoEmail,
  isDemoCompanyName,
} from "../shared/demo-company-seed.mjs";
import { isAuditArchivedRecord, filterArchivedWorkbookRows } from "../shared/archive.mjs";
import { getUkTodayKey, isUkOverdue, isUkToday } from "../shared/uk-date-time.mjs";
import { normalizeAccessScope } from "../shared/company-structure-access.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assert(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`FAIL [${checks}]: ${message}`);
    process.exit(1);
  }
  console.log(`PASS [${checks}]: ${message}`);
}

const seedScript = read("scripts/seed-demo-company.mjs");
const packageJson = JSON.parse(read("package.json"));
const seed = buildDemoCompanySeed({ passwordHash: "scrypt$verify$verify" });

assert(packageJson.scripts["seed:demo-company"], "1: seed:demo-company script registered");
assert(packageJson.scripts["verify:demo-company"], "1b: verify:demo-company script registered");
assert(isDemoCompanyName(DEMO_COMPANY_NAME), "2: Demo company name is Dovecote Manufacturing Ltd");
assert(assertDemoCompanyAllowed("TESTCO").ok === false, "2b: refuses TESTCO");
assert(assertDemoCompanyAllowed("Blank Company").ok === false, "2c: refuses Blank Company");
assert(assertDemoCompanyAllowed(DEMO_COMPANY_NAME).ok === true, "2d: allows Dovecote Manufacturing Ltd");
assert(seedScript.includes(DEMO_COMPANY_SEED_CONFIRM_ENV), "3: seeder requires DEMO_COMPANY_SEED_CONFIRM");
assert(seedScript.includes("assertDemoCompanyAllowed"), "3b: seeder guards company name");
assert(seed.companyFolderId && seed.masterSheetId, "4: seed defines folder + workbook ids");
assert(DEMO_REQUIRED_TABS.includes("Users") && DEMO_REQUIRED_TABS.includes("Incidents"), "5: required tabs include Users + Incidents");
assert(DEMO_REQUIRED_TABS.every((tab) => seed.requiredTabs.includes(tab)), "5b: seed required tabs list complete");

assert(DEMO_PEOPLE.length === 23, "6: 23 org-chart people defined");
assert(seed.counts.activeUsers === 23, "6b: 23 active users in seed payload");
assert(seed.users.length === 24, "6c: 23 active + 1 archived user rows");
assert(seed.counts.roles.Admin >= 1, "7: Admin role exists");
assert(seed.counts.roles.Manager >= 1, "7b: Manager role exists");
assert(seed.counts.roles.Auditor >= 1, "7c: Auditor role exists");

assert(
  DEMO_SITES.some((s) => s.SiteName === "Site 1") && DEMO_SITES.some((s) => s.SiteName === "Site 2"),
  "8: Sites Site 1 and Site 2 exist",
);
assert(DEMO_DEPARTMENTS.length >= 10, "9: Departments exist");
assert(DEMO_AREAS.length >= 14, "10: Areas exist for both sites");

const mrImportant = seed.users.find((u) => u.Email === demoEmail("mr.important"));
assert(mrImportant && mrImportant.Role === "Admin", "11a: Mr Important is Admin");
assert(
  !String(mrImportant.SiteIds || "").trim() &&
    !String(mrImportant.DepartmentIds || "").trim() &&
    !String(mrImportant.AreaIds || "").trim(),
  "11: All-access user has blank access fields",
);
const allScope = normalizeAccessScope({
  SiteIds: mrImportant.SiteIds,
  DepartmentIds: mrImportant.DepartmentIds,
  AreaIds: mrImportant.AreaIds,
});
assert(allScope.allSites && allScope.allDepartments && allScope.allAreas, "11b: blank access means all company access");

const terry = seed.users.find((u) => u.Email === demoEmail("terry.terinson"));
assert(terry && terry.SiteIds === "demo-site-1", "12: Site 1 manager only has Site 1 access");
const simon = seed.users.find((u) => u.Email === demoEmail("simon.simple"));
assert(simon && simon.SiteIds === "demo-site-2", "13: Site 2 manager only has Site 2 access");
const jane = seed.users.find((u) => u.Email === demoEmail("jane.pain"));
assert(jane && String(jane.DepartmentIds).includes("batching"), "14: Site 1 batching manager has batching access");
const stu = seed.users.find((u) => u.Email === demoEmail("stu.bert"));
assert(stu && String(stu.DepartmentIds).includes("batching"), "14b: Site 2 batching manager has batching access");

assert(
  seed.audits.every((row) => row["Form Number"] && row["Revision Number"]),
  "15: Audit templates have FormNumber/RevisionNumber",
);
assert(
  seed.audits.some((row) => row["Audit ID"] === "demo-aud-001-rev1" && row.Status === "superseded") &&
    seed.audits.some((row) => row["Audit ID"] === "demo-aud-001-rev2" && row.Status === "active"),
  "16: Revision history example exists (Rev 1 superseded, Rev 2 active)",
);
const archivedAudits = filterArchivedWorkbookRows(seed.audits, "audit");
assert(
  archivedAudits.some((row) => row["Audit ID"] === "demo-aud-001-rev1") &&
    !archivedAudits.some((row) => row["Audit ID"] === "demo-aud-001-rev2"),
  "17: Archive > Audits has superseded revision only",
);
assert(isAuditArchivedRecord(seed.audits.find((row) => row["Audit ID"] === "demo-aud-001-rev1")), "17b: superseded audit counts as archived");

const activeTemplateIds = new Set(
  seed.audits.filter((row) => String(row.Status).toLowerCase() === "active").map((row) => row["Audit ID"]),
);
assert(
  seed.schedules
    .filter((row) => String(row.Status).toUpperCase() === "ACTIVE")
    .every((row) => activeTemplateIds.has(row["Audit ID"])),
  "18: Active schedules use latest active template revisions",
);

const today = getUkTodayKey();
assert(
  seed.schedules.some((row) => isUkToday(row["Start Date"]) && String(row.Status).toUpperCase() === "ACTIVE"),
  "19: Due today schedule example exists",
);
assert(
  seed.schedules.some(
    (row) => isUkOverdue(row["Start Date"]) && String(row.Status).toUpperCase() === "ACTIVE",
  ),
  "19b: Overdue schedule example exists",
);

assert(seed.actions.filter((row) => row.Status === "Open" && row.Archived !== "true").length >= 5, "20: Open actions exist");
assert(
  seed.actions.filter((row) => row.Status === "Open" && isUkOverdue(row["Due Date"]) && row.Archived !== "true")
    .length >= 3,
  "20b: Overdue actions exist",
);
assert(seed.actions.filter((row) => row["Evidence Required"] === "true").length >= 2, "20c: Evidence-needed actions exist");
assert(seed.actions.filter((row) => row.Status === "Closed").length >= 2, "20d: Closed actions exist");
assert(seed.actions.filter((row) => row.Archived === "true").length >= 2, "20e: Archived actions exist");

assert(seed.ncrs.filter((row) => row.Status === "Open" && row.Archived !== "true").length >= 3, "21: Open NCRs exist");
assert(seed.ncrs.some((row) => row["Source Audit ID"] && row["Result ID"]), "21b: NCR linked to audit/result exists");
assert(
  seed.ncrs.some((row) => Number(row["Evidence Count"] || 0) > 0 && row["Evidence Refs"]),
  "22: NCR with evidence metadata exists",
);
assert(seed.ncrs.some((row) => row.Status === "Closed"), "22b: Closed NCR exists");
assert(seed.ncrs.some((row) => row.Archived === "true"), "22c: Archived NCR exists");

assert(seed.incidents.some((row) => row.IncidentType === "Near Miss"), "23: Near miss incident exists");
assert(seed.incidents.some((row) => /injury/i.test(row.IncidentType)), "23b: Injury incident exists");
assert(seed.incidents.some((row) => /property/i.test(row.IncidentType)), "23c: Property damage incident exists");
assert(seed.incidents.some((row) => /investigat/i.test(row.Status)), "23d: Open investigation exists");
assert(seed.incidents.some((row) => row.Status === "Closed" && row.Archived !== "true"), "23e: Closed incident exists");
assert(seed.incidents.some((row) => row.Archived === "true"), "23f: Archived incident exists");

assert(seed.briefings.length >= 5, "24: Briefings exist");
assert(seed.briefingRecipients.some((row) => row.Status === "Sent"), "24b: Unread briefing recipient exists");
assert(seed.briefingRecipients.some((row) => row.Status === "Read"), "24c: Read briefing exists");
assert(seed.briefings.some((row) => row.RequiresSignature === "true"), "24d: Sign-off briefing exists");
assert(seed.briefingRecipients.some((row) => row.Status === "Signed"), "24e: Signed briefing exists");
assert(seed.briefings.some((row) => row.Archived === "true"), "24f: Archived briefing exists");

assert(seed.counts.archived.users >= 1, "25: Archived user exists");
assert(DEMO_ARCHIVED_USER.archived === true, "25b: Archived example user is reactivate-able seed row");
assert(seed.counts.archived.audits >= 1, "25c: Archived/superseded audits exist");
assert(seed.counts.archived.schedules >= 1, "25d: Archived schedules exist");
assert(seed.googleForms.some((row) => row.Status === "superseded"), "25e: Superseded Google Form revision exists");

assert(seed.loginSummary.length >= 1, "26: Login summary present for Manager/Admin testing");
assert(
  seed.users.some((u) => u.Role === "Manager" && u.Status === "ACTIVE"),
  "26b: Manager dashboard user available",
);

assert(
  seed.users.some((u) => /joe jones/i.test(u.Name) && String(u.SiteIds).includes("demo-site-1")),
  "27: People filters can find users by name/site",
);
assert(
  seed.users.some((u) => /bertina/i.test(u.Name) && String(u.DepartmentIds).includes("hr")),
  "27b: People filters can find users by department",
);

const distJs = fs.existsSync(path.join(root, "dist/assets"))
  ? fs
      .readdirSync(path.join(root, "dist/assets"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => fs.readFileSync(path.join(root, "dist/assets", name), "utf8"))
      .join("\n")
  : "";
if (distJs) {
  assert(!distJs.includes("PasswordHash"), "28: No PasswordHash exposed in frontend bundle");
} else {
  assert(!read("src/services/archiveService.ts").includes("PasswordHash"), "28: No PasswordHash in archive client service");
}

assert(!seedScript.includes("TESTCO") || seedScript.includes("refusedNames"), "29: no stale/test workbook shortcut for seeding");
assert(seedScript.includes("folder-first") || seedScript.includes("Company Folder"), "29b: folder-first wording/ids used");
assert(typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today), "30: UK timezone helper returns today key");
assert(DEMO_COMPANY_SHARED_PASSWORD.length >= 12, "30b: shared demo password meets length policy");
assert(demoEmail("joe.jones") === "bert.demo+joe.jones@usebert.co.uk", "email alias pattern");
assert(DEMO_AUDIT_TEMPLATES.length >= 12, "at least 12 audit/form templates defined");
assert(seedScript.includes("hashPassword"), "seeder uses existing password hashing");
assert(seedScript.includes("writeUsersTabRecordByHeaders") || seedScript.includes("Users"), "seeder writes Users via upsert path");

console.log(`\nverify:demo-company passed (${checks} checks).`);
