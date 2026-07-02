export type DriveEvidenceSource = {
  driveLink?: string;
  driveFileId?: string;
  url?: string;
  previewUrl?: string;
};

export function resolveDriveEvidenceUrl(item: DriveEvidenceSource = {}): string {
  const driveLink = String(item.driveLink || item.url || "").trim();
  if (driveLink && !driveLink.startsWith("data:")) {
    return driveLink;
  }
  const driveFileId = String(item.driveFileId || "").trim();
  if (driveFileId) {
    return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
  }
  const preview = String(item.previewUrl || "").trim();
  if (preview.startsWith("https://drive.google.com/")) {
    return preview;
  }
  return "";
}

export function hasDriveEvidence(item: DriveEvidenceSource = {}): boolean {
  return Boolean(resolveDriveEvidenceUrl(item));
}

export type ViewableEvidenceLink = {
  id: string;
  name: string;
  url: string;
  subtitle?: string;
};

export function toViewableEvidenceLink(
  item: DriveEvidenceSource & { id?: string; name?: string; evidenceId?: string },
  options?: { subtitle?: string; fallbackName?: string },
): ViewableEvidenceLink | null {
  const url = resolveDriveEvidenceUrl(item);
  if (!url) {
    return null;
  }
  const id = String(item.id || item.evidenceId || item.name || url).trim();
  const name = String(item.name || options?.fallbackName || "Evidence file").trim() || "Evidence file";
  return {
    id,
    name,
    url,
    subtitle: options?.subtitle?.trim() || undefined,
  };
}

export type ParsedAuditEvidenceRef = {
  evidenceId: string;
  questionId: string;
  name: string;
  mimeType?: string;
  driveLink?: string;
  driveFileId?: string;
  addedAt?: string;
};

export function parseAuditEvidenceRefs(raw: unknown[] | null | undefined): ParsedAuditEvidenceRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: ParsedAuditEvidenceRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const evidenceId = String(record.evidenceId || record.id || "").trim();
    const questionId = String(record.questionId || "").trim();
    const name = String(record.name || "").trim();
    if (!evidenceId && !name) {
      continue;
    }
    parsed.push({
      evidenceId: evidenceId || name,
      questionId,
      name: name || evidenceId || "Evidence file",
      mimeType: String(record.mimeType || "").trim() || undefined,
      driveLink: String(record.driveLink || "").trim() || undefined,
      driveFileId: String(record.driveFileId || "").trim() || undefined,
      addedAt: String(record.addedAt || "").trim() || undefined,
    });
  }
  return parsed;
}

export function buildQuestionLabelMap(findings: unknown[] | null | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  if (!Array.isArray(findings)) {
    return labels;
  }
  for (const entry of findings) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const questionId = String(record.questionId || "").trim();
    const questionText = String(record.questionText || record.text || "").trim();
    if (questionId && questionText) {
      labels.set(questionId, questionText);
    }
  }
  return labels;
}

export function auditEvidenceRefsToViewableLinks(
  refs: ParsedAuditEvidenceRef[],
  questionLabels: Map<string, string> = new Map(),
): ViewableEvidenceLink[] {
  return refs
    .map((ref) => {
      const questionLabel = ref.questionId ? questionLabels.get(ref.questionId) : undefined;
      const subtitle = questionLabel
        ? questionLabel
        : ref.questionId
          ? `Question ${ref.questionId}`
          : undefined;
      return toViewableEvidenceLink(ref, {
        subtitle,
        fallbackName: ref.name,
      });
    })
    .filter((item): item is ViewableEvidenceLink => Boolean(item));
}
