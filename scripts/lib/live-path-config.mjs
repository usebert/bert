import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSecretsFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function loadLivePathConfig() {
  const secretsFile = String(
    process.env.BERT_LIVE_SECRETS_FILE || path.join(root, "scripts/live-path-secrets.local.json"),
  ).trim();
  const secrets = readSecretsFile(secretsFile);

  const apiBase = String(
    process.env.VITE_API_BASE_URL || process.env.BERT_LIVE_API_BASE_URL || "https://api.usebert.co.uk",
  )
    .trim()
    .replace(/\/$/, "");
  const frontendUrl = String(
    process.env.BERT_LIVE_FRONTEND_URL || process.env.FRONTEND_URL || "https://app.usebert.co.uk",
  )
    .trim()
    .replace(/\/$/, "");

  const pick = (envKey, secretKey, fallback = "") =>
    String(process.env[envKey] || secrets[secretKey] || fallback).trim();

  const testAdminEmail = pick("BERT_LIVE_TEST_ADMIN_EMAIL", "testAdminEmail");
  const testAdminPassword = pick("BERT_LIVE_TEST_ADMIN_PASSWORD", "testAdminPassword");
  const legacyAdminEmail = pick("BERT_LIVE_ADMIN_EMAIL", "adminEmail");
  const legacyAdminPassword = pick("BERT_LIVE_ADMIN_PASSWORD", "adminPassword");

  return {
    root,
    apiBase,
    frontendUrl,
    origin: frontendUrl,
    companyFolderId: pick("BERT_LIVE_COMPANY_FOLDER_ID", "companyFolderId"),
    companyNameHint: pick("BERT_LIVE_COMPANY_NAME", "companyName", ""),
    masterEmail: pick("BERT_LIVE_MASTER_EMAIL", "masterEmail", "admin@usebert.co.uk"),
    masterPassword: pick("BERT_LIVE_MASTER_PASSWORD", "masterPassword"),
    testAdminEmail: testAdminEmail || legacyAdminEmail,
    testAdminPassword: testAdminPassword || legacyAdminPassword,
    secretsFile,
    requireShaMatch: String(process.env.BERT_LIVE_REQUIRE_SHA_MATCH || "").trim() === "1",
    localGitSha: (() => {
      try {
        return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    })(),
  };
}

export function missingLiveCredentials(config) {
  const missing = [];
  if (!config.masterPassword) missing.push("BERT_LIVE_MASTER_PASSWORD");
  if (!config.companyFolderId) missing.push("BERT_LIVE_COMPANY_FOLDER_ID");
  return missing;
}
