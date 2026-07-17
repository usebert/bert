#!/usr/bin/env node
/**
 * verify:ui-i18n-stage3 — Schedules, Audit Builder, People/Sites, Sync,
 * Archive, Documents, QMS, Onboarding, Godmode and remaining admin UI
 * localisation (presentation only). Auth/login/session remain untouched.
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

function extractKeys(src) {
  const start = src.indexOf("= {");
  let end = src.lastIndexOf("} as const");
  if (end < 0) end = src.lastIndexOf("};");
  const body = src.slice(start + 2, end + 1);
  const keys = [];
  const stack = [];
  const re =
    /(\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|([A-Za-z0-9_]+)\s*:|([{}])/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] || m[2]) continue;
    if (m[3]) {
      const key = m[3];
      const rest = body.slice(m.index + m[0].length).match(/^\s*/);
      const after = body[m.index + m[0].length + (rest?.[0].length || 0)];
      if (after === "{") stack.push(key);
      else keys.push([...stack, key].join("."));
      continue;
    }
    if (m[4] === "}") stack.pop();
  }
  return keys;
}

const enSrc = read("src/i18n/locales/en.ts");
const itSrc = read("src/i18n/locales/it.ts");
const enKeys = new Set(extractKeys(enSrc));
const itKeys = new Set(extractKeys(itSrc));

assert(enKeys.size > 0 && enKeys.size === itKeys.size, "30. EN/IT key counts match (parity)");
for (const key of enKeys) {
  if (!itKeys.has(key)) assert(false, `Italian missing key: ${key}`);
}
assert(true, "30. every English key has an Italian counterpart");

const requiredKeys = [
  "schedules.title",
  "schedules.newSchedule",
  "schedules.frequencyDaily",
  "schedules.saveSchedule",
  "auditBuilder.title",
  "auditBuilder.addQuestion",
  "auditBuilder.saveDraft",
  "people.title",
  "people.inviteUser",
  "people.role",
  "sites.title",
  "sites.addArea",
  "sites.siteName",
  "syncCentre.title",
  "syncCentre.syncNow",
  "syncCentre.retryAll",
  "archiveCentre.title",
  "archiveCentre.restore",
  "documentTraining.documentTraining",
  "documentTraining.readAndAcknowledge",
  "qms.qualityManagement",
  "qms.documentControl",
  "onboarding.companySetup",
  "onboarding.continue",
  "godmode.companies",
  "godmode.diagnostics",
  "roles.manager",
  "actions.title",
  "results.title",
];
for (const key of requiredKeys) {
  assert(enKeys.has(key) && itKeys.has(key), `required Stage 3 key: ${key}`);
}

assert(itSrc.includes("Pianificazioni"), "Italian Schedules label");
assert(itSrc.includes("Generatore di audit"), "Italian Audit Builder label");
assert(itSrc.includes("Centro sincronizzazione"), "Italian Sync Centre label");
assert(itSrc.includes("Formazione documentale"), "Italian Document Training label");
assert(itSrc.includes("Gestione della qualità"), "Italian QMS label");

const schedules = read("src/screens/SchedulesScreen.tsx");
assert(schedules.includes("useTranslation"), "1. Schedules fixed UI uses translations");
assert(
  schedules.includes('t("schedules.title")') ||
    schedules.includes('t("schedules.newSchedule")') ||
    schedules.includes('t("schedules.addNew")'),
  "1. Schedules labels use keys",
);
assert(
  schedules.includes("translateScheduleFrequency") ||
    schedules.includes('value="daily"') ||
    schedules.includes('value="weekly"') ||
    schedules.includes('"daily"'),
  "2. Schedule frequency stored values remain English",
);

const auditBuilder = read("src/screens/AuditBuilderScreen.tsx");
assert(auditBuilder.includes("useTranslation"), "3. Audit Builder labels translated");
assert(
  auditBuilder.includes('t("auditBuilder.title")') || auditBuilder.includes('t("auditBuilder.'),
  "3. Audit Builder uses auditBuilder keys",
);
assert(
  !auditBuilder.includes("t(question.") && !auditBuilder.includes("t(template.name"),
  "4. Audit questions / template names not force-translated",
);

const peoplePanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
assert(peoplePanel.includes("useTranslation"), "5. People administration labels translated");
assert(
  peoplePanel.includes('t("people.') || peoplePanel.includes("translateRoleLabel"),
  "5. People panel uses people/role keys",
);
assert(
  !peoplePanel.includes("t(user.email") && !peoplePanel.includes("t(person."),
  "6. User records / emails not translated via t()",
);

const sitesPanel = read("src/components/admin/SitesAreasPanel.tsx");
assert(sitesPanel.includes("useTranslation"), "7. Site and Area UI labels translated");
assert(
  sitesPanel.includes('t("sites.') || sitesPanel.includes('t("sites.addArea")'),
  "7. Sites panel uses sites keys",
);
assert(
  !sitesPanel.includes("t(site.name") && !sitesPanel.includes("t(area.name"),
  "8. Site and Area names remain untranslated data",
);

const syncCentre = read("src/screens/SyncCentreScreen.tsx");
assert(syncCentre.includes("useTranslation"), "9. Sync Centre labels translated");
assert(
  syncCentre.includes('t("syncCentre.syncNow")') || syncCentre.includes('t("syncCentre.'),
  "9. Sync Centre uses syncCentre keys",
);
assert(
  syncCentre.includes('"Pending Sync"') || syncCentre.includes("Pending Sync"),
  "10. Offline queue status values remain English for logic",
);
assert(
  syncCentre.includes("translateSyncQueueStatus") || syncCentre.includes("translateSyncItemType"),
  "10. Sync display helpers used for labels",
);

