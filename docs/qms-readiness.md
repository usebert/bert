# QMS / ISO 9001 readiness (BERT)

BERT helps you keep quality records under control. The product **supports ISO 9001 readiness** — it does **not** certify your organisation.

## UX principles

- Powerful underneath, simple on screen.
- No ISO clause numbers in the main UI.
- No certification claims (“ISO 9001 certified”, etc.).
- **Auditor / tablet:** no QMS admin language in nav.
- **Manager:** operational summary and links (open/overdue actions, evidence, failed checks) — not full registers.
- **Company Admin / Master:** full **QMS Readiness** hub.

## Navigation

| Role | Access |
|------|--------|
| Master | More → QMS Readiness (company workspace when linked) |
| Admin | More → QMS Readiness |
| Manager | More → QMS Readiness (operational mode) |
| Auditor | Hidden |

Implemented in `src/permissions.ts` (`canAccessQmsReadiness*`) and `src/config/roleNavigation.ts`.

## Hub sections

1. **Document control** — local register: title, type, version, owner, status, review date, file link.
2. **Training records** — person, training name, status, expiry, evidence.
3. **Non-conformances** — links to existing `NonConformanceScreen` (no duplicate NCR store).
4. **Corrective actions** — links to `ActionsScreen`.
5. **Risks and opportunities** — lightweight risk register.
6. **Management review pack** — in-app preview from live checks, findings, NCRs, actions, registers.

## Data storage

Workspace `localStorage` blob (`storageKeys.workspaceState`):

| Key | Purpose |
|-----|---------|
| `qmsDocuments` | Controlled document register |
| `qmsTraining` | Training competence register |
| `qmsRisks` | Risk / opportunity register |

Reused from the core operating loop (no duplication):

- `actions`, `nonConformances`, `auditFindings`, `history`, `reportInbox`

Optional future sync: company master sheet tabs `QMSDocuments`, `QMSTraining`, `QMSRisks` (same column shapes as registers).

## Summary widget

Shown on Company Admin and Manager dashboards and at the top of the QMS Readiness screen:

- Documents needing review
- Training expiring soon
- Open non-conformances
- Overdue corrective actions
- Risks needing review
- Management review pack status

Logic: `src/utils/qmsReadiness.ts`.

## Related docs

- [bert-core-operating-loop.md](./bert-core-operating-loop.md) — checks, findings, actions, reports loop
- [roles-and-permissions.md](./roles-and-permissions.md) — role gates
