/**
 * Midlands demo evidence scene catalog and image-generation prompt specs.
 */
export const EVIDENCE_SCENE_CATALOG = [
  {
    key: "rugby-cement-dust",
    site: "rugby",
    category: "rugby",
    subject: "cement dust accumulation near concrete batching mixer platform",
    location: "Rugby batching plant mixer discharge area",
    viewpoint: "waist-height mobile phone photo looking along the mixer platform",
    lighting: "overcast UK daylight with visible dust in the air",
    defect: "heavy cement dust coating handrails and floor plates",
  },
  {
    key: "rugby-silo-access",
    site: "rugby",
    category: "rugby",
    subject: "cement silo ladder and access platform",
    location: "Rugby batching plant cement silo base",
    viewpoint: "looking up at silo ladder from ground level",
    lighting: "flat industrial daylight",
    defect: "missing anti-slip tread visible on lower ladder rungs",
  },
  {
    key: "rugby-conveyor-guard",
    site: "rugby",
    category: "rugby",
    subject: "aggregate conveyor with damaged guard section",
    location: "Rugby batching plant aggregate conveyor line",
    viewpoint: "close mobile photo of conveyor guard at operator height",
    lighting: "indoor-outdoor mixed yard lighting",
    defect: "bent and partially missing mesh guard exposing moving belt",
  },
  {
    key: "rugby-guard-repaired",
    site: "rugby",
    category: "rugby",
    variant: "after",
    subject: "repaired aggregate conveyor guard",
    location: "Rugby batching plant aggregate conveyor line",
    viewpoint: "same angle as before photo of conveyor guard",
    lighting: "industrial daylight",
    defect: "corrected condition with replacement guard mesh secured and intact",
  },
  {
    key: "rugby-washout-housekeeping",
    site: "rugby",
    category: "rugby",
    subject: "concrete truck washout bay with poor housekeeping",
    location: "Rugby batching plant washout area",
    viewpoint: "standing at bay entrance with phone held vertically",
    lighting: "damp overcast light on wet concrete residue",
    defect: "dried slurry buildup, hoses tangled, standing water and debris",
  },
  {
    key: "rugby-washout-cleaned",
    site: "rugby",
    category: "rugby",
    variant: "after",
    subject: "cleaned concrete washout bay",
    location: "Rugby batching plant washout area",
    viewpoint: "same entrance angle as before washout photo",
    lighting: "overcast daylight on damp but cleared floor",
    defect: "corrected condition with slurry removed, hoses stowed, drains clear",
  },
  {
    key: "rugby-aggregate-bay",
    site: "rugby",
    category: "rugby",
    subject: "open aggregate storage bays with loader activity",
    location: "Rugby batching plant aggregate stock area",
    viewpoint: "wide mobile photo across aggregate bays",
    lighting: "natural outdoor light with dust haze",
    defect: "overfilled bay edge and scattered aggregate on walkway",
  },
  {
    key: "rugby-batching-panel",
    site: "rugby",
    category: "rugby",
    subject: "batching plant control panel and hopper indicators",
    location: "Rugby batching plant control cabin exterior",
    viewpoint: "arm-length photo of control panel",
    lighting: "screen glare and daylight on scratched panel face",
    defect: "worn labels and grime around emergency stop housing",
  },
  {
    key: "rugby-loader-leak",
    site: "rugby",
    category: "rugby",
    subject: "front loader with hydraulic leak trace",
    location: "Rugby yard near aggregate bays",
    viewpoint: "low mobile photo of loader wheel and hose routing",
    lighting: "outdoor yard lighting",
    defect: "fresh oil staining on concrete near loader coupling",
  },
  {
    key: "rugby-lab-cubes",
    site: "rugby",
    category: "quality",
    subject: "concrete cube crush test specimens on bench",
    location: "Rugby site quality laboratory",
    viewpoint: "bench-level photo of labelled cube moulds",
    lighting: "fluorescent workshop lighting",
    defect: "one cube label handwritten and partially smudged",
  },
  {
    key: "coventry-damaged-barrier",
    site: "coventry",
    category: "coventry",
    subject: "damaged pedestrian barrier at dispatch walkway",
    location: "Coventry precast dispatch yard pedestrian route",
    viewpoint: "mobile photo along walkway showing barrier damage",
    lighting: "overcast yard light",
    defect: "crushed barrier rail and displaced base plate",
  },
  {
    key: "coventry-barrier-repaired",
    site: "coventry",
    category: "coventry",
    variant: "after",
    subject: "repaired pedestrian barrier on dispatch walkway",
    location: "Coventry precast dispatch yard pedestrian route",
    viewpoint: "same walkway angle as damaged barrier photo",
    lighting: "overcast yard light",
    defect: "corrected condition with straight barrier and secured base",
  },
  {
    key: "coventry-chain-tag",
    site: "coventry",
    category: "coventry",
    subject: "lifting chain with illegible inspection tag",
    location: "Coventry yard lifting gear store",
    viewpoint: "close-up mobile photo of chain and tag",
    lighting: "workshop fluorescent with metal glare",
    defect: "faded illegible LOLER tag and worn master link",
  },
  {
    key: "coventry-lifting-tag-replaced",
    site: "coventry",
    category: "coventry",
    variant: "after",
    subject: "lifting chain with replacement inspection tag",
    location: "Coventry yard lifting gear store",
    viewpoint: "same close angle on chain and tag",
    lighting: "workshop fluorescent",
    defect: "corrected condition with new colour-coded tag and readable date",
  },
  {
    key: "coventry-unstable-stack",
    site: "coventry",
    category: "coventry",
    subject: "unstable stack of precast concrete units",
    location: "Coventry precast storage yard",
    viewpoint: "mobile photo showing leaning stack from aisle side",
    lighting: "outdoor overcast",
    defect: "precast units leaning without sufficient chocking or strapping",
  },
  {
    key: "coventry-stack-corrected",
    site: "coventry",
    category: "coventry",
    variant: "after",
    subject: "corrected precast storage stack",
    location: "Coventry precast storage yard",
    viewpoint: "same aisle angle as unstable stack photo",
    lighting: "outdoor overcast",
    defect: "corrected condition with level stack, timber chocks and strap visible",
  },
  {
    key: "quality-label-issue",
    site: "coventry",
    category: "quality",
    subject: "precast unit identification label mismatch",
    location: "Coventry finishing bay",
    viewpoint: "close mobile photo of product label on cured unit face",
    lighting: "indoor bay lighting",
    defect: "label code does not match chalk mark on unit edge",
  },
  {
    key: "quality-label-corrected",
    site: "coventry",
    category: "quality",
    variant: "after",
    subject: "corrected precast unit identification label",
    location: "Coventry finishing bay",
    viewpoint: "same label position on unit face",
    lighting: "indoor bay lighting",
    defect: "corrected condition with matching label and edge mark",
  },
  {
    key: "incident-spill-isolated",
    site: "rugby",
    category: "incident",
    subject: "isolated admixture spill with containment socks",
    location: "Rugby batching plant bunded storage",
    viewpoint: "ground-level mobile photo of spill area",
    lighting: "overcast daylight on wet concrete",
    defect: "contained spill with absorbent material deployed",
  },
  {
    key: "incident-blocked-route",
    site: "rugby",
    category: "incident",
    subject: "blocked emergency access route with pallets",
    location: "Rugby yard emergency route",
    viewpoint: "mobile photo down blocked corridor",
    lighting: "yard daylight",
    defect: "pallets obstructing marked emergency route",
  },
  {
    key: "incident-damaged-barrier",
    site: "coventry",
    category: "incident",
    subject: "incident scene at damaged pedestrian barrier",
    location: "Coventry dispatch yard",
    viewpoint: "incident documentation photo at barrier location",
    lighting: "overcast",
    defect: "fresh impact damage to barrier and scattered debris",
  },
  {
    key: "incident-product-movement",
    site: "coventry",
    category: "incident",
    subject: "precast unit shift during trailer loading",
    location: "Coventry dispatch loading bay",
    viewpoint: "mobile photo from loading bay apron",
    lighting: "outdoor overcast",
    defect: "unit shifted on trailer deck with strap slack",
  },
  {
    key: "incident-lifting-quarantine",
    site: "coventry",
    category: "incident",
    subject: "defective lifting accessory quarantined on pallet",
    location: "Coventry workshop quarantine area",
    viewpoint: "photo of quarantined chain on marked pallet",
    lighting: "workshop light",
    defect: "red quarantine tag on defective shackle",
  },
  {
    key: "incident-washout-slip",
    site: "rugby",
    category: "incident",
    subject: "slip hazard near washout area after spill",
    location: "Rugby washout bay approach",
    viewpoint: "low angle mobile photo of wet slurry on walkway",
    lighting: "damp overcast",
    defect: "wet slurry trail on pedestrian route",
  },
  {
    key: "coventry-forklift-route",
    site: "coventry",
    category: "coventry",
    subject: "forklift route obstruction at dispatch",
    location: "Coventry dispatch yard",
    viewpoint: "mobile photo along marked forklift lane",
    lighting: "yard daylight",
    defect: "stray materials narrowing forklift lane",
  },
  {
    key: "coventry-crane-zone",
    site: "coventry",
    category: "coventry",
    subject: "overhead crane exclusion zone marking",
    location: "Coventry precast lifting bay",
    viewpoint: "upward-angled mobile photo of crane hook area",
    lighting: "industrial bay light",
    defect: "faded floor markings under crane slew path",
  },
  {
    key: "rugby-mould-oil",
    site: "rugby",
    category: "rugby",
    subject: "mould oil storage and drip tray",
    location: "Rugby precast workshop",
    viewpoint: "bench-height photo of oil drums and drip tray",
    lighting: "workshop fluorescent",
    defect: "oil staining outside drip tray on concrete floor",
  },
  {
    key: "quality-edge-spall",
    site: "coventry",
    category: "quality",
    subject: "damaged precast unit edge spall",
    location: "Coventry finishing inspection area",
    viewpoint: "close photo of chipped arris on cured unit",
    lighting: "indoor inspection bay light",
    defect: "visible edge spall exceeding acceptable tolerance",
  },
  {
    key: "rugby-ppe-setup",
    site: "rugby",
    category: "rugby",
    subject: "PPE station at batching plant entrance",
    location: "Rugby plant entry point",
    viewpoint: "mobile photo of PPE board and dispensers",
    lighting: "indoor entrance light",
    defect: "missing ear defender hook and empty glove dispenser",
  },
];

