# ISO readiness company folder structure (BERT)

Each company workspace in Google Shared Drive uses six numbered folders. BERT creates them on **new company provision** and **Fix workspace**, matching names **case-insensitively** and preserving existing folders (no duplicates).

## Folder layout

| Folder | Config key (`Config` tab) | Typical content |
|--------|-------------------------|-----------------|
| **01 Company Setup** | `setupFolderId` | Onboarding, workspace config, Company Master Sheet |
| **02 Audit Forms** | `auditFormsFolderId` | Audit/check templates and Google Forms |
| **03 Company Records** | `recordsFolderId` | Audit results, findings, actions, NCRs, training, risks, incidents |
| **04 Evidence** | `evidenceFolderId` | Photos, documents, certificates, action proof uploads |
| **05 Exports** | `exportsFolderId` | Generated reports, audit packs, management review packs |
| **06 Management Notes** | `managementNotesFolderId` | Management review notes, meeting notes, improvement plans |

Folder IDs are stored in the company master sheet **Config** tab only (not shown in routine Manager/Auditor UI).

## Routing (app behaviour)

| Data type | Destination |
|-----------|-------------|
| Setup / config / onboarding | 01 Company Setup |
| Audit / check templates / forms | 02 Audit Forms |
| Audit results, findings, actions, NCR, training, risks, incidents (sheet rows) | 03 Company Records (master sheet tabs) |
| Evidence uploads (files) | 04 Evidence |
| Report exports / packs | 05 Exports (sheet `Reports` tab + export links) |
| Management review / internal follow-up notes | 06 Management Notes |

Legacy workspaces may still have **03 Master Data Sheet** or **06 Admin Notes**; BERT maps those to setup/management notes until **Fix workspace** adds any missing ISO-named folders.

## Workspace health

**Company Admin** (Workspace): run **Check workspace** to see six folder statuses (no raw IDs). If folders or sheet tabs are missing, use **Fix workspace** to create folders safely and refresh Config IDs.

**Auditor / tablet**: no folder setup UI; checks and evidence use the linked workspace automatically.

## Product copy

- Hub: “BERT helps organise records and evidence for ISO 9001 and ISO 45001 readiness.”
- Supporting line (once): “Supports ISO 9001 and ISO 45001 readiness. Certification is handled externally.”

BERT supports readiness only; certification is external.
