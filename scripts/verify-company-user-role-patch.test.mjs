#!/usr/bin/env node
/**
 * Focused regression tests for Admin Manager→Auditor role PATCH persistence.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeCompanyUserRoleForSheet,
  validateCompanyUserEditInput,
} from "../server/company-users.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("validateCompanyUserEditInput accepts Auditor role", () => {
  const validated = validateCompanyUserEditInput({ role: "Auditor" });
  assert.equal(validated.ok, true);
  assert.equal(validated.role, "Auditor");
  assert.equal(normalizeCompanyUserRoleForSheet("Auditor"), "Auditor");
});

test("validateCompanyUserEditInput rejects empty role values", () => {
  const validated = validateCompanyUserEditInput({ role: "   " });
  assert.equal(validated.ok, true);
  assert.equal(validated.role, undefined);
});

test("PATCH handler readback passes Users deps for auth-index upsert", () => {
  const serverSrc = fs.readFileSync(path.join(root, "server/server.mjs"), "utf8");
  assert.match(serverSrc, /readCompanyUsersTabRecord\(auth, masterSheetId, email, usersDeps\)/);
  assert.match(serverSrc, /\[user-permissions:role-change\]/);
  assert.match(serverSrc, /phase: "auth_index_upsert"/);
});

test("workflow restores admin session after forbidden probes", () => {
  const workflowSrc = fs.readFileSync(
    path.join(root, "scripts/lib/production-users-permissions-workflow-core.mjs"),
    "utf8",
  );
  assert.match(workflowSrc, /ensureAdminSmokeSession\(config, timedTransport, logStage\)/);
  assert.match(workflowSrc, /Could not restore Admin session after forbidden probes/);
  assert.match(workflowSrc, /logRoleChangeDiagnostic/);
});
