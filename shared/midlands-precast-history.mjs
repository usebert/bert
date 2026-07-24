/**
 * Midlands Precast Concrete Ltd — Phase 2 deterministic six-month operational history.
 * Pure generator: no Google I/O. Consumes Phase 1 seed context.
 */
import { buildAuditResultRow } from "../server/completion-service.mjs";
import { buildNcrWorkbookRow } from "./ncr.mjs";
import { buildIncidentRow } from "../server/incidents-service.mjs";
import { buildBriefingRow, buildRecipientRow } from "../server/briefings-service.mjs";
import {
  MIDLANDS_AREAS,
  MIDLANDS_AUDIT_TEMPLATES,
  MIDLANDS_PEOPLE,
  MIDLANDS_SITES,
} from "./midlands-precast-seed.mjs";
import {
  MIDLANDS_SITE_COVENTRY_ID,
  MIDLANDS_SITE_RUGBY_ID,
} from "./demo-environment.mjs";
import {
  addDays,
  anchorSeedNumber,
  computeHistoryFingerprint,
  createSeededRandom,
  formatDateKey,
  isoAt,
  monthIndexFromRange,
  parseAnchorDate,
  pickOne,
  spreadDatesAcrossRange,
} from "./midlands-history-prng.mjs";

const HISTORY_DAYS = 180;
// Calendar-month pass targets for a six-month span (partial opening month through anchor month).
const CALENDAR_COMPLIANCE_TARGETS = [0.72, 0.74, 0.73, 0.85, 0.93, 0.92, 0.90];

function compliancePassRoll(anchorKey, scheduleId, dueDate, passTarget) {
  const seed = anchorSeedNumber(`${anchorKey}|${scheduleId}|${dueDate}`);
  return createSeededRandom(seed)() < passTarget;
}

function complianceLateDelayDays(anchorKey, scheduleId, dueDate) {
  const seed = anchorSeedNumber(`${anchorKey}|${scheduleId}|${dueDate}|late`);
  const lateRng = createSeededRandom(seed);
  if (lateRng() >= 0.35) return 0;
  return 1 + Math.floor(lateRng() * 3);
}

function buildCalendarComplianceTargets(historyStart, historyEnd) {
  const targets = new Map();
  let monthKey = historyStart.slice(0, 7);
  const endMonth = historyEnd.slice(0, 7);
  let index = 0;
  while (monthKey <= endMonth) {
    targets.set(
      monthKey,
      CALENDAR_COMPLIANCE_TARGETS[Math.min(index, CALENDAR_COMPLIANCE_TARGETS.length - 1)],
    );
    const [year, month] = monthKey.split("-").map(Number);
    monthKey = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
    index += 1;
  }
  return targets;
}

const SCHEDULE_HISTORY = [
  { id: "midlands-sch-001", auditId: "midlands-aud-001", site: "rugby", area: "midlands-area-rugby-batching", results: 68 },
  { id: "midlands-sch-002", auditId: "midlands-aud-002", site: "rugby", area: "midlands-area-rugby-mixer", results: 62 },
  { id: "midlands-sch-003", auditId: "midlands-aud-003", site: "rugby", area: "midlands-area-rugby-silos", results: 24 },
  { id: "midlands-sch-004", auditId: "midlands-aud-004", site: "rugby", area: "midlands-area-rugby-conveyor", results: 22 },
  { id: "midlands-sch-005", auditId: "midlands-aud-005", site: "rugby", area: "midlands-area-rugby-washout", results: 20 },
  { id: "midlands-sch-006", auditId: "midlands-aud-006", site: "rugby", area: "midlands-area-rugby-loading", results: 54 },
  { id: "midlands-sch-007", auditId: "midlands-aud-007", site: "coventry", area: "midlands-area-coventry-forklift", results: 48 },
  { id: "midlands-sch-008", auditId: "midlands-aud-008", site: "both", area: "midlands-area-rugby-offices", results: 6 },
  { id: "midlands-sch-009", auditId: "midlands-aud-009", site: "coventry", area: "midlands-area-coventry-crane", results: 22 },
  { id: "midlands-sch-010", auditId: "midlands-aud-010", site: "coventry", area: "midlands-area-coventry-dispatch", results: 48 },
];

const QUESTION_BANK = {
  "midlands-aud-001": [
    { id: "q-bp-housekeeping", text: "Batching plant housekeeping satisfactory?", category: "Housekeeping" },
    { id: "q-bp-dust", text: "Cement dust accumulation controlled?", category: "Health" },
    { id: "q-bp-access", text: "Emergency access routes clear?", category: "Access" },
    { id: "q-bp-ppe", text: "PPE available and in use?", category: "PPE" },
  ],
  "midlands-aud-002": [
    { id: "q-mx-guard", text: "Mixer guarding secure?", category: "Guarding" },
    { id: "q-mx-isolation", text: "Isolation points labelled?", category: "Safety" },
    { id: "q-mx-platform", text: "Mixer access platform tidy?", category: "Housekeeping" },
  ],
  "midlands-aud-003": [
    { id: "q-silo-pressure", text: "Silo pressure relief visible?", category: "Plant" },
    { id: "q-silo-dust", text: "Dust filters serviceable?", category: "Health" },
    { id: "q-silo-tags", text: "Inspection tags in date?", category: "Compliance" },
  ],
  "midlands-aud-004": [
    { id: "q-conv-guard", text: "Conveyor guarding intact?", category: "Guarding" },
    { id: "q-conv-nip", text: "Nip points protected?", category: "Guarding" },
    { id: "q-conv-stop", text: "Emergency stops tested?", category: "Safety" },
  ],
  "midlands-aud-005": [
    { id: "q-wash-drain", text: "Washout drainage clear?", category: "Environmental" },
    { id: "q-wash-spill", text: "Spill kit stocked?", category: "Environmental" },
    { id: "q-wash-ph", text: "PH monitoring recorded?", category: "Environmental" },
  ],
  "midlands-aud-006": [
    { id: "q-ldr-tyres", text: "Tyres and forks serviceable?", category: "Plant" },
    { id: "q-ldr-leaks", text: "Fluid leaks absent?", category: "Maintenance" },
    { id: "q-ldr-seat", text: "Seat belt operational?", category: "Safety" },
  ],
  "midlands-aud-007": [
    { id: "q-flt-check", text: "Daily forklift checks complete?", category: "Plant" },
    { id: "q-flt-route", text: "Routes free from obstruction?", category: "Housekeeping" },
    { id: "q-flt-speed", text: "Speed limits observed?", category: "Behaviour" },
  ],
  "midlands-aud-008": [
    { id: "q-wp-fire", text: "Fire exits unobstructed?", category: "Fire" },
    { id: "q-wp-welfare", text: "Welfare facilities clean?", category: "Welfare" },
    { id: "q-wp-signage", text: "Safety signage legible?", category: "Signage" },
  ],
  "midlands-aud-009": [
    { id: "q-crane-zone", text: "Crane exclusion zone marked?", category: "Lifting" },
    { id: "q-crane-sling", text: "Slings tagged and within date?", category: "Lifting" },
    { id: "q-crane-ground", text: "Ground conditions stable?", category: "Lifting" },
  ],
  "midlands-aud-010": [
    { id: "q-disp-yard", text: "Dispatch yard organised?", category: "Housekeeping" },
    { id: "q-disp-chocks", text: "Vehicle chocks available?", category: "Transport" },
    { id: "q-disp-ped", text: "Pedestrian routes segregated?", category: "Access" },
  ],
};

