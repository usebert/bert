/**
 * Image helpers for Midlands demo evidence generation and conversion.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isLegacyPlaceholderEvidenceBuffer } from "../../shared/midlands-evidence-legacy.mjs";

export const GPT_IMAGE_MODEL = "gpt-image-2";
export const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
export const JPEG_QUALITY = 90;
export const MIN_JPEG_QUALITY = 85;

/** Official gpt-image-2 popular sizes (OpenAI Images API docs). */
export const GPT_IMAGE_2_API_SIZES = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

/** Reference output pricing per image (USD, medium quality). */
export const GPT_IMAGE_2_COST_USD = {
  low: { landscape: 0.005, portrait: 0.005, square: 0.006 },
  medium: { landscape: 0.041, portrait: 0.041, square: 0.053 },
  high: { landscape: 0.165, portrait: 0.165, square: 0.211 },
};

export function isJpegBuffer(buffer) {
  return Boolean(buffer?.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8);
}

export function readJpegDimensions(buffer) {
  if (!isJpegBuffer(buffer)) {
    return { width: 0, height: 0 };
  }
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}

export function resolveApiSize(spec) {
  if (spec.orientation === "square") {
    return GPT_IMAGE_2_API_SIZES.square;
  }
  if (spec.orientation === "landscape") {
    return GPT_IMAGE_2_API_SIZES.landscape;
  }
  if (spec.orientation === "portrait") {
    return GPT_IMAGE_2_API_SIZES.portrait;
  }
  throw new Error(`${spec.evidenceId}: unsupported orientation ${spec.orientation}`);
}

export function buildOpenAiImageRequestBody({ spec, quality }) {
  return {
    model: GPT_IMAGE_MODEL,
    prompt: spec.prompt,
    size: resolveApiSize(spec),
    quality,
    n: 1,
    output_format: "jpeg",
    output_compression: JPEG_QUALITY,
  };
}

export function estimateGenerationCost(specs, quality) {
  const tier = GPT_IMAGE_2_COST_USD[quality] || GPT_IMAGE_2_COST_USD.medium;
  let total = 0;
  for (const spec of specs) {
    const key = spec.orientation === "square" ? "square" : spec.orientation;
    total += tier[key] || tier.landscape;
  }
  return total;
}

export async function processToSpecJpeg(inputBuffer, spec, { quality = JPEG_QUALITY } = {}) {
  const q = Math.max(MIN_JPEG_QUALITY, Math.min(100, quality));
  return sharp(inputBuffer)
    .rotate()
    .resize(spec.width, spec.height, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: false,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({
      quality: q,
      mozjpeg: true,
      chromaSubsampling: "4:4:4",
    })
    .toBuffer();
}

export function assessExistingImage(filePath, spec, planItem = null) {
  const reasons = [];
  const expectedName = spec.expectedFileName;
  const actualName = path.basename(filePath);

  if (actualName !== expectedName) {
    reasons.push(`filename mismatch (expected ${expectedName}, got ${actualName})`);
  }
  if (path.extname(actualName).toLowerCase() !== ".jpg") {
    reasons.push("extension is not .jpg");
  }

  let buffer;
  if (!fs.existsSync(filePath)) {
    return { valid: false, reasons: ["file missing"], buffer: null, width: 0, height: 0, size: 0 };
  }
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return { valid: false, reasons: ["file unreadable"], buffer: null, width: 0, height: 0, size: 0 };
  }

  if (!buffer.length) {
    reasons.push("file size is zero");
  }
  if (!isJpegBuffer(buffer)) {
    reasons.push("magic bytes are not JPEG");
  }

  const { width, height } = readJpegDimensions(buffer);
  if (width !== spec.width || height !== spec.height) {
    reasons.push(`dimensions ${width}x${height} do not match spec ${spec.width}x${spec.height}`);
  }

  if (planItem && isLegacyPlaceholderEvidenceBuffer(buffer, planItem)) {
    reasons.push("legacy procedural placeholder image");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    buffer,
    width,
    height,
    size: buffer.length,
  };
}

export function isValidExistingImage(filePath, spec, planItem = null) {
  return assessExistingImage(filePath, spec, planItem).valid;
}
