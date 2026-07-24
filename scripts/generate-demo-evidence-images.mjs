#!/usr/bin/env node
/**
 * Batch-generate Midlands demo evidence images via the OpenAI Images API.
 *
 * Usage:
 *   npm run generate:demo-evidence-images -- --dry-run
 *   OPENAI_API_KEY='...' npm run generate:demo-evidence-images -- --start=0007 --end=0015 --confirm-generation=yes
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPENAI_IMAGES_URL,
  GPT_IMAGE_MODEL,
  GPT_IMAGE_2_API_SIZES,
  assessExistingImage,
  buildOpenAiImageRequestBody,
  estimateGenerationCost,
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

const DEFAULT_ANCHOR_DATE = "2026-07-24";
const DEFAULT_QUALITY = "medium";
const DEFAULT_DELAY_MS = 1500;
const MAX_RETRIES = 2;
const SKIP_EVIDENCE_NUMBERS = new Set([1, 2, 3, 4, 5, 6]);
const REPORT_FILE_NAME = "image-generation-report.json";

const argv = process.argv.slice(2);
const anchorDate = readArg(argv, "--anchor-date") || DEFAULT_ANCHOR_DATE;
const dryRun = argv.includes("--dry-run");
const overwrite = argv.includes("--overwrite");
const startArg = readArg(argv, "--start");
const endArg = readArg(argv, "--end");
const delayMs = Number(readArg(argv, "--delay-ms") || DEFAULT_DELAY_MS);
const quality = readArg(argv, "--quality") || DEFAULT_QUALITY;
const confirmGeneration = readArg(argv, "--confirm-generation");

const sessionsRoot = resolveSessionsRoot(root);
const promptPackPath = path.join(
  sessionsRoot,
  "demo-environment-evidence",
  anchorDate,
  "prompt-pack",
  "evidence-prompts.json",
);
const outputDir = path.join(
  sessionsRoot,
  "demo-environment-evidence",
  anchorDate,
  "assets",
);
const reportPath = path.join(outputDir, REPORT_FILE_NAME);

function parseEvidenceNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/(\d+)$/);
  if (!match) {
    throw new Error(`Invalid evidence ID or range value: ${value}`);
  }
  return Number.parseInt(match[1], 10);
}

function evidenceNumber(evidenceId) {
  return parseEvidenceNumber(evidenceId);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactSecrets(text) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return text;
  return text.split(apiKey).join("[REDACTED]");
}

function loadPromptPack() {
  if (!fs.existsSync(promptPackPath)) {
    throw new Error(`Prompt pack not found: ${promptPackPath}`);
  }
  const pack = JSON.parse(fs.readFileSync(promptPackPath, "utf8"));
  if (!Array.isArray(pack.specs) || pack.specs.length === 0) {
    throw new Error(`Prompt pack has no specs: ${promptPackPath}`);
  }
  return pack;
}

function selectSpecs(specs) {
  const start = startArg ? parseEvidenceNumber(startArg) : null;
  const end = endArg ? parseEvidenceNumber(endArg) : null;

  return specs
    .filter((spec) => {
      const number = evidenceNumber(spec.evidenceId);
      if (SKIP_EVIDENCE_NUMBERS.has(number)) return false;
      if (start != null && number < start) return false;
      if (end != null && number > end) return false;
      return true;
    })
    .sort((a, b) => evidenceNumber(a.evidenceId) - evidenceNumber(b.evidenceId));
}

async function loadPlanItemsById() {
  const history = await loadMidlandsHistoryForEvidence({
    root,
    anchorDate,
    companyFolderId: "demo-folder-midlands-precast-concrete-ltd",
    masterSheetId: "demo-workbook-midlands-precast-concrete-ltd",
    password: "verify-only-placeholder-12",
  });
  const plan = buildEvidencePlanFromHistory(history);
  return new Map(plan.items.map((item) => [item.evidenceId, item]));
}

async function generateImage({ apiKey, spec }) {
  const requestBody = buildOpenAiImageRequestBody({ spec, quality });
  const response = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${redactSecrets(rawText).slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = payload?.error?.message || redactSecrets(rawText).slice(0, 300);
    const code = payload?.error?.code ? ` [${payload.error.code}]` : "";
    throw new Error(`OpenAI Images API ${response.status}${code}: ${message}`);
  }

  const imageBase64 = payload?.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("OpenAI Images API response did not include data[0].b64_json");
  }

  return {
    requestBody,
    buffer: Buffer.from(imageBase64, "base64"),
  };
}

function writeReport(report) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function progressLine(message) {
  process.stdout.write(`${message}\n`);
}

function printCostSummary({ toGenerate, quality: q }) {
  const estimatedCost = estimateGenerationCost(toGenerate, q);
  progressLine("\nCost summary (live generation)");
  progressLine(`  Selected images: ${toGenerate.length}`);
  progressLine(`  API requests: ${toGenerate.length}`);
  progressLine(`  Model: ${GPT_IMAGE_MODEL}`);
  progressLine(`  Quality: ${q}`);
  progressLine(`  Estimated cost: $${estimatedCost.toFixed(3)} USD (reference pricing)`);
  progressLine("  Pass --confirm-generation=yes to proceed with live API requests.");
}

async function main() {
  const pack = loadPromptPack();
  const selected = selectSpecs(pack.specs);
  const planItemsById = await loadPlanItemsById();

  if (selected.length === 0) {
    throw new Error("No evidence specs matched the requested filters.");
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!dryRun && !apiKey) {
    throw new Error("OPENAI_API_KEY is required unless --dry-run is set.");
  }
  if (!dryRun && confirmGeneration !== "yes") {
    throw new Error("Live generation requires --confirm-generation=yes");
  }

  const plan = selected.map((spec) => {
    const outputPath = path.join(outputDir, spec.expectedFileName);
    const apiSize = buildOpenAiImageRequestBody({ spec, quality }).size;
    const planItem = planItemsById.get(spec.evidenceId) || null;
    const assessment = assessExistingImage(outputPath, spec, planItem);
    const skipExisting = !overwrite && assessment.valid;
    return {
      spec,
      evidenceId: spec.evidenceId,
      filename: spec.expectedFileName,
      orientation: spec.orientation,
      apiSize,
      outputDimensions: `${spec.width}x${spec.height}`,
      outputPath,
      skipExisting,
      skipReason: assessment.valid ? "valid existing file" : assessment.reasons.join("; ") || "missing",
      planItem,
    };
  });

  const toGenerate = plan.filter((item) => !item.skipExisting);

  progressLine("\nMidlands demo evidence image generation");
  progressLine(`  Anchor date: ${anchorDate}`);
  progressLine(`  Endpoint: POST ${OPENAI_IMAGES_URL}`);
  progressLine(`  Model: ${GPT_IMAGE_MODEL}`);
  progressLine(`  Quality: ${quality}`);
  progressLine(`  Supported API sizes: ${Object.values(GPT_IMAGE_2_API_SIZES).join(", ")}`);
  progressLine(`  Prompt pack: ${promptPackPath}`);
  progressLine(`  Output folder: ${outputDir}`);
  progressLine(`  Specs selected: ${plan.length}`);
  progressLine(`  Dry run: ${dryRun ? "yes" : "no"}`);
  progressLine(`  Overwrite: ${overwrite ? "yes" : "no"}`);
  if (startArg || endArg) {
    progressLine(`  Range: ${startArg || "start"} to ${endArg || "end"}`);
  }
  progressLine(`  Skipping evidence numbers: ${[...SKIP_EVIDENCE_NUMBERS].join(", ")}`);

  for (const item of plan) {
    progressLine(
      [
        dryRun ? "DRY-RUN" : "PLAN",
        item.evidenceId,
        `orientation=${item.orientation}`,
        `apiSize=${item.apiSize}`,
        `output=${item.outputDimensions}`,
        `path=${item.outputPath}`,
        `skip=${item.skipExisting ? "yes" : "no"}`,
        item.skipExisting ? "" : `(${item.skipReason})`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  if (!dryRun) {
    printCostSummary({ toGenerate: toGenerate.map((item) => item.spec), quality });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    anchorDate,
    endpoint: OPENAI_IMAGES_URL,
    requestShape: {
      model: GPT_IMAGE_MODEL,
      prompt: "<spec.prompt>",
      size: "<orientation-mapped supported size>",
      quality,
      n: 1,
      output_format: "jpeg",
      output_compression: 90,
    },
    model: GPT_IMAGE_MODEL,
    quality,
    dryRun,
    overwrite,
    confirmGeneration: dryRun ? null : confirmGeneration,
    promptPackPath,
    outputDir,
    reportPath,
    delayMs,
    maxRetries: MAX_RETRIES,
    results: [],
    summary: {
      planned: plan.length,
      generated: 0,
      skippedExisting: 0,
      failed: 0,
      apiRequests: 0,
      estimatedCostUsd: dryRun ? estimateGenerationCost(toGenerate.map((i) => i.spec), quality) : null,
    },
  };

  for (const item of plan) {
    if (item.skipExisting) {
      const buffer = fs.readFileSync(item.outputPath);
      const result = {
        evidenceId: item.evidenceId,
        filename: item.filename,
        status: "skipped-existing",
        success: true,
        outputFileSize: buffer.length,
        sha256: sha256(buffer),
        model: GPT_IMAGE_MODEL,
        apiSize: item.apiSize,
        outputDimensions: item.outputDimensions,
        orientation: item.orientation,
        outputPath: item.outputPath,
      };
      report.results.push(result);
      report.summary.skippedExisting += 1;
      progressLine(
        `SKIP ${item.evidenceId} ${item.filename} (valid existing file, ${buffer.length} bytes)`,
      );
      writeReport(report);
      continue;
    }

    if (dryRun) {
      const result = {
        evidenceId: item.evidenceId,
        filename: item.filename,
        status: "dry-run",
        success: true,
        outputFileSize: 0,
        sha256: null,
        model: GPT_IMAGE_MODEL,
        apiSize: item.apiSize,
        outputDimensions: item.outputDimensions,
        orientation: item.orientation,
        outputPath: item.outputPath,
      };
      report.results.push(result);
      report.summary.generated += 1;
      writeReport(report);
      continue;
    }

    let lastError = null;
    let success = false;
    let finalBuffer = null;
    let requestBody = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        progressLine(`RETRY ${item.evidenceId} attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
        await sleep(delayMs);
      }

      try {
        report.summary.apiRequests += 1;
        const generated = await generateImage({ apiKey, spec: item.spec });
        requestBody = generated.requestBody;
        finalBuffer = await processToSpecJpeg(generated.buffer, item.spec);
        if (!isJpegBuffer(finalBuffer)) {
          throw new Error("processed output is not JPEG");
        }
        const { width, height } = readJpegDimensions(finalBuffer);
        if (width !== item.spec.width || height !== item.spec.height) {
          throw new Error(`processed dimensions ${width}x${height} != ${item.spec.width}x${item.spec.height}`);
        }
        success = true;
        break;
      } catch (error) {
        lastError = error;
        progressLine(`FAIL ${item.evidenceId} attempt ${attempt + 1}: ${redactSecrets(error.message)}`);
        const retryable = !String(error.message).includes("image_generation_user_error");
        if (!retryable) break;
      }
    }

    if (success && finalBuffer) {
      fs.writeFileSync(item.outputPath, finalBuffer);
      const result = {
        evidenceId: item.evidenceId,
        filename: item.filename,
        status: "generated",
        success: true,
        outputFileSize: finalBuffer.length,
        sha256: sha256(finalBuffer),
        model: GPT_IMAGE_MODEL,
        apiSize: item.apiSize,
        outputDimensions: item.outputDimensions,
        orientation: item.orientation,
        outputPath: item.outputPath,
        request: requestBody,
      };
      report.results.push(result);
      report.summary.generated += 1;
      progressLine(
        `OK ${item.evidenceId} ${item.filename} ${finalBuffer.length} bytes sha256=${result.sha256.slice(0, 12)}...`,
      );
    } else {
      const result = {
        evidenceId: item.evidenceId,
        filename: item.filename,
        status: "failed",
        success: false,
        outputFileSize: 0,
        sha256: null,
        model: GPT_IMAGE_MODEL,
        apiSize: item.apiSize,
        outputDimensions: item.outputDimensions,
        orientation: item.orientation,
        outputPath: item.outputPath,
        error: redactSecrets(lastError?.message || "Unknown error"),
      };
      report.results.push(result);
      report.summary.failed += 1;
      progressLine(`ERROR ${item.evidenceId} ${item.filename}: ${result.error}`);
    }

    writeReport(report);
    await sleep(delayMs);
  }

  progressLine("\nGeneration complete");
  progressLine(`  Generated: ${report.summary.generated}`);
  progressLine(`  Skipped existing: ${report.summary.skippedExisting}`);
  progressLine(`  Failed: ${report.summary.failed}`);
  if (!dryRun) {
    progressLine(`  API requests: ${report.summary.apiRequests}`);
    progressLine(`  Estimated cost: $${estimateGenerationCost(toGenerate.map((i) => i.spec), quality).toFixed(3)} USD`);
  }
  progressLine(`  Report: ${reportPath}`);

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(redactSecrets(error?.message || String(error)));
  process.exit(1);
}
