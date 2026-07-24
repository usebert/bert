/**
 * Detect legacy Phase 3 procedural placeholder PNG output (pre asset-pipeline).
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { renderSyntheticEvidencePng } from "./midlands-evidence-render.mjs";

export const LEGACY_PLACEHOLDER_FOOTER = "Synthetic demo evidence";

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function renderLegacyPlaceholderForItem(item) {
  return renderSyntheticEvidencePng({
    seed: item.renderSeed,
    width: item.width,
    height: item.height,
    sceneKey: item.sceneKey,
    title: item.title,
    site: item.site,
    variant: item.variant,
    quality: item.quality,
  });
}

export function legacyPlaceholderSha256ForItem(item) {
  return hashBuffer(renderLegacyPlaceholderForItem(item));
}

export function isLegacyPlaceholderEvidenceBuffer(buffer, item) {
  if (!buffer?.length) return false;
  if (item) {
    const legacy = renderLegacyPlaceholderForItem(item);
    if (hashBuffer(buffer) === hashBuffer(legacy)) {
      return true;
    }
  }
  if (!buffer.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return false;
  }
  return detectLegacyPlaceholderFooterPattern(buffer);
}

function decodePngRgba(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || !idat.length) {
    return { width: 0, height: 0, rgba: null };
  }
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const rowSize = width * 4 + 1;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize + 1;
    inflated.copy(rgba, y * width * 4, rowStart, rowStart + width * 4);
  }
  return { width, height, rgba };
}

function detectLegacyPlaceholderFooterPattern(buffer) {
  try {
    const { width, height, rgba } = decodePngRgba(buffer);
    if (!rgba || width < 320 || height < 240) return false;
    const footerBand = rgba.subarray((height - 28) * width * 4);
    let flatRows = 0;
    for (let y = 0; y < 24; y += 1) {
      const row = footerBand.subarray(y * width * 4, (y + 1) * width * 4);
      let uniform = 0;
      for (let x = 4; x < Math.min(width, 220); x += 1) {
        const idx = x * 4;
        const r = row[idx];
        const g = row[idx + 1];
        const b = row[idx + 2];
        if (r >= 20 && r <= 40 && g >= 24 && g <= 44 && b >= 28 && b <= 52) {
          uniform += 1;
        }
      }
      if (uniform > 80) flatRows += 1;
    }
    const accentRow = rgba.subarray((height - 72) * width * 4, (height - 69) * width * 4);
    let accentPixels = 0;
    for (let x = 12; x < width - 12; x += 1) {
      const idx = x * 4;
      const r = accentRow[idx];
      const g = accentRow[idx + 1];
      if (r > 150 && g > 100 && g < 200) accentPixels += 1;
    }
    return flatRows >= 3 && accentPixels > width * 0.4;
  } catch {
    return false;
  }
}
