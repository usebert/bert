# QMS Precast Upload Bundle

This zip contains the current source bundle for `QMS Precast`.

## What it is

QMS Precast is a tablet-first health and safety audit and compliance app for one company per device.

Core areas:
- Dashboard
- Audits
- Actions
- Report Creator
- Schedules
- Admin
- Sync Centre
- Account Settings

Roles:
- God Mode
- Admin
- Manager
- Auditor

Backend model:
- Google Drive / Google Sheets
- one company workspace per device
- company master sheet with tabs such as Users, Schedule, Actions, Notes, Reports, Config

## Main files

- `App.tsx` - main app UI and state
- `server/server.mjs` - Google workspace/backend helpers
- `src/main.tsx` and `src/index.css` - app entry and styles
- `capacitor.config.ts` and `android/` - Android wrapper

## Notes

- `node_modules`, `dist`, and Android build output are intentionally excluded
- this is a source upload bundle, not a production release package
