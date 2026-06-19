/**
 * Options for httpOnly signed BERT session cookies (`bert_master_session`, `bert_company_session`).
 *
 * **SameSite=None requires Secure.** In production (or when `BERT_COOKIE_SAMESITE_NONE=true`),
 * cookies are `SameSite=None; Secure` so they are sent on cross-site XHR/fetch to the API
 * (e.g. SPA on `https://app…` calling `https://api…`, or Capacitor WebView). Browsers only
 * attach `Secure` cookies over HTTPS — the API must be served over TLS in those modes.
 *
 * @param {Record<string, unknown>} [extra] Merged last (e.g. `{ maxAge }` for `res.cookie`).
 * @returns {Record<string, unknown>}
 */
export function getSessionCookieOptions(extra = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const forceCrossSite = String(process.env.BERT_COOKIE_SAMESITE_NONE || "").trim() === "true";
  const crossSite = isProduction || forceCrossSite;
  return {
    httpOnly: true,
    signed: true,
    path: "/",
    ...(crossSite ? { secure: true, sameSite: "none" } : { secure: false, sameSite: "lax" }),
    ...extra,
  };
}
