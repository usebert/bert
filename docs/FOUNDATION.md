# BERT Users & Auth Foundation

This document maps the **current** architecture to the **target** foundation rebuilt in this branch. All company-user reads and auth flows must go through the canonical modules listed here — not ad-hoc sheet reads, cache paths, or localStorage identity.

## Source of truth

| Domain | Source of truth | Never trust for identity |
|--------|-----------------|--------------------------|
| Company users (People, assignees, login) | Company workbook **Users** tab (`PasswordHash`, header-name reads) | Auth index alone, server cache alone, localStorage, registry name guesses |
| Company identity | Google Drive **company folder id** = `companyId` = `companyFolderId` | Stale cookie companyName, login hints, legacy localStorage keys |
| Godmode / platform admin | `master-operators.json` via `performMasterLogin` | Company Users tab, auth index |
| Folder placement | Under Live Companies when configured | Hard block on reads when `masterSheetId` is known — placement is a **warning** only |

## Module map

### Server — `server/company-users-foundation.mjs` (canonical)

| Function | Purpose | Used by |
|----------|---------|---------|
| `resolveCompanyContextFromSession(auth, deps, session)` | Resolve `companyFolderId`, `masterSheetId`, `companyName` from session/API actor | Routes, list path |
| `readUsersTabProfiles(auth, deps, companyContext)` | Read Users tab rows (header names, old+new schema, workbook-scoped) | Internal to list path |
| `syncCompanyUsersCache(deps, companyContext, profiles)` | Rebuild server `company-users-cache.json` after sheet read | Internal to list path |
| `listCompanyProfiles(auth, deps, companyContext)` | **Single entry** — resolve context, read sheet, sync cache, return sanitized profiles | GET `/users`, assignees, Godmode People, re-sync |
| `syncAndListActiveUsers` | Alias of `listCompanyProfiles` (backward compat) | Existing callers |
| `rebuildUsersFromSheet` | Re-sync alias with cache reconciliation metadata | POST re-sync, background jobs |

Supporting modules (implementation detail — do not call directly from routes):

- `server/company-user-sheet-flow.mjs` — sheet row reads, invite completion, login row lookup
- `server/company-users.mjs` — Users tab writes, password hash, row updates
- `server/company-context-service.mjs` — folder/workbook/registry field resolution
- `server/auth-service.mjs` — `performCompanyLogin`, `performMasterLogin` (separate paths)
- `server/user-auth-service.mjs` — Users tab password verify, auth index rebuild after invite

### Client — `src/services/companyUserService.ts`

| Function | Purpose |
|----------|---------|
| `resolveCompanyMembersLoadContext` (in `companyContextService.ts`) | `companyFolderId` + `masterSheetId` from session-linked context |
| `syncAndListActiveUsers` / `fetchCompanyMembers` | GET `/api/companies/:id/users` — same path for page load and Re-sync |
| Boot (`runAppContextBootstrap`) | Session wins over localStorage; purge stale `companyName` and caches |

## Auth foundation

### Company login (`performCompanyLogin`)

1. Auth index lookup (fast, no Drive/Sheets in request path)
2. Users tab fallback when index miss or password hash stale
3. Password via shared `hashPassword` / `verifyPassword` helpers
4. Structured errors (`reasonCode`, `failedStep`) — no thrown background jobs blocking response
5. Live Drive validation queued **after** HTTP response

### Godmode login (`performMasterLogin`)

- `admin@usebert.co.uk` (platform owner) — **master-operators.json only**
- Rejected from company login path with `platform_owner_master_only`
- Selected company context is workspace selection, not company-user session

### Invite complete

1. Write row to Users tab (`completeInviteToUserRow`)
2. Verify hash written
3. Rebuild auth index (`rebuildAuthIndexFromUsersTab` / `rebuildCompanyAuthIndexFromSheet`)
4. User can log in on next attempt via index or Users tab fallback

## Route contract

All of these must call `listCompanyProfiles` (via foundation):

- `GET /api/companies/:companyId/users`
- `GET /api/companies/:companyId/schedule-assignees`
- Godmode People (`listGodmodeCompanyUsers`)
- `POST` re-sync / rebuild users from sheet

## Failure areas addressed

| # | Failure | Foundation fix |
|---|---------|----------------|
| 1 | People page users don't load | Single `listCompanyProfiles` path; cache/session fallback only when sheet truly empty |
| 2 | Assignees ≠ People | `getAssignableUsers` → `listCompanyProfiles` → same Users tab rows |
| 3 | Login slow/broken | Fast auth-index login; Users tab reconcile only when needed; bg jobs after response |
| 4 | Stale company names (Rock Solid) | Boot purge + session `companyContextValid`; live name from Drive on validate |
| 5 | Godmode/company sessions mixed | Separate login paths; Godmode UI uses Master role gate; clear godmode folder on company login |
| 6 | Invite → Users tab but login fails | Invite complete writes hash + rebuilds index; login verifies from Users tab fallback |

## Verification

```bash
npm run verify:bert-foundation    # holistic — all 6 failure areas
npm run verify:company-members
npm run verify:schedule-assignees
npm run verify:auth
npm run verify:bert-core-foundation
```

## Deploy notes

After merge, deploy **both** API (`server/`) and frontend (`dist/`). The foundation is server-side; frontend must use the rebuilt bundle with `APP_CONTEXT_VERSION` bump to purge stale localStorage company identity on first load.