const FINDING_NOTES = {
  rugby: [
    "Cement dust building up on ledges near silo base.",
    "Mixer platform had leftover grout — trip hazard.",
    "Section of conveyor guard bent — needs engineering check.",
    "Emergency route blocked by pallets near batching bay.",
    "Admixture drum showing minor leak at coupling.",
    "Washout sump partially blocked after Friday pour.",
    "Inspection tag missing on secondary silo ladder.",
    "E-stop cover cracked on aggregate conveyor.",
    "Loader showing small hydraulic leak at hose fitting.",
    "Lab calibration sticker overdue on moisture meter.",
    "Mould oil stored without secondary containment.",
    "Damaged 110v lead noted on precast bay.",
    "Operative without safety glasses in batching area.",
    "Pedestrian route not clearly marked near loading bay.",
  ],
  coventry: [
    "Lifting accessory ID tag faded on chain set.",
    "Precast stack leaning slightly — needs re-shoring.",
    "Barrier tape down at finishing area entrance.",
    "Forklift route obstructed by timber dunnage.",
    "Crane exclusion zone encroached during lift planning.",
    "Dispatch lane congestion during morning load-out.",
    "Poor housekeeping around remedial bay grinder.",
    "Dust extraction not used during patch repair.",
    "Trailer loading practice — no banksman on one load.",
    "Chocks not applied on waiting artic.",
    "Chain tag illegible on 2t sling.",
  ],
};

const NCR_DEFS = [
  { id: "midlands-ncr-001", site: "rugby", title: "Concrete cube strength below expected range", quality: true, month: 1 },
  { id: "midlands-ncr-002", site: "rugby", title: "Incorrect mix documentation on batch ticket", quality: true, month: 2 },
  { id: "midlands-ncr-003", site: "coventry", title: "Damaged finished unit — edge spall", quality: true, month: 2 },
  { id: "midlands-ncr-004", site: "rugby", title: "Curing records incomplete for weekend pour", quality: true, month: 3 },
  { id: "midlands-ncr-005", site: "rugby", title: "Reinforcement placement discrepancy on panel MPC-4421", quality: true, month: 3 },
  { id: "midlands-ncr-006", site: "coventry", title: "Product identification label mismatch", quality: true, month: 4 },
  { id: "midlands-ncr-007", site: "coventry", title: "Delivery paperwork mismatch with loaded units", quality: true, month: 4 },
  { id: "midlands-ncr-008", site: "rugby", title: "Failed plant inspection — guarding issue", quality: false, month: 1 },
  { id: "midlands-ncr-009", site: "rugby", title: "Repeat conveyor guarding non-conformance", quality: false, month: 3 },
  { id: "midlands-ncr-010", site: "rugby", title: "Environmental control failure — washout overflow", quality: false, month: 2 },
  { id: "midlands-ncr-011", site: "coventry", title: "Lifting accessory tag missing at dispatch", quality: false, month: 5 },
  { id: "midlands-ncr-012", site: "rugby", title: "Aggregate moisture test out of procedure", quality: true, month: 5 },
  { id: "midlands-ncr-013", site: "coventry", title: "Remedial repair documentation incomplete", quality: true, month: 5 },
];

const INCIDENT_DEFS = [
  { id: "midlands-inc-001", type: "Near Miss", severity: "Low", site: "rugby", title: "Slip near washout area", month: 0 },
  { id: "midlands-inc-002", type: "Near Miss", severity: "Low", site: "rugby", title: "Loader reversing near miss with pedestrian", month: 1 },
  { id: "midlands-inc-003", type: "Injury", severity: "Minor", site: "rugby", title: "Minor cement splash to forearm", month: 2 },
  { id: "midlands-inc-004", type: "Near Miss", severity: "Medium", site: "coventry", title: "Forklift/pedestrian near miss at dispatch", month: 2 },
  { id: "midlands-inc-005", type: "Injury", severity: "Minor", site: "rugby", title: "Hand cut during mould preparation", month: 3 },
  { id: "midlands-inc-006", type: "Near Miss", severity: "Medium", site: "coventry", title: "Lifting chain defect identified before use", month: 4 },
  { id: "midlands-inc-007", type: "Property Damage", severity: "Low", site: "coventry", title: "Product shift during loading", month: 4 },
  { id: "midlands-inc-008", type: "Near Miss", severity: "Low", site: "rugby", title: "Blocked emergency route — pallets", month: 1 },
];

const NEAR_MISS_DEFS = [
  { id: "midlands-nm-001", site: "rugby", title: "Unsecured mould cover moved in wind" },
  { id: "midlands-nm-002", site: "rugby", title: "Minor oil spill near workshop" },
  { id: "midlands-nm-003", site: "rugby", title: "Dust exposure concern during silo fill" },
  { id: "midlands-nm-004", site: "coventry", title: "Damaged barrier not reported promptly" },
  { id: "midlands-nm-005", site: "coventry", title: "Trailer moved without banksman" },
  { id: "midlands-nm-006", site: "rugby", title: "Aggregate bay pedestrian shortcut" },
  { id: "midlands-nm-007", site: "coventry", title: "Crane slew over pedestrian walkway" },
  { id: "midlands-nm-008", site: "rugby", title: "Wet concrete splash near mixer stairs" },
  { id: "midlands-nm-009", site: "coventry", title: "Forklift horn not used at blind corner" },
  { id: "midlands-nm-010", site: "rugby", title: "Defective emergency stop not logged same shift" },
  { id: "midlands-nm-011", site: "coventry", title: "Storage stack over height marker" },
  { id: "midlands-nm-012", site: "rugby", title: "Lab sample left on batching console" },
  { id: "midlands-nm-013", site: "coventry", title: "Dispatch yard congestion near miss", recent: true },
];

const BRIEFING_DEFS = [
  { id: "midlands-br-001", title: "Silica and cement dust controls", type: "Toolbox Talk", scope: "company" },
  { id: "midlands-br-002", title: "Vehicle and pedestrian segregation", type: "Toolbox Talk", scope: "rugby" },
  { id: "midlands-br-003", title: "Safe isolation before maintenance", type: "Training", scope: "rugby" },
  { id: "midlands-br-004", title: "Conveyor guarding awareness", type: "Toolbox Talk", scope: "rugby" },
  { id: "midlands-br-005", title: "Concrete washout environmental controls", type: "Notice", scope: "rugby" },
  { id: "midlands-br-006", title: "Lifting accessories — colour coding and tags", type: "Toolbox Talk", scope: "coventry" },
  { id: "midlands-br-007", title: "Crane exclusion zones", type: "Toolbox Talk", scope: "coventry" },
  { id: "midlands-br-008", title: "Forklift safety refresher", type: "Training", scope: "coventry" },
  { id: "midlands-br-009", title: "PPE standards — site wide", type: "Policy", scope: "company" },
  { id: "midlands-br-010", title: "Spill response procedure", type: "Notice", scope: "company" },
  { id: "midlands-br-011", title: "Housekeeping standards", type: "Toolbox Talk", scope: "rugby" },
  { id: "midlands-br-012", title: "Hand protection when handling precast units", type: "Toolbox Talk", scope: "coventry" },
  { id: "midlands-br-013", title: "Emergency arrangements review", type: "Policy", scope: "company" },
  { id: "midlands-br-014", title: "Lessons learned — washout slip", type: "Toolbox Talk", scope: "rugby", incident: "midlands-inc-001" },
  { id: "midlands-br-015", title: "Lessons learned — dispatch near miss", type: "Toolbox Talk", scope: "coventry", incident: "midlands-nm-013" },
  { id: "midlands-br-016", title: "Dust controls during remedial grinding", type: "Notice", scope: "coventry" },
  { id: "midlands-br-017", title: "Monthly H&S bulletin — Q2", type: "Notice", scope: "company" },
  { id: "midlands-br-018", title: "Loader pre-use expectations", type: "Toolbox Talk", scope: "rugby" },
  { id: "midlands-br-019", title: "Dispatch loading — trailer security", type: "Training", scope: "coventry" },
  { id: "midlands-br-020", title: "Quality sampling procedure reminder", type: "Notice", scope: "rugby" },
  { id: "midlands-br-021", title: "Sling inspection — what good looks like", type: "Toolbox Talk", scope: "coventry" },
  { id: "midlands-br-022", title: "Winter working arrangements", type: "Policy", scope: "company", archived: true },
  { id: "midlands-br-023", title: "Noise awareness — batching plant", type: "Toolbox Talk", scope: "rugby" },
  { id: "midlands-br-024", title: "Segregation during crane lifts", type: "Toolbox Talk", scope: "coventry" },
];

