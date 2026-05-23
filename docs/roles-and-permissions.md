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

## Company operator

| Capability | Master | Admin | Manager | Auditor |
|------------|--------|-------|---------|---------|
| **Companies** (all tenants) | Yes | No | No | No |
| **Workspace** | No | Yes | No | No |
| **Users & Invites** | Yes | Yes | Team only | No |
| **Company Onboarding** (new tenants) | Yes | No | No | No |
| **Forms & Checks** | Via More | Yes | Yes | My Checks |
| **Reports** | Diagnostics | Yes | Yes | No |

## Invite / user row labels

Admin UI shows:

- **Role:** Admin, Manager, or Auditor
- **Status:** Invite created, Email sent, Awaiting setup, Setup incomplete, Active, Removed

Implemented in `src/utils/inviteStatusDisplay.ts`.

## Verification

1. Master sees **Platform Setup** and **Company Onboarding**; not mixed into company Admin menus.
2. Company Admin sees **Workspace** and **Users & Invites** — not Platform Setup or Companies.
3. Manager sees **Forms & Checks** and **Team** — not Platform Setup.
4. Auditor sees **Today / My Checks / Submit / History** only.
5. Direct `/setup` and `/setup/initial` as non-Master → blocked or redirected.

See `docs/production-launch-checklist.md`.
