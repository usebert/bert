/**
 * BERT platform owner identity — shared between API server and Vite client.
 * Email is not secret; password hashes live only in master-operators.json (server).
 */
export const DEFAULT_PLATFORM_OWNER_EMAIL = "admin@usebert.co.uk";

/** @param {string} email */
export function normalizePlatformOwnerEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolvePlatformOwnerEmail(env = {}) {
  const raw = String(env.PLATFORM_OWNER_EMAIL ?? env.VITE_PLATFORM_OWNER_EMAIL ?? "")
    .trim()
    .toLowerCase();
  return raw || DEFAULT_PLATFORM_OWNER_EMAIL;
}

/**
 * @param {string} email
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isPlatformOwnerEmail(email, env = {}) {
  const norm = normalizePlatformOwnerEmail(email);
  if (!norm.includes("@")) {
    return false;
  }
  return norm === resolvePlatformOwnerEmail(env);
}
