export type PromptRuleTrigger = {
  operator: "equals";
  value: string;
};

export type PromptRuleFollowUpAction = {
  type: "followUpQuestion";
  id: string;
  label: string;
  inputType: "text" | "number" | "short_text" | "paragraph";
  unit?: string;
  required?: boolean;
};

export type PromptRuleInstructionAction = {
  type: "instruction";
  text: string;
};

export type PromptRuleEscalateAction = {
  type: "escalate";
  message: string;
  managerReview?: boolean;
  evidenceRequired?: boolean;
  /** When set with followUpId, manager review applies only if the number is outside this range. */
  safeMin?: number;
  safeMax?: number;
  followUpId?: string;
};

export type PromptRuleAction =
  | PromptRuleFollowUpAction
  | PromptRuleInstructionAction
  | PromptRuleEscalateAction;

export type PromptRule = {
  when: PromptRuleTrigger;
  actions: PromptRuleAction[];
};

export type PromptFollowUpAnswers = Record<string, Record<string, string>>;

export type PromptRuleFinding = {
  questionId: string;
  questionText: string;
  answer: string;
  note: string;
  requiresManagerReview: boolean;
  escalationMessage?: string;
  source: "promptRule";
};