export const BEFORE_AFTER_PAIR_DEFINITIONS = [
  {
    pairId: "pair-conveyor-guard",
    recordType: "finding",
    beforeScene: "rugby-conveyor-guard",
    afterScene: "rugby-guard-repaired",
    matchNote: /guard|conveyor/i,
  },
  {
    pairId: "pair-washout",
    recordType: "action",
    beforeScene: "rugby-washout-housekeeping",
    afterScene: "rugby-washout-cleaned",
    matchNote: /washout|housekeeping|clean/i,
  },
  {
    pairId: "pair-barrier-coventry",
    recordType: "incident",
    beforeScene: "coventry-damaged-barrier",
    afterScene: "coventry-barrier-repaired",
    matchNote: /barrier/i,
  },
  {
    pairId: "pair-lifting-tag",
    recordType: "ncr",
    beforeScene: "coventry-chain-tag",
    afterScene: "coventry-lifting-tag-replaced",
    matchNote: /lift|tag|chain/i,
  },
  {
    pairId: "pair-storage-stack",
    recordType: "incident",
    beforeScene: "coventry-unstable-stack",
    afterScene: "coventry-stack-corrected",
    matchNote: /stack|shift|storage|load/i,
  },
  {
    pairId: "pair-quality-label",
    recordType: "ncr",
    beforeScene: "quality-label-issue",
    afterScene: "quality-label-corrected",
    matchNote: /label|identification/i,
  },
];

