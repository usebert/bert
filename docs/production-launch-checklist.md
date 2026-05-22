# BERT production launch checklist (Phase 1 foundation)

This checklist complements the API **production environment validation** added in `server/server.mjs`. Use it before promoting a build from controlled demo to hosted pilot or broader launch. For **paid pilot hosting** (domains, env, Google, email, first deploy), see **`docs/deployment-runbook.md`**.

## API probes

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | **Liveness** — process is up; returns version, environment label, and whether Google env vars are present (no raw Drive IDs). |
| `GET /api/readiness` | **Readiness** — `.sessions` writable and production boot rules satisfied (`SESSION_SECRET`, `BERT_ALLOWED_ORIGINS`). Includes **`googleConfigured`** (false when Google env vars are missing). Does **not** require Google for **`ready: true`**. Returns **HTTP 503** when not ready and `NODE_ENV=production`. |

## Boot behaviour (`NODE_ENV=production`)

The API **refuses to start** (exit code 1) if any of the following are true:

- `SESSION_SECRET` is unset, equals the local default, or is shorter than 24 characters.
- `ALLOW_INSECURE_OAUTH_STATE` is truthy.
- `BERT_ALLOWED_ORIGINS` is unset (required for credentialed cross-origin SPA/Capacitor clients).

Warnings (logged only, do not block boot):

- Google workspace env incomplete (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_SHARED_DRIVE_ID`) — health and Master login still work; Drive/Sheets routes return **503** until configured.
- `FRONTEND_URL` or `GOOGLE_REDIRECT_URI` uses `http://` for a non-loopback host (use HTTPS behind TLS in real deployments).

## Environment (copy from `.env.example` production section)

- [ ] `NODE_ENV=production`
- [ ] Strong `SESSION_SECRET` (24+ random characters; not the dev default)
- [ ] `BERT_ALLOWED_ORIGINS` includes every SPA origin (`https://app.usebert.co.uk`, `https://bert-app.onrender.com`, Capacitor, dev previews as needed)
- [ ] `BERT_SESSIONS_DIR` on a persistent volume (Render/Railway) so `master-operators.json` survives redeploy
- [ ] `BERT_TOOL_SECRET` plus `BERT_INITIAL_MASTER_*` for `POST /api/tools/seed-master` with `{}` when shell access is unavailable
- [ ] `GOOGLE_*` OAuth client and **Shared Drive** ID for the deployment
- [ ] `FRONTEND_URL` matches the public SPA origin (HTTPS in production)
- [ ] `GOOGLE_REDIRECT_URI` registered in Google Cloud Console for this host
- [ ] SMTP variables if server-sent email is required (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`)
- [ ] `BERT_COMPANY_ONBOARDING_FORM_URL` set if the default Google Form link should change
- [ ] **Companies → Invite new company**: with SMTP, onboarding email sends; without SMTP, fallback panel shows copy link / draft
- [ ] **Company user invite** (Users/Invites): email sends or manual fallback; recipient completes invite link before company login
- [ ] **Company user resend** works (reuses invite token + SMTP; does not require live API Google session for email only)
- [ ] **Company user delete/revoke** removes invite from UI and invalidates server token
- [ ] Pilot SMTP: Microsoft 365 from `admin@usebert.co.uk`; operators tell recipients to check **Junk/Spam** if mail is delayed
- [ ] Plan transactional sender (Resend/Postmark) + SPF/DKIM/DMARC before scaling beyond pilot; re-enable Microsoft Security Defaults after migration
- [ ] **Never** set `ALLOW_INSECURE_OAUTH_STATE=true` in production

## Master operator (hosted API)

- [ ] `POST /api/tools/seed-master` with `X-Bert-Tool-Secret` and body `{}` (env bootstrap) or `{ "email", "password", "reset": true }` (password reset)
- [ ] `POST /api/auth/master/login` with `Origin` matching an allowlisted SPA host returns `ok: true` and `Set-Cookie: bert_master_session`
- [ ] Operator file exists at `{BERT_SESSIONS_DIR}/master-operators.json` (or `.sessions/master-operators.json` if unset)

## Hosting

- [ ] TLS terminates at reverse proxy or platform ingress
- [ ] `/api` and `/auth` routed to the Node process (`PORT`, default 8787)
- [ ] Persistent disk or equivalent for `.sessions/` (OAuth token + invite store) until replaced by managed storage
- [ ] Health/readiness checks wired to `/api/health` and `/api/readiness` as appropriate for your orchestrator

## Smoke after deploy

- [ ] `GET /api/health` → `ok: true`, expected `googleEnvConfigured`
- [ ] `GET /api/readiness` → `ready: true`, `checks.sessionStoreWritable: true`, HTTP 200 before marking instance “In service”
- [ ] CORS preflight for `https://bert-app.onrender.com` and `https://app.usebert.co.uk` returns matching `Access-Control-Allow-Origin` (see runbook curls)
- [ ] Static SPA built with `VITE_API_BASE_URL=https://api.usebert.co.uk`
- [ ] Hard refresh `/setup/initial` on SPA host loads app (not 404) — `public/_redirects` present in `dist/`
- [ ] `POST /api/auth/master/login` from browser (both SPA origins) sets `bert_master_session` cookie
- [ ] Master sees pilot nav only; **Godmode** appears only inside **Setup → Initial Setup** (`/setup/initial`)
- [ ] Company users cannot access `/setup/initial` or Godmode
- [ ] `npm run verify:auth` and `BERT_VERIFY_PILOT_DIST=1 npm run verify:auth` pass on release build artifact
- [ ] Google OAuth connect flow from Initial Setup (after Google env on API)
- [ ] One invite or onboarding path in a staging tenant (manual invite link OK if SMTP unset)
- [ ] Company onboarding email received (or found in Junk/Spam); body mentions checking Junk/Spam and sender `admin@usebert.co.uk`
- [ ] Company user invite: open emailed link → set password → company login succeeds with that email/password (requires API Google session for invite completion)

## Browser E2E (paid pilot gate)

See **`docs/deployment-runbook.md`** § “Browser end-to-end smoke” for the full operator checklist (Master login → Initial Setup → company → invite → company login → logout).

## Not covered by Phase 1

Billing, per-tenant database migration, client `localStorage` strategy, and full security review remain out of scope for this checklist—see the broader production-readiness roadmap.
