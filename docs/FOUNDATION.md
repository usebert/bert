# BERT Users & Auth Foundation

This document maps the **current** architecture to the **target** foundation rebuilt in this branch. All company-user reads and auth flows must go through the canonical modules listed here — not ad-hoc sheet reads, cache paths, or localStorage identity.

## Drive layout — folder → workbook → Users tab

Every company in BERT follows the same Google Drive structure used by Live Companies discovery:

```
Live Companies/
  └── {companyFolderId}/          ← company = this folder (companyId = companyFolderId)
        └── BERT Master Sheet       ← masterSheetId = spreadsheet file inside the folder
              └── Users tab         ← all people for this company
```

| Concept | Meaning | Never confuse with |
|---------|---------|-------------------|
| `companyFolderId` | Google Drive folder id under Live Companies | Registry workspace id, masterSheetId, folder name |
| `companyId` | Always equals `companyFolderId` | masterSheetId, stale cookie companyName |
| `masterSheetId` | The **workbook file** inside the company folder | The company folder itself |
| Users tab | All Email+Name rows in that workbook (not DELETED/REMOVED) | Auth index alone, server cache alone |

**Hard rules**

1. **Company discovery** — a folder under Live Companies is a company; `companyId` = `companyFolderId`.
2. **Workbook resolution** — `masterSheetId` is the BERT Master Sheet spreadsheet **inside** that folder (same template every company gets).
3. **Users tab reads** — call `readCompanyUsers(auth, masterSheetId, …)` directly; workbook scope means **no company-column filter**. Every row with Email + Name (excluding DELETED/REMOVED) is a company profile.
4. **Folder placement** — validated for diagnostics, invites, and Godmode setup; **never blocks** reading `masterSheetId` or loading People/assignees when the workbook id is known. Placement failures surface as `folderPlacementOk: false` warnings only.
5. **Session at login** — cookie stores both `companyFolderId` and `masterSheetId` resolved from folder/workbook (via auth index + Users tab row columns + live validation on refresh).
6. **End-to-end chain** — People, schedule assignees, login, and invite all resolve: `companyFolderId` → `masterSheetId` → Users tab.

Schema reference: Dovecote Studio BERT Master Sheet (Users tab headers include Email, Name, Role, AccessLevel, Status, CompanyAreas, PasswordHash, Company, CompanyId, CompanyFolderId, plus legacy/wide columns).

## Source of truth

| Domain | Source of truth | Never trust for identity |
|--------|-----------------|--------------------------|
| Company users (People, assignees, login) | Company workbook **Users** tab (`PasswordHash`, header-name reads) | Auth index alone, server cache alone, localStorage, registry name guesses |
| Company identity | Google Drive **company folder id** = `companyId` = `companyFolderId` | Stale cookie companyName, login hints, legacy localStorage keys |
| Workbook id | Spreadsheet file inside company folder = `masterSheetId` | Treating folder id as sheet id |
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

- `server/company-folder-resolver.mjs` — folder → workbook resolution (`resolveCompanyFromFolder`)
- `server/company-user-sheet-flow.mjs` — sheet row reads, invite completion, login row lookup
- `server/users-tab-reader.mjs` — Users tab resolution and raw row reads from `masterSheetId`
- `server/users-tab-profiles.mjs` — workbook-scoped profile mapping (`listableProfilesFromUsersTabRecords`)
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
5. Session cookie stores `companyFolderId` + `masterSheetId` + `companyName`
6. Live Drive validation queued **after** HTTP response

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

Query/body must pass `masterSheetId` (workbook file id). Routes fall back to session `companyFolderId` + `masterSheetId` when omitted.

## Failure areas addressed

| # | Failure | Foundation fix |
|---|---------|----------------|
| 1 | People page users don't load | Single `listCompanyProfiles` path; workbook-scoped Users tab read; cache/session fallback only when sheet truly empty |
| 2 | Assignees ≠ People | `getAssignableUsers` → `listCompanyProfiles` → same Users tab rows |
| 3 | Login slow/broken | Fast auth-index login; Users tab reconcile only when needed; bg jobs after response |
| 4 | Stale company names (Rock Solid) | Boot purge + session `companyContextValid`; live name from Drive on validate |
| 5 | Godmode/company sessions mixed | Separate login paths; Godmode UI uses Master role gate; clear godmode folder on company login |
| 6 | Invite → Users tab but login fails | Invite complete writes hash + rebuilds index; login verifies from Users tab fallback |

## Verification

```bash
npm run verify:bert-foundation    # holistic — all 6 failure areas
npm run verify:company-members    # includes Dovecote xlsx fixture (3 users)
npm run verify:schedule-assignees
npm run verify:auth
npm run verify:bert-core-foundation
npm run verify:company-user-session-context
npm run verify:company-folder-source-of-truth
```

## Deploy notes

After merge, deploy **both** API (`server/`) and frontend (`dist/`). The foundation is server-side; frontend must use the rebuilt bundle with `APP_CONTEXT_VERSION` bump to purge stale localStorage company identity on first load.
