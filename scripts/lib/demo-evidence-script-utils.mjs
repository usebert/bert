/**
 * Shared helpers for Midlands demo evidence scripts.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildMidlandsEvidencePlan,
  buildEvidenceManifest,
  renderEvidencePlanItem,
  MIDLANDS_EVIDENCE_RUNTIME_DIR,
} from "../../shared/midlands-precast-evidence.mjs";
import { buildMidlandsPrecastSeed } from "../../shared/midlands-precast-seed.mjs";
import { buildMidlandsPrecastHistory } from "../../shared/midlands-precast-history.mjs";

export function readArg(argv, name) {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  const idx = argv.indexOf(name);
  return idx >= 0 ? String(argv[idx + 1] || "").trim() : "";
}

export function resolveSessionsRoot(root) {
  return String(process.env.BERT_SESSIONS_DIR || "").trim()
    ? path.resolve(root, process.env.BERT_SESSIONS_DIR)
    : path.join(root, ".sessions");
}

export function evidenceOutputDir(sessionsRoot, anchorDate) {
  return path.join(sessionsRoot, "demo-environment-evidence", anchorDate);
}

export async function loadMidlandsHistoryForEvidence({
  root,
  anchorDate,
  companyFolderId,
  masterSheetId,
  password,
}) {
  const { hashPassword } = await import(new URL("../../server/master-auth.mjs", import.meta.url).href);
  const phase1 = buildMidlandsPrecastSeed({
    passwordHash: hashPassword(password),
    companyFolderId: companyFolderId || "demo-folder-midlands-precast-concrete-ltd",
    masterSheetId: masterSheetId || "demo-workbook-midlands-precast-concrete-ltd",
  });
  return buildMidlandsPrecastHistory({
    anchorDate: anchorDate || undefined,
    companyFolderId: phase1.companyFolderId,
    phase1Seed: phase1,
  });
}

export function generateLocalEvidenceBundle({ plan, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const rendered = [];
  for (const item of plan.items) {
    const file = renderEvidencePlanItem(item);
    const localPath = path.join(outputDir, file.fileName);
    fs.writeFileSync(localPath, file.buffer);
    rendered.push({
      ...file,
      localPath,
      dataUrl: `data:${file.mimeType};base64,${file.buffer.toString("base64")}`,
    });
  }
  const manifest = buildEvidenceManifest(plan, rendered);
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { rendered, manifest, outputDir };
}

export function buildEvidencePlanFromHistory(history) {
  return buildMidlandsEvidencePlan({ history, anchorDate: history.anchorDate });
}
