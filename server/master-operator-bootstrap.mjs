/**
 * Optional startup bootstrap for the platform Master operator (server-only).
 * Enabled only when BERT_MASTER_BOOTSTRAP_ENABLED is truthy.
 */
import { resolvePlatformOwnerEmail, normalizePlatformOwnerEmail } from "../shared/platform-owner.mjs";
import { readMasterStore, upsertMasterOperator } from "./master-auth.mjs";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isTruthyFlag(value) {
  return TRUTHY.has(String(value || "").trim().toLowerCase());
}

function resolveBootstrapEmail(env = process.env) {
  const explicit = normalizePlatformOwnerEmail(env.BERT_MASTER_EMAIL || "");
  if (explicit.includes("@")) {
    return explicit;
  }
  return resolvePlatformOwnerEmail(env);
}

function resolveBootstrapUsername(env = process.env, email = "") {
  return (
    String(env.BERT_MASTER_USERNAME || env.BERT_INITIAL_MASTER_USERNAME || "").trim() ||
    String(email || "").trim()
  );
}

/**
 * @param {string} sessionDir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ran: boolean; reason?: string; email?: string; username?: string; created?: boolean; updated?: boolean }}
 */
export function bootstrapMasterOperatorFromEnv(sessionDir, env = process.env) {
  if (!isTruthyFlag(env.BERT_MASTER_BOOTSTRAP_ENABLED)) {
    return { ran: false, reason: "disabled" };
  }

  const password = String(env.BERT_MASTER_PASSWORD || env.BERT_INITIAL_MASTER_PASSWORD || "").trim();
  if (!password) {
    console.warn("[master-bootstrap] skipped: BERT_MASTER_PASSWORD is not set");
    return { ran: false, reason: "missing_password" };
  }
  if (password.length < 12) {
    console.warn("[master-bootstrap] skipped: BERT_MASTER_PASSWORD must be at least 12 characters");
    return { ran: false, reason: "password_too_short" };
  }

  const email = resolveBootstrapEmail(env);
  if (!email.includes("@")) {
    console.warn("[master-bootstrap] skipped: resolved Master email is invalid");
    return { ran: false, reason: "invalid_email" };
  }

  const username = resolveBootstrapUsername(env, email);
  const store = readMasterStore(sessionDir);
  const existed = store.operators.some(
    (operator) => normalizePlatformOwnerEmail(operator.email) === email,
  );

  upsertMasterOperator({ sessionDir, email, name: username, password });

  console.log(
    `[master-bootstrap] Master operator ${existed ? "updated" : "created"}: ${email} (${username})`,
  );

  return {
    ran: true,
    email,
    username,
    created: !existed,
    updated: existed,
  };
}
