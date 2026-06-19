import type { ComponentType } from "react";
import type { Audit, Answer, AuditStatus } from "./reportsScreenProps";
import type { EvidenceItem } from "./dashboardScreenProps";

export type CompleteAuditScreenIconProps = {
  name: string;
  className?: string;
};

export type CompleteAuditScreenProps = {
  audit: Audit;
  responses: Record<string, Answer>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  signatureDataUrl: string;
  signatureSignedAt: string;
  offlineMode: boolean;
  savedAt: string | null;
  canSubmit: boolean;
  onSelect: (questionId: string, answer: Answer) => void;
  onNoteChange: (questionId: string, value: string) => void;
  onAddEvidence: (questionId: string, files: FileList) => void;
  onRemoveEvidence: (questionId: string, evidenceId: string) => void;
  onSignatureChange: (dataUrl: string) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  AppIcon: ComponentType<CompleteAuditScreenIconProps>;
  slatePrimaryCtaInteract: string;
};

export type CompleteAuditAnswerButtonProps = {
  label: string;
  selected: boolean;
  tone: AuditStatus;
  onClick: () => void;
};
