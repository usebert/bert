/**
 * Deterministic PRNG and date helpers for Midlands demo history generation.
 */
import crypto from "node:crypto";

export function parseAnchorDate(input, fallback = new Date()) {
  const raw = String(input || "").trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }
  const date = fallback instanceof Date ? fallback : new Date(fallback);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
}

export function formatDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const next = new Date(utc);
  return formatDateKey(next);
}

export function anchorSeedNumber(anchorDateKey) {
  let hash = 0;
  for (let i = 0; i < anchorDateKey.length; i += 1) {
    hash = (hash * 31 + anchorDateKey.charCodeAt(i)) >>> 0;
  }
  return hash || 0x4d5043; // MPC
}

export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne(rng, list) {
  if (!list.length) return "";
  return list[Math.floor(rng() * list.length)];
}

export function pickWeighted(rng, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1]?.value;
}

export function shuffleDeterministic(rng, list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function spreadDatesAcrossRange(rng, startKey, endKey, count) {
  const startMs = Date.parse(`${startKey}T00:00:00Z`);
  const endMs = Date.parse(`${endKey}T00:00:00Z`);
  const span = Math.max(endMs - startMs, 86_400_000);
  const dates = [];
  for (let i = 0; i < count; i += 1) {
    const offset = Math.floor(rng() * span);
    dates.push(formatDateKey(new Date(startMs + offset)));
  }
  return dates.sort();
}

export function monthIndexFromRange(startKey, dateKey) {
  const [sy, sm] = startKey.split("-").map(Number);
  const [y, m] = dateKey.split("-").map(Number);
  return (y - sy) * 12 + (m - sm);
}

export function isoAt(dateKey, hour = 8, minute = 30) {
  return `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

export function computeHistoryFingerprint(summary) {
  return crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex");
}
