import type { EvidenceItem } from "./dashboardScreenProps";
import type { Answer, Audit, AuditQuestion } from "./reportsScreenProps";
import type { PromptFollowUpAnswers } from "./promptRules";

export type CheckCompletionPhase = "questions" | "review";

export type CheckCompletionWizardProps = {
  audit: Audit;
  responses: Record<string, Answer>;
  textResponses: Record<string, string>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  promptFollowUps: PromptFollowUpAnswers;
  questionIndex: number;
  offlineMode: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  savedAt: string | null;
  slatePrimaryCtaInteract: string;
  onQuestionIndexChange: (index: number) => void;
  onAnswerChange: (questionId: string, answer: Answer) => void;
  onTextResponseChange: (questionId: string, value: string) => void;
  onNoteChange: (questionId: string, value: string) => void;
  onPromptFollowUpChange: (questionId: string, followUpId: string, value: string) => void;
  onAddEvidence: (questionId: string, files: FileList) => void;
  onRemoveEvidence: (questionId: string, evidenceId: string) => void;
  onSaveAndExit: () => void;
  onSubmit: () => void;
  onBackToAuditCentre?: () => void;
  submitting?: boolean;
  submitError?: string;
};

export type CheckQuestionControlsProps = {
  question: AuditQuestion;
  questionNumber: number;
  responses: Record<string, Answer>;
  textResponses: Record<string, string>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  promptFollowUps: PromptFollowUpAnswers;
  slatePrimaryCtaInteract: string;
  onAnswerChange: (questionId: string, answer: Answer) => void;
  onTextResponseChange: (questionId: string, value: string) => void;
  onNoteChange: (questionId: string, value: string) => void;
  onPromptFollowUpChange: (questionId: string, followUpId: string, value: string) => void;
  onAddEvidence: (questionId: string, files: FileList) => void;
  onRemoveEvidence: (questionId: string, evidenceId: string) => void;
};

export type CheckCompletionReviewProps = {
  audit: Audit;
  responses: Record<string, Answer>;
  textResponses: Record<string, string>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  promptFollowUps: PromptFollowUpAnswers;
  canSubmit: boolean;
  offlineMode: boolean;
  onJumpToQuestion: (index: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitError?: string;
};