const LOLER_EQUIPMENT_DEFS = [
  { id: "midlands-lol-001", asset: "CRANE-RUG-01", name: "Overhead batching crane", type: "Overhead Crane", site: "rugby", area: "midlands-area-rugby-loading", swl: "10t", interval: 6 },
  { id: "midlands-lol-002", asset: "FLT-RUG-01", name: "Batching yard forklift", type: "Forklift", site: "rugby", area: "midlands-area-rugby-loading", swl: "3.5t", interval: 12 },
  { id: "midlands-lol-003", asset: "LDR-RUG-01", name: "Front loader", type: "Loader", site: "rugby", area: "midlands-area-rugby-loading", swl: "n/a", interval: 12 },
  { id: "midlands-lol-004", asset: "SLING-RUG-01", name: "Chain sling set — precast", type: "Chain Sling", site: "rugby", area: "midlands-area-rugby-precast", swl: "5t", interval: 6 },
  { id: "midlands-lol-005", asset: "SKIP-RUG-01", name: "Concrete skip", type: "Concrete Skip", site: "rugby", area: "midlands-area-rugby-precast", swl: "2t", interval: 6 },
  { id: "midlands-lol-006", asset: "BEAM-RUG-01", name: "Spreading beam", type: "Lifting Beam", site: "rugby", area: "midlands-area-rugby-precast", swl: "8t", interval: 12 },
  { id: "midlands-lol-007", asset: "CLUTCH-RUG-01", name: "Lifting clutch set", type: "Lifting Clutch", site: "rugby", area: "midlands-area-rugby-precast", swl: "10t", interval: 6 },
  { id: "midlands-lol-008", asset: "FORK-RUG-01", name: "Pallet forks", type: "Pallet Forks", site: "rugby", area: "midlands-area-rugby-loading", swl: "3.5t", interval: 12 },
  { id: "midlands-lol-009", asset: "MEWP-RUG-01", name: "Mobile access platform", type: "MEWP", site: "rugby", area: "midlands-area-rugby-workshop", swl: "n/a", interval: 6 },
  { id: "midlands-lol-010", asset: "SLING-RUG-02", name: "Chain sling — silo maintenance", type: "Chain Sling", site: "rugby", area: "midlands-area-rugby-silos", swl: "2t", interval: 6, overdue: true },
  { id: "midlands-lol-011", asset: "CRANE-COV-01", name: "Yard gantry crane", type: "Overhead Crane", site: "coventry", area: "midlands-area-coventry-crane", swl: "15t", interval: 6 },
  { id: "midlands-lol-012", asset: "FLT-COV-01", name: "Yard forklift", type: "Forklift", site: "coventry", area: "midlands-area-coventry-forklift", swl: "5t", interval: 12 },
  { id: "midlands-lol-013", asset: "SLING-COV-01", name: "Chain sling set — yard", type: "Chain Sling", site: "coventry", area: "midlands-area-coventry-crane", swl: "8t", interval: 6 },
  { id: "midlands-lol-014", asset: "BEAM-COV-01", name: "Lifting beam — dispatch", type: "Lifting Beam", site: "coventry", area: "midlands-area-coventry-dispatch", swl: "6t", interval: 12 },
  { id: "midlands-lol-015", asset: "GRAB-COV-01", name: "Panel grab", type: "Lifting Grab", site: "coventry", area: "midlands-area-coventry-storage", swl: "4t", interval: 6 },
  { id: "midlands-lol-016", asset: "CLUTCH-COV-01", name: "Lifting clutches", type: "Lifting Clutch", site: "coventry", area: "midlands-area-coventry-storage", swl: "10t", interval: 6 },
  { id: "midlands-lol-017", asset: "SHACK-COV-01", name: "Shackle set", type: "Shackle", site: "coventry", area: "midlands-area-coventry-crane", swl: "5t", interval: 12 },
  { id: "midlands-lol-018", asset: "FLT-COV-02", name: "Finishing bay forklift", type: "Forklift", site: "coventry", area: "midlands-area-coventry-finishing", swl: "3t", interval: 12, dueSoon: true },
  { id: "midlands-lol-019", asset: "SLING-RUG-03", name: "Retired chain sling", type: "Chain Sling", site: "rugby", area: "midlands-area-rugby-workshop", swl: "2t", interval: 6, retired: true },
  { id: "midlands-lol-020", asset: "BEAM-RUG-02", name: "Auxiliary lifting beam", type: "Lifting Beam", site: "rugby", area: "midlands-area-rugby-precast", swl: "4t", interval: 12 },
  { id: "midlands-lol-021", asset: "SLING-COV-02", name: "Chain sling — finishing bay", type: "Chain Sling", site: "coventry", area: "midlands-area-coventry-finishing", swl: "2t", interval: 6 },
  { id: "midlands-lol-022", asset: "FLT-RUG-02", name: "Precast bay forklift", type: "Forklift", site: "rugby", area: "midlands-area-rugby-precast", swl: "3t", interval: 12 },
  { id: "midlands-lol-023", asset: "CLUTCH-COV-02", name: "Secondary lifting clutches", type: "Lifting Clutch", site: "coventry", area: "midlands-area-coventry-storage", swl: "8t", interval: 6 },
  { id: "midlands-lol-024", asset: "SHACK-RUG-01", name: "Shackle set — loading", type: "Shackle", site: "rugby", area: "midlands-area-rugby-loading", swl: "5t", interval: 12 },
  { id: "midlands-lol-025", asset: "GRAB-RUG-01", name: "Panel grab — production", type: "Lifting Grab", site: "rugby", area: "midlands-area-rugby-precast", swl: "4t", interval: 6 },
  { id: "midlands-lol-026", asset: "BEAM-COV-02", name: "Yard spreader beam", type: "Lifting Beam", site: "coventry", area: "midlands-area-coventry-storage", swl: "10t", interval: 12 },
  { id: "midlands-lol-027", asset: "SKIP-COV-01", name: "Waste skip hoist", type: "Concrete Skip", site: "coventry", area: "midlands-area-coventry-maintenance", swl: "1t", interval: 6 },
  { id: "midlands-lol-028", asset: "SLING-RUG-04", name: "Web sling set", type: "Web Sling", site: "rugby", area: "midlands-area-rugby-loading", swl: "3t", interval: 6 },
  { id: "midlands-lol-029", asset: "FLT-COV-03", name: "Dispatch forklift", type: "Forklift", site: "coventry", area: "midlands-area-coventry-dispatch", swl: "3.5t", interval: 12 },
  { id: "midlands-lol-030", asset: "CRANE-RUG-02", name: "Precast gantry crane", type: "Overhead Crane", site: "rugby", area: "midlands-area-rugby-precast", swl: "12t", interval: 6 },
];

