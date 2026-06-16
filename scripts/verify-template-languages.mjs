#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS,
  AUDIT_TEMPLATE_TRANSLATIONS_TAB,
  CONFIG_KEY_DEFAULT_FORM_LANGUAGE,
  DEFAULT_FORM_LANGUAGE,
  SYNC_STATUS_FALLBACK_LANGUAGE,
  normalizeFormLanguage,
  resolveTemplateFormCopyContent,
} from "../server/template-languages.mjs";
import { AUDIT_TEMPLATES_COLUMNS } from "../server/company-audit-mapping.mjs";
import { GOOGLE_FORM_TEMPLATES_COLUMNS } from "../server/google-form-templates.mjs";

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

assert(normalizeFormLanguage("EN") === "en");
assert(normalizeFormLanguage("xx") === DEFAULT_FORM_LANGUAGE);
assert(AUDIT_TEMPLATES_COLUMNS.includes("Language"));
assert(AUDIT_TEMPLATES_COLUMNS.includes("Translation Status"));
assert(GOOGLE_FORM_TEMPLATES_COLUMNS.includes("Locale"));
assert(AUDIT_TEMPLATE_TRANSLATIONS_TAB === "AuditTemplateTranslations");
assert(AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS.includes("Questions JSON"));

const fallback = resolveTemplateFormCopyContent(
  { id: "t1", name: "Fire drill", questions: [{ text: "OK?", fieldType: "Pass / Fail" }] },
  "pl",
  [],
);
assert(fallback.usedFallback === true);
assert(fallback.syncStatusNote === SYNC_STATUS_FALLBACK_LANGUAGE);

const translated = resolveTemplateFormCopyContent(
  { id: "t1", name: "Fire drill", questions: [{ text: "OK?", fieldType: "Pass / Fail" }] },
  "fr",
  [
    {
      bertTemplateId: "t1",
      language: "fr",
      translationStatus: "Approved",
      title: "Exercice incendie",
      questionsJson: JSON.stringify([{ text: "Conforme?", fieldType: "Pass / Fail" }]),
    },
  ],
);
assert(translated.usedFallback === false);
assert(translated.title === "Exercice incendie");

assertContains("src/config/templateLanguages.ts", [
  "COMPLIANCE_TRANSLATION_WARNING",
  "defaultFormLanguage",
  "SUPPORTED_FORM_LANGUAGE_CODES",
]);

assertContains("src/components/forms/TemplateLanguageFields.tsx", ["TemplateLanguageFields", "COMPLIANCE_TRANSLATION_WARNING"]);

assertContains("App.tsx", [
  "templateLanguageInput",
  "googleFormCopyLanguage",
  "defaultFormLanguage",
  "patchDefaultFormLanguageOnServer",
]);

assertContains("src/services/tabletOfflineService.ts", ["defaultFormLanguage"]);

assertContains("server/company-areas.mjs", [
  "default-form-language",
  CONFIG_KEY_DEFAULT_FORM_LANGUAGE,
]);

assertContains("docs/template-language-support.md", ["AuditTemplateTranslations", "defaultFormLanguage"]);

console.log("[verify:template-languages] wiring OK");
