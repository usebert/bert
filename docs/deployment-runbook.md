# BERT deployment runbook — paid pilot hosting

This runbook is for **hosted paid pilot** deployments: a small number of tenants, real Google Workspace data, and operator support. It assumes **Phase 1** API behaviour is in place (`server/server.mjs`): production env validation at boot, **`GET /api/health`**, **`GET /api/readiness`**, and safer startup logs. See also **`docs/production-launch-checklist.md`**.

---

## 1. Target paid-pilot architecture

### Recommended split origin (three hosts)

```txt
usebert.co.uk        -> marketing website (static or CMS; not this repo)
app.usebert.co.uk    -> React/Vite frontend (static build from `npm run build` / `dist/`)
api.usebert.co.uk    -> Express API (`server/server.mjs`, Node process)
```

- The SPA is built with **`FRONTEND_URL=https://app.usebert.co.uk`** (or your chosen app host) so links in emails and OAuth return URLs resolve correctly.
- The API listens on **`PORT`** (default **8787** internally); the public URL is **`https://api.usebert.co.uk`** with TLS at the reverse proxy.
- **`GOOGLE_REDIRECT_URI`** must exactly match the registered OAuth redirect, e.g. **`https://api.usebert.co.uk/auth/google/callback`**.

### Alternative: single app host + path routing

```txt
app.usebert.co.uk    -> reverse proxy: static files for `/` + proxy `/api` and `/auth` to the Node API
```

- One public hostname; simpler DNS and TLS.
- Configure the proxy so **`FRONTEND_URL`** is still **`https://app.usebert.co.uk`** (the user-facing origin) and **`GOOGLE_REDIRECT_URI`** matches the **callback URL the browser hits** (often the same host: `https://app.usebert.co.uk/auth/google/callback` if the API is mounted there—must match Google Cloud Console).

Pick one model per environment and keep **redirect URIs** and **`FRONTEND_URL`** consistent with what users and Google see.

### Deploy static SPA (Render Static Site)

1. **New → Static Site** — Connect this repo.
2. **Build command** — `npm ci && npm run build`
3. **Publish directory** — `dist`
4. **Build-time env (required):**
   - **`VITE_API_BASE_URL=https://api.usebert.co.uk`**
   - Do **not** set `VITE_ENABLE_DEMO_LOGIN`, `VITE_SHOW_DEBUG_UI`, or demo passwords.
5. **SPA fallback** — `public/_redirects` is copied into `dist/` by Vite and tells Render to serve `index.html` for deep routes such as **`/setup/initial`**:

   ```txt
   /* /index.html 200
   ```

6. **Custom domain** — Add **`app.usebert.co.uk`** (or use **`bert-app.onrender.com`** until DNS is ready).
7. **Post-deploy verify** — Hard refresh `https://<spa-host>/setup/initial` (should load the app, not 404).

### Confirm production picked up the latest commit

When operators report “nothing is changing” after a fix, production is often still serving an older SPA or API build.

1. **Note the target commit** — `git rev-parse HEAD` on the branch you merged (e.g. `cursor/onboarding-branding-polish`).
2. **Redeploy both services on Render** (or your host):
   - **Static Site (SPA)** — Manual Deploy → Deploy latest commit (build command `npm ci && npm run build`, publish `dist/`).
   - **Web Service (API)** — Manual Deploy → Deploy latest commit (start `npm run start:api`).
3. **Verify SPA build stamp** — Open `https://<spa-host>/build-meta.json` and confirm `gitSha` matches the target commit (first 7+ characters). Missing file means the SPA was not built with `npm run build` after `scripts/write-build-meta.mjs` was added.
4. **Verify API behaviour** — `curl -sS https://<api-host>/api/health` then exercise the changed route (e.g. company login folder-placement gate or Godmode **Advanced diagnostics → Under Live Companies**).
5. **Local check before push** — `npm run verify:company-folder-source-of-truth` and `npm run verify:live-core-paths` (when live URLs are configured).

**GoDaddy DNS (app host):**

- **CNAME** — Host **`app`** → Value your Render static site hostname (e.g. **`bert-app.onrender.com`**) or the target Render shows in the dashboard.
- Wait for propagation before cutting over marketing links.

**Render API env — `BERT_ALLOWED_ORIGINS` (exact, comma-separated, no spaces after commas unless your parser trims):**

```txt
https://app.usebert.co.uk,https://bert-app.onrender.com,capacitor://localhost,http://localhost:5173,http://localhost:4173
```

**Render API — persistent disk:**

- Mount disk at **`/var/data`**
- Set **`BERT_SESSIONS_DIR=/var/data/bert`**
- Stores **`master-operators.json`**, **`google-session.json`**, invite JSON — survives redeploys.

---

## Deploy hosted API for Android pilot

Use this checklist when the **Android pilot APK** talks to **`https://api.usebert.co.uk`** and you need a **small Node host** (no container orchestration). The API entrypoint is **`server/server.mjs`**; it already listens on **`process.env.PORT`** (default **8787** if unset) and binds **`0.0.0.0`**.

### Render (Web Service)

