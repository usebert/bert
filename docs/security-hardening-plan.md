# BERT security hardening plan (paid pilot → public launch)

This document describes **current auth risks**, what the **minimum hardening pass** in `server/server.mjs` improves, and what **must still be designed** before public self-serve. It complements **`docs/deployment-runbook.md`** and **`docs/production-launch-checklist.md`**.

---

## 1. Current auth risks (summary)

| Area | Risk |
|------|------|
| **SPA sign-in** | Password checks for **sheet-backed company users** run on the API (`/api/auth/company/login`); Master uses `/api/auth/master/login`. Demo/god-mode remains **dev-only** (`import.meta.env.DEV` or `VITE_ENABLE_DEMO_LOGIN`). **localStorage** still holds workspace JSON and a minimal user profile (password field cleared when using server sessions). |
| **Sheet-backed passwords** | `UserAuth.<email>` values in Google Sheets **Config** are **scrypt hashes** (Node `crypto.scrypt`, same format as Master operators). Legacy plaintext rows are upgraded on **successful login** or via **`npm run migrate:userauth`** / `POST /api/tools/migrate-userauth-passwords` (tool secret + API Google session). Sheet API responses **strip** `UserAuth.*` values before JSON to the SPA. |
| **API identity** | Most mutating routes trust the **single Google OAuth session** stored on the API host, not an authenticated **human** identity per request. |
| **Abuse surface** | Historically unauthenticated **POST** helpers could send email or mint invites if the API was exposed to the open internet. |

---

## 2. What this pass hardens (server)

- **Security headers** on all responses: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Powered-By` disabled; **HSTS** when `NODE_ENV=production` and `X-Forwarded-Proto: https`.
- **JSON body limit** (`512kb`) to reduce oversized-body abuse.
- **Request logging** (method, path, status, duration) — **no** request bodies or secrets.
- **In-memory rate limits** (not distributed): stricter caps in production for sensitive POST prefixes and for **GET `/api/invites/smtp/status`**.
- **`requireGoogleSession`** on **`POST /api/onboarding/app-invites/company-user`**, sheet writes, **`POST /api/auth/company/login`**, **`GET /api/auth/company/session`**, and **`POST /api/tools/migrate-userauth-passwords`** — company user auth and bulk hash migration need the API host’s Google token to read/write Sheets. (Invite **completion** still checks Google inside the handler and returns 401 with setup instructions if the API is not connected.)
- **`APP_AUTH_MODE`** env: in **production**, if unset or `demo`/`local`, the API logs a **loud warning** at startup — **boot is not blocked** (pilot flexibility).

---

## 3. What remains unsafe for public self-serve

- **Demo / god-mode** and **localStorage**-held workspace JSON remain inappropriate for public self-serve without a managed IdP and BFF.
- **Onboarding** response sheets may still contain password-like answers from signup forms (separate from Config `UserAuth.*`); treat as sensitive at rest.
- **Single global Google OAuth** session for all automation — blast radius if token file leaks.
- **No per-user API auth**, **no MFA**, **no account lockout**, **no CAPTCHA**, **no billing/abuse** pipeline.
- Rate limits are **per-process memory** — not effective across horizontally scaled instances without a shared store.

---

## 4. API route protection plan (classification)

| Tier | Meaning | Examples |
|------|---------|----------|
| **publicSafe** | Intentionally unauthenticated liveness / readiness | `GET /api/health`, `GET /api/readiness` |
| **inviteToken** | Secrecy from invite URL token + handler checks | `GET /api/onboarding/app-invites/:tokenId`, `POST …/complete`, `POST …/new-company` (no API Google required to mint JSON + link) |
| **googleSession** | Requires stored Google OAuth on API host | `POST /api/onboarding/app-invites/company-user`, all `POST /api/google-sheet-by-id/...` |
| **deferredAuth** | Still same-origin–trusted today; **rate-limited**; replace with real app auth | `POST /api/onboarding/invite`, notification POSTs, `POST …/new-company` abuse class |

Future work: shared **`requireAppSession`** (JWT / cookie session) wrapping **deferredAuth** routes, plus admin API keys for invite **creation**.

---

## 5. Recommended future auth provider options

For **public self-serve** or large pilots, prefer a **managed IdP** (Auth0, Clerk, Cognito, Azure AD B2C, Google Identity for Workspace users, etc.) plus a thin **BFF session** for the SPA, with:

- **Hashed passwords** or passwordless, **MFA**, **token refresh/revocation**
- **Server-side authorization** on every sensitive POST
- **Google OAuth on the API** kept as the **automation / Drive** identity, clearly separated from human login

Custom crypto-only auth is possible but slower and higher risk than a maintained provider.

---

## 6. Paid pilot minimum requirements (operational)

- **Network boundary**: VPN, IP allowlist, or private ingress until `deferredAuth` routes are authenticated.
- **`NODE_ENV=production`**, strong **`SESSION_SECRET`**, HTTPS at the proxy, **`APP_AUTH_MODE=demo`** only with eyes open (startup warning).
- **Monitoring** on 429 rate-limit spikes and invite creation volume.
- **Secrets**: never commit `.env`; rotate **`google-session.json`** if exposed.

---

## 7. Public launch requirements (non-exhaustive)

- End-user **server auth** + **API authorization** tied to tenant + user
- **No demo/god-mode** in production bundles
- **OIDC/SAML**, per-user API authorization on every sensitive route, **Master email / temp token reset**, durable invite store hardening.
- **Hashed credentials** are in place for Config `UserAuth.*`; full **IdP** integration and **no localStorage session** are still future work.
- **Durable invite store** with authZ + idempotency under load
- **WAF / bot protection**, structured security logging, incident response runbooks
- Legal: Terms, Privacy, DPA as applicable

---

## Revision

Update this file when new middleware, route guards, or auth providers land.
