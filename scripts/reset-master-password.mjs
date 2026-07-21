#!/usr/bin/env node
/**
 * Reset the platform Master operator password without printing the password or hash.
 *
 * Usage:
 *   BERT_MASTER_SEED_SECRET=... BERT_MASTER_PASSWORD='new-strong-password' \
 *     node scripts/reset-master-password.mjs --email admin@usebert.co.uk --confirm
 *
 * Or pass --password (never echoed). Password may also come from BERT_MASTER_PASSWORD in .env.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizePlatformOwnerEmail } from "../shared/platform-owner.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const requiredSecret = String(process.env.BERT_MASTER_SEED_SECRET || "").trim();
if (!requiredSecret || requiredSecret.length < 16) {
  console.error("ERROR: Set BERT_MASTER_SEED_SECRET in the environment (>= 16 chars).");
  process.exit(1);
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || !process.argv[idx + 1]) {
    return "";
  }
  return String(process.argv[idx + 1]).trim();
}

const email = normalizePlatformOwnerEmail(
  arg("--email") ||
    String(process.env.BERT_MASTER_EMAIL || process.env.BERT_INITIAL_MASTER_EMAIL || "").trim(),
);
const username =
  arg("--username") ||
  arg("--name") ||
  String(process.env.BERT_MASTER_USERNAME || process.env.BERT_INITIAL_MASTER_USERNAME || "").trim();
const password = arg("--password") || String(process.env.BERT_MASTER_PASSWORD || "").trim();
const confirm = process.argv.includes("--confirm");

if (!email.includes("@")) {
  console.error("Usage: BERT_MASTER_SEED_SECRET=... node scripts/reset-master-password.mjs --email you@company.com [--username Display] [--password '...'] --confirm");
  process.exit(1);
}

if (!password) {
  console.error("ERROR: Provide --password or set BERT_MASTER_PASSWORD in the environment.");
  process.exit(1);
}

if (password.length < 12) {
  console.error("ERROR: Password must be at least 12 characters.");
  process.exit(1);
}

if (!confirm) {
  console.error("Re-run with --confirm to update the Master operator password.");
  process.exit(1);
}

const sessionsRootRaw = String(process.env.BERT_SESSIONS_DIR || "").trim();
const sessionDir = sessionsRootRaw ? path.resolve(root, sessionsRootRaw) : path.join(root, ".sessions");
const mod = await import(pathToFileURL(path.join(root, "server/master-auth.mjs")).href);
const displayName = username || email;
const result = mod.upsertMasterOperator({ sessionDir, email, name: displayName, password });
console.log(`Master password updated for ${result.email} (${result.name}).`);
console.log(`Store: ${mod.masterOperatorsFilePath(sessionDir)}`);
