#!/usr/bin/env node
/** Shared-drive vs folder-root workspace checks — keep in sync with server/google-workspace-root.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_ROOT_FOLDER,
  WORKSPACE_ROOT_FOLDER_WARNING,
  WORKSPACE_ROOT_INACCESSIBLE_ERROR,
  WORKSPACE_ROOT_SHARED_DRIVE,
  inspectConfiguredWorkspaceRoot,
  listFolderChildren,
} from "../server/google-workspace-root.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function createMockGoogle({ driveGet, filesGet, listFiles }) {
  return {
    drive: () => ({
      drives: {
        get: driveGet,
      },
      files: {
        get: filesGet,
        list: listFiles,
      },
    }),
  };
}

/** 1: Shared Drive ID resolves via drives.get */
{
  const google = createMockGoogle({
    driveGet: async () => ({ data: { id: "drive-1", name: "BERT Workspace" } }),
    filesGet: async () => {
      throw new Error("files.get should not run for shared drive");
    },
    listFiles: async () => ({ data: { files: [] } }),
  });
  const result = await inspectConfiguredWorkspaceRoot({}, google, "drive-1");
  assert(result.ok && result.kind === WORKSPACE_ROOT_SHARED_DRIVE, "1: shared drive resolves via drives.get");
  assert(result.isSharedDrive === true, "1b: shared drive flag set");
}

/** 2: Folder ID resolves via files.get with non-blocking warning */
{
  const google = createMockGoogle({
    driveGet: async () => {
      throw Object.assign(new Error("Shared drive not found"), { code: 404 });
    },
    filesGet: async () => ({
      data: { id: "folder-1", name: "Companies Root", mimeType: "application/vnd.google-apps.folder" },
    }),
    listFiles: async () => ({ data: { files: [] } }),
  });
  const result = await inspectConfiguredWorkspaceRoot({}, google, "folder-1");
  assert(result.ok && result.kind === WORKSPACE_ROOT_FOLDER, "2: folder root resolves via files.get");
  assert(result.warning === WORKSPACE_ROOT_FOLDER_WARNING, "2b: folder root warning message");
}

/** 3: Inaccessible ID returns operator-facing access error */
{
  const google = createMockGoogle({
    driveGet: async () => {
      throw Object.assign(new Error("Shared drive not found"), { code: 404 });
    },
    filesGet: async () => {
      throw Object.assign(new Error("File not found"), { code: 404 });
    },
    listFiles: async () => ({ data: { files: [] } }),
  });
  const result = await inspectConfiguredWorkspaceRoot({}, google, "missing-id");
  assert(!result.ok, "3: inaccessible root fails verification");
  assert(result.error === WORKSPACE_ROOT_INACCESSIBLE_ERROR, "3b: inaccessible error message");
}

/** 4: Folder-root listing does not require corpora=drive */
{
  let listParams = null;
  const google = createMockGoogle({
    driveGet: async () => {
      throw Object.assign(new Error("Shared drive not found"), { code: 404 });
    },
    filesGet: async () => ({
      data: { id: "folder-1", name: "Companies Root", mimeType: "application/vnd.google-apps.folder" },
    }),
    listFiles: async (params) => {
      listParams = params;
      return { data: { files: [{ id: "child-1", name: "Live Companies" }] } };
    },
  });
  const rootInfo = await inspectConfiguredWorkspaceRoot({}, google, "folder-1");
  const children = await listFolderChildren({}, google, rootInfo, "folder-1");
  assert(children.length === 1, "4: folder-root children listed");
  assert(!listParams?.corpora, "4b: folder-root list avoids corpora=drive");
}

/** 5: Company LIVE readiness is not blocked by shared-drive verification */
{
  const registry = read("server/company-workspace-registry.mjs");
  const serverMain = read("server/server.mjs");
  const readinessBlock = registry.slice(
    registry.indexOf("export function evaluateCompanyWorkspaceReadiness"),
    registry.indexOf("export async function ensureCompanyLiveIfReady"),
  );
  assert(!readinessBlock.includes("sharedDrive"), "5: readiness evaluation has no sharedDrive blocker");
  assert(serverMain.includes("sharedDriveWarning"), "5b: google status exposes warnings separately from errors");
  assert(!serverMain.includes("return res.status(500).json({\n        ok: false,\n        configured: true,\n        connected: oauthConnected,\n        googleOAuthConnected: oauthConnected,\n        sharedDriveId"), "5c: google status no longer hard-fails on drive list errors");
  assert(serverMain.includes("inspectConfiguredWorkspaceRoot"), "5d: server uses drives.get/files.get root inspection");
  assert(registry.includes("findSpreadsheetInWorkspaceRoot"), "5e: registry lookup supports folder roots");
}

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:shared-drive-workspace"], "npm script registered");

console.log("[verify:shared-drive-workspace] OK (5 cases)");
