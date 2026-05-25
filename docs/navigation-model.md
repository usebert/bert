# BERT navigation model

Navigation is driven by **`src/config/roleNavigation.ts`** (labels and order) and **`src/permissions.ts`** (access rules). The shell in `App.tsx` hides items the role cannot use and redirects blocked routes to Dashboard.

## Primary menus by role

### Master / Godmode

| Label | Screen | Notes |
|-------|--------|--------|
| Dashboard | `dashboard` | Platform readiness card |
| Platform Setup | `setup` | Hub → Initial Setup (Godmode) |
| Companies | `companies` | All company folders |
| Company Onboarding | `onboarding` | New company workspace email |
| Users & Invites | `users` | Combined user + invite management; area assignment when restrictions on |
| Templates | `schedules` | Schedule / template tooling |
| Reports / Diagnostics | `reports` | Platform diagnostics |
| Tablet / Kiosk | `setupInitial` | Godmode kiosk controls |

### Company Admin

| Label | Screen |
|-------|--------|
| Dashboard | `dashboard` |
| Workspace | `admin` | Sites / Areas management for the linked company |
| Users & Invites | `users` |
| Forms & Checks | `audits` |
| Reports | `reports` |
| Tablet / Kiosk | `settings` | Info + account tools (kiosk configured by Master on device) |

### Manager

| Label | Screen |
|-------|--------|
| Dashboard | `dashboard` |
| Forms & Checks | `audits` |
| Reports | `reports` |
| Team | `invites` |

### Auditor / tablet

| Label | Screen |
|-------|--------|
| Today | `dashboard` |
| My Checks | `audits` |
| Submit | `incidents` |
| History | `sync` |

## Protected routes

Direct URLs such as `/setup/initial` are cleared for non-Master users. Blocked screens show **Setup is only available to the BERT platform owner** or redirect via the route-guard `useEffect` in `App.tsx`.

## Sites / Areas (Workspace admin)

Optional per-company. **Master** manages areas for the selected folder under **Companies** and in **Users & Invites**. **Company Admin** manages areas under **Workspace** (full setup) and **Users & Invites** (site context + user assignment).

- Restrictions off (default): single-workspace mode (`area-main`) — no area filter for Managers/Auditors.
- Restrictions on: assign Managers/Auditors to areas in **Users & Invites**; audits/schedules can still be scoped separately.
- **Area audits** (Workspace / Companies): map audit templates to areas via `AreaAudits` sheet tab.
- **Forms & Checks** audit access matrix controls *which* checks a user can open; area access controls *where*; schedules control *when* (helper copy on that screen).

## Section helper copy

Defined in `src/config/sectionIntros.ts` and shown via `SectionIntro` on major screens (Platform Setup, Workspace, Users & Invites, Company Onboarding, Forms & Checks, Reports / Diagnostics, Tablet / Kiosk).

## Pilot health (Master)

`PilotHealthPanel` on the Master dashboard and **Reports / Diagnostics** calls `/api/health`, `/api/readiness`, `/api/google/status`, and `/api/invites/smtp/status` — no extra backend routes.

## Customising nav

1. Adjust order/labels in `roleNavigation.ts` for the role bucket.
2. Add or tighten rules in `permissions.ts` (`canRoleAccessNavItem` and named helpers).
3. Keep `App.tsx` route guards aligned with the same helpers.

See also `docs/roles-and-permissions.md`.