1. **New → Web Service** — Connect this repo (or push a deploy branch).
2. **Runtime** — **Node**; set **Node version** to **20+** (matches `package.json` **`engines.node`**).
3. **Build command** — From the repo root: **`npm ci`** (or **`npm ci --omit=dev`** only if you are certain no `postinstall` or tooling needs devDependencies; this project’s API uses production `dependencies` only).
4. **Start command** — **`npm run start:api`** or **`npm start`** (both run **`node server/server.mjs`**).
5. **Health check** — Path **`/api/health`** (HTTP **200**, JSON includes **`"ok":true`** and **`"service":"bert-api"`**). Works **without** Google env vars. Use **`/api/readiness`** for writable session dir + production env rules; it reports **`googleConfigured: false`** when Google vars are missing but can still return **200** once **`SESSION_SECRET`** and **`BERT_ALLOWED_ORIGINS`** are set.
6. **Persistent disk** — Add a **Disk** mounted at a path such as **`/data/bert-sessions`**, then set **`BERT_SESSIONS_DIR=/data/bert-sessions`** in the service environment so **`google-session.json`**, **`master-operators.json`**, and invite JSON survive redeploys. If you omit a disk, treat the filesystem as **ephemeral**: every deploy can wipe **`.sessions`** unless you re-seed and re-run **Connect Google**.

### Railway

1. **New Project → Deploy from GitHub** (or CLI) with root at this repo.
2. **Build** — **`npm ci`** (Railway runs install/build steps from your configured nixpacks or Dockerfile; a minimal Node service can use **`npm ci`** then start).
3. **Start** — **`npm run start:api`** or **`node server/server.mjs`**; set **`PORT`** from the platform if not injected automatically (Railway usually sets **`PORT`**).
4. **Health check** — **`/api/health`**.
5. **Volume** — Attach a **volume** and set **`BERT_SESSIONS_DIR`** to the mount path (same rationale as Render).

### Custom domain (`api.usebert.co.uk`)

In Render or Railway, add a **custom domain** **`api.usebert.co.uk`**, complete **TLS** verification, then set **`GOOGLE_REDIRECT_URI=https://api.usebert.co.uk/auth/google/callback`** in Google Cloud Console and in the API env. Keep **`FRONTEND_URL`** as the **SPA** origin (e.g. **`https://app.usebert.co.uk`**) if the app is split across hosts.

### Environment variables (hosted API pilot)

| Variable | Required? | Notes |
|----------|-----------|--------|
| **`NODE_ENV`** | Yes | **`production`** for strict boot and cookie/CORS behaviour. |
| **`PORT`** | No | Injected by the host; API listens on **`process.env.PORT`**, defaulting to **8787** when unset or non-numeric. |
| **`SESSION_SECRET`** | Yes | **≥ 24** chars, not the local default; signs cookies. |
| **`BERT_ALLOWED_ORIGINS`** | Yes (production boot) | Comma-separated exact **`Origin`** values (app, Capacitor, any dev preview). API refuses to start in production if unset. |
| **`BERT_COOKIE_SAMESITE_NONE`** | Optional | **`true`** for HTTPS staging when **`NODE_ENV`** is not production; production implies cross-site cookies where needed. |
| **`BERT_SESSIONS_DIR`** | Recommended | Absolute or repo-relative path for session files; avoids losing **`.sessions`** on ephemeral disks. |
| **`FRONTEND_URL`** | Yes | Public SPA origin (HTTPS in production). |
| **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**, **`GOOGLE_REDIRECT_URI`**, **`GOOGLE_SHARED_DRIVE_ID`** | For workspace provisioning | Required for Drive/Sheets, Connect Google, and company sheet login — **not** required for **`/api/health`** or **Master** login. |
| **`GOOGLE_ONBOARDING_FORM_ID`**, **`GOOGLE_ONBOARDING_SHEET_ID`** | Optional | Master onboarding pipeline; leave unset only if you do not use that flow. |
| **`APP_SUPPORT_EMAIL`** (or **`APP_ADMIN_EMAIL`**) | Defaulted | Support inbox for server-sent mail. |
| **`SMTP_HOST`**, **`SMTP_PORT`**, **`SMTP_USER`**, **`SMTP_PASS`**, **`SMTP_FROM_EMAIL`** | Strongly recommended | **`SMTP_SECURE`**, **`SMTP_FROM`**, **`SMTP_FROM_NAME`** optional. |
| **`APP_BRAND_NAME`** | Optional | Branding in mail/OAuth pages. |
| **`BERT_MASTER_SEED_SECRET`** | For **`seed:master`** | **≥ 16** chars; must match when running **`npm run seed:master`** on the host. |
| **`MASTER_SESSION_TTL_MS`** | Optional | Master signed cookie TTL (default 7d). |
| **`COMPANY_USER_SESSION_TTL_MS`** | Optional | Company session TTL (default 7d). |
| **`ONBOARDING_INVITE_TTL_MS`** | Optional | Invite link lifetime. |
| **`APP_AUTH_MODE`** | Optional | Pilot may stay **`demo`** with server Master auth; see startup warning in production. |
| **`BERT_TOOL_SECRET`** | Optional | Enables **`POST /api/tools/migrate-userauth-passwords`** with header **`x-bert-tool-secret`**. |
| **`SHEETS_READ_GAP_MS`**, **`SHEETS_QUOTA_MAX_RETRIES`** | Optional | Sheets throttling / retries. |
| **`ALLOW_INSECURE_OAUTH_STATE`** | Must omit / false | **Never** **`true`** in production. |

