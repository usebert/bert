/**
 * Guards against known-bad auth index / session company pairings from legacy registry bugs.
 */

export function isKnownStaleAuthIndexPairing(email, companyName) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(companyName || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedName) {
    return false;
  }
  if (normalizedEmail === "dovecotestudio@icloud.com" && normalizedName.includes("rock solid")) {
    return true;
  }
  return false;
}
