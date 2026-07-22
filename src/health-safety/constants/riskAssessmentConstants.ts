export const RISK_ASSESSMENT_TYPES = [
  "General",
  "Activity",
  "Task",
  "Site",
  "Equipment",
  "Manual Handling",
  "Working at Height",
  "Fire",
  "Environmental",
  "Other",
];

export const HAZARD_LIBRARY = [
  "Slips, trips and falls",
  "Working at height",
  "Manual handling",
  "Vehicles and workplace transport",
  "Machinery",
  "Electricity",
  "Fire",
  "Noise",
  "Vibration",
  "Dust and fumes",
  "Hazardous substances",
  "Biological hazards",
  "Confined spaces",
  "Pressure systems",
  "Falling objects",
  "Sharp objects",
  "Temperature",
  "Ergonomics",
  "Stress and fatigue",
  "Violence and aggression",
  "Lone working",
  "Other",
];

export const PEOPLE_AT_RISK_OPTIONS = [
  "Employees",
  "Contractors",
  "Visitors",
  "Members of the public",
  "Young persons",
  "Expectant mothers",
  "New or inexperienced workers",
  "Disabled persons",
  "Lone workers",
  "Other",
];

export const LIKELIHOOD_OPTIONS = [
  { value: 1, label: "1 Rare" },
  { value: 2, label: "2 Unlikely" },
  { value: 3, label: "3 Possible" },
  { value: 4, label: "4 Likely" },
  { value: 5, label: "5 Almost Certain" },
];

export const SEVERITY_OPTIONS = [
  { value: 1, label: "1 Insignificant" },
  { value: 2, label: "2 Minor" },
  { value: 3, label: "3 Moderate" },
  { value: 4, label: "4 Major" },
  { value: 5, label: "5 Catastrophic" },
];

export const WIZARD_STEPS = [
  "Details",
  "People at Risk",
  "Hazards",
  "Controls",
  "Residual Risk",
  "Linked Records",
  "Review & Submit",
] as const;
