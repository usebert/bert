/**
 * Reflecting CORS for credentialed browser/Capacitor clients. `Access-Control-Allow-Origin`
 * is never `*` when credentials are allowed — set `BERT_ALLOWED_ORIGINS` to a comma-separated
 * list of exact origins (e.g. `https://app.usebert.co.uk,capacitor://localhost`).
 */

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_ALLOW_HEADERS =
  "Content-Type, X-Bert-Tool-Secret, X-Bert-Dev-User-Role, X-Bert-Dev-User-Email, X-Bert-Dev-User-Name";

/** @returns {string[]} */
export function parseBERTAllowedOrigins() {
  const raw = String(process.env.BERT_ALLOWED_ORIGINS || "").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Handles OPTIONS preflight (204) and sets ACAO + credentials for allowed Origins on other methods.
 * Register **before** JSON body parser and auth routes so preflight never hits auth middleware.
 */
export function bertCorsMiddleware(req, res, next) {
  const allowed = parseBERTAllowedOrigins();
  const origin = String(req.headers.origin || "").trim();
  const allow = Boolean(origin && allowed.includes(origin));

  if (req.method === "OPTIONS") {
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
      res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
      res.setHeader("Access-Control-Max-Age", "86400");
      res.setHeader("Vary", "Origin");
    }
    return res.status(204).end();
  }

  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  next();
}
