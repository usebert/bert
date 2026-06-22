#!/usr/bin/env node
/** Google Form → BERT check import — route, AuditTemplates writer, UI action. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const coreRoutes = read("server/core-workflow-routes.mjs");
const googleFormsService = read("server/google-forms-service.mjs");
const auditBuilder = read("server/audit-builder.mjs");
const companyAuditMapping = read("server/company-audit-mapping.mjs");
const googleFormsScreen = read("src/screens/GoogleFormsScreen.tsx");
const companyFormsService = read("src/services/companyFormsService.ts");
const appTsx = read("App.tsx");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:google-form-bert-import"], "PKG: npm script registered");

assert(
  coreRoutes.includes('app.post("/api/companies/:companyId/google-forms/:formId/create-bert-check"'),
  "1: canonical create-bert-check route registered",
);
assert(googleFormsService.includes("handleCreateBertCheckFromGoogleFormPost"), "2: import handler exported");
assert(googleFormsService.includes("readGoogleFormTemplatesFromTab"), "3: import reads GoogleFormTemplates tab");
assert(googleFormsService.includes("createBertCheckFromSyncedGoogleForm"), "4: import uses audit-builder writer");

assert(auditBuilder.includes("export async function createBertCheckFromSyncedGoogleForm"), "5: audit-builder import writer");
assert(auditBuilder.includes("writeAuditTemplateMetadata"), "6: writes AuditTemplates metadata");
assert(auditBuilder.includes("writeAuditTemplateTranslations"), "7: writes AuditTemplateTranslations");
assert(auditBuilder.includes('export const GOOGLE_FORM_IMPORT_STATUS = "Google Form Import"'), "8: import status constant");
assert(companyAuditMapping.includes("export async function readAuditTemplates"), "9: readAuditTemplates exported for dedupe");

assert(companyFormsService.includes("createBertCheckFromGoogleForm"), "10: client createBertCheckFromGoogleForm");
assert(companyFormsService.includes("/create-bert-check"), "11: client uses create-bert-check path");
assert(googleFormsScreen.includes("Create BERT check"), "12: GoogleFormsScreen action label");
assert(appTsx.includes("handleCreateBertCheckFromGoogleForm"), "13: App wires import handler");
assert(appTsx.includes("canCreateBertCheck"), "14: App passes canCreateBertCheck");

console.log(`[verify:google-form-bert-import] OK — ${caseCount} cases passed`);
