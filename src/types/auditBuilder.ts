export type AuditBuilderQuestion = {
  question_text: string;
  answer_type: "compliance" | string;
  options: string[];
  requires_comment_on_failure: boolean;
  requires_action_on_failure: boolean;
  allows_photo_evidence: boolean;
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

export type AuditBuilderTemplateStatus = "active" | "inactive" | "archived";

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
