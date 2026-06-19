#!/usr/bin/env node
/**
 * Live/deployed frontend route verification — bundle + build metadata checks.
 * Uses BERT_LIVE_FRONTEND_URL (default https://app.usebert.co.uk) and local dist/ when present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig } from "./lib/live-path-config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function log(line) {
  console.log(`[verify:live-ui-paths] ${line}`);
}

function fail(message) {
  console.error(`FAIL [${caseCount}]: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    fail(message);
  }
}

function bundleSnippet(bundle, needle, radius = 420) {
  const index = bundle.indexOf(needle);
  if (index < 0) return "";
  return bundle.slice(Math.max(0, index - radius), index + radius);
}

async function fetchText(url, timeoutMs = 30_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

async function resolveFrontendBundle(frontendUrl) {
  const index = await fetchText(`${frontendUrl}/`);
  assert(index.status === 200, `frontend index loads (${frontendUrl})`);
  const bundlePath = index.text.match(/\/assets\/index-[^"]+\.js/)?.[0] || "";
  assert(bundlePath, "frontend index references main JS bundle");
  const bundle = await fetchText(`${frontendUrl}${bundlePath}`);
  assert(bundle.status === 200, `frontend bundle loads (${bundlePath})`);
  let buildMeta = null;
  try {
    const meta = await fetchText(`${frontendUrl}/build-meta.json`, 15_000);
    if (meta.status === 200) {
      buildMeta = JSON.parse(meta.text);
    }
  } catch {
    buildMeta = null;
  }
  return { bundlePath, bundleText: bundle.text, buildMeta };
}

function analyzeBundle(bundleText, label) {
  assert(bundleText.includes("/invite/company-user/"), `${label}: company-user invite route present`);
  assert(bundleText.includes("/onboarding/company/"), `${label}: company onboarding route present`);
  assert(bundleText.includes("Create account"), `${label}: Create account CTA present`);
  assert(bundleText.includes("Create workspace"), `${label}: Create workspace CTA present for onboarding`);

  const userInviteSnippet = bundleSnippet(bundleText, "/invite/company-user/");
  assert(userInviteSnippet.length > 0, `${label}: company-user route snippet found`);
  assert(!userInviteSnippet.includes("Create workspace"), `${label}: company-user route must not include Create workspace`);

  assert(
    bundleText.includes("/onboarding/company/") && bundleText.includes("Create workspace"),
    `${label}: company onboarding route and Create workspace CTA both present`,
  );

  assert(!bundleText.includes("resolveInviteFlowFromToken"), `${label}: removed token-shape flow override`);

  const clutterNeedles = ["repair company setup", "Google registry", "sync clutter"];
  for (const needle of clutterNeedles) {
    assert(!bundleText.toLowerCase().includes(needle.toLowerCase()), `${label}: no clutter copy "${needle}"`);
  }
}

async function main() {
  const config = loadLivePathConfig();
  log(`frontend ${config.frontendUrl} | local git ${config.localGitSha || "unknown"}`);

  const deployed = await resolveFrontendBundle(config.frontendUrl);
  log(`deployed bundle ${deployed.bundlePath}`);
  if (deployed.buildMeta?.gitSha) {
    log(`deployed frontend git ${deployed.buildMeta.shortSha || deployed.buildMeta.gitSha} built ${deployed.buildMeta.builtAt || "?"}`);
    if (config.localGitSha && deployed.buildMeta.gitSha !== config.localGitSha) {
      log(
        `WARN: deployed frontend (${deployed.buildMeta.shortSha}) differs from local HEAD (${config.localGitSha.slice(0, 7)}) — redeploy SPA`,
      );
    }
  } else {
    log("WARN: deployed frontend missing /build-meta.json — redeploy SPA after latest build");
  }

  analyzeBundle(deployed.bundleText, "deployed");

  const distIndex = path.join(root, "dist/index.html");
  if (fs.existsSync(distIndex)) {
    const html = fs.readFileSync(distIndex, "utf8");
    const localBundleRel = html.match(/\/assets\/index-[^"]+\.js/)?.[0] || "";
    if (localBundleRel) {
      const localBundlePath = path.join(root, "dist", localBundleRel.replace(/^\//, ""));
      if (fs.existsSync(localBundlePath)) {
        analyzeBundle(fs.readFileSync(localBundlePath, "utf8"), "local-dist");
        log(`local dist bundle ${path.basename(localBundlePath)}`);
      }
    }
    const localMetaPath = path.join(root, "dist/build-meta.json");
    if (fs.existsSync(localMetaPath)) {
      const localMeta = JSON.parse(fs.readFileSync(localMetaPath, "utf8"));
      assert(localMeta.gitSha, "local dist build-meta includes gitSha");
    }
  } else {
    log("SKIP: dist/ not built — run VITE_API_BASE_URL=https://api.usebert.co.uk npm run build");
  }

  log(`OK — ${caseCount} live UI cases passed`);
}

main().catch((error) => {
  console.error("[verify:live-ui-paths] Unhandled error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
