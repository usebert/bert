import { useTranslation } from "react-i18next";
import type { AuditBuilderQuestion } from "../../types/auditBuilder";
import type { PromptRule, PromptRuleFollowUpAction } from "../../types/promptRules";
import { createEmptyPromptRule } from "../../utils/auditBuilderPromptRules";

type Props = {
  question: AuditBuilderQuestion;
  onChange: (promptRules: PromptRule[]) => void;
};

function readFollowUp(rule: PromptRule): PromptRuleFollowUpAction {
  return (
    rule.actions.find((action): action is PromptRuleFollowUpAction => action.type === "followUpQuestion") || {
      type: "followUpQuestion",
      id: `follow-up-${Date.now()}`,
      label: "",
      inputType: "text",
      required: true,
    }
  );
}

function readInstruction(rule: PromptRule): string {
  return rule.actions.find((action) => action.type === "instruction")?.text || "";
}

function readEscalate(rule: PromptRule) {
  return (
    rule.actions.find((action) => action.type === "escalate") || {
      type: "escalate" as const,
      message: "",
      managerReview: true,
      evidenceRequired: false,
    }
  );
}

function rebuildRule(rule: PromptRule, patch: {
  triggerValue?: string;
  followUpLabel?: string;
  followUpInputType?: PromptRuleFollowUpAction["inputType"];
  followUpUnit?: string;
  instruction?: string;
  escalateMessage?: string;
  managerReview?: boolean;
  evidenceRequired?: boolean;
  safeMin?: string;
  safeMax?: string;
}): PromptRule {
  const followUp = readFollowUp(rule);
  const escalate = readEscalate(rule);
  const safeMin = patch.safeMin !== undefined ? Number(patch.safeMin) : escalate.safeMin;
  const safeMax = patch.safeMax !== undefined ? Number(patch.safeMax) : escalate.safeMax;
  return {
    when: { operator: "equals", value: patch.triggerValue ?? rule.when.value },
    actions: [
      {
        ...followUp,
        label: patch.followUpLabel ?? followUp.label,
        inputType: patch.followUpInputType ?? followUp.inputType,
        unit: patch.followUpUnit !== undefined ? patch.followUpUnit || undefined : followUp.unit,
      },
      {
        type: "instruction",
        text: patch.instruction ?? readInstruction(rule),
      },
      {
        type: "escalate",
        message: patch.escalateMessage ?? escalate.message,
        managerReview: patch.managerReview ?? escalate.managerReview ?? false,
        evidenceRequired: patch.evidenceRequired ?? escalate.evidenceRequired ?? false,
        followUpId: followUp.id,
        safeMin: Number.isFinite(safeMin) ? safeMin : undefined,
        safeMax: Number.isFinite(safeMax) ? safeMax : undefined,
      },
    ],
  };
}

export function QuestionPromptRulesEditor({ question, onChange }: Props) {
  const { t } = useTranslation();
  const rules = question.prompt_rules ?? [];
  const optionChoices =
    question.answer_type === "yes_no"
      ? ["Yes", "No"]
      : question.options.filter(Boolean);

  const updateRule = (index: number, patch: Parameters<typeof rebuildRule>[1]) => {
    const next = rules.map((rule, ruleIndex) => (ruleIndex === index ? rebuildRule(rule, patch) : rule));
    onChange(next);
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("auditBuilder.promptRules")}</p>
        <button
          type="button"
          onClick={() => onChange([...rules, createEmptyPromptRule(optionChoices[0] || "Yes")])}
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
        >
          {t("auditBuilder.addRule")}
        </button>
      </div>
      {rules.length === 0 ? (
        <p className="text-xs text-slate-500">No prompt rules. The question uses standard answers only.</p>
      ) : null}
      {rules.map((rule, index) => {
        const followUp = readFollowUp(rule);
        const escalate = readEscalate(rule);
        return (
          <div key={`prompt-rule-${index}`} className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">{t("auditBuilder.whenAnswerIs")}</p>
              <button
                type="button"
                onClick={() => onChange(rules.filter((_, ruleIndex) => ruleIndex !== index))}
                className="text-xs font-semibold text-rose-600"
              >
                Remove
              </button>
            </div>
            <select
              value={rule.when.value}
              onChange={(event) => updateRule(index, { triggerValue: event.target.value })}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
            >
              {optionChoices.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="block text-xs font-semibold text-slate-700">
              {t("auditBuilder.followUpQuestion")}
              <input
                value={followUp.label}
                onChange={(event) => updateRule(index, { followUpLabel: event.target.value })}
                placeholder="What is the temperature?"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">
                {t("auditBuilder.inputType")}
                <select
                  value={followUp.inputType}
                  onChange={(event) =>
                    updateRule(index, {
                      followUpInputType: event.target.value as PromptRuleFollowUpAction["inputType"],
                    })
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="short_text">Short text</option>
                  <option value="paragraph">Paragraph</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Unit (optional)
                <input
                  value={followUp.unit || ""}
                  onChange={(event) => updateRule(index, { followUpUnit: event.target.value })}
                  placeholder="°C"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
                />
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-700">
              Instruction
              <textarea
                value={readInstruction(rule)}
                onChange={(event) => updateRule(index, { instruction: event.target.value })}
                placeholder="Close the fridge door and check again in 15 minutes."
                className="mt-1 min-h-[4rem] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Manager review message
              <textarea
                value={escalate.message}
                onChange={(event) => updateRule(index, { escalateMessage: event.target.value })}
                placeholder="If temperature is outside safe range, alert a manager."
                className="mt-1 min-h-[4rem] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">
                Safe min
                <input
                  type="number"
                  value={escalate.safeMin ?? ""}
                  onChange={(event) => updateRule(index, { safeMin: event.target.value })}
                  placeholder="0"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Safe max
                <input
                  type="number"
                  value={escalate.safeMax ?? ""}
                  onChange={(event) => updateRule(index, { safeMax: event.target.value })}
                  placeholder="5"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(escalate.managerReview)}
                  onChange={(event) => updateRule(index, { managerReview: event.target.checked })}
                />
                {t("auditBuilder.managerReviewFlag")}
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(escalate.evidenceRequired)}
                  onChange={(event) => updateRule(index, { evidenceRequired: event.target.checked })}
                />
                {t("auditBuilder.evidenceRequired")}
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
