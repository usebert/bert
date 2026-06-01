#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildGoogleFormBatchRequests,
  CONFIGURED_TEMPLATE_CATEGORY_FOLDERS,
  getConfiguredGoogleFormTemplatesFolderId,
  GOOGLE_FORMS_BODY_SCOPE,
  normalizeTemplateCategory,
  TEMPLATE_CATEGORY_FOLDERS,
} from "../server/google-form-templates.mjs";

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
  "GoogleFormTemplates",
  "BERT Master Templates",
  "BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID",
  "resolveGoogleFormTemplatesRoot",
  "Parent Drive Folder ID",
  "createGoogleFormFromBertTemplate",
  "/api/google-form-templates/create-from-bert",
  "/api/google-form-templates/folder/status",
  "/api/google-form-templates/folder/verify",
  "/api/google-form-templates/folder/ensure-structure",
  "ensureConfiguredCategorySubfolders",
]);

assertContains(".env.example", ["BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID"]);

assertContains("App.tsx", [
  "googleFormTemplatesService",
  "BERT template created",
  "Google Form copy could not be created",
]);

assertContains("src/screens/AdminScreen.tsx", ["Create Google Form template copy", "GoogleFormTemplatePanel"]);
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
