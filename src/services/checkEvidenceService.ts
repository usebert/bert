export type AuditEvidenceUploadFile = {
  id: string;
  evidenceId: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  addedAt: string;
  questionId: string;
};

export function prepareSerializableAuditEvidenceFiles(
  files: Array<Partial<AuditEvidenceUploadFile> & { dataUrl?: string }> = [],
): AuditEvidenceUploadFile[] {
  return files
    .map((file, index) => {
      const dataUrl = String(file.dataUrl || "").trim();
      if (!dataUrl.startsWith("data:")) {
        return null;
      }
      const evidenceId = String(file.evidenceId || file.id || `audit-evidence-${index + 1}`).trim();
      const questionId = String(file.questionId || "").trim();
      if (!questionId) {
        return null;
      }
      return {
        id: evidenceId,
        evidenceId,
        name: String(file.name || `photo-${index + 1}`).trim(),
        mimeType: String(file.mimeType || "application/octet-stream").trim(),
        size: Number(file.size) || 0,
        dataUrl,
        addedAt: String(file.addedAt || new Date().toISOString()).trim(),
        questionId,
      };
    })
    .filter((item): item is AuditEvidenceUploadFile => Boolean(item));
}