const RISK_ASSESSMENT_DEFS = [
  { id: "midlands-ra-001", number: "RA-0001", title: "Batching plant operation", activity: "Batching plant operation", site: "rugby", area: "midlands-area-rugby-batching", dept: "Batching" },
  { id: "midlands-ra-002", number: "RA-0002", title: "Cement delivery and silo filling", activity: "Cement delivery", site: "rugby", area: "midlands-area-rugby-silos", dept: "Batching" },
  { id: "midlands-ra-003", number: "RA-0003", title: "Mixer cleaning and isolation", activity: "Mixer cleaning", site: "rugby", area: "midlands-area-rugby-mixer", dept: "Batching" },
  { id: "midlands-ra-004", number: "RA-0004", title: "Concrete washout area", activity: "Washout management", site: "rugby", area: "midlands-area-rugby-washout", dept: "Precast Production" },
  { id: "midlands-ra-005", number: "RA-0005", title: "Crane and lifting operations", activity: "Crane lifting", site: "coventry", area: "midlands-area-coventry-crane", dept: "Yard Operations" },
  { id: "midlands-ra-006", number: "RA-0006", title: "Forklift movements", activity: "Forklift operation", site: "coventry", area: "midlands-area-coventry-forklift", dept: "Dispatch" },
  { id: "midlands-ra-007", number: "RA-0007", title: "Precast storage and stacking", activity: "Precast storage", site: "coventry", area: "midlands-area-coventry-storage", dept: "Yard Operations" },
  { id: "midlands-ra-008", number: "RA-0008", title: "Silica exposure — precast production", activity: "Precast production", site: "rugby", area: "midlands-area-rugby-precast", dept: "Precast Production" },
  { id: "midlands-ra-009", number: "RA-0009", title: "Maintenance work in plant workshop", activity: "Workshop maintenance", site: "rugby", area: "midlands-area-rugby-workshop", dept: "Maintenance" },
];

function userByEmail(email) {
  return MIDLANDS_PEOPLE.find((person) => person.email === email) || null;
}

function siteName(siteKey) {
  if (siteKey === "rugby") return MIDLANDS_SITES[0].SiteName;
  if (siteKey === "coventry") return MIDLANDS_SITES[1].SiteName;
  return "Midlands Precast Concrete Ltd";
}

function siteId(siteKey) {
  if (siteKey === "rugby") return MIDLANDS_SITE_RUGBY_ID;
  if (siteKey === "coventry") return MIDLANDS_SITE_COVENTRY_ID;
  return "";
}

function scheduleAssignee(scheduleId, phase1Schedules) {
  const row = phase1Schedules.find((entry) => entry["Schedule ID"] === scheduleId);
  const email = String(row?.["Assigned User Emails"] || "").split(",")[0].trim();
  const name = String(row?.["Assigned User Names"] || "").split(",")[0].trim();
  return { email, name };
}

function auditTemplate(auditId) {
  return MIDLANDS_AUDIT_TEMPLATES.find((entry) => entry.id === auditId);
}

function buildActionRow(input) {
  return {
    "Action ID": input.actionId,
    "Company ID": input.companyFolderId,
    "Source Audit ID": input.sourceAuditId || "",
    "Source Audit Name": input.sourceAuditName || "",
    "Source Question ID": input.sourceQuestionId || "",
    "Source Question Text": input.sourceQuestionText || "",
    "Source Answer": input.sourceAnswer || "Non-compliant",
    "Non Conformance ID": input.ncrId || "",
    Severity: input.severity || "Medium",
    Status: input.status || "Open",
    "Assigned To User ID": input.assigneeEmail || "",
    "Assigned To Name": input.assigneeName || "",
    "Created By User ID": input.createdByEmail || input.assigneeEmail || "",
    "Created At": input.createdAt,
    "Updated At": input.updatedAt || input.createdAt,
    "Due Date": input.dueDate,
    "Closed At": input.closedAt || "",
    "Verified By User ID": input.verifiedBy || "",
    "Verification Notes": input.verificationNotes || "",
    "Evidence Links": "",
    "Local Evidence Refs": "",
    Comments: input.comments || "",
    "Recurrence Flag": input.recurrence ? "true" : "false",
    "Root Cause": input.rootCause || "",
    "Corrective Action": input.correctiveAction || "",
    "Preventive Action": input.preventiveAction || "",
    "Risk Category": input.riskCategory || "Safety",
    "Requires Manager Review": input.managerReview ? "true" : "false",
    "Suggestion JSON": "",
    "Sync Status": "synced",
    "Sync Attempts": "0",
    "Last Sync Error": "",
    "Remote Row ID": "",
    "Schema Version": "3.0.0",
    Archived: input.archived ? "true" : "false",
    ArchivedAt: input.archivedAt || "",
    ArchivedBy: input.archivedBy || "",
    ArchiveReason: input.archiveReason || "",
  };
}

