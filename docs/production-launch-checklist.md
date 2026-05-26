# BERT production launch checklist (Phase 1 foundation)

This checklist complements the API **production environment validation** added in `server/server.mjs`. Use it before promoting a build from a controlled sandbox to hosted pilot or broader launch. For **paid pilot hosting** (domains, env, Google, email, first deploy), see **`docs/deployment-runbook.md`**.

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
- [ ] **Company users are on the company master spreadsheet** (Users tab + Config `UserAuth.<email>`), **not** the operator Master login sheet — verify the selected company folder’s sheet after invite completion
- [ ] **Sites / Areas** (optional): Master or Company Admin can add areas and enable restrictions when needed; single-site pilots can leave restrictions off
- [ ] **Area restrictions**: when enabled, Managers/Auditors only see work for assigned areas; assignment UI in **Users & Invites** (or **Companies** for Master)
- [ ] **Company user resend** works (reuses invite token + SMTP; does not require live API Google session for email only)
- [ ] **Company user delete/revoke** removes invite from UI; incomplete setup tokens can be revoked; active users show a clear message
- [ ] **Setup incomplete** rows can be cleared and a fresh invite sent; recipient can reopen the invite link to retry setup when API Google is connected
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

## Final role smoke test (hosted SPA + tablet)

Run on the production build (`VITE_API_BASE_URL=https://api.usebert.co.uk`, no debug env flags or `VITE_ENABLE_DEMO_LOGIN`).

| Role | Primary nav | Must not see |
|------|-------------|--------------|
| **Master** | Dashboard, Platform Setup, Companies, Company Onboarding, Users & Invites, Templates, Reports / Diagnostics, Tablet / Kiosk | — |
| **Company Admin** | Dashboard, Workspace, Users & Invites, Forms & Checks, Reports | Platform Setup, Companies, Godmode, Load sample data (unless debug build) |
| **Manager** | Dashboard, Forms & Checks, Reports, Team | Platform Setup, Godmode, Companies, Users & Invites (full admin), dangerous platform actions |
| **Auditor** | Today, My Checks, Submit, History; **More** = account / log out only | Platform Setup, admin/sync-centre/setup language, QR/register/dashboard on Submit, blank My Checks (empty state + cards when assigned) |

- [ ] **Master**: sign in → Dashboard → Platform Setup → Initial Setup; Pilot health on Dashboard and Reports / Diagnostics
- [ ] **Company Admin**: no Platform Setup nav; `/setup` and `/setup/initial` show “Setup is not available”
- [ ] **Manager**: operational nav only; no Platform Setup; Team invites work; no Godmode or seed tools in UI
- [ ] **Auditor (web)**: History opens **Your submissions** (not Sync Centre); Submit is report form only
- [ ] **Auditor (tablet APK)**: same nav; sign-in has no debug chrome; build badge visible on native sign-in

## Tablet APK smoke test

- [ ] Build with `npm run android:apk:pilot:release` (or debug sideload script); confirm monotonic build number on sign-in
- [ ] Install on pilot tablet; sign in as Auditor and Company Admin smoke paths above
- [ ] Cookie auth works against `https://api.usebert.co.uk` (no CORS errors in WebView)
- [ ] Rebuild APK only when `android/` native assets or Capacitor config change (web-only deploys use SPA host)

## Android CORS origins

API **`BERT_ALLOWED_ORIGINS`** must include every document origin the app uses:

- [ ] `https://app.usebert.co.uk` (and `https://bert-app.onrender.com` if used)
- [ ] `capacitor://localhost` (Capacitor WebView default)
- [ ] `http://localhost:5173` and `http://localhost:4173` (local Vite dev/preview only — omit from production if unused)

After env change, redeploy API and confirm credentialed `POST /api/auth/master/login` from SPA and from the APK WebView.

## ISO readiness folder structure

See **`docs/iso-readiness-folder-structure.md`**.

- [ ] New company provision creates **01–06** folders with exact names (case-insensitive match on existing; no duplicates)
- [ ] Company master sheet **Config** stores `setupFolderId`, `auditFormsFolderId`, `recordsFolderId`, `evidenceFolderId`, `exportsFolderId`, `managementNotesFolderId`
- [ ] **Check workspace** shows six folder statuses; **Fix workspace** creates missing folders and refreshes Config IDs
- [ ] Evidence uploads land in **04 Evidence**; report rows use **05 Exports** links where configured
- [ ] **Auditor / tablet**: no folder setup UI; **Company Admin**: folder health without raw Drive IDs

## Google persistence check

- [ ] Connect Google from Master Initial Setup; reload SPA — session still connected
- [ ] API redeploy with persistent `BERT_SESSIONS_DIR` — OAuth tokens and `master-operators.json` survive
- [ ] `GET /api/readiness` → `googleConfigured` / Drive checks match operator expectation

## Invite lifecycle check

- [ ] Company onboarding email (or manual link) → recipient completes form → workspace appears for Admin
- [ ] Company user invite email → open link → set password → **company sheet** Users + `UserAuth.<email>` updated
- [ ] Resend invite reuses token and sends mail (or shows manual fallback without SMTP)
- [ ] **Setup incomplete** row can be cleared and re-invited; recipient can retry the link when API Google is connected

## Remove-user check

