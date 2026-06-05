import { FormEvent, useMemo, useState } from "react";
import { getRoleTheme } from "../config/roleTheme";
import { SectionIntro } from "../components/SectionIntro";
import {
  generateAuditTemplateFromText,
  saveAuditBuilderTemplate,
} from "../services/auditBuilderService";
import type { AuditBuilderSection, AuditBuilderTemplateDraft, AuditBuilderTemplateRecord } from "../types/auditBuilder";
import type { Role } from "../permissions";

const FIRE_SAFETY_SEED = `Fire Safety Check Audit

Audit details
- Auditor name recorded?
- Date and site/area recorded?
- Previous actions reviewed?

Fire alarm and detection
- Alarm panel shows normal status?
- Call points unobstructed?
- Detectors free from obstruction?

Fire extinguishers
- Correct type and location?
- Within service date?
- Pin and seal intact?

Fire exits and escape routes
- Exits unlocked and clear?
- Routes free from obstruction?
- Final exit opens freely?

Emergency lighting and signage
- Escape route signage visible?
- Emergency lights operational?

Fire doors
- Self-closing correctly?
- Intumescent strips intact?
- Kept closed when not in use?

Housekeeping and fire risks
- Combustible waste removed?
- Flammable liquids stored correctly?
- Electrical sockets not overloaded?

Training drills and documentation
- Fire drill within required period?
- Training records up to date?

Actions required
- Open actions from previous audit closed or escalated?

Sign-off
- Responsible person sign-off completed?`;

type Props = {
  role: Role;
  masterSheetId?: string;
  devApiHeaders?: Record<string, string>;
  onBack: () => void;
  onTemplateSaved: (template: AuditBuilderTemplateRecord) => void;
  onStartAudit: (template: AuditBuilderTemplateRecord) => void;
};

type Step = "paste" | "review";

function updateSectionName(sections: AuditBuilderSection[], index: number, name: string) {
  return sections.map((section, sectionIndex) =>
    sectionIndex === index ? { ...section, name } : section,
  );
}

function updateQuestionText(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
  questionText: string,
) {
  return sections.map((section, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return section;
    return {
      ...section,
      questions: section.questions.map((question, currentQuestionIndex) =>
        currentQuestionIndex === questionIndex ? { ...question, question_text: questionText } : question,
      ),
    };
  });
}

export function AuditBuilderScreen({
  role,
  masterSheetId,
  devApiHeaders,
  onBack,
  onTemplateSaved,
  onStartAudit,
}: Props) {
  const theme = getRoleTheme(role);
  const [step, setStep] = useState<Step>("paste");
  const [checklistText, setChecklistText] = useState("");
  const [draft, setDraft] = useState<AuditBuilderTemplateDraft | null>(null);
  const [savedTemplate, setSavedTemplate] = useState<AuditBuilderTemplateRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const questionCount = useMemo(
    () => (draft?.sections || []).reduce((sum, section) => sum + section.questions.length, 0),
    [draft],
  );

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const template = await generateAuditTemplateFromText(checklistText, { masterSheetId, devApiHeaders });
      setDraft(template);
      setSavedTemplate(null);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate template.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const record = await saveAuditBuilderTemplate(draft, { masterSheetId, devApiHeaders });
      setSavedTemplate(record);
      onTemplateSaved(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Audit Builder</h2>
            <SectionIntro
              text="Paste a checklist to generate a reusable audit template with compliance answer options."
              className="mt-2"
              role={role}
            />
          </div>
          <button
            type="button"
            onClick={onBack}
            className={[
              "inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold",
              theme.outlineButton,
            ].join(" ")}
          >
            Back to Audits
          </button>
        </div>
      </section>

      {step === "paste" ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setChecklistText(FIRE_SAFETY_SEED)}
            className={[
              "mb-4 inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold",
              theme.outlineButton,
            ].join(" ")}
          >
            Paste checklist
          </button>
          <form onSubmit={handleGenerate} className="space-y-4">
            <label className="block text-sm font-semibold text-slate-900" htmlFor="audit-builder-text">
              Paste checklist or audit questions
            </label>
            <textarea
              id="audit-builder-text"
              value={checklistText}
              onChange={(event) => setChecklistText(event.target.value)}
              placeholder="Paste checklist or audit questions"
              className="min-h-[16rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            />
            {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
            <button
              type="submit"
              disabled={loading || !checklistText.trim()}
              className={[
                "inline-flex h-12 items-center rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              {loading ? "Generating…" : "Generate Audit Template"}
            </button>
          </form>
        </section>
      ) : null}

      {step === "review" && draft ? (
        <section className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              Template name
              <input
                value={draft.template_name}
                onChange={(event) => setDraft({ ...draft, template_name: event.target.value })}
                className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Category
              <select
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-slate-400"
              >
                <option value="Audits">Audits</option>
                <option value="Health & Safety">Health & Safety</option>
                <option value="ISO 9001">ISO 9001</option>
                <option value="ISO 14001">ISO 14001</option>
                <option value="ISO 45001">ISO 45001</option>
                <option value="General">General</option>
              </select>
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            Description
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className="mt-2 min-h-[5rem] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <p className="text-sm text-slate-600">
            {draft.sections.length} section{draft.sections.length === 1 ? "" : "s"} · {questionCount} question
            {questionCount === 1 ? "" : "s"} · Compliant / Non-compliant / Not applicable
          </p>
          <div className="space-y-4">
            {draft.sections.map((section, sectionIndex) => (
              <div key={`section-${sectionIndex}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <input
                  value={section.name}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sections: updateSectionName(draft.sections, sectionIndex, event.target.value),
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
                <ul className="mt-3 space-y-2">
                  {section.questions.map((question, questionIndex) => (
                    <li key={`question-${sectionIndex}-${questionIndex}`}>
                      <input
                        value={question.question_text}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            sections: updateQuestionText(
                              draft.sections,
                              sectionIndex,
                              questionIndex,
                              event.target.value,
                            ),
                          })
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep("paste")}
              className={[
                "inline-flex h-12 items-center rounded-xl border px-5 text-sm font-semibold",
                theme.outlineButton,
              ].join(" ")}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={[
                "inline-flex h-12 items-center rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              {saving ? "Saving…" : "Save Template"}
            </button>
            {savedTemplate ? (
              <button
                type="button"
                onClick={() => onStartAudit(savedTemplate)}
                className={[
                  "inline-flex h-12 items-center rounded-xl border px-5 text-sm font-semibold",
                  theme.outlineButton,
                ].join(" ")}
              >
                Start Audit Now
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
