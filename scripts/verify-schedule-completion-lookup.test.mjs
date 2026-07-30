#!/usr/bin/env node
/**
 * Schedule completion lookup — targeted row read, workbook fallback, company scoping.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getCompanyScheduleForCompletion } from "../server/schedule-service.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
} from "../shared/production-verification-audit.mjs";

const companyFolderId = "folder-dovecote";
const masterSheetId = "sheet-dovecote";

const verificationRecord = {
  "Schedule ID": PRODUCTION_VERIFICATION_SCHEDULE_ID,
  "Company Folder ID": companyFolderId,
  "Schedule Name": "BERT Verification Audit",
  "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
  "Template Name": "BERT Verification Audit",
  Frequency: "Weekly",
  Status: "ACTIVE",
  "Assigned User Emails": "bert.demo+mr.important@usebert.co.uk",
  "Completion Mode": "repeatable",
};

function buildDeps({ records = [verificationRecord], getTabValuesImpl } = {}) {
  return {
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => {
      if (tabName === "Schedules") {
        return { ok: true, records, rowCount: records.length };
      }
      return { ok: true, records: [], rowCount: 0 };
    },
    getTabValues:
      getTabValuesImpl ||
      (async (_auth, _deps, _sheetId, _tabName, range) => {
        if (range === "A:A") {
          return [["Schedule ID"], [PRODUCTION_VERIFICATION_SCHEDULE_ID]];
        }
        if (range === "A1:W1") {
          return [];
        }
        if (range.startsWith("A")) {
          return [
            [
              PRODUCTION_VERIFICATION_SCHEDULE_ID,
              companyFolderId,
              "BERT Verification Audit",
              "BERT Verification Audit",
              PRODUCTION_VERIFICATION_AUDIT_ID,
            ],
          ];
        }
        return [];
      }),
    rowsToRecords: (values) => {
      const rows = values || [];
      if (rows.length === 0) {
        return [];
      }
      const headers = rows[0].map((value, index) => String(value || `Column ${index + 1}`).trim());
      return rows
        .slice(1)
        .filter((row) => row.some((cell) => String(cell || "").trim()))
        .map((row) =>
          headers.reduce((accumulator, header, index) => {
            accumulator[header] = String(row[index] || "").trim();
            return accumulator;
          }, {}),
        );
    },
  };
}

test("successful completion lookup uses readTabRecords when header row read fails", async () => {
  const result = await getCompanyScheduleForCompletion(
    {},
    buildDeps(),
    {
      scheduleId: PRODUCTION_VERIFICATION_SCHEDULE_ID,
      companyFolderId,
      masterSheetId,
      resolvedContext: {
        ok: true,
        companyFolderId,
        companyId: companyFolderId,
        masterSheetId,
        alternateIds: [companyFolderId],
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.schedule.id, PRODUCTION_VERIFICATION_SCHEDULE_ID);
  assert.equal(result.schedule.audits[0].auditId, PRODUCTION_VERIFICATION_AUDIT_ID);
});

test("missing schedule returns SCHEDULE_NOT_FOUND", async () => {
  const result = await getCompanyScheduleForCompletion(
    {},
    buildDeps({ records: [] }),
    {
      scheduleId: "missing-schedule",
      companyFolderId,
      masterSheetId,
      resolvedContext: {
        ok: true,
        companyFolderId,
        companyId: companyFolderId,
        masterSheetId,
        alternateIds: [companyFolderId],
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "SCHEDULE_NOT_FOUND");
});

test("invalid schedule for company folder returns SCHEDULE_NOT_FOUND", async () => {
  const result = await getCompanyScheduleForCompletion(
    {},
    buildDeps({
      records: [
        {
          ...verificationRecord,
          "Company Folder ID": "folder-other",
        },
      ],
    }),
    {
      scheduleId: PRODUCTION_VERIFICATION_SCHEDULE_ID,
      companyFolderId,
      masterSheetId,
      resolvedContext: {
        ok: true,
        companyFolderId,
        companyId: companyFolderId,
        masterSheetId,
        alternateIds: [companyFolderId],
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "SCHEDULE_NOT_FOUND");
});
