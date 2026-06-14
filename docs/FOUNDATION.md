# BERT Foundation Architecture

This document is the canonical map for the BERT company-user foundation rebuilt on branch `cursor/onboarding-branding-polish`. All company identity, users, auth, invites, schedules, and check completion must flow through the shared services below — not ad-hoc sheet reads, cache-only paths, or stale localStorage.

## Core model

```
Live Companies/
  └── {companyFolderId}/                    ← company anchor (companyId = companyFolderId)
        └── 01 - BERT System Files/
              └── Company Workbook/
                    └── {Company Name} - BERT Master Sheet   ← masterSheetId
                          └── Users tab                      ← source of truth for people
```

| Field | Meaning | Never confuse with |
|-------|---------|-------------------|
| `companyFolderId` | Google Drive folder id under Live Companies | Registry workspace id, masterSheetId, folder display name |
| `companyId` | Always equals `companyFolderId` | masterSheetId, stale cookie/localStorage companyName |
| `masterSheetId` | Spreadsheet file **inside** the company folder | The company folder itself |
| `companyName` | From Drive folder name or Config tab at login/resolve | Stale localStorage, login hints, registry guesses |

**Session context shape:** `{ companyId, companyName, companyFolderId, masterSheetId }`

### Hard rules

1. **Company folder = anchor** — discovery starts at `companyFolderId`; folder resolution wins over stale workbook ids.
2. **Workbook naming** — discovery matches both `*BERT Master Sheet*` and `*BERT Workbook*` (e.g. `Dovecote Studio - BERT Master Sheet`).
3. **Users tab = truth** — People, schedule assignees, and login all read the company workbook Users tab.
4. **Auth index = cache only** — rebuilt from Users tab; never the sole source for active user lists.
5. **ACTIVE filter** — `Status=ACTIVE` **and** `CompanyFolderId` matches current folder (missing columns backfilled on read).
6. **No cache-only users** — server cache rebuilt after every successful sheet read; no session fallback as active users; pending invites excluded from active list.

### Dovecote Studio reference ids

| Key | Value |
|-----|-------|
| `companyFolderId` | `1TVQ-gbpxoOzE6PCkHX581eTDgtMC11c` |
| `masterSheetId` | `1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So` |
| Workbook path | `01 - BERT System Files / Company Workbook / Dovecote Studio - BERT Master Sheet` |

## Shared services

### `companyService` — `server/company-service.mjs`

| Function | Purpose |
|----------|---------|
| `resolveCompanyFromFolder(auth, deps, companyFolderId, options)` | Resolve folder → workbook → tabs; registry is cache |
| `findCompanyWorkbook(drive, input)` | Read-only discovery in folder + subfolders (both naming patterns) |
| `ensureCompanyWorkbook(drive, input)` | Find, reuse, or create workbook in Company Workbook folder |
| `ensureRequiredTabs(auth, deps, masterSheetId)` | Ensure Users, Schedules, AuditResults, etc. |

Implementation: `company-folder-resolver.mjs`, `company-folder-structure.mjs`, `ensure-required-tabs.mjs`.

### `userService` — `server/company-user-service.mjs`

| Function | Purpose |
|----------|---------|
| `readUsersTab(auth, deps, companyContext)` | Read Users tab rows (sanitized, no PasswordHash in API) |
| `listActiveUsers(auth, deps, companyContext)` | ACTIVE + CompanyFolderId filter; canonical People/assignee list |
| `repairUsersTabSchema(auth, spreadsheetId, deps, options)` | Backfill headers, company columns, shifted rows |
| `writeUserRow(auth, spreadsheetId, email, updates, deps)` | Patch a Users tab row |
| `rebuildUserCacheFromSheet(auth, deps, companyContext)` | Re-sync server cache from sheet; remove cache-only users |

Canonical list path: `company-users-foundation.mjs` → `listCompanyProfiles`.

### `authService` — `server/auth-service.mjs`

| Function | Purpose |
|----------|---------|
| `platformLogin(deps, input)` | Godmode / master-operators.json only |
| `companyLogin(auth, deps, input)` | Fast auth-index lookup; Users tab fallback for hash verify |
| `rebuildAuthIndexFromUsersTab(...)` | Rebuild sign-in cache from Users tab |
| `verifyPassword(...)` | Shared scrypt verify |

### `inviteService` — `server/invite-service.mjs`

| Function | Purpose |
|----------|---------|
| `createInvite(deps, input)` | Token-only create (no Users tab write) |
| `completeInvite(auth, invite, formData, deps)` | Write Users tab row **before** success response |

### `scheduleService` — `server/schedule-service.mjs`

| Function | Purpose |
|----------|---------|
| `listSchedules(auth, deps, input)` | Read Schedules tab from company workbook |
| `listScheduleAssignees(auth, deps, input)` | Same ACTIVE users as People (`listActiveUsers` path) |
| `saveSchedule(auth, deps, input)` | Save with `AssignedUserEmails` on Schedules tab |

### `completionService` — `server/completion-service.mjs`

| Function | Purpose |
|----------|---------|
| `completeCheck(auth, deps, input)` | Append completed check to AuditResults tab |
| `listResults(auth, deps, input)` | Read AuditResults tab |

## Route contract

All routes must pass `companyFolderId` + `masterSheetId` (workbook file id). Session values used when query/body omits them.

| Route area | Service entry |
|------------|---------------|
| `GET /api/companies/:id/users` | `listActiveUsers` / `listCompanyProfiles` |
| `GET /api/companies/:id/schedule-assignees` | `listScheduleAssignees` |
| `GET/POST /api/companies/:id/schedules` | `listSchedules` / `saveSchedule` |
| `POST /api/auth/company/login` | `companyLogin` |
| `POST /api/auth/master/login` | `platformLogin` |
| Invite complete | `completeInvite` → auth index rebuild |
| Check submit | `completeCheck` |

## Frontend

- **Session wins over localStorage on boot** — `runAppContextBootstrap` + `APP_CONTEXT_VERSION` purge.
- **Clear stale company on login/logout/switch** — `clearStaleCompanyLocalStorage`.
- **Header/title/account** — always from session `companyName`, never stale localStorage.

## Verification

```bash
npm run verify:drive-folder-map
npm run verify:users-from-company-workbook
npm run verify:invite-to-users-tab
npm run verify:schedule-contract
npm run verify:bert-core-foundation    # holistic + extends all of the above
npm run verify:bert-foundation
npm run verify:company-members         # Dovecote xlsx fixture (3 users)
npm run verify:schedule-assignees
npm run verify:auth
npm run verify:company-folder-source-of-truth
npm run verify:company-user-session-context
```

## Deploy notes

After merge, deploy **both** API (`server/`) and frontend (`dist/`). Bump `APP_CONTEXT_VERSION` in `clearStaleCompanyLocalStorage.ts` when company identity semantics change so clients purge stale keys on first load.
