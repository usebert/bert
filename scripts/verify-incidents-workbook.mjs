#!/usr/bin/env node
/**
 * Incidents workbook — tab ensure, POST/GET permissions, notification isolation, validation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INCIDENTS_TAB,
  INCIDENTS_TAB_COLUMNS,
  buildIncidentRow,
  canListCompanyIncidents,
  canSubmitCompanyIncident,
  listCompanyIncidents,
  submitCompanyIncident,
  validateIncidentSubmitInput,
} from "../server/incidents-service.mjs";
import { isCompanyInviteActor } from "../shared/company-invite-permissions.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const incidentsService = read("server/incidents-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const incidentsClient = read("src/services/incidentsService.ts");
const appTsx = read("App.tsx");

assert(pkg.scripts["verify:incidents-workbook"], "PKG: npm script registered");
assert(incidentsService.includes("ensureTabColumns"), "1: Incidents tab ensured via ensureTabColumns");
assert(incidentsService.includes(`INCIDENTS_TAB = "${INCIDENTS_TAB}"`), "1b: Incidents tab name");
assert(INCIDENTS_TAB_COLUMNS.includes("IncidentId"), "1c: IncidentId column defined");
assert(INCIDENTS_TAB_COLUMNS.includes("NotificationStatus"), "1d: NotificationStatus column defined");

assert(coreRoutes.includes('app.post("/api/companies/:companyFolderId/incidents"'), "API: POST incidents route");
assert(coreRoutes.includes('app.get("/api/companies/:companyFolderId/incidents"'), "API: GET incidents route");

const companyFolderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
const masterSheetId = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";
const incidentStore = [];

async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
  if (tabName === INCIDENTS_TAB) {
    return { ok: true, records: [...incidentStore], rowCount: incidentStore.length };
  }
  return { ok: true, records: [], rowCount: 0 };
}

async function mockAppendTabRows(_auth, _deps, _sheetId, tabName, _columns, rows = []) {
  if (tabName === INCIDENTS_TAB) {
    incidentStore.push(...rows);
  }
  return { ok: true, written: rows.length };
}

async function mockEnsureTabColumns() {
  return { addedColumns: [], headers: INCIDENTS_TAB_COLUMNS };
}

const mockDeps = {
  readTabRecords: mockReadTabRecords,
  appendTabRows: mockAppendTabRows,
  ensureTabColumns: mockEnsureTabColumns,
};

const mockContext = {
  ok: true,
  companyId: companyFolderId,
  companyFolderId,
  masterSheetId,
  alternateIds: [],
};

const adminActor = {
  kind: "company",
  role: "Admin",
  accessLevel: "admin",
  email: "admin@testco.test",
  companyId: companyFolderId,
  companyFolderId,
};

const managerActor = {
  kind: "company",
  role: "Manager",
  accessLevel: "manager",
  email: "manager@testco.test",
  companyId: companyFolderId,
  companyFolderId,
};

const auditorActor = {
  kind: "company",
  role: "Auditor",
  accessLevel: "auditor",
  email: "auditor@testco.test",
  companyId: companyFolderId,
  companyFolderId,
};

const outsiderActor = {
  kind: "company",
  role: "Admin",
  accessLevel: "admin",
  email: "other@testco.test",
  companyId: "other-folder",
  companyFolderId: "other-folder",
};

assert(canSubmitCompanyIncident(auditorActor, companyFolderId), "5: Auditor can submit");
assert(canListCompanyIncidents(adminActor, companyFolderId), "3: Admin can list");
assert(canListCompanyIncidents(managerActor, companyFolderId), "3b: Manager can list");
assert(!canListCompanyIncidents(auditorActor, companyFolderId), "3c: Auditor cannot list");
assert(isCompanyInviteActor(adminActor), "perm: Admin is invite actor");
assert(!isCompanyInviteActor(auditorActor), "perm: Auditor is not invite actor");

const missing = validateIncidentSubmitInput({
  incidentType: "Near Miss",
  severity: "Minor",
});
assert(!missing.ok && missing.code === "INCIDENT_FIELDS_REQUIRED", "6: Missing required fields rejected");

const row = buildIncidentRow({
  incidentId: "INC-2026-001",
  incidentType: "Near Miss",
  severity: "Minor",
  incidentDate: "2026-04-19",
  incidentTime: "09:30",
  reporterName: "Alex Auditor",
  reporterEmail: "auditor@testco.test",
  department: "Ops",
  location: "Yard",
  description: "Slip hazard",
  immediateAction: "Cordoned area",
  witnesses: "Sam",
  evidenceUrls: [{ id: "e1", name: "photo.jpg", mimeType: "image/jpeg", previewUrl: "", addedAt: "2026-04-19T09:30:00.000Z" }],
  createdBy: "Alex Auditor",
});
assert(row.IncidentId === "INC-2026-001", "2: POST row IncidentId set");
assert(row.Department === "Ops", "2b: POST row Department set");

const submitted = await submitCompanyIncident(
  {},
  mockDeps,
  {
    incidentId: "INC-2026-001",
    incidentType: "Near Miss",
    severity: "Minor",
    incidentDate: "2026-04-19",
    incidentTime: "09:30",
    reporterName: "Alex Auditor",
    reporterEmail: "auditor@testco.test",
    department: "Ops",
    location: "Yard",
    description: "Slip hazard",
    immediateAction: "Cordoned area",
    witnesses: "Sam",
    evidenceUrls: [{ id: "e1", name: "photo.jpg", mimeType: "image/jpeg", previewUrl: "", addedAt: "2026-04-19T09:30:00.000Z" }],
    createdBy: "Alex Auditor",
    companyFolderId,
    companyId: companyFolderId,
    resolvedContext: mockContext,
  },
);
assert(submitted.ok, "2: POST writes row");
assert(incidentStore.length === 1, "2c: one Incidents row written");
assert(incidentStore[0].IncidentId === "INC-2026-001", "2d: written IncidentId correct");

const listed = await listCompanyIncidents(
  {},
  mockDeps,
  { companyFolderId, companyId: companyFolderId, masterSheetId },
  { resolvedContext: mockContext },
);
assert(listed.ok, "3: GET returns incidents");
assert(listed.incidents.length === 1, "3b: one incident returned");
assert(listed.companyId === companyFolderId, "9: companyId === companyFolderId");
assert(listed.companyFolderId === companyFolderId, "9b: companyFolderId echoed");

assert(
  /setIncidents\([\s\S]{0,500}sendIncidentNotification/.test(appTsx),
  "5: Notification failure does not prevent save (save before notify)",
);
assert(appTsx.includes("pushToast(\"Notification failed\""), "5b: notification failure surfaces toast without rethrow");
assert(appTsx.includes("submitCompanyIncident("), "frontend: POST workbook API before notify");
assert(appTsx.includes("fetchCompanyIncidents("), "frontend: GET incidents for Admin/Manager");
assert(
  appTsx.includes("mergeWorkbookAndLocalIncidents") || appTsx.includes("mergeWorkbookIncidentsWithLocal"),
  "8: offline fallback merge helper",
);

assert(!incidentsClient.includes("PasswordHash"), "7: no PasswordHash in incidents client");
assert(!incidentsService.includes("PasswordHash"), "7b: no PasswordHash in incidents service");
assert(incidentsClient.includes("stripSensitiveFields"), "7c: sensitive field stripping in client mapper");

assert(!canSubmitCompanyIncident(outsiderActor, companyFolderId), "perm: outsider cannot submit");
assert(!canListCompanyIncidents(outsiderActor, companyFolderId), "perm: outsider cannot list");

console.log(`PASS: verify-incidents-workbook (${caseCount} checks)`);
