import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { assessIncidentRiddor } from "../../services/healthSafetyService";
import type { RiddorEvaluation, RiddorRecord } from "../../types/healthSafety";
import { RIDDOR_DISCLAIMER } from "../constants";
import { riddorDecisionLabel, riddorDecisionVariant } from "../adapters/riddorListAdapter";

type RiddorAnswers = {
  fatality: boolean;
  specifiedInjury: boolean;
  overSevenDayInjury: boolean;
  dangerousOccurrence: boolean;
  occupationalDisease: boolean;
  gasIncident: boolean;
  memberOfPublicHospitalTreatment: boolean;
  furtherInformationRequired: boolean;
  supportingReason: string;
};

const EMPTY_ANSWERS: RiddorAnswers = {
  fatality: false,
  specifiedInjury: false,
  overSevenDayInjury: false,
  dangerousOccurrence: false,
  occupationalDisease: false,
  gasIncident: false,
  memberOfPublicHospitalTreatment: false,
  furtherInformationRequired: false,
  supportingReason: "",
};

const QUESTIONS: Array<{ key: keyof RiddorAnswers; label: string; description?: string }> = [
  { key: "fatality", label: "Did the incident result in a fatality?" },
  { key: "specifiedInjury", label: "Was there a specified injury to an employee or self-employed person?" },
  { key: "overSevenDayInjury", label: "Did an employee lose more than seven consecutive days from work?" },
  { key: "dangerousOccurrence", label: "Was this a dangerous occurrence?" },
  { key: "occupationalDisease", label: "Is an occupational disease suspected or confirmed?" },
  { key: "gasIncident", label: "Was this a gas incident?" },
  {
    key: "memberOfPublicHospitalTreatment",
    label: "Did a member of the public receive hospital treatment as a direct result of the incident?",
  },
  {
    key: "furtherInformationRequired",
    label: "Do you need more information before deciding?",
    description: "Select this if the assessment cannot be completed yet.",
  },
];

function evaluatePreview(answers: RiddorAnswers): RiddorEvaluation {
  if (answers.furtherInformationRequired) {
    return { decisionStatus: "information_required", likelyReportable: false };
  }
  const likelyReportable =
    answers.fatality ||
    answers.specifiedInjury ||
    answers.overSevenDayInjury ||
    answers.dangerousOccurrence ||
    answers.occupationalDisease ||
    answers.gasIncident ||
    answers.memberOfPublicHospitalTreatment;
  return {
    decisionStatus: likelyReportable ? "likely_reportable" : "not_reportable",
    likelyReportable,
  };
}

export type RiddorAssessmentPanelProps = {
  companyFolderId: string;
  incidentId: string;
  disabled?: boolean;
  existingRecord?: RiddorRecord | null;
  onCompleted?: (result: { item: RiddorRecord; evaluation: RiddorEvaluation }) => void;
};

export function RiddorAssessmentPanel({
  companyFolderId,
  incidentId,
  disabled = false,
  existingRecord,
  onCompleted,
}: RiddorAssessmentPanelProps) {
  const [answers, setAnswers] = useState<RiddorAnswers>(() =>
    existingRecord
      ? {
          fatality: existingRecord.fatality,
          specifiedInjury: existingRecord.specifiedInjury,
          overSevenDayInjury: existingRecord.overSevenDayInjury,
          dangerousOccurrence: existingRecord.dangerousOccurrence,
          occupationalDisease: existingRecord.occupationalDisease,
          gasIncident: existingRecord.gasIncident,
          memberOfPublicHospitalTreatment: existingRecord.memberOfPublicHospitalTreatment,
          furtherInformationRequired: existingRecord.furtherInformationRequired,
          supportingReason: existingRecord.supportingReason,
        }
      : EMPTY_ANSWERS,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [savedRecord, setSavedRecord] = useState<RiddorRecord | null>(existingRecord || null);
  const [savedEvaluation, setSavedEvaluation] = useState<RiddorEvaluation | null>(null);

  const preview = useMemo(() => evaluatePreview(answers), [answers]);

  const submitAssessment = async (confirmedDecisionStatus?: RiddorEvaluation["decisionStatus"]) => {
    setError("");
    setSubmitting(true);
    try {
      const result = await assessIncidentRiddor(companyFolderId, incidentId, {
        ...answers,
        confirmedDecisionStatus,
      });
      if (!result.item || !result.evaluation) {
        throw new Error("RIDDOR assessment did not return a result.");
      }
      setSavedRecord(result.item);
      setSavedEvaluation(result.evaluation);
      onCompleted?.({ item: result.item, evaluation: result.evaluation });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save RIDDOR assessment.");
    } finally {
      setSubmitting(false);
    }
  };

  const displayEvaluation = savedEvaluation || preview;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">RIDDOR assessment</p>
          <p className="mt-1 text-sm text-slate-700">
            Answer the questions below to determine whether this incident may be reportable under RIDDOR.
          </p>
        </div>
        <StatusBadge variant={riddorDecisionVariant(displayEvaluation.decisionStatus)}>
          {riddorDecisionLabel(displayEvaluation.decisionStatus)}
        </StatusBadge>
      </div>

      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
        {RIDDOR_DISCLAIMER}
      </p>

      <div className="mt-4 space-y-3">
        {QUESTIONS.map((question) => (
          <label
            key={question.key}
            className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={Boolean(answers[question.key])}
              disabled={disabled || submitting}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.key]: event.target.checked,
                }))
              }
            />
            <span>
              <span className="font-medium">{question.label}</span>
              {question.description ? <span className="mt-1 block text-xs text-slate-500">{question.description}</span> : null}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="riddor-supporting-reason">
          Supporting notes
        </label>
        <textarea
          id="riddor-supporting-reason"
          value={answers.supportingReason}
          disabled={disabled || submitting}
          onChange={(event) => setAnswers((current) => ({ ...current, supportingReason: event.target.value }))}
          placeholder="Record the rationale for this decision"
          className="mt-1 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
          {error}
        </p>
      ) : null}

      {savedRecord ? (
        <p className="mt-3 text-sm text-emerald-800">
          Assessment saved for incident {savedRecord.incidentId}. Submission status:{" "}
          <span className="font-semibold">{savedRecord.submissionStatus.replace(/_/g, " ")}</span>.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={disabled || submitting}
          onClick={() => void submitAssessment()}
        >
          {submitting ? "Saving…" : savedRecord ? "Update assessment" : "Save assessment"}
        </Button>
        {preview.likelyReportable && !answers.furtherInformationRequired ? (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || submitting}
            onClick={() => void submitAssessment("confirmed_reportable")}
          >
            Confirm as reportable
          </Button>
        ) : null}
      </div>
    </div>
  );
}
