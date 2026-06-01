import type { AuditTemplateRow } from "../services/companyAuditMappingService";
import type { AuditTemplate } from "../types/reportsScreenProps";

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

    merged.push({
      id: row.id,
      name: row.name,
      active,
      questions: existing?.questions?.length ? existing.questions : [],
      source: existing?.source || "Built in app",
      category: row.category || existing?.category,
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
