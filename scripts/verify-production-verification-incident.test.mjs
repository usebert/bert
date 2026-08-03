#!/usr/bin/env node
/**
 * Server-side regression tests for production verification Incident markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { incidentIdsMatch } from "../shared/incident-id.mjs";
import { buildHealthSafetyMetrics } from "../shared/health-safety-overview.mjs";
import {
  buildProductionVerificationIncident,
  isActiveVerificationIncident,
  isOperationalIncident,
  isVerificationIncident,
  listActiveVerificationIncidents,
  PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_INCIDENT_SOURCE,
} from "../shared/production-verification-incident.mjs";
import {
  cleanupStaleVerificationIncidents,
  cleanupVerificationIncident,
  closeCompanyIncident,
  INCIDENTS_TAB,
  isAllowedIncidentStatusTransition,
  patchCompanyIncident,
  submitCompanyIncident,
} from "../server/incidents-service.mjs";
import { RIDDOR_REPORTS_TAB } from "../shared/health-safety.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 424242;

const resolvedContext = {
  ok: true,
  companyFolderId,
  companyId: companyFolderId,
  masterSheetId,
  alternateIds: [],
};

const actor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
};

function customerIncidentRow() {
  return {
    IncidentId: "inc-customer-1",
    Status: "Open",
    Priority: "Normal",
    IncidentType: "Slip/Trip",
    Severity: "Minor",
    IncidentDate: "2026-01-15",
    IncidentTime: "09:30",
    ReporterName: "Warehouse Lead",
    ReporterEmail: "lead@example.com",
    Department: "Production / Assembly",
    Location: "Bay 1",
    Description: "Customer incident in assembly area",
    ImmediateAction: "Area cordoned off",
    Witnesses: "",
    EvidenceUrls: "[]",
    CreatedAt: "2026-01-15T09:30:00.000Z",
    CreatedBy: "Warehouse Lead",
    UpdatedAt: "2026-01-15T09:30:00.000Z",
    NotificationStatus: "Pending",
    VerificationSource: "",
  };
}

function verificationIncidentRow(overrides = {}) {
  const incident = buildProductionVerificationIncident({
    runId,
    incidentId: `bert-smoke-inc-${runId}`,
    reporterEmail: actor.email,
  });
  return {
    IncidentId: incident.incidentId,
    Status: incident.status,
    Priority: incident.priority,
    IncidentType: incident.incidentType,
    Severity: incident.severity,
    IncidentDate: incident.incidentDate,
    IncidentTime: incident.incidentTime,
    ReporterName: incident.reporterName,
    ReporterEmail: incident.reporterEmail,
    Department: incident.department,
    Location: incident.location,
    Description: incident.description,
    ImmediateAction: incident.immediateAction,
    Witnesses: incident.witnesses,
    EvidenceUrls: "[]",
    CreatedAt: incident.createdAt,
    CreatedBy: incident.createdBy,
    UpdatedAt: incident.updatedAt,
    NotificationStatus: incident.notificationStatus,
    VerificationSource: incident.verificationSource,
    InvestigationNotes: incident.investigationNotes || "",
    RootCause: incident.rootCause || "",
    ClosedAt: "",
    ClosedBy: "",
    ...overrides,
  };
}

function createIncidentDeps(initialRows = [], riddorRows = []) {
  const rowsByTab = {
    [INCIDENTS_TAB]: initialRows.map((row) => ({ ...row })),
    [RIDDOR_REPORTS_TAB]: riddorRows.map((row) => ({ ...row })),
  };

  return {
    rowsByTab,
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => ({
      records: (rowsByTab[tabName] || []).map((row) => ({ ...row })),
    }),
    appendTabRows: async (_auth, _deps, _sheetId, tabName, _columns, newRows) => {
      rowsByTab[tabName].push(...newRows.map((row) => ({ ...row })));
      return { ok: true };
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tabName, header, matchValue, patch) => {
      const records = rowsByTab[tabName] || [];
      const index = records.findIndex((row) => {
        if (header === "RiddorId") {
          return String(row.RiddorId || row.riddorId) === String(matchValue);
        }
        return incidentIdsMatch(row.IncidentId, matchValue);
      });
      if (index === -1) {
        return { ok: false, patched: 0, updatedRows: 0 };
      }
      rowsByTab[tabName][index] = { ...records[index], ...patch };
      return { ok: true, patched: 1, updatedRows: 1 };
    },
    ensureTabColumns: async () => ({ ok: true }),
  };
}

function submitPayload(overrides = {}) {
  const incident = buildProductionVerificationIncident({
    runId,
    reporterEmail: actor.email,
    ...overrides,
  });
  return {
    ...incident,
    companyFolderId,
    masterSheetId,
    resolvedContext,
    ...overrides,
  };
}

test("verification marker parsing identifies verification incidents", () => {
  const row = verificationIncidentRow();
  const mapped = {
    incidentId: row.IncidentId,
    title: "BERT Verification Incident",
    description: row.Description,
    incidentType: row.IncidentType,
    witnesses: row.Witnesses,
    verificationSource: row.VerificationSource,
    status: row.Status,
  };
  assert.equal(isVerificationIncident(mapped), true);
  assert.equal(isActiveVerificationIncident(mapped), true);
  assert.equal(isOperationalIncident(mapped), false);
});

test("operational incident metrics exclude active verification rows", () => {
  const customer = {
    id: "inc-customer-1",
    incidentId: "inc-customer-1",
    status: "Open",
    severity: "Minor",
    priority: "Normal",
    incidentType: "Slip/Trip",
  };
  const verification = {
    id: `bert-smoke-inc-${runId}`,
    incidentId: `bert-smoke-inc-${runId}`,
    title: "BERT Verification Incident",
    description: "Automated production Incident workflow verification. Safe to remove.",
    incidentType: "Near Miss",
    witnesses: "verification",
    verificationSource: PRODUCTION_VERIFICATION_INCIDENT_SOURCE,
    status: "Open",
    severity: "Minor",
    priority: "Normal",
  };
  const metrics = buildHealthSafetyMetrics({
    incidents: [customer, verification],
    riddor: [],
    coshh: [],
    equipment: [],
    incidentActions: [],
    riskAssessments: [],
    todayKey: "2026-07-01",
  });
  assert.equal(metrics.openIncidents, 1);
});

test("closed verification incidents are excluded from operational metrics", () => {
  const customer = {
    id: "inc-customer-1",
    incidentId: "inc-customer-1",
    status: "Open",
    severity: "Minor",
    priority: "Normal",
    incidentType: "Slip/Trip",
  };
  const verification = {
    id: `bert-smoke-inc-${runId}`,
    incidentId: `bert-smoke-inc-${runId}`,
    title: "BERT Verification Incident",
    description: "Automated production Incident workflow verification. Safe to remove.",
    incidentType: "Near Miss",
    witnesses: "verification",
    verificationSource: PRODUCTION_VERIFICATION_INCIDENT_SOURCE,
    status: "Closed",
    severity: "Minor",
    priority: "Normal",
  };
  const metrics = buildHealthSafetyMetrics({
    incidents: [customer, verification],
    riddor: [],
    coshh: [],
    equipment: [],
    incidentActions: [],
    riskAssessments: [],
    todayKey: "2026-07-01",
  });
  assert.equal(metrics.openIncidents, 1);
});

test("verification-only cleanup archives verification incident", async () => {
  const verification = verificationIncidentRow({ Status: "Closed", ClosedAt: "2026-07-01T12:00:00.000Z" });
  const deps = createIncidentDeps([customerIncidentRow(), verification]);
  const result = await cleanupVerificationIncident(
    null,
    deps,
    { companyFolderId, masterSheetId, incidentId: verification.IncidentId, resolvedContext },
    actor,
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS);
  assert.equal(result.updatedRows, 1);
});

test("verification cleanup archives linked RIDDOR row", async () => {
  const verification = verificationIncidentRow({ Status: "Closed", ClosedAt: "2026-07-01T12:00:00.000Z" });
  const riddorRow = {
    RiddorId: "riddor-verify-1",
    IncidentId: verification.IncidentId,
    Status: "Draft",
    CreatedAt: "2026-07-01T11:00:00.000Z",
  };
  const deps = createIncidentDeps([customerIncidentRow(), verification], [riddorRow]);
  const result = await cleanupVerificationIncident(
    null,
    deps,
    { companyFolderId, masterSheetId, incidentId: verification.IncidentId, resolvedContext },
    actor,
  );
  assert.equal(result.ok, true);
  assert.equal(result.archivedRiddor, 1);
  const archived = deps.rowsByTab[RIDDOR_REPORTS_TAB][0];
  assert.ok(archived.ArchivedAt);
  assert.equal(archived.ArchivedBy, actor.email);
});

test("stale verification cleanup only affects verification-marked incidents", async () => {
  const verification = verificationIncidentRow({ Status: "Under Investigation" });
  const deps = createIncidentDeps([customerIncidentRow(), verification]);
  const result = await cleanupStaleVerificationIncidents(
    null,
    deps,
    { companyFolderId, masterSheetId, resolvedContext },
    actor,
  );
  assert.equal(result.ok, true);
  assert.equal(result.cleanedCount, 1);
  assert.equal(result.results[0].incidentId, verification.IncidentId);
  assert.equal(listActiveVerificationIncidents(deps.rowsByTab[INCIDENTS_TAB].map((row) => ({
    incidentId: row.IncidentId,
    description: row.Description,
    incidentType: row.IncidentType,
    witnesses: row.Witnesses,
    verificationSource: row.VerificationSource,
    status: row.Status,
  }))).length, 0);
});

test("company scoping rejects mismatched company identifiers on submit", async () => {
  const deps = createIncidentDeps([customerIncidentRow()]);
  const denied = await submitCompanyIncident(null, deps, submitPayload({ companyFolderId: "folder-other" }));
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "INCIDENT_COMPANY_MISMATCH");
});

test("non-verification cleanup is rejected", async () => {
  const deps = createIncidentDeps([customerIncidentRow()]);
  const denied = await cleanupVerificationIncident(
    null,
    deps,
    { companyFolderId, masterSheetId, incidentId: "inc-customer-1", resolvedContext },
    actor,
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.httpStatus, 403);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_INCIDENT");
});

test("incident ID stability and idempotent submit", async () => {
  const deps = createIncidentDeps([customerIncidentRow()]);
  const payload = submitPayload();
  const first = await submitCompanyIncident(null, deps, payload);
  assert.equal(first.ok, true);
  assert.equal(first.incidentId, payload.incidentId);
  assert.equal(first.updatedRows, 1);

  const second = await submitCompanyIncident(null, deps, payload);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyExists, true);
  assert.equal(second.incidentId, payload.incidentId);
  assert.equal(deps.rowsByTab[INCIDENTS_TAB].length, 2);
});

test("read-after-write updatedRows on patch", async () => {
  const verification = verificationIncidentRow();
  const deps = createIncidentDeps([customerIncidentRow(), verification]);
  const patched = await patchCompanyIncident(
    null,
    deps,
    {
      companyFolderId,
      masterSheetId,
      incidentId: verification.IncidentId,
      description: `${verification.Description} Updated during edit incident.`,
      resolvedContext,
    },
    actor,
  );
  assert.equal(patched.ok, true);
  assert.equal(patched.updatedRows, 1);
  assert.match(patched.incident.description, /Updated during edit incident./);
});

test("status transition rules block unsupported transitions", () => {
  assert.equal(isAllowedIncidentStatusTransition("Open", "Under Investigation"), true);
  assert.equal(isAllowedIncidentStatusTransition("Open", "Closed"), true);
  assert.equal(isAllowedIncidentStatusTransition("Open", "Awaiting Closure"), false);
  assert.equal(isAllowedIncidentStatusTransition("Under Investigation", "Closed"), true);
  assert.equal(isAllowedIncidentStatusTransition("Closed", "Open"), false);
});

test("patch rejects invalid incident status transition", async () => {
  const verification = verificationIncidentRow();
  const deps = createIncidentDeps([customerIncidentRow(), verification]);
  const denied = await patchCompanyIncident(
    null,
    deps,
    {
      companyFolderId,
      masterSheetId,
      incidentId: verification.IncidentId,
      status: "Awaiting Closure",
      resolvedContext,
    },
    actor,
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "INCIDENT_STATUS_TRANSITION_INVALID");
});

test("closure idempotency returns alreadyClosed", async () => {
  const verification = verificationIncidentRow({
    Status: "Under Investigation",
    InvestigationNotes: "Production smoke verification investigation summary.",
    RootCause: "Other",
  });
  const deps = createIncidentDeps([customerIncidentRow(), verification]);
  const first = await closeCompanyIncident(
    null,
    deps,
    { companyFolderId, masterSheetId, incidentId: verification.IncidentId, resolvedContext },
    actor,
  );
  assert.equal(first.ok, true);
  assert.equal(first.alreadyClosed, false);
  assert.equal(first.updatedRows, 1);

  const second = await closeCompanyIncident(
    null,
    deps,
    { companyFolderId, masterSheetId, incidentId: verification.IncidentId, resolvedContext },
    actor,
  );
  assert.equal(second.ok, true);
  assert.equal(second.alreadyClosed, true);
  assert.equal(second.updatedRows, 0);
});

test("idempotent retry behaviour preserves single workbook row", async () => {
  const deps = createIncidentDeps([customerIncidentRow()]);
  const payload = submitPayload();
  const first = await submitCompanyIncident(null, deps, payload);
  const retry = await submitCompanyIncident(null, deps, payload);
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(retry.alreadyExists, true);
  assert.equal(deps.rowsByTab[INCIDENTS_TAB].filter((row) => row.IncidentId === payload.incidentId).length, 1);
});

test("listActiveVerificationIncidents ignores cleaned rows", () => {
  const active = {
    incidentId: `bert-smoke-inc-${runId}`,
    description: "Automated production Incident workflow verification. Safe to remove.",
    incidentType: "Near Miss",
    witnesses: "verification",
    verificationSource: PRODUCTION_VERIFICATION_INCIDENT_SOURCE,
    status: "Open",
  };
  const cleaned = {
    ...active,
    status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
  };
  assert.equal(listActiveVerificationIncidents([active, cleaned]).length, 1);
});
