# Quality & Safety / ISO 9001 & ISO 45001 readiness (BERT)

**Quality & Safety Hub** — keep checks, actions, documents, training, risks, and evidence under control.

Supports ISO 9001 and ISO 45001 readiness. Certification is handled externally.

## UX principles

- Powerful underneath, simple on screen.
- No ISO clause numbers in the main UI.
- No certification claims.
- **Auditor / tablet:** Today, My Checks, Submit, History only — no ISO or H&S admin wording.
- **Manager:** operational summary and links (hazards, incidents, actions, evidence) — not full registers.
- **Company Admin / Master:** full **Quality & Safety Hub**.

## Navigation

| Role | Access |
|------|--------|
| Master | More → Quality & Safety Hub |
| Admin | More → Quality & Safety Hub |
| Manager | More → Quality & Safety Hub (operational mode) |
| Auditor | Hidden |

Implemented in `src/permissions.ts` (`canAccessQmsReadiness*`) and `src/config/roleNavigation.ts`.

## Hub sections

### Quality (ISO 9001 readiness)

1. **Document control** — title, type, version, owner, status, review date, file link.
2. **Training records** — person, training name, status, expiry, evidence.
3. **Quality issues** — links to existing `NonConformanceScreen`.
4. **Corrective actions** — links to `ActionsScreen`.
5. **Risks and opportunities** — lightweight quality risk register.
6. **Review pack** — preview from live workspace data.

### Health & safety (ISO 45001 readiness)

1. **Hazard reports** — hazardId, areaId, description, severity, immediateAction, owner, status, evidenceIds, createdAt, closedAt.
2. **Incidents & near misses** — reuses `IncidentReportingScreen` / `incidents` workspace store (no duplicate register).
3. **Risk assessments** — activity-based H&S assessments with likelihood, severity, riskScore, controls, reviewDate.
4. **Emergency preparedness** — links to existing audit/check templates (fire exit, spill kit, etc.) via Forms & checks.
5. **Safety observations** — observation, suggestion, optional `actionId` link to corrective actions.
6. **H&S objectives** — objective, target, owner, currentValue, dueDate, status.

## Data storage

Workspace `localStorage` blob (`storageKeys.workspaceState`):

| Key | Purpose |
|-----|---------|
| `qmsDocuments` | Controlled document register |
| `qmsTraining` | Training competence register |
| `qmsRisks` | Quality risk / opportunity register |
| `hsHazardReports` | Hazard reports |
| `hsRiskAssessments` | H&S risk assessments |
| `hsSafetyObservations` | Safety observations |
| `hsObjectives` | H&S objectives |

Reused from the core operating loop (no duplication):

- `actions`, `nonConformances`, `auditFindings`, `history`, `reportInbox`
- `incidents`, `incidentActions`

Optional future sync: company master sheet tabs for each register (same column shapes as in-app fields).

## Summary widget

Shown on Company Admin and Manager dashboards and at the top of the readiness hub:

- Documents to review
- Training expiring
- Open quality issues
- Overdue actions (quality + incident actions combined)
- Open safety hazards
- Incidents & near misses
- Quality risks
- Safety risks
- Safety objectives
- Review pack status

Logic: `src/utils/qmsReadiness.ts` (`buildQmsReadinessSummary`).

## Review pack

Preview includes quality and safety:

- Completed checks and findings
- NCRs, incidents/near misses, hazards
- Corrective actions (open/overdue)
- Training, quality risks, safety risk reviews
- H&S objectives, evidence, repeat issues

## Related docs

- [bert-core-operating-loop.md](./bert-core-operating-loop.md)
- [roles-and-permissions.md](./roles-and-permissions.md)
- [qms-readiness.md](./qms-readiness.md) — legacy filename; see this document for current scope
