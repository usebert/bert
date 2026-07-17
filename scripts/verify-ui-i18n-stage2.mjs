#!/usr/bin/env node
/**
 * verify:ui-i18n-stage2 — LOLER, Calendar, Messages, Audits, Briefings,
 * Incidents, NCRs, Reports UI localisation (presentation only).
 * Auth/login/session/OAuth/company-resolution remain untouched.
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

assert(enKeys.size > 0 && enKeys.size === itKeys.size, "EN/IT key counts match");
for (const key of enKeys) {
  if (!itKeys.has(key)) {
    assert(false, `Italian missing key: ${key}`);
  }
}
assert(true, "every English key has an Italian counterpart");

const requiredKeys = [
  "loler.equipmentRegister",
  "loler.recordExamination",
  "loler.examinationHistory",
  "loler.result.passedWithObservations",
  "loler.result.failed",
  "calendar.month",
  "calendar.agenda",
  "calendar.addEvent",
  "calendar.markComplete",
  "messages.inbox",
  "messages.markAsRead",
  "audits.centre",
  "audits.startAudit",
  "audits.submitAudit",
  "briefings.acknowledge",
  "briefings.pending",
  "incidents.reportIncident",
  "incidents.nearMiss",
  "ncrs.rootCause",
  "ncrs.closeNcr",
  "reports.export",
  "reports.dateRange",
  "status.outOfService",
  "status.dueSoonLabel",
];
for (const key of requiredKeys) {
  assert(enKeys.has(key) && itKeys.has(key), `required key present: ${key}`);
}

assert(itSrc.includes("Registro attrezzature"), "Italian LOLER register label");
assert(itSrc.includes("Superato con osservazioni"), "Italian examination result label");
assert(itSrc.includes("Centro audit"), "Italian Audit Centre label");
assert(itSrc.includes("Comunicazioni"), "Italian Briefings nav/title");
assert(itSrc.includes("Rapporto di non conformità"), "Italian NCR report label");

const statusLabels = read("src/i18n/statusLabels.ts");
assert(
  statusLabels.includes("passed_with_observations") &&
    statusLabels.includes('t("loler.result.passedWithObservations")'),
  "examination result display mapping (stored code unchanged)",
);
assert(
  statusLabels.includes("out_of_service") && statusLabels.includes('t("status.outOfService")'),
  "out_of_service display mapping (stored code unchanged)",
);
assert(
  statusLabels.includes("due_soon") && statusLabels.includes('t("status.dueSoonLabel")'),
  "due_soon display mapping (stored code unchanged)",
);

const lolerScreen = read("src/screens/LolerScreen.tsx");
assert(lolerScreen.includes("useTranslation"), "1. LOLER screen uses translations");
assert(lolerScreen.includes('t("loler.equipmentRegister")'), "1. LOLER register label key");
assert(lolerScreen.includes("translateLolerComplianceStatus"), "1. LOLER status display helper");

const examForm = read("src/components/loler/RecordExaminationForm.tsx");
assert(examForm.includes("useTranslation"), "2. Record examination form translated");
assert(examForm.includes('t("loler.saveExamination")'), "2. Save examination key");
assert(examForm.includes('t("loler.examinationDate")'), "2. Examination date key");

const examHistory = read("src/components/loler/ExaminationHistory.tsx");
assert(
  examHistory.includes("translateLolerExaminationResult") ||
    examHistory.includes('t("loler.result.'),
  "3. Examination result labels translated",
);

const calendarScreen = read("src/screens/CalendarScreen.tsx");
const calendarFilters = read("src/components/calendar/CalendarFilters.tsx");
assert(calendarScreen.includes("useTranslation"), "4. Calendar screen translated");
assert(
  calendarFilters.includes('t("calendar.month")') && calendarFilters.includes('t("calendar.agenda")'),
  "4. Calendar month/agenda labels",
);

const calendarForm = read("src/components/calendar/CalendarItemForm.tsx");
assert(calendarForm.includes("useTranslation"), "5. Calendar form translated");
assert(
  calendarForm.includes('t("calendar.titleLabel")') || calendarForm.includes('t("calendar.allDay")'),
  "5. Calendar form field labels",
);

const messagesScreen = read("src/screens/MessagesScreen.tsx");
const messageDetails = read("src/components/messages/MessageDetails.tsx");
assert(messagesScreen.includes("useTranslation"), "6. Messages inbox translated");
assert(
  messageDetails.includes('t("messages.markAsRead")') ||
    messageDetails.includes('t("messages.markRead")'),
  "6. Message details actions translated",
);

const auditCentre = read("src/screens/AuditCentreScreen.tsx");
const auditsScreen = read("src/screens/AuditsScreen.tsx");
assert(auditCentre.includes('t("audits.centre")') || auditCentre.includes("useTranslation"), "7. Audit Centre translated");
assert(auditsScreen.includes("useTranslation"), "7. Audits screen translated");

const briefings = read("src/screens/BriefingsScreen.tsx");
assert(briefings.includes("useTranslation"), "8. Briefings fixed UI translated");
assert(
  briefings.includes('t("briefings.acknowledge")') || briefings.includes('t("briefings.title")'),
  "8. Briefings labels use keys",
);

const incidents = read("src/screens/IncidentReportingScreen.tsx");
assert(incidents.includes("useTranslation"), "9. Incidents fixed UI translated");
assert(
  incidents.includes('t("incidents.reportIncident")') ||
    incidents.includes('t("incidents.nearMiss")') ||
    incidents.includes('t("incidents.title")'),
  "9. Incident labels use keys",
);

const ncrs = read("src/screens/NonConformanceScreen.tsx");
assert(ncrs.includes("useTranslation"), "10. NCR fixed UI translated");
assert(
  ncrs.includes('t("ncrs.rootCause")') || ncrs.includes('t("ncrs.title")'),
  "10. NCR labels use keys",
);

const reports = read("src/screens/ReportsScreen.tsx");
assert(reports.includes("useTranslation"), "11. Reports fixed UI translated");
assert(
  reports.includes('t("reports.createReport")') || reports.includes('t("reports.title")'),
  "11. Reports labels use keys",
);

// Stored status values / API payloads must remain English codes in helpers and forms
assert(
  statusLabels.includes('case "passed_with_observations"') ||
    statusLabels.includes('case "passed_with_observations":'),
  "12. Stored examination result code still matched as English snake_case",
);
assert(
  !examForm.includes('value: "Superato"') && examForm.includes("passed_with_observations"),
  "12. Examination form still submits English result codes",
);

const calendarItemForm = read("src/components/calendar/CalendarItemForm.tsx");
assert(
  calendarItemForm.includes('value="event"') || calendarItemForm.includes('value: "event"') ||
    calendarItemForm.includes('"event"'),
  "13. Calendar type API values remain English",
);

assert(
  !lolerScreen.includes("t(equipment.name") && !lolerScreen.includes("t(row."),
  "14. User-entered / row data not passed through t()",
);
assert(
  !briefings.includes("t(briefing.") && !briefings.includes("t(selected."),
  "14. Briefing content not translated via t()",
);

assert(
  !lolerScreen.includes('t("company') && lolerScreen.includes("useTranslation"),
  "15. Company/site names not force-translated via company keys on LOLER",
);

assert(enSrc.includes('fallbackLng') === false, "16. locales are dictionaries (fallback configured elsewhere)");
const i18nInit = read("src/i18n/index.ts");
const types = read("src/i18n/types.ts");
assert(
  i18nInit.includes("fallbackLng: DEFAULT_LANGUAGE") && types.includes('DEFAULT_LANGUAGE: SupportedLanguage = "en"'),
  "16. Missing Italian keys fall back to English",
);

const navLogic = read("src/config/roleNavigation.ts");
assert(navLogic.includes('label: "People"'), "17. Navigation English permission labels intact");
const app = read("App.tsx");
assert(app.includes("translateNavLabel"), "17. Stage 1 nav translation still wired");
assert(app.includes("LanguageSelector"), "17. Stage 1 language selector still present");

const authService = read("src/services/authService.ts");
assert(
  !authService.includes("i18next") && !authService.includes("react-i18next"),
  "18. Auth service untouched by i18n",
);
assert(app.includes("void handleLogin()") || app.includes("handleLogin("), "18. Login submit path intact");

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
    `19. protected untouched: ${file}`,
  );
}

const packageJson = JSON.parse(read("package.json"));
assert(Boolean(packageJson.dependencies?.i18next), "20. still uses existing i18next");
assert(Boolean(packageJson.dependencies?.["react-i18next"]), "20. still uses existing react-i18next");
assert(!packageJson.dependencies?.["react-intl"], "20. no second i18n dependency");

const pref = read("src/i18n/languagePreference.ts");
assert(pref.includes("bert:language"), "no second preference key introduced (same prefix)");

console.log(`verify:ui-i18n-stage2 passed (${caseCount} checks).`);
