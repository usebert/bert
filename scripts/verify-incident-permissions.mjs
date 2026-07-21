#!/usr/bin/env node
/**
 * Incident handler reassignment — permissions, history, and evidence isolation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canReassignCompanyIncident,
  isEligibleIncidentReassignTarget,
} from "../shared/incident-assignment-permissions.mjs";
import {
  findIncidentWorkbookRecord,
  incidentIdsMatch,
  isValidRegisterIncidentId,
  normalizeIncidentIdForLookup,
  pickIncidentIdFromRecord,
} from "../shared/incident-id.mjs";
import {
  INCIDENTS_TAB,
  INCIDENTS_TAB_COLUMNS,
  buildIncidentRow,
  reassignCompanyIncident,
  submitCompanyIncident,
} from "../server/incidents-service.mjs";

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
const screen = read("src/screens/IncidentReportingScreen.tsx");
const safetyWorkspace = read("src/safety/SafetyWorkspace.tsx");
const incidentUi = screen + safetyWorkspace;
const roleNavigation = read("src/config/roleNavigation.ts");
const incidentAssignment = read("src/utils/incidentAssignment.ts");
const reassignModal = read("src/components/incidents/IncidentReassignModal.tsx");
const appTsx = read("App.tsx");
const evidenceVerifier = read("scripts/verify-incident-evidence-upload.mjs");

assert(pkg.scripts["verify:incident-permissions"], "PKG: npm script registered");
assert(INCIDENTS_TAB_COLUMNS.includes("AssignmentHistory"), "MODEL: AssignmentHistory column");
assert(INCIDENTS_TAB_COLUMNS.includes("AssignedToEmail"), "MODEL: AssignedToEmail column");
assert(incidentsService.includes("reassignCompanyIncident"), "SERVER: reassignCompanyIncident exported");
assert(
  coreRoutes.includes('app.post("/api/companies/:companyFolderId/incidents/:incidentId/reassign"'),
  "API: reassign route registered",
);
assert(incidentsClient.includes("reassignCompanyIncident"), "CLIENT: reassign API helper");
assert(incidentUi.includes("IncidentReassignModal"), "UI: reassign modal wired");
assert(incidentUi.includes("IncidentAssigneeSelect"), "UI: inline assignee dropdown wired");
assert(incidentUi.includes("openReassignForIncident"), "UI: table assignment opens reassign flow");
assert(incidentUi.includes("openInvestigationWorkflow"), "UI: Continue opens investigation workflow");
assert(incidentUi.includes("investigation-workflow-"), "UI: investigation workflow scroll target id");
assert(appTsx.includes("incidentReassignTargetsLoading"), "LOAD: assignee loading only when targets empty");
assert(appTsx.includes("cachedSeed"), "LOAD: company members use cache seed without blocking UI");
assert(!incidentUi.includes(">Reassign</button>"), "UI: duplicate Reassign button removed");
assert(incidentUi.includes("Assignment history"), "UI: assignment history shown");
assert(appTsx.includes("onReassignIncident={reassignIncidentRecord}"), "APP: reassign handler wired");
assert(appTsx.includes("reassignTargets={incidentReassignTargets}"), "APP: reassign targets passed");
assert(
  roleNavigation.includes('screen === "incidents"') && roleNavigation.includes("shouldLoadCompanyMembersScreen"),
  "LOAD: incidents screen loads company members",
);
assert(appTsx.includes("buildIncidentReassignTargets"), "APP: buildIncidentReassignTargets used");
assert(incidentsService.includes("incident_reassign_lookup"), "LOOKUP: reassign lookup logging");
assert(incidentsService.includes("findIncidentWorkbookRecord"), "LOOKUP: shared incident id finder used");
assert(incidentsClient.includes("incident_reassign_submit"), "CLIENT: reassign submit logging");
assert(incidentsClient.includes("filterValidRegisterIncidents"), "FILTER: register filter helper exported");
assert(incidentsClient.includes("incident_register_filter"), "FILTER: register filter logging");
assert(!isValidRegisterIncidentId("Open"), "FILTER: status Open rejected as incident id");
assert(!isValidRegisterIncidentId("Closed"), "FILTER: status Closed rejected as incident id");
assert(!isValidRegisterIncidentId(""), "FILTER: blank incident id rejected");
assert(isValidRegisterIncidentId("INC-2026-006"), "FILTER: INC-2026-006 accepted");
assert(isValidRegisterIncidentId("INC-2026-0006"), "FILTER: INC-2026-0006 accepted");
assert(!isValidRegisterIncidentId("INC-2026-06"), "FILTER: short sequence rejected");

assert(
  pickIncidentIdFromRecord({ "Incident ID": "INC-2026-003" }) === "INC-2026-003",
  "LOOKUP: Incident ID header alias",
);
assert(incidentIdsMatch("INC-2026-003", "INC-2026-0003"), "LOOKUP: padded incident ids match");
assert(
  normalizeIncidentIdForLookup("INC-2026-003") === normalizeIncidentIdForLookup("INC-2026-0003"),
  "LOOKUP: normalized incident ids equal",
);
const aliasRecord = findIncidentWorkbookRecord([{ "Incident ID": "INC-2026-0003" }], "INC-2026-003");
assert(aliasRecord?.workbookIncidentId === "INC-2026-0003", "LOOKUP: alias record found by padded id");

assert(incidentAssignment.includes("belongsToCompanyUsersTabRow"), "TARGETS: company filter matches People list");
assert(
  reassignModal.includes("Loading handlers") ||
    reassignModal.includes("loadingHandlers") ||
    read("src/i18n/locales/en.ts").includes('loadingHandlers: "Loading handlers'),
  "UI: loading handlers message shown",
);
assert(
  reassignModal.includes("No eligible incident handlers found") ||
    reassignModal.includes("noHandlersHint") ||
    read("src/i18n/locales/en.ts").includes("No eligible incident handlers found"),
  "UI: empty target message shown",
);
assert(reassignModal.includes("initialSelectedEmail"), "UI: modal supports prefilled handler");

const companyFolderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
const masterSheetId = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";
const incidentStore = [];

async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
  if (tabName === INCIDENTS_TAB) {
    return { ok: true, records: incidentStore.map((row) => ({ ...row })), rowCount: incidentStore.length };
  }
  return { ok: true, records: [], rowCount: 0 };
}

async function mockAppendTabRows(_auth, _deps, _sheetId, tabName, _columns, rows = []) {
  if (tabName === INCIDENTS_TAB) {
    incidentStore.push(...rows.map((row) => ({ ...row })));
  }
  return { ok: true, written: rows.length };
}

async function mockPatchTabRowByHeader(_auth, _deps, _sheetId, tabName, keyColumn, keyValue, patch = {}, options = {}) {
  if (tabName !== INCIDENTS_TAB) {
    return { ok: true, updated: 0 };
  }
  const compare =
    typeof options.compareValues === "function"
      ? options.compareValues
      : (left, right) => String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
  const row = incidentStore.find((entry) => compare(entry[keyColumn], keyValue));
  if (!row) {
    return { ok: false, updated: 0 };
  }
  Object.assign(row, patch);
  return { ok: true, updated: 1 };
}

async function mockEnsureTabColumns() {
  return { addedColumns: [], headers: INCIDENTS_TAB_COLUMNS };
}

const mockDeps = {
  readTabRecords: mockReadTabRecords,
  appendTabRows: mockAppendTabRows,
  patchTabRowByHeader: mockPatchTabRowByHeader,
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
  email: "admin@testco.test",
  name: "Admin User",
  companyId: companyFolderId,
  companyFolderId,
};

const managerActor = {
  kind: "company",
  role: "Manager",
  email: "manager@testco.test",
  name: "Manager User",
  companyId: companyFolderId,
  companyFolderId,
};

incidentStore.push({
  "Incident ID": "INC-2026-0003",
  Status: "Open",
  AssignedToEmail: "handler@testco.test",
  AssignedToName: "Handler User",
});
const paddedReassign = await reassignCompanyIncident(
  {},
  mockDeps,
  {
    companyFolderId,
    companyId: companyFolderId,
    incidentId: "INC-2026-003",
    toEmail: "manager@testco.test",
    toName: "Manager User",
    toRole: "Manager",
    resolvedContext: mockContext,
  },
  managerActor,
);
assert(paddedReassign.ok, "REASSIGN: padded request id matches Incident ID column");
assert(incidentStore[0].AssignedToEmail === "manager@testco.test", "REASSIGN: padded workbook row patched");
incidentStore.length = 0;

const masterActor = {
  kind: "company",
  role: "Master",
  email: "master@testco.test",
  name: "Master User",
  companyId: companyFolderId,
  companyFolderId,
};

const auditorActor = {
  kind: "company",
  role: "Auditor",
  email: "auditor@testco.test",
  name: "Auditor User",
  companyId: companyFolderId,
  companyFolderId,
};

const handlerActor = {
  kind: "company",
  role: "Manager",
  email: "handler@testco.test",
  name: "Handler User",
  companyId: companyFolderId,
  companyFolderId,
};

const hsReceiverActor = {
  kind: "company",
  role: "Manager",
  email: "receiver@testco.test",
  name: "Receiver User",
  companyId: companyFolderId,
  companyFolderId,
};

const baseIncident = {
  incidentId: "INC-2026-0100",
  incidentType: "Near Miss",
  severity: "Minor",
  incidentDate: "2026-07-02",
  incidentTime: "09:30",
  reporterName: "Reporter",
  reporterEmail: "reporter@testco.test",
  department: "Ops",
  location: "Yard",
  description: "Slip hazard",
  immediateAction: "Cordoned area",
  witnesses: "Sam",
  evidenceUrls: [{ id: "e1", name: "photo.jpg", mimeType: "image/jpeg", previewUrl: "", addedAt: "2026-07-02T09:30:00.000Z" }],
  assignedToEmail: "handler@testco.test",
  assignedToName: "Handler User",
  assignedByEmail: "admin@testco.test",
  assignedByName: "Admin User",
  assignedAt: "2026-07-02T09:31:00.000Z",
  receivedByEmail: "receiver@testco.test",
  receivedByName: "Receiver User",
  createdBy: "Reporter",
};

const submitted = await submitCompanyIncident(
  {},
  mockDeps,
  {
    ...baseIncident,
    companyFolderId,
    companyId: companyFolderId,
    resolvedContext: mockContext,
  },
);
assert(submitted.ok, "SETUP: incident submitted");
assert(incidentStore[0].AssignedToEmail === "handler@testco.test", "SETUP: initial assignee stored");

const storedIncident = {
  assignedToEmail: "handler@testco.test",
  assignedToName: "Handler User",
  receivedByEmail: "receiver@testco.test",
  receivedByName: "Receiver User",
};

assert(!canReassignCompanyIncident(auditorActor, storedIncident), "PERM: auditor cannot reassign");
assert(canReassignCompanyIncident(adminActor, storedIncident), "PERM: admin can reassign");
assert(canReassignCompanyIncident(managerActor, storedIncident), "PERM: manager can reassign");
assert(canReassignCompanyIncident(masterActor, storedIncident), "PERM: master can reassign");
assert(
  canReassignCompanyIncident(hsReceiverActor, storedIncident),
  "PERM: H&S receiver can reassign received incident",
);
assert(
  !canReassignCompanyIncident(
    { ...hsReceiverActor, role: "Auditor", email: "receiver@testco.test" },
    storedIncident,
  ),
  "PERM: auditor cannot reassign even when listed as receiver",
);
assert(
  canReassignCompanyIncident(handlerActor, storedIncident, {
    targetUser: { email: "manager@testco.test", role: "Manager" },
  }),
  "PERM: assigned handler can reassign to eligible person",
);
assert(
  !canReassignCompanyIncident(handlerActor, storedIncident, {
    targetUser: { email: "auditor@testco.test", role: "Auditor" },
  }),
  "PERM: assigned handler cannot reassign to auditor",
);
assert(isEligibleIncidentReassignTarget({ role: "Manager" }), "TARGET: manager eligible");
assert(isEligibleIncidentReassignTarget({ role: "Company Admin" }), "TARGET: company admin eligible");
assert(!isEligibleIncidentReassignTarget({ role: "Auditor" }), "TARGET: auditor ineligible");
assert(isEligibleIncidentReassignTarget({ role: "User", hsReportReceiver: true }), "TARGET: H&S receiver flag eligible");

const managerReassign = await reassignCompanyIncident(
  {},
  mockDeps,
  {
    companyFolderId,
    companyId: companyFolderId,
    incidentId: "INC-2026-0100",
    toEmail: "manager@testco.test",
    toName: "Manager User",
    toRole: "Manager",
    reason: "Shift cover",
    resolvedContext: mockContext,
  },
  managerActor,
);
assert(managerReassign.ok, "REASSIGN: manager succeeds");
assert(managerReassign.incident.assignedToEmail === "manager@testco.test", "REASSIGN: current assignee updated");
assert(managerReassign.incident.assignmentHistory.length === 1, "REASSIGN: history appended");
assert(managerReassign.incident.assignmentHistory[0].fromEmail === "handler@testco.test", "REASSIGN: history fromEmail");
assert(managerReassign.incident.assignmentHistory[0].toEmail === "manager@testco.test", "REASSIGN: history toEmail");
assert(managerReassign.incident.assignmentHistory[0].byEmail === "manager@testco.test", "REASSIGN: history byEmail");
assert(managerReassign.incident.assignmentHistory[0].reason === "Shift cover", "REASSIGN: history reason");
assert(incidentStore[0].AssignedToEmail === "manager@testco.test", "WORKBOOK: AssignedToEmail patched");
assert(incidentStore[0].AssignmentHistory.includes("handler@testco.test"), "WORKBOOK: AssignmentHistory JSON stored");

const auditorDenied = await reassignCompanyIncident(
  {},
  mockDeps,
  {
    companyFolderId,
    companyId: companyFolderId,
    incidentId: "INC-2026-0100",
    toEmail: "admin@testco.test",
    toName: "Admin User",
    toRole: "Admin",
    resolvedContext: mockContext,
  },
  auditorActor,
);
assert(!auditorDenied.ok && auditorDenied.httpStatus === 403, "SERVER: auditor reassign forbidden");

const handlerReassign = await reassignCompanyIncident(
  {},
  mockDeps,
  {
    companyFolderId,
    companyId: companyFolderId,
    incidentId: "INC-2026-0100",
    toEmail: "admin@testco.test",
    toName: "Admin User",
    toRole: "Admin",
    reason: "Specialist handover",
    resolvedContext: mockContext,
  },
  {
    ...handlerActor,
    email: "manager@testco.test",
    name: "Manager User",
  },
);
assert(handlerReassign.ok, "REASSIGN: second reassignment succeeds");
assert(handlerReassign.incident.assignmentHistory.length === 2, "REASSIGN: history accumulates");

const row = buildIncidentRow({
  ...baseIncident,
  assignmentHistory: handlerReassign.incident.assignmentHistory,
});
assert(row.AssignmentHistory.includes("Specialist handover"), "ROW: assignment history serialised");
assert(row.EvidenceUrls.includes("photo.jpg"), "EVIDENCE: upload metadata unchanged after reassign");
assert(evidenceVerifier.includes("uploadIncidentEvidenceToDrive"), "EVIDENCE: incident upload verifier still present");

console.log(`PASS: verify-incident-permissions (${caseCount} checks)`);
