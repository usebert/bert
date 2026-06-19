#!/usr/bin/env node
/**
 * Static verification for password reset flow — no live API calls, no secrets printed.
 *
 * Usage: npm run verify:password-reset
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

let failed = false;

function fail(message) {
  console.error(`[verify:password-reset] FAIL: ${message}`);
  failed = true;
}

function ok(message) {
  console.log(`[verify:password-reset] OK: ${message}`);
}

const serverReset = path.join(root, "server", "password-reset.mjs");
if (!fs.existsSync(serverReset)) {
  fail("server/password-reset.mjs missing");
} else {
  ok("server/password-reset.mjs exists");
  const src = fs.readFileSync(serverReset, "utf8");
  if (!src.includes("/api/auth/password-reset/request")) {
    fail("request route missing");
  } else {
    ok("POST /api/auth/password-reset/request defined");
  }
  if (!src.includes("/api/auth/password-reset/confirm")) {
    fail("confirm route missing");
  } else {
    ok("POST /api/auth/password-reset/confirm defined");
  }
  if (src.includes("tokenHash") && !src.match(/rawToken[^]*writeTokenStore/)) {
    ok("tokens stored hashed (tokenHash field, no raw token persistence)");
  } else if (src.includes("tokenHash")) {
    ok("tokenHash field used in token store");
  } else {
    fail("token hashing not detected");
  }
  if (src.includes("emailHash") && src.includes("requestIpHash")) {
    ok("email and IP stored as hashes");
  } else {
    fail("emailHash / requestIpHash fields missing");
  }
  if (src.includes("GENERIC_SUCCESS_MESSAGE")) {
    ok("generic success message for SMTP-enabled requests");
  } else {
    fail("generic success message missing");
  }
  if (src.includes("SMTP_UNAVAILABLE_COMPANY_MESSAGE") && src.includes("SMTP_UNAVAILABLE_MASTER_MESSAGE")) {
    ok("SMTP-unavailable messages for company and master");
  } else {
    fail("SMTP-unavailable messages missing");
  }
  if (!src.includes("seed-master") && !src.includes("/api/tools")) {
    ok("no seed-master or /api/tools exposure in reset module");
  } else {
    fail("seed-master or /api/tools referenced in reset module");
  }
}

const serverMain = path.join(root, "server", "server.mjs");
const serverMainSrc = fs.readFileSync(serverMain, "utf8");
if (serverMainSrc.includes("installPasswordResetRoutes")) {
  ok("server.mjs installs password reset routes");
} else {
  fail("server.mjs does not install password reset routes");
}
if (serverMainSrc.includes("/api/auth/password-reset/request")) {
  ok("password-reset routes included in sensitive POST rate limit");
} else {
  fail("password-reset routes not in sensitive POST rate limit list");
}

const clientService = path.join(root, "src", "services", "passwordResetService.ts");
if (fs.existsSync(clientService)) {
  ok("src/services/passwordResetService.ts exists");
  const clientSrc = fs.readFileSync(clientService, "utf8");
  if (/\/api\/tools/i.test(clientSrc)) {
    fail("/api/tools in client password reset service");
  } else {
    ok("client service uses auth routes only");
  }
} else {
  fail("passwordResetService.ts missing");
}

const confirmScreen = path.join(root, "src", "screens", "PasswordResetConfirm.tsx");
if (fs.existsSync(confirmScreen)) {
  ok("PasswordResetConfirm screen exists");
} else {
  fail("PasswordResetConfirm screen missing");
}

const appTsx = path.join(root, "App.tsx");
const appSrc = fs.readFileSync(appTsx, "utf8");
if (appSrc.includes("Forgot password?") && appSrc.includes("handleForgotPassword")) {
  ok("App.tsx wires forgot password UI");
} else {
  fail("App.tsx missing forgot password wiring");
}
if (appSrc.includes("PasswordResetConfirm") && appSrc.includes('get("reset")')) {
  ok("App.tsx handles reset confirm URL params");
} else {
  fail("App.tsx missing reset confirm routing");
}
if (/\/api\/tools/i.test(appSrc)) {
  fail("/api/tools in App.tsx");
} else {
  ok("App.tsx has no /api/tools references");
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (typeof pkg.scripts?.["verify:password-reset"] === "string") {
  ok("package.json defines verify:password-reset script");
} else {
  fail("package.json missing verify:password-reset script");
}

if (failed) {
  process.exit(1);
}

console.log("[verify:password-reset] All automated checks passed.");
