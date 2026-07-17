/**
 * Local language preference — presentation only.
 * Uses existing company folder id + user identity as storage identifiers only.
 */
import { DEFAULT_LANGUAGE, isSupportedLanguage, type SupportedLanguage } from "./types";

const LANGUAGE_KEY_PREFIX = "bert:language";
const DEVICE_LANGUAGE_KEY = `${LANGUAGE_KEY_PREFIX}:device`;

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildLanguagePreferenceKey(companyFolderId: string, userIdentity: string): string {
  const company = trim(companyFolderId) || "unknown-company";
  const user = trim(userIdentity).toLowerCase() || "unknown-user";
  return `${LANGUAGE_KEY_PREFIX}:${company}:${user}`;
}

function readRaw(key: string): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    return trim(window.localStorage.getItem(key));
  } catch {
    return "";
  }
}

function writeRaw(key: string, value: string) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function readDeviceLanguagePreference(): SupportedLanguage {
  const raw = readRaw(DEVICE_LANGUAGE_KEY);
  return isSupportedLanguage(raw) ? raw : DEFAULT_LANGUAGE;
}

export function writeDeviceLanguagePreference(language: SupportedLanguage) {
  writeRaw(DEVICE_LANGUAGE_KEY, language);
}

/** Prefer scoped user+company preference; fall back to device last choice. */
export function readLanguagePreference(
  companyFolderId?: string,
  userIdentity?: string,
): SupportedLanguage {
  const company = trim(companyFolderId);
  const user = trim(userIdentity);
  if (company && user) {
    const scoped = readRaw(buildLanguagePreferenceKey(company, user));
    if (isSupportedLanguage(scoped)) {
      return scoped;
    }
  }
  return readDeviceLanguagePreference();
}

export function writeLanguagePreference(
  language: SupportedLanguage,
  companyFolderId?: string,
  userIdentity?: string,
) {
  const company = trim(companyFolderId);
  const user = trim(userIdentity);
  if (company && user) {
    writeRaw(buildLanguagePreferenceKey(company, user), language);
  }
  writeDeviceLanguagePreference(language);
}
