import type { EvidenceItem } from "./dashboardScreenProps";
import type { Answer, Audit, AuditQuestion } from "./reportsScreenProps";

export type AuditModeScreenProps = {
  audit: Audit;
  responses: Record<string, Answer>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  evidenceDebugLabel: string;
  questionIndex: number;
  offlineMode: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  slatePrimaryCtaInteract: string;
  onAnswerSelect: (question: AuditQuestion, answer: Answer) => void;
  onJumpToQuestion: (index: number) => void;
  onNoteChange: (questionId: string, value: string) => void;
  onAddEvidence: (questionId: string, files: FileList) => void;
  onComplete: () => void;
  onSaveAndExit: () => void;
};
