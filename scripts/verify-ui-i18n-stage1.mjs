#!/usr/bin/env node
/**
 * verify:ui-i18n-stage1 — English + Italian UI localisation (presentation only).
 * Asserts auth/login/company-resolution files stay untouched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const packageJson = JSON.parse(read("package.json"));
assert(Boolean(packageJson.dependencies?.i18next), "i18next dependency present");
assert(Boolean(packageJson.dependencies?.["react-i18next"]), "react-i18next dependency present");

const types = read("src/i18n/types.ts");
assert(types.includes('SupportedLanguage = "en" | "it"'), "SupportedLanguage en|it");

const pref = read("src/i18n/languagePreference.ts");
assert(pref.includes("bert:language"), "language key prefix");
assert(pref.includes("buildLanguagePreferenceKey"), "scoped preference key builder");

const en = read("src/i18n/locales/en.ts");
const it = read("src/i18n/locales/it.ts");
assert(en.includes("heroHeading") && it.includes("Benvenuto"), "login strings in en/it");
assert(en.includes("dashboard:") && it.includes("Calendario"), "nav/dashboard strings in en/it");

const i18nInit = read("src/i18n/index.ts");
assert(i18nInit.includes("initReactI18next"), "i18n initialised with react-i18next");
assert(!i18nInit.includes("backend") && !i18nInit.includes("http"), "no remote translation backend");

const main = read("src/main.tsx");
assert(main.includes('./i18n"') || main.includes("./i18n'"), "i18n bootstrapped from main");

const account = read("src/screens/AccountSettingsScreen.tsx");
assert(account.includes("LanguageSelector"), "Account settings has language selector");
assert(account.includes("uiLanguage"), "Account settings receives uiLanguage");

const app = read("App.tsx");
assert(app.includes("t(\"login.signIn\")") || app.includes("t('login.signIn')"), "login sign-in label translated");
assert(app.includes("translateNavLabel"), "nav labels translated at presentation");
assert(app.includes("handleUiLanguageChange"), "language change handler present");
assert(app.includes("LanguageSelector"), "login language selector present");

const navLogic = read("src/config/roleNavigation.ts");
assert(navLogic.includes('label: "People"'), "nav permission labels remain English");
assert(!navLogic.includes("useTranslation"), "roleNavigation not rewritten for i18n");

const protectedFiles = [
  "server/server.mjs",
  "server/auth-index.mjs",
  "server/user-auth-service.mjs",
  "src/services/authService.ts",
  "src/lib/companyLoginHint.ts",
];
for (const file of protectedFiles) {
  const content = read(file);
  assert(!content.includes("i18next") && !content.includes("react-i18next"), `protected untouched: ${file}`);
}

assert(app.includes("handleLogin"), "login handler still present (logic intact)");
assert(app.includes("void handleLogin()"), "login submit still calls handleLogin");

console.log(`verify:ui-i18n-stage1 passed (${caseCount} checks).`);
