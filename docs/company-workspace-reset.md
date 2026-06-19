# Company workspace reset (Master / Godmode)

Platform **Master** operators can reset **one** company workspace to a clean onboarding state. This is **not** a platform wipe: other companies, Master login, and Google OAuth on the API host are unaffected.

## API

`POST /api/companies/:companyFolderId/reset-workspace`

**Auth**

- Signed-in **Master** session (`bert_master_session`) — company Admin cannot call this route.
- Stored **Google Workspace** OAuth on the API host (`requireGoogleWorkspaceSession`).

**Body**

```json
{
  "masterSheetId": "<company master spreadsheet id>",
  "mode": "clean_onboarding",
  "confirmPhrase": "RESET COMPANY"
}
```

**Modes**

| Mode | Areas tab | AuditTemplates tab |
|------|-----------|-------------------|
| `clean_onboarding` (default) | Kept | Kept |
| `keep_areas_templates` | Kept | Kept |
| `full_operational` | Cleared (headers only) | Cleared (headers only) |

**Blocked targets**

- Archive / archived folder names
- Reserved labels: Live Companies, Master Control, Companies (see `server/invite-target.mjs`)
- Missing `masterSheetId`
- Config `companyId` mismatch vs folder ID

**Preserved**

- Company Drive folder and master spreadsheet file
- Config: `companyId`, `companyName`, `masterSheetId`, ISO folder IDs (`setupFolderId` … `managementNotesFolderId`), schema metadata
- ISO readiness Drive folders 01–06 (files not deleted)

**Cleared (tab headers preserved)**

Users, Config `UserAuth.<email>`, pending app invites (invite store), Onboarding, Schedule, Actions, ActionComments, AuditResults, AuditFindings, Evidence (rows only — **Drive evidence files are not deleted**), Reports, SyncLog, Incidents, IncidentActions, AreaAudits, UserAreaAccess, UserAuditAccess, and optional QMS/Safety tabs when present on the sheet.

**Logging**

`[company-reset] started` / `cleared` / `completed` — folder id and master sheet id prefix only; no passwords or tokens.

## UI

**Companies** (Master pilot nav) → select a company → **Danger zone → Reset company workspace**.

Requires a linked **master sheet** for the selected folder. Type `RESET COMPANY` and choose a mode before confirming.

## Client local state

After a successful reset, if the selected company matches, the app clears operational data in `bert-workspace-state` and reloads sheet-backed users/areas where Google is connected.

## Manual test

1. Sign in as **Master** with Google connected on the API.
2. Open **Companies**, select a test company with a valid master sheet (not Archive / Live Companies / Master Control).
3. Run **Reset company workspace** with `clean_onboarding`, confirm phrase `RESET COMPANY`.
4. Verify Users tab empty (headers only), UserAuth keys removed, invites revoked, operational tabs empty; Config still has company + ISO folder IDs.
5. Confirm Evidence files remain in Drive folder `04 Evidence`.
6. Sign in as a removed company user — login must fail.
7. Company **Admin** must not see the reset panel and receives 403 if calling the API directly.
