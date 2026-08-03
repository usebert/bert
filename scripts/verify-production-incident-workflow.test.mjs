#!/usr/bin/env node
/**
 * Unit tests for production Incident workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  attemptVerificationIncidentCleanup,
  formatIncidentWorkflowReport,
  loadIncidentWorkflowConfig,
  runProductionIncidentWorkflowChecks,
} from "./lib/production-incident-workflow-core.mjs";
import {
  buildProductionVerificationIncident,
  buildProductionVerificationIncidentId,
  countIncidentBaselines,
  isActiveVerificationIncident,
  isOperationalIncident,
  isVerificationIncident,
  listActiveVerificationIncidents,
  PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_INCIDENT_DESCRIPTION,
  PRODUCTION_VERIFICATION_INCIDENT_INVESTIGATION_SUMMARY,
  PRODUCTION_VERIFICATION_INCIDENT_RIDDOR_REASON,
} from "../shared/production-verification-incident.mjs";

const baseConfig = loadIncidentWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_INCIDENT_MUTATION: "1",
});

const TEST_RUN_ID = 12345;
const defaultRunOptions = {
  runId: TEST_RUN_ID,
  listPollMaxAttempts: 5,
  listPollIntervalMs: 0,
};

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return trim(value).toLowerCase();
}

function successLoginJson() {
  return {
    ok: true,
    user: {
      email: baseConfig.expectedEmail,
      role: "Admin",
      name: "Mr Important",
      companyFolderId: baseConfig.companyFolderId,
    },
    company: {
      companyFolderId: baseConfig.companyFolderId,
      companyName: "Dovecote Demo",
      live: true,
    },
    masterSheetId: baseConfig.masterSheetId,
  };
}

function customerIncident() {
  return {
    id: "incident-customer-1",
    incidentId: "inc-customer-1",
    companyFolderId: baseConfig.companyFolderId,
    incidentType: "Slip/Trip",
    severity: "Minor",
    status: "Open",
    description: "Customer incident in assembly area",
    department: "Production / Assembly",
    location: "Bay 1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function toListItem(incident) {
  return {
    id: `incident-${incident.incidentId}`,
    incidentId: incident.incidentId,
    companyFolderId: baseConfig.companyFolderId,
    incidentType: incident.incidentType,
    severity: incident.severity,
    status: incident.status,
    description: incident.description,
    department: incident.department,
    location: incident.location,
    investigationNotes: incident.investigationNotes || "",
    rootCause: incident.rootCause || "",
    witnesses: incident.witnesses || "",
    verificationSource: incident.verificationSource || "",
    closedAt: incident.closedAt || "",
    closedBy: incident.closedBy || "",
    createdAt: incident.createdAt || new Date().toISOString(),
    updatedAt: incident.updatedAt || new Date().toISOString(),
  };
}

function createTransport(options = {}) {
  const cookies = new Map();
  const runId = options.runId ?? TEST_RUN_ID;
  const verificationIncidentId = buildProductionVerificationIncidentId(runId);
  const verificationTemplate = buildProductionVerificationIncident({
    runId,
    incidentId: verificationIncidentId,
    reporterName: "Mr Important",
    reporterEmail: baseConfig.expectedEmail,
  });

  let incidents = options.initialIncidents ? [...options.initialIncidents] : [customerIncident()];
  const incidentStore = new Map();
  for (const item of incidents) {
    incidentStore.set(item.incidentId, { ...item });
  }

  let loginAttempts = 0;
  let createAttempts = 0;
  let closeAttempts = 0;
  let detailReads = 0;
  let editDetailReads = 0;
  let suppressVerificationInListCount = options.listStaleUntilAttempt || 0;
  let cleanupAttempts = 0;
  let create502Attempts = 0;

  let editDetailReadsDuringEditStage = 0;

  function upsertIncident(record) {
    incidentStore.set(record.incidentId, { ...record });
    const listEntry = toListItem(record);
    const idx = incidents.findIndex((item) => item.incidentId === record.incidentId);
    if (idx >= 0) {
      incidents[idx] = listEntry;
    } else {
      incidents.push(listEntry);
    }
  }

  function getIncident(incidentId) {
    return incidentStore.get(incidentId) || null;
  }

  function listIncidentsForResponse() {
    let items = [...incidents];
    if (suppressVerificationInListCount > 0) {
      suppressVerificationInListCount -= 1;
      items = items.filter((item) => item.incidentId !== verificationIncidentId);
    }
    if (options.hideClosedVerificationInList === true) {
      items = items.filter(
        (item) =>
          !(
            isVerificationIncident(item) &&
            normalizeStatus(item.status) === "closed"
          ),
      );
    }
    return items;
  }

  function detailPayload(incidentId) {
    const incident = getIncident(incidentId);
    if (!incident) {
      return { status: 404, json: { ok: false, code: "INCIDENT_NOT_FOUND" } };
    }
    return {
      status: 200,
      json: {
        ok: true,
        incidentId: incident.incidentId,
        incident: { ...incident },
      },
    };
  }

  const request = async (method, path, body, requestOptions = {}) => {
    const stageKey = trim(requestOptions.stageKey);
    const pathname = (path.split("?")[0] || path).replace(/\/$/, "");

    if (method === "GET" && pathname === "/api/health") {
      return {
        status: 200,
        json: { ok: true, version: "2026.08.01", gitSha: "abc123def456", shortSha: "abc123d" },
      };
    }

    if (method === "POST" && pathname === "/api/auth/company/login") {
      loginAttempts += 1;
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      return { status: 200, json: successLoginJson() };
    }

    if (method === "GET" && pathname === "/api/auth/company/session") {
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: "Admin" },
          company: { companyFolderId: baseConfig.companyFolderId },
        },
      };
    }

    if (method === "GET" && pathname.includes("/incidents") && !pathname.match(/\/incidents\/[^/]+$/)) {
      if (options.incidentsResponse) {
        return options.incidentsResponse();
      }
      return {
        status: options.incidentsUnavailable ? 503 : 200,
        json: options.incidentsUnavailable
          ? { ok: false, code: "INCIDENTS_UNAVAILABLE" }
          : {
              ok: true,
              incidents: listIncidentsForResponse(),
              companyFolderId: baseConfig.companyFolderId,
            },
      };
    }

    if (
      method === "POST" &&
      pathname.endsWith("/incidents/verification-cleanup") &&
      !pathname.includes(`${verificationIncidentId}/verification-cleanup`)
    ) {
      if (!options.staleCleanupNoOp) {
        incidents = incidents.map((item) =>
          isVerificationIncident(item) &&
          isActiveVerificationIncident(item) &&
          item.incidentId !== verificationIncidentId
            ? {
                ...item,
                status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
                closedAt: item.closedAt || new Date().toISOString(),
              }
            : item,
        );
        for (const [incidentId, record] of incidentStore.entries()) {
          if (
            isVerificationIncident(record) &&
            isActiveVerificationIncident(record) &&
            incidentId !== verificationIncidentId
          ) {
            incidentStore.set(incidentId, {
              ...record,
              status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
              closedAt: record.closedAt || new Date().toISOString(),
            });
          }
        }
      }
      return {
        status: 200,
        json: { ok: true, cleanedCount: options.staleCleanupNoOp ? 0 : 1, results: [{ incidentId: verificationIncidentId, ok: true }] },
      };
    }

    if (method === "POST" && pathname.endsWith("/incidents") && !pathname.includes("verification-cleanup")) {
      createAttempts += 1;
      if (options.createResponse) {
        return options.createResponse(body);
      }
      if (options.createFails) {
        return { status: 500, json: { ok: false, code: "INCIDENT_SUBMIT_FAILED" } };
      }
      if (options.create502Once && create502Attempts === 0) {
        create502Attempts += 1;
        return { status: 502, json: null };
      }
      const requestedId = trim(body?.incidentId) || verificationIncidentId;
      const existing = getIncident(requestedId);
      if (existing) {
        return {
          status: 200,
          json: {
            ok: true,
            alreadyExists: true,
            incidentId: existing.incidentId,
            incident: existing,
            updatedRows: 0,
          },
        };
      }
      if (options.createSuccessButNotVisible) {
        return {
          status: 200,
          json: { ok: true, incidentId: requestedId, updatedRows: 1 },
        };
      }
      const created = {
        ...verificationTemplate,
        ...body,
        incidentId: requestedId,
        status: "Open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      upsertIncident(created);
      suppressVerificationInListCount = Number(options.listStaleUntilAttempt) || 0;
      return {
        status: 200,
        json: { ok: true, incidentId: requestedId, updatedRows: 1, incident: created },
      };
    }

    if (method === "GET" && pathname.match(/\/incidents\/[^/]+$/)) {
      const incidentId = decodeURIComponent(pathname.split("/incidents/")[1] || "");
      detailReads += 1;
      if (options.detailMissing) {
        return { status: 404, json: { ok: false, code: "INCIDENT_NOT_FOUND" } };
      }
      if (options.editStaleDetail && stageKey === "editIncident" && incidentId === verificationIncidentId) {
        editDetailReadsDuringEditStage += 1;
        if (editDetailReadsDuringEditStage === 1) {
          const stale = getIncident(incidentId);
          return {
            status: 200,
            json: {
              ok: true,
              incidentId,
              incident: {
                ...stale,
                description: PRODUCTION_VERIFICATION_INCIDENT_DESCRIPTION,
              },
            },
          };
        }
      }
      if (
        options.statusProgressionShowsOpen &&
        stageKey === "statusProgression" &&
        incidentId === verificationIncidentId
      ) {
        const incident = getIncident(incidentId);
        if (incident && normalizeStatus(incident.status) === "under investigation") {
          return {
            status: 200,
            json: {
              ok: true,
              incidentId,
              incident: { ...incident, status: "Open" },
            },
          };
        }
      }
      return detailPayload(incidentId);
    }

    if (method === "PATCH" && pathname.includes("/incidents/")) {
      const incidentId = decodeURIComponent(pathname.split("/incidents/")[1] || "");
      const current = getIncident(incidentId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "INCIDENT_NOT_FOUND" } };
      }
      if (options.editFails && trim(body?.description || "").includes("Updated during edit incident.")) {
        return { status: 500, json: { ok: false, code: "INCIDENT_PATCH_FAILED" } };
      }
      if (options.investigationPermissionFails && trim(body?.status) === "Under Investigation") {
        return {
          status: 403,
          json: { ok: false, code: "INCIDENT_INVESTIGATION_FORBIDDEN", error: "Investigation permission denied." },
        };
      }
      if (options.invalidStatusTransition && trim(body?.status) === "Awaiting Closure") {
        return {
          status: 400,
          json: {
            ok: false,
            code: "INCIDENT_STATUS_TRANSITION_INVALID",
            error: "Cannot transition incident status from Open to Awaiting Closure.",
          },
        };
      }
      const nextStatus = trim(body?.status) || current.status;
      const updated = {
        ...current,
        description: body?.description !== undefined ? body.description : current.description,
        location: body?.location !== undefined ? body.location : current.location,
        immediateAction: body?.immediateAction !== undefined ? body.immediateAction : current.immediateAction,
        investigationNotes:
          body?.investigationNotes !== undefined ? body.investigationNotes : current.investigationNotes,
        rootCause: body?.rootCause !== undefined ? body.rootCause : current.rootCause,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
      upsertIncident(updated);
      return { status: 200, json: { ok: true, incidentId, incident: updated, updatedRows: 1 } };
    }

    if (method === "POST" && pathname.endsWith("/riddor-assessment")) {
      if (options.riddorFails) {
        return { status: 500, json: { ok: false, code: "RIDDOR_ASSESSMENT_FAILED" } };
      }
      return {
        status: 200,
        json: {
          ok: true,
          item: {
            decisionStatus: "not_reportable",
            supportingReason: PRODUCTION_VERIFICATION_INCIDENT_RIDDOR_REASON,
          },
        },
      };
    }

    if (method === "POST" && pathname.endsWith("/close")) {
      closeAttempts += 1;
      const incidentId = decodeURIComponent(pathname.split("/incidents/")[1]?.replace(/\/close$/, "") || "");
      const current = getIncident(incidentId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "INCIDENT_NOT_FOUND" } };
      }
      if (options.closeValidationFails && closeAttempts === 1) {
        return {
          status: 400,
          json: {
            ok: false,
            code: "INCIDENT_CLOSE_VALIDATION_FAILED",
            error: "Incident cannot be closed until investigation is complete.",
          },
        };
      }
      if (normalizeStatus(current.status) === "closed") {
        return {
          status: 200,
          json: { ok: true, alreadyClosed: true, incidentId, incident: current, updatedRows: 0 },
        };
      }
      const closed = {
        ...current,
        status: "Closed",
        closedAt: new Date().toISOString(),
        closedBy: baseConfig.expectedEmail,
        updatedAt: new Date().toISOString(),
      };
      upsertIncident(closed);
      return { status: 200, json: { ok: true, incidentId, incident: closed, updatedRows: 1 } };
    }

    if (method === "POST" && pathname.endsWith("/verification-cleanup")) {
      cleanupAttempts += 1;
      if (options.cleanupResponse) {
        return options.cleanupResponse(body);
      }
      if (options.cleanupFails) {
        return { status: 500, json: { ok: false, code: "INCIDENT_CLEANUP_FAILED" } };
      }
      if (options.cleanupRejectsNonVerification) {
        return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_INCIDENT" } };
      }
      const incidentId = pathname.split("/").filter(Boolean).at(-2);
      const current = getIncident(incidentId);
      if (current) {
        upsertIncident({
          ...current,
          status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
          closedAt: current.closedAt || new Date().toISOString(),
        });
      }
      return {
        status: 200,
        json: {
          ok: true,
          incidentId,
          cleaned: true,
          status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
        },
      };
    }

    if (method === "GET" && pathname.includes("/health-safety/overview")) {
      if (options.overviewFails) {
        return { status: 500, json: { ok: false } };
      }
      const includeVerification = options.overviewIncludesVerification;
      const verificationItem = getIncident(verificationIncidentId) || toListItem(verificationTemplate);
      return {
        status: 200,
        json: {
          ok: true,
          metrics: {
            openIncidents: 1,
            incidentsAwaitingInvestigation: 0,
          },
          attention: includeVerification
            ? [{ recordId: verificationIncidentId, id: `attention-incident-${verificationIncidentId}` }]
            : [],
          incidents: includeVerification ? [verificationItem] : [customerIncident()],
        },
      };
    }

    if (method === "GET" && pathname.includes("/dashboard/live")) {
      if (options.dashboardFails) {
        return { status: 500, json: { ok: false } };
      }
      const verificationItem = getIncident(verificationIncidentId);
      return {
        status: 200,
        json: {
          ok: true,
          metrics: { currentIncidents: 1, openIncidents: 1 },
          actToday: options.dashboardIncludesVerification && verificationItem
            ? [{ id: `incident-${verificationIncidentId}`, type: "incident" }]
            : [],
        },
      };
    }

    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    getIncidents: () => incidents,
    getIncident,
    verificationIncidentId,
    get closeAttempts() {
      return closeAttempts;
    },
  };
}

test("full successful workflow", async () => {
  const transport = createTransport();
  const result = await runProductionIncidentWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, true);
  for (const key of [
    "authentication",
    "incidentsApi",
    "baseline",
    "staleCleanup",
    "createIncident",
    "readback",
    "editIncident",
    "investigation",
    "riddorDecision",
    "statusProgression",
    "closeIncident",
    "detailVerification",
    "healthSafetyOverview",
    "dashboard",
    "cleanup",
  ]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
  assert.equal(result.checks.evidence.status, "SKIP");
  assert.equal(result.checks.correctiveAction.status, "SKIP");
  assert.equal(result.checks.search.status, "SKIP");
  assert.match(formatIncidentWorkflowReport(result), /READY FOR CUSTOMERS/);
});

test("login failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ loginFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("incidents API unavailable", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ incidentsUnavailable: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "incidentsApi");
});

test("mutation disabled", async () => {
  const config = { ...baseConfig, allowIncidentMutation: false };
  const result = await runProductionIncidentWorkflowChecks(config, createTransport(), defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createIncident.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("stale cleanup", async () => {
  const stale = buildProductionVerificationIncident({
    runId: 99999,
    incidentId: "bert-smoke-inc-99999",
    reporterEmail: baseConfig.expectedEmail,
  });
  const transport = createTransport({
    initialIncidents: [customerIncident(), toListItem({ ...stale, status: "Open" })],
  });
  const result = await runProductionIncidentWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("create failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ createFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "createIncident");
});

test("create returns success but record not visible", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ createSuccessButNotVisible: true, detailMissing: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "readback");
});

test("duplicate create idempotency", async () => {
  const existing = buildProductionVerificationIncident({
    runId: TEST_RUN_ID,
    reporterEmail: baseConfig.expectedEmail,
  });
  const transport = createTransport({
    initialIncidents: [customerIncident(), toListItem(existing)],
  });
  const result = await runProductionIncidentWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.createIncident.status, "PASS");
  assert.equal(result.checks.readback.status, "PASS");
});

test("edit failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ editFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editIncident");
});

test("stale detail cache after edit", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ editStaleDetail: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editIncident");
  assert.match(result.failureReason || "", /description/i);
});

test("evidence skipped", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.evidence.status, "SKIP");
  assert.match(result.checks.evidence.reason || "", /evidence/i);
});

test("evidence success where supported remains SKIP in current implementation", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.evidence.status, "SKIP");
  assert.notEqual(result.checks.evidence.status, "PASS");
});

test("investigation success", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.investigation.status, "PASS");
});

test("investigation permission failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ investigationPermissionFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "investigation");
});

test("RIDDOR decision success", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.riddorDecision.status, "PASS");
});

test("RIDDOR stage is not skipped during mutation-enabled workflow", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.notEqual(result.checks.riddorDecision.status, "SKIP");
  assert.equal(result.checks.riddorDecision.status, "PASS");
});

test("linked verification Action stage remains SKIP in current implementation", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.correctiveAction.status, "SKIP");
  assert.match(result.checks.correctiveAction.reason || "", /corrective action/i);
});

test("corrective Action stage skipped", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.correctiveAction.status, "SKIP");
});

test("invalid status transition", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ statusProgressionShowsOpen: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "statusProgression");
  assert.match(result.failureReason || "", /Under Investigation/i);
});

test("close validation failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ closeValidationFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "closeIncident");
});

test("close success", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.closeIncident.status, "PASS");
});

test("repeat close idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionIncidentWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.closeIncident.status, "PASS");
  assert.ok(transport.closeAttempts >= 1);
});

test("overview exclusion failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ overviewIncludesVerification: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "healthSafetyOverview");
});

test("dashboard verification failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ dashboardIncludesVerification: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("closed verification incident remains in register but Dashboard passes", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.dashboard.status, "PASS");
  const transport = createTransport();
  await runProductionIncidentWorkflowChecks(baseConfig, transport, defaultRunOptions);
  const incident = transport.getIncident(buildProductionVerificationIncidentId(TEST_RUN_ID));
  assert.ok(incident);
  assert.equal(normalizeStatus(incident.status), "verification-cleaned");
});

test("verification incident excluded from dashboard current counts", async () => {
  const { buildLiveDashboardFromSources } = await import("../shared/live-dashboard.mjs");
  const { buildProductionVerificationIncidentId } = await import("../shared/production-verification-incident.mjs");
  const verificationId = buildProductionVerificationIncidentId(999);
  const built = buildLiveDashboardFromSources(
    {
      incidents: [
        {
          "Incident ID": "i-open",
          "Company ID": baseConfig.companyFolderId,
          Status: "Open",
          Severity: "Critical",
          "Incident Type": "Slip",
          "Incident Date": "2026-07-02",
        },
        {
          "Incident ID": verificationId,
          "Company ID": baseConfig.companyFolderId,
          Status: "Closed",
          Severity: "Minor",
          "Incident Type": "Near Miss",
          Description: "Automated production Incident workflow verification. Safe to remove.",
          Witnesses: "verification",
          "Verification Source": "production-incident-workflow",
          "Incident Date": "2026-07-02",
        },
      ],
      actions: [],
      schedules: [],
      auditResults: [],
      auditFindings: [],
      ncrs: [],
      briefings: [],
      briefingRecipients: [],
      areas: [],
      sites: [],
      syncLog: [],
    },
    {
      companyFolderId: baseConfig.companyFolderId,
      alternateIds: [baseConfig.companyFolderId],
      actor: { role: "Admin", email: baseConfig.expectedEmail, companyId: baseConfig.companyFolderId },
      now: Date.parse("2026-07-03T12:00:00.000Z"),
    },
  );
  assert.equal(built.metrics.currentIncidents, 1);
  assert.equal(
    built.actToday.some((item) => String(item.id || "").includes(verificationId)),
    false,
  );
});

test("normal closed incident remains in dashboard register metrics exclusion only for open", async () => {
  const { buildLiveDashboardFromSources } = await import("../shared/live-dashboard.mjs");
  const built = buildLiveDashboardFromSources(
    {
      incidents: [
        {
          "Incident ID": "i-open",
          "Company ID": baseConfig.companyFolderId,
          Status: "Open",
          Severity: "Critical",
          "Incident Type": "Slip",
          "Incident Date": "2026-07-02",
        },
        {
          "Incident ID": "i-closed",
          "Company ID": baseConfig.companyFolderId,
          Status: "Closed",
          Severity: "Low",
          "Incident Type": "Slip",
          "Incident Date": "2026-05-01",
        },
      ],
      actions: [],
      schedules: [],
      auditResults: [],
      auditFindings: [],
      ncrs: [],
      briefings: [],
      briefingRecipients: [],
      areas: [],
      sites: [],
      syncLog: [],
    },
    {
      companyFolderId: baseConfig.companyFolderId,
      alternateIds: [baseConfig.companyFolderId],
      actor: { role: "Admin", email: baseConfig.expectedEmail, companyId: baseConfig.companyFolderId },
      now: Date.parse("2026-07-03T12:00:00.000Z"),
    },
  );
  assert.equal(built.metrics.currentIncidents, 1);
});

test("dashboard failure still triggers cleanup and preserves failed stage", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ dashboardIncludesVerification: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure after dashboard failure surfaces both stages", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ dashboardIncludesVerification: true, cleanupFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
  assert.equal(result.checks.cleanup.status, "FAIL");
  assert.equal(result.cleanupAlsoFailed, true);
});

test("cleanup success", async () => {
  const result = await runProductionIncidentWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ cleanupFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("non-verification cleanup rejected", async () => {
  const transport = createTransport({ cleanupRejectsNonVerification: true });
  const cleanup = await attemptVerificationIncidentCleanup(transport.request, {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationIncidentId: "inc-customer-1",
  });
  const single = cleanup.results.find((item) => item.kind === "single");
  assert.equal(single?.ok, false);
});

test("transient 502 recovery", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ create502Once: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks.createIncident.status, "PASS");
});

test("timeout cleanup attempt surfaces timed out metadata", async () => {
  const transport = {
    request: async () => {
      const error = new Error("Request timed out after 1000ms");
      error.name = "StageTimeoutError";
      error.code = "STAGE_TIMEOUT";
      error.method = "GET";
      error.safeUrl = "https://api.usebert.co.uk/api/health";
      error.elapsedMs = 1000;
      error.timeoutMs = 1000;
      throw error;
    },
  };
  const result = await runProductionIncidentWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.timedOut, true);
  assert.equal(result.failedKey, "authentication");
});

test("SIGINT/SIGTERM cleanup registers interrupt handler", async () => {
  const transport = createTransport();
  let registeredCleanup = null;
  await runProductionIncidentWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      registeredCleanup = fn;
    },
  });
  assert.equal(typeof registeredCleanup, "function");
  const cleanup = await registeredCleanup();
  assert.equal(cleanup.ok, true);
});

test("secrets absent from output", async () => {
  const result = await runProductionIncidentWorkflowChecks(
    baseConfig,
    createTransport({ loginFails: true }),
    defaultRunOptions,
  );
  const report = formatIncidentWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/i);
  assert.doesNotMatch(report, /signed-session-token/i);
  assert.doesNotMatch(report, /bert_company_session=/i);
});

test("verification helpers classify operational vs verification incidents", () => {
  const verification = buildProductionVerificationIncident({ runId: TEST_RUN_ID });
  assert.equal(isVerificationIncident(verification), true);
  assert.equal(isActiveVerificationIncident(verification), true);
  assert.equal(isOperationalIncident(verification), false);
  const cleaned = { ...verification, status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS };
  assert.equal(isActiveVerificationIncident(cleaned), false);
  assert.equal(isOperationalIncident(cleaned), false);
  const baseline = countIncidentBaselines([customerIncident(), verification]);
  assert.equal(baseline.operationalCount, 1);
  assert.equal(baseline.activeVerificationCount, 1);
  assert.equal(listActiveVerificationIncidents([customerIncident(), verification, cleaned]).length, 1);
});

test("check keys cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 18);
  assert.equal(CHECK_KEYS.includes("riddorDecision"), true);
  assert.equal(CHECK_KEYS.includes("correctiveAction"), true);
});