const archive = read("src/screens/ArchiveScreen.tsx");
assert(archive.includes("useTranslation"), "11. Archive Centre labels translated");
assert(
  archive.includes('t("archiveCentre.') || archive.includes('t("archiveCentre.title")'),
  "11. Archive uses archiveCentre keys",
);
assert(
  archive.includes('"users"') && archive.includes('"schedules"'),
  "12. Archive section ids / state values remain English",
);

const docs = read("src/screens/DocumentTrainingScreen.tsx");
assert(docs.includes("useTranslation"), "13. Document Training UI translated");
assert(
  docs.includes('t("documentTraining.') || docs.includes('t("documentTraining.title")'),
  "13. Document Training uses keys",
);
assert(
  !docs.includes("t(file.name") && !docs.includes("t(document.title"),
  "14. Document contents/filenames not translated via t()",
);

const qms = read("src/screens/QmsReadinessScreen.tsx");
assert(qms.includes("useTranslation"), "15. QMS administration labels translated");
assert(qms.includes('t("qms.') || qms.includes('t("qms.title")'), "15. QMS uses qms keys");

const onboarding = read("src/screens/CompanyOnboardingFormScreen.tsx");
assert(onboarding.includes("useTranslation"), "16. Onboarding labels translated");
assert(
  onboarding.includes('t("onboarding.') || onboarding.includes('t("onboarding.companySetup")'),
  "16. Onboarding uses onboarding keys",
);

const godmode = read("src/screens/GodmodeStartScreen.tsx");
assert(godmode.includes("useTranslation"), "17. Master/Godmode labels translated");
assert(
  godmode.includes('t("godmode.') || godmode.includes('t("godmode.title")'),
  "17. Godmode uses godmode keys",
);

const archiveDialog = read("src/components/archive/ArchiveConfirmDialog.tsx");
assert(
  archiveDialog.includes("useTranslation") || archiveDialog.includes('t("archiveCentre.'),
  "18. Shared archive dialog translated",
);
assert(enKeys.has("errors.required") && itKeys.has("errors.required"), "18. Shared validation keys present");

const i18nInit = read("src/i18n/index.ts");
const types = read("src/i18n/types.ts");
assert(
  i18nInit.includes("fallbackLng: DEFAULT_LANGUAGE") && types.includes('DEFAULT_LANGUAGE: SupportedLanguage = "en"'),
  "19. Missing Italian keys still fall back to English",
);

const app = read("App.tsx");
assert(app.includes("translateNavLabel") && app.includes("LanguageSelector"), "20. Stage 1 nav/language still wired");
assert(app.includes('t("login.signIn")') || app.includes("t('login.signIn')"), "20. Stage 1 login labels still present");

assert(enKeys.has("loler.equipmentRegister") && enKeys.has("calendar.month"), "21. Stage 2 keys still present");
const loler = read("src/screens/LolerScreen.tsx");
assert(loler.includes('t("loler.equipmentRegister")'), "21. Stage 2 LOLER wiring still present");

const pref = read("src/i18n/languagePreference.ts");
assert(pref.includes("bert:language"), "22. Language preference key prefix unchanged");
assert(pref.includes("buildLanguagePreferenceKey"), "22. Scoped preference key builder unchanged");

const authService = read("src/services/authService.ts");
assert(
  !authService.includes("i18next") && !authService.includes("react-i18next"),
  "23. Auth service untouched by i18n",
);
assert(app.includes("handleLogin"), "23. Login handler still present");

const statusLabels = read("src/i18n/statusLabels.ts");
assert(
  schedules.includes('field: "frequency"') ||
    schedules.includes('"frequency"') ||
    schedules.includes("onAuditFieldChange"),
  "24. Schedule frequency field name remains English",
);
assert(
  schedules.includes("translateScheduleFrequency") &&
    (statusLabels.includes('case "daily"') || statusLabels.includes('case "weekly"')),
  "24. Frequency display mapping keeps stored codes",
);

const packageJson = JSON.parse(read("package.json"));
assert(Boolean(packageJson.dependencies?.i18next), "25. existing i18next only");
assert(!packageJson.dependencies?.["react-intl"], "25. no second i18n dependency");

// Workbook sheet/column names must not be rewritten in locale files
assert(!enSrc.includes("LOLEREquipment") && !itSrc.includes("CalendarItems"), "25. locales do not redefine sheet names");

assert(
  statusLabels.includes('case "passed_with_observations"') ||
    statusLabels.includes("passed_with_observations"),
  "26. Stored status codes remain English in helpers",
);
assert(enKeys.has("roles.manager") && statusLabels.includes("translateRoleLabel"), "26. Role display helpers present");

const protectedFiles = [
  "server/server.mjs",
  "server/auth-index.mjs",
  "server/user-auth-service.mjs",
  "src/services/authService.ts",
  "src/lib/companyLoginHint.ts",
];
for (const file of protectedFiles) {
  const content = read(file);
  assert(
    !content.includes("i18next") && !content.includes("react-i18next") && !content.includes("useTranslation"),
    `27. protected untouched: ${file}`,
  );
}

assert(Boolean(packageJson.scripts?.["verify:ui-i18n-stage1"]), "28. stage1 verifier still registered");
assert(Boolean(packageJson.scripts?.["verify:ui-i18n-stage2"]), "28. stage2 verifier still registered");
assert(Boolean(packageJson.scripts?.["verify:ui-i18n-stage3"]), "28. stage3 verifier registered");

console.log(`verify:ui-i18n-stage3 passed (${caseCount} checks). Typecheck/build run separately.`);
