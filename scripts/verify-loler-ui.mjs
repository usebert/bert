#!/usr/bin/env node
/** verify:loler-ui — BERT Equipment/LOLER module Release 6 checks. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const workspace = read("src/loler/EquipmentWorkspace.tsx");
const screen = read("src/screens/LolerScreen.tsx");
const lolerService = read("src/services/lolerService.ts");
const app = read("App.tsx");

assert(Boolean(pkg.scripts?.["verify:loler-ui"]), "package.json defines verify:loler-ui");
assert(workspace.includes("EquipmentWorkspace"), "equipment workspace exists");
assert(workspace.includes("PageContainer"), "uses PageContainer");
assert(workspace.includes("PageHeader"), "uses PageHeader");
assert(screen.includes("EquipmentWorkspace"), "LolerScreen delegates to workspace");
assert(screen.includes("LolerWorkspaceBody"), "LOLER body preserved");
assert(screen.includes("RecordExaminationForm"), "inspection flow connected");
assert(lolerService.includes("recordLolerExamination"), "examination API unchanged");
assert(lolerService.includes("LOLER_OFFLINE_WRITE_MESSAGE"), "offline write guard preserved");
assert(app.includes("<LolerScreen"), "App LOLER route preserved");

console.log(`PASS: verify:loler-ui (${caseCount} checks)`);
