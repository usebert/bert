/**
 * Shared helpers for Midlands demo evidence scripts.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildMidlandsEvidencePlan,
  buildEvidenceManifest,
  enrichEvidenceRenderedFile,
  importEvidenceAssets,
  evidenceAssetsDir,
} from "../../shared/midlands-precast-evidence.mjs";
import { encodePng } from "../../shared/midlands-evidence-render.mjs";
import { createSeededRandom } from "../../shared/midlands-history-prng.mjs";
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

export function buildEvidencePlanFromHistory(history) {
  return buildMidlandsEvidencePlan({ history, anchorDate: history.anchorDate });
}

export function createVerifierFixtureImage(item) {
  const rng = createSeededRandom(item.renderSeed >>> 0);
  const rgba = Buffer.alloc(item.width * item.height * 4);
  for (let y = 0; y < item.height; y += 1) {
    for (let x = 0; x < item.width; x += 1) {
      const idx = (y * item.width + x) * 4;
      const noise = Math.floor(rng() * 48);
      rgba[idx] = 90 + noise + (x % 17);
      rgba[idx + 1] = 84 + noise + (y % 13);
      rgba[idx + 2] = 78 + noise;
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(item.width, item.height, rgba);
}

export function writeVerifierFixtureAssets({ plan, assetsDir }) {
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const item of plan.items) {
    const buffer = createVerifierFixtureImage(item);
    fs.writeFileSync(path.join(assetsDir, item.fileName), buffer);
  }
}

export function importLocalEvidenceBundle({ plan, assetsDir, outputDir }) {
  return importEvidenceAssets({ plan, assetsDir, outputDir });
}

export { evidenceAssetsDir };

export function loadImportedEvidenceBundle({ plan, sessionsRoot, anchorDate }) {
  const outputDir = evidenceOutputDir(sessionsRoot, anchorDate);
  const assetsDir = evidenceAssetsDir(sessionsRoot, anchorDate);
  const manifestPath = path.join(outputDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const rendered = manifest.files.map((file) => {
      const localPath = path.join(outputDir, file.fileName);
      const buffer = fs.readFileSync(localPath);
      const enriched = enrichEvidenceRenderedFile(file);
      return {
        ...enriched,
        localPath,
        buffer,
        dataUrl: `data:${enriched.mimeType};base64,${buffer.toString("base64")}`,
      };
    });
    return { rendered, manifest, outputDir, assetsDir };
  }
  return importLocalEvidenceBundle({ plan, assetsDir, outputDir });
}
