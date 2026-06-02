/**
 * Server-side BERT template language constants and copy resolution (no auto-translation).
 */

export const DEFAULT_FORM_LANGUAGE = "en";

export const SUPPORTED_FORM_LANGUAGE_CODES = ["en", "cy", "pl", "ro", "es", "fr", "pt"];

export const CONFIG_KEY_DEFAULT_FORM_LANGUAGE = "defaultFormLanguage";

export const TRANSLATION_STATUSES = [
  "Original",
  "Draft translation",
  "Needs review",
  "Approved",
  "Outdated",
];

export const TRANSLATION_STATUS_ORIGINAL = "Original";
export const TRANSLATION_STATUS_APPROVED = "Approved";

export const SYNC_STATUS_FALLBACK_LANGUAGE = "Created using fallback language";

export const FORM_LANGUAGE_LOCALE = {
  en: "en_GB",
  cy: "cy_GB",
  pl: "pl_PL",
  ro: "ro_RO",
  es: "es_ES",
  fr: "fr_FR",
  pt: "pt_PT",
};

export const AUDIT_TEMPLATE_TRANSLATIONS_TAB = "AuditTemplateTranslations";

export const AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS = [
  "BERT Template ID",
  "Language",
  "Translation Status",
  "Title",
  "Description",
  "Section JSON",
  "Questions JSON",
  "Options JSON",
  "Guidance JSON",
  "Updated At",
  "Updated By",
];

export function isSupportedFormLanguage(value) {
  return SUPPORTED_FORM_LANGUAGE_CODES.includes(String(value || "").trim().toLowerCase());
}

export function normalizeFormLanguage(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase();
  return isSupportedFormLanguage(code) ? code : DEFAULT_FORM_LANGUAGE;
}

export function parseDefaultFormLanguageFromConfig(config = {}) {
  return normalizeFormLanguage(config[CONFIG_KEY_DEFAULT_FORM_LANGUAGE]);
}

export function defaultTranslationStatusForLanguage(language) {
  return language === DEFAULT_FORM_LANGUAGE ? TRANSLATION_STATUS_ORIGINAL : "Draft translation";
}

/**
 * Resolves Google Form / BERT copy text for a language. Uses translation rows when present;
 * otherwise falls back to English/original without calling any translation API.
 */
export function resolveTemplateFormCopyContent(template, requestedLanguage, translationRows = []) {
  const language = normalizeFormLanguage(requestedLanguage || template?.language);
  const defaultLanguage = normalizeFormLanguage(template?.defaultLanguage || DEFAULT_FORM_LANGUAGE);
  const baseTitle = String(template?.name || template?.templateName || "BERT Template").trim();
  const baseQuestions = Array.isArray(template?.questions) ? template.questions : [];
  const baseDescription = String(template?.description || "").trim();

  if (language === DEFAULT_FORM_LANGUAGE) {
    return {
      language: DEFAULT_FORM_LANGUAGE,
      locale: FORM_LANGUAGE_LOCALE.en,
      title: baseTitle,
      description: baseDescription,
      questions: baseQuestions,
      translationStatus: TRANSLATION_STATUS_ORIGINAL,
      translationSource: "original",
      usedFallback: false,
      syncStatusNote: "",
    };
  }

  const match = translationRows.find(
    (row) =>
      String(row?.bertTemplateId || row?.["BERT Template ID"] || "").trim() ===
        String(template?.id || template?.bertTemplateId || "").trim() &&
      normalizeFormLanguage(row?.language || row?.Language) === language,
  );

  if (match) {
    let questions = baseQuestions;
    const questionsJson = String(match?.questionsJson || match?.["Questions JSON"] || "").trim();
    if (questionsJson) {
      try {
        const parsed = JSON.parse(questionsJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          questions = parsed;
        }
      } catch {
        /* keep base questions */
      }
    }
    return {
      language,
      locale: FORM_LANGUAGE_LOCALE[language] || FORM_LANGUAGE_LOCALE.en,
      title: String(match?.title || match?.Title || baseTitle).trim() || baseTitle,
      description: String(match?.description || match?.Description || baseDescription).trim(),
      questions,
      translationStatus: String(match?.translationStatus || match?.["Translation Status"] || "Draft translation").trim(),
      translationSource: "AuditTemplateTranslations",
      usedFallback: false,
      syncStatusNote: "",
    };
  }

  return {
    language: defaultLanguage,
    locale: FORM_LANGUAGE_LOCALE[defaultLanguage] || FORM_LANGUAGE_LOCALE.en,
    title: baseTitle,
    description: baseDescription,
    questions: baseQuestions,
    translationStatus: defaultTranslationStatusForLanguage(language),
    translationSource: "fallback",
    usedFallback: true,
    syncStatusNote: SYNC_STATUS_FALLBACK_LANGUAGE,
  };
}

export function googleFormLanguageFields(language, translationStatus, translationSource) {
  const code = normalizeFormLanguage(language);
  return {
    language: code,
    locale: FORM_LANGUAGE_LOCALE[code] || FORM_LANGUAGE_LOCALE.en,
    translationSource: String(translationSource || (code === DEFAULT_FORM_LANGUAGE ? "original" : "template")).trim(),
    translationStatus: String(
      translationStatus || defaultTranslationStatusForLanguage(code),
    ).trim(),
  };
}
