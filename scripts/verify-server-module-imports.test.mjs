#!/usr/bin/env node
/**
 * Startup/import regression — catches syntax and ESM import errors before deploy.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function checkSyntax(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const result = spawnSync(process.execPath, ["--check", absolutePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${relativePath} failed node --check:\n${result.stderr || result.stdout}`,
  );
}

test("operational-messages-service imports without syntax errors", async () => {
  const module = await import("../server/operational-messages-service.mjs");
  assert.equal(typeof module.createOperationalMessage, "function");
  assert.equal(typeof module.createVerificationOperationalMessage, "function");
  assert.equal(typeof module.cleanupVerificationOperationalMessage, "function");
});

test("company-user-verification-service imports without syntax errors", async () => {
  const module = await import("../server/company-user-verification-service.mjs");
  assert.equal(typeof module.createVerificationCompanyUser, "function");
  assert.equal(typeof module.cleanupVerificationCompanyUser, "function");
});

test("core-workflow-routes imports without syntax errors", async () => {
  const module = await import("../server/core-workflow-routes.mjs");
  assert.equal(typeof module.installCoreWorkflowRoutes, "function");
});

test("server.mjs passes node --check without booting the API", () => {
  checkSyntax("server/server.mjs");
});

test("operational-messages-service passes node --check", () => {
  checkSyntax("server/operational-messages-service.mjs");
});

test("core-workflow-routes passes node --check", () => {
  checkSyntax("server/core-workflow-routes.mjs");
});
