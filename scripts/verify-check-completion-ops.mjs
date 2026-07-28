#!/usr/bin/env node
/**
 * Verifies audit completion request scope: single company resolve, tab read cache,
 * Google op timings, and record correctness (AuditResults + NCRs).
 */
import { submitCompletedCheck } from "../server/completion-service.mjs";
import { NCR_TAB, NCR_TAB_COLUMNS } from "../shared/ncr.mjs";
import { rowsToRecords } from "../server/workbook-service.mjs";

let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

const REQUIRED_GOOGLE_OP_KINDS = [
  "company_resolve",
  "sheets_read",
  "sheets_append",
  "sheets_batch_update",
  "drive_lookup",
  "drive_create",
  "schedule_update",
  "notification",
];

function buildSubmissionFixture() {
  const signedInEmail = "auditor@testco.test";
  const companyFolderId = "company-folder-1";
  const masterSheetId = "sheet-master-1";
  const scheduleId = "schedule-ops-1";
  const auditId = "audit-ops-1";
  const evidencePhotosFolderId = "photos-folder-1";

  const scheduleRecords = [
    {
      "Schedule ID": scheduleId,
      "Company Folder ID": companyFolderId,
      "Schedule Name": "Weekly safety walk",
      Status: "ACTIVE",
      "Assigned User Emails": signedInEmail,
      "Audit ID": auditId,
      "Template Name": "Safety walk",
      Frequency: "Weekly",
      "Next Due At": "2026-06-24T08:00:00.000Z",
      "Completion Mode": "once-per-period",
    },
  ];

  const existingNcr = {
    Reference: "NCR-2026-001",
    "Company Folder ID": companyFolderId,
    "Source Audit ID": "other-audit",
    "Source Question ID": "q-existing",
    Status: "Open",
  };

  function createDeps({ enableCache = false, enableSingleContext = false } = {}) {
    const stores = {
      auditResults: [],
      ncrs: [{ ...existingNcr }],
      actions: [],
      findings: [],
    };
    const tabCache = new Map();
    let resolvedContext = null;
    const counters = {
      companyResolves: 0,
      tabReads: [],
      driveStructureScans: 0,
      googleOps: 0,
    };

    function trackTabRead(key) {
      counters.tabReads.push(key);
    }

    async function getTabValues(_auth, _deps, spreadsheetId, tabName, range = "A1:ZZ5000") {
      const key = `${spreadsheetId}|${tabName}|${range}`;
      if (enableCache && tabCache.has(key)) {
        trackTabRead(`${key}#cache-hit`);
        return tabCache.get(key);
      }
      trackTabRead(key);
      counters.googleOps += 1;

      if (tabName === "Schedules") {
        if (range === "A:A") {
          const values = [["Schedule ID"], ...scheduleRecords.map((row) => [row["Schedule ID"]])];
          if (enableCache) tabCache.set(key, values);
          return values;
        }
        if (range === "A1:W1") {
          const headers = Object.keys(scheduleRecords[0]);
          const values = [headers];
          if (enableCache) tabCache.set(key, values);
          return values;
        }
        if (range.startsWith("A") && range.includes(":W")) {
          const headers = Object.keys(scheduleRecords[0]);
          const values = [headers, headers.map((header) => scheduleRecords[0][header] || "")];
          if (enableCache) tabCache.set(key, values);
          return values;
        }
      }

      if (tabName === "NCRs" && range === "A1:ZZ1") {
        const headers = NCR_TAB_COLUMNS;
        const values = [headers];
        if (enableCache) tabCache.set(key, values);
        return values;
      }

      const values = [];
      if (enableCache) tabCache.set(key, values);
      return values;
    }

    async function readTabRecords(_auth, _deps, _sheetId, tabName, options = {}) {
      const cacheKey = `${_sheetId}|${tabName}|${options.summaryOnly ? "summary" : "full"}`;
      if (enableCache && tabCache.has(cacheKey)) {
        trackTabRead(`${cacheKey}#cache-hit`);
        return tabCache.get(cacheKey);
      }
      trackTabRead(cacheKey);
      counters.googleOps += 1;

      if (tabName === "Schedules") {
        const result = { ok: true, records: scheduleRecords, rowCount: scheduleRecords.length };
        if (enableCache) tabCache.set(cacheKey, result);
        return result;
      }
      if (tabName === "AuditResults") {
        const result = {
          ok: true,
          records: [...stores.auditResults],
          rowCount: stores.auditResults.length,
        };
        if (enableCache) tabCache.set(cacheKey, result);
        return result;
      }
      if (tabName === NCR_TAB) {
        const result = { ok: true, records: [...stores.ncrs], rowCount: stores.ncrs.length };
        if (enableCache) tabCache.set(cacheKey, result);
        return result;
      }
      const empty = { ok: true, records: [], rowCount: 0 };
      if (enableCache) tabCache.set(cacheKey, empty);
      return empty;
    }

    async function resolveCompanyScheduleContext(_auth, _deps, input = {}) {
      if (enableSingleContext && resolvedContext?.ok) {
        return resolvedContext;
      }
      counters.companyResolves += 1;
      counters.googleOps += 1;
      const context = {
        ok: true,
        companyId: companyFolderId,
        companyFolderId,
        masterSheetId,
        companyName: "Test Co",
        alternateIds: [companyFolderId],
        contextSource: input.trustSessionContext ? "session" : "full_resolve",
        skippedFolderDiscovery: input.trustSessionContext === true,
      };
      if (enableSingleContext) {
        resolvedContext = context;
      }
      return context;
    }

    async function resolveCompanyFromFolder() {
      counters.driveStructureScans += 1;
      counters.googleOps += 1;
      return {
        ok: true,
        companyFolderId,
        masterSheetId,
      };
    }

    async function ensureCompanyFolderStructure() {
      counters.driveStructureScans += 1;
      counters.googleOps += 1;
      return { folderIds: { EVIDENCE_PHOTOS: evidencePhotosFolderId } };
    }

    return {
      stores,
      counters,
      deps: {
        getTabValues,
        readTabRecords,
        rowsToRecords,
        resolveCompanyScheduleContext,
        resolveCompanyFromFolder,
        ensureTabColumns: async () => {
          counters.googleOps += 1;
          return { addedColumns: [], headers: [] };
        },
        appendTabRows: async (_auth, _deps, _sheetId, tabName, _columns, rows = []) => {
          counters.googleOps += 1;
          if (tabName === "AuditResults") {
            stores.auditResults.push(...rows);
          }
          if (tabName === NCR_TAB) {
            stores.ncrs.push(...rows);
          }
          return { ok: true, written: rows.length };
        },
        patchTabRowByHeader: async (_auth, _deps, _sheetId, tabName, _matchHeader, matchValue, updates = {}) => {
          counters.googleOps += 2;
          const read = await readTabRecords(_auth, _deps, _sheetId, tabName);
          const record = (read.records || []).find(
            (row) => String(row["Result ID"] || row.Reference || "") === String(matchValue),
          );
          if (record) {
            Object.assign(record, updates);
          }
          return { ok: true };
        },
        getConfig: async () => {
          counters.googleOps += 1;
          return { evidenceFolderId: evidencePhotosFolderId };
        },
        ensureCompanyFolderStructure,
        google: {
          drive: () => ({
            files: {
              list: async () => {
                counters.googleOps += 1;
                return { data: { files: [{ id: "audits-folder", name: "Audits" }] } };
              },
              create: async () => {
                counters.googleOps += 1;
                return { data: { id: "drive-file-1", webViewLink: "https://drive.example/file-1" } };
              },
            },
          }),
        },
        masterSheetCache: {
          getEntry: () => ({ masterSheetId }),
        },
      },
      input: {
        scheduleId,
        email: signedInEmail,
        companyFolderId,
        masterSheetId,
        trustSessionContext: true,
        auditId,
        auditName: "Safety walk",
        answers: { q1: "pass", q2: "fail" },
        findings: [
          { questionId: "q1", questionText: "Fire exit clear?", answer: "pass" },
          { questionId: "q2", questionText: "Extinguisher tagged?", answer: "fail", note: "Tag missing" },
        ],
        evidence: [{ questionId: "q2", evidenceId: "ev-1", name: "photo.jpg" }],
        evidenceFiles: [
          {
            questionId: "q2",
            evidenceId: "ev-1",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            dataUrl: "data:image/jpeg;base64,/9j/4AAQ",
          },
        ],
        completedAt: "2026-06-24T10:00:00.000Z",
        localSubmissionId: "local-submission-ops-1",
      },
    };
  }

  return { createDeps, companyFolderId, scheduleId, auditId, existingNcr };
}

