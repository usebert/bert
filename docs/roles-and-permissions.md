# BERT roles and permissions

Central rules live in `src/permissions.ts`. Navigation labels and order live in `src/config/roleNavigation.ts`. The UI must use these helpers for nav visibility **and** screen/route guards.

See **`docs/navigation-model.md`** for the full menu matrix.

## Roles

| Role | Scope |
|------|--------|
| **Master** | Platform owner (Godmode). Hosted API Master session. |
| **Admin** | Company workspace administrator. |
| **Manager** | Company operational lead. |
| **Auditor** | Field / tablet user. |

## Platform Setup (Master only)

| Capability | Master | Admin | Manager | Auditor |
|------------|--------|-------|---------|---------|
| **Platform Setup** nav | Yes | No | No | No |
| `/setup`, `/setup/initial` | Yes | Blocked | Blocked | Blocked |
| `GET /api/setup/status` | Yes (API) | No | No | No |

Helpers: `canAccessPilotSetup`, `canAccessGodmodeInitialSetup`.

## Sites / Areas (optional, per company)

Company areas split a workspace by site or department. **Single-location companies can leave area restrictions off** — users see the whole workspace.

| Capability | Master | Admin | Manager | Auditor |
|------------|--------|-------|---------|---------|
| Manage areas (add / rename / archive, enable restrictions) | Yes (selected company in **Companies**; also **Users & Invites**) | Yes (**Workspace** and **Users & Invites**) | No | No |
| Assign users to areas | Yes | Yes | No | No |
| Filtered by assigned areas | No | No | When restrictions on and boxes checked | When restrictions on and boxes checked |

Helpers: `canManageAreas` in `src/permissions.ts`. UI: `SitesAreasPanel` (`src/components/admin/SitesAreasPanel.tsx`). API: `GET/POST/PATCH /api/company-areas/:masterSheetId` (see `server/company-areas.mjs`). Config key `areaRestrictionsEnabled` on the company master sheet.

**Area assignment matrix** appears in **Users & Invites** only when area restrictions are enabled **or** more than one active area exists. With restrictions off and at most one area, the app stays in **single-workspace mode** (no per-user area checkboxes).

## Company operator

| Capability | Master | Admin | Manager | Auditor |
|------------|--------|-------|---------|---------|
| **Companies** (all tenants) | Yes | No | No | No |
| **Workspace** | No | Yes | No | No |
| **Users & Invites** | Yes | Yes | Team only | No |
| **Sites / Areas setup** | Yes (any company) | Yes (own company) | No | No |
| **Company Onboarding** (new tenants) | Yes | No | No | No |
| **Forms & Checks** | Via More | Yes | Yes | My Checks |
| **Reports** | Diagnostics | Yes | Yes | No |

## Invite / user row labels

Admin UI shows:

- **Role:** Admin, Manager, or Auditor
- **Status:** Invite created, Email sent, Awaiting setup, Setup incomplete, Active, Removed

Implemented in `src/utils/inviteStatusDisplay.ts`. Invite rows show **role** and **status** as separate chips (not a single combined line).

## Dangerous actions

| Action | Who | UI |
|--------|-----|-----|
| Disconnect Google Workspace | Master only | Danger zone in Platform Setup / Godmode; confirm before POST |
| Remove user | Master, Admin | `DangerActionButton` on active company users |
| Revoke invite | Master, Admin | `DangerActionButton` on pending invites |

Company Admin must not see Platform Setup, Google disconnect, or platform diagnostics.

## Sites / Areas

| Rule | Detail |
|------|--------|
| **Who manages areas** | Master (any company workspace) and company Admin (own workspace) via `canManageAreas` |
| **Manager** | Cannot create, rename, or archive areas |
| **Auditor** | No area setup UI |
| **Restrictions off** | Single-workspace mode — Managers and Auditors see the whole company workspace |
| **Restrictions on** | Unchecked area boxes = all active areas; checked boxes = restricted to those areas |
| **Storage** | Company master spreadsheet `Areas` tab (created on first area action) and Config key `AreaRestrictionsEnabled`; local workspace state mirrors for offline/demo |

Helpers: `canManageAreas`, `src/utils/companyAreas.ts`, `src/components/admin/SitesAreasPanel.tsx`.

## Verification

1. Master sees **Platform Setup** and **Company Onboarding**; not mixed into company Admin menus.
2. Company Admin sees **Workspace** and **Users & Invites** — not Platform Setup or Companies.
3. Manager sees **Forms & Checks** and **Team** — not Platform Setup.
4. Auditor sees **Today / My Checks / Submit / History** only.
5. Direct `/setup` and `/setup/initial` as non-Master → blocked or redirected.

See `docs/production-launch-checklist.md`.