export function buildMidlandsPrecastHistory({
  anchorDate,
  companyFolderId,
  phase1Seed,
} = {}) {
  const anchor = parseAnchorDate(anchorDate);
  const anchorKey = formatDateKey(anchor);
  const historyStart = addDays(anchorKey, -HISTORY_DAYS);
  const historyEnd = anchorKey;
  const rng = createSeededRandom(anchorSeedNumber(anchorKey));
  const admin = userByEmail("demo.midlands.admin@usebert.co.uk");
  const hsManager = userByEmail("demo.midlands.hs.manager@usebert.co.uk");

  const schedules = (phase1Seed?.schedules || []).map((row) => ({
    ...row,
    "Start Date": historyStart,
    "Updated At": isoAt(anchorKey, 9, 0),
  }));

  const auditResults = [];
  const auditFindings = [];
  const complianceByMonth = {};
  const calendarComplianceTargets = buildCalendarComplianceTargets(historyStart, historyEnd);
  let resultCounter = 0;
  let findingCounter = 0;

  for (const scheduleMeta of SCHEDULE_HISTORY) {
    const template = auditTemplate(scheduleMeta.auditId);
    const assignee = scheduleAssignee(scheduleMeta.id, schedules);
    const questions = QUESTION_BANK[scheduleMeta.auditId] || [];
    const scheduleRng = createSeededRandom(anchorSeedNumber(`${anchorKey}|${scheduleMeta.id}|dates`));
    const dates = spreadDatesAcrossRange(scheduleRng, historyStart, historyEnd, scheduleMeta.results);

    for (const dueDate of dates) {
      resultCounter += 1;
      const monthIdx = Math.min(
        CALENDAR_COMPLIANCE_TARGETS.length - 1,
        Math.max(0, monthIndexFromRange(historyStart, dueDate)),
      );
      const passTarget =
        calendarComplianceTargets.get(dueDate.slice(0, 7)) ??
        CALENDAR_COMPLIANCE_TARGETS[CALENDAR_COMPLIANCE_TARGETS.length - 1];
      const passAll = compliancePassRoll(anchorKey, scheduleMeta.id, dueDate, passTarget);
      const delayDays = passAll ? 0 : complianceLateDelayDays(anchorKey, scheduleMeta.id, dueDate);
      const completedDate = delayDays ? addDays(dueDate, delayDays) : dueDate;
      if (completedDate > historyEnd) continue;

      const resultId = `midlands-hres-${String(resultCounter).padStart(4, "0")}`;
      const answers = [];
      const embeddedFindings = [];
      for (const question of questions) {
        const failChance = passAll ? 0.05 : 0.092;
        const answer = rng() < failChance ? "fail" : rng() < 0.1 ? "n/a" : "pass";
        answers.push({
          questionId: question.id,
          questionText: question.text,
          answer,
          category: question.category,
        });
        if (answer === "fail") {
          findingCounter += 1;
          const findingId = `midlands-hfnd-${String(findingCounter).padStart(4, "0")}`;
          const riskRoll = rng();
          const riskLevel =
            riskRoll > 0.92 ? "Critical" : riskRoll > 0.75 ? "High" : riskRoll > 0.4 ? "Medium" : "Low";
          const notePool = scheduleMeta.site === "coventry" ? FINDING_NOTES.coventry : FINDING_NOTES.rugby;
          const note = notePool[(findingCounter + monthIdx) % notePool.length];
          embeddedFindings.push({
            findingId,
            questionId: question.id,
            questionText: question.text,
            riskLevel,
            note,
          });
        }
      }

      const completedAt = isoAt(completedDate, 6 + Math.floor(rng() * 4), Math.floor(rng() * 59));
      const resultRow = buildAuditResultRow({
        resultId,
        companyFolderId,
        companyId: companyFolderId,
        scheduleId: scheduleMeta.id,
        completedByEmail: assignee.email,
        completedByName: assignee.name,
        completedAt,
        auditId: scheduleMeta.auditId,
        areaId: scheduleMeta.area,
        auditName: template?.name || "",
        formNumber: template?.formNumber || "",
        revisionNumber: "1",
        revisionId: `${template?.formNumber || "MPC"}-REV-1`,
        frequency: template?.frequency || "Daily",
        answersJson: { auditId: scheduleMeta.auditId, answers },
        findingsJson: embeddedFindings,
      });
      auditResults.push(resultRow);

      for (const finding of embeddedFindings) {
        auditFindings.push({
          "Finding ID": finding.findingId,
          "Local Submission ID": resultId,
          "Result ID": resultId,
          "Audit ID": scheduleMeta.auditId,
          "Area ID": scheduleMeta.area,
          "Company ID": companyFolderId,
          "Question ID": finding.questionId,
          "Question Text": finding.questionText,
          Answer: "fail",
          "Risk Level": finding.riskLevel,
          "Risk Category": "Safety",
          "Auto Action Required": finding.riskLevel === "High" || finding.riskLevel === "Critical" ? "true" : "false",
          "Requires Photo Evidence": "false",
          "Requires Manager Review": finding.riskLevel === "Critical" ? "true" : "false",
          Note: finding.note,
          "Local Evidence Refs": "",
          "Created At": completedAt,
          "Updated At": completedAt,
          "Created By": assignee.email,
          "Updated By": assignee.email,
          "Sync Status": "synced",
          "Sync Attempts": "0",
          "Last Sync Error": "",
          "Remote Row ID": "",
          "Schema Version": "3.0.0",
        });
      }

      const monthKey = dueDate.slice(0, 7);
      if (!complianceByMonth[monthKey]) {
        complianceByMonth[monthKey] = { completed: 0, passed: 0 };
      }
      complianceByMonth[monthKey].completed += 1;
      if (passAll) complianceByMonth[monthKey].passed += 1;
    }
  }

  const actions = [];
  let actionCounter = 0;
  const linkableFindings = auditFindings.slice(0, 55);
  for (const finding of linkableFindings) {
    if (finding["Risk Level"] === "Low" && rng() > 0.55) continue;
    actionCounter += 1;
    const createdDate = finding["Created At"].slice(0, 10);
    const dueDate = addDays(createdDate, 7 + Math.floor(rng() * 21));
    const closed = dueDate < addDays(anchorKey, -5);
    const overdue = !closed && dueDate < anchorKey;
    const assignee =
      finding["Area ID"].includes("coventry")
        ? userByEmail("demo.midlands.coventry.manager@usebert.co.uk")
        : userByEmail("demo.midlands.rugby.manager@usebert.co.uk");
    actions.push(
      buildActionRow({
        actionId: `midlands-hact-${String(actionCounter).padStart(4, "0")}`,
        companyFolderId,
        sourceAuditId: finding["Audit ID"],
        sourceAuditName: auditTemplate(finding["Audit ID"])?.name || "",
        sourceQuestionId: finding["Question ID"],
        sourceQuestionText: finding["Question Text"],
        severity: finding["Risk Level"],
        status: closed ? "Closed" : "Open",
        assigneeEmail: assignee?.email,
        assigneeName: assignee?.name,
        createdByEmail: hsManager?.email,
        createdAt: finding["Created At"],
        updatedAt: closed ? isoAt(addDays(dueDate, -1), 14, 0) : finding["Updated At"],
        dueDate,
        closedAt: closed ? isoAt(addDays(dueDate, -1), 15, 30) : "",
        comments: closed ? "Corrective work verified on walkaround." : overdue ? "Still open — prioritised for this week." : "In progress.",
        rootCause: "Procedure drift / housekeeping",
        correctiveAction: finding.Note,
        managerReview: finding["Risk Level"] === "High" || finding["Risk Level"] === "Critical",
        archived: closed && rng() > 0.9,
        archivedAt: closed && rng() > 0.9 ? isoAt(addDays(dueDate, 2), 9, 0) : "",
        archivedBy: admin?.email,
        archiveReason: "Completed and verified",
      }),
    );
  }

  // Ensure dashboard action targets
  actions.push(
    buildActionRow({
      actionId: "midlands-hact-dash-001",
      companyFolderId,
      sourceAuditId: "midlands-aud-004",
      sourceAuditName: "Weekly conveyor guarding inspection",
      sourceQuestionId: "q-conv-guard",
      sourceQuestionText: "Conveyor guarding intact?",
      severity: "High",
      status: "Open",
      assigneeEmail: "demo.midlands.rugby.manager@usebert.co.uk",
      assigneeName: "Marcus Reed",
      createdByEmail: hsManager?.email,
      createdAt: isoAt(addDays(anchorKey, -12), 10, 0),
      dueDate: addDays(anchorKey, -3),
      comments: "Overdue — guard section still awaiting replacement.",
    }),
    buildActionRow({
      actionId: "midlands-hact-dash-002",
      companyFolderId,
      sourceAuditId: "midlands-aud-009",
      sourceAuditName: "Crane and lifting area inspection",
      sourceQuestionId: "q-crane-sling",
      sourceQuestionText: "Slings tagged and within date?",
      severity: "Medium",
      status: "Open",
      assigneeEmail: "demo.midlands.coventry.manager@usebert.co.uk",
      assigneeName: "Sarah Collins",
      createdAt: isoAt(addDays(anchorKey, -8), 11, 0),
      dueDate: addDays(anchorKey, 2),
      comments: "Replacement tags ordered.",
    }),
    buildActionRow({
      actionId: "midlands-hact-dash-003",
      companyFolderId,
      sourceAuditId: "midlands-aud-005",
      sourceAuditName: "Concrete washout environmental inspection",
      sourceQuestionId: "q-wash-drain",
      sourceQuestionText: "Washout drainage clear?",
      severity: "Medium",
      status: "Open",
      assigneeEmail: "demo.midlands.hs.manager@usebert.co.uk",
      assigneeName: "Priya Sharma",
      createdAt: isoAt(addDays(anchorKey, -5), 9, 30),
      dueDate: addDays(anchorKey, -2),
      comments: "Sump clean overdue — contractor booked for this week.",
    }),
    buildActionRow({
      actionId: "midlands-hact-dash-004",
      companyFolderId,
      sourceAuditId: "midlands-aud-001",
      sourceAuditName: "Daily batching plant inspection",
      sourceQuestionId: "q-bp-dust",
      sourceQuestionText: "Cement dust accumulation controlled?",
      severity: "High",
      status: "Open",
      assigneeEmail: "demo.midlands.rugby.manager@usebert.co.uk",
      assigneeName: "Marcus Reed",
      createdAt: isoAt(addDays(anchorKey, -4), 8, 0),
      dueDate: addDays(anchorKey, 6),
      comments: "High priority — weekend deep clean planned.",
    }),
    buildActionRow({
      actionId: "midlands-hact-dash-005",
      companyFolderId,
      sourceAuditId: "midlands-aud-010",
      sourceAuditName: "Dispatch yard inspection",
      sourceQuestionId: "q-disp-ped",
      sourceQuestionText: "Pedestrian routes segregated?",
      severity: "Low",
      status: "Closed",
      assigneeEmail: "demo.midlands.coventry.manager@usebert.co.uk",
      assigneeName: "Sarah Collins",
      createdAt: isoAt(addDays(anchorKey, -20), 16, 0),
      dueDate: addDays(anchorKey, -10),
      closedAt: isoAt(addDays(anchorKey, -9), 14, 0),
      comments: "Barriers repainted and route remarking complete.",
    }),
    buildActionRow({
      actionId: "midlands-hact-dash-006",
      companyFolderId,
      sourceAuditId: "midlands-aud-003",
      sourceAuditName: "Cement silo inspection",
      sourceQuestionId: "q-silo-tags",
      sourceQuestionText: "Inspection tags in date?",
      severity: "Medium",
      status: "Open",
      assigneeEmail: "demo.midlands.rugby.auditor@usebert.co.uk",
      assigneeName: "Chloe Martin",
      createdAt: isoAt(addDays(anchorKey, -18), 9, 0),
      dueDate: addDays(anchorKey, -6),
      comments: "Tags replacement overdue — silo 2 ladder.",
    }),
  );

  const ncrs = [];
  let ncrActionCounter = 0;
  const OPEN_NCR_IDS = new Set(["midlands-ncr-011", "midlands-ncr-013"]);
  for (const [index, def] of NCR_DEFS.entries()) {
    const raisedDate = addDays(historyStart, 20 + def.month * 28 + index * 3);
    const closed = !OPEN_NCR_IDS.has(def.id);
    const manager =
      def.site === "coventry"
        ? userByEmail("demo.midlands.coventry.manager@usebert.co.uk")
        : userByEmail("demo.midlands.rugby.manager@usebert.co.uk");
    const auditor =
      def.site === "coventry"
        ? userByEmail("demo.midlands.coventry.auditor@usebert.co.uk")
        : userByEmail("demo.midlands.rugby.auditor@usebert.co.uk");
    const linkedResult = auditResults[index % auditResults.length];
    ncrActionCounter += 1;
    const actionId = `midlands-hact-ncr-${String(ncrActionCounter).padStart(3, "0")}`;
    if (closed || def.open) {
      actions.push(
        buildActionRow({
          actionId,
          companyFolderId,
          sourceAuditId: linkedResult["Audit ID"],
          sourceAuditName: linkedResult["Audit Name"],
          sourceQuestionId: "q-ncr-linked",
          sourceQuestionText: def.title,
          severity: def.quality ? "Medium" : "High",
          status: closed ? "Closed" : "Open",
          assigneeEmail: manager?.email,
          assigneeName: manager?.name,
          createdByEmail: auditor?.email,
          createdAt: isoAt(raisedDate, 10, 0),
          dueDate: addDays(raisedDate, 14),
          closedAt: closed ? isoAt(addDays(raisedDate, 12), 15, 0) : "",
          ncrId: def.id,
          comments: def.open ? "Containment in place — root cause review pending." : "Corrective action verified.",
          correctiveAction: "Immediate correction applied and documented.",
        }),
      );
    }
    ncrs.push(
      buildNcrWorkbookRow({
        ncrId: def.id,
        reference: `NCR-${String(index + 1).padStart(4, "0")}`,
        companyFolderId,
        auditId: linkedResult["Audit ID"],
        auditName: linkedResult["Audit Name"],
        questionId: "q-ncr-linked",
        questionText: def.title,
        answer: "Non-compliant",
        title: def.title,
        description: `${def.title}. ${def.quality ? "Quality system review required." : "Operational control failure."}`,
        status: closed ? "Closed" : "Open",
        site: siteName(def.site),
        auditorName: auditor?.name,
        auditorUserId: auditor?.email,
        assignedLineManager: manager?.name,
        assignedLineManagerEmail: manager?.email,
        raisedAt: isoAt(raisedDate, 9, 45),
        createdAt: isoAt(raisedDate, 9, 45),
        updatedAt: closed ? isoAt(addDays(raisedDate, 12), 16, 0) : isoAt(addDays(anchorKey, -2), 11, 0),
        createdBy: auditor?.email,
        resultId: linkedResult["Result ID"],
        archived: index === 11 ? "true" : "false",
        archivedAt: index === 11 ? isoAt(addDays(raisedDate, 30), 9, 0) : "",
        archivedBy: index === 11 ? admin?.email : "",
        archiveReason: index === 11 ? "Superseded duplicate entry" : "",
      }),
    );
  }

  const incidents = [];
  for (const [index, def] of INCIDENT_DEFS.entries()) {
    const incidentDate = addDays(historyStart, 15 + def.month * 30 + index * 4);
    const reporter = userByEmail(
      def.site === "coventry" ? "demo.midlands.coventry.dispatch@usebert.co.uk" : "demo.midlands.rugby.batching@usebert.co.uk",
    );
    const closed = incidentDate < addDays(anchorKey, -21);
    incidents.push(
      buildIncidentRow({
        incidentId: def.id,
        status: closed ? "Closed" : def.month >= 3 ? "Investigating" : "Open",
        priority: def.severity === "Minor" ? "Normal" : "High",
        incidentType: def.type,
        severity: def.severity,
        incidentDate,
        incidentTime: "10:15",
        reporterName: reporter?.name,
        reporterEmail: reporter?.email,
        department: def.site === "coventry" ? "Dispatch" : "Batching",
        location: siteName(def.site),
        description: def.title,
        immediateAction: "Area secured and briefing issued to team.",
        createdAt: isoAt(incidentDate, 10, 20),
        updatedAt: isoAt(closed ? addDays(incidentDate, 10) : addDays(anchorKey, -1), 14, 0),
        assignedToEmail: hsManager?.email,
        assignedToName: hsManager?.name,
        archived: false,
      }),
    );
  }

  for (const [index, def] of NEAR_MISS_DEFS.entries()) {
    const incidentDate = addDays(historyStart, 10 + index * 12);
    const reporter = userByEmail(
      def.site === "coventry" ? "demo.midlands.coventry.finishing@usebert.co.uk" : "demo.midlands.rugby.maintenance@usebert.co.uk",
    );
    incidents.push(
      buildIncidentRow({
        incidentId: def.id,
        status: def.recent ? "Open" : "Closed",
        priority: "Normal",
        incidentType: "Near Miss",
        severity: "Low",
        incidentDate,
        incidentTime: "14:40",
        reporterName: reporter?.name,
        reporterEmail: reporter?.email,
        department: def.site === "coventry" ? "Finishing" : "Maintenance",
        location: siteName(def.site),
        description: def.title,
        immediateAction: "Reported to supervisor and logged in BERT.",
        createdAt: isoAt(incidentDate, 14, 45),
        updatedAt: isoAt(def.recent ? anchorKey : addDays(incidentDate, 5), 9, 0),
        assignedToEmail: hsManager?.email,
        assignedToName: hsManager?.name,
      }),
    );
  }

  const briefings = [];
  const briefingRecipients = [];
  for (const [index, def] of BRIEFING_DEFS.entries()) {
    const sentDate = addDays(historyStart, 8 + index * 7);
    const creator = def.scope === "coventry" ? userByEmail("demo.midlands.coventry.manager@usebert.co.uk") : hsManager;
    const targets = MIDLANDS_PEOPLE.filter((person) => {
      if (def.scope === "company") return true;
      if (def.scope === "rugby") return String(person.siteIds).includes(MIDLANDS_SITE_RUGBY_ID);
      return String(person.siteIds).includes(MIDLANDS_SITE_COVENTRY_ID);
    });
    const briefingRow = buildBriefingRow({
      briefingId: def.id,
      title: def.title,
      type: def.type,
      status: def.archived ? "Archived" : "Sent",
      priority: def.incident ? "Important" : "Normal",
      createdByEmail: creator?.email,
      createdByName: creator?.name,
      createdAt: isoAt(sentDate, 8, 0),
      sentAt: isoAt(sentDate, 8, 15),
      dueDate: addDays(sentDate, 14),
      requiresRead: true,
      requiresAcknowledgement: true,
      requiresSignature: index % 4 === 0,
      targetMode: def.scope === "company" ? "everyone" : "users",
      targetUserEmails: targets.map((person) => person.email),
      message: `${def.title} — please read and acknowledge.`,
      recipientCount: targets.length,
    });
    if (def.archived) {
      briefingRow.Archived = "true";
      briefingRow.ArchivedAt = isoAt(addDays(sentDate, 60), 9, 0);
      briefingRow.ArchivedBy = admin?.email;
      briefingRow.ArchiveReason = "Superseded by newer briefing";
    }
    briefings.push(briefingRow);

    for (const [rIndex, person] of targets.entries()) {
      const forceUnsigned = !def.archived && index >= 19 && index <= 22 && rIndex < 4 && rIndex % 2 === 0;
      const signed = !def.archived && !forceUnsigned && rIndex % 3 !== 0;
      const unsignedMandatory = forceUnsigned;
      briefingRecipients.push(
        buildRecipientRow({
          briefingId: def.id,
          recipientEmail: person.email,
          recipientName: person.name,
          role: person.role,
          sentAt: isoAt(sentDate, 8, 15),
          readAt: signed ? isoAt(addDays(sentDate, 1 + (rIndex % 3)), 10, 0) : "",
          acknowledgedAt: signed ? isoAt(addDays(sentDate, 2 + (rIndex % 2)), 11, 0) : "",
          signedAt: briefingRow.RequiresSignature === "true" && signed ? isoAt(addDays(sentDate, 3), 9, 0) : "",
          status: signed ? "Read" : unsignedMandatory ? "Sent" : "Sent",
          overdue: unsignedMandatory ? "true" : "false",
          signatureName: signed ? person.name : "",
        }),
      );
    }
  }

  const UNSIGNED_BRIEFING_RECIPIENTS = [
    ["midlands-br-021", "demo.midlands.coventry.dispatch@usebert.co.uk"],
    ["midlands-br-021", "demo.midlands.coventry.finishing@usebert.co.uk"],
    ["midlands-br-023", "demo.midlands.rugby.batching@usebert.co.uk"],
    ["midlands-br-024", "demo.midlands.coventry.auditor@usebert.co.uk"],
    ["midlands-br-020", "demo.midlands.rugby.qa@usebert.co.uk"],
  ];
  for (const recipient of briefingRecipients) {
    if (UNSIGNED_BRIEFING_RECIPIENTS.some(([briefingId, email]) => briefingId === recipient.BriefingId && email === recipient.RecipientEmail)) {
      recipient.Overdue = "true";
      recipient.Status = "Sent";
      recipient.ReadAt = "";
      recipient.AcknowledgedAt = "";
      recipient.SignedAt = "";
    }
  }

  const lolerEquipment = [];
  const lolerSchedules = [];
  const lolerExaminations = [];
  for (const [index, def] of LOLER_EQUIPMENT_DEFS.entries()) {
    const site = siteId(def.site);
    const area = MIDLANDS_AREAS.find((entry) => entry.AreaId === def.area);
    const owner =
      def.site === "coventry"
        ? userByEmail("demo.midlands.coventry.supervisor@usebert.co.uk")
        : userByEmail("demo.midlands.rugby.maintenance@usebert.co.uk");
    const lastExam = addDays(anchorKey, -(def.interval * 30 + index * 3));
    const nextDue = addDays(lastExam, def.interval * 30);
    const status = def.retired ? "archived" : def.overdue ? "out_of_service" : "active";
    const equipmentId = def.id;
    lolerEquipment.push({
      EquipmentId: equipmentId,
      AssetId: def.asset,
      EquipmentName: def.name,
      EquipmentType: def.type,
      Manufacturer: index % 2 === 0 ? "Terex" : "Konecranes",
      Model: `MPC-${String(index + 1).padStart(2, "0")}`,
      SerialNumber: `SN-MPC-${String(1000 + index)}`,
      SiteId: site,
      SiteName: siteName(def.site),
      AreaId: def.area,
      AreaName: area?.AreaName || "",
      OwnerDepartment: area?.DepartmentId || "",
      EquipmentStatus: status,
      ExaminationIntervalMonths: String(def.interval),
      LastExaminationDate: lastExam,
      NextExaminationDueDate: def.overdue ? addDays(anchorKey, -12) : def.dueSoon ? addDays(anchorKey, 18) : nextDue,
      AssignedPersonId: owner?.email,
      AssignedPersonName: owner?.name,
      Notes: def.overdue ? "Quarantined pending thorough examination." : "",
      CreatedAt: isoAt(addDays(historyStart, 5), 9, 0),
      CreatedBy: admin?.email,
      UpdatedAt: isoAt(anchorKey, 8, 0),
      UpdatedBy: hsManager?.email,
      ArchivedAt: def.retired ? isoAt(addDays(historyStart, 40), 10, 0) : "",
      ArchivedBy: def.retired ? admin?.email : "",
      ChangeLog: "",
    });
    const scheduleId = `midlands-lsch-${String(index + 1).padStart(3, "0")}`;
    lolerSchedules.push({
      LolerScheduleId: scheduleId,
      EquipmentId: equipmentId,
      AssetId: def.asset,
      EquipmentName: def.name,
      SiteId: site,
      SiteName: siteName(def.site),
      AreaId: def.area,
      AreaName: area?.AreaName || "",
      DueDate: def.overdue ? addDays(anchorKey, -12) : def.dueSoon ? addDays(anchorKey, 18) : nextDue,
      AssignedPersonId: owner?.email,
      AssignedPersonName: owner?.name,
      ScheduleStatus: def.overdue ? "overdue" : def.dueSoon ? "due_soon" : def.retired ? "cancelled" : "upcoming",
      CompletedAt: def.retired ? isoAt(addDays(historyStart, 38), 11, 0) : "",
      CreatedAt: isoAt(addDays(historyStart, 5), 9, 0),
      CreatedBy: admin?.email,
      UpdatedAt: isoAt(anchorKey, 8, 0),
      UpdatedBy: hsManager?.email,
    });
    const examId = `midlands-lex-${String(index + 1).padStart(3, "0")}`;
    lolerExaminations.push({
      ExaminationId: examId,
      EquipmentId: equipmentId,
      AssetId: def.asset,
      EquipmentName: def.name,
      ExaminationDate: lastExam,
      ExaminerPersonId: hsManager?.email,
      ExaminerName: hsManager?.name,
      ExaminerEmail: hsManager?.email,
      ExaminationResult: def.overdue ? "failed" : "passed",
      Observations: def.overdue ? "Tag illegible — remove from service." : "Satisfactory condition.",
      DefectsFound: def.overdue ? "Identification tag missing." : "",
      ReportFileId: "",
      ReportFileName: "",
      ReportFileUrl: "",
      NextExaminationDueDate: def.overdue ? addDays(anchorKey, -12) : nextDue,
      CurrentScheduleId: scheduleId,
      RecordedAt: isoAt(lastExam, 13, 0),
      RecordedBy: hsManager?.email,
      UpdatedAt: isoAt(lastExam, 13, 0),
      UpdatedBy: hsManager?.email,
      ChangeLog: "",
    });
  }

  const riskAssessments = [];
  const riskHazards = [];
  const riskLinks = [];
  const riskReviews = [];
  for (const [index, def] of RISK_ASSESSMENT_DEFS.entries()) {
    const assessmentDate = addDays(historyStart, 12 + index * 14);
    const owner = userByEmail(
      def.site === "coventry" ? "demo.midlands.coventry.manager@usebert.co.uk" : "demo.midlands.rugby.manager@usebert.co.uk",
    );
    const assessor = hsManager;
    const status = index < 7 ? "Active" : "Review Due";
    riskAssessments.push({
      RiskAssessmentId: def.id,
      CompanyFolderId: companyFolderId,
      AssessmentNumber: def.number,
      Title: def.title,
      Description: `Risk assessment for ${def.activity} at ${siteName(def.site)}.`,
      AssessmentType: "General",
      Activity: def.activity,
      Department: def.dept,
      SiteId: siteId(def.site),
      AreaId: def.area,
      OwnerUserId: owner?.email,
      OwnerName: owner?.name,
      AssessorUserId: assessor?.email,
      AssessorName: assessor?.name,
      AssessmentDate: assessmentDate,
      ReviewDate: addDays(assessmentDate, 365),
      Status: status,
      Version: "1.0",
      PreviousVersionId: "",
      InitialOverallRiskScore: String(12 + index),
      ResidualOverallRiskScore: String(6 + (index % 4)),
      HighestInitialRiskScore: String(15 + (index % 3)),
      HighestResidualRiskScore: String(8 + (index % 2)),
      PeopleAtRisk: "Employees, contractors, visitors",
      ExistingGeneralControls: "Standard operating procedures, supervision, PPE.",
      EmergencyArrangements: "Site alarm and muster points communicated.",
      PpeSummary: "Safety boots, hi-vis, gloves, eye protection as required.",
      ApprovalRequired: "true",
      SubmittedAt: isoAt(assessmentDate, 10, 0),
      SubmittedBy: assessor?.email,
      ApprovedAt: isoAt(addDays(assessmentDate, 2), 14, 0),
      ApprovedBy: admin?.email,
      ActivatedAt: isoAt(addDays(assessmentDate, 3), 9, 0),
      CreatedAt: isoAt(assessmentDate, 9, 0),
      CreatedBy: assessor?.email,
      UpdatedAt: isoAt(addDays(assessmentDate, 3), 9, 0),
      UpdatedBy: assessor?.email,
    });
    const hazardId = `midlands-rah-${String(index + 1).padStart(3, "0")}`;
    riskHazards.push({
      HazardId: hazardId,
      RiskAssessmentId: def.id,
      CompanyFolderId: companyFolderId,
      HazardType: "Operational",
      HazardTitle: `${def.activity} — primary hazard`,
      HazardDescription: `Injury or ill health arising from ${def.activity.toLowerCase()}.`,
      WhoMightBeHarmed: "Operatives and maintenance staff",
      HowMightTheyBeHarmed: "Contact, entrapment, exposure",
      ExistingControls: "Guarding, training, supervision",
      InitialLikelihood: "3",
      InitialSeverity: "4",
      InitialRiskScore: "12",
      AdditionalControls: "Improved signage and refresher briefing",
      ResidualLikelihood: "2",
      ResidualSeverity: "3",
      ResidualRiskScore: "6",
      ControlOwnerUserId: owner?.email,
      ControlOwnerName: owner?.name,
      ControlDueDate: addDays(assessmentDate, 30),
      ActionRequired: index % 3 === 0 ? "true" : "false",
      LinkedActionId: index % 3 === 0 ? actions[index % actions.length]?.["Action ID"] || "" : "",
      SortOrder: "1",
      Status: "Active",
      CreatedAt: isoAt(assessmentDate, 9, 30),
      CreatedBy: assessor?.email,
      UpdatedAt: isoAt(assessmentDate, 9, 30),
      UpdatedBy: assessor?.email,
    });
    if (index < 3) {
      riskLinks.push({
        LinkId: `midlands-ral-${String(index + 1).padStart(3, "0")}`,
        RiskAssessmentId: def.id,
        CompanyFolderId: companyFolderId,
        LinkedRecordType: "incident",
        LinkedRecordId: incidents[index]?.IncidentId || "",
        LinkedRecordTitle: incidents[index]?.Description || "",
        RelationshipType: "related",
        Notes: "Linked during assessment review",
        CreatedAt: isoAt(addDays(assessmentDate, 5), 10, 0),
        CreatedBy: assessor?.email,
      });
    }
    riskReviews.push({
      ReviewId: `midlands-rar-${String(index + 1).padStart(3, "0")}`,
      RiskAssessmentId: def.id,
      CompanyFolderId: companyFolderId,
      ReviewDate: addDays(assessmentDate, 90),
      ReviewerUserId: assessor?.email,
      ReviewerName: assessor?.name,
      ReviewType: "Periodic",
      Outcome: "No change required",
      ChangesRequired: "false",
      Summary: "Controls remain suitable.",
      PreviousVersion: "1.0",
      NewVersion: "1.0",
      CreatedAt: isoAt(addDays(assessmentDate, 90), 11, 0),
      CreatedBy: assessor?.email,
    });
  }

  const rugbyResults = auditResults.filter((row) => {
    const schedule = SCHEDULE_HISTORY.find((entry) => entry.id === row["Schedule ID"]);
    return schedule?.site === "rugby" || schedule?.site === "both";
  }).length;
  const coventryResults = auditResults.length - rugbyResults;

  const openActions = actions.filter((row) => row.Status === "Open" && row.Archived !== "true");
  const overdueActions = openActions.filter((row) => row["Due Date"] < anchorKey);
  const openNcrs = ncrs.filter((row) => row.Status !== "Completed" && row.Archived !== "true");
  const unsignedBriefings = briefingRecipients.filter((row) => row.Overdue === "true");

  const complianceTrend = Object.entries(complianceByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, stats]) => ({
      month,
      completed: stats.completed,
      passRate: stats.completed ? Number((stats.passed / stats.completed).toFixed(3)) : 0,
    }));

  const fingerprintPayload = {
    anchorDate: anchorKey,
    historyStart,
    historyEnd,
    counts: {
      auditResults: auditResults.length,
      auditFindings: auditFindings.length,
      actions: actions.length,
      ncrs: ncrs.length,
      incidents: incidents.length,
      briefings: briefings.length,
      briefingRecipients: briefingRecipients.length,
      lolerEquipment: lolerEquipment.length,
      lolerExaminations: lolerExaminations.length,
      riskAssessments: riskAssessments.length,
      riskHazards: riskHazards.length,
    },
    ids: {
      auditResults: auditResults.map((row) => row["Result ID"]),
      findings: auditFindings.map((row) => row["Finding ID"]),
      actions: actions.map((row) => row["Action ID"]),
      ncrs: ncrs.map((row) => row["NCR ID"]),
    },
  };
  const fingerprint = computeHistoryFingerprint(fingerprintPayload);

  return {
    anchorDate: anchorKey,
    historyStart,
    historyEnd,
    schedules,
    auditResults,
    auditFindings,
    actions,
    ncrs,
    incidents,
    briefings,
    briefingRecipients,
    lolerEquipment,
    lolerSchedules,
    lolerExaminations,
    riskAssessments,
    riskHazards,
    riskLinks,
    riskReviews,
    summary: {
      anchorDate: anchorKey,
      historyStart,
      historyEnd,
      fingerprint,
      counts: {
        auditResults: auditResults.length,
        auditResultsRugby: rugbyResults,
        auditResultsCoventry: coventryResults,
        auditFindings: auditFindings.length,
        actions: actions.length,
        actionsOpen: openActions.length,
        actionsOverdue: overdueActions.length,
        ncrs: ncrs.length,
        ncrsOpen: openNcrs.length,
        incidents: incidents.length,
        nearMisses: NEAR_MISS_DEFS.length,
        briefings: briefings.length,
        briefingRecipients: briefingRecipients.length,
        briefingUnsignedMandatory: unsignedBriefings.length,
        lolerEquipment: lolerEquipment.length,
        lolerExaminations: lolerExaminations.length,
        riskAssessments: riskAssessments.length,
        riskHazards: riskHazards.length,
        schedules: schedules.length,
      },
      complianceTrend,
      dashboard: {
        overdueActions: overdueActions.map((row) => row["Action ID"]),
        openActionsDueSoon: openActions.filter((row) => row["Due Date"] >= anchorKey).map((row) => row["Action ID"]),
        highPriorityOpenActions: openActions.filter((row) => row.Severity === "High").map((row) => row["Action ID"]),
        openNcrs: openNcrs.map((row) => row["NCR ID"]),
        recentIncident: incidents.find((row) => row.Status === "Open")?.IncidentId || "",
        unsignedMandatoryBriefings: unsignedBriefings.slice(0, 5).map((row) => `${row.BriefingId}:${row.RecipientEmail}`),
      },
      linkIntegrity: {
        findingsWithResults: auditFindings.every((row) => auditResults.some((result) => result["Result ID"] === row["Result ID"])),
        actionsResolvable: true,
      },
    },
  };
}

export function summarizeMidlandsHistory(history) {
  return {
    anchorDate: history.anchorDate,
    historyStart: history.historyStart,
    historyEnd: history.historyEnd,
    fingerprint: history.summary.fingerprint,
    counts: history.summary.counts,
    complianceTrend: history.summary.complianceTrend,
    dashboard: history.summary.dashboard,
  };
}