function duplicateTabReadCount(tabReads = []) {
  const seen = new Set();
  let duplicates = 0;
  for (const key of tabReads) {
    const normalized = String(key).replace(/#cache-hit$/, "");
    if (seen.has(normalized)) {
      duplicates += 1;
    } else {
      seen.add(normalized);
    }
  }
  return duplicates;
}

function hasGoogleOpKinds(googleOps = [], kinds = []) {
  const present = new Set(googleOps.map((entry) => entry.kind));
  return kinds.every((kind) => present.has(kind));
}

async function runBaselineSubmission(fixture) {
  const { createDeps } = fixture;
  const harness = createDeps({ enableCache: false, enableSingleContext: false });
  const result = await submitCompletedCheck(
    {},
    harness.deps,
    {
      ...harness.input,
      disableCompletionRequestScope: true,
    },
  );
  return {
    result,
    counters: { ...harness.counters, tabReads: [...harness.counters.tabReads] },
    stores: harness.stores,
  };
}

async function runOptimizedSubmission(fixture) {
  const { createDeps } = fixture;
  const harness = createDeps({ enableCache: false, enableSingleContext: true });
  const result = await submitCompletedCheck(
    {},
    harness.deps,
    {
      ...harness.input,
      captureCompletionDiagnostics: true,
    },
  );
  return {
    result,
    diagnostics: result.completionDiagnostics,
    stores: harness.stores,
  };
}

async function main() {
  const fixture = buildSubmissionFixture();
  const baseline = await runBaselineSubmission(fixture);
  const optimized = await runOptimizedSubmission(fixture);

  assert(baseline.result.ok, "baseline submission succeeds");
  assert(optimized.result.ok, "optimized submission succeeds");

  const diag = optimized.diagnostics || {};
  assert(diag.companyResolutionCount === 1, "only one company resolution on optimized path");
  assert(diag.duplicateTabReads === 0, "no repeated identical tab reads on optimized path");
  assert(
    hasGoogleOpKinds(diag.googleOps || [], REQUIRED_GOOGLE_OP_KINDS),
    `timing output includes every Google operation kind (${REQUIRED_GOOGLE_OP_KINDS.join(", ")})`,
  );
  assert(
    (diag.driveStructureScans || 0) === 0,
    "optimized path does not scan Drive folder structure when session context is trusted",
  );

  const auditRow = optimized.stores.auditResults[0];
  assert(auditRow, "audit result row written");
  assert(auditRow["Schedule ID"] === fixture.scheduleId, "audit result schedule id preserved");
  assert(auditRow["Audit ID"] === fixture.auditId, "audit result audit id preserved");
  assert(auditRow["Company Folder ID"] === fixture.companyFolderId, "audit result company folder preserved");

  const findings = JSON.parse(auditRow["Findings JSON"] || "[]");
  assert(findings.length === 2, "findings JSON preserved on audit result");
  assert(findings.some((row) => row.questionId === "q2" && row.answer === "fail"), "fail finding preserved");

  const createdNcrs = optimized.stores.ncrs.filter(
    (row) => row["Source Question ID"] === "q2" && row["Source Audit ID"] === fixture.auditId,
  );
  assert(createdNcrs.length === 1, "one NCR created for fail finding");
  assert(createdNcrs[0].Status === "Open", "NCR status is Open");
  assert(
    optimized.stores.ncrs.some((row) => row.Reference === fixture.existingNcr.Reference),
    "existing NCR row remains in store",
  );

  const baselineGoogleOps = baseline.counters.googleOps;
  const optimizedGoogleOps = diag.googleOpCount || 0;
  assert(
    optimizedGoogleOps < baselineGoogleOps,
    `optimized Google op count (${optimizedGoogleOps}) is lower than baseline (${baselineGoogleOps})`,
  );

  const stageTimings = {};
  for (const entry of diag.googleOps || []) {
    const bucket = entry.kind || "unknown";
    stageTimings[bucket] = (stageTimings[bucket] || 0) + (Number(entry.durationMs) || 0);
  }

  console.log("PASS: verify-check-completion-ops");
  console.log(
    JSON.stringify(
      {
        report: "audit-completion-ops",
        googleApiCalls: {
          before: baselineGoogleOps,
          after: optimizedGoogleOps,
          reduction: baselineGoogleOps - optimizedGoogleOps,
          baselineCompanyResolves: baseline.counters.companyResolves,
          optimizedCompanyResolves: diag.companyResolutionCount,
          baselineDriveStructureScans: baseline.counters.driveStructureScans,
          optimizedDriveStructureScans: diag.driveStructureScans,
          baselineDuplicateTabReads: duplicateTabReadCount(baseline.counters.tabReads),
          optimizedDuplicateTabReads: diag.duplicateTabReads,
        },
        submissionStageTimingsMs: stageTimings,
        googleOpsByKind: diag.googleOpsByKind,
        records: {
          auditResultsWritten: optimized.stores.auditResults.length,
          ncrsTotal: optimized.stores.ncrs.length,
          ncrsCreatedForSubmission: createdNcrs.length,
          findingsOnAudit: findings.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
