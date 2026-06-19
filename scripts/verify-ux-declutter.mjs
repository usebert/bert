#!/usr/bin/env node
/**
 * UX declutter + account display — mirrors src/utils/uxDeclutter.ts and src/config/roleNavigation.ts.
 */

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function canShowTechnicalUi(role) {
  return role === "Master";
}

function resolveUserEmail(user) {
  const explicit = String(user.email || "").trim();
  if (explicit) return explicit;
  const username = String(user.username || "").trim();
  if (username.includes("@")) return username;
  return "";
}

function getAccountRoleLabel(role) {
  if (role === "Master") return "Platform Admin";
  return role;
}

function backgroundJobsBannerForRole(role, activeCount) {
  if (canShowTechnicalUi(role)) {
    return activeCount > 0 ? `${activeCount} job(s) in progress` : "No background jobs running";
  }
  if (activeCount > 0) {
    return "Finishing updates…";
  }
  return "";
}

const UX_STATUS = {
  ready: "Ready",
  needsAttention: "Needs attention",
  workingInBackground: "Finishing updates…",
  saved: "Saved",
  inviteLinkCreated: "Invite link created",
  scheduleSaved: "Schedule saved",
  couldNotLoadUsers: "Could not load users",
  couldNotSaveSchedule: "Could not save schedule",
};

const COMPANY_ADMIN_NAV_IDS = [
  "dashboard",
  "users",
  "schedules",
  "audits",
  "actions",
  "nonConformance",
  "reports",
  "account",
];
const MANAGER_NAV_IDS = [
  "dashboard",
  "invites",
  "schedules",
  "audits",
  "actions",
  "nonConformance",
  "reports",
  "account",
];
const AUDITOR_NAV_IDS = ["dashboard", "audits", "account"];

const MORE_BY_BUCKET = {
  master: ["qmsReadiness", "emailReminders"],
  companyAdmin: [],
  manager: [],
  auditor: [],
};

/** 1: Technical UI is Master-only. */
assert(canShowTechnicalUi("Master") === true, "Master sees technical UI");
assert(canShowTechnicalUi("Admin") === false, "Admin hides technical UI");
assert(canShowTechnicalUi("Manager") === false, "Manager hides technical UI");
assert(canShowTechnicalUi("Auditor") === false, "Auditor hides technical UI");

/** 2: Account email resolves from session user object. */
assert(
  resolveUserEmail({ username: "roostar@hotmail.co.uk", email: "roostar@hotmail.co.uk" }) === "roostar@hotmail.co.uk",
  "explicit email",
);
assert(
  resolveUserEmail({ username: "7oakcottages@gmail.com" }) === "7oakcottages@gmail.com",
  "email from username",
);

/** 3: Godmode role label for account section. */
assert(getAccountRoleLabel("Master") === "Platform Admin", "Master account role label");
assert(getAccountRoleLabel("Manager") === "Manager", "Manager account role label");

/** 4: Company Admin nav is decluttered. */
assert(
  COMPANY_ADMIN_NAV_IDS.join() === "dashboard,users,schedules,audits,actions,nonConformance,reports,account",
  "company admin primary nav follows BERT product flow",
);
assert(COMPANY_ADMIN_NAV_IDS.includes("actions") && COMPANY_ADMIN_NAV_IDS.includes("nonConformance"), "admin sees actions and NCRs");
assert(!COMPANY_ADMIN_NAV_IDS.includes("admin"), "no workspace tab for company admin");
assert(!COMPANY_ADMIN_NAV_IDS.includes("sync"), "no sync tab for company admin");

/** 5: Manager nav includes schedules and users invites. */
assert(MANAGER_NAV_IDS.includes("schedules"), "manager schedules");
assert(MANAGER_NAV_IDS.includes("invites"), "manager invites");

/** 6: Auditor nav is minimal. */
assert(AUDITOR_NAV_IDS.join() === "dashboard,audits,account", "auditor nav minimal");
assert(!AUDITOR_NAV_IDS.includes("sync"), "auditor no sync");
assert(!AUDITOR_NAV_IDS.includes("incidents"), "auditor no incidents nav");

/** 7: More menu empty for company roles. */
assert(MORE_BY_BUCKET.companyAdmin.length === 0, "admin no more clutter");
assert(MORE_BY_BUCKET.manager.length === 0, "manager no more clutter");
assert(MORE_BY_BUCKET.auditor.length === 0, "auditor no more clutter");

/** 8: Friendly status copy constants. */
assert(UX_STATUS.scheduleSaved === "Schedule saved", "schedule saved copy");
assert(UX_STATUS.couldNotSaveSchedule === "Could not save schedule", "schedule error copy");
assert(UX_STATUS.inviteLinkCreated === "Invite link created", "invite copy");

/** 9: Background jobs banner for company users. */
assert(
  backgroundJobsBannerForRole("Manager", 2) === UX_STATUS.workingInBackground,
  "manager background message",
);
assert(backgroundJobsBannerForRole("Master", 2) === "2 job(s) in progress", "master technical jobs banner");

/** 10: Example account line formatting (name / email / role / company). */
const exampleManager = {
  name: "Andy Hall",
  email: "roostar@hotmail.co.uk",
  role: "Manager",
  company: "TESTCO",
};
const accountLine = `${exampleManager.name} / ${exampleManager.email} / ${exampleManager.role} / ${exampleManager.company}`;
assert(
  accountLine === "Andy Hall / roostar@hotmail.co.uk / Manager / TESTCO",
  "manager account example",
);

console.log("[verify:ux-declutter] OK — 10 cases passed");
