# BERT module map

Product flow: **Dashboard → People → Scheduling → Complete Work → Actions/NCRs → Reports**

| Module | Screen id | Nav label (Admin/Manager) | Backend tabs / APIs |
| --- | --- | --- | --- |
| Dashboard | `dashboard` | Dashboard | Schedules, AuditResults, Actions (summary) |
| People / Onboarding | `users` / `invites` | People | Users, Sites, Areas; `/api/companies/:id/invites/*` |
| Scheduling | `schedules` | Schedules | Schedules tab; `GET/POST /api/companies/:id/schedules` |
| Forms & Audits | `audits` / `complete` | Complete Work (Auditor: My Checks) | AuditTemplates, AreaAudits, UserAuditAccess, AuditResults |
| Documents | `documentTraining` | (More / Master) | Evidence; document distribution service |
| Actions | `actions` | Actions | Actions tab |
| NCRs | `nonConformance` | NCRs | AuditFindings, Reports |
| Reports | `reports` | Reports | Reports tab; `GET /api/companies/:id/reports/dashboard` |

Godmode-only: `godmodeHome`, `setup`, `companies`, `onboarding`, Templates (`schedules`), diagnostics (`reports`).
