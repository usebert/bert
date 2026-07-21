#!/usr/bin/env node
/**
 * Godmode login contract — platform owner uses master-operators.json only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PLATFORM_OWNER_EMAIL,
  isPlatformOwnerEmail,
  normalizePlatformOwnerEmail,
} from "../shared/platform-owner.mjs";
import {
  findOperatorByIdentity,
  hashPassword,
  upsertMasterOperator,
  verifyPassword,
} from "../server/master-auth.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { performCompanyLogin, performMasterLogin } from "../server/auth-service.mjs";
import { bootstrapMasterOperatorFromEnv } from "../server/master-operator-bootstrap.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`[verify:godmode-login] FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function extractExportFunction(source, name) {
  const marker = `export function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}


function runStaticGuards() {
  const authService = read("server/auth-service.mjs");
  const masterAuth = read("server/master-auth.mjs");
  const serverMain = read("server/server.mjs");
  const authIndex = read("server/auth-index.mjs");
  const resetModule = read("server/company-user-reset.mjs");
  const appTsx = read("App.tsx");
  const permissions = read("src/permissions.ts");
  const roleBanners = read("src/config/roleBanners.ts");
  const pkg = JSON.parse(read("package.json"));

  assert(pkg.scripts["verify:godmode-login"], "npm script verify:godmode-login registered");
  assert(authService.includes("export function performMasterLogin"), "performMasterLogin exported");
  assert(authService.includes("master-operators only") || authService.includes("findOperatorByIdentity"), "master login uses master-operators");
  const performMasterLoginSrc = extractExportFunction(authService, "performMasterLogin");
  assert(!performMasterLoginSrc.includes("authIndex.lookupByEmail"), "performMasterLogin does not read auth index");
  assert(!performMasterLoginSrc.includes("readCompanyUsersTabRecord"), "performMasterLogin does not read Users tab");
  assert(masterAuth.includes("performMasterLogin"), "master login route delegates to performMasterLogin");
  assert(
    serverMain.includes("isPlatformOwnerEmail(loginIdentity") && serverMain.includes("performMasterLogin"),
    "company login route checks platform owner first and routes to master auth",
  );
  assert(
    authService.includes("Platform owner must use master auth"),
    "performCompanyLogin rejects platform owner with master-only message",
  );
  assert(authIndex.includes("isPlatformOwnerAuthIndexEmail"), "auth index skips platform owner emails");
  assert(authIndex.includes("isPlatformOwnerEmail"), "auth index imports platform owner guard");
  assert(resetModule.includes("isPlatformOwnerEmail"), "user reset skips platform owner");
  assert(!resetModule.includes("master-operators"), "user reset does not touch master-operators.json");
  assert(appTsx.includes("platformOwnerLogin") && appTsx.includes("tryServerMasterLogin"), "client routes platform owner to master login");
  assert(appTsx.includes("!isPlatformOwnerEmail(session.user.email"), "client skips company session restore for platform owner");
  assert(permissions.includes("BERT Platform Owner"), "Master role displays as BERT Platform Owner");
  assert(roleBanners.includes("Signed in as BERT Platform Owner"), "role banner copy for Godmode");
  assert(appTsx.includes("/api/auth/master/login"), "client calls server master login API");
  assert(!appTsx.includes("VITE_GODMODE_PASSWORD"), "client bundle does not reference VITE_GODMODE_PASSWORD");
  assert(read("server/master-operator-bootstrap.mjs").includes("BERT_MASTER_BOOTSTRAP_ENABLED"), "master bootstrap env gate exists");
  assert(serverMain.includes("bootstrapMasterOperatorFromEnv"), "server startup runs master bootstrap");
  assert(pkg.scripts["reset:master-password"], "reset:master-password script registered");
}

async function runUnitChecks() {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "bert-godmode-login-"));
  const password = "godmode-test-password-12";
  const platformEmail = DEFAULT_PLATFORM_OWNER_EMAIL;

  upsertMasterOperator({
    sessionDir,
    email: platformEmail,
    name: "BERT Platform Owner",
    password,
  });

  const authIndex = createAuthIndexApi(path.join(sessionDir, "auth-index.json"));
  authIndex.upsertEntry({
    email: platformEmail,
    name: "Stale Platform Row",
    role: "Admin",
    companyFolderId: "should-not-use",
    masterSheetId: "should-not-use",
    status: "ACTIVE",
    passwordHash: hashPassword("wrong-password-12"),
  });
  assert(authIndex.lookupByEmail(platformEmail) === null, "auth index never returns platform owner entry");

  const masterOk = performMasterLogin(
    { sessionDir, findOperatorByIdentity, verifyPassword, upsertMasterOperator },
    { email: "  Admin@USEBERT.co.uk  ", password },
  );
  assert(masterOk.ok === true, "performMasterLogin accepts normalized platform owner email");
  assert(masterOk.email === normalizePlatformOwnerEmail(platformEmail), "master session email normalized");
  const session = JSON.parse(masterOk.sessionPayload || "{}");
  assert(!session.companyId && !session.companyFolderId, "Godmode session has no company until selected");

  const masterBad = performMasterLogin(
    { sessionDir, findOperatorByIdentity, verifyPassword, upsertMasterOperator },
    { email: platformEmail, password: "wrong-password-12" },
  );
  assert(masterBad.ok === false && masterBad.httpStatus === 401, "wrong master password rejected");

  const disabledBootstrap = bootstrapMasterOperatorFromEnv(sessionDir, { BERT_MASTER_BOOTSTRAP_ENABLED: "false" });
  assert(disabledBootstrap.ran === false, "bootstrap skipped when disabled");

  const enabledBootstrap = bootstrapMasterOperatorFromEnv(sessionDir, {
    BERT_MASTER_BOOTSTRAP_ENABLED: "true",
    BERT_MASTER_EMAIL: platformEmail,
    BERT_MASTER_USERNAME: "bootstrap-user",
    BERT_MASTER_PASSWORD: "bootstrap-password-12",
  });
  assert(enabledBootstrap.ran === true, "bootstrap runs when explicitly enabled");
  assert(enabledBootstrap.email === platformEmail, "bootstrap uses configured email");

  const companyBlocked = await performCompanyLogin(null, {
    email: platformEmail,
    password,
    authIndex,
    isPlatformOwner: isPlatformOwnerEmail,
  });
  assert(
    companyBlocked.ok === false && companyBlocked.blocker === "platform_owner_master_only",
    "performCompanyLogin blocks platform owner from company auth index",
  );
}

runStaticGuards();
await runUnitChecks();
console.log(`[verify:godmode-login] OK — ${caseCount} contract cases passed`);
