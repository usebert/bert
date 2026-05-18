#!/usr/bin/env node
/** Mirrors src/utils/pilotReadiness.ts — keep in sync. */

function evaluatePilotReadiness(input) {
  const checks = [
    { id: "api", ok: input.apiOnline },
    { id: "google", ok: input.googleConfigured && input.googleConnected },
    { id: "drive", ok: input.sharedDriveConfigured },
    { id: "sessions", ok: input.sessionStoreWritable },
    { id: "appApi", ok: input.appApiConfigured },
    { id: "inviteEmail", ok: input.smtpOk },
  ];
  const pilotReady =
    input.apiOnline &&
    input.ready &&
    input.sessionStoreWritable &&
    input.googleConfigured &&
    input.googleConnected &&
    input.sharedDriveConfigured &&
    input.appApiConfigured;
  return {
    pilotReady,
    headline: pilotReady ? "BERT is ready for pilot" : "BERT needs setup",
    checks,
  };
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

const ready = evaluatePilotReadiness({
  apiOnline: true,
  ready: true,
  sessionStoreWritable: true,
  googleConfigured: true,
  googleConnected: true,
  sharedDriveConfigured: true,
  smtpOk: true,
  appApiConfigured: true,
});

assert(ready.pilotReady === true, "expected pilot ready");
assert(ready.headline === "BERT is ready for pilot", "ready headline");

const needsSetup = evaluatePilotReadiness({
  apiOnline: true,
  ready: true,
  sessionStoreWritable: true,
  googleConfigured: false,
  googleConnected: false,
  sharedDriveConfigured: false,
  smtpOk: false,
  appApiConfigured: true,
});

assert(needsSetup.pilotReady === false, "expected not ready");
assert(needsSetup.headline === "BERT needs setup", "needs setup headline");

console.log("[verify:pilot-readiness] OK");
