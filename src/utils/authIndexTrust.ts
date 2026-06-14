/** Client-side mirror of shared/auth-index-trust.mjs */
export function isKnownStaleAuthIndexPairing(email?: string, companyName?: string): boolean {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(companyName || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedName) {
    return false;
  }
  if (normalizedName.includes("rock solid")) {
    if (normalizedEmail === "dovecotestudio@icloud.com" || normalizedEmail === "7oakcottages@gmail.com") {
      return true;
    }
  }
  return false;
}
