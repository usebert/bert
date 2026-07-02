import { readFileAsDataUrl } from "./incidentsService";

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

export type AuditEvidenceAttachItem = {
  id: string;
  name: string;
  previewUrl: string;
  addedAt: string;
  mimeType?: string;
  size?: number;
  blobKey?: string;
};

export type AuditEvidenceUploadDataEntry = {
  dataUrl: string;
  name: string;
  mimeType: string;
  size: number;
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

async function fileFromPreviewUrl(item: AuditEvidenceAttachItem): Promise<File | undefined> {
  const previewUrl = String(item.previewUrl || "").trim();
  if (!previewUrl.startsWith("blob:")) {
    return undefined;
  }
  try {
    const blob = await fetch(previewUrl).then((response) => response.blob());
    return new File([blob], item.name || "audit-photo.jpg", {
      type: item.mimeType || blob.type || "application/octet-stream",
    });
  } catch {
    return undefined;
  }
}

export async function buildAuditEvidenceUploadPayload(
  entries: Array<{ questionId: string; item: AuditEvidenceAttachItem }>,
  uploadDataById: Record<string, AuditEvidenceUploadDataEntry> = {},
  getBlobByKey?: (blobKey: string) => Promise<Blob | null>,
): Promise<AuditEvidenceUploadFile[]> {
  const payload: AuditEvidenceUploadFile[] = [];

  for (const { questionId, item } of entries) {
    const stored = uploadDataById[item.id];
    if (stored?.dataUrl?.startsWith("data:")) {
      payload.push({
        id: item.id,
        evidenceId: item.id,
        name: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        dataUrl: stored.dataUrl,
        addedAt: item.addedAt,
        questionId: stored.questionId || questionId,
      });
      continue;
    }

    let file: File | undefined;
    if (item.blobKey && getBlobByKey) {
      try {
        const blob = await getBlobByKey(item.blobKey);
        if (blob) {
          file = new File([blob], item.name || "audit-photo.jpg", {
            type: item.mimeType || blob.type || "application/octet-stream",
          });
        }
      } catch {
        file = undefined;
      }
    }
    if (!file) {
      file = await fileFromPreviewUrl(item);
    }
    if (!file) {
      continue;
    }

    payload.push({
      id: item.id,
      evidenceId: item.id,
      name: item.name,
      mimeType: item.mimeType || file.type || "application/octet-stream",
      size: item.size || file.size || 0,
      addedAt: item.addedAt,
      questionId,
      dataUrl: await readFileAsDataUrl(file),
    });
  }

  return prepareSerializableAuditEvidenceFiles(payload);
}