Client builds use **`VITE_API_BASE_URL`** (see **`.env.example`**); that is **build-time** for the SPA/APK, not read by the Node API process.

### `npm run seed:master` on the host

Set **`BERT_MASTER_SEED_SECRET`** in the platform env to a long random value, then run a **one-off shell** on the same machine (or SSH/job) with the same env and repo root:

```bash
npm run seed:master -- --email ops@yourorg.example --name "Operator" --password '<strong-password>' --confirm
```

Use a **strong password**; do not paste real secrets into documentation or tickets.

### Seed Master without Render Shell

On hosts without shell access (e.g. Render free tier), seed or update the Master operator over HTTPS. Set **`BERT_TOOL_SECRET`** on the API service (same value used for other `/api/tools/*` routes). This endpoint is **not** exposed in the SPA.

**Operator store path:** **`{BERT_SESSIONS_DIR}/master-operators.json`** when **`BERT_SESSIONS_DIR`** is set (recommended on Render with a persistent disk), otherwise **`{repo-root}/.sessions/master-operators.json`** on the API host.

**Render env (API service):**

| Variable | Purpose |
|----------|---------|
| **`BERT_TOOL_SECRET`** | Long random secret; required header **`X-Bert-Tool-Secret`** for **`POST /api/tools/seed-master`**. |
| **`BERT_INITIAL_MASTER_EMAIL`** | Used when seed body is **`{}`** (first bootstrap only). |
| **`BERT_INITIAL_MASTER_USERNAME`** | Optional display name / username for env-based seed (login accepts email or this name). |
| **`BERT_INITIAL_MASTER_PASSWORD`** | Used with env-based seed (min 12 characters). |
| **`BERT_SESSIONS_DIR`** | Persistent path for **`master-operators.json`** and OAuth session files (e.g. **`/var/data/bert-sessions`** on a mounted disk). |

**Option A — env defaults (first Master only, empty body):**

```bash
curl -sS -X POST "https://api.usebert.co.uk/api/tools/seed-master" \
  -H "Content-Type: application/json" \
  -H "X-Bert-Tool-Secret: <BERT_TOOL_SECRET>" \
  -d '{}'
```

**Option B — explicit reset (updates password when `reset: true`):**

```bash
curl -sS -X POST "https://api.usebert.co.uk/api/tools/seed-master" \
  -H "Content-Type: application/json" \
  -H "X-Bert-Tool-Secret: <BERT_TOOL_SECRET>" \
  -d '{
    "email": "admin@usebert.co.uk",
    "username": "BERT Admin",
    "password": "<new-strong-password-min-12-chars>",
    "reset": true
  }'
```

**Legacy (still supported):** **`{ "email", "name", "password", "confirm": true }`** upserts like before.

Responses never include passwords or hashes, e.g. **`{ "ok": true, "masterConfigured": true, "email": "...", "username": "...", "reset": true }`**. Wrong or missing tool secret → **403**; unset **`BERT_TOOL_SECRET`** → **404**.

### Master login API

**`POST /api/auth/master/login`** accepts JSON **`{ "password": "..." }`** plus **`email`** and/or **`username`** (either field may carry the operator’s email; **`username`** also matches the seeded display name). Production builds do not accept client-side god/dog placeholders.

### Smoke checks (`curl`)

```bash
curl -sS "https://api.usebert.co.uk/api/health"

# Seed (after setting Render env vars)
curl -sS -X POST "https://api.usebert.co.uk/api/tools/seed-master" \
  -H "Content-Type: application/json" \
  -H "X-Bert-Tool-Secret: <BERT_TOOL_SECRET>" \
  -d '{}'

# Login — include Origin so credentialed CORS matches production SPA hosts
curl -sS -D - -o /dev/null -X POST "https://api.usebert.co.uk/api/auth/master/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://bert-app.onrender.com" \
  -d '{"email":"admin@usebert.co.uk","password":"<strong-password>"}'

curl -sS -X POST "https://api.usebert.co.uk/api/auth/master/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.usebert.co.uk" \
  -d '{"email":"admin@usebert.co.uk","password":"<strong-password>"}' | head -c 400
```

Expect **`/api/health`** → **`"ok":true`**; login → **`"ok":true`**, JSON **`operator`**, and **`Set-Cookie: bert_master_session=...; Secure; SameSite=None`** when credentials match **`master-operators.json`** and **`Origin`** is listed in **`BERT_ALLOWED_ORIGINS`**.

### Production authentication health (post-deploy smoke)

After every API deployment, run the read-only company login smoke test against production. It verifies API health, Google workbook access, username resolution, a real company login/logout cycle, and invalid-password rejection. Credentials are read from environment variables — never commit passwords.

```bash
set -a && source .env && set +a

BERT_SMOKE_USERNAME=mr.important \
BERT_SMOKE_PASSWORD='<set securely in your environment>' \
BERT_SMOKE_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
BERT_SMOKE_MASTER_SHEET_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
BERT_SMOKE_EXPECTED_EMAIL=bert.demo+mr.important@usebert.co.uk \
npm run verify:production-auth-health
```

