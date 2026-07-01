/**
 * Foundation verifier test-user markers — shared by verifiers, UI filters, and cleanup.
 */
import {
  FOUNDATION_VERIFY_EMAIL_DOMAIN,
  FOUNDATION_VERIFY_EMAIL_LOCAL_PREFIX,
  isFoundationVerifyUserEmail,
} from "./schedule-assignees.mjs";

export {
  FOUNDATION_VERIFY_EMAIL_DOMAIN,
  FOUNDATION_VERIFY_EMAIL_LOCAL_PREFIX,
  isFoundationVerifyUserEmail,
};

export const FOUNDATION_VERIFY_USER_NAME = "Foundation Verify User";

/** Never deactivate or delete during foundation-verify cleanup. */
export const FOUNDATION_VERIFY_PROTECTED_EMAILS = new Set([
  "dovecotestudio@icloud.com",
  "7oakcottages@gmail.com",
]);

/**
 * Rows safe to remove from a live Users tab after foundation verifier pollution.
 * Matches verify.foundation+@usebert.co.uk and/or exact verifier display name.
 */
export function isFoundationVerifyPollutionTarget(email, name = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (FOUNDATION_VERIFY_PROTECTED_EMAILS.has(normalizedEmail)) {
    return false;
  }
  const normalizedName = String(name || "").trim();
  return (
    isFoundationVerifyUserEmail(normalizedEmail) ||
    normalizedName === FOUNDATION_VERIFY_USER_NAME
  );
}
