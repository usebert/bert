#!/usr/bin/env node
/**
 * Regression — legacy Config companyId (spreadsheet id) must not invalidate smoke login/session.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import {
  validateLiveCompanyContext,
} from "../server/company-context-service.mjs";
import { isLegacyConfigCompanyFolderId } from "../shared/company-folder-context.mjs";

const DOVECOTE_FOLDER_ID = "1tDKluapYfY-RkuxXc6eoRnGHL38XCswx";
const DOVECOTE_MASTER_SHEET_ID = "1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc";
const DOVECOTE_COMPANY_NAME = "Dovecote Manufacturing Ltd";
const SMOKE_EMAIL = "bert.demo+mr.important@usebert.co.uk";

function buildDeps({ configCompanyId = DOVECOTE_MASTER_SHEET_ID, registryFolderId = DOVECOTE_FOLDER_ID } = {}) {
  const registryRecord = {
    companyFolderId: registryFolderId,
    rootFolderId: registryFolderId,
    companyId: registryFolderId,
    masterSheetId: DOVECOTE_MASTER_SHEET_ID,
    companyName: DOVECOTE_COMPANY_NAME,
    status: "LIVE",
  };
  return {
    getConfig: async () => ({
      companyId: configCompanyId,
      companyName: DOVECOTE_COMPANY_NAME,
    }),
    google: {
      drive: () => ({
        files: {
          get: async ({ fileId }) => ({
            data: {
              name:
                fileId === DOVECOTE_FOLDER_ID
                  ? `${DOVECOTE_COMPANY_NAME} - BERT Folder Structure`
                  : "Unknown",
            },
          }),
        },
      }),
      sheets: () => ({
        spreadsheets: {
          get: async ({ spreadsheetId }) => ({
            data: { spreadsheetId },
          }),
        },
      }),
    },
    validateCompanyFolderUnderCompaniesRoot: async () => ({ ok: true }),
    readCanonicalCompanyWorkspaceRegistryMap: async () => ({
      map: new Map([[registryFolderId, registryRecord]]),
    }),
    resolveValidateLiveCompanyContext: () => validateLiveCompanyContext,
    getCompanyUsersDeps: () => ({
      readCompanyUsersTabRecord: async () => ({
        email: SMOKE_EMAIL,
        status: "ACTIVE",
        role: "Admin",
        companyFolderId: DOVECOTE_FOLDER_ID,
      }),
    }),
  };
}

test("isLegacyConfigCompanyFolderId detects spreadsheet id stored as companyId", () => {
  assert.equal(isLegacyConfigCompanyFolderId(DOVECOTE_MASTER_SHEET_ID, DOVECOTE_MASTER_SHEET_ID), true);
  assert.equal(isLegacyConfigCompanyFolderId(DOVECOTE_FOLDER_ID, DOVECOTE_MASTER_SHEET_ID), false);
});


test("validateLiveCompanyContext accepts folder hint when Config stores spreadsheet id", async () => {
  const deps = buildDeps({ configCompanyId: DOVECOTE_MASTER_SHEET_ID });
  const validation = await validateLiveCompanyContext({}, deps, {
    masterSheetId: DOVECOTE_MASTER_SHEET_ID,
    companyFolderId: DOVECOTE_FOLDER_ID,
    companyName: DOVECOTE_COMPANY_NAME,
  });
  assert.equal(validation.companyContextValid, true);
  assert.equal(validation.companyFolderId, DOVECOTE_FOLDER_ID);
  assert.equal(validation.masterSheetId, DOVECOTE_MASTER_SHEET_ID);
});

test("verifyAuthIndexEntryMatchesUsersWorkbook accepts index folder when validation used legacy Config id", async () => {
  const authIndex = createAuthIndexApi({ sessionsDir: "/tmp/bert-auth-index-test" });
  const deps = buildDeps({ configCompanyId: DOVECOTE_MASTER_SHEET_ID });
  deps.validateCompanyFolderUnderCompaniesRoot = async () => ({ ok: true });

  const verified = await authIndex.verifyAuthIndexEntryMatchesUsersWorkbook({}, deps, SMOKE_EMAIL, {
    masterSheetId: DOVECOTE_MASTER_SHEET_ID,
    companyFolderId: DOVECOTE_FOLDER_ID,
    companyId: DOVECOTE_FOLDER_ID,
    companyName: DOVECOTE_COMPANY_NAME,
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.validation?.companyFolderId, DOVECOTE_FOLDER_ID);
});
