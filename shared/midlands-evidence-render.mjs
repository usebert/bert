/**
 * Deterministic synthetic evidence image rendering (PNG via zlib, no native deps).
 */
import zlib from "node:zlib";
import { createSeededRandom } from "./midlands-history-prng.mjs";

const FOOTER = "Synthetic demo evidence";

export function encodePng(width, height, rgba) {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fillRect(rgba, width, height, x, y, w, h, color) {
  for (let row = y; row < y + h; row += 1) {
    if (row < 0 || row >= height) continue;
    for (let col = x; col < x + w; col += 1) {
      if (col < 0 || col >= width) continue;
      const idx = (row * width + col) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = 255;
    }
  }
}

function blendPixel(rgba, width, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  const a = clamp(alpha, 0, 1);
  rgba[idx] = Math.round(rgba[idx] * (1 - a) + color[0] * a);
  rgba[idx + 1] = Math.round(rgba[idx + 1] * (1 - a) + color[1] * a);
  rgba[idx + 2] = Math.round(rgba[idx + 2] * (1 - a) + color[2] * a);
}

function drawText5x7(rgba, width, height, x, y, text, color, scale = 1) {
  const glyphs = {
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["01110", "10000", "11110", "10001", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
    ":": ["00000", "00100", "00000", "00000", "00100", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  };
  const upper = String(text || "").toUpperCase();
  let cursor = x;
  for (const char of upper) {
    const glyph = glyphs[char] || glyphs[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            blendPixel(rgba, width, cursor + col * scale + sx, y + row * scale + sy, color, 0.95);
          }
        }
      }
    }
    cursor += (glyph[0].length + 1) * scale;
  }
}

const SCENE_PALETTES = {
  concrete: [168, 164, 158],
  steel: [96, 104, 112],
  hazard: [214, 156, 42],
  warning: [196, 84, 48],
  dust: [186, 178, 166],
  oil: [74, 68, 58],
  clean: [210, 214, 218],
  safety: [48, 120, 88],
  quality: [92, 118, 156],
  dispatch: [128, 132, 140],
};

export function renderSyntheticEvidencePng({
  seed,
  width,
  height,
  sceneKey,
  title,
  site,
  variant = "single",
  quality = "mobile",
}) {
  const rng = createSeededRandom(seed >>> 0);
  const rgba = Buffer.alloc(width * height * 4);
  const base = SCENE_PALETTES[sceneKey.split("-")[0]] || SCENE_PALETTES.concrete;
  const sky = [
    clamp(base[0] + 24, 0, 255),
    clamp(base[1] + 28, 0, 255),
    clamp(base[2] + 32, 0, 255),
  ];
  const floor = [
    clamp(base[0] - 18, 0, 255),
    clamp(base[1] - 18, 0, 255),
    clamp(base[2] - 16, 0, 255),
  ];

  for (let y = 0; y < height; y += 1) {
    const t = y / Math.max(height - 1, 1);
    const color = [
      Math.round(sky[0] * (1 - t * 0.55) + floor[0] * (t * 0.55)),
      Math.round(sky[1] * (1 - t * 0.55) + floor[1] * (t * 0.55)),
      Math.round(sky[2] * (1 - t * 0.55) + floor[2] * (t * 0.55)),
    ];
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = 255;
    }
  }

  const horizon = Math.floor(height * 0.58);
  fillRect(rgba, width, height, 0, horizon, width, height - horizon, floor);

  const motifSeed = sceneKey.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const motifCount = 4 + (motifSeed % 5);
  for (let i = 0; i < motifCount; i += 1) {
    const mx = Math.floor(rng() * (width - 80)) + 20;
    const my = Math.floor(horizon - 40 - rng() * (horizon * 0.45));
    const mw = 24 + Math.floor(rng() * 90);
    const mh = 16 + Math.floor(rng() * 70);
    const tone = [
      clamp(base[0] + Math.floor(rng() * 40) - 20, 40, 220),
      clamp(base[1] + Math.floor(rng() * 40) - 20, 40, 220),
      clamp(base[2] + Math.floor(rng() * 40) - 20, 40, 220),
    ];
    fillRect(rgba, width, height, mx, my, mw, mh, tone);
  }

  if (variant === "before") {
    fillRect(rgba, width, height, 12, 12, 120, 28, SCENE_PALETTES.warning);
    drawText5x7(rgba, width, height, 18, 16, "BEFORE", [255, 255, 255], 1);
  } else if (variant === "after") {
    fillRect(rgba, width, height, 12, 12, 96, 28, SCENE_PALETTES.safety);
    drawText5x7(rgba, width, height, 18, 16, "AFTER", [255, 255, 255], 1);
  }

  const accent = sceneKey.includes("quality")
    ? SCENE_PALETTES.quality
    : sceneKey.includes("dispatch") || site === "coventry"
      ? SCENE_PALETTES.dispatch
      : SCENE_PALETTES.hazard;
  fillRect(rgba, width, height, 12, height - 72, width - 24, 3, accent);
  drawText5x7(rgba, width, height, 16, height - 64, String(title || sceneKey).slice(0, 34), [28, 32, 36], 1);
  drawText5x7(rgba, width, height, 16, height - 44, `${site === "coventry" ? "COVENTRY" : "RUGBY"} YARD`, [72, 78, 86], 1);
  drawText5x7(rgba, width, height, 16, height - 24, FOOTER, [110, 116, 124], 1);

  const noiseStrength = quality === "mobile" ? 14 : 8;
  for (let i = 0; i < width * height * 0.08; i += 1) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);
    const delta = Math.floor(rng() * noiseStrength) - Math.floor(noiseStrength / 2);
    const idx = (y * width + x) * 4;
    rgba[idx] = clamp(rgba[idx] + delta, 0, 255);
    rgba[idx + 1] = clamp(rgba[idx + 1] + delta, 0, 255);
    rgba[idx + 2] = clamp(rgba[idx + 2] + delta, 0, 255);
  }

  if (quality === "mobile" && rng() > 0.45) {
    const shift = rng() > 0.5 ? 1 : -1;
    const copy = Buffer.from(rgba);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const src = ((y + shift) * width + (x + shift)) * 4;
        const dst = (y * width + x) * 4;
        rgba[dst] = Math.round(copy[src] * 0.65 + copy[dst] * 0.35);
        rgba[dst + 1] = Math.round(copy[src + 1] * 0.65 + copy[dst + 1] * 0.35);
        rgba[dst + 2] = Math.round(copy[src + 2] * 0.65 + copy[dst + 2] * 0.35);
      }
    }
  }

  return encodePng(width, height, rgba);
}
