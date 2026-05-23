# BERT roles and permissions

Central rules live in `src/permissions.ts`. The UI must use these helpers for nav visibility **and** screen/route guards.

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
| **Setup** nav item | Yes | No | No | No |
| `/setup` (platform setup screen) | Yes | Blocked | Blocked | Blocked |
| `/setup/initial` (Godmode) | Yes | Blocked | Blocked | Blocked |
| `GET /api/setup/status` | Yes (API) | No | No | No |

Helpers:

- `canAccessPilotSetup(role)` — Setup nav + `setup` screen
- `canAccessGodmodeInitialSetup(role)` — `setupInitial` screen + `/setup/initial`

Non-Master users who open `/setup` or `/setup/initial` see **Setup is only available to the BERT platform owner** and are returned to Dashboard.

## Company operator menu (Master / Admin)

Master and company **Admin** share the paid-pilot operator nav for day-to-day pilot work:

- Dashboard, **Companies**, **Users**, **Invites**, **Settings** (not Setup for Admin)

`usesPilotOperatorNav(role)` is `Master || Admin` — distinct from Setup access.

## Company onboarding

- **Onboarding** nav: Master and company Admin (`canAccessOnboardingNav`)
- **Control** (`admin` screen): company Admin only (`canAccessControlScreen`)

## Verification

After changes, confirm:

1. Master sees **Setup** and can open Initial Setup (Godmode).
2. Company Admin sees Dashboard, Companies, Users — **not** Setup.
3. Manager and Auditor do not see Setup.
4. Direct `/setup` and `/setup/initial` as Admin → blocked message + Dashboard.

See `docs/production-launch-checklist.md` smoke section.
