# Manual verification — CORS + session cookies (BERT API)

Use against a running API (local or hosted). Do **not** paste secrets, cookies, or tokens into chat logs.

## Prerequisites

- Client uses **`fetch(..., { credentials: "include" })`** (this repo does for API calls).
- API **`BERT_ALLOWED_ORIGINS`** lists every **`Origin`** you test (exact string match), e.g.  
  `https://app.usebert.co.uk,capacitor://localhost,http://localhost:5173`
- Production or **`BERT_COOKIE_SAMESITE_NONE=true`**: API served over **HTTPS** ( **`SameSite=None` requires `Secure`** ).

## Preflight (browser devtools or curl)

From an allowed Origin, a preflight should succeed:

```bash
curl -sS -D - -o /dev/null -X OPTIONS "https://api.example.com/api/auth/master/session" \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: content-type"
```

Expect **HTTP 204** and response headers including:

- **`Access-Control-Allow-Origin`**: exactly the request **`Origin`** (not `*`)
- **`Access-Control-Allow-Credentials: true`**
- **`Access-Control-Allow-Methods`** includes **GET**, **POST**, **OPTIONS**
- **`Access-Control-Allow-Headers`** includes **Content-Type** and **X-Bert-Tool-Secret** (if you use the migration tool header)

Repeat with an Origin **not** in the allowlist: **204** without **`Access-Control-Allow-Origin`** is normal (browser will block the real request).

## Set-Cookie (Master / company)

1. **POST** `/api/auth/master/login` (or company login after Google session is connected on the server).
2. Inspect **`Set-Cookie`** on success:
   - **`HttpOnly`**, **`Path=/`**, signed cookie name (`bert_master_session` / `bert_company_session`).
   - Production or **`BERT_COOKIE_SAMESITE_NONE=true`**: **`SameSite=None`** and **`Secure`**.
   - Local dev without that flag: **`SameSite=Lax`**, **`Secure`** absent/false.

## Logout clears matching attributes

**POST** `/api/auth/master/logout` or **`/api/auth/company/logout`** should emit **`Set-Cookie`** clearing the session with the **same** **`SameSite`**, **`Secure`**, and **`Path`** as login. If these differ, WebViews may keep sending the old cookie.

## Session after logout

**GET** `/api/auth/master/session` → **401** after Master logout (and company session endpoint after company logout).
