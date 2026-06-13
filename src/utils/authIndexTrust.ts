/** Client-side mirror of shared/auth-index-trust.mjs */
export function isKnownStaleAuthIndexPairing(email?: string, companyName?: string): boolean {
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