- [ ] Remove / revoke user in Users & Invites removes row from UI
- [ ] Incomplete invite can be revoked; active user shows clear message (not silent failure)
- [ ] Removed user cannot sign in with old password; re-invite path works if they return

## Smoke after deploy

- [ ] `GET /api/health` → `ok: true`, expected `googleEnvConfigured`
- [ ] `GET /api/readiness` → `ready: true`, `checks.sessionStoreWritable: true`, HTTP 200 before marking instance “In service”
- [ ] CORS preflight for `https://bert-app.onrender.com` and `https://app.usebert.co.uk` returns matching `Access-Control-Allow-Origin` (see runbook curls)
- [ ] Static SPA built with `VITE_API_BASE_URL=https://api.usebert.co.uk`
- [ ] Hard refresh `/setup/initial` on SPA host loads app (not 404) — `public/_redirects` present in `dist/`
- [ ] `POST /api/auth/master/login` from browser (both SPA origins) sets `bert_master_session` cookie
- [ ] Master nav: Dashboard, **Platform Setup**, Companies, **Company Onboarding**, **Users & Invites**, Templates, Reports / Diagnostics, Tablet / Kiosk
- [ ] Company Admin nav: Dashboard, **Workspace**, **Users & Invites**, **Forms & Checks**, Reports (no Platform Setup / Companies)
- [ ] Manager nav: Dashboard, Forms & Checks, Reports, Team (no Platform Setup)
- [ ] Auditor nav: Today, My Checks, Submit, History only
- [ ] Master **Pilot health** panel on Dashboard and Reports / Diagnostics shows API, readiness, Google, Drive, and SMTP probes
- [ ] **Danger zone** copy for Disconnect Google (Master only), Remove user, and Revoke invite
- [ ] After sending user invite or company onboarding email, **What happens next** steps appear in Admin
- [ ] Verify **Platform Setup** hidden for Company Admin / Manager / Auditor
- [ ] Verify `/setup` and `/setup/initial` direct access blocked for non-Master (redirect or “platform owner” message)
- [ ] Company users cannot access `/setup/initial` or Godmode
- [ ] **Sites / Areas**: Master and company Admin can add/rename/archive areas; Manager and Auditor cannot open area setup
- [ ] With area restrictions **off**, Users & Invites shows single-workspace message; Managers/Auditors see whole workspace
- [ ] With area restrictions **on**, assign users to areas; reserved names (Archive, Live Companies, Master Control) are rejected
- [ ] Areas persist in company master sheet `Areas` tab when Google is connected; friendly message when sheet sync unavailable
- [ ] **Area audits**: Admin maps active templates to areas; `AreaAudits` tab created on first save; My Checks respects mapping when rows exist
- [ ] **User access tabs**: `UserAreaAccess` and `UserAuditAccess` sync from sheet on load; toggles in Users & Invites / Forms & Checks persist when Google connected
- [ ] `npm run verify:auth` and `BERT_VERIFY_PILOT_DIST=1 npm run verify:auth` pass on release build artifact
- [ ] Google OAuth connect flow from Initial Setup (after Google env on API)
- [ ] One invite or onboarding path in a staging tenant (manual invite link OK if SMTP unset)
- [ ] Company onboarding email received (or found in Junk/Spam); body mentions checking Junk/Spam and sender `admin@usebert.co.uk`
- [ ] Company user invite: open emailed link → set password → verify **company sheet** Users + UserAuth → company login succeeds (requires API Google session for invite completion; login resolves company sheet from invite completion hint or server invite store when the browser has no operator workspace selected)

## Browser E2E (paid pilot gate)

See **`docs/deployment-runbook.md`** § “Browser end-to-end smoke” for the full operator checklist (Master login → Initial Setup → company → invite → company login → logout).

## Core compliance operating loop (acceptance test)

See **`docs/bert-core-operating-loop.md`** for tab definitions and architecture.

Run on a staging company with Google connected and a linked master sheet:

1. **Provision**
   - [ ] Create area in Workspace → **Areas** tab row appears
   - [ ] Map audit template to area → **AreaAudits** row
   - [ ] Grant auditor audit + area access → **UserAuditAccess** / **UserAreaAccess**
   - [ ] Create schedule with **Next Due At** today → **Schedule** tab row

2. **Evaluate & submit**
   - [ ] Sign in as Auditor → check appears in Today / My Checks
   - [ ] Complete check with at least one failed answer → submit
   - [ ] Auditor sees plain post-submit message (issues count, no admin jargon)

3. **Sheet records**
   - [ ] **AuditResults** row with `Result ID`, `Area ID`, `Answers JSON`
   - [ ] **AuditFindings** row(s) for failed answers
   - [ ] **Actions** row(s) auto-created
   - [ ] **SyncLog** entry for submission

4. **Manager close**
   - [ ] Manager assigns action, attaches evidence, closes with verification
   - [ ] **Actions** tab reflects status; evidence in **Evidence** tab when synced

5. **Report**
   - [ ] Manager/Admin exports report pack → preview shows real findings/actions
   - [ ] **Reports** tab row appended

6. **Safety regression**
   - [ ] Auth, invites, areas, route guards unchanged (`npm run verify:auth`, `npm run verify:pilot-readiness`)

## Not covered by Phase 1

Billing, per-tenant database migration, client `localStorage` strategy, and full security review remain out of scope for this checklist—see the broader production-readiness roadmap.
