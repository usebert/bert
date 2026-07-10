import type { PromptRule } from "./promptRules";

export type AuditBuilderQuestion = {
  question_text: string;
  answer_type: "compliance" | "yes_no" | string;
  options: string[];
  requires_comment_on_failure: boolean;
  requires_action_on_failure: boolean;
  allows_photo_evidence: boolean;
  prompt_rules?: PromptRule[];
};

export type AuditBuilderSection = {
  name: string;
  questions: AuditBuilderQuestion[];
};

export type AuditBuilderTemplateDraft = {
  template_name: string;
  description: string;
  category: string;
  sections: AuditBuilderSection[];
};

export type AuditBuilderTemplateStatus = "active" | "inactive" | "archived" | "superseded" | "draft";

export type AuditBuilderTemplateRecord = AuditBuilderTemplateDraft & {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  question_count: number;
  version?: number;
  parent_template_id?: string | null;
  status?: AuditBuilderTemplateStatus;
  is_used?: boolean;
  form_number?: string;
  revision_number?: number;
  revision_id?: string;
  supersedes_revision_id?: string;
  superseded_by_revision_id?: string;
  revision_reason?: string;
  copy_reason?: string;
  revision_label?: string;
  copy_note?: string;
};

export type AuditBuilderInstance = {
  id: string;
  template_id: string;
  template_name: string;
  status: "in_progress" | "completed";
  started_at: string;
  started_by: string;
  master_sheet_id: string;
  completed_at?: string;
  completed_by?: string;
  result?: string;
  result_reason?: string;
};