Optional overrides:

- **`BERT_SMOKE_API_ORIGIN`** — default `https://api.usebert.co.uk`
- **`BERT_SMOKE_APP_ORIGIN`** — default `https://app.usebert.co.uk`
- **`BERT_SMOKE_EXPECTED_ROLE`** — default `Admin`

Exit code **0** and **`RESULT: READY FOR CUSTOMERS`** mean every check passed. Any failure prints the failed stage, reason, and likely remediation.

Unit tests (mocked HTTP, no production calls):

```bash
npm run verify:production-auth-health-tests
```

### Production audit workflow (post-deploy smoke)

After startup health and authentication health pass, run the audit workflow smoke test. It authenticates with the same smoke account, loads assigned checks, opens an audit, exercises draft save/resume/edit (client-local draft parity), and — only when a dedicated verification schedule exists — submits that audit and confirms AuditResults and dashboard metrics update. It never submits customer production audits.

```bash
set -a && source .env && set +a

BERT_SMOKE_USERNAME=mr.important \
BERT_SMOKE_PASSWORD='<set securely in your environment>' \
BERT_SMOKE_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
BERT_SMOKE_MASTER_SHEET_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
BERT_SMOKE_EXPECTED_EMAIL=bert.demo+mr.important@usebert.co.uk \
npm run verify:production-audit-workflow
```

Optional:

- **`BERT_SMOKE_VERIFICATION_SCHEDULE_ID`** — explicit schedule ID allowed for safe end-to-end submission (name patterns like `BERT Verification Audit` are also recognised).

Exit code **0** and **`RESULT: READY FOR CUSTOMERS`** mean every required stage passed. Submission stages show **SKIPPED** when no dedicated verification audit is configured — that is expected and still counts as ready.

Unit tests (mocked HTTP, no production calls):

```bash
npm run verify:production-audit-workflow-tests
```

### Post-deploy verification sequence

Run in order after every API deployment:

1. **Startup health** — boot gate and `/api/health` readiness (`verify:startup-health-manager`, `verify:startup-boot-gate-tests`)
2. **Authentication health** — `npm run verify:production-auth-health`
3. **Audit workflow** — `npm run verify:production-audit-workflow`

Only when all three pass should the deployment be considered **READY FOR CUSTOMERS**.

### Startup system health (Master operators)

After API boot, the server runs **critical verification before `listen()`**. The port does not open until critical checks pass. `GET /api/health` returns **HTTP 503** while booting and **HTTP 200** once deferred readiness completes and the API is accepting traffic.

Master-only detailed diagnostics:

```bash
GET /api/system/health
```

Requires a valid **Master** session (`bert_master_session`). Response includes overall status (`HEALTHY`, `DEGRADED`, or `FAILED`), API version/SHA, uptime, and per-check results. No secrets are returned.

Local unit tests:

```bash
npm run verify:startup-health-manager-tests
npm run verify:startup-boot-gate-tests
```

### CORS preflight (browser login prerequisite)

Temp SPA host:

```bash
curl -sS -i -X OPTIONS "https://api.usebert.co.uk/api/auth/master/login" \
  -H "Origin: https://bert-app.onrender.com" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

Expected:

```txt
access-control-allow-origin: https://bert-app.onrender.com
```

Production app host:

```bash
curl -sS -i -X OPTIONS "https://api.usebert.co.uk/api/auth/master/login" \
  -H "Origin: https://app.usebert.co.uk" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

Expected:

```txt
access-control-allow-origin: https://app.usebert.co.uk
```

If the grep returns nothing, add the missing origin to **`BERT_ALLOWED_ORIGINS`** on the API service and redeploy.

### Readiness probe

```bash
curl -sS "https://api.usebert.co.uk/api/readiness"
```

Expected (before Google is configured):

- **`"ready": true`**
- **`checks.sessionStoreWritable": true`**
- **`googleConfigured": false`** until Google env vars are set

After Google env is complete and connected:

- **`googleConfigured": true`**

Use **`checks.sessionStoreWritable`** — do not rely on a legacy **`sessionsWritable`** field.

### Master login (save cookies for session check)

```bash
curl -i -c bert-cookies.txt -X POST "https://api.usebert.co.uk/api/auth/master/login" \
  -H "Origin: https://bert-app.onrender.com" \
  -H "Content-Type: application/json" \
  --data '{"email":"admin@usebert.co.uk","password":"REPLACE_WITH_PASSWORD"}'
```

Repeat with **`Origin: https://app.usebert.co.uk`** when that host is live.

### Browser end-to-end smoke (operator)

1. Open SPA (`https://bert-app.onrender.com` or `https://app.usebert.co.uk`) — no console CORS errors on load.
2. Sign in as **Master** (email or username + password from seed).
3. Confirm pilot nav: **Dashboard, Setup, Companies, Users, Invites, Settings** — no **Godmode** in main nav.
4. **Setup → Open Initial Setup** — protected page shows **Godmode** breadcrumb and checklist:
   - Master Account
   - Google Workspace
   - Shared Drive
   - Session Storage
   - Invite Email
   - Ready for Pilot