export const PROHIBITED_CONTENT = [
  "readable real company names or logos",
  "visible real human faces",
  "dramatic cinematic styling",
  "text overlays or watermarks",
  "serious injury or blood",
  "stock-photo composition",
  "illustration or diagram style",
];

export function sceneByKey(key) {
  return EVIDENCE_SCENE_CATALOG.find((entry) => entry.key === key) || EVIDENCE_SCENE_CATALOG[0];
}

export function siteLabel(site) {
  return site === "coventry" ? "Coventry precast yard" : "Rugby batching plant";
}

export function buildImagePrompt(item, scene) {
  const beforeAfter =
    item.pairRole === "before"
      ? "Show the defect or poor condition before correction."
      : item.pairRole === "after"
        ? "Show the corrected condition after remedial work, same location and subject as the paired before photo."
        : "Document the current site condition relevant to the audit or incident record.";

  return [
    "Documentary mobile-phone photograph for UK health, safety and quality evidence.",
    `Setting: ${siteLabel(item.site)} — ${scene.location}.`,
    `Subject: ${scene.subject}.`,
    `Camera: ${scene.viewpoint}; ${item.orientation} orientation (${item.width}x${item.height}).`,
    `Lighting: ${scene.lighting}.`,
    `Condition: ${scene.defect}. ${beforeAfter}`,
    "Style: natural imperfect framing, realistic industrial wear, dirt and weathering, believable UK precast/batching environment.",
    "Constraints: no readable real company names, no visible faces, no cinematic grading, no text overlays, no watermarks, no blood or serious injury.",
    "Optional: subtle fictional Midlands Precast branding on PPE or signage only if naturally in scene.",
    `Record context (${item.recordType} ${item.recordId}): ${item.contextNote || item.title}.`,
  ].join(" ");
}

