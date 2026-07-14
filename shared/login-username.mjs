/**
 * Shared login identity helpers — email and username (case-insensitive, trimmed).
 * Used by server auth, auth-index, Users tab matching, and demos.
 */

export function normalizeLoginIdentity(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

/** Compact username key: trim, lower, strip internal spaces. */
export function normalizeUsername(value) {
  return normalizeLoginIdentity(value).replace(/\s+/g, "");
}

export function isLoginEmailIdentity(value) {
  const normalized = normalizeLoginIdentity(value);
  return normalized.includes("@") && normalized.length > 3 && !/\s/.test(normalized);
}

/**
 * Derive a username from an email address.
 * bert.demo+joe.jones@usebert.co.uk → joe.jones
 * joe.jones@company.com → joe.jones
 */
export function deriveUsernameFromEmail(email) {
  if (!isLoginEmailIdentity(email)) {
    return "";
  }
  const local = normalizeLoginIdentity(email).split("@")[0] || "";
  const plus = local.indexOf("+");
  if (plus >= 0 && plus < local.length - 1) {
    return normalizeUsername(local.slice(plus + 1));
  }
  return normalizeUsername(local);
}

/**
 * Resolve stored Username or derive from email when blank.
 */
export function resolveUsernameFromUserFields({ username = "", email = "" } = {}) {
  const stored = normalizeUsername(username);
  if (stored && !stored.includes("@")) {
    return stored;
  }
  return deriveUsernameFromEmail(email);
}
