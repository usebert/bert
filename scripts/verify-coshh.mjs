#!/usr/bin/env node
/** verify:coshh — COSHH register, assessments, and SDS field wiring. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COSHH_SDS_DRIVE_PATH, mapCoshhRegisterRecord } from "../shared/health-safety.mjs";

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

const missingSds = mapCoshhRegisterRecord({ CoshhId: "c1", ProductName: "Test", Status: "current" });
assert(missingSds.status === "missing_sds", "status: record without SDS flagged missing_sds");

const withSds = mapCoshhRegisterRecord({
  CoshhId: "c2",
  ProductName: "Test",
  SdsDocumentId: "doc-1",
  SdsFileName: "sds.pdf",
});
assert(withSds.status !== "missing_sds", "status: SDS document clears missing SDS flag");

const workspace = read("src/health-safety/CoshhWorkspace.tsx");
assert(workspace.includes("fetchCoshhList"), "workspace: loads COSHH list from API");
assert(workspace.includes("createCoshhRecord"), "workspace: create chemical action wired");
assert(workspace.includes("archiveCoshhRecord"), "workspace: archive action wired");
assert(workspace.includes("restoreCoshhRecord"), "workspace: restore action wired");
assert(workspace.includes("createCoshhAssessment"), "workspace: assessment creation wired");
assert(workspace.includes("sdsDocumentId"), "workspace: SDS document reference fields present");

const constants = read("src/health-safety/constants.ts");
assert(constants.includes("Safety Data Sheets"), "documents: SDS drive path documented");

const service = read("server/health-safety-service.mjs");
assert(service.includes("createCompanyCoshh"), "service: COSHH create handler");
assert(service.includes("listCoshhAssessments"), "service: assessments list handler");

const search = read("src/services/searchAdapters/globalSearchAdapters.ts");
assert(search.includes('kind: "coshh"'), "search: COSHH products indexed");

const pkg = JSON.parse(read("package.json"));
assert(Boolean(pkg.scripts?.["verify:coshh"]), "package.json defines verify:coshh");

console.log(`verify:coshh passed (${caseCount} checks).`);
