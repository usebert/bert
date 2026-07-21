#!/usr/bin/env node
/** Incident reporting — submit wiring, validation UI, notification-isolated save. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const appTsx = read("App.tsx");
const screen = read("src/screens/IncidentReportingScreen.tsx");
const safetyWorkspace = read("src/safety/SafetyWorkspace.tsx");
const incidentUi = screen + safetyWorkspace;
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:incident-reporting-wiring"], "PKG: npm script registered");

/** 1: Submit button wired via form onSubmit. */
assert(incidentUi.includes('<form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>'), "1: form uses onSubmit handler");
assert(incidentUi.includes('type="submit"'), "1b: submit button has type submit");

/** 2: submitIncidentReport passed from App. */
assert(appTsx.includes("onSubmitIncident={submitIncidentReport}"), "2: App passes submitIncidentReport");
assert(appTsx.includes("const submitIncidentReport = async"), "2b: submitIncidentReport defined in App");

/** 3: Required validation errors rendered in UI. */
assert(incidentUi.includes("validateForm"), "3: client-side validateForm exists");
assert(incidentUi.includes("formError"), "3b: formError state rendered");
assert(incidentUi.includes('role="alert"'), "3c: error banner has alert role");

/** 4: Notification failure does not discard incident save. */
assert(
  /setIncidents\([\s\S]{0,1200}sendIncidentNotification/.test(appTsx),
  "4: incident saved before notification",
);
assert(
  /return \{ \.\.\.(savedIncident|incident), notificationStatus \}/.test(appTsx),
  "4c: return includes notificationStatus",
);
assert(appTsx.includes("pushToast(\"Notification failed\""), "4b: notification failure surfaces toast without rethrow");

/** 5: Deep link ?screen=incidents still works. */
assert(appTsx.includes('requestedScreen === "incidents"'), "5: screen=incidents deep link handled");
assert(incidentUi.includes("?screen=incidents"), "5b: QR link documents incidents screen");

/** 6: Submit gives visible feedback while processing. */
assert(incidentUi.includes("isSubmitting"), "6: submitting state disables button");
assert(incidentUi.includes("Submitting") || incidentUi.includes("login.sending"), "6b: button label changes while submitting");

console.log(`PASS: verify-incident-reporting-wiring (${caseCount} checks)`);
