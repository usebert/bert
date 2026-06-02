/** BERT form/check template content languages (not app UI locale). */
export const DEFAULT_FORM_LANGUAGE = "en" as const;

export const SUPPORTED_FORM_LANGUAGE_CODES = ["en", "cy", "pl", "ro", "es", "fr", "pt"] as const;

export type FormLanguageCode = (typeof SUPPORTED_FORM_LANGUAGE_CODES)[number];

export const FORM_LANGUAGE_OPTIONS: ReadonlyArray<{ code: FormLanguageCode; label: string }> = [
  { code: "en", label: "English" },
  { code: "cy", label: "Welsh" },
  { code: "pl", label: "Polish" },
  { code: "ro", label: "Romanian" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
];

export const CONFIG_KEY_DEFAULT_FORM_LANGUAGE = "defaultFormLanguage";

export const TRANSLATION_STATUSES = [
  "Original",
  "Draft translation",
  "Needs review",
  "Approved",
  "Outdated",
] as const;

export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export const TRANSLATION_STATUS_ORIGINAL: TranslationStatus = "Original";
export const TRANSLATION_STATUS_APPROVED: TranslationStatus = "Approved";

export const SYNC_STATUS_FALLBACK_LANGUAGE = "Created using fallback language";

export const COMPLIANCE_TRANSLATION_WARNING =
  "Translations for safety and compliance content should be reviewed before use.";

export const GOOGLE_FORM_UNAPPROVED_WARNING =
  "Google Form copy language is not Approved. Review translations before distributing this form.";

export const FORM_LANGUAGE_LOCALE: Record<FormLanguageCode, string> = {
  en: "en_GB",
  cy: "cy_GB",
  pl: "pl_PL",
  ro: "ro_RO",
  es: "es_ES",
  fr: "fr_FR",
  pt: "pt_PT",
};

export function isSupportedFormLanguage(value: string): value is FormLanguageCode {
  return (SUPPORTED_FORM_LANGUAGE_CODES as readonly string[]).includes(value);
}

export function normalizeFormLanguage(value: string | undefined | null): FormLanguageCode {
  const code = String(value || "")
    .trim()
    .toLowerCase();
  return isSupportedFormLanguage(code) ? code : DEFAULT_FORM_LANGUAGE;
}

export function defaultTranslationStatusForLanguage(language: FormLanguageCode): TranslationStatus {
  return language === DEFAULT_FORM_LANGUAGE ? TRANSLATION_STATUS_ORIGINAL : "Draft translation";
}

export function translationStatusRequiresComplianceWarning(status: string | undefined): boolean {
  const normalized = String(status || "").trim();
  return normalized.length > 0 && normalized !== TRANSLATION_STATUS_ORIGINAL && normalized !== TRANSLATION_STATUS_APPROVED;
}

export function googleFormCopyRequiresApprovalWarning(
  language: FormLanguageCode,
  translationStatus: string | undefined,
): boolean {
  if (language === DEFAULT_FORM_LANGUAGE) return false;
  return String(translationStatus || "").trim() !== TRANSLATION_STATUS_APPROVED;
}

export function formLanguageLabel(code: string): string {
  const match = FORM_LANGUAGE_OPTIONS.find((item) => item.code === normalizeFormLanguage(code));
  return match?.label || "English";
}
