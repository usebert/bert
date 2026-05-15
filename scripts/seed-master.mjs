#!/usr/bin/env node
/**
 * One-time / ops script — NOT bundled into the Vite client or APK.
 * Creates or updates a platform Master operator with a scrypt-hashed password
 * in `.sessions/master-operators.json` (or under **`BERT_SESSIONS_DIR`** when set).
 *
 * Usage:
 *   BERT_MASTER_SEED_SECRET=<same as in .env> node scripts/seed-master.mjs --email ops@example.com --name "Ops User" --password 'choose-strong-password'
 *
 * Requires BERT_MASTER_SEED_SECRET to match process.env.BERT_MASTER_SEED_SECRET (set in shell or .env loaded by dotenv from cwd).
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const requiredSecret = String(process.env.BERT_MASTER_SEED_SECRET || "").trim();
if (!requiredSecret || requiredSecret.length < 16) {
  console.error("ERROR: Set BERT_MASTER_SEED_SECRET in the environment (>= 16 chars). This proves intentional operator access.");
  process.exit(1);
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || !process.argv[idx + 1]) {
    return "";
  }
  return String(process.argv[idx + 1]).trim();
}

const email = arg("--email");
const name = arg("--name") || email;
const password = arg("--password");
const confirm = process.argv.includes("--confirm");

if (!email || !password) {
  console.error("Usage: BERT_MASTER_SEED_SECRET=... node scripts/seed-master.mjs --email you@company.com [--name \"Display\"] --password '...' [--confirm]");
  process.exit(1);
}

if (password.length < 12) {
  console.error("ERROR: Use a password with at least 12 characters.");
  process.exit(1);
}

if (!confirm) {
  console.error("Re-run with --confirm to write the operator record.");
  process.exit(1);
}

const sessionsRootRaw = String(process.env.BERT_SESSIONS_DIR || "").trim();
const sessionDir = sessionsRootRaw ? path.resolve(root, sessionsRootRaw) : path.join(root, ".sessions");
const mod = await import(pathToFileURL(path.join(root, "server/master-auth.mjs")).href);
mod.upsertMasterOperator({ sessionDir, email, name, password });
console.log(`Master operator upserted: ${email} (${name})`);
console.log(`Store: ${path.join(sessionDir, "master-operators.json")}`);
console.log("Sign in via the app using this email and password (server /api/auth/master/login).");
