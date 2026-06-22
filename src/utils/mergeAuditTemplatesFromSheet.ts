import {
  DEFAULT_FORM_LANGUAGE,
  defaultTranslationStatusForLanguage,
  normalizeFormLanguage,
} from "../config/templateLanguages";
import type { AuditTemplateRow } from "../services/companyAuditMappingService";
import type { AuditTemplate } from "../types/reportsScreenProps";
import {
  GOOGLE_FORM_IMPORT_STATUS,
  buildGoogleFormImportQuestions,
} from "./googleFormImportQuestions";

/** Merge AuditTemplates tab rows into local template state without dropping in-app question drafts. */
export function mergeAuditTemplatesFromSheet(
  current: AuditTemplate[],
  rows: AuditTemplateRow[],
): AuditTemplate[] {
  if (!rows.length) {
    return current;
  }

  const currentById = new Map(current.map((template) => [template.id, template]));
  const merged: AuditTemplate[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const existing = currentById.get(row.id);
    const active = String(row.status || "active").toLowerCase() !== "inactive";
    const googleFormId = String(row.googleFormId || existing?.googleForm?.formId || "").trim();
    const syncStatus = String(row.googleFormTemplateStatus || existing?.googleForm?.syncStatus || "").trim();
    const isGoogleFormImport = syncStatus === GOOGLE_FORM_IMPORT_STATUS;
    const importQuestions =
      isGoogleFormImport && !existing?.questions?.length
        ? buildGoogleFormImportQuestions(row.name, existing?.googleForm?.responderUrl)
        : [];

    const language = normalizeFormLanguage(row.language || existing?.language);
    merged.push({
      id: row.id,
      name: row.name,
      active,
      questions: existing?.questions?.length ? existing.questions : importQuestions,
      source: isGoogleFormImport ? "Google Drive" : existing?.source || "Built in app",
      category: row.category || existing?.category,
      language,
      defaultLanguage: normalizeFormLanguage(row.defaultLanguage || existing?.defaultLanguage || DEFAULT_FORM_LANGUAGE),
      translationStatus:
        row.translationStatus ||
        existing?.translationStatus ||
        defaultTranslationStatusForLanguage(language),
      googleForm: googleFormId
        ? {
            formId: googleFormId,
            driveFileId: existing?.googleForm?.driveFileId,
            editUrl: existing?.googleForm?.editUrl,
            responderUrl: existing?.googleForm?.responderUrl,
            folderId: existing?.googleForm?.folderId,
            folderName: existing?.googleForm?.folderName,
            syncStatus: syncStatus || existing?.googleForm?.syncStatus,
            notes: existing?.googleForm?.notes,
          }
        : existing?.googleForm,
    });
    seen.add(row.id);
  }

  for (const template of current) {
    if (!seen.has(template.id)) {
      merged.push(template);
    }
  }

  return merged;
}
