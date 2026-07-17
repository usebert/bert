import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { it } from "./locales/it";
import { readDeviceLanguagePreference } from "./languagePreference";
import { DEFAULT_LANGUAGE } from "./types";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    it: { translation: it },
  },
  lng: typeof window !== "undefined" ? readDeviceLanguagePreference() : DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
  // Bundled resources only — no remote translation loading.
  react: {
    useSuspense: false,
  },
});

export default i18n;
