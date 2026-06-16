import {
  COMPLIANCE_TRANSLATION_WARNING,
  FORM_LANGUAGE_OPTIONS,
  GOOGLE_FORM_UNAPPROVED_WARNING,
  type FormLanguageCode,
  type TranslationStatus,
  googleFormCopyRequiresApprovalWarning,
  normalizeFormLanguage,
  translationStatusRequiresComplianceWarning,
} from "../../config/templateLanguages";

type TemplateLanguageFieldsProps = {
  language: string;
  translationStatus?: TranslationStatus | string;
  onLanguageChange: (code: FormLanguageCode) => void;
  disabled?: boolean;
  showGoogleFormCopyWarning?: boolean;
  idPrefix?: string;
};

export function TemplateLanguageFields({
  language,
  translationStatus,
  onLanguageChange,
  disabled = false,
  showGoogleFormCopyWarning = false,
  idPrefix = "template-lang",
}: TemplateLanguageFieldsProps) {
  const normalized = normalizeFormLanguage(language);
  const status = String(translationStatus || "").trim();
  const showComplianceWarning = translationStatusRequiresComplianceWarning(status);
  const showGoogleWarning =
    showGoogleFormCopyWarning && googleFormCopyRequiresApprovalWarning(normalized, status);

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500" htmlFor={`${idPrefix}-select`}>
        Template language
      </label>
      <select
        id={`${idPrefix}-select`}
        value={normalized}
        disabled={disabled}
        onChange={(event) => onLanguageChange(normalizeFormLanguage(event.target.value))}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400 disabled:opacity-60"
      >
        {FORM_LANGUAGE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
      {normalized !== "en" && status ? (
        <p className="text-xs text-slate-600">
          Translation status: <span className="font-semibold text-slate-800">{status}</span>
        </p>
      ) : null}
      {showComplianceWarning ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{COMPLIANCE_TRANSLATION_WARNING}</p>
      ) : null}
      {showGoogleWarning ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{GOOGLE_FORM_UNAPPROVED_WARNING}</p>
      ) : null}
    </div>
  );
}
