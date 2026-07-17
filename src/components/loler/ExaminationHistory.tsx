import { useTranslation } from "react-i18next";
import type { LolerExamination } from "../../types/loler";
import { translateLolerExaminationResult } from "../../i18n/statusLabels";

type Props = {
  examinations: LolerExamination[];
};

function formatDate(dateKey?: string): string {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw || "—";
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function resultBadgeClass(result: string): string {
  switch (result) {
    case "passed":
      return "bg-emerald-100 text-emerald-800";
    case "passed_with_observations":
      return "bg-amber-100 text-amber-800";
    case "failed":
      return "bg-red-100 text-red-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function ExaminationHistory({ examinations }: Props) {
  const { t } = useTranslation();

  if (examinations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        {t("loler.noExaminationHistory")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {examinations.map((examination) => {
        const label = translateLolerExaminationResult(t, examination.examinationResult);
        return (
          <div key={examination.examinationId} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">{formatDate(examination.examinationDate)}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${resultBadgeClass(examination.examinationResult)}`}>
                {label}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t("loler.examiner")}: {examination.examinerName || examination.examinerEmail || "—"}
              {examination.nextExaminationDueDate
                ? ` · ${t("loler.nextDue")} ${formatDate(examination.nextExaminationDueDate)}`
                : ""}
            </p>
            {examination.observations ? (
              <p className="mt-1 text-sm text-slate-600">
                {t("loler.observations")}: {examination.observations}
              </p>
            ) : null}
            {examination.defectsFound ? (
              <p className="mt-1 text-sm text-red-700">
                {t("loler.defects")}: {examination.defectsFound}
              </p>
            ) : null}
            {examination.reportFileUrl ? (
              <a
                href={examination.reportFileUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm font-semibold text-slate-700 underline-offset-2 hover:underline"
              >
                {examination.reportFileName || t("loler.openReport")}
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
