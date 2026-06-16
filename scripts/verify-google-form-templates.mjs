#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildGoogleFormBatchRequests,
  CONFIGURED_TEMPLATE_CATEGORY_FOLDERS,
  createCompanyGoogleFormCopy,
  createMasterGoogleFormTemplateCopy,
  getConfiguredGoogleFormTemplatesFolderId,
  GOOGLE_FORM_PLACEMENT_COMPANY,
  GOOGLE_FORM_PLACEMENT_MASTER,
  GOOGLE_FORMS_BODY_SCOPE,
  normalizeTemplateCategory,
  TEMPLATE_CATEGORY_FOLDERS,
} from "../server/google-form-templates.mjs";
import {
  AUDITS_GOOGLE_FORMS_FOLDER_KEY,
  COMPANY_GOOGLE_FORM_STORAGE_PATH,
} from "../server/company-folder-structure.mjs";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertContains(filePath, snippets) {
  const fullPath = path.join(root, filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`Missing "${snippet}" in ${filePath}`);
    }
  }
}

assert(normalizeTemplateCategory("iso9001") === "ISO 9001");
assert(normalizeTemplateCategory("") === "General");
assert(TEMPLATE_CATEGORY_FOLDERS.includes("COSHH"));
assert(CONFIGURED_TEMPLATE_CATEGORY_FOLDERS.includes("ISO 9001"));
assert(CONFIGURED_TEMPLATE_CATEGORY_FOLDERS.includes("General"));
assert(typeof getConfiguredGoogleFormTemplatesFolderId === "function");
assert(typeof createMasterGoogleFormTemplateCopy === "function");
assert(typeof createCompanyGoogleFormCopy === "function");
assert(GOOGLE_FORM_PLACEMENT_MASTER === "master");
assert(GOOGLE_FORM_PLACEMENT_COMPANY === "company");
assert(AUDITS_GOOGLE_FORMS_FOLDER_KEY === "AUDITS_GOOGLE_FORMS");
assert(COMPANY_GOOGLE_FORM_STORAGE_PATH === "08 - Audits / Google Forms");

const mapped = buildGoogleFormBatchRequests([
  { text: "Short answer", fieldType: "Text note" },
  { text: "Pass fail", fieldType: "Pass / Fail" },
  { text: "Photo only", fieldType: "Photo evidence" },
]);
assert(mapped.requests.length === 2);
assert(mapped.skipped.length === 1);

assertContains("server/server.mjs", ["GOOGLE_FORMS_BODY_SCOPE", "installGoogleFormTemplateRoutes"]);

assert(GOOGLE_FORMS_BODY_SCOPE.includes("forms"));

assertContains("server/google-form-templates.mjs", [
  "resolveTemplateFormCopyContent",
  "Translation Status",
  "Language",
  "Locale",
  "GoogleFormTemplates",
  "BERT Master Templates",
  "BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID",
  "resolveGoogleFormTemplatesRoot",
  "Parent Drive Folder ID",
  "createGoogleFormFromBertTemplate",
  "createMasterGoogleFormTemplateCopy",
  "createCompanyGoogleFormCopy",
  "resolveCompanyGoogleFormAuditFolder",
  "GOOGLE_FORM_PLACEMENT_COMPANY",
  "Current Folder Path",
  "/api/google-form-templates/create-from-bert",
  "/api/google-form-templates/folder/status",
  "/api/google-form-templates/folder/verify",
  "/api/google-form-templates/folder/ensure-structure",
  "ensureConfiguredCategorySubfolders",
]);

assertContains("server/company-forms-service.mjs", [
  "resolveCompanyGoogleFormsFolder",
  "listCompanyGoogleForms",
  "COMPANY_GOOGLE_FORMS_SYNC_COLUMNS",
]);

assertContains(".env.example", ["BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID"]);

assertContains("App.tsx", [
  "applyGoogleFormCopyForTemplate",
  "createGoogleFormCopyForTemplate",
  "googleFormCopyOption",
  "persistGoogleFormCopyForTemplate",
]);
assertContains("src/utils/createGoogleFormCopyForTemplate.ts", [
  "googleFormTemplatesService",
  "BERT template created",
  "Google Form copy could not be stored in the company audit folder",
]);

assertContains("src/screens/AdminScreen.tsx", [
  "CreateGoogleFormCopyOption",
  "GoogleFormTemplatePanel",
  "googleFormCopyOption",
]);
assertContains("src/components/forms/CreateGoogleFormCopyOption.tsx", [
  "Create Google Form copy",
  "optionState.helperText",
]);
assertContains("src/screens/AuditBuilderScreen.tsx", [
  "CreateGoogleFormCopyOption",
  "googleFormCopyOption",
]);
assertContains("src/screens/AuditTemplateEditScreen.tsx", [
  "CreateGoogleFormCopyOption",
  "GoogleFormTemplatePanel",
  "googleFormCopyOption",
]);
assertContains("src/utils/googleFormCopyOptionState.ts", [
  "Complete workspace setup before creating Google Form copies.",
  "Google Forms permission is not connected yet.",
  "Creates a Google Form copy in this company's audit folder",
]);
assertContains("src/utils/createGoogleFormCopyForTemplate.ts", [
  "08 - Audits / Google Forms",
  "applyGoogleFormCopyForTemplate",
]);
assertContains("src/components/forms/FormsChecksTemplatesPanel.tsx", [
  "08 - Audits / Google Forms",
  "BERT remains the live",
  "operational system",
  "No Google Forms found in this company folder.",
  "Google Forms folder could not be found.",
  "BERT cannot access the Google Forms folder.",
]);
assertContains("src/screens/SchedulesScreen.tsx", []);
assert(!fs.readFileSync(path.join(root, "src/screens/SchedulesScreen.tsx"), "utf8").includes("CreateGoogleFormCopyOption"));
assertContains("src/components/admin/GoogleFormTemplatePanel.tsx", ["Stored in:", "COMPANY_GOOGLE_FORM_STORAGE_PATH"]);
assertContains("src/screens/GodmodeInitialSetupScreen.tsx", [
  "Google Form Template Folder",
  "Verify template folder",
  "Repair/create template folder structure",
]);
assertContains("src/services/googleFormTemplateFolderService.ts", [
  "googleFormTemplateFolderService",
  "/api/google-form-templates/folder/status",
]);

console.log("[verify:google-form-templates] mapping and wiring OK");
