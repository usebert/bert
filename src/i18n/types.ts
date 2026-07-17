/** App UI languages (Stage 1). Distinct from form template content languages. */
export type SupportedLanguage = "en" | "it";

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ["en", "it"] as const;

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === "en" || value === "it";
}
