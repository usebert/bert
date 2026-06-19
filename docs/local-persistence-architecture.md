# BERT — local persistence architecture (current state)

This note describes how **local browser persistence** works in the React app today, and how it relates to **service modules that exist in the repo but are not wired into the live app entry tree**. It exists so future changes are deliberate and do not accidentally create **split-brain** storage or delete scaffolding without a plan.

---

## Live persistence owner (today)

- **`App.tsx` is the live owner** of client-side persistence for the running UI.
- **Storage key names** are centralised in **`src/config/storageKeys.ts`** (`storageKeys`); `App.tsx` uses those values (often via small aliases) when calling `localStorage.getItem` / `setItem` / `removeItem`.
- **Workspace state** is persisted as a JSON blob under the workspace key (`storageKeys.workspaceState`). That blob includes the **live `syncQueue`** array alongside other workspace fields.
- **`SyncCentreScreen`** does not read `localStorage` for the queue; it receives **`syncQueue` via props** from `App.tsx` and renders status / retry UI accordingly.

---

## Modules present but not used by the live React path

The following modules are **not imported** from `main.tsx` → `App.tsx` → screens as part of normal runtime persistence today:

| Path | Role (design intent) |
|------|----------------------|
| `src/services/localDatabaseService.ts` | Consolidated local DB under **`storageKeys.localDatabaseRoot`** (`qms-precast-local-db-v1`), with collections for workspace, folder links, offline queue, sync queue, audit logs, theme, user, etc. Includes **legacy seed** logic that can read older per-key `localStorage` entries and bootstrap the consolidated blob. |
| `src/services/syncQueueService.ts` | Queue helpers (`buildSyncQueueItem`, `enqueue`, status updates) built on **`localDatabaseService`**. |
| `src/services/auditLogService.ts` | Append/read **`auditLogs`** via **`localDatabaseService`**. |
| `src/services/schemaService.ts` | Thin helpers over **`companySchema`** (required tabs/columns, workspace health derivation). |
| `src/schema/companySchema.ts` | **`CURRENT_SCHEMA_VERSION`**, required sheet tabs/columns, migrations metadata — consumed by the services above and aligned with a **“company sheet”** mental model. |

**Important:** `qms-precast-local-db-v1` is **not** the current live source of truth for the React shell because **`App.tsx` does not call `localDatabaseService`**. Any data under that key may be **stale**, **from older experiments**, or **only written if something else imports these services** in the future.

---

## Behaviour-changing migration

**Wiring `localDatabaseService` / `syncQueueService` / `auditLogService` into `App.tsx` without a designed migration would change runtime behaviour** (who writes what, when, and in which shape). Treat that as a **product/engineering project**, not a small refactor.

---

## Risks

1. **Duplicate persistence paths** — Today: **`App.tsx` + per-key `localStorage` + workspace JSON (including `syncQueue`)**. Latent: **`localDatabaseService`** can read/write the same conceptual data under **`localDatabaseRoot`** and mirror `syncQueue` inside its collections when workspace is saved via that API.
2. **Split-brain local state** — If two code paths both write overlapping concepts (workspace, offline queue, user, theme, sync queue) to **different keys or shapes**, users can see **inconsistent** recovery after reload or offline/online transitions.
3. **Schema version drift** — **`src/schema/companySchema.ts`** exports **`CURRENT_SCHEMA_VERSION`** (e.g. `3.0.0`) used by the unused service layer; **`App.tsx`** also defines a **`CURRENT_SCHEMA_VERSION`** constant (historically a different value). Server code may use its own schema version as well. These must be **reconciled before** any migration that relies on a single version string.
4. **`qms-precast-local-db-v1` not the live source of truth** — Do not assume the consolidated DB reflects what the UI last saved; the UI path is **`App.tsx` → workspace blob (+ other keys)**.
5. **Sync queue duplication risk** — Queue items live **inside persisted workspace state** in the live path. The consolidated DB design also carries **`syncQueue`** in collections and ties it to workspace updates in **`localDatabaseService.saveWorkspaceState`**. Dual writers would need a **single owner** and explicit merge rules.

---

## Recommended future decision (pick one deliberately)

### Option A — Keep current model

Keep **`App.tsx` + `storageKeys` + workspace JSON (with embedded `syncQueue`)** as the **live source of truth**.

- Later: **remove or ignore** unused service scaffolding (e.g. after confirming no native/Capacitor bridge or scripts depend on it), or add **knip ignores** with a comment pointing to this doc.
- Still: **document and align** `CURRENT_SCHEMA_VERSION` strings so “unused” does not mean “forgotten”.

### Option B — Migrate to `localDatabaseService` as single owner

Make **`localDatabaseService`** the **only** writer for local persistence, with a **tested migration** from existing `localStorage` shapes to `qms-precast-local-db-v1` (and optionally deprecation of duplicate writes).

- **Not a small cleanup task** — requires migration design, backwards compatibility, QA of offline/sync, and likely server/schema alignment.
- Must resolve **schema version** and **workspace shape** contract in one place.

---

## Do not change without a migration plan

Do **not** change the following without an explicit **migration / rollout plan**, data back-up guidance, and regression testing:

- **`localStorage` key string values** (including those in `src/config/storageKeys.ts`) — existing user/workspace data depends on them.
- **Workspace state JSON shape** — especially fields consumed on hydrate and anything that includes **`syncQueue`**.
- **`syncQueue` persistence semantics** — ordering, IDs, status strings, and how retries update state.
- **`CURRENT_SCHEMA_VERSION`** — align meaning across client, `companySchema`, server, and any sheet validators before relying on it for migrations.
- **Legacy seed / read behaviour in `localDatabaseService`** — `readLegacySeed` / `readDb` bootstrap paths affect **first-run** behaviour if that module is ever imported; changing them can **rewrite** or **reshape** stored data.

---

## Related files (reference)

- `src/config/storageKeys.ts` — key names.
- `App.tsx` — live `localStorage` read/write and workspace persistence.
- `src/screens/SyncCentreScreen.tsx` — display-only; props-driven queue.
- `src/types/sync.ts` — UI types for sync rows (not the service layer).
- `src/services/localDatabaseService.ts`, `syncQueueService.ts`, `auditLogService.ts`, `schemaService.ts`, `src/schema/companySchema.ts` — **present**; **not wired** to the live React persistence path as of this document.