5. **Connect Google** (after Google env on API) — return to Initial Setup; Google section turns green.
6. **Companies** — link or provision one test company folder.
7. **Invites** — create invite; use manual link if SMTP not configured.
8. Complete invite as company user; sign in with company credentials.
9. Hard refresh **`/setup/initial`** — SPA loads (confirms **`_redirects`** fallback).
10. **Log out** — always-visible control in sidebar (desktop) or bottom bar (mobile).

**SMTP decision:** If SMTP env is incomplete, **`readyForPilot`** may stay false on **`GET /api/setup/status`** but pilots can proceed with **manual invite links** copied from the Invites screen.

---

- **Preferred:** create a **CNAME** record: **Host** **`api`** → **Value** your platform’s hostname (e.g. **`your-service.onrender.com`** or Railway’s **`<project>.up.railway.app`** target shown in the dashboard). TTL as advised (often 1 hour).
- **Alternative:** if the host gives a **static IPv4** only, use an **A** record: **Host** **`api`** → **Value** that IP. Use **CNAME** whenever the provider supports it so IP changes do not break the pilot.

Remove or avoid conflicting **`api`** **A**/**CNAME** records; wait for DNS propagation before enabling strict TLS or Google OAuth redirect checks.

---

## 2. Required environment variables

### Must set for production API (`NODE_ENV=production`)

| Variable | Purpose |
|----------|---------|
| **`NODE_ENV`** | Set to **`production`** to enable strict boot checks and readiness HTTP semantics. |
| **`PORT`** | API listen port inside the container/VM (default **8787** if unset or invalid). |
| **`BERT_SESSIONS_DIR`** | Optional directory for **`google-session.json`**, **`master-operators.json`**, and onboarding invite JSON; use with a **mounted disk** on ephemeral hosts (see [Deploy hosted API for Android pilot](#deploy-hosted-api-for-android-pilot)). |
| **`SESSION_SECRET`** | Cookie signing for Express; must be **strong**, **not** the local default, and **≥ 24 characters** or the API will refuse to start. |
| **`FRONTEND_URL`** | Public origin of the SPA (e.g. `https://app.usebert.co.uk`). Used in redirects and email links. Use **HTTPS** for non-loopback hosts. |
| **`BERT_ALLOWED_ORIGINS`** | Comma-separated **exact** browser/Capacitor origins allowed to call the API with credentials (e.g. `https://app.usebert.co.uk,https://bert-app.onrender.com,capacitor://localhost,http://localhost:5173`). **Required for production boot.** No `*` wildcard with `Access-Control-Allow-Credentials`. |
| **`BERT_TOOL_SECRET`** | Enables **`POST /api/tools/seed-master`** and other `/api/tools/*` routes via header **`X-Bert-Tool-Secret`**. |
| **`BERT_INITIAL_MASTER_EMAIL`**, **`BERT_INITIAL_MASTER_USERNAME`**, **`BERT_INITIAL_MASTER_PASSWORD`** | Optional; used by **`POST /api/tools/seed-master`** with body **`{}`** for first-time bootstrap on hosts without shell. |
| **`GOOGLE_CLIENT_ID`** | OAuth web client ID — **workspace provisioning** (not required for `/api/health` or Master login). |
| **`GOOGLE_CLIENT_SECRET`** | OAuth client secret — workspace provisioning. |
| **`GOOGLE_REDIRECT_URI`** | Must match the OAuth redirect URL registered in Google Cloud (e.g. `https://api.usebert.co.uk/auth/google/callback`). |
| **`GOOGLE_SHARED_DRIVE_ID`** | Shared Drive (or folder) the provisioning Google account can write to. |
| **`BERT_COOKIE_SAMESITE_NONE`** | Set to **`true`** to force session cookies to **`SameSite=None; Secure`** even when **`NODE_ENV`** is not **`production`** (e.g. HTTPS staging). When **`NODE_ENV=production`**, this behaviour is always on for BERT session cookies. **`SameSite=None` requires HTTPS** on the API. |
| **`APP_SUPPORT_EMAIL`** | Customer-facing support inbox (e.g. `admin@usebert.co.uk`) for server-driven mail. |
| **`SMTP_HOST`** | Outbound mail server for invites and notifications. |
| **`SMTP_PORT`** | Typically **587** (STARTTLS) or **465** (TLS). |
| **`SMTP_SECURE`** | **`false`** for port 587 (STARTTLS); **`true`** for port 465. |
| **`SMTP_USER`** | SMTP auth user. |
| **`SMTP_PASS`** | SMTP auth password or app password. |
| **`SMTP_FROM`** / **`SMTP_FROM_EMAIL`** | From address, e.g. `BERT <no-reply@usebert.co.uk>`. |
| **`BERT_COMPANY_ONBOARDING_FORM_URL`** | Google Form link emailed to new company administrators (see below). |

### Strongly recommended (email identity)

The API treats a complete SMTP config as including a from-address. Set at least one of:

- **`SMTP_FROM_EMAIL`** (and optionally **`SMTP_FROM_NAME`**)

If SMTP is incomplete, many flows still work using **manual invite links** / mailto drafts from the app, but **server-sent** invite and incident mail will not work until SMTP is complete.

**Example SMTP block (Render API):**

```txt
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-app-password
SMTP_FROM_EMAIL=no-reply@usebert.co.uk
SMTP_FROM_NAME=BERT
```

**Company onboarding form (Master/Admin → Invite new company):**

```txt
BERT_COMPANY_ONBOARDING_FORM_URL=https://docs.google.com/forms/d/e/1FAIpQLSeWyvQiwz2zpW9L_V_gOhsVKtUs79LIxBZWGt7VMklED1QpNw/viewform?usp=sharing&ouid=113906459915409672747
```

If unset, the API uses the same URL as the paid-pilot default. The SPA shows a copyable link and email draft when SMTP is not configured.

**Paid pilot deliverability (Microsoft 365 SMTP):**

- The current pilot sends company onboarding mail via **Microsoft 365 SMTP** from **`admin@usebert.co.uk`** (`SMTP_FROM_EMAIL` / `SMTP_USER`).
- Messages may land in **Junk/Spam** until **SPF**, **DKIM**, and **DMARC** are tuned on the sending domain and sender reputation warms up.
- **Operators:** after **Companies → Send onboarding email**, tell the recipient to check **Inbox and Junk/Spam** if nothing arrives within a few minutes. The app success panel repeats this guidance.
- **SMTP AUTH note:** Microsoft **Security Defaults** can block basic SMTP auth; the pilot may require relaxing that temporarily. Re-enable stronger defaults once outbound mail moves to a dedicated transactional provider.
- **Longer term:** move invites and notifications to a transactional provider (**Resend**, **Postmark**, or similar), verify the domain there, then point **`SMTP_*`** (or a future provider integration) at that service and restore Microsoft security defaults.

### Optional tuning / branding

| Variable | Purpose |
|----------|---------|
| **`APP_BRAND_NAME`** | Brand string in emails and OAuth callback pages. |
| **`APP_ADMIN_EMAIL`** | Alias for support inbox if **`APP_SUPPORT_EMAIL`** is unset. |
| **`SHEETS_READ_GAP_MS`** | Throttle between Sheets reads (default 500 ms). |
| **`SHEETS_QUOTA_MAX_RETRIES`** | Retries on 429 / quota errors (default 8). |

Reference: **`.env.example`** (local + commented production block). For credentialed cross-origin behaviour, see **`scripts/verify-cors-cookies.md`** and [§9.5 Cookies and split origins](#95-cookies-and-split-origins).

---

## 3. Google Cloud setup

1. **OAuth consent screen** — Configure for **External** or **Internal** (Workspace) as appropriate; add scopes needed for Drive and Sheets (already requested by the app).
2. **Web OAuth client** — Create credentials of type **Web application**.
3. **Authorized redirect URIs** — Add exactly **`GOOGLE_REDIRECT_URI`** for this environment, e.g.  
   **`https://api.usebert.co.uk/auth/google/callback`**
4. **APIs** — Enable **Google Drive API** and **Google Sheets API** for the Google Cloud project.
5. **Shared Drive** — The ID in **`GOOGLE_SHARED_DRIVE_ID`** must be a drive/folder the **Google account that completes OAuth on the API server** can access (typically membership in a Shared Drive for production provisioning).
6. **Least privilege** — Use a dedicated Google user or service policy for the API’s stored session; rotate credentials if the session file is ever exposed.

---

## 4. Email / domain setup

- Set **`APP_SUPPORT_EMAIL=admin@usebert.co.uk`** (or your pilot support address).
- Configure **SMTP** with a reputable provider (transactional email recommended for pilots).
- **Paid pilot today:** Microsoft 365 SMTP from **`admin@usebert.co.uk`**; expect some messages in **Junk/Spam** until DNS authentication and reputation improve.
- Configure **SPF**, **DKIM**, and **DMARC** on the **sending domain** used in **`SMTP_FROM_EMAIL`** to improve deliverability and reduce spoofing risk.
- **Before a customer demo:** send a **test company onboarding email** (Companies → Invite new company) to a mailbox you control; confirm inbox placement and that the recipient knows to check **Junk/Spam** if needed.
- **Later:** migrate to **Resend** / **Postmark** (or similar), re-verify the domain, update **`SMTP_*`**, then re-enable Microsoft **Security Defaults** if they were relaxed for pilot SMTP AUTH.

---

## 5. Health / readiness checks

| Endpoint | Role |
|----------|------|
| **`GET /api/health`** | **Liveness** — process is up; returns version, environment, whether Google env vars are present, and **`sharedDriveConfigured`** (boolean). Does **not** expose raw Drive IDs. |
| **`GET /api/readiness`** | **Readiness** — Google env complete, **`.sessions`** directory writable, and production env rules satisfied. |

### Recommended hosting behaviour

- **Uptime / external ping** — Use **`/api/health`** (expect HTTP **200** and `"ok": true`).
- **Load balancer / orchestrator readiness** — Use **`/api/readiness`**; expect **HTTP 200** when `"ready": true`. When **`NODE_ENV=production`** and the instance is **not** ready, the API returns **HTTP 503** so traffic should not be routed to that instance until configuration is fixed.

See **`docs/production-launch-checklist.md`** for boot-blocking rules in production.

---

## 6. First deployment checklist

1. **Build frontend** — `npm run build` (outputs **`dist/`**).
2. **Deploy API** — Ship **`server/server.mjs`** with **`package.json`** dependencies installed (`npm ci --omit=dev` or equivalent in the API image).
3. **Set env vars** — All required variables from section 2; confirm **`NODE_ENV=production`** and **`BERT_ALLOWED_ORIGINS`** lists every hosted app / Capacitor / dev origin that calls the API with cookies (see [§9.5](#95-cookies-and-split-origins)).
4. **Start API** — `npm run start:api` / `npm start` / `node server/server.mjs` (or `npm run server` with env injected).
5. **`GET /api/health`** — Confirm **200** and expected flags.
6. **`GET /api/readiness`** — Confirm **200** and **`"ready": true`** before marking the instance in service.
7. **Google OAuth** — From the SPA as an admin/setup user, complete **Connect Google** so the API stores a valid session under **`.sessions/`**.
8. **Send test invite** — Verify SMTP or manual link path.
9. **Hosted onboarding** — Open **`?invite=<token>`** for a valid invite; complete provisioning per UI (may take minutes; watch API logs).
10. **Validate workspace** — Use Admin & setup **Check workspace** (and **Fix workspace** if needed) after linking folders.
11. **Smoke test** — One audit, one action, one report export path relevant to the pilot role set.

---

## 7. Troubleshooting boot failures

If the API **exits on start** in production, check the console for listed **blocking** issues:

| Symptom / cause | Fix |
|-----------------|-----|
| Missing **`SESSION_SECRET`** | Set a long random secret in the environment. |
| Weak / **default `SESSION_SECRET`** | Do not use the local dev default; use 24+ random characters. |
| **`ALLOW_INSECURE_OAUTH_STATE=true`** | Unset or set to false in production. |
| **Incomplete Google env** | Set all of **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**, **`GOOGLE_REDIRECT_URI`**, **`GOOGLE_SHARED_DRIVE_ID`** for Drive/Sheets; API still starts without them. Workspace routes return **503** with *Google workspace integration is not configured.* |
| **Missing `BERT_ALLOWED_ORIGINS`** | Set comma-separated exact origins; required for production boot when using credentialed cross-origin clients. |
| **HTTP URLs** for public hosts | Use **HTTPS** for **`FRONTEND_URL`** and **`GOOGLE_REDIRECT_URI`** on real domains (warnings may appear for http). |
| **`.sessions` not writable** | Ensure the process user can write to the app directory’s **`.sessions/`** (or mount a writable volume there). |
| **Google redirect mismatch** | **`GOOGLE_REDIRECT_URI`** must match the Google Cloud Console entry character-for-character (scheme, host, path). |
| **Cross-origin `fetch` + cookies** | Set **`BERT_ALLOWED_ORIGINS`** to every exact app origin; API must use **HTTPS** so **`SameSite=None; Secure`** session cookies are stored. See [§9.5](#95-cookies-and-split-origins). |
| **SMTP incomplete** | Does not block API boot; blocks **readiness** only if you later tie readiness to SMTP (current code does **not** require SMTP for readiness—invite mail may still fail until SMTP is set). |

If the process **starts** but **`/api/readiness`** returns **503** in production, read the JSON **`errors`**, **`missingGoogleKeys`**, and **`checks.sessionStoreWritable`** fields.

---

## 8. What not to do

- **Do not commit `.env`** or real secrets to git.
- **Do not** use **`localhost`** in production **`FRONTEND_URL`** (users and Google redirects will break for real customers).
- **Do not log secrets** (API keys, `SESSION_SECRET`, SMTP passwords, OAuth tokens). Use the API’s redacted startup style in production as a baseline; avoid extra debug logging in pilot.
- **Do not change `localStorage` keys** in the client “for deployment”—keys are part of the persisted workspace model; migrations need a deliberate plan.
- **Do not rename role literals** (`Master`, `Admin`, etc.) without a coordinated app + sheet migration.
- **Do not** treat this paid-pilot runbook as **public self-serve launch** readiness—self-serve still needs durable multi-tenant auth, database/billing, abuse controls, and a full security review beyond this document.

---

## 9. Android paid pilot (hosted API + release APK)

This path targets **internal BERT operators** provisioning customer workspaces from a **release-signed** Android build that talks to **`https://api.usebert.co.uk`** (not loopback).

### 9.1 API host

1. Deploy the Node API (`server/server.mjs`) to **`https://api.usebert.co.uk`** with **`NODE_ENV=production`** and the [required environment variables](#2-required-environment-variables) (especially **`SESSION_SECRET`**, Google OAuth, **`FRONTEND_URL`**, **`GOOGLE_REDIRECT_URI`** matching this deployment).
2. Ensure **`.sessions/`** on the API host is writable and contains:
   - **`google-session.json`** after an operator completes **Connect Google** on the API (server-side Drive/Sheets access).
   - **`master-operators.json`** — created/updated only on the server via **`npm run seed:master`** (never ship Master passwords inside the mobile bundle).

### 9.2 Seed a Master operator (on the API host)

With **`BERT_MASTER_SEED_SECRET`** set in the API environment (see **`.env.example`**):

```bash
npm run seed:master -- --email <ops@yourorg.example> --name "Operator" --password '<strong-password>' --confirm
```

Verify Master auth against the live API (no secrets in logs):

```bash
curl -sS -X POST "https://api.usebert.co.uk/api/auth/master/login" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://bert-app.onrender.com' \
  -d '{"email":"<ops@yourorg.example>","password":"<strong-password>"}' | head -c 200
```

Expect JSON with **`"ok":true`** and a **`Set-Cookie`** for the Master session on success.

### 9.3 Pilot APK build (from this repo)

- **Do not** set **`VITE_ENABLE_DEMO_LOGIN=true`**, **`VITE_SHOW_DEBUG_UI=true`**, or embed demo passwords for pilot builds.
- Build the web bundle with the hosted API base, verify, sync Capacitor, then produce the release APK:

```bash
npm run android:apk:pilot
```

That runs **`scripts/build-android-pilot-release-apk.sh`** (production API build, pilot dist verification, **`npx cap sync android`**, **`assembleRelease`**). For tablet sideload without a release keystore, use **`npm run android:apk:pilot:debug`** instead (debug-signed **`app-debug.apk`**).

Each APK build **bumps a monotonic build number** (stored in **`android/pilot-build.properties`**, committed to git). Desktop output includes a numbered file, e.g. **`~/Desktop/bert-pilot-debug-build7.apk`**, plus a **`bert-pilot-debug.apk`** alias for the latest build. The same number appears on the Android sign-in screen and in Godmode (Settings → Initial Setup).

**Note:** Do not chain **`npm run android:sync`** after a pilot web build — **`android:sync`** runs a plain **`npm run build`** and can overwrite **`dist`** without **`VITE_API_BASE_URL`**. Pilot scripts sync only after the production API bundle is built.

### 9.4 Tablet kiosk mode (Android pilot)

BERT includes **app-level kiosk mode** on Capacitor Android (immersive UI, Back consumed, logout → sign-in only). It is **on by default** on new tablet installs until Master disables it.

| Layer | What it blocks | How to configure |
|-------|----------------|------------------|
| **App kiosk** | Accidental Back exit; shows full-screen BERT | Enabled by default; Master → Setup → Initial Setup (Godmode) → **Kiosk mode** |
| **Screen Pinning** | Home / Recents while pinned | Recents → Pin BERT (per device) |
| **MDM / Device Owner** | OS-level kiosk, Lock Task | Android Enterprise policy allowlisting `co.usebert.app` |

**Limitation:** APK code alone cannot block Android Home, Settings, or Recents. For production pilots, use **Screen Pinning** for a quick fix or **MDM kiosk** for real lockdown. Details: `docs/android-tablet-kiosk.md`.

**Disable app kiosk (Master):** Godmode → **Disable tablet kiosk mode** (confirmation). Staff may then see system bars; use Screen Pinning or MDM if the tablet must stay on BERT only.

**API CORS:** keep `https://localhost` (Capacitor WebView origin) in `BERT_ALLOWED_ORIGINS` for cookie auth.

### 9.5 Device flow (operator)

1. Install the pilot APK.
2. On the **sign-in** screen, open **Workspace setup (Master only)** (or load the app with **`?setup=master`** in the URL) to reach the Master-only sign-in card.
3. Sign in with the **Master email** and password from **`seed:master`** (server-checked; not stored in the APK).
4. After sign-in, the app opens **Onboarding (workspace setup)** in a **narrow shell** until you choose **Account → Open full BERT navigation** or sign out. Company staff without Master accounts never see the Master-only portal by default.
5. **Connect Google** runs against the **hosted API** origin; complete OAuth in the system browser / WebView as configured.

### 9.6 Cookies and split origins

When the SPA is served from a different origin than the API (static app host vs `api.usebert.co.uk`), or when the Android shell uses a **`capacitor://`** (or **`http://localhost`**) document origin while calling **`https://api…`**, the client uses **`fetch(..., { credentials: "include" })`**. The API then needs:

1. **CORS** — Set **`BERT_ALLOWED_ORIGINS`** to every exact **`Origin`** the app may send (include **`https://app.usebert.co.uk`**, **`https://bert-app.onrender.com`**, **`capacitor://localhost`**, and local Vite preview origins if used). The API reflects **`Access-Control-Allow-Origin`** to that exact value and sets **`Access-Control-Allow-Credentials: true`**. Do **not** use a wildcard origin with credentials.
2. **Session cookies** — In **`NODE_ENV=production`** (or when **`BERT_COOKIE_SAMESITE_NONE=true`**), BERT sets **`bert_master_session`** / **`bert_company_session`** as **`SameSite=None; Secure; HttpOnly; Path=/`** (signed). **`SameSite=None` requires `Secure`**, so the API must be served over **HTTPS** in production. Logout and invalid-session paths clear cookies with the **same** attributes so WebViews drop them reliably.

If Master session cookies are dropped, sign-in may return **`200`** but **`GET /api/auth/master/session`** stays **`401`** — fix allowlisted origins and TLS before widening the pilot.

Manual checks: **`scripts/verify-cors-cookies.md`**.

## Revision

Update this runbook when hosting provider, domains, or Phase 2+ production architecture (e.g. managed DB for invites) changes.
