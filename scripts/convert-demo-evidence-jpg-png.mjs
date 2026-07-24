#!/usr/bin/env node
/**
 * Convert misnamed .jpg.png Midlands demo evidence assets to genuine JPEG files.
 *
 * Usage:
 *   node scripts/convert-demo-evidence-jpg-png.mjs --anchor-date=2026-07-24
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateImportedAsset } from "../shared/midlands-precast-evidence.mjs";
import {
  assessExistingImage,
  isJpegBuffer,
  processToSpecJpeg,
  readJpegDimensions,
} from "./lib/demo-evidence-image-utils.mjs";
import {
  buildEvidencePlanFromHistory,
  loadMidlandsHistoryForEvidence,
  readArg,
  resolveSessionsRoot,
} from "./lib/demo-evidence-script-utils.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const anchorDate = readArg(process.argv, "--anchor-date") || "2026-07-24";
const sessionsRoot = resolveSessionsRoot(root);
const assetsDir = path.join(
  sessionsRoot,
  "demo-environment-evidence",
  anchorDate,
  "assets",
);
const promptPackPath = path.join(
  sessionsRoot,
  "demo-environment-evidence",
  anchorDate,
  "prompt-pack",
  "evidence-prompts.json",
);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function loadSpecs() {
  const pack = JSON.parse(fs.readFileSync(promptPackPath, "utf8"));
  return new Map(pack.specs.map((spec) => [spec.evidenceId, spec]));
}

async function main() {
  const specs = loadSpecs();
  const history = await loadMidlandsHistoryForEvidence({
    root,
    anchorDate,
    companyFolderId: "demo-folder-midlands-precast-concrete-ltd",
    masterSheetId: "demo-workbook-midlands-precast-concrete-ltd",
    password: "verify-only-placeholder-12",
  });
  const plan = buildEvidencePlanFromHistory(history);
  const planById = new Map(plan.items.map((item) => [item.evidenceId, item]));

  const conversions = [];
  for (let number = 1; number <= 6; number += 1) {
    const evidenceId = `midlands-demo-ev-${String(number).padStart(4, "0")}`;
    const spec = specs.get(evidenceId);
    const planItem = planById.get(evidenceId);
    if (!spec) {
      throw new Error(`Missing prompt spec for ${evidenceId}`);
    }

    const sourcePath = path.join(assetsDir, `${spec.expectedFileName}.png`);
    const targetPath = path.join(assetsDir, spec.expectedFileName);

    if (!fs.existsSync(sourcePath)) {
      const existing = assessExistingImage(targetPath, spec, planItem);
      if (existing.valid) {
        conversions.push({
          evidenceId,
          filename: spec.expectedFileName,
          status: "already-valid",
          dimensions: `${spec.width}x${spec.height}`,
          size: existing.size,
          sha256: sha256(existing.buffer),
        });
        continue;
      }
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    const sourceBuffer = fs.readFileSync(sourcePath);
    const jpegBuffer = await processToSpecJpeg(sourceBuffer, spec);
    if (!isJpegBuffer(jpegBuffer)) {
      throw new Error(`${evidenceId}: conversion did not produce JPEG output`);
    }

    const { width, height } = readJpegDimensions(jpegBuffer);
    if (width !== spec.width || height !== spec.height) {
      throw new Error(`${evidenceId}: converted dimensions ${width}x${height} != ${spec.width}x${spec.height}`);
    }

    fs.writeFileSync(targetPath, jpegBuffer);
    const validation = validateImportedAsset(jpegBuffer, planItem);
    const assessment = assessExistingImage(targetPath, spec, planItem);
    if (!validation.ok || !assessment.valid) {
      fs.unlinkSync(targetPath);
      throw new Error(
        `${evidenceId}: validation failed: ${[...validation.errors, ...assessment.reasons].join("; ")}`,
      );
    }

    fs.unlinkSync(sourcePath);
    conversions.push({
      evidenceId,
      filename: spec.expectedFileName,
      status: "converted",
      dimensions: `${width}x${height}`,
      size: jpegBuffer.length,
      sha256: sha256(jpegBuffer),
      removedSource: path.basename(sourcePath),
    });
  }

  console.log("\nMidlands demo evidence JPEG conversion complete");
  for (const row of conversions) {
    console.log(
      `  ${row.evidenceId} ${row.filename} ${row.dimensions} ${row.size} bytes ${row.status}`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
