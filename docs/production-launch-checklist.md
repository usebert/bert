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
- [ ] `GOOGLE_*` OAuth client and **Shared Drive** ID for the deployment
- [ ] `FRONTEND_URL` matches the public SPA origin (HTTPS in production)
- [ ] `GOOGLE_REDIRECT_URI` registered in Google Cloud Console for this host
- [ ] SMTP variables if server-sent email is required (otherwise use manual invite links)
- [ ] **Never** set `ALLOW_INSECURE_OAUTH_STATE=true` in production

## Hosting

- [ ] TLS terminates at reverse proxy or platform ingress
- [ ] `/api` and `/auth` routed to the Node process (`PORT`, default 8787)
- [ ] Persistent disk or equivalent for `.sessions/` (OAuth token + invite store) until replaced by managed storage
- [ ] Health/readiness checks wired to `/api/health` and `/api/readiness` as appropriate for your orchestrator

## Smoke after deploy

- [ ] `GET /api/health` → `ok: true`, expected `googleEnvConfigured`
- [ ] `GET /api/readiness` → `ready: true` and HTTP 200 before marking instance “In service”
- [ ] Google OAuth connect flow from the SPA
- [ ] One invite or onboarding path in a staging tenant

## Not covered by Phase 1

Billing, per-tenant database migration, client `localStorage` strategy, and full security review remain out of scope for this checklist—see the broader production-readiness roadmap.