export function buildImageSpec(item, scene) {
  return {
    evidenceId: item.evidenceId,
    linkedRecordId: item.recordId,
    recordType: item.recordType,
    site: item.site,
    area: item.area || "",
    category: item.category,
    beforeAfterState: item.pairRole || item.variant || "single",
    sceneKey: scene.key,
    sceneDescription: scene.subject,
    cameraViewpoint: scene.viewpoint,
    orientation: item.orientation,
    width: item.width,
    height: item.height,
    lighting: scene.lighting,
    defectOrCorrection: scene.defect,
    prohibitedContent: [...PROHIBITED_CONTENT],
    expectedFileName: item.fileName,
    expectedMimeType: item.mimeType,
    pairId: item.pairId || "",
    pairRole: item.pairRole || "",
    prompt: buildImagePrompt(item, scene),
  };
}

export function buildPromptPack(plan) {
  const specs = plan.items.map((item) => buildImageSpec(item, sceneByKey(item.sceneKey)));
  return {
    anchorDate: plan.anchorDate,
    generatedAt: plan.generatedAt,
    company: "Midlands Precast Concrete Ltd",
    imageCount: specs.length,
    instructions: [
      "Generate one image per spec using an external image-generation system.",
      "Save each file using the exact expectedFileName into the assets folder.",
      "Accepted formats: JPG or PNG.",
      "Do not add text overlays or watermarks to the visible image.",
      "After generation, run: npm run import:demo-evidence-assets -- --anchor-date=<date>",
    ],
    assetsDirectory: "assets",
    specs,
  };
}

export function formatPromptPackMarkdown(pack) {
  const lines = [
    `# Midlands demo evidence prompt pack`,
    ``,
    `Anchor date: ${pack.anchorDate}`,
    `Images: ${pack.imageCount}`,
    ``,
    `Place generated files in the \`assets/\` folder beside this pack using each \`expectedFileName\`.`,
    ``,
  ];
  for (const spec of pack.specs) {
    lines.push(`## ${spec.evidenceId}`);
    lines.push(`- Record: ${spec.recordType} \`${spec.linkedRecordId}\``);
    lines.push(`- Site: ${spec.site}`);
    lines.push(`- Area: ${spec.area || "(from record)"}`);
    lines.push(`- Category: ${spec.category}`);
    lines.push(`- Before/after: ${spec.beforeAfterState}`);
    lines.push(`- File: \`${spec.expectedFileName}\``);
    lines.push(`- Dimensions: ${spec.width}x${spec.height} (${spec.orientation})`);
    lines.push(`- Pair: ${spec.pairId || "—"} ${spec.pairRole || ""}`.trim());
    lines.push(``);
    lines.push(`### Prompt`);
    lines.push(spec.prompt);
    lines.push(``);
  }
  return `${lines.join("\n")}\n`;
}
