# Foundation gap audit (Dovecote Studio)

Branch: `cursor/onboarding-branding-polish`  
Target: `companyFolderId=1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc`, `masterSheetId=1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So`

## Resolved in this rebuild

| Gap | Fix |
|-----|-----|
| Login blocked on empty `companyName` when folder + workbook valid | `resolveLoginCompanyName` + defer name to background when ids present |
| Invite completion slow (`canLoginCompanyUser` full path) | Direct `verifyCompanyUserPassword` after Users tab write |
| Missing `verify:people-scheduler-consistency` | Added script — People and Scheduler share `listCompanyProfiles` / `getAssignableUsers` |
| Missing `verify:google-forms-folder` alias | npm alias → `verify:company-google-forms-folder` |
| Spec naming `userService` / `googleFormsService` | `server/user-service.mjs` and `server/google-forms-service.mjs` re-export aliases |
| Godmode workbook hint missing in Users panel | Hint shown only when `canShowTechnicalUi` |
| `verify:api-json-contract` / `verify:bert-foundation` doc guards | FOUNDATION.md updated with workbook-scoped reads and folder→workbook chain |

## Still requires live proof (BERT_LIVE_* creds)

| Area | Status |
|------|--------|
| Full milestone: Godmode → Dovecote → invite → login → schedule → check → AuditResults | Static guards pass; live journey needs `BERT_LIVE_*` |
| Dovecote live Users tab (3 ACTIVE rows) | Fixture-verified statically; live sheet read not run in CI |
| End-to-end check completion → Godmode AuditResults | `verify:check-completion` static only without live API |

## Intentionally unchanged (out of scope)

- Reports, graphs, NCRs, document workflows
- Screen-level patches outside foundation routes
- Android `pilot-build.properties`

## Single-path checklist

- **Users / People / assignees:** `company-users-foundation.mjs` → `listCompanyProfiles` / `getAssignableUsers`
- **Login:** `auth-service.mjs` → auth index + Users tab reconcile; no registry gate on request path
- **Invite complete:** `completeInviteToUserRow` → Users tab write → password verify → background auth index rebuild
- **Schedules:** `schedule-service.mjs` → `AssignedUserEmails` on Schedules tab
- **Forms:** `google-forms-service.mjs` → company folder MIME query
